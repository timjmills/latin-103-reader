"""
Build app/data/glossary.json from Whitaker's Words (blagae port) + supplements.

Run from anywhere:  python pipeline/build_glossary.py

Token set
---------
Every word in the Latin sections of source/week-*.md (the "### Textus Latīnus"
blocks) plus every key of the old data/whitaker-glossary-all-weeks.json, so
coverage never regresses. Keys in the output are lowercase, macron-stripped.

Whitaker
--------
Each form is parsed with Parser(frequency="F") — the widest net — and the
noise is handled by ranking (below). Enclitics -que/-ne/-ve are split by the
port; they become `enc`. Whitaker "packons" (quis-que, quī-dam, quis-quam,
-cumque) and the tackons -dem/-cum are folded into the headword instead
(quisque, īdem, sēcum) because the learner should see them as one word.

Gloss abbreviations
-------------------
data/gloss-abbreviations.json (same shape as a supplement) covers the
abbreviations and fragments of Ørberg's margin glosses that the reader can
tap: `m`, `pl`, `abl`, `comp` … and hyphenated pieces such as `-ōrum`,
`-ātis`, `-uisse`, `cōn-`, `-ficere`. The tokeniser keeps only letters, so
`-ōrum` is looked up as `orum`; the file is keyed on that bare form and the
`h` carries the hyphen for display. `t` is ABBR, ENDING, PREFIX or STEM (the
app shows it lowercased as the category). Entries go before Whitaker's
readings unless flagged `"last": true` (forms that are also real words: dat,
a, ī, is …), in which case they follow them.

Ranking of the entries under one form (lower sorts first)
---------------------------------------------------------
1. Supplement entries (data/supplement-week*.json) always come first, then
   gloss abbreviations (unless `last`).
2. Frequency rank of the lexeme: Very Frequent 0, Frequent 1, Common 2,
   Uncommon 3, Rare 4, Very Rare 5, inscription/graffiti/Pliny-only 6.
   Whitaker's "unique" irregular forms (sum, est, vult…) count as 0.
3. +1.5 when the analysis needed an enclitic split (so the whole-word reading
   quoque / bene / nōnne beats quō+que / be+ne / nōn+ne).
4. Within one lexeme the finite/infinitive entry (pos V) precedes the
   participle entry (pos VPAR).
5. An entry is *obscure* when its Age is Late/Later/Medieval/Scholar/Modern
   (D–H), its Area is Technical (T), its frequency rank is ≥ 4, or its source
   is "my personal guess" (W). Obscure entries are DROPPED whenever the same
   form also has a non-obscure entry with rank ≤ 2 (Common or better).
   Otherwise they are kept (something is better than "not in dictionary").
6. Duplicate lexemes (same headword, pos and senses — Whitaker lists mittō
   twice, as [3,1] and [8,3]) are merged into the better-ranked one.

Library counts (`n`)
--------------------
Whitaker's frequency is *Latin's* frequency, not this course's.  Every reading
that shares its key with another therefore carries `n`: how often the whole
library (the course weeks, the review shelf, the Colloquia, the margin glosses,
the summaries and the drills — collect_tokens()) prints any form of that
lexeme, macrons and all.  It is counted over the entry's whole paradigm because
the key's own spelling is precisely the one the rival readings share: `māla` is
printed 33 times and could be apples or cheeks, but `mālum/mālō/mālōrum` are
printed 64 times and `mālae/mālam/mālā` never.  dictionary.js ranks on it, and
the exact-spelling keys below are ordered by it.

Spelling
--------
See pipeline/macrons.py. Stems get macrons/v from the source tokens, then
from the hand table; otherwise no macrons. Endings in citation forms carry
their textbook macrons (-ō, -āre, -ārum, …).

Outputs
-------
app/data/glossary.json                 CONTRACT shape; `cat` and `gender`
                                       are omitted when null
data/build/glossary-misses-week-NN.txt forms Whitaker could not parse and no
                                       supplement covers, with source spellings
"""

from __future__ import annotations

import collections
import glob
import json
import math
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from macrons import (  # noqa: E402
    HAND_LEMMAS, HAND_ROOTS, HAND_WORDS, canonical, has_macron, restore_v, strip_macrons,
)
from senses import head_word, raw_string, rewrite_senses  # noqa: E402
import latin_forms  # noqa: E402

from whitakers_words.parser import Parser, UniqueLexeme, WordsException  # noqa: E402

SEED_FORMS = HERE / "seed-forms.txt"
SOURCE_DIR = ROOT / "source"
DATA_DIR = ROOT / "data"
BUILD_DIR = DATA_DIR / "build"
OUT_PATH = ROOT / "app" / "data" / "glossary.json"
OLD_GLOSSARY = DATA_DIR / "whitaker-glossary-all-weeks.json"
ABBREVIATIONS = DATA_DIR / "gloss-abbreviations.json"

WORD_RE = re.compile(r"[A-Za-zĀĒĪŌŪȲāēīōūȳ̄]+")
SECTION_RE = re.compile(r"###\s*Textus Lat[īi]nus\s*\n(.*?)(?=\n##|\Z)", re.S)
#: a capital, macronised or not — the glossary's only proper-name signal
CAPITAL = re.compile(r"^[A-ZĀĒĪŌŪŶ]")

FREQ_RANK = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "I": 6, "M": 6, "N": 6, "X": 2}
OBSCURE_AGES = set("DEFGH")
OBSCURE_AREAS = {"T"}
REAL_ENCLITICS = {"que", "ne", "ve"}

CASE = {"NOM": "nom", "VOC": "voc", "GEN": "gen", "DAT": "dat", "ACC": "acc", "ABL": "abl", "LOC": "loc"}
NUMBER = {"S": "sg", "P": "pl"}
GENDER = {"M": "m", "F": "f", "N": "n", "C": "c"}
TENSE = {"PRES": "pres", "IMPF": "impf", "FUT": "fut", "PERF": "perf", "PLUP": "plupf", "FUTP": "futperf"}
VOICE = {"ACTIVE": "act", "PASSIVE": "pass"}
MOOD = {"IND": "ind", "SUB": "subj", "IMP": "imper", "INF": "inf", "PPL": "ptc"}
DEGREE = {"COMP": "comp", "SUPER": "super"}
NUMKIND = {"CARD": "card", "ORD": "ord", "DIST": "dist", "ADVERB": "adv"}
PRONKIND = {"PERS": "pers", "REFLEX": "reflex", "DEMONS": "demons", "INDEF": "indef",
            "INTERR": "interr", "REL": "rel", "ADJECT": "adject"}

# Ranking nudges (see module docstring). Bonuses are subtracted from the
# frequency rank, so they only decide ties between equally frequent readings.
POS_BONUS = {"PRON": 0.5, "ADJ": 0.25, "PREP": 0.1}

# (lexpos, base headword) → (headword, lemma, senses) for words Whitaker only
# analyses as base + tackon -que although the -que is part of the word
QUE_COMPOUNDS = {
    ("ADJ", "uter"): ("uterque", "uterque, utraque, utrumque", ["each (of two), both"]),
    ("ADJ", "plerus"): ("plerique", "plērīque, plēraeque, plēraque", ["most, the greater part (of)"]),
}
# Ørberg's everyday words that Whitaker ties with a rarer homograph
# (vir/virus, aurum/auris, caelum/caelus, reperiō/repperiō, dux/dūcō …).
PREFERRED = {
    ("vir", "N"), ("dux", "N"), ("caelum", "N"), ("aurum", "N"), ("deus", "N"),
    ("male", "ADV"), ("bene", "ADV"), ("qui", "PRON"), ("is", "PRON"), ("hic", "PRON"),
    ("reperio", "V"), ("proficiscor", "V"), ("sequor", "V"), ("volo", "V"), ("forte", "ADV"),
    ("paucus", "ADJ"), ("multus", "ADJ"), ("magnus", "ADJ"), ("bonus", "ADJ"),
}
PREFERRED_BONUS = 1.0  # one frequency step: enough to lift proficīscor (B) over proficiō (A)

#: HAND_LEMMAS is keyed on the headword alone, and a few headwords cover two
#: Whitaker lexemes: volō "fly" (1st conjugation) is not volō, velle, and ēdō
#: "put out" is not edō, ēsse.  Without this, volāvit was captioned "volō,
#: velle, voluī".  (The generator still keys its irregular tables on `h`, so
#: the fly-verb is *also* given velle's table — that fix belongs in
#: latin_forms.py and app/js/paradigms.js together.)
HAND_LEMMA_CAT: dict[str, set[tuple[int, int]]] = {
    "V:volo": {(6, 2)},
    "V:edo": {(3, 1), (7, 3)},
}
# Per-form overrides: this reading of exactly this form goes first, whatever the
# frequencies say (forte in Ørberg is nearly always the adverb "by chance").
FORM_FIRST = {"forte": ("forte", "ADV"), "facta": ("factum", "N")}   # facta Mārcī = "the deeds of Marcus"

# English for numerals by value: cardinal, ordinal, distributive, adverb.
NUM_ENGLISH = {
    1: ("one", "first", "one each", "once"), 2: ("two", "second", "two each", "twice"),
    3: ("three", "third", "three each", "three times"), 4: ("four", "fourth", "four each", "four times"),
    5: ("five", "fifth", "five each", "five times"), 6: ("six", "sixth", "six each", "six times"),
    7: ("seven", "seventh", "seven each", "seven times"), 8: ("eight", "eighth", "eight each", "eight times"),
    9: ("nine", "ninth", "nine each", "nine times"), 10: ("ten", "tenth", "ten each", "ten times"),
    11: ("eleven", "eleventh", "eleven each", "eleven times"), 12: ("twelve", "twelfth", "twelve each", "twelve times"),
    20: ("twenty", "twentieth", "twenty each", "twenty times"), 30: ("thirty", "thirtieth", "thirty each", "thirty times"),
    100: ("a hundred", "hundredth", "a hundred each", "a hundred times"),
    1000: ("a thousand", "thousandth", "a thousand each", "a thousand times"),
}
NUM_KIND_INDEX = {"card": 0, "ord": 1, "dist": 2, "adv": 3}

# Learner senses for the words Whitaker glosses least helpfully.
SENSE_OVERRIDES = {
    ("N", "cohors"): ["cohort (a tenth of a legion, about 480 men)", "company, troop", "courtyard, enclosure"],
    ("N", "castra"): ["camp (military)", "the army in camp"],
    ("N", "castrum"): ["camp (military; usually plural castra)", "fort"],
    ("N", "libellus"): ["little book, booklet", "pamphlet, notice"],
    ("V", "sum"): ["be, exist", "there is / there are (est, sunt)", "with a dative: have (mihi est = I have)"],
    ("V", "nolo"): ["not want, be unwilling", "nōlī / nōlīte + infinitive = do not …"],
    ("V", "volo"): ["want, wish, be willing"],
    ("V", "malo"): ["prefer, want more"],
    ("V", "possum"): ["be able, can"],
    ("V", "eo"): ["go"],
    ("V", "fero"): ["carry, bring, bear", "endure, suffer", "report, say"],
    ("V", "fio"): ["become, be made, happen"],
    ("V", "inquam"): ["say (quoting someone: '…' inquit = '…' he says)"],
    ("N", "deus"): ["god", "God (in Christian texts)"],
    ("PRON", "is"): ["he, she, it, they", "that, this (pointing back to something already mentioned)"],
    ("PRON", "qui"): ["who, which, that (relative)", "which? what? (interrogative adjective)"],
    ("PRON", "quis"): ["who? what?", "anyone, anything (after sī, nisi, nē, num)"],
    ("PRON", "idem"): ["the same"],
    ("PRON", "ipse"): ["-self (himself, herself, itself, themselves)", "the very, the actual"],
    ("PRON", "hic"): ["this (near me)", "he, she, it"],
    ("PRON", "ille"): ["that (over there)", "he, she, it", "the famous"],
    ("PRON", "iste"): ["that (of yours)"],
    ("PRON", "ego"): ["I"],
    ("PRON", "tu"): ["you (one person)"],
    ("PRON", "nos"): ["we, us"],
    ("PRON", "vos"): ["you (more than one)"],
    ("PRON", "se"): ["himself, herself, itself, themselves (referring back to the subject)"],
    ("ADJ", "suus"): ["his own, her own, its own, their own (belonging to the subject)"],
    ("ADV", "vero"): ["truly, indeed", "but, however (second word of its sentence)"],
}

CASE_ORDER = {"nom": 0, "gen": 1, "dat": 2, "acc": 3, "abl": 4, "voc": 5, "loc": 6}
VPAR_ORDER = {"ptc": 0, "gerundive": 1, "gerund": 2, "supine": 3}


def learner_parse_order(parses: list[dict], pos: str, form: str) -> list[dict]:
    """Stable re-order: singular before plural, cases in learner order; verbs
    put the infinitive first and the archaic passive 2nd singular in -re last."""
    if pos == "V":
        def key(p):
            if p.get("mood") == "inf":
                return 0
            if p.get("voice") == "pass" and p.get("person") == 2 and p.get("number") == "sg" \
                    and p.get("mood") in ("ind", "imper") and form.endswith("re"):
                return 9
            return 1
        return sorted(parses, key=key)
    if pos in ("N", "ADJ", "PRON", "NUM", "VPAR"):
        def key(p):
            return (VPAR_ORDER.get(p.get("mood"), 0), 0 if p.get("number") in ("sg", None) else 1,
                    CASE_ORDER.get(p.get("case"), 9))
        return sorted(parses, key=key)
    return parses


# ---------------------------------------------------------------------------
# tokens


def latin_text(md: str) -> str:
    parts = SECTION_RE.findall(md)
    return "\n".join(parts) if parts else ""


