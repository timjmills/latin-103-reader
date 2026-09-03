#!/usr/bin/env python
"""
recover_lines.py — propose textbook line numbers for a week whose document has
no [n] markers, from the text layer of the scan.

    python pipeline/recover_lines.py 7                  # scans/Week-07-*.pdf → data/build/week-07.lines.md + .lines.json
    python pipeline/recover_lines.py 7 --pdf my.pdf     # explicit PDF(s); repeatable
    python pipeline/recover_lines.py 7 --apply          # write the (reviewed) proposals into data/build/week-07.json
    python pipeline/recover_lines.py --selftest         # build a synthetic PDF and check the matcher on it

Workflow
--------
1. Build the week first (python pipeline/build_week.py 7) so data/build/week-07.json exists.
2. Run this tool. It reads the scan's text layer with pypdf, finds the marginal
   line numbers (Familia Romana prints them on odd pages, every 5th line),
   assigns a line number to every physical text line, then looks for the first
   words of each block of the week's units in that text and proposes the line
   on which each block starts.
3. Read data/build/week-07.lines.md. Every row shows the block, its first words,
   the proposed line, the page and the physical line it matched, and a
   confidence. Edit data/build/week-07.lines.json (change or delete `line_no`
   values) for anything wrong.
4. python pipeline/recover_lines.py 7 --apply  writes `line_no` into every unit
   of each block. Unit ids stay block-based ("w07:b3.2") so that notes and
   highlights keyed to them survive; only `line_no` changes.

How the line numbering works
----------------------------
* pypdf `extract_text(extraction_mode="layout")` keeps the marginal number on
  the same physical line as the text it belongs to. A line whose first or last
  token is a multiple of 5 (`--step`) is an anchor.
* Anchors must increase through the document; a number that breaks the
  sequence (a page number, a footnote, a year) is ignored.
* On a page with anchors, every text line gets  anchor + (distance in text
  lines). Between two anchors the count is checked: if 5 lines apart hold
  other than 4 text lines the page is flagged as "drift" (a header, running
  title or hyphenation artefact was counted as text).
* On a page without anchors (even pages), numbering continues from the last
  line of the previous page — confidence "low". The next anchored page
  re-anchors; a discrepancy is reported.
* Lines that look like running heads or page numbers (all-caps short lines,
  bare integers that are not anchors, "CAP. XXV" …) are skipped.

Matching: each block's first five word tokens (macron-stripped, lower-cased,
letters only) are searched for in the token stream, left to right, never going
backwards. Confidence: "high" = 4–5 tokens matched, "medium" = 3, "low" = 2
or a line number that was only extrapolated. Unmatched blocks are listed.

Limitations (read before trusting a number)
-------------------------------------------
* Best effort. Every proposal must be reviewed by eye against the book.
* The text layer of a scan is OCR: macron vowels may come out as odd glyphs,
  ligatures may be lost, words may be split at line ends with a hyphen. The
  matcher only needs 2–5 tokens, but a block whose first words are garbled
  will be unmatched or matched to a later repetition of the same words.
* Fabulae Syrae numbers lines the same way; Fabellae Latinae have no line
  numbers at all — do not run this on FL parts (they are skipped when the
  unit's source is "FL").
* Even-page lines are counted, not read from the book; an unnoticed running
  head shifts them by one until the next anchor. The report flags drift.
* Verse: each verse line is its own unit; proposals are only made for block
  starts (the first line of the poem). Later lines are not numbered here.
* The synthetic self-test uses ASCII Latin because the built-in Helvetica font
  cannot encode macrons; it exercises the pipeline, not OCR quality.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import unicodedata
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))


# --------------------------------------------------------------------------- text utils

def strip_macrons(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def tokens(s: str) -> list[str]:
    """Word tokens for matching: macron-free, lower-case, letters only."""
    return [t for t in re.findall(r"[a-z]+", strip_macrons(s).lower()) if t]


# --------------------------------------------------------------------------- PDF text layer

def extract_pages(pdf_path: Path) -> list[list[str]]:
    """Physical lines per page. Layout mode keeps the margin number on its line."""
    from pypdf import PdfReader
    reader = PdfReader(str(pdf_path))
    pages = []
    for page in reader.pages:
        try:
            text = page.extract_text(extraction_mode="layout")
        except Exception:  # pragma: no cover - older pypdf
            text = page.extract_text()
        if not text or not text.strip():
            text = page.extract_text() or ""
        pages.append([l.rstrip() for l in text.split("\n") if l.strip()])
    return pages


_HEAD_RE = re.compile(r"^\s*(?:CAP(?:ITVLVM|\.)?\s+[IVXLC]+|[IVXLC]+\s*\.?|[A-ZÆŒ .'-]{2,40}|\d{1,3})\s*$")


def looks_like_running_head(line: str, step: int) -> bool:
    s = line.strip()
    if re.fullmatch(r"\d{1,3}", s):
        return int(s) % step != 0  # bare page number (anchors are handled separately)
    return bool(_HEAD_RE.match(s)) and len(tokens(s)) <= 4


class PLine:
    __slots__ = ("page", "idx", "text", "line_no", "conf", "anchor")

    def __init__(self, page, idx, text):
        self.page, self.idx, self.text = page, idx, text
        self.line_no: int | None = None
        self.conf = "none"
        self.anchor: int | None = None


def _split_anchor(line: str, step: int, max_no: int) -> tuple[int | None, str]:
    """→ (anchor number, text without it) when the line carries a margin number."""
    m = re.match(r"^\s*(\d{1,3})\s+(.*\S)\s*$", line) or re.match(r"^\s*(\d{1,3})\s*$", line)
    if m:
        n = int(m.group(1))
        if n % step == 0 and 0 < n <= max_no:
            return n, (m.group(2) if m.lastindex and m.lastindex >= 2 else "")
    m = re.match(r"^\s*(.*\S)\s{2,}(\d{1,3})\s*$", line)
    if m:
        n = int(m.group(2))
        if n % step == 0 and 0 < n <= max_no:
            return n, m.group(1)
    return None, line


def number_lines(pages: list[list[str]], step: int = 5, max_no: int = 400) -> tuple[list[PLine], list[str]]:
    """Assign a textbook line number to every physical text line. → (lines, notes)."""
    notes: list[str] = []
    plines: list[PLine] = []
    last_anchor = 0
    # pass 1: collect text lines and anchors (monotonic)
    for p, lines in enumerate(pages):
        for i, raw in enumerate(lines):
            n, text = _split_anchor(raw, step, max_no)
            if n is not None and not (last_anchor < n <= last_anchor + 12 * step):
                notes.append(f"page {p + 1}: number {n} ignored (out of sequence after {last_anchor})")
                n = None
                text = raw
            if n is None and looks_like_running_head(text, step):
                continue
            if not text.strip():
                # a bare margin number on its own line: attach it to the next text line
                pending = n
                if n is not None and i + 1 < len(lines):
                    pl = PLine(p, i + 1, lines[i + 1])
                    pl.anchor = pending
                    last_anchor = pending
                    plines.append(pl)
                    lines[i + 1] = ""  # consumed
                continue
            pl = PLine(p, i, text)
            if n is not None:
                pl.anchor = n
                last_anchor = n
            plines.append(pl)
    # pass 2: number per page from anchors; else extrapolate
    prev_last: int | None = None
    for p in range(len(pages)):
        page_lines = [pl for pl in plines if pl.page == p]
        if not page_lines:
            continue
        anchors = [(k, pl.anchor) for k, pl in enumerate(page_lines) if pl.anchor is not None]
        if anchors:
            # drift check between consecutive anchors
            for (k1, n1), (k2, n2) in zip(anchors, anchors[1:]):
                if (k2 - k1) != (n2 - n1):
                    notes.append(f"page {p + 1}: {k2 - k1} text lines between margin numbers {n1} and {n2} "
                                 f"(expected {n2 - n1}) — numbers near there are approximate")
            if prev_last is not None:
                k0, n0 = anchors[0]
                expected = prev_last + 1 + k0
                if expected != n0:
                    notes.append(f"page {p + 1}: extrapolation from the previous page predicted line {expected} "
                                 f"for margin number {n0}; re-anchored (previous page may be off by {n0 - expected})")
            for k, pl in enumerate(page_lines):
                # nearest anchor, preferring the last one at or before k
                before = [(ka, na) for ka, na in anchors if ka <= k]
                ka, na = before[-1] if before else anchors[0]
                pl.line_no = na + (k - ka)
                pl.conf = "high" if abs(k - ka) <= step else "medium"
        else:
            if prev_last is None:
                notes.append(f"page {p + 1}: no margin numbers and nothing before it — lines unnumbered")
                continue
            for k, pl in enumerate(page_lines):
                pl.line_no = prev_last + 1 + k
                pl.conf = "low"
        prev_last = page_lines[-1].line_no
    return plines, notes


# --------------------------------------------------------------------------- matching

def blocks_of(units: list[dict]) -> list[dict]:
    """Group a week's units into blocks by block_start. → [{first_unit, units}]"""
    out = []
    for u in units:
        if u.get("block_start") or not out:
            out.append({"first": u, "units": [u]})
        else:
            out[-1]["units"].append(u)
    return out


