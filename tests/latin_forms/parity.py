#!/usr/bin/env python
"""
parity.py — pipeline/latin_forms.py against app/js/paradigms.js, cell for cell.

    python tests/latin_forms/parity.py            # every glossary lemma
    python tests/latin_forms/parity.py --limit 400

Both sides draw the same table from the same glossary entry; every non-empty
cell must carry the same text in the same place.  latin_forms runs with
JS_COMPAT on, so the one place where it knowingly departs from the app is put
back for the comparison (see DIVERGENCES).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
import latin_forms as lf  # noqa: E402

GLOSSARY = ROOT / "app" / "data" / "glossary.json"
DUMPER = Path(__file__).resolve().parent / "dump_js_paradigms.mjs"

# Where latin_forms deliberately does NOT follow app/js/paradigms.js.  Each is a
# bug in the app's table that the pipeline must not copy; JS_COMPAT puts the
# app's reading back so parity can still be asserted over everything else.
DIVERGENCES = [
    "N [2, 4] (praedium, gladius): paradigms.js nounTableKey sends Whitaker's "
    "-ium / -ius stem to the '2nus' table (vulgus: nom = acc = voc in -us, no "
    "plural) and so prints praedius, praediī, praediō, praedius … with no "
    "plural.  latin_forms declines it as an ordinary 2nd-declension noun "
    "(praedium, praediī / praedī, praediō, praedia …).  119 glossary nouns.",
]


def entries_of(glossary: dict) -> list[dict]:
    seen, out = set(), []
    for ents in glossary.values():
        for e in ents:
            if e.get("pos") not in ("N", "ADJ", "V", "VPAR", "PRON", "NUM"):
                continue
            k = (e.get("h"), e.get("pos"), tuple(e.get("cat") or []), tuple(e.get("roots") or []),
                 e.get("gender"), e.get("kind"), e.get("lemma"))
            if k in seen:
                continue
            seen.add(k)
            out.append(e)
    out.sort(key=lambda e: (e.get("pos") or "", str(e.get("cat")), e.get("h") or ""))
    return out


def py_cells(entry: dict):
    p = lf.paradigm(entry)
    if not p:
        return None
    cells = []
    for s in p["sections"]:
        for r in s["rows"]:
            for i, c in enumerate(r["cells"]):
                if c.get("empty"):
                    continue
                cells.append([s["title"], r["label"], i, c["text"]])
    return {"title": p["title"], "note": p.get("note"), "cells": cells}


def run(entries: list[dict]):
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / "entries.json"
        f.write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")
        res = subprocess.run(["node", str(DUMPER), str(f)], capture_output=True,
                             cwd=str(ROOT), text=True, encoding="utf-8")
    if res.returncode:
        raise RuntimeError(res.stderr[-4000:])
    return json.loads(res.stdout)


def compare(entries: list[dict]) -> list[str]:
    lf.JS_COMPAT = True
    try:
        js = run(entries)
        bad = []
        for e, j in zip(entries, js):
            p = py_cells(e)
            if (p is None) != (j is None):
                bad.append(f"{e.get('h')} ({e.get('pos')} {e.get('cat')}): "
                           f"python {'has no' if p is None else 'has a'} table, js "
                           f"{'has no' if j is None else 'has a'} table")
                continue
            if p is None:
                continue
            pj = {(a, b, c): d for a, b, c, d in p["cells"]}
            jj = {(a, b, c): d for a, b, c, d in j["cells"]}
            for k in sorted(set(pj) | set(jj), key=str):
                if pj.get(k) != jj.get(k):
                    bad.append(f"{e.get('h')} ({e.get('pos')} {e.get('cat')}) {k}: "
                               f"python {pj.get(k)!r} vs js {jj.get(k)!r}")
            if p["title"] != j["title"]:
                bad.append(f"{e.get('h')}: title {p['title']!r} vs {j['title']!r}")
        return bad
    finally:
        lf.JS_COMPAT = False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--show", type=int, default=40)
    a = ap.parse_args(argv)
    glossary = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    entries = entries_of(glossary)
    if a.limit:
        entries = entries[:: max(1, len(entries) // a.limit)][:a.limit]
    bad = []
    for i in range(0, len(entries), 400):
        bad += compare(entries[i:i + 400])
    print(f"{len(entries)} entries compared; {len(bad)} cell mismatches")
    for b in bad[:a.show]:
        print("   ", b)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