def week_number(path: str) -> int:
    m = re.search(r"week-(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 0


def collect_tokens() -> dict[int, collections.Counter]:
    """week → Counter of original-spelling tokens (macrons kept, case kept)."""
    out: dict[int, collections.Counter] = {}
    for path in sorted(glob.glob(str(SOURCE_DIR / "week-*.md"))):
        md = open(path, encoding="utf-8").read()
        text = latin_text(md)
        if not text:
            print(f"warning: no Latin section found in {path}", file=sys.stderr)
        out[week_number(path)] = collections.Counter(WORD_RE.findall(text))
    # Words the reader can also tap: Ørberg's margin glosses (data/build/margin-week-NN.json)
    # and the Latin section summaries (data/summaries-week-NN.json).
    for path in sorted(glob.glob(str(ROOT / "data" / "build" / "margin-week-*.json"))) +             sorted(glob.glob(str(DATA_DIR / "summaries-week-*.json"))):
        n = week_number(path)
        try:
            j = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        texts = [g.get("la", "") for g in j] if isinstance(j, list) else [v.get("la", "") for v in j.values()]
        out.setdefault(n, collections.Counter()).update(WORD_RE.findall(" ".join(texts)))
    out.update(collect_shelf_tokens())
    return out


def _unit_texts(j: dict) -> list[str]:
    """Every Latin string a reader can tap in a built unit file."""
    texts: list[str] = []
    for u in j.get("units", []):
        texts.append(u.get("la") or "")
        for m in u.get("margin") or []:
            texts.append(m.get("la") or "")
    return texts


def collect_drill_tokens() -> collections.Counter:
    """The Latin the shipped drills print: the question sets' own questions and
    typed answers (app/data/grammar/questions/NN.json) and the vocabulary decks'
    dictionary lines (app/data/grammar/vocab/NN.json).  A question is authored
    Latin, not a quotation, so it can carry a form the library never prints —
    and the learner can tap every word of it."""
    c: collections.Counter = collections.Counter()
    for path in sorted(glob.glob(str(ROOT / "app" / "data" / "grammar" / "questions" / "[0-9]*.json"))):
        try:
            j = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for item in j.get("items", []):
            c.update(WORD_RE.findall(item.get("q") or ""))
            c.update(WORD_RE.findall(item.get("qword") or ""))
            for a in (item.get("answers") or []) + (item.get("choices") or []):
                if isinstance(a, str):
                    c.update(WORD_RE.findall(a))
    for path in sorted(glob.glob(str(ROOT / "app" / "data" / "grammar" / "vocab" / "[0-9]*.json"))):
        try:
            j = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for w in j.get("words", []):
            for field in ("dict", "parts"):
                c.update(WORD_RE.findall(w.get(field) or ""))
    return c


def collect_shelf_tokens() -> dict[int, collections.Counter]:
    """The rest of the library: Familia Rōmāna I–XXIV on the review shelf
    (data/build/review-NN.json, unit key 1NN) and Colloquia Persōnārum I–XXIV
    (data/build/collo-NN.json, unit key 2NN), plus the shelf teaching layer
    (data/shelf-notes-NN.json: part summaries, notes and highlight labels).

    These are the units the review shelf and the grammar question sets quote,
    so every word the learner can tap there has to be in the token set."""
    out: dict[int, collections.Counter] = {}
    for pattern, base in ((BUILD_DIR / "review-*.json", 100), (BUILD_DIR / "collo-*.json", 200)):
        for path in sorted(glob.glob(str(pattern))):
            m = re.search(r"-(\d+)\.json$", os.path.basename(path))
            if not m:
                continue
            try:
                j = json.load(open(path, encoding="utf-8"))
            except (OSError, ValueError):
                print(f"warning: could not read {path}", file=sys.stderr)
                continue
            n = j.get("week", {}).get("n") or base + int(m.group(1))
            out.setdefault(n, collections.Counter()).update(WORD_RE.findall(" ".join(_unit_texts(j))))
    out.setdefault(300, collections.Counter()).update(collect_drill_tokens())
    for path in sorted(glob.glob(str(DATA_DIR / "shelf-notes-*.json"))):
        m = re.search(r"-(\d+)\.json$", os.path.basename(path))
        if not m:
            continue
        try:
            j = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        texts: list[str] = []
        for part in (j.get("parts") or []) if isinstance(j, dict) else []:
            texts.append(part.get("summary_la") or "")
        for hl in (j.get("highlights") or []) if isinstance(j, dict) else []:
            texts.append(hl.get("text") or "")
        out.setdefault(100 + int(m.group(1)), collections.Counter()).update(
            WORD_RE.findall(" ".join(texts)))
    return out


# ---------------------------------------------------------------------------
# feature normalisation


def _name(v):
    return getattr(v, "name", None)


def norm_features(infl, pos: str) -> dict | None:
    f = infl.features
    wt = infl.wordType.name
    p: dict = {}
    if wt in ("N", "ADJ", "PRON", "NUM", "VPAR"):
        c = CASE.get(_name(f.get("Case")))
        n = NUMBER.get(_name(f.get("Number")))
        g = GENDER.get(_name(f.get("Gender")))
        if c:
            p["case"] = c
        if n:
            p["number"] = n
        if g:
            p["gender"] = g
        if wt == "ADJ":
            d = DEGREE.get(_name(f.get("Degree")))
            if d:
                p["degree"] = d
        if wt == "NUM":
            k = NUMKIND.get(_name(f.get("NumeralType")))
            if k:
                p["kind"] = k
        if wt == "VPAR":
            t = TENSE.get(_name(f.get("Tense")))
            v = VOICE.get(_name(f.get("Voice")))
            if t == "fut" and v == "pass":
                p["mood"] = "gerundive"
            else:
                p["mood"] = "ptc"
                p["tense"] = t
                p["voice"] = v
        return p
    if wt == "V":
        t = TENSE.get(_name(f.get("Tense")))
        v = VOICE.get(_name(f.get("Voice")))
        m = MOOD.get(_name(f.get("Mood")))
        if t:
            p["tense"] = t
        if v:
            p["voice"] = v
        if m:
            p["mood"] = m
        per = f.get("Person")
        if per is not None and per.value:
            p["person"] = per.value
        n = NUMBER.get(_name(f.get("Number")))
        if n:
            p["number"] = n
        return p
    if wt == "ADV":
        d = DEGREE.get(_name(f.get("Degree")))
        return {"degree": d} if d else {}
    return {}


def gerund_parses(parses: list[dict]) -> list[dict]:
    """A neuter singular gerundive in gen/dat/acc/abl may also be the gerund."""
    extra = []
    for p in parses:
        if p.get("mood") == "gerundive" and p.get("gender") == "n" and p.get("number") == "sg" \
                and p.get("case") in ("gen", "dat", "acc", "abl"):
            extra.append({"mood": "gerund", "case": p["case"]})
    return extra


def dedupe(parses: list[dict]) -> list[dict]:
    seen, out = set(), []
    for p in parses:
        k = json.dumps(p, sort_keys=True)
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out


# ---------------------------------------------------------------------------
# Whitaker analysis → intermediate records


class Rec:
    """One (lexeme, wordType) analysis of one form, before spelling/ranking."""

    __slots__ = ("form", "pos", "lexpos", "lexid", "roots", "cat", "lexform", "props",
                 "senses_raw", "infls", "enc", "enc_kind", "unique", "stem0")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


def inflection_freq_map(parser: Parser) -> dict[int, str]:
    """iid → Whitaker inflection frequency code (A = the normal ending)."""
    out: dict[int, str] = {}
    inflects = getattr(parser.data, "inflects", None) or {}
    for endings in inflects.values():
        for lst in endings.values():
            for infl in lst:
                out[infl["iid"]] = infl["props"][1] if infl.get("props") else "A"
    return out


INFL_FREQ: dict[int, str] = {}
#: forms the Whitaker port could not even attempt, form → error
PARSER_ERRORS: dict[str, str] = {}


#: the verbs whose 2nd singular present imperative really is the bare stem
SHORT_IMPERATIVES = ("dic", "duc", "fac", "fer")


def _fits_lexeme(infl, cat: list) -> bool:
    """Whitaker's own rule: an ending's declension/conjugation must match the
    lexeme's, 0 being the wildcard (`V 3 0` fits every 3rd-conjugation verb,
    `V 0 0` fits any).  The blagae port does not enforce it, so areō "be dry"
    (2nd) collects the 1st conjugation's participle arāns.

    VPAR is exempt: the port files *every* participle and gerundive under
    `VPAR 2 0` whatever the conjugation (agendī and audiendum both), so the
    category says nothing there — `_wrong_conjugation_vowel` reads the ending
    instead."""
    ic = list(getattr(infl, "category", None) or [])
    if not ic or not cat or infl.wordType.name == "VPAR":
        return True
    for a, b in zip(ic, cat):
        if a and b and a != b:
            return False
    return True


def _wrong_conjugation_vowel(infl, cat: list, roots: list) -> bool:
    """A present participle or gerundive built on another conjugation's stem:
    dicāre "dedicate" offered dīcēns / dīcendum, secāre the archaic gerundive
    secundus, pariō the 3rd conjugation's parēns for pariēns, areō "be dry"
    the 1st's arāns.  Only the present stem is checked — the perfect and
    future participles come off the supine stem and carry no conjugation
    vowel — and only the conjugations whose participle stem is fixed: the
    irregulars (sum, eō, velle, fīō) keep whatever the port gives them,
    absēns included."""
    if infl.wordType.name != "VPAR" or not cat or not roots:
        return False
    f = infl.features
    tense, voice = _name(f.get("Tense")), _name(f.get("Voice"))
    if not (tense == "PRES" or (tense == "FUT" and voice == "PASSIVE")):
        return False
    d, v = (list(cat) + [0, 0])[:2]
    r0 = str(roots[0] or "")
    r1 = str(roots[1]) if len(roots) > 1 and roots[1] not in ("-", "", None) else r0
    if d == 1:
        stems = [r1 + "a"]
    elif d == 2:
        stems = [r1 + "e"]
    elif d == 3 and (v == 4 or r0.endswith("i")):        # audiō, capiō, ēgredior
        stems = [r0 + "e", r0 + "u"]
    elif d == 3 and v in (1, 2):                          # regō, ferō (+ archaic -undus)
        stems = [r1 + "e", r1 + "u"]
    else:
        return False
    whole = (infl.stem or "") + (getattr(infl, "affix", None) or "")
    return not any(whole.startswith(s) for s in stems)


def _bare_stem_imperative(infl) -> bool:
    """The port's zero-ending 2nd singular imperative of the 3rd conjugation:
    `al`, `add`, `cap`, `sūm`.  That row belongs to dīc / dūc / fac / fer, not
    to every 3rd-conjugation verb, and a bare stem is not a word."""
    if infl.wordType.name != "V" or getattr(infl, "affix", None):
        return False
    if (list(getattr(infl, "category", None) or [0]) + [0])[0] != 3:
        return False
    f = infl.features
    if _name(f.get("Mood")) != "IMP" or _name(f.get("Tense")) != "PRES":
        return False
    return not strip_macrons(infl.stem).lower().endswith(SHORT_IMPERATIVES)


def analyse(parser: Parser, form: str) -> list[Rec]:
    try:
        word = parser.parse(form)
    except WordsException:
        return []
    except Exception as exc:                      # noqa: BLE001
        # the port raises KeyError('PACK') and friends on a few forms the
        # course texts never showed it; a form with no analysis is a miss,
        # not a build failure
        PARSER_ERRORS[form] = f"{type(exc).__name__}: {exc}"
        return []
    recs: list[Rec] = []
    for wform in word.forms:
        enc = wform.enclitic
        enc_text = enc.text if enc else None
        if enc_text is None:
            enc_kind = None
        elif enc_text in REAL_ENCLITICS and enc.position[0] != "PACK":
            enc_kind = "tackon"
        else:
            enc_kind = "fold"  # packons and -dem/-cum/-cumque…: part of the headword
        for an in wform.analyses.values():
            L = an.lexeme
            unique = isinstance(L, UniqueLexeme)
            lex_cat = list(L.category) if L.category else []
            lex_roots = list(L.roots) if L.roots else []
            by_wt: dict[str, list] = collections.OrderedDict()
            for infl in an.inflections:
                if not unique and (not _fits_lexeme(infl, lex_cat)
                                   or _wrong_conjugation_vowel(infl, lex_cat, lex_roots)):
                    continue
                if _bare_stem_imperative(infl):
                    continue
                by_wt.setdefault(infl.wordType.name, []).append(infl)
            for wt, infls in by_wt.items():
                # drop archaic/poetic ending variants (Whitaker freq B+) when a
                # normal (A) ending also explains the form: "hominis" is gen. sg.,
                # not the poetic accusative plural in -īs
                freqs = [INFL_FREQ.get(getattr(i, "id", None), "A") for i in infls]
                if "A" in freqs:
                    infls = [i for i, f in zip(infls, freqs) if f == "A"]
                recs.append(Rec(
                    form=form, pos=wt, lexpos=L.wordType.name, lexid=L.id,
                    roots=list(L.roots) if L.roots else [],
                    cat=list(L.category) if L.category else list(getattr(infls[0], "category", []) or []),
                    lexform=[str(x) for x in (getattr(L, "form", None) or [])],
                    props=list(L.props) if L.props else [],
                    senses_raw=list(L.senses), infls=infls, enc=enc_text, enc_kind=enc_kind,
                    unique=unique, stem0=infls[0].stem,
                ))
    return recs


# ---------------------------------------------------------------------------
# spelling


# Macrons the book prints and Whitaker's stems do not carry.
#
# `Speller` learns a stem's spelling from the source tokens, so a stem the
# course texts only ever show in one shape keeps whatever length that shape
# happens to reveal: a perfect stem seen only in the pluperfect, an oblique
# stem the text never inflects, a supine stem that never occurs at all.  Every
# root below is one the corpus prints long where the learnt spelling is short.
# They were found by generating each root's forms with pipeline/latin_forms.py
# and comparing them, letter by letter, against the macronised text the project
# already trusts — data/build/week-*.json and review-*.json with Ørberg's
# own margin glosses, and the Textus Latīnus of source/week-*.md — and each
# was then read off the printed page with fitz.  Nothing is here that the
# corpus does not attest; a root the corpus prints both ways (indignus,
# magnus, arcus, ubi, intrāre) is left alone.
#
# Where a correction is written for root 0 as well as root 1 the two are one
# morpheme, not two guesses: Whitaker splits a verb's present stem in two
# (nōscō / nōscere) and a 1st/2nd-declension noun's stem in two (nīdus /
# nīdī), and spells them alike; the nominative or the 1sg is attested in the
# corpus in every such row.  A noun whose nominative really is shorter than
# its oblique stem (clāmor / clāmōris, iānitor / iānitōris) keeps the two apart.
#
# Key: "<POS>:<Whitaker's own stems>" — the key `macrons.HAND_ROOTS` uses, and
# what `Speller.roots` has in hand.  Value: {root index: the printed spelling}.
# Whitaker sometimes lists one word twice (the personal and the impersonal
# iuvō, conveniō), and neighbours can share a stem list (vēna / vēnum /
# vēnus, vēr / vērum / vērū); such a key corrects all of them, which is right
# because every one of them is long.  The build reports any key that never
# fires, so a Whitaker update cannot leave a dead row here.
ROOT_MACRONS: dict[str, dict[int, str]] = {
    # --- nouns and adjectives
    "ADJ:frequens/frequent/frequenti/frequentissi": {0: "frequēns"},  # frequēns
    "ADJ:magn/magn/mai/maxi": {2: "māi", 3: "māxi"},                  # māior, māiōre, māiōris; māximus, māximē, māximō — and the margin "comp māior -ius, sup māximus -a -um"
    "N:clamor/clamor": {1: "clāmōr"},                                 # clāmōrem, clāmōre, clāmōrēs (root 0 already clāmor)
    "N:comoedi/comoedi": {0: "cōmoedi", 1: "cōmoedi"},                # cōmoedia, cōmoediam, cōmoediās
    "N:coniunx/coniug": {0: "coniūnx"},                               # coniūnx, in the chapter's own vocabulary list
    "N:dens/dent": {0: "dēns"},                                       # dēns
    "N:form/form": {1: "fōrm"},                                       # fōrmam (root 0 already fōrm)
    "N:frons/front": {0: "frōns"},                                    # frōns
    "N:ianitor/ianitor": {1: "iānitōr"},                              # iānitōrem, iānitōre, iānitōris, iānitōrēs, iānitōrī
    "N:leo/leon": {1: "leōn"},                                        # leōnēs, leōnis
    "N:mos/mor": {1: "mōr"},                                          # mōrēs, mōris
    "N:nid/nid": {0: "nīd", 1: "nīd"},                                # nīdus, nīdum, nīdī, nīdō, nīdōs
    "N:pes/ped": {0: "pēs"},                                          # pēs
    "N:person/person": {0: "persōn", 1: "persōn"},                    # persōna x61 against persona x4 on the page (the verb personō, a different stem list, keeps its short o)
    "N:prius/prior": {1: "priōr"},                                    # priōre
    "N:pulchritudo/pulchritudin": {0: "pulchritūdō"},                 # pulchritūdō
    "N:uen/uen": {0: "vēn", 1: "vēn"},                                # vēna, vēnam, vēnās (and vēnum / vēnus, which share the stems)
    "N:uer/uer": {0: "vēr"},                                          # vēr (root 1 already vēr)
    "N:uocabul/uocabul": {0: "vocābul", 1: "vocābul"},                # vocābulum, vocābula, vocābulō, vocābulīs
    # --- adverbs: the superlative's own -e
    "ADV:nuper/-/nuperrime": {2: "nūperrimē"},                        # nūperrimē on the page (Fabulae Syrae p. 82)
    "ADV:rare/rarius/rarissime": {1: "rārius", 2: "rārissimē"},       # rārius, rārissimē
    # --- present stems
    "V:educ/educ/edux/educt": {0: "ēdūc", 1: "ēdūc"},                 # ēdūcere, ēdūcit, ēdūcat — ēducāre (1st conj.) keeps its short u
    "V:eripi/erip/eripu/erept": {1: "ērip"},                          # ēripit, ēripiunt, ēripient
    "V:inscrib/inscrib/inscrips/inscript": {0: "īnscrib", 1: "īnscrib", 3: "īnscript"},  # īnscrībere, īnscriptum
    "V:nosc/nosc/nou/not": {0: "nōsc", 1: "nōsc"},                    # nōscere
    "V:pot/pot/potau/potat": {0: "pōt", 1: "pōt"},                    # pōtat, pōtāre, pōtātur, pōtābitis
    "V:prosili/prosil/prosiliu/-": {1: "prōsil"},                     # prōsilīre, prōsiliunt
    "V:sed/sed/sedau/sedat": {0: "sēd", 1: "sēd"},                    # sēdāre (sedō "settle", not sedeō)
    "V:transe/transi/transiu/transit": {0: "trānse"},                 # trānsīre, trānsībant, trānsīrent, trānsisse
    # --- perfect stems
    "V:caed/caed/cecid/caes": {2: "cecīd"},                           # the margin "caedere cecīdisse caesum" — cadō keeps its short cecid-
    "V:conueni/conuen/conuen/conuent": {2: "convēn"},                 # convēnerant
    "V:deb/deb/debu/debit": {2: "dēbu"},                              # dēbuit
    "V:effugi/effug/effug/effugit": {2: "effūg"},                     # effūgisse, effūgit, effūgī, effūgimus
    "V:em/em/em/empt": {2: "ēm"},                                     # ēmit, ēmistī, ēmerat, ēmisse
    "V:fugi/fug/fug/fugit": {2: "fūg"},                               # fūgī, fūgit, fūgisse, fūgērunt — the present stem stays short
    "V:iuu/iuu/iuu/iut": {2: "iūv"},                                  # iūvit, iūvisse, iūvistī
    "V:lau/lau/lau/laut": {2: "lāv"},                                 # lāvit, lāvisse
    "V:lau/lau/lau/lot": {2: "lāv"},                                  # the same verb under Whitaker's other supine
    "V:mou/mou/mou/mot": {2: "mōv"},                                  # mōvit, mōvisse, mōvērunt
    "V:neg/neg/negau/negat": {2: "negāv"},                            # negāverat
    "V:salut/salut/salutau/salutat": {2: "salūtāv"},                  # salūtāvit
    "V:sed/sed/sed/sess": {2: "sēd"},                                 # sēdit, sēdisse (sedeō)
    "V:signific/signific/significau/significat": {2: "significāv"},   # significāvit
    "V:teg/teg/tex/tect": {2: "tēx"},                                 # the margin "tegere tēxisse tēctum"
    "V:trad/trad/tradid/tradit": {2: "trādid"},                       # trādidit
    "V:uinci/uinc/uinx/uinct": {2: "vīnx"},                           # vīnxit
    # --- supine stems (the participle, and every compound tense built on it)
    "V:appell/appell/appellau/appellat": {3: "appellāt"},             # appellātum
    "V:dormi/dorm/dormiu/dormit": {3: "dormīt"},                      # dormītum, dormītūrus
    "V:elig/elig/eleg/elect": {3: "ēlect"},                           # ēlectō — the ē only; the corpus never shows the ē of ēlēctum
    "V:laud/laud/laudau/laudat": {3: "laudāt"},                       # laudātus, laudātī
    "V:mut/mut/mutau/mutat": {3: "mūtāt"},                            # mūtātum
    "V:oppugn/oppugn/oppugnau/oppugnat": {3: "oppugnāt"},             # oppugnātum
    "V:postul/postul/postulau/postulat": {3: "postulāt"},             # postulātum
    "V:puls/puls/pulsau/pulsat": {3: "pulsāt"},                       # pulsātus, pulsātum
    "V:puni/pun/puniu/punit": {3: "pūnīt"},                           # pūnītī
}
# Whitaker gives several *different* words the same stems, and `Speller` learns
# a stem's spelling from the page, so a macronised token feeds every one of the
# homographs: mālum "apple" and malum "evil" both live under `N:mal/mal`, and
# the corpus prints both, so the learnt spelling is a coin toss and `mālum`
# came out short.  ROOT_MACRONS cannot help — its key is the stem list, which is
# exactly what these words share.  This table is keyed by the stem list AND
# Whitaker's own first sense, which is what tells the homographs apart.  Every
# row is a word the book prints long; its short twin is deliberately left
# alone, and that is the point — it is what lets `māla` (apples) and `mala`
# (bad) be told apart at all.
LEXEME_MACRONS: dict[tuple[str, str, str], dict[int, str]] = {
    ("N", "mal/mal", "apple"): {0: "māl", 1: "māl"},               # mālum -ī n
    ("N", "mal/mal", "mast"): {0: "māl", 1: "māl"},                # mālus -ī m
    ("N", "mal/mal", "apple tree"): {0: "māl", 1: "māl"},          # mālus -ī f
    ("N", "mal/mal", "cheeks, jaws"): {0: "māl", 1: "māl"},        # māla -ae f
}
#: every LEXEME_MACRONS key that matched, for the build's own report
LEXEME_MACRONS_USED: set[tuple[str, str, str]] = set()


#: every ROOT_MACRONS key `Speller.roots` matched, for the build's own report
ROOT_MACRONS_USED: set[str] = set()


class Speller:
    """Learns stem spellings from the source tokens; falls back to hand tables."""

    def __init__(self):
        self.by_lex: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
        self.by_stem: dict[tuple, collections.Counter] = collections.defaultdict(collections.Counter)
        self.forms: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)

    def learn_form(self, original: str, count: int = 1):
        self.forms[canonical(original)][original] += count

    def learn(self, original: str, rec: Rec):
        canon = canonical(original)
        low = strip_macrons(original).lower()  # keeps v/j, drops macrons
        for infl in rec.infls:
            stem = infl.stem
            tail = infl.affix + (rec.enc or "")
            if canon != canonical(stem) + canonical(tail):
                continue
            if len(low) != len(canon):
                continue  # ligature or odd char; skip
            spelled = original[: len(stem)].lower()
            try:
                idx = rec.roots.index(stem)
            except ValueError:
                idx = -1
            if rec.lexpos == "N" and idx >= 0 and len(rec.roots) > 1 and rec.roots[0] == rec.roots[1]:
                # same string for both roots: nominative/vocative singular (and
                # neuter accusative) use root 0, everything else root 1 — their
                # vowel length can differ (color / colōris)
                case = _name(infl.features.get("Case"))
                num = _name(infl.features.get("Number"))
                neuter = bool(rec.lexform) and rec.lexform[0] == "N"
                idx = 0 if num == "S" and (case in ("NOM", "VOC") or (neuter and case == "ACC")) else 1
            if rec.lexid and idx >= 0:
                self.by_lex[(rec.lexpos, rec.lexid, idx)][spelled] += 1
            self.by_stem[(rec.lexpos, canonical(stem))][spelled] += 1

    @staticmethod
    def _best(counter: collections.Counter) -> str | None:
        if not counter:
            return None
        # most frequent; tie → fewer macrons (the citation ending carries length)
        return sorted(counter.items(), key=lambda kv: (-kv[1], sum(has_macron(c) for c in kv[0])))[0][0]

    def spell_form(self, ascii_form: str) -> str:
        best = self._best(self.forms.get(ascii_form, collections.Counter()))
        return best.lower() if best else ascii_form

    def roots(self, rec: Rec) -> list[str]:
        roots = rec.roots or [rec.stem0]
        key = f"{rec.lexpos}:{'/'.join(roots)}"
        hand = HAND_ROOTS.get(key)
        out = []
        same_noun_roots = rec.lexpos == "N" and len(roots) > 1 and roots[0] == roots[1] and rec.cat and rec.cat[0] == 3
        for i, r in enumerate(roots):
            if r == "-" or r == "":
                out.append(r)
                continue
            if hand and i < len(hand):
                out.append(hand[i])
                continue
            s = self._best(self.by_lex.get((rec.lexpos, rec.lexid, i), collections.Counter()))
            if s is None and same_noun_roots and i == 0:
                # nominative never seen: take the oblique spelling but drop a
                # macron on its last vowel (color / colōris, animal / animālis)
                obl = self._best(self.by_lex.get((rec.lexpos, rec.lexid, 1), collections.Counter()))
                if obl is not None:
                    s = drop_final_macron(obl)
            if s is None and not same_noun_roots:
                s = self._best(self.by_stem.get((rec.lexpos, r), collections.Counter()))
            if s is None:
                s = restore_v(r, rec.lexpos, i, next_char=citation_next_char(rec, i))
            out.append(s)
        # nominative of a noun/adjective with a different oblique stem: copy the
        # macrons of the shared prefix (rēg- → rēx, fēlīc- → fēlīx, ātr- → āter)
        if rec.lexpos in ("N", "ADJ") and len(out) > 1 and out[0] and out[1] and out[1] != "-" \
                and not has_macron(out[0]) and has_macron(out[1]) and canonical(out[0]) != canonical(out[1]):
            a, b = canonical(out[0]), canonical(out[1])
            k = 0
            while k < min(len(a), len(b)) and a[k] == b[k]:
                k += 1
            if k >= 2 and len(strip_macrons(out[1][:k])) == k and has_macron(out[1][:k]):
                out[0] = out[1][:k] + out[0][k:]
        # last word: the macrons the book prints that neither the source
        # tokens nor HAND_ROOTS could give (ROOT_MACRONS above)
        for i, spelled in (ROOT_MACRONS.get(key) or {}).items():
            if i < len(out) and canonical(out[i]) == canonical(spelled):
                out[i] = spelled
                ROOT_MACRONS_USED.add(key)
        # and the homographs Whitaker files under one stem list (mālum / malum)
        lkey = (rec.lexpos, "/".join(roots), rec.senses_raw[0] if rec.senses_raw else "")
        for i, spelled in (LEXEME_MACRONS.get(lkey) or {}).items():
            if i < len(out) and canonical(out[i]) == canonical(spelled):
                out[i] = spelled
                LEXEME_MACRONS_USED.add(lkey)
        return out