def match_blocks(units: list[dict], plines: list[PLine], n_tokens: int = 5) -> list[dict]:
    stream: list[tuple[str, int]] = []
    for li, pl in enumerate(plines):
        stream += [(t, li) for t in tokens(pl.text)]
    words = [t for t, _ in stream]
    cursor = 0
    proposals = []
    for b in blocks_of(units):
        u = b["first"]
        want = tokens(u["la"])[:n_tokens]
        prop = {"id": u["id"], "first_words": " ".join(u["la"].split()[:6]), "line_no": None,
                "page": None, "matched": None, "confidence": "none", "score": 0, "units": len(b["units"])}
        if u.get("source") == "FL" or not want:
            prop["confidence"] = "skipped"
            proposals.append(prop)
            continue
        need = min(3, len(want))
        best = None
        for pos in range(cursor, len(words) - len(want) + 1 if len(words) >= len(want) else 0):
            score = 0
            for j, w in enumerate(want):
                if words[pos + j] == w:
                    score += 1
                else:
                    break
            if score >= need:
                best = (pos, score)
                break
        if best is None:  # weaker: two tokens, in case the third is OCR-garbled
            for pos in range(cursor, len(words) - 1):
                if len(want) >= 2 and words[pos] == want[0] and words[pos + 1] == want[1]:
                    best = (pos, 2)
                    break
        if best is not None:
            pos, score = best
            pl = plines[stream[pos][1]]
            prop.update(line_no=pl.line_no, page=pl.page + 1, matched=pl.text.strip(), score=score)
            conf = "high" if score >= 4 or score == len(want) else ("medium" if score == 3 else "low")
            if pl.conf == "low":
                conf = "low"
            prop["confidence"] = conf
            cursor = pos + 1
        proposals.append(prop)
    return proposals


