#!/usr/bin/env python
"""
extract_pictures.py — crop every illustration in a week's reading out of the
textbook scans and anchor it to the sentence it stands beside.

    python pipeline/extract_pictures.py all          # weeks 1–14
    python pipeline/extract_pictures.py 1 3          # selected weeks
    python pipeline/extract_pictures.py 1 --debug    # also save the ink mask / candidate boxes
    python pipeline/extract_pictures.py shelf        # the review shelf: FR I–XXIV → weeks 101–124
    python pipeline/extract_pictures.py shelf 2 9    # selected shelf chapters

Shelf mode is a second path through the same scan, described under
"Shelf mode" below; it writes data/build/pictures-week-1NN.json,
data/build/pictures/week-1NN/ and data/build/pictures-SHELF-REPORT.md.

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
from attach_margins import gloss_stem, unit_has_stem  # noqa: E402  (the shelf's label → sentence preference)

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

def picture_labels(pl_page, pg: dict, rect: tuple, others: list[tuple], src: str,
                   allow_caps: bool = False, near_pt: float = 0.0) -> tuple[list, list[str]]:
    """Text-layer rows that belong to the picture (not running text, not a gloss).
    → (rows, notes).  `others` are the other pictures on the page: a halo row
    nearer to one of them is theirs.  `allow_caps` keeps a small all-caps row
    (IVLIVS, SYRA — the names Ørberg letters into his drawings); the chapter
    title is set large and is thrown away either way.  `near_pt` also keeps a row
    that sits wholly within the picture's width just above or below it — the name
    Ørberg letters over a figure's head, which is part of the drawing."""
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
        if letters.isupper() and len(letters) >= 4 and not (allow_caps and max(w.get("size", 0) for w in r.words) <= 11):
            continue  # chapter / story title
        inside = y0 <= r.mid <= y1 and x0 - 2 <= r.x0 and r.x1 <= x1 + 2
        row_cx = (r.x0 + r.x1) / 2
        centred = abs(row_cx - pic_cx) < 0.25 * pic_w and (r.x1 - r.x0) < 0.9 * pic_w
        beside = y0 <= r.mid <= y1 and len(r.words) <= 3 and (r.x1 - r.x0) < 0.9 * pic_w
        flush = col_left is not None and r.x0 - col_left <= g["cont_max"] + 1
        # a row just over or under the picture, sitting on it (Ørberg's "hortus"
        # over a box is a little wider than the box itself)
        share = max(0.0, min(r.x1, x1) - max(r.x0, x0)) / max(1e-6, r.x1 - r.x0)
        over = bool(near_pt) and share >= 0.6 and (r.x1 - r.x0) <= 2.2 * (x1 - x0) and (
            0 <= y0 - r.bottom <= near_pt or 0 <= r.top - y1 <= near_pt)
        if src == "FS" and inside:
            # FS images carry a white field that overlaps the gloss column: a row flush
            # with the column, or hanging under one within a row pitch, is a gloss
            above = [q for q in gloss_rows if 0 <= r.top - q.bottom <= 1.3 * (q.bottom - q.top) and q.x0 <= r.x0 + 1]
            if flush or above:
                continue
        if inside or ((centred or beside or over) and not flush):
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


# =========================================================================== #
# Shelf mode — Familia Romana I–XXIV (the review shelf, weeks 101–124)
# =========================================================================== #
# The course weeks above read FR chapters XXV+ ; the shelf re-reads I–XXIV,
# whose pages are the most heavily illustrated in the book — the drawings are
# how Ørberg teaches the vocabulary, so the shelf needs them too.
#
# What is different from the week path
#   * the units come from data/build/review-NN.json (pipeline/review_shelf.py),
#     whose page set, column geometry and line numbering are the same ones used
#     here, so a picture's printed line names a shelf unit directly;
#   * detection keeps a second ink mask with the text still on it, so a crop can
#     be grown until no stroke of the drawing touches its border, and then
#     pulled back off any word it would otherwise show half of (the week path's
#     known weakness: it takes the ink box, adds a flat 4 pt and ships whatever
#     that happens to slice through);
#   * furniture is rejected explicitly — the column and head rules, and the
#     paradigm / family-tree rules in the margin — instead of only by size.

SHELF_BASE = 100
SHELF_MIN_CM = 0.70          # a drawing must reach this on its short axis …
SHELF_MIN_LONG_CM = 1.10     # … and this on its long axis
SHELF_MIN_INK = 150          # and carry at least this many ink pixels at DETECT_DPI
                             # (Ørberg's margin drawings are thin outlines — a bone, a needle,
                             #  an olive twig — so this only has to exclude specks and smudges)
SHELF_MARGIN_PT = 5.0        # white space around the finished crop
GROW_CAP_PT = 0.7 * CM       # how far the anti-clip grow may push an edge out
RULE_CLEAR_PT = 3.0          # clearance kept from the column rule
EXPLAIN_GAP_PT = 2.5         # how close under a figure its explanatory line sits