_FINAL_VOWEL_MACRON = re.compile(r"([āēīōū])([^aeiouāēīōū]*)$")
_UNMACRON = {"ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u"}


def drop_final_macron(s: str) -> str:
    return _FINAL_VOWEL_MACRON.sub(lambda m: _UNMACRON[m.group(1)] + m.group(2), s)


def citation_next_char(rec: Rec, i: int) -> str:
    """First letter of the ending that follows root i in the citation form."""
    pos, cat = rec.lexpos, rec.cat
    if pos == "V":
        return ["o", "e", "i", "u"][i] if i < 4 else ""
    if pos in ("N", "ADJ", "NUM", "PRON"):
        if cat and cat[0] == 2 and cat[1] == 3 and i == 0:
            return ""
        return "u" if i == 0 else "i"
    return ""


# ---------------------------------------------------------------------------
# citation forms

GENDER_LABEL = {"m": "m", "f": "f", "n": "n", "c": "m/f", None: ""}


def ascii_head(text: str) -> str:
    """Ascii headword key of a lemma: first word, macrons off, lowercase, v kept."""
    head = text.split(",")[0].split()[0] if text.strip() else ""
    return re.sub(r"[^a-z]", "", strip_macrons(head).lower())


def noun_lemma(roots: list[str], cat: list, gender: str | None, proper: bool) -> tuple[str, str]:
    """→ (lemma, ascii headword)."""
    d, v = (cat + [0, 0])[:2] if cat else (0, 0)
    r0 = roots[0] if roots else ""
    r1 = roots[1] if len(roots) > 1 and roots[1] not in ("-", "") else r0
    g = GENDER_LABEL.get(gender, "")

    def hy(nom_end: str, gen_end: str, gen_stem: str | None = None) -> str:
        nom = r0 + nom_end
        stem_for_gen = gen_stem if gen_stem is not None else r1
        if stem_for_gen == r0:
            gen = "-" + gen_end
        else:
            gen = stem_for_gen + gen_end
        return f"{nom} {gen} {g}".strip()

    if d == 1:
        lemma = {6: hy("ē", "ēs"), 7: hy("ēs", "ae"), 8: hy("ās", "ae")}.get(v, hy("a", "ae"))
    elif d == 2:
        if v == 2:
            lemma = hy("um", "ī")
        elif v == 3:
            lemma = f"{r0} {r1}ī {g}".strip() if r1 != r0 else f"{r0} -ī {g}".strip()
        elif v == 4:
            lemma = hy("um", "ī") if gender == "n" else hy("us", "ī")  # cōnsilium, not "cōnsilius"
        elif v == 5:
            lemma = f"{r0}um -ī {g}".strip() if gender == "n" else f"{r0}us -ī {g}".strip()
        elif v == 6:
            lemma = hy("os", "ī")
        elif v == 8:
            lemma = hy("on", "ī")
        else:
            lemma = hy("us", "ī")
    elif d == 3:
        if r1 == r0:
            lemma = f"{r0} -is {g}".strip()
        elif r0.startswith(r1):
            lemma = f"{r0} -{r0[len(r1):] and ''}{r1[len(r1):]}is {g}".replace("--", "-").strip()
            lemma = f"{r0} -is {g}".strip() if not r0.startswith(r1) else f"{r0} {r1}is {g}".strip()
            # e.g. turris turris → 'turris -is'; urbs urbis
            lemma = f"{r0} -is {g}".strip() if r0 == r1 + r0[len(r1):] and r0[len(r1):] in ("is", "es", "s", "e", "") and r0[len(r1):] != "" else f"{r0} {r1}is {g}".strip()
        else:
            lemma = f"{r0} {r1}is {g}".strip()
    elif d == 4:
        lemma = hy("ū", "ūs") if v == 2 else hy("us", "ūs")
    elif d == 5:
        gen_end = "ēī" if r0 and r0[-1] in "aeiouāēīōū" else "eī"
        lemma = hy("ēs", gen_end)
    elif d == 9:
        lemma = f"{r0} {g} (indeclinable)".strip()
    else:
        lemma = f"{r0} {g}".strip()
    if proper and lemma:
        lemma = lemma[0].upper() + lemma[1:]
    return lemma, ascii_head(lemma)


def adj_lemma(roots: list[str], cat: list, lexform: list[str]) -> tuple[str, str]:
    d, v = (cat + [0, 0])[:2] if cat else (0, 0)
    r = roots + ["-"] * (4 - len(roots))
    r0, r1, r2, r3 = r[:4]
    deg = lexform[0] if lexform else "X"
    if deg == "COMP" or (d == 0 and r2 not in ("-", "")):
        base = r2 if r2 not in ("-", "") else r0
        lemma = f"{base}or -us"
    elif deg == "SUPER":
        lemma = f"{r0}us -a -um"
    elif d == 1:
        if v == 2:
            lemma = f"{r0} {r1}a {r1}um"
        elif v == 3:
            lemma = f"{r0}us -a -um (gen. -īus)"
        elif v == 4:
            lemma = f"{r0} {r1}a {r1}um (gen. -īus)"
        elif v == 5:
            lemma = f"{r0}us -a -ud (gen. -īus)"
        else:
            lemma = f"{r0}us -a -um"
    elif d == 3:
        if v == 2:
            lemma = f"{r0}is -e"
        elif v == 3:
            lemma = f"{r0} {r1}is {r1}e"
        else:
            lemma = f"{r0} (gen. {r1}is)"
    elif d == 2:
        lemma = f"{r0}os -ē -on"
    elif d == 9:
        lemma = f"{r0} (indeclinable)"
    else:
        lemma = r0
    return lemma, ascii_head(lemma)


VERB_ENDINGS = {
    1: ("ō", "āre", "ārī"), 2: ("eō", "ēre", "ērī"), 3: ("ō", "ere", "ī"), 4: ("iō", "īre", "īrī"),
}


def verb_lemma(roots: list[str], cat: list, lexform: list[str]) -> tuple[str, str]:
    d, v = (cat + [0, 0])[:2] if cat else (0, 0)
    r = roots + ["-"] * (4 - len(roots))
    r0, r1, r2, r3 = r[:4]
    vt = lexform[0] if lexform else "X"
    dep = vt == "DEP"
    semi = vt == "SEMIDEP"
    perfdef = vt == "PERFDEF"

    def parts(first: str, inf: str, perf: str | None, sup: str | None) -> str:
        out = [first, inf]
        if perf:
            out.append(perf)
        if sup:
            out.append(sup)
        return ", ".join(out)

    conj = None
    if d == 1:
        conj = 1
    elif d == 2:
        conj = 2
    elif d == 3 and v == 4:
        conj = 4
    elif d == 3 and v == 1:
        conj = 3
    if perfdef and r2 not in ("-", ""):
        lemma = f"{r2}ī, {r2}isse"
        return lemma, ascii_head(r2 + "i")
    if conj:
        end1, inf, infpass = VERB_ENDINGS[conj]
        if conj in (3, 4) and r0.endswith("i"):
            end1 = "ō"  # capi + ō = capiō, audi + ō = audiō
        if dep:
            first = r0 + ("or" if conj != 2 else "eor")
            if conj == 3 and r0.endswith("i"):
                first = r0 + "or"
            sup = f"{r3}us sum" if r3 not in ("-", "") else None
            lemma = parts(first, r1 + infpass, None, sup)
        elif semi:
            sup = f"{r3}us sum" if r3 not in ("-", "") else None
            lemma = parts(r0 + end1, r1 + inf, None, sup)
        elif vt == "IMPERS":
            third = {1: "at", 2: "et", 3: "it", 4: "it"}[conj]
            perf = f"{r2}it" if r2 not in ("-", "") else None
            lemma = parts(r1 + third, r1 + inf, perf, None) + " (impersonal)"
            return lemma, ascii_head(r1 + third)
        else:
            perf = f"{r2}ī" if r2 not in ("-", "") else None
            sup = f"{r3}um" if r3 not in ("-", "") else None
            lemma = parts(r0 + end1, r1 + inf, perf, sup)
        return lemma, ascii_head(lemma)
    # irregulars
    if d == 5:
        first = r0 + "um"
        h = ascii_head(first)
        return HAND_LEMMAS.get(f"V:{h}", parts(first, r1 + "esse", f"{r2}ī" if r2 not in ("-", "") else None,
                                                 f"{r3}ūrum" if r3 not in ("-", "") else None)), h
    if d == 6 and v == 1:
        first = r0 + "ō"
        h = ascii_head(first)
        inf = (r1[:-1] if r1.endswith("i") else r1) + "īre"
        perf = ((r2[:-1] if r2.endswith("u") else r2) + "iī") if r2 not in ("-", "") else None
        sup = f"{r3}um" if r3 not in ("-", "") else None
        return HAND_LEMMAS.get(f"V:{h}", parts(first, inf, perf, sup)), h
    if d == 6 and v == 2:
        first = r0 + "ō"
        h = ascii_head(first)
        return HAND_LEMMAS.get(f"V:{h}", parts(first, r1 + "le", f"{r2}ī" if r2 not in ("-", "") else None, None)), h
    if d == 3 and v == 2:  # ferō and compounds
        first = r0 + "ō"
        h = ascii_head(first)
        return HAND_LEMMAS.get(f"V:{h}", parts(first, r1 + "re", f"{r2}ī" if r2 not in ("-", "") else None,
                                                 f"{r3}um" if r3 not in ("-", "") else None)), h
    if d == 3 and v == 3:  # fīō
        first = r0 + "ō"
        h = ascii_head(first)
        return HAND_LEMMAS.get(f"V:{h}", parts(first, r1 + "ierī", None, f"{r3}us sum" if r3 not in ("-", "") else None)), h
    if d == 7:
        first = r0 + ("ō" if r0 else "")
        if r0 == "inqui":
            return HAND_LEMMAS["V:inquam"], "inquam"
        if r0 == "ai":
            return HAND_LEMMAS["V:aio"], "aio"
        h = ascii_head(first)
        return HAND_LEMMAS.get(f"V:{h}", first + " (defective)"), h
    first = r0 + "ō"
    return first, ascii_head(first)