# --------------------------------------------------------------------------- output

def render_proposals(n: int, pdfs: list[Path], proposals: list[dict], notes: list[str]) -> str:
    L = [f"# Week {n:02d} — line-number proposals (review before --apply)\n"]
    L.append("Source scan(s): " + ", ".join(f"`{p.name}`" for p in pdfs) + "  ")
    matched = sum(1 for p in proposals if p["line_no"] is not None)
    L.append(f"Blocks: {len(proposals)} · proposed: {matched} · unmatched: "
             f"{sum(1 for p in proposals if p['confidence'] == 'none')} · skipped (no line numbers in source): "
             f"{sum(1 for p in proposals if p['confidence'] == 'skipped')}\n")
    L.append("Edit `line_no` in the sibling `.lines.json` for anything wrong, delete the row to leave a block "
             "unnumbered, then run `python pipeline/recover_lines.py " + str(n) + " --apply`.\n")
    if notes:
        L.append("## Numbering notes\n")
        L += [f"- {x}" for x in notes]
        L.append("")
    L.append("| block (first unit) | first words | proposed line | page | matched physical line | confidence |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for p in proposals:
        L.append(f"| {p['id']} | {p['first_words']} | {p['line_no'] if p['line_no'] is not None else '—'} | "
                 f"{p['page'] or '—'} | {(p['matched'] or '').replace('|', '\\|')} | {p['confidence']} |")
    L.append("")
    return "\n".join(L) + "\n"


def apply_proposals(week_json: Path, proposals: list[dict]) -> int:
    """Write line_no into every unit of each proposed block. Ids unchanged. → blocks applied."""
    data = json.loads(week_json.read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in proposals if p.get("line_no") is not None}
    applied = 0
    for b in blocks_of(data["units"]):
        p = by_id.get(b["first"]["id"])
        if p is None:
            continue
        for u in b["units"]:
            u["line_no"] = int(p["line_no"])
        applied += 1
    week_json.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return applied


def find_scans(n: int, root: Path) -> list[Path]:
    return sorted((root / "scans").glob(f"Week-{n:02d}-*.pdf")) + sorted((root / "scans").glob(f"Week-{n}-*.pdf"))


def run(n: int, root: Path, pdfs: list[Path] | None = None, apply: bool = False, step: int = 5, quiet=False) -> int:
    build = root / "data" / "build"
    week_json = build / f"week-{n:02d}.json"
    if not week_json.exists():
        print(f"{week_json} not found — run  python pipeline/build_week.py {n}  first", file=sys.stderr)
        return 1
    md_out = build / f"week-{n:02d}.lines.md"
    js_out = build / f"week-{n:02d}.lines.json"
    if apply and js_out.exists():
        proposals = json.loads(js_out.read_text(encoding="utf-8"))["proposals"]
        applied = apply_proposals(week_json, proposals)
        if not quiet:
            print(f"week {n:02d}: line_no applied to {applied} block(s) from {js_out.name}")
        return 0
    pdfs = pdfs or find_scans(n, root)
    if not pdfs:
        print(f"no scans/Week-{n:02d}-*.pdf found (pass --pdf)", file=sys.stderr)
        return 1
    pages: list[list[str]] = []
    for p in pdfs:
        pages += extract_pages(p)
    plines, notes = number_lines(pages, step=step)
    units = json.loads(week_json.read_text(encoding="utf-8"))["units"]
    proposals = match_blocks(units, plines)
    md_out.write_text(render_proposals(n, pdfs, proposals, notes), encoding="utf-8")
    js_out.write_text(json.dumps({"week": n, "pdfs": [str(p) for p in pdfs], "proposals": proposals},
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    if not quiet:
        matched = sum(1 for p in proposals if p["line_no"] is not None)
        print(f"week {n:02d}: {matched}/{len(proposals)} blocks matched -> {md_out.relative_to(root)}")
    if apply:
        applied = apply_proposals(week_json, proposals)
        if not quiet:
            print(f"week {n:02d}: line_no applied to {applied} block(s)")
    return 0


# --------------------------------------------------------------------------- synthetic PDF + self-test

def make_synthetic_pdf(path: Path, pages: list[dict], step: int = 5) -> None:
    """Write a PDF with pypdf's low-level objects (no reportlab). Each page dict:
    {"lines": [...ASCII text lines...], "first_line_no": int, "numbered": bool,
     "head": str | None, "page_no": int | None}. Numbered pages print the margin
    number next to every line whose textbook number is a multiple of `step`."""
    from pypdf import PdfWriter
    from pypdf.generic import ArrayObject, DictionaryObject, NameObject, StreamObject

    w = PdfWriter()
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    fref = w._add_object(font)
    for pg in pages:
        page = w.add_blank_page(width=420, height=600)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): fref})})
        ops = ["BT", "/F1 11 Tf"]
        y = 560
        if pg.get("head"):
            ops.append(f"1 0 0 1 150 {y} Tm ({pg['head']}) Tj")
            y -= 24
        for i, t in enumerate(pg["lines"]):
            n = pg["first_line_no"] + i
            if pg.get("numbered") and n % step == 0:
                ops.append(f"1 0 0 1 20 {y} Tm ({n}) Tj")
            ops.append(f"1 0 0 1 60 {y} Tm ({t}) Tj")
            y -= 14
        if pg.get("page_no") is not None:
            ops.append(f"1 0 0 1 200 30 Tm ({pg['page_no']}) Tj")
        ops.append("ET")
        cs = StreamObject()
        cs.set_data("\n".join(ops).encode("latin-1"))
        page[NameObject("/Contents")] = w._add_object(cs)
    with open(path, "wb") as fh:
        w.write(fh)


