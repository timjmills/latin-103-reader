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
  4. `lines` is computed for every unit: where each printed line begins inside
     the sentence, `[{line, start}]` (CONTRACT "Book lines").  Per block the
     units' Latin is tokenised (macron-/case-/punctuation-insensitive, v→u,
     j→i) and the printed lines are walked from the block's first line, each
     line consuming a contiguous run of block tokens (a garbled token here and
     there is tolerated; lines that do not match at all — OCR remnants of a
     hyphenated word, headings — are skipped).  FL units and units the walk
     cannot place get `lines: []`.
  5. `margin: []` is added to every unit that has none; the file is rewritten
     in place after a copy to week-NN.json.bak.  Re-running is safe: margins
     are rebuilt from scratch each time and line_no is only ever filled in.

Everything unmatched goes to data/build/margins-REPORT.md (section
"Week NN — attachment") and to stdout.
"""
from __future__ import annotations

import argparse
import difflib
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


_ENDINGS = ("ibus", "orum", "arum", "ium", "ius", "us", "um", "ae", "is", "es", "em", "os", "as", "am", "ur", "o", "i", "e", "a")


def gloss_stem(la: str) -> str:
    """The searchable stem of a gloss's headword: 'agnus -ī m = parvula ovis' → 'agn',
    'forte = nesciō cūr' → 'fort', 'immortālēs -ium m pl' → 'immortal'. '' when too short."""
    head = re.split(r"[\s:=↔(]", strip_macrons(la).strip().lower(), 1)[0]
    head = re.sub(r"[^a-z]", "", head.replace("v", "u").replace("j", "i"))
    if len(head) < 4:
        return head if len(head) >= 3 else ""
    for e in _ENDINGS:
        if head.endswith(e) and len(head) - len(e) >= 3:
            return head[: -len(e)]
    return head


def unit_has_stem(unit: dict, stem: str) -> bool:
    for t in toks(unit["la"]):
        t = t.replace("v", "u").replace("j", "i")
        if t.startswith(stem):
            return True
    return False


def blocks_of(units: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    for u in units:
        if u.get("block_start") or not out:
            out.append([u])
        else:
            out[-1].append(u)
    return out


# --------------------------------------------------------------------------- printed lines → char offsets

def tokens_with_offsets(s: str) -> list[tuple[str, int]]:
    """toks(s) with, for each token, the offset of its first character in `s`
    (the original string — offsets are exact, macrons included)."""
    out: list[tuple[str, int]] = []
    i, n = 0, len(s)
    while i < n:
        if s[i].isalpha():
            j = i
            while j < n and s[j].isalpha():
                j += 1
            run = toks(s[i:j])
            if run:  # a run of letters is one token (toks splits nothing inside it)
                out.append(("".join(run), i))
            i = j
        else:
            i += 1
    return out


def same_token(a: str, b: str) -> bool:
    """Exact, or close enough for a scan slip (difflib ratio >= 0.8, both >= 3 letters)."""
    if a == b:
        return True
    if len(a) < 3 or len(b) < 3:
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.8


def consume_line(block: list[str], bpos: int, line: list[str]) -> tuple[int, int] | None:
    """Match the printed line's tokens as a run in `block` starting at `bpos`.
    → (matched tokens, block position after the run), or None when the line
    does not belong here.  A slip (one token garbled, dropped or inserted on
    either side) is bridged when the next token resynchronises."""
    i, j, matched = 0, bpos, 0
    nl, nb = len(line), len(block)
    while i < nl and j < nb:
        if same_token(line[i], block[j]):
            i, j, matched = i + 1, j + 1, matched + 1
            continue
        best = None
        for di in range(0, 3):
            for dj in range(0, 3):
                if di == dj == 0:
                    continue
                ii, jj = i + di, j + dj
                if ii >= nl or jj >= nb or not same_token(line[ii], block[jj]):
                    continue
                if ii + 1 < nl and jj + 1 < nb and not same_token(line[ii + 1], block[jj + 1]):
                    continue
                cand = (di + dj, di, dj)
                if best is None or cand < best:
                    best = cand
        if best is None:
            break
        i, j = i + best[1], j + best[2]
    if nl == 0:
        return None
    need = min(2 if nl >= 3 else 1, nb - bpos)  # the block may end inside this line
    if matched < need or (nb - bpos >= nl and matched < 0.6 * nl):
        return None
    if i < nl and j < nb and matched < nl - 2:
        return None  # more than a couple of trailing tokens left unexplained
    return matched, j


def walk_lines(block: list[str], lines: list[list[str]], first_offset: int = 0, max_skips: int = 2) -> tuple[list[tuple[int, int]], int]:
    """Walk the printed `lines` (token lists, the block's first line first)
    through the block's token stream.  → ([(line index, block token index where
    the line begins)], block token index after the last matched line).  `first_offset`: tokens of the first line that precede
    the block (the block starts mid-line).  Lines that do not match are
    skipped; after `max_skips` consecutive misses the walk stops."""
    out: list[tuple[int, int]] = []
    bpos, skips = 0, 0
    for li, ltoks in enumerate(lines):
        if bpos >= len(block):
            break
        if li == 0:
            ltoks = ltoks[first_offset:]
        if not ltoks:
            continue
        hit = consume_line(block, bpos, ltoks)
        if hit is not None and skips and hit[0] < 2:
            hit = None  # one token agreeing after a missed line is coincidence
        if hit is None:
            if len(block) - bpos <= 2:
                break  # a word or two the scan dropped at the block's end
            skips += 1
            if skips > max_skips:
                break
            continue
        skips = 0
        out.append((li, bpos))
        bpos = hit[1]
    return out, bpos


def first_line_offset(block: list[str], line: list[str]) -> int:
    """Where in the first printed line the block's text starts (token index).
    0 when the block begins the line or its first words are unreadable."""
    want = block[:4]
    for k in range(len(line)):
        n = 0
        while n < len(want) and k + n < len(line) and same_token(line[k + n], want[n]):
            n += 1
        if n >= min(2, len(want)):
            return k
        if n and k + n == len(line) and line[k] == want[0]:
            return k  # the block's first word(s) are the line's tail
    return 0


def block_lines(block: list[dict], lines: list[dict], start_line: int) -> dict[str, list[dict]]:
    """→ {unit id: [{line, start}, ...]} for the units of one block, walking the
    printed `lines` (one part, sorted by line number) from `start_line`."""
    stream: list[tuple[str, int, int]] = []  # (token, unit index, char offset in la)
    for ui, u in enumerate(block):
        for t, off in tokens_with_offsets(u["la"]):
            stream.append((t, ui, off))
    if not stream:
        return {}
    li0 = next((i for i, e in enumerate(lines) if e["line"] >= start_line), None)
    if li0 is None or lines[li0]["line"] != start_line:
        return {}
    line_toks = [toks(e["text"]) for e in lines[li0:]]
    btoks = [t for t, _, _ in stream]
    off0 = first_line_offset(btoks, line_toks[0]) if line_toks else 0
    walked, end = walk_lines(btoks, line_toks, off0)
    if not walked:
        return {}
    starts = [(bpos, lines[li0 + li]["line"]) for li, bpos in walked]  # block token index → line number
    first_tok: dict[int, int] = {}
    for k, (_, ui, _) in enumerate(stream):
        first_tok.setdefault(ui, k)
    out: dict[str, list[dict]] = {}
    for ui, u in enumerate(block):
        k0 = first_tok.get(ui)
        if k0 is None or k0 >= end:
            continue  # the walk never reached this unit
        line0 = max((ln for bp, ln in starts if bp <= k0), default=None)  # the line the unit starts on
        if line0 is None:
            continue
        entries = [{"line": line0, "start": 0}]
        for bp, ln in starts:
            if bp > k0 and stream[bp][1] == ui and stream[bp][2] > 0:
                entries.append({"line": ln, "start": stream[bp][2]})
        out[u["id"]] = entries
    return out


def check_lines(block: list[dict]) -> list[str]:
    """Sanity of `lines` across a block: offsets strictly increasing and < len(la),
    line numbers never decreasing, strictly increasing at every real line break."""
    bad: list[str] = []
    last_line = None
    for u in block:
        prev = -1
        for i, e in enumerate(u.get("lines") or []):
            if e["start"] <= prev or e["start"] >= len(u["la"]) or (i == 0 and e["start"] != 0):
                bad.append(f"{u['id']}: offsets {[x['start'] for x in u['lines']]} (len {len(u['la'])})")
                break
            if last_line is not None and (e["line"] < last_line or (e["start"] > 0 and e["line"] <= last_line)):
                bad.append(f"{u['id']}: line {e['line']} after {last_line}")
                break
            prev, last_line = e["start"], e["line"]
    return bad


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
           "attached": 0, "unattached": [], "fl_attached": 0, "located": 0, "notes": [],
           "lines_mapped": 0, "lines_unmapped": [], "units_with_lines": 0, "unwalked_blocks": [], "lines_bad": []}
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

    # 3. printed lines inside each unit (CONTRACT "Book lines")
    for u in units:
        u["lines"] = []
    mapped_lines: set[tuple[str | None, int]] = set()
    for b in blocks:
        first = b[0]
        if first.get("source") == "FL" or not lines:
            continue
        slug = slug_of(first["id"]) if slug_of(first["id"]) in by_slug else None
        part_lines = by_slug.get(slug, [])
        found = loc.get(first["id"])
        starts = []
        if found:
            starts.append(found["line"])
        if first.get("line_no") is not None and first["line_no"] not in starts:
            starts.append(first["line_no"])
        got: dict[str, list[dict]] = {}
        for start in starts:
            got = block_lines(b, part_lines, start)
            if got:
                break
        if not got:
            rep["unwalked_blocks"].append((first["id"], " ".join(first["la"].split()[:6])))
            continue
        for u in b:
            u["lines"] = got.get(u["id"], [])
            for e in u["lines"]:
                mapped_lines.add((slug, e["line"]))
        rep["lines_bad"] += check_lines(b)
    rep["lines_mapped"] = len(mapped_lines)
    rep["lines_unmapped"] = [(e.get("part"), e["line"], e["text"][:40] + (" [ocr]" if e.get("ocr") else ""))
                             for e in lines if (e.get("part"), e["line"]) not in mapped_lines]
    rep["units_with_lines"] = sum(1 for u in units if u["lines"])

    # 4. glosses
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
        ti = 0
        for i, u in enumerate(block):
            f = loc.get(u["id"])
            if f and f["line"] <= L:
                target, ti = u, i
        # Several sentences share a printed line, so the line alone can put a
        # gloss one sentence too late. Prefer the nearby sentence that actually
        # contains the glossed word: the line's sentence, then the one before
        # it (which may run on into this line), then the next.
        stem = gloss_stem(g["la"])
        if stem:
            order = [ti, ti - 1, ti - 2, ti + 1]
            for k in order:
                if 0 <= k < len(block) and unit_has_stem(block[k], stem):
                    target = block[k]
                    break
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
    if rep["lines"]:
        L.append(f"- book lines: {rep['lines_mapped']}/{rep['lines']} printed lines mapped into {rep['units_with_lines']} units")
    for x in rep["notes"]:
        L.append(f"- {x}")
    if rep["lines_bad"]:
        L.append(f"\nLine offsets that fail the sanity check ({len(rep['lines_bad'])}):\n")
        L += [f"- {x}" for x in rep["lines_bad"]]
    if rep["unwalked_blocks"]:
        L.append(f"\nBlocks whose printed lines could not be walked ({len(rep['unwalked_blocks'])}):\n")
        L += [f"- {uid}: {words}" for uid, words in rep["unwalked_blocks"]]
    if rep["lines_unmapped"]:
        L.append(f"\nPrinted lines not mapped to any unit ({len(rep['lines_unmapped'])}):\n")
        L += [f"- {(part + ' ') if part else ''}line {ln}: {text}" for part, ln, text in rep["lines_unmapped"]]
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
              f"/{rep['glosses']}; book lines {rep['lines_mapped']}/{rep['lines']}"
              + (f", {len(rep['lines_bad'])} BAD" if rep["lines_bad"] else "") + (" (check only)" if a.check else ""))
        for x in rep["notes"]:
            print("   note:", x)
    return rc


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
