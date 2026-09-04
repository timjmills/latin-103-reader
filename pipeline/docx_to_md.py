#!/usr/bin/env python
"""
docx_to_md.py — the user's Word documents → source/week-NN.md

    python pipeline/docx_to_md.py source/docx/*.docx            # every document
    python pipeline/docx_to_md.py "source/docx/Week 3 *.docx"   # one
    python pipeline/docx_to_md.py source/docx/*.docx --out /tmp/x   # write elsewhere

The week number comes from the file name ("Week 3 Readings - …" → week-03.md).
Output is the Markdown format build_week.py reads, modelled on the hand-made
source/week-01.md (converting the Week 1 document reproduces its 93 units).

What the documents look like (python-docx, style names)
------------------------------------------------------
  Heading 1   "CAPITVLVM VICESIMVM QVINTVM (XXV)"  or  "WEEK 3: PRESENT SUBJUNCTIVE 1"
  Heading 2   chapter title, or in the multi-text weeks the reading:
              "1. FABVLAE SYRAE (Cap. XXVII) — 1. Mīnōs", "3. FABELLAE LATINAE (Cap. XXV)"
  Heading 3/4 "Pars I (Lines 1–41)", "Pars I (Lines 1–58): Dē Lūdīs…",
              "63. Dāvus amīcum suum …", "[Fragmentum: Coriolānus (Lines 137–146)]",
              then "Textus Latīnus" / "Literal English Translation"
  normal      body paragraphs; some weeks carry "[n]" line markers, some do not.
              Verse lines are one paragraph each, indented left+right (w:ind 600/600).
  tables      paradigm tables inside Grammatica — never reading text
  Everything from the first Grammatica / Metrica / Pēnsa heading on is dropped.

What is written
---------------
  # Week 3 — Fabulae Syrae & Fabellae Latīnae: …      title line (from weeks.py)
  ## Pars I (Lines 1–41)                               FR chapters; a subtitle stays:
  ## Pars I: Dē Lūdīs et Certāminibus (Lines 1–58)       ("(Lines …)" always last)
  ## Fabulae Syrae 1: Mīnōs (Lines 1–49)               multi-text weeks, one part per
  ## Fabellae Latīnae 63: Dāvus amīcum suum …            story; FL has no line numbers
  ### Textus Latīnus / ### Literal English Translation
  one paragraph per line, blank line between, text verbatim (quotes, macrons,
  brackets, [n] markers). Verse lines are kept together in one block, each line
  ending in a Markdown hard break "\" — build_week.py treats such a block as verse.

Line ranges for the Fabulae Syrae stories come from the heading when it has
one, else from the "Readings:" list at the top of the document
("Fabulae Syrae, Cap. XXVII: 1. Mīnōs (Lines 1–49)").
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from weeks import BY_N  # noqa: E402

STOP_HEADING = re.compile(r"grammatic|metric|p[ēe]ns(?:a|um|vm)\b|exercise|grammar|vocabul", re.I)
LINES_ANY = re.compile(r"\s*\((?:lines?|ll?\.)\s*([^)]*?)\)", re.I)
AD_CAP = re.compile(r"\s*\(ad\s+cap\.?[^)]*\)", re.I)
READING_LINE = re.compile(r"(?:(\d+)\.\s*)?([^:()]+?)\s*\((?:lines?)\s*([^)]*?)\)", re.I)
FRAGMENT_LINES = re.compile(r"(?:conclusion|end|fragment\w*)\s+of\s+([^,()]+?),\s*lines?\s*([\d–\-]+)", re.I)


def _fold(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def _clean(s: str) -> str:
    """Whitespace only: NBSP → space, tabs → space, collapse runs. Text is otherwise verbatim."""
    s = s.replace(" ", " ").replace("\t", " ")
    return re.sub(r"[ ]{2,}", " ", s).strip()


# --------------------------------------------------------------------------- docx walking

def _heading_level(p: Paragraph) -> int | None:
    m = re.match(r"heading\s*(\d)", p.style.name or "", re.I)
    return int(m.group(1)) if m else None


def _is_verse(p: Paragraph) -> bool:
    """Verse lines are the paragraphs indented on both sides (a block-quote look)."""
    ppr = p._p.pPr
    if ppr is None:
        return False
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        return False
    left = ind.get(qn("w:left")) or ind.get(qn("w:start")) or "0"
    right = ind.get(qn("w:right")) or ind.get(qn("w:end")) or "0"
    try:
        return int(left) > 0 and int(right) > 0
    except ValueError:
        return False


def _para_lines(p: Paragraph) -> list[str]:
    """A paragraph's text as physical lines (w:br inside a paragraph → line)."""
    return [_clean(l) for l in p.text.split("\n") if _clean(l)]