def long_rules(ink: np.ndarray, s: float) -> list[tuple[int, int, int]]:
    """Blank the page's long rules (the vertical column rule, the rule under the
    running head) in place.  → the vertical rules as (x, y0, y1) in pixels, so a
    box is only ever split at a rule where the rule actually runs."""
    H, W = ink.shape
    out: list[tuple[int, int, int]] = []
    for x in np.flatnonzero(ink.sum(axis=0) > 0.45 * H).tolist():   # every rule column first …
        ys = np.flatnonzero(ink[:, x])
        out.append((x, int(ys[0]), int(ys[-1])))
    for x, _y0, _y1 in out:                                          # … then blank them (a blank widens over its neighbours)
        ink[:, max(0, x - 5):x + 6] = False
    y0, y1 = int(RULE_HEAD_PT[0] * s), int(RULE_HEAD_PT[1] * s)
    row = ink[y0:y1].sum(axis=1)
    for y in np.flatnonzero(row > 0.45 * W).tolist():
        ink[max(0, y0 + y - 5):y0 + y + 6, :] = False
    return out


def shelf_masks(fz_page, pl_page, g: dict, cut_y: float | None):
    """→ (txt, raw, vrules, s): the page's ink with the text layer blanked, the
    same ink with the text still on it, the vertical rules, and px per point.
    Both masks have the running head, the page number, the Grammatica cut and
    the binding edge blanked, so neither can seed or grow a box into furniture."""
    s = DETECT_DPI / 72
    H_pt = fz_page.rect.height
    pix = fz_page.get_pixmap(dpi=DETECT_DPI, colorspace="gray", alpha=False)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    ink = np.array(img) < INK_THRESHOLD
    vrules = long_rules(ink, s)   # before the words are blanked: they would cut the rules up
    raw = ink.copy()
    txt = ink.copy()
    pad = 1.5 * s
    for w in pl_page.extract_words(x_tolerance=1.0, y_tolerance=2):
        txt[max(0, int(w["top"] * s - pad)):int(w["bottom"] * s + pad) + 1,
            max(0, int(w["x0"] * s - pad)):int(w["x1"] * s + pad) + 1] = False
    for x0, y0, x1, y1, *_ in fz_page.get_text("words"):
        txt[max(0, int(y0 * s - pad)):int(y1 * s + pad) + 1,
            max(0, int(x0 * s - pad)):int(x1 * s + pad) + 1] = False
    edge = int(0.3 * CM * s)
    for m in (txt, raw):
        m[: int(g["head_y"] * s), :] = False
        m[int((H_pt - g["foot_y"]) * s):, :] = False
        if cut_y is not None:
            m[int((cut_y - 2) * s):, :] = False
        m[:, :edge] = False
        m[:, -edge:] = False
    return txt, raw, vrules, s


def ink_bands(ink: np.ndarray) -> list[tuple[int, int]]:
    """The maximal runs of rows that carry ink, single blank rows bridged."""
    out: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate(ink.any(axis=1)):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, ink.shape[0]))
    merged: list[tuple[int, int]] = []
    for b in out:
        if merged and b[0] - merged[-1][1] < 2:
            merged[-1] = (merged[-1][0], b[1])
        else:
            merged.append(b)
    return merged


TYPE_BAND_PT = 12.0      # no drawing this small survives the size floor; a line of type does


def is_furniture(ink: np.ndarray, s: float = DETECT_DPI / 72) -> str | None:
    """A component that is a rule or a paradigm table rather than a drawing.
    → why it was rejected, or None.  Both tests only look at *sparse* regions: a
    filled picture (cap. II's black plate) is dense and can never be mistaken
    for a table."""
    h, w = ink.shape
    n = int(ink.sum())
    if n == 0:
        return "no ink"
    bands = ink_bands(ink)
    if len(bands) >= 2 and max(b[1] - b[0] for b in bands) <= TYPE_BAND_PT * s:
        # two or more ink bands, none taller than a line of print: the scan's text
        # layer missed a piece of type (Ørberg's enlarged "A = 'ā'", an italic
        # gloss), and what is left in the ink mask is words, not a drawing.  Every
        # real drawing that passes the size floor has one band 18 pt or taller.
        return f"{len(bands)} bands of ink, none over {TYPE_BAND_PT:.0f} pt — a line of print the text layer missed"
    if n / (h * w) >= 0.10:
        return None                       # a real drawing: hatching, a filled field
    rows_with_ink = int(ink.any(axis=1).sum())
    cols_with_ink = int(ink.any(axis=0).sum())
    if rows_with_ink < max(3, 0.12 * h) or cols_with_ink < max(3, 0.12 * w):
        return f"ink on {rows_with_ink}/{h} rows and {cols_with_ink}/{w} columns — a rule, not a drawing"
    long_h = int(ink[:, : max(1, int(0.6 * w))].all(axis=1).sum()) * w
    long_v = int(ink[: max(1, int(0.6 * h)), :].all(axis=0).sum()) * h
    if (long_h + long_v) > 0.55 * n:
        return "most of the ink lies in full-width / full-height rules — a table, not a drawing"
    return None


