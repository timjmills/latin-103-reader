#!/usr/bin/env python
"""
extract_pictures.py — crop every illustration in a week's reading out of the
textbook scans and anchor it to the sentence it stands beside.

    python pipeline/extract_pictures.py all          # weeks 1–14
    python pipeline/extract_pictures.py 1 3          # selected weeks
    python pipeline/extract_pictures.py 1 --debug    # also save the ink mask / candidate boxes

Inputs
  scans/familia-romana.pdf     FR — full-page raster scans (~600 dpi) with a text layer;
                               line drawings sit in the margin column or between text
  scans/fabulae-syrae.pdf      FS — vector text with the pictures embedded as raster images
  scans/fabellae-latinae.pdf   FL — this edition prints no pictures at all (the three images
                               listed on every page are unused resources); checked anyway
  data/build/lines-week-NN.json   printed line → text (from extract_margins.py)
  data/build/week-NN.json         the units (line_no / block_start) the pictures are anchored to
  pipeline/extract_margins.py     page ranges, column geometry and the line-number index
                                  are reused from there (nothing is duplicated)

Outputs
  data/build/pictures-week-NN.json      CONTRACT "Pictures" shape:
        [{id, file, page, unit_id, caption, caption_en, width, height, sort}]
  data/build/pictures/week-NN/pNNN-k.png   the crops (max 1600 px on the long side)
  data/build/pictures/week-NN/_sheet.png   contact sheet (thumbnail, id, page, anchor, caption)
  data/build/pictures-REPORT.md          per week: counts, every picture with its anchor and
                                         confidence, everything uncertain
  data/pictures-overrides.json (input, optional)  {id: {caption, caption_en, unit_id}} — hand
                                         corrections applied after extraction, so a re-run keeps them

Method
  FR (raster): render the page at 100 dpi, blank every text-layer word box (running
  text, glosses, line numbers, drop caps, picture labels), the running head and the
  footer, threshold the rest to ink, dilate, and take the connected components that
  are at least 1.2 cm on both axes.  Overlapping / touching boxes are merged.  The
  crop is rendered from the scan at full resolution with a 4 pt margin.
  FS (embedded): the image rectangles on the page, at least 0.9 cm on both axes.
  Labels: text-layer rows inside the crop, or in a 1 cm halo around it that are
  centred under / over the picture (a gloss is flush with the margin column, a label
  sits under its drawing), that are not part of a numbered running-text line → the
  caption, macronised through the margins lexicon.  caption_en is left null.
  Anchor: the numbered text row whose vertical centre is nearest the picture's
  centre on that page → the unit whose block covers that line, and inside the block
  the sentence sharing the most words with the printed line.  A picture on a page
  without numbered rows (a full-page plate) is anchored to the last line of the
  previous page and reported as uncertain.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import extract_margins as em  # noqa: E402

BUILD = ROOT / "data" / "build"
PIC_DIR = BUILD / "pictures"

CM = 72 / 2.54            # points per centimetre
DETECT_DPI = 100          # analysis resolution for the raster scans
CROP_DPI = 600            # the FR scans are ~600 dpi; FS images are rendered at this too
MAX_SIDE = 1600           # crop long side
FR_MIN_CM = 1.2           # smallest component kept on the raster pages (both axes)
FS_MIN_CM = 0.9           # smallest embedded image kept
INK_THRESHOLD = 150       # grey level below which a pixel counts as ink
DILATE_CM = 0.22          # closes hatching / broken outlines before labelling
MERGE_GAP_CM = 0.15       # boxes closer than this are one picture
CROP_MARGIN_PT = 4.0
RULE_HEAD_PT = (40, 60)   # the head rule lies in this band below the page top (measured: 47–50 pt)
HALO_V_PT = 1.0 * CM      # label search zone above / below the crop
HALO_H_PT = 0.5 * CM


# --------------------------------------------------------------------------- geometry helpers

def rect_union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def rects_close(a, b, gap: float) -> bool:
    return not (a[2] + gap < b[0] or b[2] + gap < a[0] or a[3] + gap < b[1] or b[3] + gap < a[1])


def merge_rects(rects: list[tuple], gap: float) -> list[tuple]:
    rects = list(rects)
    changed = True
    while changed:
        changed = False
        out: list[tuple] = []
        for r in rects:
            for i, o in enumerate(out):
                if rects_close(r, o, gap):
                    out[i] = rect_union(r, o)
                    changed = True
                    break
            else:
                out.append(r)
        rects = out
    return rects


# --------------------------------------------------------------------------- connected components

def components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """Run-length connected components (8-connected) of a boolean mask.
    → [(x0, y0, x1, y1, pixel_count)] with x1/y1 exclusive."""
    parent: list[int] = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    prev_runs: list[tuple[int, int, int]] = []  # (x0, x1, label)
    runs_all: list[tuple[int, int, int, int]] = []  # (y, x0, x1, label)
    H = mask.shape[0]
    for y in range(H):
        row = mask[y]
        if not row.any():
            prev_runs = []
            continue
        d = np.diff(np.concatenate(([0], row.view(np.uint8), [0])))
        starts = np.flatnonzero(d == 1)
        ends = np.flatnonzero(d == -1)
        cur: list[tuple[int, int, int]] = []
        j = 0
        for x0, x1 in zip(starts.tolist(), ends.tolist()):
            label = None
            # 8-connectivity: overlap allowing one pixel of diagonal touch
            while j < len(prev_runs) and prev_runs[j][1] < x0:
                j += 1
            k = j
            while k < len(prev_runs) and prev_runs[k][0] <= x1:
                if label is None:
                    label = find(prev_runs[k][2])
                else:
                    union(label, prev_runs[k][2])
                k += 1
            if label is None:
                label = len(parent)
                parent.append(label)
            cur.append((x0, x1, label))
            runs_all.append((y, x0, x1, label))
        prev_runs = cur
    boxes: dict[int, list[int]] = {}
    for y, x0, x1, label in runs_all:
        r = find(label)
        b = boxes.get(r)
        if b is None:
            boxes[r] = [x0, y, x1, y + 1, x1 - x0]
        else:
            b[0] = min(b[0], x0)
            b[2] = max(b[2], x1)
            b[3] = y + 1
            b[4] += x1 - x0
    return [tuple(v) for v in boxes.values()]


# --------------------------------------------------------------------------- FR raster detection

def remove_rules(ink: np.ndarray, s: float) -> int | None:
    """Blank the column rule (the one vertical line that runs ~80% of the page
    height) and the head rule (the line that runs ~80% of the width within
    4–6 cm of the top): they touch the drawings and would join them into one
    component.  Measured on every page, so a skewed or shifted scan is fine.
    → x (px) of the column rule, or None."""
    H, W = ink.shape
    col = ink.sum(axis=0)
    rule_xs = np.flatnonzero(col > 0.45 * H).tolist()
    for x in rule_xs:
        ink[:, max(0, x - 5):x + 6] = False
    y0, y1 = int(RULE_HEAD_PT[0] * s), int(RULE_HEAD_PT[1] * s)
    row = ink[y0:y1].sum(axis=1)
    for y in np.flatnonzero(row > 0.45 * W).tolist():
        ink[max(0, y0 + y - 5):y0 + y + 6, :] = False
    return int(np.median(rule_xs)) if rule_xs else None


def detect_raster_pictures(fz_page, pl_page, cut_y: float | None, debug_path: Path | None = None) -> list[tuple]:
    """→ picture rects in points on a full-page raster scan (FR)."""
    g = em.GEOM["FR"]
    W, H = fz_page.rect.width, fz_page.rect.height
    s = DETECT_DPI / 72
    pix = fz_page.get_pixmap(dpi=DETECT_DPI, colorspace="gray", alpha=False)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    ink = np.array(img) < INK_THRESHOLD
    rule_x = remove_rules(ink, s)  # before the word boxes are blanked (they would cut the rules up)
    # blank every word of the text layer (running text, glosses, numbers, labels, drop caps)
    pad = 1.5 * s
    for w in pl_page.extract_words(x_tolerance=1.0, y_tolerance=2):
        x0, y0 = int(w["x0"] * s - pad), int(w["top"] * s - pad)
        x1, y1 = int(w["x1"] * s + pad) + 1, int(w["bottom"] * s + pad) + 1
        ink[max(0, y0):y1, max(0, x0):x1] = False
    for x0, y0, x1, y1, *_ in fz_page.get_text("words"):
        ink[max(0, int(y0 * s - pad)):int(y1 * s + pad) + 1, max(0, int(x0 * s - pad)):int(x1 * s + pad) + 1] = False
    ink[: int(g["head_y"] * s), :] = False           # running head + rule
    ink[int((H - g["foot_y"]) * s):, :] = False      # page number
    if cut_y is not None:
        ink[int((cut_y - 2) * s):, :] = False        # GRAMMATICA LATINA / PENSVM
    # page edge / binding shadow: ignore the outer 3 mm
    edge = int(0.3 * CM * s)
    ink[:, :edge] = False
    ink[:, -edge:] = False
    k = int(DILATE_CM * CM * s) | 1
    dil = Image.fromarray(ink.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(k))
    mask = np.array(dil) > 0
    min_px = FR_MIN_CM * CM * s
    boxes = []
    for x0, y0, x1, y1, n in components(mask):
        if (x1 - x0) >= min_px and (y1 - y0) >= min_px and ink[y0:y1, x0:x1].mean() >= 0.015:
            boxes.append((x0, y0, x1, y1))  # (a frame / rule with hardly any ink inside is furniture)
    boxes = merge_rects(boxes, MERGE_GAP_CM * CM * s)
    # a chapter-opening drawing that runs on into the margin column: the two sides
    # are separate pictures, each with its own vertical extent
    split = []
    for x0, y0, x1, y1 in boxes:
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        if rule_x is not None and x0 < rule_x - min_px / 2 and x1 > rule_x + min_px / 2:
            for a, b in ((x0, rule_x), (rule_x, x1)):
                ys = np.flatnonzero(mask[y0:y1, a:b].any(axis=1))
                xs = np.flatnonzero(mask[y0:y1, a:b].any(axis=0))
                if len(ys) and len(xs) and xs[-1] - xs[0] >= min_px and ys[-1] - ys[0] >= min_px:
                    split.append((a + xs[0], y0 + ys[0], a + xs[-1] + 1, y0 + ys[-1] + 1))
        else:
            split.append((x0, y0, x1, y1))
    # the dilation grew every box by k/2 px: shrink back, then add the crop margin
    shrink = (k // 2) / s
    out = []
    for x0, y0, x1, y1 in split:
        x0, y0, x1, y1 = x0 / s + shrink, y0 / s + shrink, x1 / s - shrink, y1 / s - shrink
        if (x1 - x0) < FR_MIN_CM * CM or (y1 - y0) < FR_MIN_CM * CM:
            continue
        out.append((max(0, x0 - CROP_MARGIN_PT), max(0, y0 - CROP_MARGIN_PT),
                    min(W, x1 + CROP_MARGIN_PT), min(H, y1 + CROP_MARGIN_PT)))
    if debug_path is not None:
        dbg = Image.fromarray(np.where(ink, 0, 255).astype(np.uint8)).convert("RGB")
        d = ImageDraw.Draw(dbg)
        for r in out:
            d.rectangle([r[0] * s, r[1] * s, r[2] * s, r[3] * s], outline=(255, 0, 0), width=2)
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        dbg.save(debug_path)
    return sorted(out, key=lambda r: (r[1], r[0]))


def detect_embedded_pictures(fz_page) -> list[tuple]:
    """→ rects (points) of the embedded raster images on a vector page (FS / FL)."""
    import fitz
    W, H = fz_page.rect.width, fz_page.rect.height
    rects = []
    for info in fz_page.get_images(full=True):
        for r in fz_page.get_image_rects(info[0]):
            if r.width >= FS_MIN_CM * CM and r.height >= FS_MIN_CM * CM:
                rects.append((r.x0, r.y0, r.x1, r.y1))
    for d in fz_page.get_drawings():
        r = d.get("rect")
        if r is not None and r.width >= FS_MIN_CM * CM and r.height >= FS_MIN_CM * CM:
            rects.append((r.x0, r.y0, r.x1, r.y1))
    rects = merge_rects(rects, MERGE_GAP_CM * CM)
    out = [(max(0, x0 - CROP_MARGIN_PT), max(0, y0 - CROP_MARGIN_PT), min(W, x1 + CROP_MARGIN_PT), min(H, y1 + CROP_MARGIN_PT))
           for x0, y0, x1, y1 in rects]
    return sorted(out, key=lambda r: (r[1], r[0]))


# --------------------------------------------------------------------------- labels

def picture_labels(pl_page, pg: dict, rect: tuple, others: list[tuple], src: str) -> tuple[list, list[str]]:
    """Text-layer rows that belong to the picture (not running text, not a gloss).
    → (rows, notes).  `others` are the other pictures on the page: a halo row
    nearer to one of them is theirs."""
    g = em.GEOM[src]
    W, H = pg["width"], pg["height"]
    x0, y0, x1, y1 = rect
    used = set()
    for r in pg["main"]:
        if r.line_no is not None:
            for w in r.words:
                used.add((round(w["x0"]), round(w["top"])))
    words = pl_page.extract_words(x_tolerance=1.0, y_tolerance=2, extra_attrs=["size"])
    cands = [w for w in words if (round(w["x0"]), round(w["top"])) not in used and not w["text"].isdigit()
             and g["head_y"] < w["top"] < H - g["foot_y"]]
    # whole rows (a gloss that merely runs into the halo stays one gloss row)
    rows = [r for r in em.group_rows(pg["page"], cands, g["row_tol"])
            if r.x1 >= x0 - HALO_H_PT and r.x0 <= x1 + HALO_H_PT and r.bottom >= y0 - HALO_V_PT and r.top <= y1 + HALO_V_PT]
    pic_cx, pic_w = (x0 + x1) / 2, x1 - x0
    # the gloss column's left edge: a row flush with it (or indented like a wrapped
    # gloss row) is a gloss; a label is centred under / beside its drawing
    ma, mb = g[pg["side"]]["margin"]
    gloss_rows = [r for r in pg["margin"] if em.has_letters(r.text) and ma <= r.x0 < mb]
    col_left = float(Counter(round(r.x0) for r in gloss_rows).most_common(1)[0][0]) if gloss_rows else None
    if col_left is not None:
        gloss_rows = [r for r in gloss_rows if r.x0 - col_left <= g["cont_max"] + 1]

    def dist(r, rc):
        dx = max(rc[0] - r.x1, r.x0 - rc[2], 0)
        dy = max(rc[1] - r.bottom, r.top - rc[3], 0)
        return (dx * dx + dy * dy) ** 0.5

    keep, notes = [], []
    for r in rows:
        if not em.has_letters(r.text):
            continue
        letters = re.sub(f"[^{em.LETTERS}]", "", r.text)
        if letters.isupper() and len(letters) >= 4:
            continue  # chapter / story title
        inside = y0 <= r.mid <= y1 and x0 - 2 <= r.x0 and r.x1 <= x1 + 2
        row_cx = (r.x0 + r.x1) / 2
        centred = abs(row_cx - pic_cx) < 0.25 * pic_w and (r.x1 - r.x0) < 0.9 * pic_w
        beside = y0 <= r.mid <= y1 and len(r.words) <= 3 and (r.x1 - r.x0) < 0.9 * pic_w
        flush = col_left is not None and r.x0 - col_left <= g["cont_max"] + 1
        if src == "FS" and inside:
            # FS images carry a white field that overlaps the gloss column: a row flush
            # with the column, or hanging under one within a row pitch, is a gloss
            above = [q for q in gloss_rows if 0 <= r.top - q.bottom <= 1.3 * (q.bottom - q.top) and q.x0 <= r.x0 + 1]
            if flush or above:
                continue
        if inside or ((centred or beside) and not flush):
            if any(dist(r, o) < dist(r, rect) for o in others):
                continue
            keep.append(r)
        elif y0 <= r.mid <= y1:
            notes.append(f"row beside the picture not taken as its label: {r.text[:40]!r}")
    return keep, notes


def caption_from_rows(rows: list, src: str, lex) -> tuple[str, str, list[str]]:
    """Rows → (caption, raw, notes).  Vertically adjacent, overlapping rows are one
    label ("currus" / "-ūs m"); two labels side by side on one row are split at the
    wide gap; separate labels are joined with " · "."""
    if not rows:
        return "", "", []
    pieces: list[dict] = []  # {x0, x1, top, bottom, words}
    for r in sorted(rows, key=lambda r: r.top):
        cur: list[dict] = []
        for w in r.words:
            if cur and w["x0"] - cur[-1]["x1"] > 3 * (w["bottom"] - w["top"]):
                pieces.append({"words": cur})
                cur = []
            cur.append(w)
        pieces.append({"words": cur})
    for pc in pieces:
        ws = pc["words"]
        pc.update(x0=min(w["x0"] for w in ws), x1=max(w["x1"] for w in ws), top=min(w["top"] for w in ws), bottom=max(w["bottom"] for w in ws))
    labels: list[list[dict]] = []
    for pc in pieces:
        for lab in labels:
            last = lab[-1]
            h = last["bottom"] - last["top"]
            if 0 <= pc["top"] - last["bottom"] <= 1.2 * h and pc["x0"] < last["x1"] + 4 and pc["x1"] > last["x0"] - 4:
                lab.append(pc)
                break
        else:
            labels.append([pc])
    outs, raws, notes = [], [], []
    for lab in labels:
        toks = [w["text"] for pc in lab for w in pc["words"]]
        toks = [t for t in toks if em.has_letters(t) or t in ("=", "↔", "(", ")", "/", "-")]
        if not toks:
            continue
        raw = " ".join(toks).replace(em.SOFT_HYPHEN, "")
        cleaned, probs = em.clean_gloss(raw, lex, src)
        notes += probs
        outs.append(cleaned)
        raws.append(raw)
    return " · ".join(outs), " · ".join(raws), notes


JUNK = re.compile(r"[{}\\|^~_*#@$%&<>\[\]0-9]|[a-zāēīōū][A-Z]|\.\w")


def caption_ok(caption: str) -> bool:
    return bool(caption) and not JUNK.search(caption)


# --------------------------------------------------------------------------- anchoring

def skel_tokens(text: str) -> list[str]:
    return [k for k in (em.skeleton(t) for t in text.split()) if k]


def units_for(week: dict, src: str, slug: str | None) -> list[dict]:
    us = [u for u in week["units"] if u.get("source", src) == src]
    if slug:
        us = [u for u in us if f":{slug}:" in u["id"]]
    return us


def anchor_unit(units: list[dict], line_no: int, line_text: str) -> tuple[dict | None, str]:
    """→ (unit, how): the block that covers the line, then the sentence sharing most words with it."""
    starts = [i for i, u in enumerate(units) if u.get("block_start") and u.get("line_no") is not None and u["line_no"] <= line_no]
    if not starts:
        return (units[0], "first unit") if units else (None, "no units")
    i0 = starts[-1]
    i1 = next((i for i in range(i0 + 1, len(units)) if units[i].get("block_start")), len(units))
    block = units[i0:i1]
    if len(block) == 1 or not line_text:
        return block[0], "block start"
    lt = skel_tokens(line_text)
    best, best_n = block[0], -1
    for u in block:
        bag = set(skel_tokens(u["la"]))
        n = sum(1 for t in lt if t in bag)
        if n > best_n:
            best, best_n = u, n
    if best_n <= 1:
        return best, "block start (line words not found in a sentence)"
    return best, f"sentence ({best_n} words of the line)"


# --------------------------------------------------------------------------- crops

def save_crop(fz_page, rect: tuple, path: Path) -> tuple[int, int]:
    import fitz
    clip = fitz.Rect(*rect)
    pix = fz_page.get_pixmap(dpi=CROP_DPI, clip=clip, colorspace="gray", alpha=False)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    return img.size


def font(size: int):
    for name in ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def contact_sheet(pics: list[dict], path: Path) -> None:
    cols, tw, th, pad = 4, 300, 240, 12
    f_id, f_txt = font(15), font(13)
    lines_per = 4
    cell_h = th + pad + lines_per * 18 + pad
    rows = max(1, (len(pics) + cols - 1) // cols)
    sheet = Image.new("RGB", (cols * (tw + pad) + pad, rows * cell_h + pad), "white")
    d = ImageDraw.Draw(sheet)
    for k, p in enumerate(pics):
        cx, cy = pad + (k % cols) * (tw + pad), pad + (k // cols) * cell_h
        try:
            im = Image.open(ROOT / p["file"]).convert("L")
            im.thumbnail((tw, th))
            sheet.paste(im, (cx + (tw - im.width) // 2, cy + (th - im.height) // 2))
        except OSError:
            pass
        d.rectangle([cx, cy, cx + tw, cy + th], outline=(200, 200, 200))
        y = cy + th + 6
        d.text((cx, y), f"{p['id']}  p{p['page']}  line {p.get('_line', '?')}", fill="black", font=f_id)
        d.text((cx, y + 18), f"→ {p['unit_id']}  [{p.get('_conf', '')}]", fill=(0, 0, 160), font=f_txt)
        cap = p.get("caption") or "(no label)"
        d.text((cx, y + 36), cap[:44], fill=(60, 60, 60), font=f_txt)
        la = (p.get("_la") or "")[:46]
        d.text((cx, y + 54), la, fill=(120, 120, 120), font=f_txt)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, optimize=True)


# --------------------------------------------------------------------------- per-week driver

def classify_chapter(pl_pdf, pages: list[int], src: str) -> tuple[list[dict], dict[int, float | None], list[str]]:
    """Classify + number the pages of an FR/FS chapter exactly as extract_margins does."""
    classified, cuts = [], {}
    notes: list[str] = []
    for p in pages:
        pl_page = pl_pdf.pages[p - 1]
        pg = em.classify_page(pl_page, p, src)
        cut = None
        if src == "FR":
            for w in pl_page.extract_words(x_tolerance=1.0, extra_attrs=["size"]):
                if w["top"] > 45 and w["text"] in ("GRAMMATICA", "PENSVM", "PENSVMA") and w["size"] > 9:
                    cut = w["top"] if cut is None else min(cut, w["top"])
            if cut is not None:
                pg["main"] = [r for r in pg["main"] if r.top < cut - 2]
                pg["margin"] = [r for r in pg["margin"] if r.top < cut - 2]
                pg["nums"] = [t for t in pg["nums"] if t[0] < cut - 2]
        classified.append(pg)
        cuts[p] = cut
        if cut is not None:
            break
    em.number_rows(classified, notes)
    return classified, cuts, notes


def extract_week(n: int, pdfs_pl: dict, pdfs_fz: dict, lex, debug: bool) -> dict:
    week = json.loads((BUILD / f"week-{n:02d}.json").read_text(encoding="utf-8"))
    lines = json.loads((BUILD / f"lines-week-{n:02d}.json").read_text(encoding="utf-8"))
    line_text = {(e.get("part"), e["line"]): e["text"] for e in lines}
    texts = em.week_texts(n, ROOT)
    out_dir = PIC_DIR / f"week-{n:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.png"):
        old.unlink()
    pics: list[dict] = []
    rep = {"week": n, "texts": [], "notes": [], "uncertain": []}
    chapters: dict = {}
    seen_rects: set = set()
    for tx in texts:
        src = tx["source"]
        tinfo = {"source": src, "slug": tx.get("slug"), "pages": [], "count": 0}
        if src == "FL":
            fz = pdfs_fz["FL"]
            spans = em.fl_story_spans(pdfs_pl["FL"]).get(tx["story"], [])
            tinfo["pages"] = sorted({p for p, _, _ in spans})
            for p, a, b in spans:
                for r in detect_embedded_pictures(fz[p - 1]):
                    if a - 2 < (r[1] + r[3]) / 2 < b:
                        rep["notes"].append(f"FL p{p}: embedded picture at {tuple(round(v) for v in r)} in story {tx['story']} — "
                                            f"FL anchoring by text is not wired (this edition has no pictures); skipped")
            rep["texts"].append(tinfo)
            continue
        ck = (src, tx["chapter"])
        if ck not in chapters:
            pl_pdf = pdfs_pl[src]
            pages = em.fr_chapter_pages(pl_pdf, tx["chapter"]) if src == "FR" else em.fs_chapter_pages(pl_pdf).get(tx["chapter"], [])
            chapters[ck] = classify_chapter(pl_pdf, pages, src)
        classified, cuts, cnotes = chapters[ck]
        rng = tx.get("range")
        slug = tx.get("slug")
        units = units_for(week, src, slug)
        tinfo["pages"] = [pg["page"] for pg in classified]
        prev_rows: list = []
        for pg in classified:
            p = pg["page"]
            fz_page = pdfs_fz[src][p - 1]
            pl_page = pdfs_pl[src].pages[p - 1]
            if src == "FR":
                dbg = (out_dir / f"_debug-p{p}.png") if debug else None
                rects = detect_raster_pictures(fz_page, pl_page, cuts.get(p), dbg)
            else:
                rects = detect_embedded_pictures(fz_page)
            rows = [r for r in pg["main"] if r.line_no is not None]
            k = 0
            for rect in rects:
                key = (p, tuple(round(v) for v in rect))
                cy = (rect[1] + rect[3]) / 2
                conf = "high"
                how = ""
                if rows:
                    row = min(rows, key=lambda r: abs(r.mid - cy))
                    # how far the line is from the picture's edge (0 = beside it)
                    dist = max(rect[1] - row.mid, row.mid - rect[3], 0)
                    if row is rows[0] and rect[3] <= row.top + 2:
                        dist = 0  # a picture above the first line of the page heads the text that follows
                    if dist > 3 * CM:
                        conf = "low"
                        how = f"nearest numbered line is {dist / CM:.1f} cm away"
                    elif dist > 1.5 * CM:
                        conf = "medium"
                        how = f"nearest numbered line is {dist / CM:.1f} cm away"
                elif prev_rows:
                    row = prev_rows[-1]
                    conf = "low"
                    how = "page has no numbered text (plate); anchored to the last line of the previous page"
                else:
                    rep["notes"].append(f"{src} p{p}: picture at {tuple(round(v) for v in rect)} on a page without numbered text and nothing before it — skipped")
                    continue
                line_no = row.line_no
                if rng is not None and not (rng[0] <= line_no <= rng[1]):
                    if min(abs(line_no - rng[0]), abs(line_no - rng[1])) <= 6:
                        rep["notes"].append(f"{src} p{p}: picture beside line {line_no} lies just outside "
                                            f"{'the ' + slug if slug else 'this week'} (lines {rng[0]}–{rng[1]}) — not taken")
                    continue  # another part / another week's half of the chapter
                if key in seen_rects:
                    continue
                seen_rects.add(key)
                k += 1
                pid = f"w{n:02d}/p{p}-{k}"
                fname = f"p{p}-{k}.png"
                file_rel = f"data/build/pictures/week-{n:02d}/{fname}"
                label_rows, cnotes_ = picture_labels(pl_page, pg, rect, [o for o in rects if o is not rect], src)
                caption, raw, probs = caption_from_rows(label_rows, src, lex)
                cnotes_ += probs
                if caption and not caption_ok(caption):
                    cnotes_.append(f"caption dropped as OCR junk: {caption!r} (raw {raw!r})")
                    caption = ""
                # the crop shows the label with its drawing
                crop = rect
                for r in label_rows:
                    crop = rect_union(crop, (r.x0 - 2, r.top - 2, r.x1 + 2, r.bottom + 2))
                crop = (max(0, crop[0]), max(0, crop[1]), min(pg["width"], crop[2]), min(pg["height"], crop[3]))
                width, height = save_crop(fz_page, crop, out_dir / fname)
                ltext = line_text.get((slug, line_no), line_text.get((None, line_no), row.text))
                unit, uhow = anchor_unit(units, line_no, ltext)
                if unit is None:
                    rep["notes"].append(f"{pid}: no unit found for line {line_no} — skipped")
                    continue
                if "not found" in uhow and conf == "high":
                    conf = "medium"
                entry = {"id": pid, "file": file_rel, "page": p, "unit_id": unit["id"], "caption": caption or None,
                         "caption_en": None, "width": width, "height": height, "sort": 0,
                         "_line": line_no, "_conf": conf, "_how": (how + "; " if how else "") + uhow, "_la": unit["la"],
                         "_rect": [round(v, 1) for v in rect], "_raw": raw, "_notes": cnotes_}
                pics.append(entry)
                tinfo["count"] += 1
                if conf != "high":
                    rep["uncertain"].append(f"{pid} (line {line_no} → {unit['id']}): {entry['_how']}")
                for note in cnotes_:
                    rep["uncertain"].append(f"{pid}: label — {note}")
                if not caption:
                    rep["uncertain"].append(f"{pid}: no label found in the text layer (a printed label may still be in the crop)")
            if rows:
                prev_rows = rows
        rep["texts"].append(tinfo)
        rep["notes"] += [x for x in cnotes if x not in rep["notes"]]
    # hand corrections (data/pictures-overrides.json: {id: {caption, caption_en, unit_id}})
    overrides = {}
    ov_path = ROOT / "data" / "pictures-overrides.json"
    if ov_path.exists():
        overrides = json.loads(ov_path.read_text(encoding="utf-8"))
    by_id = {u["id"]: u for u in week["units"]}
    for p in pics:
        ov = overrides.get(p["id"])
        if not ov:
            continue
        for key in ("caption", "caption_en", "unit_id"):
            if key in ov:
                p[key] = ov[key]
        if "unit_id" in ov and ov["unit_id"] in by_id:
            p["_la"] = by_id[ov["unit_id"]]["la"]
            p["_conf"] = "high"
            p["_how"] = "set by hand (pictures-overrides.json)"
        p["_override"] = "caption" in ov
        if "caption" in ov:
            rep["uncertain"] = [x for x in rep["uncertain"] if not (x.startswith(p["id"] + ":") and "label" in x)]
    # reading order: by unit order, then by position on the page
    order = {u["id"]: i for i, u in enumerate(week["units"])}
    pics.sort(key=lambda p: (order.get(p["unit_id"], 10**6), p["page"], p["_rect"][1]))
    for i, p in enumerate(pics):
        p["sort"] = i
    return {"pictures": pics, "report": rep}


def write_week(n: int, res: dict) -> None:
    pics = res["pictures"]
    public = [{k: v for k, v in p.items() if not k.startswith("_")} for p in pics]
    (BUILD / f"pictures-week-{n:02d}.json").write_text(json.dumps(public, ensure_ascii=False, indent=1), encoding="utf-8")
    contact_sheet(pics, PIC_DIR / f"week-{n:02d}" / "_sheet.png")


def report_section(n: int, res: dict) -> str:
    rep, pics = res["report"], res["pictures"]
    L = [f"## Week {n:02d}\n"]
    for t in rep["texts"]:
        L.append(f"- **{t['source']}{' ' + t['slug'] if t.get('slug') else ''}**: pages {t['pages']}; pictures: {t['count']}")
    L.append("")
    L.append(f"Total: {len(pics)} picture(s). Contact sheet: `data/build/pictures/week-{n:02d}/_sheet.png`\n")
    if pics:
        L.append("| id | page | line | unit | conf | caption | anchored sentence |")
        L.append("|---|---|---|---|---|---|---|")
        for p in pics:
            la = p["_la"].replace("|", "\\|")
            la = la[:70] + ("…" if len(la) > 70 else "")
            cap = (p["caption"] or "—").replace("|", "\\|")
            cap += " (hand)" if p.get("_override") else ""
            L.append(f"| {p['id']} | {p['page']} | {p['_line']} | `{p['unit_id']}` | {p['_conf']} | {cap} | {la} |")
        L.append("")
    if rep["uncertain"]:
        L.append("Uncertain (check on the contact sheet; fix by hand in data/pictures-overrides.json):\n")
        L += [f"- {x}" for x in dict.fromkeys(rep["uncertain"])]
        L.append("")
    if rep["notes"]:
        L.append("Notes:\n")
        L += [f"- {x}" for x in dict.fromkeys(rep["notes"])]
        L.append("")
    return "\n".join(L) + "\n"


def update_report(key: str, section: str) -> None:
    path = BUILD / "pictures-REPORT.md"
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    head = ("# Pictures — extraction & anchoring report\n\n"
            "Generated by `pipeline/extract_pictures.py`. Every week has a contact sheet at "
            "`data/build/pictures/week-NN/_sheet.png` (thumbnail, id, page, printed line, anchor unit, confidence, "
            "caption, first words of the anchored sentence). `conf` is the anchor confidence: high = a numbered text "
            "line sits within 1.5 cm of the picture's edge; medium = further, or the line's words were not found "
            "in one sentence of the block; low = a full-page plate anchored to the last line before it.\n\n"
            "Fabellae Latinae (weeks 3, 5, 10): this edition prints no illustrations in stories 63–74 — the three "
            "images listed in every page's resources are never drawn (no image rectangles, no vector drawings), so "
            "the FL parts contribute no pictures.\n")
    body = path.read_text(encoding="utf-8") if path.exists() else head
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    path.write_text(body, encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="+", help="week numbers or 'all'")
    ap.add_argument("--debug", action="store_true", help="save the ink mask with the detected boxes next to the crops")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    import fitz
    import pdfplumber
    weeks = list(range(1, 15)) if a.weeks == ["all"] else [int(x) for x in a.weeks]
    pdfs_pl, pdfs_fz = {}, {}
    for src, name in em.SCANS.items():
        p = ROOT / "scans" / name
        if p.exists():
            pdfs_pl[src] = pdfplumber.open(str(p))
            pdfs_fz[src] = fitz.open(str(p))
        else:
            print(f"missing scan {p}", file=sys.stderr)
    lex = em.build_lexicon(ROOT, pdfs_pl, BUILD / "margins-lexicon.json", quiet=a.quiet)
    for n in weeks:
        res = extract_week(n, pdfs_pl, pdfs_fz, lex, a.debug)
        write_week(n, res)
        update_report(f"pictures:w{n:02d}", report_section(n, res))
        if not a.quiet:
            pics = res["pictures"]
            confs = {c: sum(1 for p in pics if p["_conf"] == c) for c in ("high", "medium", "low")}
            print(f"week {n:02d}: {len(pics)} pictures  (high {confs['high']}, medium {confs['medium']}, low {confs['low']})  "
                  + "; ".join(f"{t['source']}{('/' + t['slug']) if t.get('slug') else ''}: {t['count']}" for t in res["report"]["texts"]))
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