PRON_HEAD = {
    (4, 1): "is", (4, 2): "idem", (6, 2): "ipse",
    (5, 1): "ego", (5, 2): "tu", (5, 4): "se",
}
#: Whitaker files hic, iste and ille under one demonstrative paradigm (3, 1)
#: as well as under (6, 1); only the stem tells them apart, and without this
#: istōs and illōs were entered as forms of hic.
DEMONSTRATIVE_STEM = {"ist": "iste", "istu": "iste", "ill": "ille", "illu": "ille"}


def pron_lemma(rec: Rec, roots: list[str], spelled_form: str) -> tuple[str, str, str | None]:
    """→ (lemma, h, kind)."""
    cat = tuple((rec.cat + [0, 0])[:2]) if rec.cat else (0, 0)
    kind = PRONKIND.get(rec.lexform[0]) if rec.lexform else None
    r0 = rec.roots[0] if rec.roots else rec.stem0
    h = None
    if cat in PRON_HEAD:
        h = PRON_HEAD[cat]
    elif cat == (3, 1):
        h = DEMONSTRATIVE_STEM.get(r0, "hic")
    elif cat == (6, 1):
        h = "ille" if r0 == "ill" else ("iste" if r0 == "ist" else None)
    elif cat == (5, 3):
        h = "nos" if r0 == "n" else "vos"
    elif cat[0] == 1:
        prefix = r0[:-2] if r0.endswith("qu") else ""
        base = "quis" if kind in ("interr", "indef") else "qui"
        if r0 == "qu" or r0.endswith("qu"):
            h = prefix + base
        if rec.enc and rec.enc_kind == "fold":
            h = (h or "qui") + rec.enc
            if rec.enc == "dam":
                h = prefix + "qui" + "dam"
    if rec.enc and rec.enc_kind == "fold" and cat[0] != 1:
        # īdem (is + dem), sēcum, mēcum: keep the base headword
        if rec.enc == "dem":
            h = "idem"
    if h is None:
        h = ascii_head(spelled_form)
    lemma = HAND_LEMMAS.get(f"PRON:{h}")
    if lemma is None:
        lemma = HAND_WORDS.get(h, h)
    if rec.enc == "cum" and rec.enc_kind == "fold":
        lemma += " (+ -cum: with)"
    return lemma, h, kind


def num_lemma(rec: Rec, roots: list[str], parses: list[dict]) -> tuple[str, str]:
    kinds = {p.get("kind") for p in parses}
    r = roots + ["-"] * (4 - len(roots))
    value = rec.lexform[1] if len(rec.lexform) > 1 else None
    cat = tuple((rec.cat + [0, 0])[:2]) if rec.cat else (0, 0)
    if "ord" in kinds and r[1] not in ("-", ""):
        return f"{r[1]}us -a -um", ascii_head(r[1] + "us")
    if "dist" in kinds and r[2] not in ("-", ""):
        return f"{r[2]}ī -ae -a", ascii_head(r[2] + "i")
    if "adv" in kinds and r[3] not in ("-", ""):
        return r[3], ascii_head(r[3])
    if str(value) == "1":
        return HAND_LEMMAS["NUM:unus"], "unus"
    if str(value) == "2":
        return HAND_LEMMAS["NUM:duo"], "duo"
    if str(value) == "3":
        return HAND_LEMMAS["NUM:tres"], "tres"
    if str(value) == "1000":
        return HAND_LEMMAS["NUM:mille"], "mille"
    if cat == (2, 0):
        return f"{r[0]} (indeclinable)", ascii_head(r[0])
    if cat == (1, 2) and r[0] not in ("-", "") and str(value) not in ("2",):
        return f"{r[0]}ī -ae -a", ascii_head(r[0] + "i")
    return r[0], ascii_head(r[0])


# ---------------------------------------------------------------------------
# records → entries


def is_obscure(props: list[str]) -> bool:
    if not props:
        return False
    age, area, _geo, freq, source = (props + ["X"] * 5)[:5]
    return age in OBSCURE_AGES or area in OBSCURE_AREAS or FREQ_RANK.get(freq, 2) >= 4 or source == "W"


def freq_rank(rec: Rec) -> float:
    if rec.unique or not rec.props:
        base = 0
    else:
        base = FREQ_RANK.get(rec.props[3], 2)
    return base + (1.5 if rec.enc else 0)


def build_entry(rec: Rec, speller: Speller) -> dict | None:
    pos = rec.pos
    lexpos = rec.lexpos
    parses = [q for q in (norm_features(i, pos) for i in rec.infls) if q is not None]
    parses = dedupe(parses)
    if pos == "VPAR":
        parses += gerund_parses(parses)
    roots = speller.roots(rec)
    spelled_form = speller.spell_form(rec.form)
    if rec.enc and rec.enc_kind == "tackon":
        base_form = rec.form[: -len(rec.enc)]
        spelled_form = speller.spell_form(base_form)
    gender = None
    cat = list(rec.cat) if rec.cat else None
    lemma, h, kind = None, None, None

    if lexpos == "N" and rec.unique and tuple((cat + [0, 0])[:2] if cat else (0, 0)) == (2, 1):
        # Whitaker's hand-listed forms of deus (dī, dīs, deus voc.) have no lexeme;
        # without this they were lemmatised as "dius", "disus", "deusus".
        gender = "m"
        lemma, h, roots = "deus -ī m", "deus", ["de", "de"]
    elif lexpos == "N":
        gender = GENDER.get(rec.lexform[0]) if rec.lexform else None
        ntype = rec.lexform[1] if len(rec.lexform) > 1 else "X"
        proper = ntype in ("N", "L", "G")
        # Whitaker offers a locative for every noun; learners only meet it with
        # place names (Rōmae, Athēnīs, domī) — keep it only for place nouns.
        # -ius/-ium nouns: Whitaker rates the genitive in -iī below the
        # locative, so the ending filter left only "locative" for imperiī, ōtiī …
        # Only the *singular* locative stands in for the genitive singular: the
        # locative plural is the dative/ablative plural (cōnsiliīs), and reading
        # a genitive singular out of it invented cōnsiliīs "of the plan".
        if cat and cat[:2] == [2, 4] \
                and any(p.get("case") == "loc" and p.get("number") == "sg" for p in parses) \
                and not any(p.get("case") == "gen" and p.get("number") == "sg" for p in parses):
            parses.append({"case": "gen", "number": "sg", **({"gender": gender} if gender else {})})
        if ntype not in ("L", "W"):
            non_loc = [p for p in parses if p.get("case") != "loc"]
            if non_loc:
                parses = non_loc
        lemma, h = noun_lemma(roots, cat or [], gender, proper)
        if not lemma:
            return None
    elif lexpos == "ADJ":
        lemma, h = adj_lemma(roots, cat or [], rec.lexform)
        degs = {p.get("degree") for p in parses}
        r = roots + ["-"] * 4
        if "comp" in degs and r[2] not in ("-", "") and not lemma.startswith(r[2]):
            lemma += f" · comparative {r[2]}or, {r[2]}us"
        if "super" in degs and r[3] not in ("-", "") and not lemma.startswith(r[3]):
            lemma += f" · superlative {r[3]}mus -a -um"
    elif lexpos == "V":
        if rec.unique:
            # sum / est / vult … : the port has no lexeme; the inflection carries [5,1]/[6,2]
            c = tuple((cat + [0, 0])[:2]) if cat else (0, 0)
            if c == (5, 1):
                h, roots = "sum", ["s", "es", "fu", "fut"]
            elif c == (6, 2):
                # volō / nōlō / mālō share one Whitaker table; the stem decides:
                # ma(uis, uult…) → mālō, no(n uis, nolumus…) → nōlō, else (uis, uult,
                # uultis, uolo, uelle…) → volō. "uis" is *volō* "you want", not nōlō.
                stem = rec.stem0
                h = "malo" if stem.startswith("ma") else ("nolo" if stem.startswith("no") else "volo")
                roots = {"volo": ["vol", "vel", "volu", "-"], "nolo": ["nōl", "nōl", "nōlu", "-"],
                         "malo": ["māl", "māl", "mālu", "-"]}[h]
            else:
                h = ascii_head(rec.stem0)
            lemma = HAND_LEMMAS.get(f"V:{h}", h)
        else:
            lemma, h = verb_lemma(roots, cat or [], rec.lexform)
        vt = rec.lexform[0] if rec.lexform else "X"
        if vt in ("DEP", "SEMIDEP", "IMPERS", "PERFDEF"):
            kind = vt.lower()
    elif lexpos == "PRON":
        lemma, h, kind = pron_lemma(rec, roots, spelled_form)
    elif lexpos == "NUM":
        lemma, h = num_lemma(rec, roots, parses)
        kinds = [p.get("kind") for p in parses if p.get("kind")]
        kind = kinds[0] if kinds else None
    elif lexpos == "PREP":
        h = ascii_head(roots[0] if roots else spelled_form)
        lemma = HAND_WORDS.get(h) or spelled_form
        governs = rec.lexform[0].lower() if rec.lexform else None
        parses = [{"governs": governs}] if governs else []
        kind = governs
    else:  # ADV CONJ INTERJ
        h = ascii_head(roots[0] if roots else spelled_form)
        lemma = HAND_WORDS.get(h) or (spelled_form if ascii_head(spelled_form) == h else h)
        if lexpos == "ADV" and len(roots) > 1 and all(r not in ("-", "") for r in roots[:3]):
            degs = {p.get("degree") for p in parses}
            if "comp" in degs:
                lemma = f"{roots[1]} (comparative of {roots[0]})"
            elif "super" in degs:
                lemma = f"{roots[2]} (superlative of {roots[0]})"
    # -que that is part of the word, not "and": uterque, plērīque (Whitaker only
    # knows them as uter / plērus + tackon)
    if rec.enc == "que" and rec.enc_kind == "tackon" and (lexpos, h) in QUE_COMPOUNDS:
        h, lemma, rec.senses_raw = QUE_COMPOUNDS[(lexpos, h)]
        rec.enc, rec.enc_kind = None, None
    # fold packons/-dem/-cum into the displayed word
    if rec.enc and rec.enc_kind == "fold" and lexpos not in ("PRON",):
        if rec.enc == "cum":
            lemma = f"{lemma} (+ -cum: with)"
        else:
            lemma = f"{lemma} + -{rec.enc}"

    senses = rewrite_senses(rec.senses_raw)
    if lexpos == "NUM" and rec.lexform and len(rec.lexform) > 1:
        try:
            value = int(rec.lexform[1])
        except (TypeError, ValueError):
            value = None
        if value in NUM_ENGLISH and kind in NUM_KIND_INDEX:
            senses = [NUM_ENGLISH[value][NUM_KIND_INDEX[kind]]]
    if lexpos in ("N", "ADJ", "V", "NUM") and not rec.unique:
        hand_key = f"{lexpos}:{h}"
        allowed = HAND_LEMMA_CAT.get(hand_key)
        if allowed is None or tuple((cat + [0, 0])[:2] if cat else (0, 0)) in allowed:
            lemma = HAND_LEMMAS.get(hand_key, lemma)
    senses = SENSE_OVERRIDES.get((lexpos if lexpos != "VPAR" else "V", h), senses)
    if not senses:
        return None
    parses = learner_parse_order(parses, pos, rec.form)
    entry = {
        "lemma": lemma,
        "h": h,
        "pos": pos,
        "cat": cat if cat else None,
        "gender": gender,
        "roots": roots,
        "parses": parses,
        "senses": senses,
        "raw": raw_string(rec.senses_raw),
        "enc": rec.enc if rec.enc_kind == "tackon" else None,
    }
    if kind:
        entry["kind"] = kind
    return entry


MAX_ENTRIES_PER_FORM = 8


def supine_entries(entries: list[dict], form: str) -> list[dict]:
    """Add explicit supine parses: participle stem + um / ū."""
    out = []
    for e in entries:
        if e["pos"] not in ("V", "VPAR") or not e["roots"] or len(e["roots"]) < 4:
            continue
        sup = e["roots"][3]
        if sup in ("-", ""):
            continue
        base = canonical(sup)
        if form == base + "um":
            case = "acc"
        elif form == base + "u":
            case = "abl"
        else:
            continue
        if e["pos"] == "VPAR" and not any(p.get("mood") == "supine" for p in e["parses"]):
            e["parses"].append({"mood": "supine", "case": case})
        elif e["pos"] == "V":
            twin = dict(e, pos="VPAR", parses=[{"mood": "supine", "case": case}])
            out.append(twin)
    return out


# ---------------------------------------------------------------------------
# ranking / merging


def rank_and_filter(recs: list[Rec], entries: list[dict], form: str | None = None) -> list[dict]:
    scored = []
    for rec, e in zip(recs, entries):
        if e is None:
            continue
        score = freq_rank(rec) - (5.0 if form and FORM_FIRST.get(form) == (e["h"], e["pos"]) else 0) - POS_BONUS.get(e["pos"], 0) - (PREFERRED_BONUS if ((e["h"], e["pos"]) in PREFERRED or (e["pos"] == "VPAR" and (e["h"], "V") in PREFERRED)) else 0)
        # Whitaker's V 8 lexemes are a second, archaic-stem copy of a verb he
        # also lists normally (capiō with capsō, servō with servāssō): stemless,
        # so the app can draw no table for them.  They must never beat the real
        # capiō, capere, cēpī, captum to the front of `cape`.
        if (rec.cat or [0])[0] == 8:
            score += 2.0
        # tie-break identical frequencies: Whitaker's hand-listed irregular forms
        # (sum, vult, vīs) first, then the longer first root (sequor over the stray "secor")
        rootlen = -1000 if rec.unique else (-len(rec.roots[0]) if rec.roots else 0)
        # among equals, the lexeme whose headword *is* the form (quisque over quīque)
        own = 0 if e["h"] == rec.form else 1
        scored.append((score, rootlen, own, rec.lexid or 0, 1 if e["pos"] == "VPAR" else 0, is_obscure(rec.props), e))
    if not scored:
        return []
    has_common = any((not obsc) and rank <= 2 for rank, _, _, _, _, obsc, _ in scored)
    if has_common:
        scored = [s for s in scored if not s[5]]
    # a whole-word reading (quisque, neque, itaque, ubīque) always outranks an
    # enclitic split of the same form (quis + -que), whatever the frequencies
    scored.sort(key=lambda s: (1 if s[6]["enc"] else 0, s[0], s[1], s[2], s[3], s[4]))
    # merge duplicate lexemes into the better-ranked one: same lemma + pos
    # (acūtus twice with different senses, mittō [3,1] and [8,3]) or same senses
    # + pos under a ghost spelling (sequor / "secor", abiciō / "abiiciō");
    # pronouns merge on h + pos alone (quī rel/interr/indef/adject are one word
    # to the learner). Parses are unioned; unseen senses are appended (≤ 4).
    merged: list[dict] = []
    for *_, e in scored:
        target = None
        for m in merged:
            if m["pos"] != e["pos"] or m["enc"] != e["enc"]:
                continue
            if e["pos"] == "PRON":
                same = m["h"] == e["h"]
            else:
                same = m["lemma"] == e["lemma"] or m["senses"] == e["senses"]
            if same:
                target = m
                break
        if target is None:
            merged.append(e)
            continue
        # Whitaker often lists one verb twice, under different conjugations
        # (possideō as [2,1] and as a stemless [3,1]) or with different stems
        # (accurrō with accucurr- and with accurr-).  Merging their senses is
        # right; merging their *parses* is not — it made possidet a future and
        # accurrit a perfect of a table that spells those possidēbit and
        # accucurrit.  Where the two really are one lexeme under two spellings
        # (abiciō / "abiiciō", mittō [3,1] / [8,3]) the parses are the same and
        # the union changes nothing anyway.
        if target["cat"] == e["cat"] and target["roots"] == e["roots"]:
            target["parses"] = dedupe(target["parses"] + e["parses"])
        if target["cat"] is None and e["cat"]:
            target["cat"], target["roots"] = e["cat"], e["roots"]
        for s in e["senses"]:
            if s not in target["senses"] and len(target["senses"]) < 4:
                target["senses"].append(s)
    return merged[:MAX_ENTRIES_PER_FORM]