def _is_latin_heading(t: str) -> bool:
    return bool(re.search(r"\btextus\b", t, re.I) or re.fullmatch(r"lat[iī]n(?:\s+text)?", t, re.I))


def _is_english_heading(t: str) -> bool:
    return bool(re.search(r"english|translation", t, re.I)) and not _is_latin_heading(t)


def walk(doc: Document) -> dict:
    """→ {title: [H1, H2], readings: [str], parts: [{heading_path, la: [block], en: [block]}]}
    A block is {"lines": [str], "verse": bool}."""
    out = {"title": [], "readings": [], "parts": []}
    stack: dict[int, str] = {}          # heading level → text
    current = None                      # "la" | "en" | None
    part = None
    seen_textus = False
    stopped = False
    for child in doc.element.body.iterchildren():
        if stopped:
            break
        if child.tag == qn("w:tbl"):
            continue                    # paradigm tables are never reading text
        if child.tag != qn("w:p"):
            continue
        p = Paragraph(child, doc)
        text = _clean(p.text)
        if not text:
            continue
        lvl = _heading_level(p)
        if lvl is not None:
            if STOP_HEADING.search(text) and not (_is_latin_heading(text) or _is_english_heading(text)):
                stopped = True
                break
            if _is_latin_heading(text):
                # the part heading is the nearest heading above the Textus one
                path = [stack[k] for k in sorted(stack) if k < lvl]
                part = {"heading_path": path, "la": [], "en": []}
                out["parts"].append(part)
                current = "la"
                seen_textus = True
            elif _is_english_heading(text) and part is not None:
                current = "en"
            else:
                stack[lvl] = text
                for k in [k for k in stack if k > lvl]:
                    del stack[k]
                current = None
                if not seen_textus and lvl <= 2:
                    out["title"].append(text)
            continue
        if current is None:
            if not seen_textus:
                out["readings"].append(text)
            continue
        blocks = part[current]
        lines = _para_lines(p)
        if _is_verse(p):
            if blocks and blocks[-1]["verse"]:
                blocks[-1]["lines"].extend(lines)
            else:
                blocks.append({"lines": lines, "verse": True})
        else:
            blocks.append({"lines": [" ".join(lines)], "verse": False})
    return out


# --------------------------------------------------------------------------- part headings

def _readings_ranges(readings: list[str]) -> dict[str, str]:
    """'Fabulae Syrae, Cap. XXVII: 1. Mīnōs (Lines 1–49)' → {'minos': '1–49'} (folded title)."""
    ranges = {}
    for r in readings:
        for m in READING_LINE.finditer(r):
            title = m.group(2).split(":")[-1].strip()
            ranges[_fold(title)] = m.group(3).strip()
        for m in FRAGMENT_LINES.finditer(r):
            ranges[_fold(m.group(1))] = m.group(2).strip()
    return ranges


def _range_for(title: str, ranges: dict[str, str]) -> str | None:
    f = _fold(title)
    for k, v in ranges.items():
        if k and (k in f or f in k):
            return v
    return None


