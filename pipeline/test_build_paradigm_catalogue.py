"""
The paradigm catalogue's build check (GRAMMAR-CONTRACT.md §4).

    python -m pytest pipeline/test_build_paradigm_catalogue.py -q

It fails when a table has no stock word, when a stock word does not render that
table, when an axis is offered that the data cannot filter — and, beyond the
three the contract asks for, when the committed app/data/grammar/paradigms.json
has drifted from what the builder now produces, when the selection rules stop
partitioning the glossary, or when app/js/paradigms.js and the catalogue would
name a cell differently.  That last one drives the real app module from node,
exactly as tests/latin_forms/parity.py does, so the ids in the file are the ids
the app will compute.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import build_paradigm_catalogue as bpc  # noqa: E402
import latin_forms as lf  # noqa: E402

DUMPER = ROOT / "tests" / "latin_forms" / "dump_js_cell_ids.mjs"
INDEX_PATH = ROOT / "app" / "data" / "glossary-headwords.json"

#: What §7.4 of the contract measured over the whole glossary, on 2026-09-09.
#: One table per headword — the first entry of that headword that has one.
MEASURED_HEADWORDS = 2735
MEASURED_CELLS = 157908


@pytest.fixture(scope="module")
def built():
    if not bpc.GLOSSARY.exists():
        pytest.skip("glossary.json not built")
    return bpc.build()


@pytest.fixture(scope="module")
def catalogue(built):
    return built[0]


@pytest.fixture(scope="module")
def tables(catalogue):
    return {t["id"]: t for p in catalogue["parts"] for t in p["tables"]}


@pytest.fixture(scope="module")
def entries():
    glossary = json.loads(bpc.GLOSSARY.read_text(encoding="utf-8"))
    return glossary, bpc.load_entries(glossary)


# --------------------------------------------------------------- the check


def test_build_reports_no_problems(built):
    _, problems = built
    assert problems == [], "\n".join(problems)


def test_every_table_has_stock_words(tables):
    for tid, t in tables.items():
        assert t["stock"], f"{tid} has no stock word"
        # three to five where the course has that many, all of them where it has
        # fewer — never more than five, and never a word twice
        assert len(t["stock"]) <= 5, f"{tid} lists {len(t['stock'])} stock words"
        assert len(t["stock"]) == len({s["h"] for s in t["stock"]}), f"{tid} repeats a stock word"
        # three to five where the course teaches that many, all of them where it
        # teaches fewer (pecū and vērū exist but the book never prints them)
        floor = 3 if t["taught_headwords"] >= 3 else max(1, t["taught_headwords"])
        assert len(t["stock"]) >= min(floor, t["headwords"]), \
            f"{tid}: {len(t['stock'])} stock words for {t['taught_headwords']} taught"


def test_every_stock_word_renders_its_table(tables, entries):
    glossary, _ = entries
    for tid, t in tables.items():
        declared = {(g["id"], c) for g in t["groups"] for c in g["cells"]}
        for s in t["stock"]:
            entry = glossary[s["key"]][s["i"]]
            assert entry["h"] == s["h"] and entry["pos"] == s["pos"], \
                f"{tid}: {s['h']} is not at {s['key']}[{s['i']}]"
            assert bpc.table_of(entry) == tid, \
                f"{tid}: the rules send {s['h']} to {bpc.table_of(entry)}"
            r = bpc.rendered(entry)
            assert r, f"{tid}: {s['h']} renders no table at all"
            kind, cells = r
            assert kind == t["kind"]
            assert cells, f"{tid}: {s['h']} renders an empty table"
            unknown = sorted(set(cells) - declared)
            assert not unknown, f"{tid}: {s['h']} renders cells the catalogue does not name: {unknown[:4]}"


def test_every_group_is_reachable_from_a_stock_word(tables):
    for tid, t in tables.items():
        covered = {g for s in t["stock"] for g in s["groups"]}
        missing = [g["id"] for g in t["groups"] if g["id"] not in covered]
        assert not missing, f"{tid}: no stock word renders {missing}"


def test_no_axis_the_data_cannot_filter(tables):
    for tid, t in tables.items():
        for axis in t["axes"]:
            assert len(axis["values"]) >= 2, f"{tid}: axis {axis['id']} has one value"
            for v in axis["values"]:
                n = v.get("cells") if axis["scope"] == "cell" else v.get("lemmas")
                assert n, f"{tid}: axis {axis['id']} offers {v['v']} with nothing behind it"
        assert len({a["id"] for a in t["axes"] if a["scope"] == "cell"}) == \
               len([a for a in t["axes"] if a["scope"] == "cell"]), f"{tid}: a cell axis is listed twice"


def test_cell_axis_values_really_occur_in_the_cells(tables):
    """An axis value is only offered when a cell id actually carries it."""
    for tid, t in tables.items():
        tokens = {tok for g in t["groups"] for c in g["cells"] for tok in c.split(".")}
        for axis in t["axes"]:
            if axis["scope"] != "cell":
                continue
            for v in axis["values"]:
                assert str(v["v"]) in tokens, f"{tid}: axis {axis['id']} offers {v['v']}, no cell has it"


# ------------------------------------------------------- the rules and ids


def test_the_rules_partition_every_entry_that_has_a_table(entries, tables):
    _, es = entries
    unclaimed, unknown = [], []
    for e in es:
        r = bpc.rendered(e)
        if not r:
            continue
        tid = bpc.table_of(e)
        if tid is None:
            unclaimed.append(f"{e['h']} ({e['pos']} {e.get('cat')})")
        elif tid not in tables:
            unknown.append(f"{e['h']} → {tid}")
    assert not unclaimed, f"entries with a table that no rule claims: {unclaimed[:6]}"
    assert not unknown, f"entries sent to a table the catalogue does not list: {unknown[:6]}"


def test_every_entry_only_renders_cells_its_table_names(entries, tables):
    _, es = entries
    for e in es:
        r = bpc.rendered(e)
        if not r:
            continue
        t = tables[bpc.table_of(e)]
        declared = {(g["id"], c) for g in t["groups"] for c in g["cells"]}
        unknown = sorted(set(r[1]) - declared)
        assert not unknown, f"{t['id']}/{e['h']} renders {unknown[:3]}, which the table does not name"


def test_a_cell_id_is_unique_inside_its_group(entries):
    _, es = entries
    for e in es:
        r = bpc.rendered(e)
        if not r:
            continue
        seen = set()
        for pair in r[1]:
            assert pair not in seen, f"{e['h']} prints {pair[1]} twice in {pair[0]}"
            seen.add(pair)


def test_a_cell_id_parses_back_to_its_key(tables):
    """Every token of every id names exactly one slot, so the id is reversible."""
    for tid, t in tables.items():
        for g in t["groups"]:
            for cid in g["cells"]:
                tokens = cid.split(".")
                if tokens[0] in bpc.KIND_PREFIX or tokens[0] == "gerundive":
                    tokens = tokens[1:]
                slots = [bpc.SLOT_OF.get(tok) for tok in tokens]
                assert all(slots), f"{tid}#{cid}: {tokens} is not all slot values"
                assert len(slots) == len(set(slots)), f"{tid}#{cid} fills a slot twice"
                order = [bpc.SLOT_ORDER.index(s) for s in slots]
                assert order == sorted(order), f"{tid}#{cid} is not in slot order"


# --------------------------------------------------- the committed artefacts


def test_the_committed_catalogue_is_what_the_builder_produces(catalogue):
    if not bpc.OUT_PATH.exists():
        pytest.skip("paradigms.json not built")
    on_disk = json.loads(bpc.OUT_PATH.read_text(encoding="utf-8"))
    assert on_disk == catalogue, "app/data/grammar/paradigms.json is stale — rerun the builder"


def test_the_headword_index_resolves_every_reading(entries):
    if not INDEX_PATH.exists():
        pytest.skip("glossary-headwords.json not built")
    glossary, _ = entries
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    assert index["fields"] == ["h", "pos", "key", "i"]
    assert index["count"] == len(index["headwords"])
    for h, pos, key, i in index["headwords"]:
        entry = glossary[key or h][i]
        assert entry["h"] == h and entry["pos"] == pos, f"{h} is not at {key or h}[{i}]"
    listed = {r[0] for r in index["headwords"]}
    every = {e["h"] for entries_ in glossary.values() for e in entries_}
    assert listed == every, f"{len(every - listed)} headwords are missing from the index"


def test_every_stock_word_is_in_the_headword_index(tables):
    if not INDEX_PATH.exists():
        pytest.skip("glossary-headwords.json not built")
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    known = {(r[0], r[1]) for r in index["headwords"]}
    for tid, t in tables.items():
        for s in t["stock"]:
            assert (s["h"], s["pos"]) in known, f"{tid}: {s['h']} is not in the headword index"


# ------------------------------------------------------ the measured totals


def test_the_totals_match_what_the_contract_measured(entries, catalogue):
    """§7.4: 2,735 headwords, 157,908 keyed cells — one table per headword."""
    _, es = entries
    seen: dict[str, dict] = {}
    for e in es:
        if e["h"] not in seen and lf.paradigm(e):
            seen[e["h"]] = e
    cells = 0
    for e in seen.values():
        p = lf.paradigm(e)
        for s in p["sections"]:
            for r in s["rows"]:
                cells += sum(1 for c in r["cells"] if not c.get("empty"))
    assert len(seen) == MEASURED_HEADWORDS
    assert cells == MEASURED_CELLS
    assert catalogue["totals"]["headwords"] == MEASURED_HEADWORDS


# ------------------------------------------------ the app computes the same


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_paradigms_js_computes_the_same_ids(tables, entries):
    """Drive app/js/paradigms.js itself and compare, stock word by stock word."""
    glossary, _ = entries
    wanted = [(tid, s, glossary[s["key"]][s["i"]])
              for tid, t in sorted(tables.items()) for s in t["stock"]]
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "entries.json"
        path.write_text(json.dumps([e for _, _, e in wanted], ensure_ascii=False), encoding="utf-8")
        res = subprocess.run(["node", str(DUMPER), str(path)], capture_output=True,
                             cwd=str(ROOT), text=True, encoding="utf-8")
    assert res.returncode == 0, res.stderr[-3000:]
    js = json.loads(res.stdout)
    assert len(js) == len(wanted)
    for (tid, s, entry), got in zip(wanted, js):
        assert got is not None, f"{tid}: paradigms.js draws no table for {s['h']}"
        assert got["kind"] == tables[tid]["kind"], f"{tid}/{s['h']}: kind {got['kind']}"
        py = bpc.rendered(entry)[1]
        assert [tuple(x) for x in got["cells"]] == py, \
            f"{tid}/{s['h']}: paradigms.js and the catalogue disagree about the ids"
        declared = {(g["id"], c) for g in tables[tid]["groups"] for c in g["cells"]}
        unknown = sorted({tuple(x) for x in got["cells"]} - declared)
        assert not unknown, f"{tid}/{s['h']}: paradigms.js renders {unknown[:3]}, uncatalogued"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_paradigms_js_and_the_catalogue_agree_over_the_whole_glossary(entries, tables):
    """The same comparison, but over every entry — a sample big enough to bite."""
    _, es = entries
    sample = [e for e in es if bpc.rendered(e)]
    step = max(1, len(sample) // 600)
    sample = sample[::step]
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "entries.json"
        path.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")
        res = subprocess.run(["node", str(DUMPER), str(path)], capture_output=True,
                             cwd=str(ROOT), text=True, encoding="utf-8")
    assert res.returncode == 0, res.stderr[-3000:]
    js = json.loads(res.stdout)
    bad = []
    for entry, got in zip(sample, js):
        py = bpc.rendered(entry)
        if got is None or [tuple(x) for x in got["cells"]] != py[1]:
            bad.append(entry["h"])
    assert not bad, f"{len(bad)} entries where paradigms.js names cells differently: {bad[:6]}"