# ---------------------------------------------------------------------------
# sum — the port's hand list (esse.py) lacks the infinitives, the perfect
# system and the future participle, so they are added here.

_ADJ12_PARSES = {
    "us": [("nom", "sg", "m")], "a": [("nom", "sg", "f"), ("abl", "sg", "f"), ("nom", "pl", "n"), ("acc", "pl", "n")],
    "um": [("acc", "sg", "m"), ("nom", "sg", "n"), ("acc", "sg", "n")], "i": [("gen", "sg", "m"), ("gen", "sg", "n"), ("nom", "pl", "m")],
    "ae": [("gen", "sg", "f"), ("dat", "sg", "f"), ("nom", "pl", "f")], "o": [("dat", "sg", "m"), ("abl", "sg", "m"), ("dat", "sg", "n"), ("abl", "sg", "n")],
    "am": [("acc", "sg", "f")], "orum": [("gen", "pl", "m"), ("gen", "pl", "n")], "arum": [("gen", "pl", "f")],
    "is": [("dat", "pl", None), ("abl", "pl", None)], "os": [("acc", "pl", "m")], "as": [("acc", "pl", "f")], "e": [("voc", "sg", "m")],
}


def sum_forms() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = collections.defaultdict(list)
    persons = [(1, "sg"), (2, "sg"), (3, "sg"), (1, "pl"), (2, "pl"), (3, "pl")]
    tables = {
        ("pres", "ind"): ["sum", "es", "est", "sumus", "estis", "sunt"],
        ("impf", "ind"): ["eram", "erās", "erat", "erāmus", "erātis", "erant"],
        ("fut", "ind"): ["erō", "eris", "erit", "erimus", "eritis", "erunt"],
        ("perf", "ind"): ["fuī", "fuistī", "fuit", "fuimus", "fuistis", "fuērunt"],
        ("plupf", "ind"): ["fueram", "fuerās", "fuerat", "fuerāmus", "fuerātis", "fuerant"],
        ("futperf", "ind"): ["fuerō", "fueris", "fuerit", "fuerimus", "fueritis", "fuerint"],
        ("pres", "subj"): ["sim", "sīs", "sit", "sīmus", "sītis", "sint"],
        ("impf", "subj"): ["essem", "essēs", "esset", "essēmus", "essētis", "essent"],
        ("perf", "subj"): ["fuerim", "fuerīs", "fuerit", "fuerīmus", "fuerītis", "fuerint"],
        ("plupf", "subj"): ["fuissem", "fuissēs", "fuisset", "fuissēmus", "fuissētis", "fuissent"],
    }
    for (t, m), forms in tables.items():
        for (p, n), f in zip(persons, forms):
            out[strip_macrons(f)].append({"tense": t, "voice": "act", "mood": m, "person": p, "number": n})
    out["es"].append({"tense": "pres", "voice": "act", "mood": "imper", "person": 2, "number": "sg"})
    out["este"].append({"tense": "pres", "voice": "act", "mood": "imper", "person": 2, "number": "pl"})
    out["esto"].append({"tense": "fut", "voice": "act", "mood": "imper", "person": 2, "number": "sg"})
    out["estote"].append({"tense": "fut", "voice": "act", "mood": "imper", "person": 2, "number": "pl"})
    out["esse"].append({"tense": "pres", "voice": "act", "mood": "inf"})
    out["fuisse"].append({"tense": "perf", "voice": "act", "mood": "inf"})
    out["fore"].append({"tense": "fut", "voice": "act", "mood": "inf"})
    for end, plist in _ADJ12_PARSES.items():
        for c, n, g in plist:
            p = {"case": c, "number": n, "mood": "ptc", "tense": "fut", "voice": "act"}
            if g:
                p["gender"] = g
            out["futur" + end].append(p)
    return out


SUM_FORMS = sum_forms()


def sum_entry(form: str) -> dict | None:
    parses = SUM_FORMS.get(form)
    if not parses:
        return None
    is_ptc = any(p.get("mood") == "ptc" for p in parses)
    return {
        "lemma": HAND_LEMMAS["V:sum"], "h": "sum", "pos": "VPAR" if is_ptc else "V", "cat": [5, 1],
        "gender": None, "roots": ["s", "es", "fu", "fut"], "parses": parses,
        "senses": list(SENSE_OVERRIDES[("V", "sum")]), "raw": "to be, exist", "enc": None,
    }


# ---------------------------------------------------------------------------
# supplements

SUP_CASES = {"nom": "nom", "gen": "gen", "dat": "dat", "acc": "acc", "abl": "abl", "voc": "voc",
             "loc": "loc", "locative": "loc"}
SUP_TENSES = {"pres": "pres", "impf": "impf", "imperf": "impf", "fut": "fut", "perf": "perf",
              "plupf": "plupf", "pluperf": "plupf", "futperf": "futperf", "futpf": "futperf"}
SUP_MOODS = {"ind": "ind", "subj": "subj", "imper": "imper", "imp": "imper", "inf": "inf",
             "ptc": "ptc", "part": "ptc", "gerund": "gerund", "gerundive": "gerundive", "supine": "supine"}


def parse_feature(fstr: str, pos: str) -> list[dict]:
    note = None
    m = re.search(r"\(([^)]*)\)", fstr)
    if m:
        note = m.group(1).strip()
        fstr = fstr[: m.start()].strip()
    toks = fstr.replace(",", " ").split()
    if pos == "PREP":
        gov = None
        for t in toks:
            if t in ("abl", "acc", "gen"):
                gov = t
        return [{"governs": gov}] if gov else []
    if pos in ("ADV", "CONJ", "INTERJ"):
        out = {}
        if "comparative" in toks:
            out["degree"] = "comp"
        if "superlative" in toks:
            out["degree"] = "super"
        if note:
            out["note"] = note
        return [out] if out else []
    cases: list[str] = []
    number = None
    genders: list[str] = []
    tense = voice = mood = None
    person = None
    degree = None
    for t in toks:
        tl = t.lower()
        parts = tl.split("/")
        if all(p in SUP_CASES for p in parts):
            cases = [SUP_CASES[p] for p in parts]
        elif tl in ("sg", "pl"):
            number = tl
        elif all(p in ("m", "f", "n") for p in parts):
            genders = parts
        elif tl in SUP_TENSES:
            tense = SUP_TENSES[tl]
        elif tl in ("act", "pass"):
            voice = tl
        elif tl in SUP_MOODS:
            mood = SUP_MOODS[tl]
        elif re.fullmatch(r"[123]p?", tl):
            person = int(tl[0])
        elif tl in ("comparative",):
            degree = "comp"
        elif tl in ("superlative",):
            degree = "super"
        elif tl in ("deponent", "greek", "vocative"):
            pass
    out = []
    if pos in ("V", "VPAR") and (tense or mood):
        if mood in ("ptc", "gerundive", "gerund", "supine"):
            for c in cases or [None]:
                for g in genders or [None]:
                    p = {"mood": mood}
                    if mood == "ptc":
                        p["tense"], p["voice"] = tense, voice
                    if c:
                        p["case"] = c
                    if number:
                        p["number"] = number
                    if g:
                        p["gender"] = g
                    out.append(p)
        else:
            p = {"tense": tense, "voice": voice or "act", "mood": mood or "ind"}
            if person:
                p["person"] = person
            if number:
                p["number"] = number
            out.append(p)
    else:
        for c in cases or [None]:
            for g in genders or [None]:
                p = {}
                if c:
                    p["case"] = c
                if number:
                    p["number"] = number
                if g:
                    p["gender"] = g
                if degree:
                    p["degree"] = degree
                if p:
                    out.append(p)
    if note:
        for p in out:
            p["note"] = note
    return out


def _hyphen_stem(head: str, gen: str) -> str | None:
    """'Hector' + 'oris' → 'Hector'; 'lītus' + 'oris' → 'lītor'; 'expugnātiō' + 'ōnis' → 'expugnātiōn'."""
    g = gen[:-2] if gen.endswith("is") else gen
    for k in range(min(len(head), len(g)), 0, -1):
        if canonical(head[-k:]) == canonical(g[:k]):
            return head[:-k] + g
    if head.endswith("us") and g.startswith(("or", "er")):
        return head[:-2] + g
    if head.endswith("s"):
        base = head[:-1]
        if canonical(base).endswith(canonical(g)):
            return base
        return base + g
    return None


def supplement_entry(form: str, s: dict) -> dict | None:
    hstr = s.get("h", "").strip()
    pos = s.get("t", "").strip()
    if not hstr or not pos:
        return None
    toks = hstr.replace(",", " ").split()
    head = toks[0]
    h = ascii_head(head)
    cat = None
    roots: list[str] = []
    gender = None
    kind = None
    rest = toks[1:]
    if pos == "N":
        for t in rest:
            if t in ("m", "f", "n"):
                gender = t
            elif t == "m/f":
                gender = "c"
        gen = next((t for t in rest if t.startswith("-") or (t not in ("m", "f", "n", "pl", "m/f") and canonical(t).endswith(("is", "ae", "i", "us", "ei")))), None)
        if gen:
            g = gen.lstrip("-")
            gc = canonical(g)
            hc = canonical(head)
            if gc == "ae" or gc == "arum":
                cat, stem = [1, 1], head[:-1] if hc.endswith("a") else head[:-2]
                roots = [stem, stem]
            elif gc == "i" and hc.endswith("us"):
                cat, roots = [2, 1], [head[:-2], head[:-2]]
            elif gc == "i" and hc.endswith("um"):
                cat, roots = [2, 2], [head[:-2], head[:-2]]
            elif gc == "i" and hc.endswith(("er", "ir")):
                cat, roots = [2, 3], [head, head]
            elif gc == "orum" and hc.endswith("i"):
                cat, roots = [2, 1], [head[:-1], head[:-1]]
            elif gc == "us" and hc.endswith("us"):
                cat, roots = [4, 1], [head[:-2], head[:-2]]
            elif gc == "ei" and hc.endswith("es"):
                cat, roots = [5, 1], [head[:-2], head[:-2]]
            elif gc.endswith("is"):
                if gen.startswith("-"):
                    if gc == "is" and hc.endswith("is"):
                        stem = head[:-2]
                    elif gc == "is":
                        stem = head
                    else:
                        stem = _hyphen_stem(head, g)
                else:
                    stem = g[:-2]
                if stem:
                    cat = [3, 2] if gender == "n" else ([3, 3] if hc.endswith("is") else [3, 1])
                    roots = [head, stem]
    elif pos == "ADJ":
        hc = canonical(head)
        if "-a" in rest and "-um" in rest and hc.endswith("us"):
            cat, roots = [1, 1], [head[:-2], head[:-2], "-", "-"]
        elif "-e" in rest and hc.endswith("is"):
            cat, roots = [3, 2], [head[:-2], head[:-2], "-", "-"]
        elif "(indeclinable)" in hstr:
            cat, roots = [9, 1], [head, head, "-", "-"]  # necesse, quot, nēquam
    elif pos == "V":
        hc = canonical(head)
        dep = "deponent" in hstr or hc.endswith("or")
        inf = next((t for t in rest if t.startswith("-") and canonical(t).endswith(("re", "ri"))), None)
        conj = None
        if inf:
            ic = canonical(inf)
            conj = {"-are": 1, "-ere": 2, "-ire": 4, "-ari": 1, "-eri": 2, "-i": 3, "-iri": 4}.get(ic)
            if ic == "-ere" and not has_macron(inf):
                conj = 3
        if conj:
            cat = {1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [3, 4]}[conj]
            if dep:
                stem = head[:-2] if not hc.endswith("eor") else head[:-3]
            else:
                stem = head[:-1] if hc.endswith("o") else head
                if conj == 2 and hc.endswith("eo"):
                    stem = head[:-2]
            r1 = stem
            if conj == 3 and canonical(stem).endswith("i"):
                r1 = stem[:-1]
            if conj == 4:
                r1 = stem[:-1] if canonical(stem).endswith("i") else stem
            perf, sup = "-", "-"
            for t in rest:
                tc = canonical(t)
                if t.startswith("-") and tc.endswith("i") and not tc.endswith("ri"):
                    perf = stem + t[1:-1]
                elif t.startswith("-") and tc.endswith("um"):
                    sup = stem + t[1:-2]
                elif tc.endswith("us") and "sum" in rest:
                    sup = t[:-2]
                elif not t.startswith("-") and tc.endswith("i") and t != head and not tc.endswith("ri"):
                    perf = t[:-1]
            roots = [stem, r1, perf, sup]
            if dep:
                kind = "dep"
    parses: list[dict] = []
    for fstr in s.get("f", []) or []:
        parses.extend(parse_feature(fstr, pos))
    for p in parses:
        if p.get("note", "").lower() in ("deponent", "greek vocative"):
            if p["note"].lower() == "deponent":
                del p["note"]
        if kind == "dep" and "voice" in p and p.get("mood") not in ("ptc",):
            p["voice"] = "pass"
    parses = dedupe(parses)
    senses = rewrite_senses([s.get("s", "")])
    if not senses:
        return None
    e = {
        "lemma": hstr, "h": h, "pos": pos, "cat": cat, "gender": gender, "roots": roots,
        "parses": parses, "senses": senses, "raw": s.get("s", ""), "enc": (s.get("e") or None) or None,
    }
    if kind:
        e["kind"] = kind
    if pos == "PREP" and parses:
        e["kind"] = parses[0].get("governs")
    return e


def load_supplements() -> tuple[dict[str, list[dict]], dict[str, str]]:
    """→ (canonical form → entries, canonical form → display key)."""
    out: dict[str, list[dict]] = collections.defaultdict(list)
    keys: dict[str, str] = {}
    for path in sorted(glob.glob(str(DATA_DIR / "supplement-week*.json"))):
        data = json.load(open(path, encoding="utf-8"))
        for form, items in data.items():
            key = canonical(form)
            keys.setdefault(key, strip_macrons(form).lower())
            for s in items:
                e = supplement_entry(key, s)
                if e and e not in out[key]:
                    out[key].append(e)
    return out, keys


def load_abbreviations() -> tuple[dict[str, list[dict]], dict[str, list[dict]], dict[str, str]]:
    """data/gloss-abbreviations.json → (first, last, display keys), keyed on the
    canonical bare form (`-ōrum` → `orum`); `last` entries follow Whitaker's."""
    first: dict[str, list[dict]] = collections.defaultdict(list)
    last: dict[str, list[dict]] = collections.defaultdict(list)
    keys: dict[str, str] = {}
    if not ABBREVIATIONS.exists():
        return first, last, keys
    data = json.load(open(ABBREVIATIONS, encoding="utf-8"))
    for form, items in data.items():
        key = canonical(form.lstrip("-"))
        keys.setdefault(key, strip_macrons(form.lstrip("-")).lower())
        for s in items:
            e = supplement_entry(key, s)
            if e is None:
                continue
            bucket = last if s.get("last") else first
            if e not in bucket[key]:
                bucket[key].append(e)
    return first, last, keys


