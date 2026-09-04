#!/usr/bin/env python
"""
attach_margins.py — put the scan-derived line numbers and marginal glosses
into the week JSON.

    python pipeline/attach_margins.py            # every week whose data/build/week-NN.json exists
    python pipeline/attach_margins.py 1 7        # selected weeks
    python pipeline/attach_margins.py --check    # report only, write nothing

Inputs (data/build/)
  week-NN.json         built by build_week.py (units with la / line_no / block_start)
  lines-week-NN.json   every printed line of the reading with its text  (extract_margins.py)
  margin-week-NN.json  the glosses, each with its book line (or an FL text anchor)

What it does, per week
  1. Every unit is located in the printed lines by its first words (fuzzy:
     macron-, case- and punctuation-insensitive, monotonic through the text).
  2. Block-start units whose `line_no` is null get the line their block starts
     on; the other units of the block get the same number (CONTRACT: line_no is
     the block's start line).  Existing line_no values are never changed — they
     are compared with the recovered ones and the agreement is reported (this
     is the Week 1 validation).
  3. Each gloss is attached to the unit that is printed on its line: the last
     unit of the covering block whose own start line is <= the gloss line.  FL
     glosses (no line numbers) are attached to the unit whose Latin contains
     the anchor words.
  4. `margin: []` is added to every unit that has none; the file is rewritten
     in place after a copy to week-NN.json.bak.  Re-running is safe: margins
     are rebuilt from scratch each time and line_no is only ever filled in.

Everything unmatched goes to data/build/margins-REPORT.md (section
"Week NN — attachment") and to stdout.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent


# --------------------------------------------------------------------------- text utils

def strip_macrons(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def toks(s: str) -> list[str]:
    """Macron-free, lower-case, letters-only word tokens."""
    return [t.replace("v", "u").replace("j", "i") for t in re.findall(r"[a-z]+", strip_macrons(s or "").lower()) if t]


def slug_of(unit_id: str) -> str | None:
    parts = unit_id.split(":")
    return parts[1] if len(parts) == 3 else None


# --------------------------------------------------------------------------- matching

class LineIndex:
    """Token stream of the printed lines of one text (part), with line lookup."""

    def __init__(self, lines: list[dict]):
        self.lines = lines
        self.words: list[str] = []
        self.line_of: list[int] = []  # token index → line number
        for e in lines:
            for t in toks(e["text"]):
                self.words.append(t)
                self.line_of.append(e["line"])

    def find(self, want: list[str], cursor: int, need: int) -> tuple[int, int] | None:
        """First position >= cursor where >= `need` of `want` match in order. → (pos, score)"""
        n = len(self.words)
        if not want:
            return None
        for pos in range(cursor, n):
            score = 0
            for j, w in enumerate(want):
                if pos + j < n and self.words[pos + j] == w:
                    score += 1
                else:
                    break
            if score >= need:
                return pos, score
        return None


def locate_units(units: list[dict], index_by_slug: dict[str | None, LineIndex], n_tokens: int = 5) -> dict[str, dict]:
    """→ {unit id: {line, score, pos}} for every FR/FS unit that could be found."""
    out: dict[str, dict] = {}
    cursors: dict[str | None, int] = {}
    for u in units:
        if u.get("source") == "FL":
            continue
        idx = index_by_slug.get(slug_of(u["id"])) or index_by_slug.get(None)
        if idx is None:
            continue
        key = slug_of(u["id"]) if slug_of(u["id"]) in index_by_slug else None
        cur = cursors.get(key, 0)
        want = toks(u["la"])[:n_tokens]
        need = 3 if len(want) >= 3 else len(want)
        hit = idx.find(want, cur, need)
        if hit is None and len(want) >= 2:
            hit = idx.find(want[:2], cur, 2)  # weaker: first two words only
        for skip in (1, 2):  # first word(s) garbled in the scan
            if hit is None and len(want) >= skip + 3:
                hit = idx.find(want[skip:], cur, 3)
        if hit is None:
            continue
        pos, score = hit
        out[u["id"]] = {"line": idx.line_of[pos], "score": score, "pos": pos}
        cursors[key] = pos + 1
    return out


def blocks_of(units: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    for u in units:
        if u.get("block_start") or not out:
            out.append([u])
        else:
            out[-1].append(u)
    return out


# --------------------------------------------------------------------------- per week

def process_week(n: int, root: Path, check: bool = False) -> dict | None:
    build = root / "data" / "build"
    week_path = build / f"week-{n:02d}.json"
    if not week_path.exists():
        return None
    data = json.loads(week_path.read_text(encoding="utf-8"))
    units = data["units"]
    lines_path = build / f"lines-week-{n:02d}.json"
    margin_path = build / f"margin-week-{n:02d}.json"
    lines = json.loads(lines_path.read_text(encoding="utf-8")) if lines_path.exists() else []
    margins = json.loads(margin_path.read_text(encoding="utf-8")) if margin_path.exists() else []
    rep = {"week": n, "units": len(units), "lines": len(lines), "glosses": len(margins),
           "filled": 0, "unmatched_blocks": [], "agree": 0, "disagree": [], "compared": 0,
           "attached": 0, "unattached": [], "fl_attached": 0, "located": 0, "notes": []}
    if not lines_path.exists():
        rep["notes"].append(f"{lines_path.name} missing — run extract_margins.py {n}; line numbers not recovered")
    if not margin_path.exists():
        rep["notes"].append(f"{margin_path.name} missing — run extract_margins.py {n}; no glosses attached")

    # 1. locate units
    by_slug: dict[str | None, list[dict]] = {}
    for e in lines:
        by_slug.setdefault(e.get("part"), []).append(e)
    index_by_slug = {k: LineIndex(v) for k, v in by_slug.items()}
    loc = locate_units(units, index_by_slug) if lines else {}
    rep["located"] = len(loc)

    # 2. line_no for blocks
    blocks = blocks_of(units)
    for b in blocks:
        first = b[0]
        if first.get("source") == "FL":
            continue
        found = loc.get(first["id"])
        if first.get("line_no") is not None:
            if found:
                rep["compared"] += 1
                if found["line"] == first["line_no"]:
                    rep["agree"] += 1
                else:
                    rep["disagree"].append((first["id"], first["line_no"], found["line"], " ".join(first["la"].split()[:6])))
            continue
        if not found:
            if lines:
                rep["unmatched_blocks"].append((first["id"], " ".join(first["la"].split()[:6])))
            continue
        for u in b:
            u["line_no"] = found["line"]
        rep["filled"] += 1

    # 3. glosses
    for u in units:
        u["margin"] = []
    # block cover: (slug, start line) → block, sorted
    cover: dict[str | None, list[tuple[int, list[dict]]]] = {}
    for b in blocks:
        first = b[0]
        if first.get("source") == "FL" or first.get("line_no") is None:
            continue
        cover.setdefault(slug_of(first["id"]), []).append((first["line_no"], b))
    for k in cover:
        cover[k].sort(key=lambda t: t[0])

    fl_units = [u for u in units if u.get("source") == "FL"]
    fl_toks = [(u, toks(u["la"])) for u in fl_units]

    for g in margins:
        entry = {"line": g.get("line"), "la": g["la"]}
        if g.get("en"):
            entry["en"] = g["en"]
        if g.get("line") is None:
            # FL: anchor words → unit whose Latin contains them
            want = toks(g.get("anchor", ""))
            target = None
            for need in (min(4, len(want)), 3, 2):
                if need <= 0 or need > len(want):
                    continue
                for u, tt in fl_toks:
                    for pos in range(len(tt) - need + 1):
                        if tt[pos:pos + need] == want[:need]:
                            target = u
                            break
                    if target:
                        break
                if target:
                    break
            if target is None:
                rep["unattached"].append(f"FL anchor {g.get('anchor')!r}: {g['la']}")
                continue
            target["margin"].append(entry)
            rep["fl_attached"] += 1
            continue
        L = g["line"]
        # which part? try every slug whose lines cover L, preferring one whose block range contains L
        candidates = []
        for slug, lst in cover.items():
            before = [(s, b) for s, b in lst if s <= L]
            if before:
                candidates.append((before[-1][0], slug, before[-1][1]))
        if not candidates:
            rep["unattached"].append(f"line {L}: no block starts at or before it — {g['la']}")
            continue
        candidates.sort(key=lambda t: -t[0])
        _, slug, block = candidates[0]
        # the unit printed on that line: last unit of the block whose own start line <= L
        target = block[0]
        for u in block:
            f = loc.get(u["id"])
            if f and f["line"] <= L:
                target = u
        target["margin"].append(entry)
        rep["attached"] += 1

    if not check:
        shutil.copyfile(week_path, week_path.with_suffix(".json.bak"))
        week_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return rep


def report_section(rep: dict) -> str:
    n = rep["week"]
    L = [f"## Week {n:02d} — attachment\n"]
    L.append(f"- units: {rep['units']}, printed lines: {rep['lines']}, glosses: {rep['glosses']}")
    L.append(f"- units located in the scan: {rep['located']}; block line numbers filled: {rep['filled']}")
    if rep["compared"]:
        pct = 100.0 * rep["agree"] / rep["compared"]
        L.append(f"- validation against existing line numbers: {rep['agree']}/{rep['compared']} blocks agree ({pct:.0f}%)")
        for uid, have, got, words in rep["disagree"]:
            L.append(f"  - {uid}: document says {have}, scan says {got} — {words}")
    L.append(f"- glosses attached: {rep['attached']} by line" + (f", {rep['fl_attached']} by FL anchor" if rep["fl_attached"] else ""))
    for x in rep["notes"]:
        L.append(f"- {x}")
    if rep["unmatched_blocks"]:
        L.append(f"\nBlocks whose start line could not be found in the scan ({len(rep['unmatched_blocks'])}):\n")
        L += [f"- {uid}: {words}" for uid, words in rep["unmatched_blocks"]]
    if rep["unattached"]:
        L.append(f"\nGlosses not attached ({len(rep['unattached'])}):\n")
        L += [f"- {x}" for x in rep["unattached"]]
    L.append("")
    return "\n".join(L) + "\n"


def update_report(root: Path, key: str, section: str) -> None:
    path = root / "data" / "build" / "margins-REPORT.md"
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    body = path.read_text(encoding="utf-8") if path.exists() else "# Margin notes — extraction & attachment report\n\n"
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    path.write_text(body, encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="*", type=int)
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--check", action="store_true", help="report only; do not write week JSON")
    a = ap.parse_args(argv)
    root = a.root.resolve()
    weeks = a.weeks or list(range(1, 15))
    rc = 0
    for n in weeks:
        rep = process_week(n, root, check=a.check)
        if rep is None:
            print(f"week {n:02d}: data/build/week-{n:02d}.json not found — skipped")
            continue
        update_report(root, f"attach:w{n:02d}", report_section(rep))
        val = f", validation {rep['agree']}/{rep['compared']}" if rep["compared"] else ""
        print(f"week {n:02d}: {rep['located']}/{rep['units']} units located, {rep['filled']} blocks numbered, "
              f"{len(rep['unmatched_blocks'])} blocks unmatched{val}; glosses attached {rep['attached'] + rep['fl_attached']}"
              f"/{rep['glosses']}" + (" (check only)" if a.check else ""))
        for x in rep["notes"]:
            print("   note:", x)
    return rc


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
