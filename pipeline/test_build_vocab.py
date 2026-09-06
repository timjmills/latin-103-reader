"""Vocabulary deck rules. Run: python -m pytest pipeline/test_build_vocab.py

Covers the three things `--check` must never let through again:
a lemma in two chapters, a malformed dictionary line, and a raw Whitaker
sense line used as the drill prompt.
"""

import json

import pytest

import build_vocab as bv


# --------------------------------------------------------------- duplicates

def _deck(chapter, words):
    return {"chapter": chapter, "words": words}


def _word(**kw):
    w = {"lemma": "magnus", "dict": "magnus, -a, -um", "pos": "ADJ", "gender": None,
         "decl": 1, "meaning": "large, great", "sense_full": "large, great, big, vast",
         "parts": None, "unit_id": "r01:1.1", "count": 3}
    w.update(kw)
    return w


def _write_decks(tmp_path, decks, monkeypatch):
    monkeypatch.setattr(bv, "OUT_DIR", tmp_path)
    for c in bv.CHAPTERS:
        (tmp_path / f"{c:02d}.json").write_text(
            json.dumps(decks.get(c, _deck(c, []))), encoding="utf-8")
    return bv.check(unit_ids={"r01:1.1", "r13:1.1"})


def test_check_catches_a_planted_duplicate(tmp_path, monkeypatch):
    """The same lemma in two chapters is an error even when the dict strings
    differ — the bug that let 57 lemmas ship twice."""
    errs = _write_decks(tmp_path, {
        1: _deck(1, [_word()]),
        13: _deck(13, [_word(dict="magnus, -a, -um (gen. -īus)", unit_id="r13:1.1")]),
    }, monkeypatch)
    assert any("already in chapter 1" in e for e in errs), errs


def test_check_ignores_macrons_and_v_u_when_comparing_lemmas(tmp_path, monkeypatch):
    errs = _write_decks(tmp_path, {
        2: _deck(2, [_word(lemma="lingva", dict="lingva, -ae f.", pos="N", decl=1,
                           gender="f", meaning="tongue")]),
        13: _deck(13, [_word(lemma="lingua", dict="lingua, -ae f.", pos="N", decl=1,
                             gender="f", meaning="tongue", unit_id="r13:1.1")]),
    }, monkeypatch)
    assert any("already in chapter 2" in e for e in errs), errs


def test_check_passes_a_clean_pair_of_decks(tmp_path, monkeypatch):
    errs = _write_decks(tmp_path, {
        1: _deck(1, [_word()]),
        13: _deck(13, [_word(lemma="brevis", dict="brevis, -e", meaning="short",
                             sense_full="short, little, small", unit_id="r13:1.1")]),
    }, monkeypatch)
    assert errs == []


# ------------------------------------------------------------- dict lines