# ---------------------------------------------------------------------------
# proper names
#
# The library's own cast.  Whitaker has no Familia Rōmāna, so `Iūlia` used to
# come back as the adjective *iūlius -a -um* ("July"), `Aemilia` as "Aemilian",
# `Mārcō` as *mārcēre* "be withered", and `Daedalus` — week 2's title
# character — as "skillful".  Every person, place and people the library names
# is listed below with the spelling the book prints and a one-line gloss in the
# project's register; the forms are generated by pipeline/latin_forms.py, so a
# name resolves in every case, not only in the one case a supplement happened
# to list.
#
# Key: the citation form.  A second word beginning with "-" is an ending
# (`Iūlius -ī m`); a full word is the genitive and gives the oblique stem
# (`Lēander Lēandrī m`, `Arīōn Arīonis m`).  `pl` means the name has no
# singular (`Athēnae -ārum f pl`).  Adjectives are written `-a -um` / `-e`.
# The macrons were read off the printed page (LLPSI Pars I, Colloquia
# Persōnārum, Fabulae Syrae) with fitz and checked against the library text;
# where the two disagreed the book won (Īcarus, Tūsculum, Lȳdia — the PDF text
# layer cannot render ȳ at all, and prints Icarus only where it drops the
# macron everywhere else too).
NAMES: list[tuple[str, str]] = [
    # --- the household of Iūlius (Familia Rōmāna, Colloquia Persōnārum)
    ("Iūlius -ī m", "Julius, the father of the family (Lūcius Iūlius Balbus)"),
    ("Aemilia -ae f", "Aemilia, Julius's wife, the mother of the family"),
    ("Mārcus -ī m", "Marcus, Julius's elder son"),
    ("Quīntus -ī m", "Quintus, Julius's younger son"),
    ("Iūlia -ae f", "Julia, Julius's daughter"),
    ("Iūliola -ae f", "little Julia (Julia's pet name)"),
    ("Syra -ae f", "Syra, the slave-woman who looks after Julia"),
    ("Dāvus -ī m", "Davus, a slave of Julius"),
    ("Mēdus -ī m", "Medus, the Greek slave who runs away to Greece"),
    ("Lȳdia -ae f", "Lydia, Medus's beloved, a Christian woman of Rome"),
    ("Dēlia -ae f", "Delia, a slave-woman (ancilla) of Aemilia"),
    ("Philippa -ae f", "Philippa, the slave-woman who does Aemilia's hair"),
    ("Proculus -ī m", "Proculus, the man Philippa loves"),
    ("Ursus -ī m", "Ursus, a slave of Julius, one of the litter-bearers"),
    ("Syrus -ī m", "Syrus, a slave of Julius who carries the bags"),
    ("Lēander Lēandrī m", "Leander, a slave of Julius who carries the bags"),
    ("Fabricius -ī m", "Fabricius, the slave who helped Marcus run away"),
    ("Zēnō Zēnōnis m", "Zeno, the slave to whom Marcus dictates his letter"),
    ("Faustīnus -ī m", "Faustinus, Julius's shepherd (pāstor)"),
    ("Margarīta -ae f", "Margarita, Julia's little dog"),
    ("Balbus -ī m", "Balbus, Julius's third name (cognōmen)"),
    ("Aemilius -ī m", "Aemilius, Aemilia's younger brother, a soldier in Germania"),
    # --- neighbours, friends, the school, the town
    ("Cornēlius -ī m", "Cornelius, Julius's friend and neighbour near Tusculum"),
    ("Fabia -ae f", "Fabia, Cornelius's wife"),
    ("Orontēs Orontis m", "Orontes, a Greek friend and dinner-guest of Julius"),
    ("Paula -ae f", "Paula, Orontes's wife"),
    ("Sextus -ī m", "Sextus, a schoolfellow of Marcus and Quintus"),
    ("Titus -ī m", "Titus, a schoolfellow of Marcus and Quintus"),
    ("Diodōrus -ī m", "Diodorus, the boys' schoolmaster, a Greek"),
    ("Dōrippa -ae f", "Dorippa, Diodorus's wife"),
    ("Sanniō Sanniōnis m", "Sannio, the doorkeeper (iānitor) of Diodorus's house"),
    ("Symmachus -ī m", "Symmachus, a guest at Diodorus's table"),
    ("Lepidus -ī m", "Lepidus, a friend of Marcus"),
    ("Albīnus -ī m", "Albinus, the shopkeeper (tabernārius) at Tusculum"),
    ("Rūfus -ī m", "Rufus, the neighbour whose garden the sheep get into"),
    ("Flōra -ae f", "Flora, the girl who sells roses in the market"),
    ("Tlēpolemus -ī m", "Tlepolemus, the letter-carrier (tabellārius)"),
    ("Metella -ae f", "Metella, Aemilia's friend, who writes her a letter"),
    ("Crassus -ī m", "Crassus (Crassus Dīves), the rich man Aemilia once loved"),
    # --- the Christian story (cap. XXIII, XXVIII, XXXIII)
    ("Iēsūs Iēsū m", "Jesus"),
    ("Chrīstus -ī m", "Christ"),
    ("Petrus -ī m", "Peter, the disciple of Jesus"),
    ("Marīa -ae f", "Mary, the mother of Jesus"),
    ("Matthaeus -ī m", "Matthew, the disciple who wrote the first gospel"),
    ("Iāīrus -ī m", "Jairus, whose daughter Jesus raised from the dead"),
    ("Bethlehem f (indeclinable)", "Bethlehem, the town in Judaea where Jesus was born"),
    # --- Roman names, history and public life
    ("Caesar Caesaris m", "Caesar (Gaius Julius Caesar), the Roman general and dictator"),
    ("Augustus -ī m", "Augustus, the first Roman emperor"),
    ("Gāius -ī m", "Gaius, a Roman first name (praenōmen)"),
    ("Pūblius -ī m", "Publius, a Roman first name (praenōmen)"),
    ("Lūcius -ī m", "Lucius, a Roman first name (praenōmen)"),
    ("Aulus -ī m", "Aulus, a Roman first name (praenōmen)"),
    ("Decimus -ī m", "Decimus, a Roman first name (praenōmen)"),
    ("Gnaeus -ī m", "Gnaeus, a Roman first name (praenōmen)"),
    ("Mānlius -ī m", "Manlius (Titus Manlius Torquatus), who had his own son put to death"),
    ("Torquātus -ī m", "Torquatus, the third name (cognōmen) of Titus Manlius"),
    ("Pompēius -ī m", "Pompey, the general who cleared the sea of pirates"),
    ("Valerius -ī m", "Valerius, a Roman family name (nōmen)"),
    ("Rōmulus -ī m", "Romulus, the founder and first king of Rome"),
    ("Remus -ī m", "Remus, Romulus's twin brother"),
    ("Coriolānus -ī m", "Coriolanus, the Roman general who led the Volsci against Rome"),
    ("Veturia -ae f", "Veturia, Coriolanus's mother, who begged him to spare Rome"),
    ("Volumnia -ae f", "Volumnia, Coriolanus's wife"),
    ("Dionysius -ī m", "Dionysius, the tyrant of Syracuse"),
    ("Damoclēs Damoclis m", "Damocles, seated at the tyrant's feast under a hanging sword"),
    ("Polycratēs Polycratis m", "Polycrates, tyrant of Samos, whose lost ring came back in a fish"),
    ("Periander Periandrī m", "Periander, tyrant of Corinth and Arion's friend"),
    # --- poets, philosophers, grammarians
    ("Catullus -ī m", "Catullus, the Roman poet of the Lesbia poems"),
    ("Lesbia -ae f", "Lesbia, the woman Catullus writes his poems to"),
    ("Ovidius -ī m", "Ovid, the Roman poet of love and of the Metamorphoses"),
    ("Mārtiālis Mārtiālis m", "Martial, the Roman poet of epigrams"),
    ("Lucrētius -ī m", "Lucretius, the Roman poet of 'the nature of things'"),
    ("Ennius -ī m", "Ennius, the earliest great Roman poet"),
    ("Tibullus -ī m", "Tibullus, the Roman poet of the quiet country life"),
    ("Plautus -ī m", "Plautus, the Roman writer of comedies"),
    ("Dōnātus -ī m", "Donatus, the Roman grammarian whose lesson cap. XXXV quotes"),
    ("Sōcratēs Sōcratis m", "Socrates, the Athenian philosopher"),
    ("Platō Platōnis m", "Plato, the Athenian philosopher, Socrates' pupil"),
    ("Aristotelēs Aristotelis m", "Aristotle, the Greek philosopher, Plato's pupil"),
    ("Dēmocritus -ī m", "Democritus, the Greek philosopher of atoms"),
    ("Epicūrus -ī m", "Epicurus, the Greek philosopher of pleasure"),
    ("Hippocratēs Hippocratis m", "Hippocrates, the Greek physician"),
    ("Marō Marōnis m", "Maro, Virgil's third name (cognōmen)"),
    # --- the people Catullus and Martial address
    ("Cinna -ae m", "Cinna, a would-be poet mocked by Martial"),
    ("Fabullus -ī m", "Fabullus, the friend Catullus invites to dinner"),
    ("Sabidius -ī m", "Sabidius, the man Martial cannot say why he dislikes"),
    ("Māmercus -ī m", "Mamercus, who wants to be thought a poet without reciting"),
    ("Fīdentīnus -ī m", "Fidentinus, who recites Martial's poems as his own"),
    ("Fabulla -ae f", "Fabulla, the woman in Martial who praises herself too much"),
    ("Bassa -ae f", "Bassa, a woman in Martial's epigrams"),
    ("Gellia -ae f", "Gellia, who weeps for her father only when someone is watching"),
    ("Laecānia -ae f", "Laecania, whose gleaming white teeth are bought"),
    ("Thāis Thāidis f", "Thais, the woman in Martial with black teeth"),
    ("Pontiliānus -ī m", "Pontilianus, who keeps sending Martial his own books"),
    ("Aemiliānus -ī m", "Aemilianus, a man addressed in an epigram of Martial"),
    ("Caediciānus -ī m", "Caedicianus, a man addressed in an epigram of Martial"),
    ("Priscus -ī m", "Priscus, a man addressed in an epigram of Martial"),
    ("Faustus -ī m", "Faustus, a man addressed in an epigram of Martial"),
    # --- gods
    ("Iuppiter Iovis m", "Jupiter, the greatest of the gods"),
    ("Iūnō Iūnōnis f", "Juno, Jupiter's wife, queen of the gods"),
    ("Neptūnus -ī m", "Neptune, the god of the sea"),
    ("Plūtō Plūtōnis m", "Pluto, the god of the world below"),
    ("Minerva -ae f", "Minerva, the goddess of crafts and of wisdom"),
    ("Venus Veneris f", "Venus, the goddess of love"),
    ("Cupīdō Cupīdinis m", "Cupid, the god of love, Venus's son"),
    ("Mārs Mārtis m", "Mars, the god of war"),
    ("Mercurius -ī m", "Mercury, the messenger of the gods"),
    ("Vulcānus -ī m", "Vulcan, the god of fire and of the forge"),
    ("Diāna -ae f", "Diana, the goddess of hunting and of the moon"),
    ("Bacchus -ī m", "Bacchus, the god of wine"),
    ("Apollō Apollinis m", "Apollo, the god of the sun, of music and of prophecy"),
    ("Phoebus -ī m", "Phoebus, another name for Apollo"),
    ("Sāturnus -ī m", "Saturn, Jupiter's father, driven from heaven to Italy"),
    ("Sōl Sōlis m", "the Sun (as a god)"),
    ("Mūsa -ae f", "a Muse, one of the nine goddesses of the arts"),
    ("Iānus -ī m", "Janus, the god of doorways and of the year's beginning"),
    # --- myth and the Greek stories (Fabulae Syrae, cap. I–II, XXV–XXVI)
    ("Thēseus -ī m", "Theseus, the Athenian hero, Aegeus's son"),
    ("Aegeus -ī m", "Aegeus, king of Athens, Theseus's father"),
    ("Mīnōs -ōis m", "Minos, king of Crete"),
    ("Mīnōtaurus -ī m", "the Minotaur, the bull-headed monster of Crete"),
    ("Ariadna -ae f", "Ariadne, king Minos's daughter"),
    ("Daedalus -ī m", "Daedalus, the Athenian craftsman who built the labyrinth"),
    ("Īcarus -ī m", "Icarus, Daedalus's son, who flew too near the sun"),
    ("Corōnis Corōnidis f", "Coronis, the girl Apollo loved and killed"),
    ("Arachnē -ēs f", "Arachne, the weaver who challenged Minerva and became a spider"),
    ("Arīōn Arīonis m", "Arion, the singer carried ashore by a dolphin"),
    ("Orpheus -ī m", "Orpheus, the singer who went down to the dead for his wife"),
    ("Ulixēs Ulixis m", "Ulysses, the Greek hero of the long journey home"),
    ("Alcinous -ī m", "Alcinous, king of the Phaeacians"),
    ("Nausicaa -ae f", "Nausicaa, Alcinous's daughter, who found Ulysses on the shore"),
    ("Midās Midae m", "Midas, the king whose touch turned everything to gold"),
    ("Herculēs Herculis m", "Hercules, the strongest of heroes, Jupiter's son"),
    ("Alcmēna -ae f", "Alcmena, Hercules's mother"),
    ("Amphitryōn Amphitryōnis m", "Amphitryon, Alcmena's husband"),
    ("Achillēs Achillis m", "Achilles, the greatest Greek warrior at Troy"),
    ("Hector Hectoris m", "Hector, the Trojan hero, Priam's son"),
    ("Priamus -ī m", "Priam, the aged king of Troy"),
    ("Paris Paridis m", "Paris, Priam's son, who carried Helen off to Troy"),
    ("Helena -ae f", "Helen, the most beautiful woman in the world"),
    ("Menelāus -ī m", "Menelaus, king of Sparta and Helen's husband"),
    ("Nestor Nestoris m", "Nestor, the oldest and wisest of the Greeks at Troy"),
    ("Scylla -ae f", "Scylla, the monster in the rocks on the Italian side of the strait"),
    ("Charybdis Charybdis f", "Charybdis, the whirlpool facing Scylla"),
    ("Īnachus -ī m", "Inachus, the river-god and first king of Argos"),
    ("Nympha -ae f", "a nymph, a young goddess of the woods and waters"),
    # --- lands and regions
    ("Rōma -ae f", "Rome"),
    ("Italia -ae f", "Italy"),
    ("Eurōpa -ae f", "Europe"),
    ("Asia -ae f", "Asia (the Roman province in what is now Turkey)"),
    ("Āfrica -ae f", "Africa"),
    ("Graecia -ae f", "Greece"),
    ("Germānia -ae f", "Germany, the land beyond the Rhine"),
    ("Gallia -ae f", "Gaul, roughly modern France"),
    ("Hispānia -ae f", "Spain"),
    ("Britannia -ae f", "Britain"),
    ("Aegyptus -ī f", "Egypt"),
    ("Syria -ae f", "Syria"),
    ("Arabia -ae f", "Arabia"),
    ("Iūdaea -ae f", "Judaea, the land of the Jews"),
    ("Campānia -ae f", "Campania, the region south of Latium"),
    ("Latium -ī n", "Latium, the country round Rome"),
    ("Sicilia -ae f", "Sicily"),
    ("Sardinia -ae f", "Sardinia"),
    ("Crēta -ae f", "Crete, the great island south of Greece"),
    ("Trōia -ae f", "Troy, the city the Greeks besieged"),
    ("Peloponnēsus -ī f", "the Peloponnese, the southern part of Greece"),
    ("Scheria -ae f", "Scheria, the island of the Phaeacians"),
    # --- islands, towns, hills
    ("Athēnae -ārum f pl", "Athens"),
    ("Sparta -ae f", "Sparta, the great city of the Peloponnese"),
    ("Corinthus -ī f", "Corinth, the city on the isthmus"),
    ("Delphī -ōrum m pl", "Delphi, where Apollo's oracle was"),
    ("Olympus -ī m", "Olympus, the mountain where the gods live"),
    ("Isthmus -ī m", "the Isthmus, the neck of land joining the Peloponnese to Greece"),
    ("Rhodus -ī f", "Rhodes, the island off Asia Minor"),
    ("Samos -ī f", "Samos, the island Polycrates ruled"),
    ("Chios -ī f", "Chios, an island in the Aegean"),
    ("Lesbos -ī f", "Lesbos, the island Arion came from"),
    ("Lēmnos -ī f", "Lemnos, an island in the northern Aegean"),
    ("Naxus -ī f", "Naxos, the island where Theseus left Ariadne"),
    ("Dēlos -ī f", "Delos, the small sacred island in the middle of the Aegean"),
    ("Euboea -ae f", "Euboea, the long island beside Attica"),
    ("Īcaria -ae f", "Icaria, the island named after Icarus"),
    ("Tūsculum -ī n", "Tusculum, the hill town near Rome where Julius's villa is"),
    ("Ōstia -ae f", "Ostia, Rome's harbour town at the mouth of the Tiber"),
    ("Capua -ae f", "Capua, the great city of Campania"),
    ("Genua -ae f", "Genoa, the port in northern Italy"),
    ("Placentia -ae f", "Placentia, a town on the Po"),
    ("Brundisium -ī n", "Brundisium, the port at the heel of Italy"),
    ("Arīminum -ī n", "Ariminum, the town on the Adriatic coast"),
    ("Puteolī -ōrum m pl", "Puteoli, the harbour town on the bay of Naples"),
    ("Capitōlium -ī n", "the Capitol, the hill and temple of Jupiter at Rome"),
    ("Palātium -ī n", "the Palatine, the hill at Rome where the emperor lived"),
    # --- rivers, mountains, seas
    ("Tiberis Tiberis m", "the Tiber, the river of Rome"),
    ("Nīlus -ī m", "the Nile, the river of Egypt"),
    ("Rhēnus -ī m", "the Rhine"),
    ("Dānuvius -ī m", "the Danube"),
    ("Padus -ī m", "the Po, the great river of northern Italy"),
    ("Alpēs Alpium f pl", "the Alps"),
    ("Ōceanus -ī m", "the Ocean, the great sea round the world"),
    ("Īnferī -ōrum m pl", "the dead, the world below"),
    # --- peoples
    ("Rōmānī -ōrum m pl", "the Romans"),
    ("Graecī -ōrum m pl", "the Greeks"),
    ("Latīnī -ōrum m pl", "the Latins, the people of Latium"),
    ("Germānī -ōrum m pl", "the Germans"),
    ("Gallī -ōrum m pl", "the Gauls"),
    ("Hispānī -ōrum m pl", "the Spaniards"),
    ("Britannī -ōrum m pl", "the Britons"),
    ("Volscī -ōrum m pl", "the Volsci, an old enemy of Rome in southern Latium"),
    ("Trōiānī -ōrum m pl", "the Trojans"),
    ("Phaeācēs Phaeācum m pl", "the Phaeacians, the seafaring people who took Ulysses home"),
    ("Athēniēnsēs Athēniēnsium m pl", "the Athenians"),
    ("Iūdaeī -ōrum m pl", "the Jews"),
    ("Christiānī -ōrum m pl", "the Christians"),
    ("Aegyptiī -ōrum m pl", "the Egyptians"),
    ("Persae -ārum m pl", "the Persians"),
    # --- one Roman, one Greek, one Christian: the person, not only the adjective
    ("Rōmānus -ī m", "a Roman"),
    ("Graecus -ī m", "a Greek"),
    ("Christiānus -ī m", "a Christian"),
    ("Iūdaeus -ī m", "a Jew"),
    ("Germānus -ī m", "a German"),
    ("Athēniēnsis Athēniēnsis m", "an Athenian"),
    # --- the adjectives made from names (via Appia, mare Aegaeum, vīnum Falernum)
    ("Rōmānus -a -um", "Roman, of Rome"),
    ("Graecus -a -um", "Greek"),
    ("Latīnus -a -um", "Latin, of Latium"),
    ("Germānus -a -um", "German"),
    ("Gallicus -a -um", "Gallic, of Gaul"),
    ("Hispānus -a -um", "Spanish"),
    ("Britannus -a -um", "British"),
    ("Italus -a -um", "Italian"),
    ("Trōiānus -a -um", "Trojan"),
    ("Athēniēnsis -e", "Athenian"),
    ("Christiānus -a -um", "Christian"),
    ("Aegyptius -a -um", "Egyptian"),
    ("Tūsculānus -a -um", "of Tusculum (praedium Tūsculānum, the Tusculan estate)"),
    ("Albānus -a -um", "Alban, of the Alban Mount (praedium Albānum, Julius's other estate)"),
    ("Ōstiēnsis -e", "of Ostia (via Ōstiēnsis, the road from Rome to Ostia)"),
    ("Siculus -a -um", "Sicilian (mare Siculum, the sea south of Sicily)"),
    ("Tūscus -a -um", "Etruscan (mare Tūscum, the sea west of Italy)"),
    ("Falernus -a -um", "Falernian (vīnum Falernum, a famous Campanian wine)"),
    ("Aegaeus -a -um", "Aegean (mare Aegaeum, the sea between Greece and Asia)"),
    ("Īcarius -a -um", "Icarian (mare Īcarium, the sea where Icarus fell)"),
    ("Hadriāticus -a -um", "Adriatic (mare Hadriāticum, the sea east of Italy)"),
    ("Atlanticus -a -um", "Atlantic (ōceanus Atlanticus)"),
    ("Appius -a -um", "Appian (via Appia, the road from Rome to Brundisium)"),
    ("Flāminius -a -um", "Flaminian (via Flāminia, the road from Rome to Ariminum)"),
    ("Aurēlius -a -um", "Aurelian (via Aurēlia, the road from Rome to Genoa)"),
    ("Capēnus -a -um", "of Capena (porta Capēna, where the via Appia leaves Rome)"),
    ("Iūlius -a -um", "Julian, of Julius (mēnsis Iūlius = July)"),
    ("Aemilius -a -um", "Aemilian, of the Aemiliī (via Aemilia, the road across the Po valley)"),
    # --- the months
    ("Iānuārius -a -um", "of January (mēnsis Iānuārius, kalendae Iānuāriae)"),
    ("Februārius -a -um", "of February"),
    ("Mārtius -a -um", "of March"),
    ("Aprīlis -e", "of April"),
    ("Māius -a -um", "of May"),
    ("Iūnius -a -um", "of June"),
    ("Quīntīlis -e", "of Quintilis, the old name of July"),
    ("Sextīlis -e", "of Sextilis, the old name of August"),
]

