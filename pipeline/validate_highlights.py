#!/usr/bin/env python3
"""Validate a data/build/highlights-week-NN.json file against the week's units.

Checks (CONTRACT.md, "highlights-week-NN.json"):
  * every entry has non-empty string unit_id / text / label / note
  * every unit_id exists in the week
  * every `text` is an exact substring of that unit's `la`
  * `occurrence` (optional, 1-based) does not exceed the number of matches;
    a text that matches more than once with no `occurrence` is a warning
  * no two entries resolve to the same character span in the same unit;
    partially overlapping spans are a warning

Units can come from either input:
  --week    data/build/week-01.json            (pipeline output; units carry `id` and `la`)
  --aligned data/week01-aligned-sentences.json (blocks of sents with `id`; unit id = week id + ":" + sent id)

Usage:
  python pipeline/validate_highlights.py data/build/highlights-week-01.json --aligned data/week01-aligned-sentences.json
  python pipeline/validate_highlights.py data/build/highlights-week-01.json --week data/build/week-01.json
Exit status 0 when there are no errors (warnings allowed), 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

REQUIRED = ("unit_id", "text", "label", "note")


def week_id_from_name(path: Path) -> str | None:
    m = re.search(r"week-?(\d+)", path.name)
    return f"w{int(m.group(1)):02d}" if m else None


def load_units_from_week(path: Path) -> dict[str, str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {u["id"]: u["la"] for u in data["units"]}


def load_units_from_aligned(path: Path, week_id: str) -> dict[str, str]:
    blocks = json.loads(path.read_text(encoding="utf-8"))
    return {f"{week_id}:{s['id']}": s["la"] for b in blocks for s in b["sents"]}


def find_all(hay: str, needle: str) -> list[int]:
    out, i = [], hay.find(needle)
    while i != -1:
        out.append(i)
        i = hay.find(needle, i + 1)
    return out


def validate(highlights: list, units: dict[str, str]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    spans: dict[tuple[str, int, int], int] = {}

    if not isinstance(highlights, list):
        return ["top level must be a JSON array"], []

    for n, h in enumerate(highlights):
        where = f"#{n}"
        if not isinstance(h, dict):
            errors.append(f"{where}: entry is not an object")
            continue
        missing = [k for k in REQUIRED if not isinstance(h.get(k), str) or not h[k].strip()]
        if missing:
            errors.append(f"{where}: missing/empty {', '.join(missing)}")
            continue
        uid, text = h["unit_id"], h["text"]
        where = f"#{n} {uid} {text!r}"
        la = units.get(uid)
        if la is None:
            errors.append(f"{where}: unit_id not found")
            continue
        hits = find_all(la, text)
        if not hits:
            errors.append(f"{where}: text is not a substring of la")
            continue
        occ = h.get("occurrence", 1)
        if not isinstance(occ, int) or occ < 1:
            errors.append(f"{where}: occurrence must be a positive integer")
            continue
        if occ > len(hits):
            errors.append(f"{where}: occurrence {occ} but only {len(hits)} match(es)")
            continue
        if "occurrence" not in h and len(hits) > 1:
            warnings.append(f"{where}: matches {len(hits)} times, no occurrence given (first occurrence assumed)")
        start = hits[occ - 1]
        end = start + len(text)
        key = (uid, start, end)
        if key in spans:
            errors.append(f"{where}: duplicate span, same as #{spans[key]}")
        else:
            for (ouid, ostart, oend), on in spans.items():
                if ouid == uid and start < oend and ostart < end:
                    warnings.append(f"{where}: overlaps #{on} ({ostart}-{oend})")
            spans[key] = n
        extra = set(h) - set(REQUIRED) - {"occurrence"}
        if extra:
            warnings.append(f"{where}: unexpected keys {sorted(extra)}")
    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("highlights", type=Path)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--week", type=Path, help="data/build/week-NN.json")
    src.add_argument("--aligned", type=Path, help="data/weekNN-aligned-sentences.json")
    ap.add_argument("--week-id", help="e.g. w01 (default: derived from the file name)")
    args = ap.parse_args(argv)

    # Messages quote Latin with macrons; do not die on a cp1252 console.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    if args.week:
        units = load_units_from_week(args.week)
    else:
        wid = args.week_id or week_id_from_name(args.aligned) or week_id_from_name(args.highlights)
        if not wid:
            print("cannot derive week id; pass --week-id", file=sys.stderr)
            return 2
        units = load_units_from_aligned(args.aligned, wid)

    highlights = json.loads(args.highlights.read_text(encoding="utf-8"))
    errors, warnings = validate(highlights, units)

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    if isinstance(highlights, list):
        by_label = Counter(h.get("label") for h in highlights if isinstance(h, dict))
        print(f"{len(highlights)} highlights over {len(units)} units; by label:")
        for label, c in sorted(by_label.items(), key=lambda kv: (-kv[1], str(kv[0]))):
            print(f"  {c:3d}  {label}")
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