_SELFTEST_TEXT = [  # 32 textbook lines of original ASCII Latin, wrapped like a page
    "Marcus in horto ambulat et rosas", "videt. Iulia quoque in horto est,", "sed rosas non carpit. Pater ad",
    "villam venit et liberos vocat.", "Omnes ad villam currunt laeti.", "Cena parata est; mater ridet.",
    "Post cenam liberi in cubiculum", "eunt et mox dormiunt. Nox est.", "Mane sol oritur et aves cantant.",
    "Iulia e lecto surgit et fenestram", "aperit. Marcus adhuc dormit.", "Pater servos in agros mittit.",
    "Servi laborant, dominus spectat.", "Meridie omnes quiescunt sub arbore.", "Vesperi mercator ad villam venit.",
    "Mercator gemmas pulchras ostendit.", "Mater gemmam emit, pater solvit.", "Marcus et Iulia gemmam mirantur.",
    "Nocte luna in caelo lucet clara.", "Canis in horto latrat; nemo audit.", "Postridie pluit et nemo exit.",
    "Liberi in atrio ludunt et rident.", "Magister venit et pueros docet.", "Discipuli litteras discunt.",
    "Tandem pluvia desinit et sol", "iterum lucet. Omnes in hortum", "exeunt et flores spectant.",
    "Sic dies in villa finitur.", "Cras iterum sol orietur.", "Marcus id sperat et dormit.",
    "Iulia autem diu vigilat.", "Tandem et illa dormit.",
]


