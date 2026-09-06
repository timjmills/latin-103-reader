"""The library counts build_glossary.py bakes into the glossary (`n`, `nd`).

    python -m pytest pipeline/test_build_glossary_counts.py -q

`n` is how often the whole library prints a form of a lexeme that no rival
reading under the same key can print; `nd` is how many such forms there were to
count over.  dictionary.js reads the pair to push a reading the course never
shows the learner behind one it shows constantly (`māla` is apples, not cheeks)
— see count_ranks() there and here.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import build_glossary as bg  # noqa: E402

GLOSSARY = ROOT / "app" / "data" / "glossary.json"


@pytest.fixture(scope="module")
def glossary() -> dict:
    if not GLOSSARY.exists():
        pytest.skip("glossary.json not built")
    return json.loads(GLOSSARY.read_text(encoding="utf-8"))


def test_count_ranks_only_pushes_back_the_never_printed():
    seen = {"n": 80, "nd": 8}
    never = {"n": 0, "nd": 7}
    assert bg.count_ranks([seen, never]) == [0, 1]


def test_count_ranks_leaves_a_near_miss_alone():
    assert bg.count_ranks([{"n": 80, "nd": 8}, {"n": 12, "nd": 7}]) == [0, 0]


def test_count_ranks_ignores_a_rival_counted_over_ten_times_the_evidence():
    # vītis the vine (5 forms of its own, none printed) against vītō "avoid" (146):
    # whichever word is meant, a race like that goes to the verb, so it is not run
    assert bg.count_ranks([{"n": 22, "nd": 146}, {"n": 0, "nd": 5}]) == [0, 0]


def test_count_ranks_never_moves_a_reading_with_nothing_of_its_own():
    assert bg.count_ranks([{"n": 80, "nd": 8}, {}]) == [0, 0]


def test_mala_is_apples_in_the_baked_glossary(glossary):
    entries = glossary["mala"]
    cheeks = next(e for e in entries if e["lemma"].startswith("māla -ae f"))
    apples = next(e for e in entries if e["lemma"].startswith("mālum -ī n"))
    assert cheeks["n"] == 0, "the library prints mālae/mālam/mālā nowhere"
    assert apples["n"] >= 10, "mālum/mālō/mālōrum are all over chapters VII-VIII"
    # …and the key the reader hits for the printed spelling leads with the apples
    assert glossary["māla"][0]["lemma"].startswith("mālum -ī n")


def test_non_is_left_as_the_adverb_alone(glossary):
    # `nōn m` (the Nones) is indeclinable and has no table, so it cannot be counted
    # and the counts must not move it either way; the adverb keeps the lead it had
    entries = glossary["non"]
    nones = next(e for e in entries if e["pos"] == "N")
    assert "n" not in nones and "nd" not in nones
    assert bg.count_ranks(entries) == [0] * len(entries), "neither reading is pushed back"
    assert entries[0]["pos"] == "ADV"


def test_counts_are_written_in_pairs_and_only_where_they_can_rank(glossary):
    lone = 0
    for key, entries in glossary.items():
        for e in entries:
            if "n" in e or "nd" in e:
                assert "n" in e and "nd" in e, f"{key}: {e['lemma']} has one of n/nd"
                assert isinstance(e["n"], int) and e["n"] >= 0
                assert isinstance(e["nd"], int) and e["nd"] > 0
                assert len(entries) > 1, f"{key}: a lone reading needs no count"
            elif len(entries) == 1:
                lone += 1
    assert lone > 1000, "most keys hold one reading and carry no count"


def test_gloss_abbreviations_are_never_counted(glossary):
    for entries in glossary.values():
        for e in entries:
            if e.get("pos") in bg._GLOSS_POS:
                assert "n" not in e, f"{e['lemma']}: a fragment is not a word to count"
