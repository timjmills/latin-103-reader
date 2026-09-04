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
    ("reperio", "V"), ("proficiscor", "V"), ("sequor", "V"), ("volo", "V"),
    ("paucus", "ADJ"), ("multus", "ADJ"), ("magnus", "ADJ"), ("bonus", "ADJ"),
}
PREFERRED_BONUS = 1.0  # one frequency step: enough to lift proficīscor (B) over proficiō (A)

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


def analyse(parser: Parser, form: str) -> list[Rec]:
    try:
        word = parser.parse(form)
    except WordsException:
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
            by_wt: dict[str, list] = collections.OrderedDict()
            for infl in an.inflections:
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
    (4, 1): "is", (4, 2): "idem", (3, 1): "hic", (6, 2): "ipse",
    (5, 1): "ego", (5, 2): "tu", (5, 4): "se",
}


def pron_lemma(rec: Rec, roots: list[str], spelled_form: str) -> tuple[str, str, str | None]:
    """→ (lemma, h, kind)."""
    cat = tuple((rec.cat + [0, 0])[:2]) if rec.cat else (0, 0)
    kind = PRONKIND.get(rec.lexform[0]) if rec.lexform else None
    r0 = rec.roots[0] if rec.roots else rec.stem0
    h = None
    if cat in PRON_HEAD:
        h = PRON_HEAD[cat]
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
        if cat and cat[:2] == [2, 4] and any(p.get("case") == "loc" for p in parses)                 and not any(p.get("case") == "gen" and p.get("number") == "sg" for p in parses):
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
        lemma = HAND_LEMMAS.get(f"{lexpos}:{h}", lemma)
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


def rank_and_filter(recs: list[Rec], entries: list[dict]) -> list[dict]:
    scored = []
    for rec, e in zip(recs, entries):
        if e is None:
            continue
        score = freq_rank(rec) - POS_BONUS.get(e["pos"], 0) - (PREFERRED_BONUS if ((e["h"], e["pos"]) in PREFERRED or (e["pos"] == "VPAR" and (e["h"], "V") in PREFERRED)) else 0)
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
# main


def main() -> None:
    weeks = collect_tokens()
    old = json.load(open(OLD_GLOSSARY, encoding="utf-8")) if OLD_GLOSSARY.exists() else {}
    supplements, sup_keys = load_supplements()
    abbr_first, abbr_last, abbr_keys = load_abbreviations()

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
        ranked = rank_and_filter(recs, entries)
        ranked += supine_entries(ranked, form)
        if form in SUM_FORMS and not any(e["h"] == "sum" and e["pos"] in ("V", "VPAR") for e in ranked):
            ranked.insert(0, sum_entry(form))
        sup = list(supplements.get(form, []))
        # a supplement entry replaces Whitaker's reading of the same word
        sup_hp = {(e["h"], e["pos"]) for e in sup}
        ranked = [e for e in ranked if (e["h"], e["pos"]) not in sup_hp]
        merged = sup + abbr_first.get(form, []) + ranked + abbr_last.get(form, [])
        if merged:
            glossary[display_key[form]] = merged
            if ranked:
                n_whit += 1
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
    print(f"forms with entries: {len(glossary)} (Whitaker: {n_whit}, supplement-only: {len(glossary) - n_whit})")
    print(f"entries: {n_entries}; file: {size/1e6:.2f} MB → {OUT_PATH}")
    for wk, n in sorted(total_miss.items()):
        print(f"week {wk:02d}: {sum(weeks[wk].values())} tokens, {len({canonical(t) for t in weeks[wk]})} forms, {n} misses")


if __name__ == "__main__":
    main()