def selftest(tmp: Path, step: int = 5) -> dict:
    """Generate a two-page numbered scan + a matching unmarked week build, run the
    matcher, and compare with the known block starts. → result dict."""
    import build_week as bw

    tmp = Path(tmp)
    (tmp / "scans").mkdir(parents=True, exist_ok=True)
    pdf = tmp / "scans" / "Week-07-test.pdf"
    # three pages like the book: odd pages carry margin numbers, the even page does not
    make_synthetic_pdf(pdf, [
        {"lines": _SELFTEST_TEXT[:12], "first_line_no": 1, "numbered": True, "head": "CAP. XXIX", "page_no": 221},
        {"lines": _SELFTEST_TEXT[12:22], "first_line_no": 13, "numbered": False, "head": "NAVIGARE NECESSE EST", "page_no": 222},
        {"lines": _SELFTEST_TEXT[22:], "first_line_no": 23, "numbered": True, "head": "CAP. XXIX", "page_no": 223},
    ], step=step)

    # Blocks of the "document": start lines 1, 9, 15, 21, 25 (15 and 21 are on the unnumbered page)
    starts = {1: (0, 8), 9: (8, 14), 15: (14, 20), 21: (20, 24), 25: (24, 32)}
    la_paras, en_paras = [], []
    for s, (a, b) in starts.items():
        la_paras.append(" ".join(_SELFTEST_TEXT[a:b]))
        en_paras.append("English for lines %d ff." % s)
    md = "## Pars I\n### Textus Latinus\n" + "\n\n".join(la_paras) + "\n### Literal English Translation\n" + "\n\n".join(en_paras) + "\n"
    (tmp / "source").mkdir(exist_ok=True)
    (tmp / "source" / "week-07.md").write_text(md, encoding="utf-8")
    bw.build_week_file(7, tmp, quiet=True)
    units = json.loads((tmp / "data" / "build" / "week-07.json").read_text(encoding="utf-8"))["units"]
    # one-English-sentence-per-paragraph on purpose: mismatches are irrelevant here

    pages = extract_pages(pdf)
    plines, notes = number_lines(pages, step=step)
    markers = [pl.anchor for pl in plines if pl.anchor is not None]
    proposals = match_blocks(units, plines)
    expected = {b["first"]["id"]: s for b, s in zip(blocks_of(units), starts)}
    proposed = {p["id"]: p["line_no"] for p in proposals}
    (tmp / "data" / "build" / "week-07.lines.md").write_text(render_proposals(7, [pdf], proposals, notes), encoding="utf-8")
    return {"ok": proposed == expected, "markers": markers, "expected": expected, "proposed": proposed,
            "proposals": proposals, "notes": notes, "pdf": str(pdf)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("week", nargs="?", type=int, help="week number 1–14")
    ap.add_argument("--pdf", type=Path, action="append", help="scan PDF (repeatable); default scans/Week-NN-*.pdf")
    ap.add_argument("--apply", action="store_true", help="write proposals (from .lines.json if present) into week-NN.json")
    ap.add_argument("--step", type=int, default=5, help="margin numbers every N lines (default 5)")
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--selftest", action="store_true", help="synthetic PDF round-trip in a temp folder")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            r = selftest(Path(d), step=a.step)
            print("markers:", r["markers"])
            for pid, ln in r["proposed"].items():
                print(f"  {pid:<12} proposed {ln!s:>4}  expected {r['expected'][pid]}")
            for note in r["notes"]:
                print("  note:", note)
            print("SELFTEST", "OK" if r["ok"] else "FAILED")
            return 0 if r["ok"] else 1
    if a.week is None:
        ap.error("week number required (or --selftest)")
    return run(a.week, a.root.resolve(), pdfs=a.pdf, apply=a.apply, step=a.step, quiet=a.quiet)


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
