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
         "parts": None, "unit_id": "r01:1.1", "count": 3,
         "sem": {"of": ["thing", "place"]}}
    w.update(kw)
    return w


def _write_decks(tmp_path, decks, monkeypatch, sem_file=None):
    """Write the synthetic decks and, unless `sem_file` is given, a sem.json
    that agrees with them, so the real pipeline/sem.json never leaks in."""
    monkeypatch.setattr(bv, "OUT_DIR", tmp_path)
    monkeypatch.setattr(bv, "SEM_PATH", tmp_path / "sem.json")
    for c in bv.CHAPTERS:
        (tmp_path / f"{c:02d}.json").write_text(
            json.dumps(decks.get(c, _deck(c, []))), encoding="utf-8")
    if sem_file is None:
        bv.dump_sem()
    else:
        (tmp_path / "sem.json").write_text(json.dumps(sem_file), encoding="utf-8")
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
                           gender="f", meaning="tongue", sem="abstract")]),
        13: _deck(13, [_word(lemma="lingua", dict="lingua, -ae f.", pos="N", decl=1,
                             gender="f", meaning="tongue", unit_id="r13:1.1", sem="abstract")]),
    }, monkeypatch)
    assert any("already in chapter 2" in e for e in errs), errs


def test_check_passes_a_clean_pair_of_decks(tmp_path, monkeypatch):
    errs = _write_decks(tmp_path, {
        1: _deck(1, [_word()]),
        13: _deck(13, [_word(lemma="brevis", dict="brevis, -e", meaning="short",
                             sense_full="short, little, small", unit_id="r13:1.1",
                             sem={"of": ["thing", "time"]})]),
    }, monkeypatch)
    assert errs == []


# ------------------------------------------------------------ semantic class

def _noun(**kw):
    w = dict(lemma="puella", dict="puella, -ae f.", pos="N", gender="f", decl=1,
             meaning="girl", sense_full="girl", sem="person")
    w.update(kw)
    return _word(**w)


def _verb(**kw):
    w = _word(lemma="dō", dict="dō, dare, dedī, datum", pos="V", decl=None, meaning="give",
              sense_full="give", parts="dō, dare, dedī, datum",
              sem={"subj": ["person"], "obj": ["thing", "food"], "dat": ["person"]})
    w.update(kw)
    return w


@pytest.mark.parametrize("word,expected", [
    (_noun(sem=None), "noun without sem"),
    (_noun(sem="widget"), "is not a class"),
    (_verb(sem=None), "verb without sem"),
    (_word(sem=None), "adjective without sem"),
    (_verb(sem={"subj": ["person"]}), "is not {'subj'"),
    (_verb(sem={"subj": ["person"], "obj": [], "takes": "inf"}), "takes"),
    (_verb(sem={"subj": ["person"], "obj": [], "takes": ["dative"]}), "takes"),
    (_verb(sem={"subj": ["person"], "obj": [], "loc": ["place"]}), "is not {'subj'"),
    (_word(sem={"of": []}), "names no class and no word"),
    (_word(sem={"of": ["thing"], "det": "yes"}), "det must be true"),
    (_word(sem={"of": ["thing"], "colour": ["red"]}), "unknown key"),
    (_word(pos="ADV", dict="bene", meaning="well", sense_full="well", sem={"of": ["thing"]}),
     "carries a sem it cannot use"),
])
def test_check_sem_rejects_a_malformed_judgement(word, expected):
    if word.get("sem") is None:
        word.pop("sem", None)
    bad = bv.check_sem(word)
    assert bad is not None and expected in bad


@pytest.mark.parametrize("word", [
    _noun(),
    _verb(),
    _verb(sem={"subj": ["person"], "obj": [], "takes": ["inf", "acc_inf"]}),
    _verb(sem={"subj": [], "obj": [], "subj_only": ["sōl"], "dat_only": ["puer"], "dat_also": ["canis"]}),
    _word(sem={"of": [], "only": ["lingua"]}),
    _word(sem={"of": ["person"], "det": True, "number": "pl"}),
    _word(pos="CONJ", dict="et", meaning="and", sense_full="and", sem=None),
])
def test_check_sem_accepts_a_well_formed_judgement(word):
    if word.get("sem") is None:
        word.pop("sem", None)
    assert bv.check_sem(word) is None