#: forms latin_forms cannot derive from the citation form alone.  Greek names
#: keep their own vocative (Thēseu, Orontē) and accusative (Arachnēn); the
#: i-stem place names take -im / -ī; Iēsūs has one oblique stem for every case.
NAME_EXTRA: dict[str, list[tuple[str, dict]]] = {
    "theseus": [("Thēseu", {"case": "voc", "number": "sg", "gender": "m"})],
    "orpheus": [("Orpheu", {"case": "voc", "number": "sg", "gender": "m"})],
    "aegeus": [("Aegeu", {"case": "voc", "number": "sg", "gender": "m"})],
    "orontes": [("Orontē", {"case": "voc", "number": "sg", "gender": "m"})],
    "socrates": [("Sōcratē", {"case": "voc", "number": "sg", "gender": "m"})],
    "ulixes": [("Ulixē", {"case": "voc", "number": "sg", "gender": "m"})],
    "achilles": [("Achillē", {"case": "voc", "number": "sg", "gender": "m"})],
    "arachne": [("Arachnēn", {"case": "acc", "number": "sg", "gender": "f"})],
    "tiberis": [("Tiberim", {"case": "acc", "number": "sg", "gender": "m"}),
                ("Tiberī", {"case": "abl", "number": "sg", "gender": "m"})],
    "charybdis": [("Charybdim", {"case": "acc", "number": "sg", "gender": "f"}),
                  ("Charybdī", {"case": "abl", "number": "sg", "gender": "f"})],
    "minos": [("Mīnōis", {"case": "gen", "number": "sg", "gender": "m"})],
}

#: names built entirely by hand: no stem, only the forms listed
NAME_ONLY: dict[str, tuple[str, str, list[tuple[str, dict]]]] = {
    # h: (lemma, gloss, [(form, parse)…])
    "iesus": ("Iēsūs Iēsū m", "Jesus",
              [("Iēsūs", {"case": "nom", "number": "sg", "gender": "m"}),
               ("Iēsū", {"case": "gen", "number": "sg", "gender": "m"}),
               ("Iēsū", {"case": "dat", "number": "sg", "gender": "m"}),
               ("Iēsum", {"case": "acc", "number": "sg", "gender": "m"}),
               ("Iēsū", {"case": "abl", "number": "sg", "gender": "m"}),
               ("Iēsū", {"case": "voc", "number": "sg", "gender": "m"})]),
}


_NAME_MARKERS = {"m", "f", "n", "m/f", "pl", "(indeclinable)"}
_NAME_GENDER = {"m": "m", "f": "f", "n": "n", "m/f": "c"}
#: genitive endings → (declension, how much of the genitive is the stem)
#: genitive endings, ascii, longest first — the tail that decides the declension
_GEN_TAILS = ("arum", "orum", "ium", "ois", "us", "um", "is", "ae", "es", "ei", "i")


def _name_shape(lemma: str) -> dict | None:
    """'Iūlius -ī m' → {pos, cat, roots, gender, plural}.  See NAMES."""
    toks = lemma.replace("(indeclinable)", " (indeclinable) ").split()
    head = toks[0]
    rest = toks[1:]
    gender = next((_NAME_GENDER[t] for t in rest if t in _NAME_GENDER), None)
    plural = "pl" in rest
    if "(indeclinable)" in rest:
        return {"pos": "N", "cat": [9, 1], "roots": [head, head], "gender": gender, "plural": plural}
    # adjectives: "-a -um", "-e", "-is -e"
    if "-a" in rest and "-um" in rest:
        stem = head[:-2] if canonical(head).endswith("us") else head
        return {"pos": "ADJ", "cat": [1, 1], "roots": [stem, stem, "-", "-"], "gender": None, "plural": False}
    if rest[:1] == ["-e"] or rest[:2] == ["-is", "-e"]:
        stem = head[:-2] if canonical(head).endswith("is") else head
        return {"pos": "ADJ", "cat": [3, 2], "roots": [stem, stem, "-", "-"], "gender": None, "plural": False}
    gen = next((t for t in rest if t not in _NAME_MARKERS), None)
    if gen is None:
        return None
    full = not gen.startswith("-")
    gc = canonical(gen.lstrip("-"))
    ec = next((t for t in _GEN_TAILS if gc.endswith(t)), None)
    if ec is None:
        return None
    hc = canonical(head)
    body = gen.lstrip("-")

    def stem_from_gen(tail: str = ec) -> str:
        return body[: len(body) - len(tail)]

    if ec in ("ae", "arum"):                                  # 1st declension
        if hc.endswith("ae") or ec == "arum":
            stem = head[:-2] if hc.endswith("ae") else head
            cat = [1, 1]
        elif hc.endswith("as"):
            stem, cat = head[:-2], [1, 8]                     # Midās -ae
        elif hc.endswith("es"):
            stem, cat = head[:-2], [1, 7]
        else:
            stem, cat = head[:-1], [1, 1]
        return {"pos": "N", "cat": cat, "roots": [stem, stem], "gender": gender, "plural": plural}
    if ec == "es" and hc.endswith("e"):                       # Arachnē -ēs (Greek)
        return {"pos": "N", "cat": [1, 6], "roots": [head[:-1], head[:-1]], "gender": gender, "plural": plural}
    if ec in ("i", "orum"):                                   # 2nd declension
        if ec == "orum":
            stem, cat = (head[:-1] if hc.endswith("i") else head), [2, 1]
            if gender == "n":
                cat = [2, 2]
        elif hc.endswith("us"):
            stem, cat = head[:-2], ([2, 2] if gender == "n" else [2, 1])
        elif hc.endswith(("um", "on")):
            stem, cat = head[:-2], [2, 2]
        elif hc.endswith("os"):
            stem, cat = head[:-2], [2, 6]
        elif full:
            stem, cat = stem_from_gen(), [2, 3]                # Lēander Lēandrī
        else:
            stem, cat = head, [2, 3]
        return {"pos": "N", "cat": cat, "roots": [stem, stem] if cat != [2, 3] else [head, stem],
                "gender": gender, "plural": plural}
    if ec in ("is", "ois", "ium", "um"):                      # 3rd declension
        if full:
            stem = stem_from_gen()
        elif ec == "ois":
            stem = head[:-1]                                  # Mīnōs -ōis → Mīnō
        elif hc.endswith("is"):
            stem = head[:-2]
        else:
            stem = head
        cat = [3, 3] if ec == "ium" else ([3, 2] if gender == "n" else [3, 1])
        return {"pos": "N", "cat": cat, "roots": [head, stem], "gender": gender, "plural": plural}
    if ec == "us":                                            # 4th declension
        stem = head[:-2] if hc.endswith("us") else head
        return {"pos": "N", "cat": [4, 1], "roots": [stem, stem], "gender": gender, "plural": plural}
    if ec in ("ei",):                                         # 5th declension
        stem = head[:-2] if hc.endswith("es") else head
        return {"pos": "N", "cat": [5, 1], "roots": [stem, stem], "gender": gender, "plural": plural}
    return None


def name_entries() -> dict[str, list[tuple[str, dict]]]:
    """canonical form → [(the spelling the book prints, glossary entry)].

    Every name in NAMES is declined through pipeline/latin_forms, so `Daedalum`
    and `Daedalō` reach the same entry as `Daedalus`; the roots keep their
    capital, so the paradigm the app draws reads *Neptūnus … Neptūne*, not
    *neptūnus … neptūne*."""
    out: dict[str, list[dict]] = collections.defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for lemma, gloss in NAMES:
        h = ascii_head(lemma)
        if h in NAME_ONLY:
            # a name with no regular paradigm: the forms are listed by hand and
            # `cat`/`roots` stay empty, so the app draws no (wrong) table
            shape = {"pos": "N", "cat": None, "roots": [], "gender": "m", "plural": False}
            pairs = list(NAME_ONLY[h][2])
        else:
            shape = _name_shape(lemma)
            if shape is None:
                print(f"warning: cannot parse the name {lemma!r}", file=sys.stderr)
                NAME_UNPARSED.append(lemma)
                continue
            base = {"lemma": lemma, "h": h, "pos": shape["pos"], "cat": shape["cat"],
                    "gender": shape["gender"], "roots": shape["roots"]}
            if (shape["cat"] or [0])[0] == 9:
                pairs = [(shape["roots"][0], {})]        # Bethlehem: one form, no case
            else:
                pairs = latin_forms.forms(base)
                if shape["plural"]:
                    pairs = [(f, p) for f, p in pairs if p.get("number") == "pl"]
                pairs += NAME_EXTRA.get(h, [])
        if (h, shape["pos"]) in seen:
            continue
        seen.add((h, shape["pos"]))
        base = {"lemma": lemma, "h": h, "pos": shape["pos"], "cat": shape["cat"],
                "gender": shape["gender"], "roots": shape["roots"]}
        # one entry per key: the same lexeme's spellings of one form (Oronte /
        # Orontē) are one word to the learner, so their parses are unioned and
        # every spelling is remembered for the exact-spelling keys
        per_key: dict[str, dict] = {}
        for form, parse in pairs:
            key = canonical(form)
            e = per_key.get(key)
            if e is None:
                e = per_key[key] = dict(base, parses=[], senses=[gloss], raw=gloss,
                                        enc=None, proper=True, _sp=[])
            if parse and parse not in e["parses"]:
                e["parses"].append(parse)
            if form not in e["_sp"]:
                e["_sp"].append(form)
        for key, e in per_key.items():
            e["parses"] = learner_parse_order(e["parses"], shape["pos"], key)
            out[key].append(e)
    NAME_LEXEMES.update(seen)
    return out


#: filled by name_entries(), for --check
NAME_LEXEMES: set[tuple[str, str]] = set()
NAME_UNPARSED: list[str] = []



# ---------------------------------------------------------------------------
# exact-spelling keys
#
# The glossary is keyed on the macron-stripped, lower-cased form, so `māla`
# (apples) and `mala` (bad), `Mārcō` (to Marcus) and `mārcō` (I am flabby)
# arrive at the same list and the learner is shown whichever reading Whitaker's
# frequencies happen to rank first.  dictionary.js tries the token as printed
# before it strips anything (`hitKey(raw)`), so the fix is data, not code: when
# the library prints a form in a spelling that picks a *different* first entry —
# a capital that means a name, a macron that means another word — that exact
# spelling is added as its own key with the readings that can actually spell it
# in front.  Only spellings that change the answer are added, so the cost is a
# few hundred keys, not a copy of the glossary.
#
# Entries also carry `proper: true` on every name, so a caller that has the
# token's capital in hand can prefer the name without consulting these keys.

_SPELLING_CACHE: dict[tuple, frozenset | None] = {}
_GLOSS_POS = {"ABBR", "ENDING", "PREFIX", "STEM"}
_UNINFLECTED_POS = {"ADV", "CONJ", "PREP", "INTERJ"} | _GLOSS_POS

#: form (lower-cased, macrons kept) → how often the whole library prints it;
#: filled by main() from collect_tokens() and read by entry_count().
LIB_FORM_COUNTS: dict[str, int] = {}


