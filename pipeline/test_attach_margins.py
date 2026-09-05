"""
pytest for the printed-line walker in pipeline/attach_margins.py (CONTRACT "Book lines").

    python -m pytest pipeline -q

The block below is original synthetic Latin, not book text.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import attach_margins as am  # noqa: E402

# A block of three sentences, "printed" on four lines.  Line 2 has a scan slip
# ("hortum" for "hortos"), line 3 lost its first word ("Tum"), and a margin
# fragment sits between lines 3 and 4.
BLOCK = [
    {"id": "t:1.1", "la": "Marcus et Iūlia in hortō ambulant, dum pater dormit."},
    {"id": "t:1.2", "la": "Tum puer rosās carpit et sorōrī dat."},
    {"id": "t:1.3", "la": "Iūlia laeta est."},
]
LINES = [
    {"line": 10, "text": "Marcus et Iūlia in hortō ambulant,"},
    {"line": 11, "text": "dum pater dormit. Tum puer rosās"},
    {"line": 12, "text": "carpit et sorōrī dat. Iūlia laeta"},
    {"line": 13, "text": "est."},
]


def test_tokens_with_offsets_land_on_original_characters():
    la = BLOCK[0]["la"]
    got = am.tokens_with_offsets(la)
    assert [t for t, _ in got] == am.toks(la)
    assert all(la[off:off + 1].isalpha() for _, off in got)
    assert got[2] == ("iulia", la.index("Iūlia"))
    assert got[4] == ("horto", la.index("hortō"))


def test_walk_lines_places_every_line_and_reports_end():
    block = [t for u in BLOCK for t, _ in am.tokens_with_offsets(u["la"])]
    lines = [am.toks(e["text"]) for e in LINES]
    walked, end = am.walk_lines(block, lines)
    assert walked == [(0, 0), (1, 6), (2, 12), (3, 18)]
    assert end == len(block)


def test_walk_lines_tolerates_slip_dropped_word_and_noise():
    block = [t for u in BLOCK for t, _ in am.tokens_with_offsets(u["la"])]
    lines = [
        am.toks("Marcus et Iūlia in hortum ambulant,"),  # slip: hortum / hortō
        am.toks("dum pater dormit. puer rosās"),         # "Tum" dropped by the scan
        am.toks("rosa -ae f"),                            # margin noise
        am.toks("carpit et sorōrī dat. Iūlia laeta"),
        am.toks("est."),
    ]
    walked, end = am.walk_lines(block, lines)
    assert walked == [(0, 0), (1, 6), (3, 12), (4, 18)]
    assert end == len(block)


def test_walk_lines_block_starting_mid_line():
    block = [t for u in BLOCK for t, _ in am.tokens_with_offsets(u["la"])]
    first = am.toks("dēsinit. Marcus et Iūlia in hortō ambulant,")
    assert am.first_line_offset(block, first) == 1
    assert am.first_line_offset(block, am.toks("cantat. Marcus")) == 1  # one-word tail
    walked, _ = am.walk_lines(block, [first, am.toks("dum pater dormit.")], first_offset=1)
    assert walked == [(0, 0), (1, 6)]


def test_block_lines_gives_char_offsets_per_unit():
    got = am.block_lines(BLOCK, LINES, 10)
    assert got["t:1.1"] == [{"line": 10, "start": 0}, {"line": 11, "start": BLOCK[0]["la"].index("dum")}]
    assert got["t:1.2"] == [{"line": 11, "start": 0}, {"line": 12, "start": BLOCK[1]["la"].index("carpit")}]
    assert got["t:1.3"] == [{"line": 12, "start": 0}, {"line": 13, "start": BLOCK[2]["la"].index("est")}]
    for u in BLOCK:
        u["lines"] = got[u["id"]]
    assert am.check_lines(BLOCK) == []
    # reconstructing the printed lines from the pieces gives the book back, word for word
    pieces: dict[int, list[str]] = {}
    for u in BLOCK:
        ls = u["lines"]
        for i, e in enumerate(ls):
            end = ls[i + 1]["start"] if i + 1 < len(ls) else len(u["la"])
            pieces.setdefault(e["line"], []).append(u["la"][e["start"]:end])
    for e in LINES:
        assert am.toks(" ".join(pieces[e["line"]])) == am.toks(e["text"])


def test_block_lines_unknown_start_line_maps_nothing():
    assert am.block_lines(BLOCK, LINES, 99) == {}


def test_check_lines_catches_bad_offsets():
    bad = [{"id": "x", "la": "Marcus ambulat.", "lines": [{"line": 1, "start": 0}, {"line": 2, "start": 40}]}]
    assert am.check_lines(bad)
    bad = [{"id": "x", "la": "Marcus ambulat.", "lines": [{"line": 3, "start": 0}, {"line": 2, "start": 7}]}]
    assert am.check_lines(bad)