@pytest.mark.parametrize("lemma,pos,gender,expected", [
    ("puella -ae f", "N", "f", "puella, -ae f."),
    ("frāter frātris m", "N", "m", "frāter, frātris m."),
    ("nihil n (indeclinable)", "N", "n", "nihil n. (indeclinable)"),
    ("moenia -ium n pl", "N", "n", "moenia, -ium n. (plural only)"),
    ("nēmō (acc. nēminem, dat. nēminī) m/f", "N", "c", "nēmō m./f. (acc. nēminem, dat. nēminī)"),
    ("magnus -a -um", "ADJ", None, "magnus, -a, -um"),
    ("magnus -a -um · comparative maior, maius", "ADJ", None, "magnus, -a, -um"),
    ("brevis -e · superlative brevissimus -a -um", "ADJ", None, "brevis, -e"),
    ("omnis -e", "ADJ", None, "omnis, -e"),
    ("celer celeris celere", "ADJ", None, "celer, celeris, celere"),
    ("fēlīx (gen. fēlīcis)", "ADJ", None, "fēlīx, gen. fēlīcis"),
    ("sōlus -a -um (gen. -īus)", "ADJ", None, "sōlus, -a, -um (gen. -īus)"),
    ("quot (indeclinable)", "ADJ", None, "quot (indeclinable)"),
    ("maior -us", "ADJ", None, "maior, maius"),
    ("amō, amāre, amāvī, amātum", "V", None, "amō, amāre, amāvī, amātum"),
    ("sequor, sequī, secūtus sum", "V", None, "sequor, sequī, secūtus sum"),
    ("sum, esse, fuī, futūrum", "V", None, "sum, esse, fuī, futūrum"),
    ("vorō -āre -āvī -ātum", "V", None, "vorō, -āre, -āvī, -ātum"),
    ("fīdō -ere, fīsus sum", "V", None, "fīdō, -ere, fīsus sum"),
    ("inquam, inquit (defective: says, said)", "V", None, "inquam, inquit"),
    ("bene", "ADV", None, "bene"),
    ("melius (comparative of bene)", "ADV", None, "bene"),
    ("sed", "CONJ", None, "sed"),
    ("is, ea, id (+ -cum: with)", "PRON", None, "is, ea, id"),
])
def test_dict_form_is_a_textbook_line(lemma, pos, gender, expected):
    entry = {"lemma": lemma, "pos": pos, "gender": gender, "parses": [], "h": "x"}
    got, parts = bv.dict_form(entry)
    assert got == expected
    assert bv.check_dict_line(got, pos) is None
    assert (parts == got) if pos == "V" else (parts is None)


def test_preposition_carries_the_case_it_governs():
    entry = {"lemma": "in", "pos": "PREP", "gender": None,
             "parses": [{"governs": "abl"}, {"governs": "acc"}], "kind": "abl"}
    assert bv.dict_form(entry)[0] == "in (+ acc./abl.)"


@pytest.mark.parametrize("bad,pos", [
    ("magnus, -a, -um, ·, comparative, maior,, maius", "ADJ"),
    ("frequens, (gen., frequentis), ·, superlative, frequentissimus, -a, -um", "ADJ"),
    ("uterque,, utraque,, utrumque", "ADJ"),
    ("nūllus, -a, -um, (gen., -īus)", "ADJ"),
    ("puella,", "N"),
    ("", "N"),
])
def test_check_dict_line_rejects_the_shipped_malformations(bad, pos):
    assert bv.check_dict_line(bad, pos) is not None


# ------------------------------------------------------------ teaching gloss

@pytest.mark.parametrize("sense,expected", [
    ("run, trot, gallop, hurry, hasten, speed, move, travel, proceed, flow swiftly",
     "run, trot, gallop"),
    ("good, honest, brave, noble, kind, pleasant, right, useful", "good, honest, brave"),
    ("girl, (female) child or daughter", "girl, child or daughter"),
    ("strength (singular only), force, power, might, violence", "strength, force, power"),
    ("comedy (as form of drama or literature", "comedy"),
    ("Roman, of Rome", "Roman, of Rome"),
])
def test_short_gloss_cuts_to_three_lower_case_senses(sense, expected):
    got = bv.short_gloss(sense)
    assert got == expected
    assert bv.check_gloss(got) is None


def test_overrides_win_over_the_whitaker_sense():
    key = ("accido", "V")
    assert key in bv.GLOSS_OVERRIDES
    assert bv.gloss_for(key, ["fall upon, down, to, at or near, descend, alight"]) == "happen, occur"


@pytest.mark.parametrize("bad", [
    "run, trot, gallop, hurry",                      # four senses
    "fear, dread, be afraid (ne + sub = lest",       # a grammar note
    "aid (w/DAT)",                                   # an abbreviation
    "Trader, merchant",                              # not lower case
    "",
])
def test_check_gloss_rejects_a_raw_sense_line(bad):
    assert bv.check_gloss(bad) is not None


# ------------------------------------------------------------- shipped decks

def test_the_shipped_decks_pass_check():
    assert bv.check() == []