def test_check_requires_every_verb_and_adjective_to_be_judged(tmp_path, monkeypatch):
    errs = _write_decks(tmp_path, {1: _deck(1, [_word(sem=None), _verb(sem=None)])}, monkeypatch)
    assert any("magnus adjective without sem" in e for e in errs)
    assert any("dō verb without sem" in e for e in errs)


def test_check_catches_a_deck_that_disagrees_with_sem_json(tmp_path, monkeypatch):
    errs = _write_decks(tmp_path, {1: _deck(1, [_noun()])}, monkeypatch,
                        sem_file={"N": {"puella": "animal"}, "ADJ": {}, "V": {}})
    assert errs == ["01.json: puella (N) sem disagrees with pipeline/sem.json"]
    errs = _write_decks(tmp_path, {1: _deck(1, [_noun()])}, monkeypatch,
                        sem_file={"N": {}, "ADJ": {}, "V": {}})
    assert errs == ["01.json: puella (N) has a sem that pipeline/sem.json lacks (run --dump-sem)"]


def test_the_file_wins_over_the_deck_on_a_rebuild(tmp_path, monkeypatch):
    _write_decks(tmp_path, {1: _deck(1, [_noun()])}, monkeypatch,
                 sem_file={"N": {"puella": "animal"}, "ADJ": {}, "V": {}})
    assert bv.load_sem()[("puella", "N")] == "animal"


def test_dump_sem_round_trips_the_decks(tmp_path, monkeypatch):
    _write_decks(tmp_path, {1: _deck(1, [_noun(), _verb(), _word()])}, monkeypatch)
    data = json.loads((tmp_path / "sem.json").read_text(encoding="utf-8"))
    assert data == {"N": {"puella": "person"}, "ADJ": {"magnus": {"of": ["thing", "place"]}},
                    "V": {"dō": {"subj": ["person"], "obj": ["thing", "food"], "dat": ["person"]}}}


def test_the_shipped_sem_json_covers_every_noun_verb_and_adjective():
    filed = bv.load_sem_file()
    missing = []
    for c in bv.CHAPTERS:
        for w in json.loads((bv.OUT_DIR / f"{c:02d}.json").read_text(encoding="utf-8"))["words"]:
            if w["pos"] in ("N", "V", "ADJ") and (bv.canonical(w["lemma"]), w["pos"]) not in filed:
                missing.append(w["lemma"])
    assert missing == []
    assert sum(1 for k in filed if k[1] == "N") == 562
    assert sum(1 for k in filed if k[1] == "V") == 551
    assert sum(1 for k in filed if k[1] == "ADJ") == 299


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


# ------------------------------------------------- plūrālia tantum (noun_number)

# Glossary entries as build_glossary writes them: Whitaker files a word used
# only in the plural under an invented singular head, and the plural marker sits
# on his first sense — the hook latin_forms.noun_number() reads.
PLURAL_ONLY = {
    "castrum": {"lemma": "castrum -ī n", "pos": "N", "h": "castrum", "cat": [2, 2], "gender": "n",
                "roots": ["castr", "castr"], "senses": ["camp (military; usually plural castra)", "fort"]},
    "tenebra": {"lemma": "tenebra -ae f", "pos": "N", "h": "tenebra", "cat": [1, 1], "gender": "f",
                "roots": ["tenebr", "tenebr"], "senses": ["darkness (in the plural), obscurity", "night"]},
    "liber": {"lemma": "liber līberī m", "pos": "N", "h": "liber", "cat": [2, 3], "gender": "m",
              "roots": ["liber", "līber"], "senses": ["children (in the plural)", "(singular vocative) child"]},
    "idus": {"lemma": "īdus -ūs f", "pos": "N", "h": "idus", "cat": [4, 1], "gender": "f",
             "roots": ["īd", "īd"], "senses": ["Ides (in the plural), abbreviation Id", "15th of month"]},
    # Ørberg prints a singular head for these two, so noun_number leaves them alone
    "gena": {"lemma": "gena -ae f", "pos": "N", "h": "gena", "cat": [1, 1], "gender": "f",
             "roots": ["gen", "gen"], "senses": ["cheeks (in the plural)", "eyes"]},
    # the lemma already prints the plural: nothing to rewrite
    "moene": {"lemma": "moenia -ium n pl", "pos": "N", "h": "moene", "cat": [3, 4], "gender": "n",
              "roots": ["moene", "moen"], "senses": ["defensive or town walls (in the plural)"]},
}