def entry_spellings(e: dict, core: bool = False) -> frozenset | None:
    """Every spelling this entry can give, case-folded; None when unknown.

    `core` drops the comparative and superlative, which triple an adjective's
    table with forms nobody writes (`lātior`, `lātissimum`).  Counting those as
    the adjective's own would make `lātus -a -um` look like a word the library
    never prints, when in truth every form of it the library prints is a form
    `ferō`'s participle `lātum` prints too."""
    if e.get("_sp"):
        return frozenset(x.lower() for x in e["_sp"])
    pos = e.get("pos")
    if pos in _UNINFLECTED_POS:
        head = str(e.get("lemma") or "").split(",")[0].split()[0].strip("-")
        return frozenset([head.lower()]) if head else None
    key = (e.get("h"), pos, tuple(e.get("roots") or []), tuple(e.get("cat") or []),
           e.get("gender"), e.get("kind"), core)
    if key in _SPELLING_CACHE:
        return _SPELLING_CACHE[key]
    try:
        if core:
            forms = [f for f, p in latin_forms.forms(e) if p.get("degree") in (None, "pos")]
        else:
            forms = latin_forms.single_forms(e)
    except Exception:                                    # noqa: BLE001 — a table we cannot build
        forms = []
    out = frozenset(f.lower() for f in forms) if forms else None
    _SPELLING_CACHE[key] = out
    return out


def entry_count(e: dict, rivals: frozenset = frozenset(), core: bool = False) -> int:
    """How often the library prints a form of this lexeme that no other reading
    under the same key can print — the evidence that it is *this* word.

    Counting the whole paradigm would be worthless: the key's own spelling is
    exactly the one the rivals share, and where one lexeme's forms contain
    another's (Iūlius -a -um prints every form of Iūlia -ae f) the bigger table
    would always win.  So only the spellings the rivals cannot give are counted:
    `māla` itself is printed 33 times and settles nothing, but `mālum/mālō/
    mālōrum` (apples) are printed 64 times and `mālae/mālam/mālā` (cheeks) never.
    """
    if not LIB_FORM_COUNTS:
        return 0
    sp = entry_spellings(e, core=core)
    if not sp:
        return 0
    return sum(LIB_FORM_COUNTS.get(s, 0) for s in sp - rivals)


def rival_spellings(entries: list[dict], i: int) -> frozenset:
    """Every spelling the *other* readings under this key can print."""
    out: set[str] = set()
    for j, other in enumerate(entries):
        if j == i:
            continue
        sp = entry_spellings(other)
        if sp:
            out |= sp
    return frozenset(out)


#: Counts are used one way only, and only at their sharpest: a reading whose
#: own forms the library prints *not once* goes behind a reading whose own
#: forms it prints constantly.  Anything softer than that cannot be trusted to
#: compare a noun with a verb — a verb has ten times as many forms to be
#: counted over, so relative size measures the paradigm, not the word.
COUNT_SEEN = 10
#: a reading is only measurable when at least 1/COUNT_SHARE of the forms it can
#: give are forms no rival under the same key can give
COUNT_SHARE = 3
#: …and two readings are only comparable when they were counted over evidence of
#: the same order of size.  `vītēs` is the vine, but the vine's own forms are
#: `vītis/vīte/vītium/vītibus` (5 of them, none of which the book happens to
#: print) while `vītō` "avoid" brings 146 forms of its own to be counted over:
#: whichever word is meant, the verb wins a race like that.
COUNT_BASE = 4


def count_ranks(entries: list[dict]) -> list[int]:
    """0 for every reading, 1 for one the library never once shows the learner
    while another under the same key — counted over evidence of a comparable
    size — is genuinely part of the course."""
    ns = [e.get("n") if isinstance(e.get("n"), int) else None for e in entries]
    nds = [e.get("nd") if isinstance(e.get("nd"), int) else None for e in entries]
    out = []
    for n, nd in zip(ns, nds):
        beaten = n == 0 and any(
            rn is not None and rn >= COUNT_SEEN and rnd is not None and nd
            and rnd <= COUNT_BASE * nd
            for rn, rnd in zip(ns, nds))
        out.append(1 if beaten else 0)
    return out


def _lower_wins(speller: "Speller", form: str) -> bool:
    """True when the library prints this form in lower case at least as often
    as with a capital — then the common word, not the name, leads the list."""
    counter = speller.forms.get(form)
    if not counter:
        return False
    lower = sum(n for sp, n in counter.items() if not CAPITAL.match(sp))
    upper = sum(n for sp, n in counter.items() if CAPITAL.match(sp))
    return lower > 0 and lower >= upper


def spelling_rank(e: dict, spelling: str) -> int:
    """How well this reading accounts for a form spelled exactly like this.
    0 it spells it, letter for letter · 1 apart from a leading capital ·
    2 we cannot say (no table for this word) · 3 it spells it otherwise."""
    sp = entry_spellings(e)
    if sp is None:
        return 2
    if spelling in sp or spelling.lower() in sp and spelling.lower() == spelling:
        return 0
    if spelling.lower() in sp:
        return 1
    # A word with one form and a disputed vowel: the library prints the adverb `modo` 39 times and
    # `modō` 52, so a macron that disagrees with the headword says nothing about which particle this
    # is.  (A *fragment* is still told apart from a word: the ending `-a` is not the preposition `ā`.)
    # The macron alone, mind: "Hic" differs from the adverb `hīc` by its capital as well, and a
    # capital at the head of a sentence is not evidence of anything (see exact_spelling_keys).
    pos = e.get("pos")
    if pos in _UNINFLECTED_POS and pos not in _GLOSS_POS:
        if strip_macrons(spelling) in {strip_macrons(x) for x in sp}:
            return 0
    return 3


def _order_for(entries: list[dict], spelling: str, counts: bool = True) -> list[dict]:
    # spelling first (a reading that cannot print these letters is not this
    # word), then behind the rest anything the library never shows the learner
    back = count_ranks(entries) if counts else [0] * len(entries)
    return [e for _, e in sorted(enumerate(entries),
                                 key=lambda pair: (spelling_rank(pair[1], spelling),
                                                   back[pair[0]], pair[0]))]


def exact_spelling_keys(glossary: dict[str, list[dict]], speller: "Speller",
                        display_key: dict[str, str]) -> dict[str, list[dict]]:
    """Extra keys for the spellings the library actually prints, added only
    where the spelling changes which reading comes first."""
    out: dict[str, list[dict]] = {}
    for form, entries in glossary.items():
        if len(entries) < 2:
            continue
        spellings = speller.forms.get(canonical(form))
        names_here = [e for e in entries if e.get("proper")]
        if not spellings:
            continue
        for sp in spellings:
            if sp == form or sp in glossary or not (has_macron(sp) or CAPITAL.match(sp)):
                continue
            # only when a reading really does spell the form this way, letter
            # for letter: a sentence-initial capital on a common word (Solum,
            # Puerī) is not evidence of anything and gets no key.  The *spelling*
            # alone decides whether the key is worth adding (library counts must
            # not conjure new keys); the stored order then also uses the counts.
            spelled = _order_for(entries, sp, counts=False)
            if spelling_rank(spelled[0], sp) != 0 or spelled[0] is entries[0]:
                continue
            out[sp] = _order_for(entries, sp)
    return out


def attach_spellings(glossary: dict[str, list[dict]]) -> int:
    """`sp`: the spelling(s) this reading gives the key's form, macrons and
    capital included — written only where the readings under one key disagree,
    which is exactly where a caller holding the printed token can choose
    between them (māla/mala, Mārcō/mārcō, liber/līber)."""
    n = 0
    for key, entries in glossary.items():
        if len(entries) < 2:
            continue
        ck = canonical(key)
        per = []
        for e in entries:
            sp = entry_spellings(e)
            per.append(sorted(x for x in (sp or ()) if canonical(x) == ck) or None)
        # names carry their capital, which entry_spellings lower-cased
        for e, forms in zip(entries, per):
            if e.get("_sp") and forms:
                forms[:] = [x for x in e["_sp"] if canonical(x) == ck] or forms
        shapes = {tuple(f) for f in per if f}
        if len(shapes) < 2:
            continue
        for e, forms in zip(entries, per):
            if forms:
                e["sp"] = forms[0] if len(forms) == 1 else forms
                n += 1
    return n


def attach_library_counts(glossary: dict[str, list[dict]]) -> int:
    """`n`: entry_count() written on every reading that shares its key with
    another, so the app can prefer the word the learner has actually met when
    the spelling cannot tell two readings apart (māla apples / māla cheeks).

    Only multi-entry keys carry it — a form with one reading has nothing to
    rank.  `n` is written even when it is 0: 0 is the finding that matters
    (`māla -ae f`, cheeks — the library prints `mālae/mālam/mālā` nowhere).
    Three kinds of reading are left without one instead, and the app reads
    "no `n`" as "the counts have nothing to say", which is not the same:

    * a gloss abbreviation (ABBR/ENDING/PREFIX/STEM) — hand-placed first or
      last by the build on purpose, and its "spelling" is a fragment (`-a`);
    * a reading that cannot print the key's own form: it is here because
      Whitaker cut the word up (quisque as queō + -que), so a count over its
      paradigm is a count of some other string;
    * a reading with too little of its own to count, because a rival can give
      most of its forms too (Iūlia -ae f inside Iūlius -a -um; the adverb
      `modo` inside the noun `modus`; the adjective `mortuus -a -um`, whose
      only forms beyond the participle `mortuus` are `mortuē` and comparatives
      nobody writes).  Fewer than COUNT_SHARE of its forms are its own, so
      "never printed" would be a fact about Latin morphology, not about the
      word — unmeasurable, and left alone.
    """
    n = 0
    for key, entries in glossary.items():
        if len(entries) < 2:
            continue
        ck = canonical(key)
        for i, e in enumerate(entries):
            if "n" in e:                     # shared object (an exact-spelling key)
                continue
            if e.get("pos") in _GLOSS_POS:
                continue
            sp = entry_spellings(e, core=True)
            if not sp or not any(canonical(x) == ck for x in sp):
                continue
            rivals = rival_spellings(entries, i)
            if len(sp - rivals) * COUNT_SHARE < len(sp):   # too little of its own to measure
                continue
            e["n"] = entry_count(e, rivals, core=True)
            e["nd"] = len(sp - rivals)          # how much evidence that count had to work with
            n += 1
    return n


# ---------------------------------------------------------------------------
# main


def main() -> None:
    weeks = collect_tokens()
    LIB_FORM_COUNTS.clear()
    for _counter in weeks.values():
        for _tok, _n in _counter.items():
            LIB_FORM_COUNTS[_tok.lower()] = LIB_FORM_COUNTS.get(_tok.lower(), 0) + _n
    old = json.load(open(OLD_GLOSSARY, encoding="utf-8")) if OLD_GLOSSARY.exists() else {}
    supplements, sup_keys = load_supplements()
    abbr_first, abbr_last, abbr_keys = load_abbreviations()
    names = name_entries()

    speller = Speller()
    form_set: set[str] = set()
    # display key per canonical form: source spelling (v kept, macrons off) > old key > supplement key > canonical
    display_key: dict[str, str] = {}
    for counter in weeks.values():
        for tok, n in counter.items():
            speller.learn_form(tok, n)
            form_set.add(canonical(tok))
    for k in old:
        form_set.add(canonical(k))
        display_key.setdefault(canonical(k), strip_macrons(k).lower())
    for k, disp in list(sup_keys.items()) + list(abbr_keys.items()):
        form_set.add(k)
        display_key.setdefault(k, disp)
    for k, ents in names.items():
        form_set.add(k)
        display_key.setdefault(k, strip_macrons(ents[0]["_sp"][0]).lower())
    if SEED_FORMS.exists():
        for line in open(SEED_FORMS, encoding="utf-8"):
            line = line.split("#")[0]
            for tok in WORD_RE.findall(line):
                form_set.add(canonical(tok))
                display_key.setdefault(canonical(tok), strip_macrons(tok).lower())
    for form in SUM_FORMS:
        form_set.add(form)
        display_key.setdefault(form, form)
    for form in form_set:
        if form in speller.forms:
            display_key[form] = strip_macrons(speller.spell_form(form)).lower()
        display_key.setdefault(form, form)

    parser = Parser(frequency="F")
    INFL_FREQ.update(inflection_freq_map(parser))
    analyses: dict[str, list[Rec]] = {}
    for form in sorted(form_set):
        analyses[form] = analyse(parser, form)

    # learn spellings from the source tokens
    for counter in weeks.values():
        for tok in counter:
            for rec in analyses.get(canonical(tok), []):
                speller.learn(tok, rec)

    glossary: dict[str, list[dict]] = {}
    n_whit = 0
    for form in sorted(form_set):
        recs = analyses[form]
        entries = [build_entry(r, speller) for r in recs]
        ranked = rank_and_filter(recs, entries, form)
        ranked += supine_entries(ranked, form)
        if form in SUM_FORMS and not any(e["h"] == "sum" and e["pos"] in ("V", "VPAR") for e in ranked):
            ranked.insert(0, sum_entry(form))
        sup = list(supplements.get(form, []))
        nm = list(names.get(form, []))
        # a name entry replaces the supplement's (hand-listed, one case only)
        # and Whitaker's reading of the same word
        nm_hp = {(e["h"], e["pos"]) for e in nm}
        sup = [e for e in sup if (e["h"], e["pos"]) not in nm_hp]
        # a supplement entry replaces Whitaker's reading of the same word
        sup_hp = {(e["h"], e["pos"]) for e in sup} | nm_hp
        ranked = [e for e in ranked if (e["h"], e["pos"]) not in sup_hp]
        # A name goes first unless the library also prints this form in lower
        # case at least as often (ursus the bear beside Ursus the slave); the
        # exact-spelling keys below then put the name first for the capitalised
        # spelling only.
        first, last = (nm, []) if nm and not _lower_wins(speller, form) else ([], nm)
        merged = first + sup + abbr_first.get(form, []) + ranked + last + abbr_last.get(form, [])
        if merged:
            glossary[display_key[form]] = merged
            if ranked:
                n_whit += 1
    n_lib = attach_library_counts(glossary)
    glossary.update(exact_spelling_keys(glossary, speller, display_key))
    n_sp = attach_spellings(glossary)
    covered = {canonical(k) for k in glossary}

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    total_miss = {}
    for wk, counter in sorted(weeks.items()):
        misses = collections.defaultdict(collections.Counter)
        for tok, n in counter.items():
            key = canonical(tok)
            if key not in covered:
                misses[key][tok] += n
        total_miss[wk] = len(misses)
        path = BUILD_DIR / f"glossary-misses-week-{wk:02d}.txt"
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f"# Week {wk:02d}: {len(misses)} forms Whitaker could not parse and no supplement covers\n")
            fh.write("# form\tspellings (count)\n")
            for key in sorted(misses):
                spell = ", ".join(f"{t} ({n})" for t, n in misses[key].most_common())
                fh.write(f"{key}\t{spell}\n")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    # null `cat` / `gender` are omitted (the app reads them with `||`; ~100 KB);
    # `enc` stays, the tests compare it with null
    for entries in glossary.values():
        for e in entries:
            e.pop("_sp", None)
            for k in ("cat", "gender"):
                if k in e and e[k] is None:
                    del e[k]
    text = json.dumps(glossary, ensure_ascii=False, separators=(",", ":"))
    size = len(text.encode("utf-8"))
    if size > 3_000_000:
        for entries in glossary.values():
            for e in entries:
                e.pop("raw", None)
        text = json.dumps(glossary, ensure_ascii=False, separators=(",", ":"))
        size = len(text.encode("utf-8"))
        print("note: dropped `raw` to stay under 3 MB")
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        fh.write(text)

    n_entries = sum(len(v) for v in glossary.values())
    print(f"forms in token set: {len(form_set)}")
    print(f"exact-spelling keys: {len(glossary) - len(form_set) + len(form_set) - len([f for f in form_set if display_key[f] in glossary])}"
          f"; `sp` written on {n_sp} entries; `n` (library count) on {n_lib}")
    print(f"forms with entries: {len(glossary)} (Whitaker: {n_whit}, supplement-only: {len(glossary) - n_whit})")
    print(f"entries: {n_entries}; file: {size/1e6:.2f} MB → {OUT_PATH}")
    for wk, n in sorted(total_miss.items()):
        print(f"week {wk:02d}: {sum(weeks[wk].values())} tokens, {len({canonical(t) for t in weeks[wk]})} forms, {n} misses")
    dead = sorted(set(LEXEME_MACRONS) - LEXEME_MACRONS_USED)
    print(f"lexeme macrons: {len(LEXEME_MACRONS_USED)}/{len(LEXEME_MACRONS)} keys fired"
          + (f"; NOT MATCHED: {dead}" if dead else ""))
    unused = ", ".join(sorted(set(ROOT_MACRONS) - ROOT_MACRONS_USED))
    fired = len(ROOT_MACRONS) - (len(unused.split(", ")) if unused else 0)
    print(f"macron corrections: {fired}/{len(ROOT_MACRONS)} keys fired"
          + (f"; NOT MATCHED: {unused}" if unused else ""))


if __name__ == "__main__":
    main()