def tight_box(mask: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
    x0, y0, x1, y1 = box
    sub = mask[y0:y1, x0:x1]
    ys, xs = np.flatnonzero(sub.any(axis=1)), np.flatnonzero(sub.any(axis=0))
    if not len(ys) or not len(xs):
        return None
    return (x0 + int(xs[0]), y0 + int(ys[0]), x0 + int(xs[-1]) + 1, y0 + int(ys[-1]) + 1)


def grow_to_ink(mask: np.ndarray, box: tuple[int, int, int, int], cap_px: int) -> tuple[tuple[int, int, int, int], bool]:
    """Push every edge out for as long as ink still touches it, up to `cap_px`
    steps.  This is what stops a stroke being sliced: an edge is accepted only
    once the pixel band just inside it is empty.  → (box, still touching?)"""
    H, W = mask.shape
    x0, y0, x1, y1 = box
    for _ in range(cap_px):
        moved = False
        if y0 > 0 and mask[y0, x0:x1].any():
            y0 -= 1
            moved = True
        if y1 < H and mask[y1 - 1, x0:x1].any():
            y1 += 1
            moved = True
        if x0 > 0 and mask[y0:y1, x0].any():
            x0 -= 1
            moved = True
        if x1 < W and mask[y0:y1, x1 - 1].any():
            x1 += 1
            moved = True
        if not moved:
            return (x0, y0, x1, y1), False
    touching = bool(mask[y0, x0:x1].any() or mask[y1 - 1, x0:x1].any()
                    or mask[y0:y1, x0].any() or mask[y0:y1, x1 - 1].any())
    return (x0, y0, x1, y1), touching


def detect_shelf_pictures(fz_page, pl_page, pg: dict, cut_y: float | None,
                          debug_path: Path | None = None) -> tuple[list[dict], list[str], list[tuple]]:
    """→ ([{core, zone, capped}], notes, vertical rules in points) for one FR page
    of chapters I–XXIV.
    `core` is the drawing's rect in points, already grown so that no stroke of it
    touches an edge; `zone` is the column it stands in ('main' / 'margin'),
    which decides how it is anchored to a printed line."""
    g = em.GEOM["FR"]
    txt, raw, vrules, s = shelf_masks(fz_page, pl_page, g, cut_y)
    notes: list[str] = []
    k = int(DILATE_CM * CM * s) | 1
    dil = np.array(Image.fromarray(txt.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(k))) > 0
    min_short, min_long = SHELF_MIN_CM * CM * s, SHELF_MIN_LONG_CM * CM * s
    boxes = [(x0, y0, x1, y1) for x0, y0, x1, y1, _n in components(dil)
             if min(x1 - x0, y1 - y0) >= min_short and max(x1 - x0, y1 - y0) >= min_long]
    boxes = [tuple(int(v) for v in b) for b in merge_rects(boxes, MERGE_GAP_CM * CM * s)]
    # a drawing that runs across the column rule is two pictures — but only where
    # the rule really runs (a chapter opener stands above the rule and stays whole)
    split: list[tuple[int, int, int, int]] = []
    for x0, y0, x1, y1 in boxes:
        cut = None
        for rx, ry0, ry1 in vrules:
            if x0 + min_short / 2 < rx < x1 - min_short / 2 and ry0 <= y0 + 0.15 * (y1 - y0) and ry1 >= y1 - 0.15 * (y1 - y0):
                cut = rx
        if cut is None:
            split.append((x0, y0, x1, y1))
            continue
        for a, b in ((x0, cut), (cut, x1)):
            t = tight_box(dil, (a, y0, b, y1))
            if t and min(t[2] - t[0], t[3] - t[1]) >= min_short and max(t[2] - t[0], t[3] - t[1]) >= min_long:
                split.append(t)
    out: list[dict] = []
    cap_px = int(GROW_CAP_PT * s)
    for b in split:
        core = tight_box(txt, b)          # back off the dilation: the real ink
        if core is None:
            continue
        core, capped = grow_to_ink(txt, core, cap_px)
        x0, y0, x1, y1 = core
        sub = txt[y0:y1, x0:x1]
        pt = tuple(round(v / s) for v in core)
        if int(sub.sum()) < SHELF_MIN_INK:
            notes.append(f"p{pg['page']}: box at {pt} pt skipped — {int(sub.sum())} ink px, too faint to be a drawing")
            continue
        why = is_furniture(sub, s)
        if why:
            notes.append(f"p{pg['page']}: box at {pt} pt skipped — {why}")
            continue
        if capped:
            notes.append(f"p{pg['page']}: ink still touched the box after {GROW_CAP_PT:.0f} pt of growth at {pt} pt "
                         f"— the crop may clip")
        rect = (x0 / s, y0 / s, x1 / s, y1 / s)
        ma, mb = g[pg["side"]]["margin"]
        cx = (rect[0] + rect[2]) / 2
        out.append({"core": rect, "zone": "margin" if ma <= cx < mb else "main", "capped": capped})
    out.sort(key=lambda d: (d["core"][1], d["core"][0]))
    if debug_path is not None:
        dbg = Image.fromarray(np.where(raw, 0, 255).astype(np.uint8)).convert("RGB")
        d = ImageDraw.Draw(dbg)
        for e in out:
            r = e["core"]
            d.rectangle([r[0] * s, r[1] * s, r[2] * s, r[3] * s], outline=(220, 0, 0), width=2)
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        dbg.save(debug_path)
    return out, notes, [(x / s, y0 / s, y1 / s) for x, y0, y1 in vrules]


# --------------------------------------------------------------------------- clean crops

def word_boxes(pl_page, pg: dict) -> tuple[list[tuple], list[tuple]]:
    """Every word of the page as (x0, top, x1, bottom), split into the ones a crop
    must never show half of (running text, glosses, the running head, the chapter
    title, the page number) and the free ones (picture labels)."""
    g = em.GEOM["FR"]
    taken: set[tuple] = set()
    for r in pg["main"]:
        if r.line_no is not None:
            for w in r.words:
                taken.add((round(w["x0"], 1), round(w["top"], 1)))
    for r in pg["margin"]:
        for w in r.words:
            taken.add((round(w["x0"], 1), round(w["top"], 1)))
    text, free = [], []
    for w in pl_page.extract_words(x_tolerance=1.0, y_tolerance=2, extra_attrs=["size"]):
        box = (w["x0"], w["top"], w["x1"], w["bottom"])
        letters = re.sub(f"[^{em.LETTERS}]", "", w["text"])
        outside = w["top"] < g["head_y"] or w["bottom"] > pg["height"] - g["foot_y"]
        title = letters.isupper() and len(letters) >= 4 and w.get("size", 0) > 11
        if outside or title or (round(w["x0"], 1), round(w["top"], 1)) in taken:
            text.append(box)
        else:
            free.append(box)
    return text, free


_GLOSS_SYNTAX = re.compile(r"[=:<>↔]|(?<![\w-])-[a-zāēīōū]")


def explain_row(pg: dict, rect: tuple) -> list:
    """The one line Ørberg prints under a schematic margin figure — "Iūlia in
    hortō est" under the box with a dot in it.  It is set flush with the gloss
    column, so `picture_labels` reads it as a gloss; but it sits hard against the
    drawing (about 1.5 pt) and it is a *sentence*, where a gloss carries the
    column's syntax ("cōn-sīdere = sedēre incipere", "-a -ae:", "ēst edunt").
    Without it the diagram means nothing, so it is kept with it."""
    rows = sorted(pg["margin"], key=lambda r: r.top)
    first = None
    for i, r in enumerate(rows):
        if not (0 <= r.top - rect[3] <= EXPLAIN_GAP_PT and r.x0 <= rect[2] + 6 and r.x1 >= rect[0] - 6):
            continue
        if len(r.words) < 3 or _GLOSS_SYNTAX.search(r.text) or not em.has_letters(r.text):
            continue
        first = i
        break
    if first is None:
        return []
    out = [rows[first]]
    for r in rows[first + 1:]:
        # Ørberg indents a wrapped line; a flush row is the next gloss, not this one
        if r.top - out[-1].bottom > 6 or r.x0 <= out[0].x0 + 1 or _GLOSS_SYNTAX.search(r.text):
            break
        out.append(r)
    return out


def restore_capital_i(caption: str, raw: str) -> str:
    """The gloss lexicon filters out every word that starts with a capital I as
    suspicious, so it hands back the scan's own misreading — "Iūlia" comes out
    "Lūlia".  Where the printed token began with I and the cleaned one differs
    only in that letter, the print is right."""
    cw, rw = caption.split(), raw.split()
    if not caption or len(cw) != len(rw):
        return caption
    out = []
    for c, r in zip(cw, rw):
        if r[:1] == "I" and c[:1] in "Ll" and em.strip_macrons(c[1:]).lower() == em.strip_macrons(r[1:]).lower():
            c = "I" + c[1:]
        out.append(c)
    return " ".join(out)


def explain_text(rows: list, cleaner) -> str:
    """That line as a caption.  It is running Latin, not a gloss, so it goes
    through `review_shelf.Cleaner` — the same repair that made the shelf's own
    sentences — and not through the gloss lexicon, which lower-cases Iūlia into
    the scan's misread "lūlia"."""
    joined = " ".join(r.text for r in rows).replace(em.SOFT_HYPHEN, "").replace("- ", "")
    text = re.sub(r"(?<=[a-zāēīōū])(?=[A-ZĀĒĪŌŪ])", " ", joined)
    out = []
    for i, tok in enumerate(text.split()):
        cleaned, ok = cleaner.word(tok, initial=(i == 0))
        out.append(cleaned if ok else tok)
    return " ".join(out)


_TAIL_ONLY = {"m", "f", "n", "pl", "sg", "m/f", "f/m", "mf", "adv", "prp", "acc", "abl", "dat", "gen"}


def _row_kind(row) -> str:
    """'noise' — a row of stray single characters the scan invented; 'tail' — an
    inflectional ending or grammar mark and nothing else ("-ae f", "-ūs m");
    'word' — anything with a headword of its own.

    A tail belongs with its headword: "vēlum" over the sail and "-ī n" under it
    are one label, and the pair is what the learner wants.  A tail *alone* is the
    other half of a gloss whose headword is printed outside the picture ("catēna"
    on the line above the chain), and on its own it teaches nothing."""
    toks = [t for t in row.text.split() if t.strip("()[].,;:·/")]
    if not toks:
        return "noise"
    kind = "noise"
    for t in toks:
        core = t.strip("()[].,;:·/").lower()
        if core.startswith("-") or core in _TAIL_ONLY:
            kind = "tail"
        elif len(re.sub(f"[^{em.LETTERS}]", "", core)) > 1:
            return "word"
    return kind


def _is_caps(row) -> bool:
    """A name lettered into the drawing (IVLIVS, MEDVS).  It belongs in the crop —
    it is part of the picture — but never in the caption: the scan reads those
    small capitals badly (DAVUS → "DAWS"), and they are already in the image."""
    letters = re.sub(f"[^{em.LETTERS}]", "", row.text)
    return letters.isupper() and len(letters) >= 4


def _overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _inside(inner, outer) -> bool:
    return inner[0] >= outer[0] - 0.5 and inner[1] >= outer[1] - 0.5 and inner[2] <= outer[2] + 0.5 and inner[3] <= outer[3] + 0.5


def clean_crop(core: tuple, label_rows: list, text_boxes: list[tuple], free_boxes: list[tuple],
               rules: list[tuple], page_w: float, page_h: float) -> tuple[tuple, list[tuple], list[str]]:
    """The crop actually saved: the drawing with everything that belongs to it and
    nothing that does not.  → (crop, boxes to white out, notes).

    1. start at the drawing's ink box — already grown until no stroke of it
       touches an edge, so the picture itself can never be sliced;
    2. union in the label rows and any free word the drawing overlaps, so a name
       lettered into the picture (IVLIVS, oppidum) is never cut in half;
    3. add the white margin;
    4. pull the edges back off the column rule, and off any running-text or gloss
       word the crop now shows only part of — but never into the box of step 2:
       a crop may be tight, never clipped;
    5. whatever printed text is still inside the crop after that is beside the
       drawing, not part of it (a gloss set level with a margin figure): its word
       boxes are whited out in the saved image, which is what stops the crop
       showing a torn "ber ovus" down its edge.
    """
    notes: list[str] = []
    keep = core
    for r in label_rows:
        keep = rect_union(keep, (r.x0 - 1, r.top - 1, r.x1 + 1, r.bottom + 1))
    for b in free_boxes:
        if _overlaps(core, b):
            keep = rect_union(keep, (b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1))
    crop = (max(0.0, keep[0] - SHELF_MARGIN_PT), max(0.0, keep[1] - SHELF_MARGIN_PT),
            min(page_w, keep[2] + SHELF_MARGIN_PT), min(page_h, keep[3] + SHELF_MARGIN_PT))
    # the column rule: it is furniture, and a crop that reaches over it shows a
    # black bar down its side
    for rx, ry0, ry1 in rules:
        if ry1 < crop[1] or ry0 > crop[3] or not (crop[0] < rx < crop[2]):
            continue
        if rx <= keep[0]:
            crop = (min(rx + RULE_CLEAR_PT, keep[0]), crop[1], crop[2], crop[3])
        elif rx >= keep[2]:
            crop = (crop[0], crop[1], max(rx - RULE_CLEAR_PT, keep[2]), crop[3])
        else:
            notes.append(f"the column rule at x={rx:.0f} pt runs through the picture — it stays in the crop")
    for _ in range(8):
        bad = [b for b in text_boxes if _overlaps(crop, b) and not _inside(b, crop)]
        if not bad:
            break
        moved = False
        for b in bad:
            # the cheapest edge that puts the word wholly outside the crop, taken
            # only where it does not eat into `keep` (the picture and its labels)
            for _cost, side, edge in sorted([(b[1] - crop[1], "top", b[3]), (crop[3] - b[3], "bottom", b[1]),
                                             (b[0] - crop[0], "left", b[2]), (crop[2] - b[2], "right", b[0])]):
                if side == "top" and edge <= keep[1] and edge > crop[1]:
                    crop = (crop[0], edge, crop[2], crop[3])
                elif side == "bottom" and edge >= keep[3] and edge < crop[3]:
                    crop = (crop[0], crop[1], crop[2], edge)
                elif side == "left" and edge <= keep[0] and edge > crop[0]:
                    crop = (edge, crop[1], crop[2], crop[3])
                elif side == "right" and edge >= keep[2] and edge < crop[2]:
                    crop = (crop[0], crop[1], edge, crop[3])
                else:
                    continue
                moved = True
                break
            else:
                continue
        if not moved:
            break
    erase = [b for b in text_boxes if _overlaps(crop, b)]
    for b in erase:
        notes.append(f"printed text at {tuple(round(v) for v in b)} pt stands level with the picture inside the crop — whited out")
    return crop, erase, notes

def save_shelf_crop(fz_page, rect: tuple, erase: list[tuple], path: Path) -> tuple[int, int]:
    """The crop, with `erase` (word boxes in page points) painted out in white.
    Ørberg never draws under his type, so a box that holds a gloss holds nothing
    else — painting it out takes the neighbour's words away and leaves the drawing."""
    import fitz
    pix = fz_page.get_pixmap(dpi=CROP_DPI, clip=fitz.Rect(*rect), colorspace="gray", alpha=False)
    img = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    if erase:
        sx = pix.width / max(1e-6, rect[2] - rect[0])
        sy = pix.height / max(1e-6, rect[3] - rect[1])
        d = ImageDraw.Draw(img)
        for b in erase:
            d.rectangle([(b[0] - rect[0] - 0.7) * sx, (b[1] - rect[1] - 0.7) * sy,
                         (b[2] - rect[0] + 0.7) * sx, (b[3] - rect[1] + 0.7) * sy], fill=255)
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    return img.size


def shelf_anchor_row(rect: tuple, zone: str, rows: list, prev_rows: list) -> tuple:
    """The printed line a picture belongs to.  → (row, how, confidence, gap_cm).

    A drawing in the main column stands *above* the text it illustrates — Ørberg
    sets it at a paragraph break — so it takes the first numbered line under it.
    A drawing in the gloss column stands *beside* its word, so it takes the line
    level with it."""
    if not rows:
        if prev_rows:
            return prev_rows[-1], "page has no numbered text; the last line of the page before", "low", None
        return None, "no numbered text anywhere before it", "low", None
    if zone == "main":
        below = [r for r in rows if r.top >= rect[3] - 3]
        if below:
            gap = max(0.0, below[0].top - rect[3]) / CM
            conf = "high" if gap <= 1.6 else ("medium" if gap <= 3.5 else "low")
            return below[0], f"the text under the picture ({gap:.1f} cm below it)", conf, gap
        above = [r for r in rows if r.bottom <= rect[1] + 3]
        if above:
            gap = max(0.0, rect[1] - above[-1].bottom) / CM
            return above[-1], f"nothing under it on the page; the line above ({gap:.1f} cm)", "medium" if gap <= 2.0 else "low", gap
    cy = (rect[1] + rect[3]) / 2
    row = min(rows, key=lambda r: abs(r.mid - cy))
    gap = max(rect[1] - row.mid, row.mid - rect[3], 0) / CM
    conf = "high" if gap <= 0.9 else ("medium" if gap <= 2.5 else "low")
    return row, f"the line level with it ({gap:.1f} cm from its edge)", conf, gap


def _on_line(u: dict, line: int) -> int:
    """How many characters of `u` are printed on line `line` (0 = none)."""
    for k, e in enumerate(u.get("lines") or []):
        if e["line"] == line:
            nxt = u["lines"][k + 1]["start"] if k + 1 < len(u["lines"]) else len(u["la"])
            return nxt - e["start"]
    return 0


def shelf_unit(units: list[dict], line: int, caption: str, zone: str) -> tuple[dict | None, str]:
    """The shelf unit a picture is attached to.  → (unit, how).

    Geometry first — the sentence printed on that line, preferring the one that
    *starts* there for a picture that heads a paragraph.  Then, for a labelled
    picture, the caption's headword decides between the neighbours: Ørberg's
    margin drawings gloss a word, and the word is what the learner is looking
    for (the same stem preference `attach_margins` uses for the glosses)."""
    if not units:
        return None, "no units"
    on = [u for u in units if _on_line(u, line)]
    if on:
        starts = [u for u in on if (u.get("lines") or [{}])[0].get("line") == line]
        target = (starts[0] if (zone == "main" and starts) else max(on, key=lambda u: _on_line(u, line)))
        how = "the sentence printed on that line"
        if zone == "main" and starts:
            how = "the sentence that starts on that line"
    else:
        before = [u for u in units if (u.get("lines") or [{}])[0].get("line", 10 ** 9) <= line]
        target = before[-1] if before else units[0]
        how = "the last sentence starting at or before that line (the line itself is in no unit)"
    stem = gloss_stem(caption) if caption else ""
    if stem and len(stem) >= 3 and not unit_has_stem(target, stem):
        i = next(j for j, u in enumerate(units) if u is target)
        lo, hi = (line - 3, line + 6) if zone == "margin" else (line, line + 4)
        near = {j for j, u in enumerate(units) if any(lo <= e["line"] <= hi for e in (u.get("lines") or []))}
        near |= set(range(max(0, i - 1), min(len(units), i + 2)))
        for j in sorted(near, key=lambda j: (abs(j - i), j)):   # the nearest sentence that uses the word wins
            if unit_has_stem(units[j], stem):
                target = units[j]
                how = f"the sentence near that line using the label's word ({stem}-)"
                break
    return target, how


# --------------------------------------------------------------------------- per-chapter driver

def load_overrides() -> dict:
    p = ROOT / "data" / "pictures-overrides.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def extract_shelf_chapter(c: int, pl_pdf, fz_pdf, pages: list[int], lex, cleaner, overrides: dict, debug: bool) -> dict:
    """One Familia Romana chapter (I–XXIV) → the shelf week's pictures."""
    import review_shelf as rs

    n = SHELF_BASE + c
    data = json.loads((BUILD / f"review-{c:02d}.json").read_text(encoding="utf-8"))
    units = data["units"]
    notes: list[str] = []
    classified, _cut_found = rs.classify_chapter(pl_pdf, pages, notes)
    cuts = {pg["page"]: rs.reading_cut(pl_pdf.pages[pg["page"] - 1]) for pg in classified}
    out_dir = PIC_DIR / f"week-{n}"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.png"):
        old.unlink()
    pics: list[dict] = []
    rep = {"chapter": c, "week": n, "pages": [pg["page"] for pg in classified], "notes": notes,
           "skipped": [], "uncertain": [], "clipped": [], "cleaned": []}
    prev_rows: list = []
    for pg in classified:
        p = pg["page"]
        fz_page, pl_page = fz_pdf[p - 1], pl_pdf.pages[p - 1]
        dbg = (out_dir / f"_debug-p{p}.png") if debug else None
        found, dnotes, vrules = detect_shelf_pictures(fz_page, pl_page, pg, cuts.get(p), dbg)
        rep["skipped"] += [x for x in dnotes if "skipped" in x]
        rep["clipped"] += [x for x in dnotes if "may clip" in x]
        rows = [r for r in pg["main"] if r.line_no is not None]
        text_boxes, free_boxes = word_boxes(pl_page, pg)
        rects = [e["core"] for e in found]
        for k, e in enumerate(found, start=1):
            rect, zone = e["core"], e["zone"]
            pid = f"r{c:02d}/p{p}-{k}"
            ov = overrides.get(pid) or {}
            if ov.get("skip"):
                rep["skipped"].append(f"{pid}: left out by hand (pictures-overrides.json: {ov.get('why', 'skip')})")
                continue
            if ov.get("rect"):
                rect = tuple(float(v) for v in ov["rect"])
            label_rows, lnotes = picture_labels(pl_page, pg, rect, [o for o in rects if o is not e["core"]], "FR",
                                                allow_caps=True, near_pt=14.0)
            kinds = [_row_kind(r) for r in label_rows]
            keep_tails = "word" in kinds          # a tail is kept only beside its headword
            label_rows = [r for r, k in zip(label_rows, kinds)
                          if k == "word" or (k == "tail" and keep_tails)]
            seen_rows = {(round(r.top, 1), round(r.x0, 1)) for r in label_rows}
            ex = ([r for r in explain_row(pg, rect) if (round(r.top, 1), round(r.x0, 1)) not in seen_rows]
                  if e["zone"] == "margin" else [])
            label_rows = label_rows + ex
            caption, raw, probs = caption_from_rows([r for r in label_rows if not _is_caps(r) and r not in ex], "FR", lex)
            caption = restore_capital_i(caption, raw)
            if ex:
                line = explain_text(ex, cleaner)
                caption = f"{caption} · {line}" if caption else line
                joined = " ".join(r.text for r in ex)
                raw = f"{raw} · {joined}" if raw else joined
            if caption and not caption_ok(caption):
                lnotes.append(f"caption dropped as OCR junk: {caption!r} (raw {raw!r})")
                caption = ""
            # the picture's own labels are never foreign text
            mine = {(round(w["x0"], 1), round(w["top"], 1)) for r in label_rows for w in r.words}
            crop, erase, cnotes = clean_crop(rect, label_rows,
                                             [b for b in text_boxes if (round(b[0], 1), round(b[1], 1)) not in mine],
                                             free_boxes, vrules, pg["width"], pg["height"])
            if ov.get("rect"):
                crop, erase, cnotes = rect, [], []
            row, how, conf, _gap = shelf_anchor_row(rect, zone, rows, prev_rows)
            if row is None:
                rep["skipped"].append(f"{pid}: no numbered line anywhere before it — skipped")
                continue
            unit, uhow = shelf_unit(units, row.line_no, caption, zone)
            if unit is None:
                rep["skipped"].append(f"{pid}: chapter has no units — skipped")
                continue
            if "the line itself is in no unit" in uhow and conf == "high":
                conf = "medium"
            if "unit_id" in ov:
                by_id = {u["id"]: u for u in units}
                if ov["unit_id"] in by_id:
                    unit, uhow, conf = by_id[ov["unit_id"]], "set by hand (pictures-overrides.json)", "high"
            fname = f"p{p}-{k}.png"
            width, height = save_shelf_crop(fz_page, crop, erase, out_dir / fname)
            entry = {"id": pid, "file": f"data/build/pictures/week-{n}/{fname}", "page": p,
                     "unit_id": unit["id"], "caption": caption or None, "caption_en": None,
                     "width": width, "height": height, "sort": 0,
                     "_line": row.line_no, "_zone": zone, "_conf": conf,
                     "_how": f"{how}; {uhow}", "_la": unit["la"],
                     "_rect": [round(v, 1) for v in rect], "_crop": [round(v, 1) for v in crop],
                     "_raw": raw, "_notes": lnotes + cnotes}
            for key in ("caption", "caption_en"):
                if key in ov:
                    entry[key] = ov[key]
                    entry["_override"] = True
            pics.append(entry)
            for x in cnotes:
                rep["cleaned" if "whited out" in x else "clipped"].append(f"{pid}: {x}")
            if conf != "high":
                rep["uncertain"].append(f"{pid} (p{p} line {row.line_no} → {unit['id']}, {conf}): {entry['_how']}")
            for note in lnotes:
                if not entry.get("_override"):
                    rep["uncertain"].append(f"{pid}: label — {note}")
            if not entry["caption"]:
                rep["uncertain"].append(f"{pid}: no label in the text layer (a printed one may still be in the crop)")
        if rows:
            prev_rows = rows
    order = {u["id"]: i for i, u in enumerate(units)}
    pics.sort(key=lambda q: (order.get(q["unit_id"], 10 ** 6), q["page"], q["_rect"][1]))
    for i, q in enumerate(pics):
        q["sort"] = i
    return {"week": n, "pictures": pics, "report": rep}


def write_shelf(res: dict) -> None:
    n, pics = res["week"], res["pictures"]
    public = [{k: v for k, v in p.items() if not k.startswith("_")} for p in pics]
    (BUILD / f"pictures-week-{n}.json").write_text(json.dumps(public, ensure_ascii=False, indent=1), encoding="utf-8")
    contact_sheet(pics, PIC_DIR / f"week-{n}" / "_sheet.png")


def shelf_report_section(res: dict) -> str:
    rep, pics = res["report"], res["pictures"]
    c, n = rep["chapter"], rep["week"]
    L = [f"## Chapter {c} (r{c:02d}, week {n})\n",
         f"- pages {rep['pages']}; pictures kept: {len(pics)} "
         f"(main column {sum(1 for p in pics if p['_zone'] == 'main')}, "
         f"gloss column {sum(1 for p in pics if p['_zone'] == 'margin')})",
         f"- placement: " + ", ".join(f"{k} {sum(1 for p in pics if p['_conf'] == k)}" for k in ("high", "medium", "low")),
         f"- contact sheet: `data/build/pictures/week-{n}/_sheet.png`", ""]
    if pics:
        L.append("| id | page | line | zone | unit | conf | caption | anchored sentence |")
        L.append("|---|---|---|---|---|---|---|---|")
        for p in pics:
            la = p["_la"].replace("|", "\\|")
            la = la[:64] + ("…" if len(la) > 64 else "")
            cap = (p["caption"] or "—").replace("|", "\\|") + (" (hand)" if p.get("_override") else "")
            L.append(f"| {p['id']} | {p['page']} | {p['_line']} | {p['_zone']} | `{p['unit_id']}` | {p['_conf']} | {cap} | {la} |")
        L.append("")
    for key, head in (("clipped", "Crops that could not be made clean (override candidates)"),
                      ("cleaned", "Neighbouring text painted out of the crop"),
                      ("uncertain", "Uncertain (check the contact sheet; fix in data/pictures-overrides.json)"),
                      ("skipped", "Not taken")):
        if rep[key]:
            L.append(f"{head}:\n")
            L += [f"- {x}" for x in dict.fromkeys(rep[key])]
            L.append("")
    if rep["notes"]:
        L.append("Layout notes:\n")
        L += [f"- {x}" for x in dict.fromkeys(rep["notes"])]
        L.append("")
    return "\n".join(L) + "\n"


def update_shelf_report(key: str, section: str) -> None:
    path = BUILD / "pictures-SHELF-REPORT.md"
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    head = ("# Review-shelf pictures — Familia Romana I–XXIV\n\n"
            "Generated by `python pipeline/extract_pictures.py shelf`. One section per chapter; the crops and a "
            "contact sheet live in `data/build/pictures/week-1NN/`.\n\n"
            "**Placement.** A drawing in the main column stands above the text it illustrates, so it takes the first "
            "numbered line under it; a drawing in the gloss column stands beside its word, so it takes the line level "
            "with it. The line then names the sentence printed on it (for a main-column picture, the sentence that "
            "*starts* there), and a labelled picture is moved to a neighbouring sentence that uses the label's "
            "headword — Ørberg's margin drawings gloss a word, and that word is what the learner is looking for.\n\n"
            "`conf`: **high** — the anchor line is within 1.6 cm below a main-column picture, or 0.9 cm from a margin "
            "one; **medium** — further, or the line belongs to no sentence; **low** — further still, or a page with "
            "no numbered text.\n\n"
            "**What is left out.** The running head, the page number, the chapter title, the vertical column rule and "
            "the rule under the running head; everything below the GRAMMATICA LATINA / PENSVM heading (the shelf's "
            "text stops there too); and the margin's paradigm and family-tree rules, which are type and rules rather "
            "than drawings. Ørberg's declension and conjugation tables are set entirely in type, so they never reach "
            "the ink mask at all.\n")
    body = path.read_text(encoding="utf-8") if path.exists() else head
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    path.write_text(body, encoding="utf-8")


def run_shelf(chapters: list[int], debug: bool, quiet: bool) -> int:
    import fitz
    import pdfplumber
    import review_shelf as rs

    pl_pdf = pdfplumber.open(str(ROOT / "scans" / em.SCANS["FR"]))
    fz_pdf = fitz.open(str(ROOT / "scans" / em.SCANS["FR"]))
    lex = em.build_lexicon(ROOT, {"FR": pl_pdf}, BUILD / "margins-lexicon.json", quiet=True)
    pages = rs.chapter_pages(pl_pdf)
    # the shelf's own token cleaner, so a caption is spelled like the sentence it stands by
    cleaner = rs.Cleaner(lex, rs.capital_i_forms(pl_pdf), rs.trusted_forms(ROOT))
    overrides = load_overrides()
    total = 0
    for c in chapters:
        res = extract_shelf_chapter(c, pl_pdf, fz_pdf, pages[c], lex, cleaner, overrides, debug)
        write_shelf(res)
        update_shelf_report(f"pictures:r{c:02d}", shelf_report_section(res))
        pics = res["pictures"]
        total += len(pics)
        if not quiet:
            confs = {k: sum(1 for p in pics if p["_conf"] == k) for k in ("high", "medium", "low")}
            print(f"cap. {c:>2} (week {res['week']}): {len(pics):>3} pictures  "
                  f"(high {confs['high']}, medium {confs['medium']}, low {confs['low']})  "
                  f"pages {res['report']['pages'][0]}–{res['report']['pages'][-1]}")
    if not quiet:
        print(f"total: {total} pictures over {len(chapters)} chapters")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="+", help="week numbers, 'all', or 'shelf [chapter …]' for the review shelf (FR I–XXIV)")
    ap.add_argument("--debug", action="store_true", help="save the ink mask with the detected boxes next to the crops")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    if a.weeks[0] == "shelf":
        chapters = [int(x) for x in a.weeks[1:]] or list(range(1, 25))
        bad = [c for c in chapters if not 1 <= c <= 24]
        if bad:
            ap.error(f"shelf chapters must be 1–24: {bad}")
        return run_shelf(chapters, a.debug, a.quiet)
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