def part_heading(path: list[str], ranges: dict[str, str], k: int) -> str:
    """Normalise the heading path of one Latin/English pair to the reference format."""
    last = path[-1] if path else f"Pars {k + 1}"
    lines_m = LINES_ANY.search(last)
    lines = lines_m.group(1).strip() if lines_m else None
    head = LINES_ANY.sub("", last)
    head = re.sub(r"\s+:", ":", head).strip(" :")
    head = re.sub(r"^\[(.*)\]$", r"\1", head).strip()

    ancestors = " ".join(path[:-1])
    is_fs = bool(re.search(r"fab[uv]lae\s+syrae", ancestors + " " + head, re.I))
    is_fl = bool(re.search(r"fabellae", ancestors + " " + head, re.I))

    if re.match(r"^pars\b", head, re.I) or not (is_fs or is_fl):
        return f"{head} (Lines {lines})" if lines else head

    # multi-text: the story title comes from the last heading or after "—" in the reading heading
    story = head
    if re.search(r"fab[uv]lae\s+syrae|fabellae", story, re.I):
        story = story.split("—")[-1].strip() if "—" in story else ""
    story = AD_CAP.sub("", story).strip()
    story = re.sub(r"^fragment\w*\s*:\s*", "", story, flags=re.I)
    num_m = re.match(r"^(\d+)\.\s*(.*)$", story)
    num, title = (num_m.group(1), num_m.group(2).strip()) if num_m else (None, story)
    if is_fl:
        label = "Fabellae Latīnae" + (f" {num}" if num else "")
        return f"{label}: {title}" if title else label
    label = "Fabulae Syrae" + (f" {num}" if num else "")
    if lines is None:
        lines = _range_for(title, ranges)
    h = f"{label}: {title}" if title else label
    return f"{h} (Lines {lines})" if lines else h


# --------------------------------------------------------------------------- rendering

def _block_md(block: dict) -> str:
    if block["verse"]:
        return "\n".join(l + "\\" for l in block["lines"])
    return block["lines"][0]


def title_line(n: int, doc_title: list[str]) -> str:
    w = BY_N.get(n)
    if w is None:
        return f"# Week {n} — " + ": ".join(doc_title)
    if w["source"] == "FS+FL":
        return f"# Week {n} — Fabulae Syrae & Fabellae Latīnae: {w['title']}"
    src = {"FR": "Familia Romana", "FS": "Fabulae Syrae", "FL": "Fabellae Latīnae"}[w["source"]]
    return f"# Week {n} — {src}, Cap. {w['chapter']}: {w['title']}"


def render(n: int, walked: dict) -> tuple[str, list[dict]]:
    ranges = _readings_ranges(walked["readings"])
    L = [title_line(n, walked["title"]), "### Latin text with literal English translation", "", "---", ""]
    for t in walked["title"]:
        L += [t, ""]
    summary = []
    for k, part in enumerate(walked["parts"]):
        heading = part_heading(part["heading_path"], ranges, k)
        L += [f"## {heading}", "", "### Textus Latīnus", ""]
        for b in part["la"]:
            L += [_block_md(b), ""]
        L += ["### Literal English Translation", ""]
        for b in part["en"]:
            L += [_block_md(b), ""]
        L += ["---", ""]
        summary.append({
            "heading": heading, "la": len(part["la"]), "en": len(part["en"]),
            "verse": sum(b["verse"] for b in part["la"]),
            "marked": any(re.match(r"\[\d+\]", b["lines"][0]) for b in part["la"]),
        })
    return "\n".join(L).rstrip() + "\n", summary


def week_number(path: Path) -> int:
    m = re.search(r"week\s*_?(\d+)", path.stem, re.I)
    if not m:
        raise ValueError(f"cannot find a week number in {path.name!r}")
    return int(m.group(1))


def convert(path: Path, out_dir: Path) -> tuple[Path, list[dict]]:
    n = week_number(path)
    walked = walk(Document(str(path)))
    if not walked["parts"]:
        raise ValueError(f"{path.name}: no 'Textus Latīnus' heading found")
    md, summary = render(n, walked)
    out = out_dir / f"week-{n:02d}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    return out, summary


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("docx", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=ROOT / "source", help="output directory (default: source/)")
    a = ap.parse_args(argv)
    paths = []
    for p in a.docx:                       # Windows shells do not expand globs
        paths += sorted(Path(p.parent).glob(p.name)) if any(c in str(p) for c in "*?") else [p]
    rc = 0
    for p in sorted(paths, key=lambda q: week_number(q)):
        try:
            out, summary = convert(p, a.out)
        except Exception as e:  # report and go on with the rest
            print(f"{p.name}: ERROR {e}", file=sys.stderr)
            rc = 1
            continue
        print(f"{p.name} -> {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
        for s in summary:
            extra = (" [n]" if s["marked"] else "") + (f", {s['verse']} verse block(s)" if s["verse"] else "")
            flag = "" if s["la"] == s["en"] else "   <-- paragraph counts differ"
            print(f"    {s['heading']}: {s['la']} Latin / {s['en']} English paragraphs{extra}{flag}")
    return rc


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