@pytest.mark.parametrize("h,expected,head", [
    ("castrum", "castra, -ōrum n. (plural only)", "castra"),
    ("tenebra", "tenebrae, -ārum f. (plural only)", "tenebrae"),
    ("liber", "līberī, -ōrum m. (plural only)", "līberī"),
    ("idus", "īdūs, -uum f. (plural only)", "īdūs"),
    ("gena", "gena, -ae f.", "gena"),
    ("moene", "moenia, -ium n. (plural only)", "moenia"),
])
def test_a_plurale_tantum_is_printed_in_the_plural(h, expected, head):
    entry = dict(PLURAL_ONLY[h], parses=[])
    got, parts = bv.dict_form(entry)
    assert got == expected
    assert parts is None
    assert bv.check_dict_line(got, "N") is None
    # the headword — and so the deck's own key — follows the dictionary line
    assert bv.headword(entry) == head


# ----------------------------------------- the long a of the 1st conjugation
#
# QA N-19: the decks printed "cantō, cantāre, cantavī, cantatum" and "lātrō,
# lātrāre, latravī, latratum".  A regular 1st-conjugation verb builds -āvī and
# -ātum on its own present stem, so the line that says -āre says them too;
# dō, stō, secō, vetō and cubō are not of that kind and keep their short a.

def _strip(s):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if not unicodedata.combining(c))


def _shipped_verbs():
    for c in bv.CHAPTERS:
        path = bv.OUT_DIR / f"{c:02d}.json"
        if not path.exists():
            continue
        for w in json.loads(path.read_text(encoding="utf-8")).get("words") or []:
            if w.get("pos") == "V" and w.get("dict"):
                yield path.name, w


@pytest.mark.parametrize("lemma,line", [
    ("lātrō", "lātrō, lātrāre, lātrāvī, lātrātum"),
    ("cantō", "cantō, cantāre, cantāvī, cantātum"),
    ("lūceō", "lūceō, lūcēre, lūxī"),
    ("dō", "dō, dāre, dedī, datum"),          # a short a the rule must not touch
    ("stō", "stō, stāre, stetī, statum"),
])
def test_the_shipped_dictionary_line_of_a_word_the_audit_named(lemma, line):
    got = [w for _, w in _shipped_verbs() if w["lemma"] == lemma]
    assert got, lemma
    assert got[0]["dict"] == line
    assert got[0]["parts"] == line


def test_no_deck_line_says_are_and_then_avi():
    bad = []
    for name, w in _shipped_verbs():
        parts = [p.strip() for p in w["dict"].split(",")]
        if len(parts) < 3 or not parts[1].endswith("āre"):
            continue
        stem = parts[1][:-3]
        flat = _strip(stem)
        if _strip(parts[2]) != flat + "avi":
            continue        # dō, stō, secō, vetō, cubō: the perfect is not -āvī at all
        for p in parts[2:]:
            want = {f"{flat}avi": f"{stem}āvī", f"{flat}atum": f"{stem}ātum"}.get(_strip(p))
            if want and p != want:
                bad.append((name, w["dict"]))
    assert bad == []
