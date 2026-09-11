#!/usr/bin/env python
"""
build_paradigm_catalogue.py — app/data/grammar/paradigms.json.

    python pipeline/build_paradigm_catalogue.py            # write the catalogue
    python pipeline/build_paradigm_catalogue.py --check     # build in memory, check only
    python pipeline/build_paradigm_catalogue.py --report    # + the table roster on stdout

The catalogue names every paradigm table the app can draw, organised by part of
speech and then by table (GRAMMAR-CONTRACT.md "Teaching rebuild (2026-09-09)"
§4).  Nothing here invents morphology: every table, group and cell already
exists inside app/js/paradigms.js — this file gives them **stable names**, says
which words the book teaches each table with, and says which customisation axes
the data can honestly offer.

What a table is
---------------
`paradigm(entry)` picks its endings by branching on the entry's own fields
(pos, cat, gender, kind, headword, roots).  A *table* is one of those branches:
the set of glossary entries that reach the same ending tables.  `SELECT` below
is that branch logic written as ordered data — first match wins — so the app can
compute a table id for any library word without re-implementing paradigms.js.
`table_of()` evaluates it, and the build proves it total: every
entry that has a table gets exactly one id, and every cell it renders is in that
table's declared roster.

Everything measured here is measured by driving the real generator
(pipeline/latin_forms.py, which tests/latin_forms/parity.py holds cell-for-cell
identical to app/js/paradigms.js), never by re-implementing it.

Sources
-------
app/data/glossary.json          the entries, and where each one lives (key + index)
app/data/grammar/skills.json    the category and the chapter that introduces a table
app/data/grammar/vocab/NN.json  the chapter that teaches a word, and its count
data/build/review-NN.json       the library, for the chapter of a word no deck teaches
data/build/week-NN.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import latin_forms as lf  # noqa: E402

GLOSSARY = ROOT / "app" / "data" / "glossary.json"
SKILLS = ROOT / "app" / "data" / "grammar" / "skills.json"
VOCAB_DIR = ROOT / "app" / "data" / "grammar" / "vocab"
BUILD_DIR = ROOT / "data" / "build"
OUT_PATH = ROOT / "app" / "data" / "grammar" / "paradigms.json"

POS_WITH_TABLES = ("N", "ADJ", "V", "VPAR", "PRON", "NUM")

# ---------------------------------------------------------------------------
# the cell id
#
# A cell's id is a canonical serialisation of the structured key paradigms.js
# already puts on it — never of its position, so it does not move when a lemma
# has one root fewer and a section disappears.  The slots are written in this
# order and the ones the key does not carry are left out:
#
#     degree · tense · mood · voice · person · case · number · gender
#
# No two slots share a value, so the id parses back to the key without knowing
# the order (SLOT_OF below is that map).  A key whose `kind` is not `nominal`
# or `finite` is prefixed with the kind, because a gerund's accusative and a
# noun's accusative would otherwise both be "acc".
#
# One normalisation: on a NOUN table the gender is the lemma's, not the cell's
# (a noun table has one gender throughout), so it is left out of the id and the
# app puts the entry's own gender back when it rebuilds the key.  On an
# adjective, pronoun or numeral table gender IS a column and stays in the id.

SLOT_ORDER = ["degree", "tense", "mood", "voice", "person", "case", "number", "gender"]
SLOT_OF = {
    "pos": "degree", "comp": "degree", "super": "degree",
    "pres": "tense", "impf": "tense", "fut": "tense",
    "perf": "tense", "plupf": "tense", "futperf": "tense",
    "ind": "mood", "subj": "mood",
    "act": "voice", "pass": "voice",
    "1": "person", "2": "person", "3": "person",
    "sg": "number", "pl": "number",
    "nom": "case", "gen": "case", "dat": "case", "acc": "case", "abl": "case",
    "voc": "case", "loc": "case",
    "m": "gender", "f": "gender", "n": "gender", "c": "gender",
}
KIND_PREFIX = {"imper": "imper", "inf": "inf", "ptc": "ptc",
               "gerund": "gerund", "gerundive": "gerundive", "supine": "supine"}


def cell_id(key: dict, table_kind: str) -> str:
    """The stable id of one cell, from its own key.  Pure."""
    kind = key.get("kind")
    if kind == "gerundive":
        return "gerundive"
    slots = {s: key.get(s) for s in SLOT_ORDER}
    if kind == "nominal" and table_kind == "noun":
        slots["gender"] = None       # a noun table is one gender throughout
    if kind == "imper" and not slots["tense"]:
        slots["tense"] = "pres"      # paradigms.js leaves the present implicit
    body = [str(slots[s]) for s in SLOT_ORDER if slots.get(s)]
    if kind in ("nominal", "finite"):
        return ".".join(body)
    prefix = KIND_PREFIX.get(kind)
    if not prefix:
        raise ValueError(f"unknown cell kind {kind!r}")
    return ".".join([prefix] + body)


def group_id(section: dict) -> str:
    """
    The stable id of one section, from the keys of its cells.  A finite section
    is its tense and mood; a section of nominal cells is its degree, or `cases`
    when the cells carry none (a noun, a pronoun); anything else is its kind.
    Pure — no section index, no title.
    """
    keys = [c["key"] for r in section["rows"] for c in r["cells"] if c.get("key")]
    kinds = {k.get("kind") for k in keys}
    if kinds == {"finite"}:
        tenses = {k["tense"] for k in keys}
        moods = {k["mood"] for k in keys}
        if len(tenses) == 1 and len(moods) == 1:
            return f"{tenses.pop()}.{moods.pop()}"
    if kinds == {"nominal"}:
        degrees = {k.get("degree") for k in keys}
        if len(degrees) == 1:
            return degrees.pop() or "cases"
    if kinds <= {"ptc", "gerundive"}:
        return "ptc"
    if len(kinds) == 1:
        only = kinds.pop()
        if only in KIND_PREFIX:
            return only
    raise ValueError(f"cannot name the section {section.get('title')!r} ({sorted(kinds)})")


GROUP_LABEL = {
    "cases": "cases", "pos": "positive", "comp": "comparative", "super": "superlative",
    "imper": "imperative", "inf": "infinitives", "ptc": "participles",
    "gerund": "gerund", "supine": "supine",
}
TENSE_LABEL = lf.TENSE_LABEL
MOOD_LABEL = {"ind": "indicative", "subj": "subjunctive"}


def group_label(gid: str) -> str:
    if gid in GROUP_LABEL:
        return GROUP_LABEL[gid]
    tense, mood = gid.split(".")
    return f"{TENSE_LABEL[tense]} {MOOD_LABEL[mood]}"


# ---------------------------------------------------------------------------
# the table id — paradigms.js's own branch logic, written as ordered data.
#
# `when` is matched against the entry: every field present must hold.
#   pos            one of these parts of speech
#   h / not_h      the headword is / is not one of these
#   d / v / not_v  entry.cat[0] / cat[1]
#   gender         entry.gender is one of these
#   cat_is         entry.cat is one of these, or the entry has no cat at all
#                  (the guard on a hand table: `volō volāre` "fly" is not volō velle)
#   root0_ends_i   root 0 ends in i (capiō against pōnō)
#   lemma_matches  a regular expression over the lemma
# First match wins.  Order is the generator's order, and is load-bearing.

NON_I = sorted(lf.NON_I_STEM)

SELECT: list[dict] = [
    # nouns — the four hand tables first (paradigms.js: IRREGULAR_NOUNS)
    {"table": "vis", "when": {"pos": ["N"], "h": ["vis"]}},
    {"table": "deus", "when": {"pos": ["N"], "h": ["deus"]}},
    {"table": "domus", "when": {"pos": ["N"], "h": ["domus"]}},
    {"table": "iuppiter", "when": {"pos": ["N"], "h": ["iuppiter"]}},
    # …then the consonant stems Whitaker files as i-stems
    {"table": "decl3n", "when": {"pos": ["N"], "d": 3, "h": NON_I, "gender": ["n"]}},
    {"table": "decl3", "when": {"pos": ["N"], "d": 3, "h": NON_I}},
    {"table": "decl1g6", "when": {"pos": ["N"], "d": 1, "v": [6]}},
    {"table": "decl1g8", "when": {"pos": ["N"], "d": 1, "v": [8]}},
    {"table": "decl1", "when": {"pos": ["N"], "d": 1}},
    {"table": "decl2n", "when": {"pos": ["N"], "d": 2, "v": [2]}},
    {"table": "decl2r", "when": {"pos": ["N"], "d": 2, "v": [3]}},
    {"table": "decl2g6", "when": {"pos": ["N"], "d": 2, "v": [6, 7, 9]}},
    {"table": "decl2g8", "when": {"pos": ["N"], "d": 2, "v": [8]}},
    {"table": "decl2nus", "when": {"pos": ["N"], "d": 2, "v": [1], "gender": ["n"]}},
    {"table": "decl2n", "when": {"pos": ["N"], "d": 2, "gender": ["n"]}},
    {"table": "decl2m", "when": {"pos": ["N"], "d": 2}},
    {"table": "decl3in", "when": {"pos": ["N"], "d": 3, "v": [4]}},
    {"table": "decl3in", "when": {"pos": ["N"], "d": 3, "v": [3], "gender": ["n"]}},
    {"table": "decl3i", "when": {"pos": ["N"], "d": 3, "v": [3]}},
    {"table": "decl3n", "when": {"pos": ["N"], "d": 3, "v": [2]}},
    {"table": "decl3n", "when": {"pos": ["N"], "d": 3, "gender": ["n"], "not_v": [1]}},
    {"table": "decl3", "when": {"pos": ["N"], "d": 3}},
    {"table": "decl4n", "when": {"pos": ["N"], "d": 4, "v": [2]}},
    {"table": "decl4n", "when": {"pos": ["N"], "d": 4, "gender": ["n"]}},
    {"table": "decl4", "when": {"pos": ["N"], "d": 4}},
    {"table": "decl5", "when": {"pos": ["N"], "d": 5}},
    # adjectives
    {"table": "adj12r", "when": {"pos": ["ADJ"], "d": 1, "v": [2]}},
    {"table": "adj12ius", "when": {"pos": ["ADJ"], "d": 1, "v": [3]}},
    {"table": "adj12rius", "when": {"pos": ["ADJ"], "d": 1, "v": [4]}},
    {"table": "adj12alius", "when": {"pos": ["ADJ"], "d": 1, "v": [5]}},
    {"table": "adj12", "when": {"pos": ["ADJ"], "d": 1}},
    {"table": "adj3cons", "when": {"pos": ["ADJ"], "d": 3, "h": NON_I}},
    {"table": "adj3", "when": {"pos": ["ADJ"], "d": 3, "v": [2]}},
    {"table": "adj3three", "when": {"pos": ["ADJ"], "d": 3, "v": [3]}},
    {"table": "adj3one", "when": {"pos": ["ADJ"], "d": 3}},
    # verbs — the hand tables, then the compounds that borrow them
    {"table": "sum", "when": {"pos": ["V", "VPAR"], "h": ["sum"], "cat_is": [[5, 1]]}},
    {"table": "possum", "when": {"pos": ["V", "VPAR"], "h": ["possum"], "cat_is": [[5, 2]]}},
    {"table": "eo", "when": {"pos": ["V", "VPAR"], "h": ["eo"], "cat_is": [[6, 1]]}},
    {"table": "fero", "when": {"pos": ["V", "VPAR"], "h": ["fero"], "cat_is": [[3, 2]]}},
    {"table": "volo", "when": {"pos": ["V", "VPAR"], "h": ["volo"], "cat_is": [[6, 2]]}},
    {"table": "nolo", "when": {"pos": ["V", "VPAR"], "h": ["nolo"], "cat_is": [[6, 2]]}},
    {"table": "malo", "when": {"pos": ["V", "VPAR"], "h": ["malo"], "cat_is": [[6, 2]]}},
    {"table": "fio", "when": {"pos": ["V", "VPAR"], "h": ["fio"], "cat_is": [[3, 3]]}},
    {"table": "sumcomp", "when": {"pos": ["V", "VPAR"], "d": 5, "v": [1]}},
    {"table": "eocomp", "when": {"pos": ["V", "VPAR"], "d": 6, "v": [1]}},
    {"table": "ferocomp", "when": {"pos": ["V", "VPAR"], "d": 3, "v": [2]}},
    {"table": "conj1", "when": {"pos": ["V", "VPAR"], "d": 1}},
    {"table": "conj2", "when": {"pos": ["V", "VPAR"], "d": 2}},
    {"table": "conj4", "when": {"pos": ["V", "VPAR"], "d": 3, "v": [4]}},
    {"table": "conj3io", "when": {"pos": ["V", "VPAR"], "d": 3, "v": [1], "root0_ends_i": True}},
    {"table": "conj3", "when": {"pos": ["V", "VPAR"], "d": 3, "v": [1]}},
    # pronouns
    {"table": "ego", "when": {"pos": ["PRON"], "h": ["ego", "nos"]}},
    {"table": "tu", "when": {"pos": ["PRON"], "h": ["tu", "vos"]}},
    {"table": "se", "when": {"pos": ["PRON"], "h": ["se"]}},
    {"table": "is", "when": {"pos": ["PRON"], "h": ["is"]}},
    {"table": "hic", "when": {"pos": ["PRON"], "h": ["hic"]}},
    {"table": "ille", "when": {"pos": ["PRON"], "h": ["ille"]}},
    {"table": "iste", "when": {"pos": ["PRON"], "h": ["iste"]}},
    {"table": "ipse", "when": {"pos": ["PRON"], "h": ["ipse"]}},
    {"table": "idem", "when": {"pos": ["PRON"], "h": ["idem"]}},
    {"table": "qui", "when": {"pos": ["PRON"], "h": ["qui"]}},
    {"table": "quis", "when": {"pos": ["PRON"], "h": ["quis"]}},
    {"table": "aliquis", "when": {"pos": ["PRON"], "h": ["aliquis"]}},
    {"table": "aliqui", "when": {"pos": ["PRON"], "h": ["aliqui"]}},
    {"table": "quisque", "when": {"pos": ["PRON"], "h": ["quisque"]}},
    {"table": "quisquam", "when": {"pos": ["PRON"], "h": ["quisquam"]}},
    {"table": "quidam", "when": {"pos": ["PRON"], "h": ["quidam"]}},
    # numerals
    {"table": "unus", "when": {"pos": ["NUM"], "h": ["unus"]}},
    {"table": "duo", "when": {"pos": ["NUM"], "h": ["duo"]}},
    {"table": "tres", "when": {"pos": ["NUM"], "h": ["tres"]}},
    {"table": "numord", "when": {"pos": ["NUM"], "lemma_matches": r"(?:-a -um|ī -ae -a)$"}},
]


def _matches(entry: dict, when: dict) -> bool:
    if entry.get("pos") not in when["pos"]:
        return False
    h = entry.get("h") or ""
    if "h" in when and h not in when["h"]:
        return False
    if "not_h" in when and h in when["not_h"]:
        return False
    cat = entry.get("cat") or []
    d, v = lf._cat(entry)
    if "cat_is" in when and cat and list(cat) not in [list(c) for c in when["cat_is"]]:
        return False
    if "d" in when and d != when["d"]:
        return False
    if "v" in when and v not in when["v"]:
        return False
    if "not_v" in when and v in when["not_v"]:
        return False
    if "gender" in when and entry.get("gender") not in when["gender"]:
        return False
    if "root0_ends_i" in when:
        if (lf.root(entry, 0) or "").endswith("i") is not when["root0_ends_i"]:
            return False
    if "lemma_matches" in when and not re.search(when["lemma_matches"], entry.get("lemma") or ""):
        return False
    return True


def table_of(entry: dict) -> str | None:
    """The stable table id for a glossary entry, or None when it has no table."""
    for rule in SELECT:
        if _matches(entry, rule["when"]):
            return rule["table"]
    return None


# ---------------------------------------------------------------------------
# the tables — the learner-facing half, written by hand and checked against the
# data below.  `stock` is the book's own model words for the table: three to
# five per table where the course has that many, all of them where it has
# fewer, and one where the table IS one word.  `stock_note` says why they were chosen.

PART_LABEL = {"noun": "Nouns", "adjective": "Adjectives", "pronoun": "Pronouns",
              "verb": "Verbs", "numeral": "Numerals"}
PART_ORDER = ["noun", "adjective", "pronoun", "verb", "numeral"]

TABLES: dict[str, dict] = {
    # ---- nouns -----------------------------------------------------------
    "decl1": dict(part="noun", label="1st declension (-a, -ae)", example="puella -ae f",
                  decl=1,
                  stock=["insula", "puella", "femina", "ancilla", "nauta"],
                  stock_note="īnsula is cap. I's own first-declension noun, so a "
                             "chapter-one drill has a chapter-one word; Ørberg then builds "
                             "the declension on the women of the family — puella, fēmina, "
                             "ancilla (cap. II). nauta (cap. XVI) is here so the gender "
                             "filter has a masculine to offer."),
    "decl1g6": dict(part="noun", label="1st declension, Greek -ē", example="Crētē -ēs f",
                    decl=1,
                    stock=["arachne", "crete", "phoebe"],
                    stock_note="Every word of this table in the library: Arachnē, whom "
                               "cap. XXXII prints, and two Greek names from the Fabulae."),
    "decl1g8": dict(part="noun", label="1st declension, Greek -ās", example="Midās -ae m",
                    decl=1,
                    stock=["midas"],
                    stock_note="The only word of this shape the course prints."),
    "decl2m": dict(part="noun", label="2nd declension masculine (-us, -ī)", example="servus -ī m",
                   decl=2,
                   stock=["fluvius", "servus", "dominus", "filius", "hortus"],
                   stock_note="fluvius is cap. I's own -us noun (Nīlus fluvius est), so a "
                              "chapter-one drill has a chapter-one word; Ørberg's "
                              "second-declension pair from cap. II is servus / dominus. "
                              "fīlius is here because the -ius vocative (fīlī) is the one "
                              "cell of this table that is not regular, and hortus carries "
                              "it through cap. V."),
    "decl2n": dict(part="noun", label="2nd declension neuter (-um, -ī)", example="oppidum -ī n",
                   decl=2,
                   stock=["oppidum", "verbum", "baculum", "cubiculum", "vocabulum"],
                   stock_note="oppidum and vocābulum are the neuters of cap. I, verbum and "
                              "baculum of cap. IV, cubiculum of cap. V — the words the book "
                              "uses to show that a neuter's nominative and accusative are one."),
    "decl2r": dict(part="noun", label="2nd declension in -er / -ir", example="puer -ī m",
                   decl=2,
                   stock=["puer", "vir", "magister", "ager", "liber"],
                   stock_note="puer and vir are cap. II's own examples of the missing -us; "
                              "magister, ager and liber are the three the course prints most "
                              "often, and they show the stem losing its e (magistrī, agrī)."),
    "decl2nus": dict(part="noun", label="2nd declension neuter in -us", example="virus -ī n",
                     decl=2,
                     stock=["virus"],
                     stock_note="The vulgus type: the only word of it in the library."),
    "decl2g6": dict(part="noun", label="2nd declension, Greek -os", example="Dēlos -ī f",
                    decl=2,
                    stock=["lemnos", "delos", "lesbos", "samos", "chios"],
                    stock_note="Lēmnos is the one the course prints in cap. I; the rest are "
                               "the Greek islands of the Fabulae — the whole of this table "
                               "in the library except mēlos and aulos."),
    "decl2g8": dict(part="noun", label="2nd declension, Greek -on", example="Īlion -ī n",
                    decl=2,
                    stock=["ilion", "colon"],
                    stock_note="Both words of this table in the library."),
    "decl3": dict(part="noun", label="3rd declension, consonant stem", example="pater patris m",
                  decl=3,
                  stock=["pater", "mater", "homo", "pastor", "pes"],
                  stock_note="pater and māter are the first third-declension nouns the course "
                             "prints (cap. II) and the family words are consonant stems, not "
                             "i-stems; pāstor and homō carry cap. IX–X, and pēs shows a "
                             "nominative that hides the stem (pēs, pedis)."),
    "decl3i": dict(part="noun", label="3rd declension i-stem (gen. pl. -ium)", example="nāvis -is f",
                   decl=3,
                   stock=["ovis", "mons", "navis", "urbs", "pars"],
                   stock_note="ovis and mōns are cap. IX's own i-stems, the chapter that "
                              "introduces the third declension; nāvis and urbs are the "
                              "words Ørberg uses for -ium, and pars is the commonest of "
                              "them in the course."),
    "decl3n": dict(part="noun", label="3rd declension neuter", example="nōmen nōminis n",
                   decl=3,
                   stock=["corpus", "caput", "flumen", "nomen", "tempus"],
                   stock_note="corpus and caput are cap. XI's own neuters — the chapter is "
                              "the body — with flūmen (cap. X) and nōmen (cap. XII), the "
                              "ones Ørberg declines, and tempus, the one the rest of the "
                              "course needs most."),
    "decl3in": dict(part="noun", label="3rd declension neuter i-stem (-ia, -ium)", example="mare -is n",
                    decl=3,
                    stock=["mare", "animal", "rete"],
                    stock_note="mare and animal are cap. X–XI's own examples, and rēte is the "
                               "only other one the course prints."),
    "decl4": dict(part="noun", label="4th declension (-us, -ūs)", example="manus -ūs f",
                  decl=4,
                  stock=["manus", "exercitus", "portus", "fluctus", "impetus"],
                  stock_note="manus is the fourth-declension noun of cap. XI and exercitus "
                             "the one cap. XII declines; portus and flūctus carry the sea "
                             "chapters. manus is also the table's feminine."),
    "decl4n": dict(part="noun", label="4th declension neuter (-ū)", example="cornū -ūs n",
                   decl=4,
                   stock=["genu", "cornu"],
                   stock_note="genū (cap. VI) before cornū (cap. XXI): the two the course "
                              "teaches; the rest of this table (pecū, verū, testū) never "
                              "appears."),
    "decl5": dict(part="noun", label="5th declension (-ēs, -ēī)", example="diēs -ēī m/f",
                  decl=5,
                  stock=["dies", "res", "spes", "fides", "facies"],
                  stock_note="diēs and rēs are the pair cap. XIII–XIV teaches, and they are "
                             "also the two spellings of the genitive (diēī after a vowel, reī "
                             "after a consonant). spēs and fidēs follow at cap. XXIX."),
    "vis": dict(part="noun", label="vīs (irregular)", example="vīs f",
                decl=3, stock=["vis"], stock_note="The table is the word."),
    "deus": dict(part="noun", label="deus (irregular plural)", example="deus -ī m",
                 decl=2, stock=["deus"], stock_note="The table is the word."),
    "domus": dict(part="noun", label="domus (4th declension, 2nd-declension forms)",
                  example="domus -ūs f",
                  decl=4, stock=["domus"], stock_note="The table is the word."),
    "iuppiter": dict(part="noun", label="Iuppiter (irregular)", example="Iuppiter, Iovis m",
                     decl=3, stock=["iuppiter"], stock_note="The table is the word."),
    # ---- adjectives ------------------------------------------------------
    "adj12": dict(part="adjective", label="1st/2nd declension (-us -a -um)", example="magnus -a -um",
                  decl=12,
                  stock=["magnus", "bonus", "multus", "longus", "novus"],
                  stock_note="magnus and multus are cap. I's own adjectives and bonus cap. "
                             "IV's; all three carry the irregular comparison the course "
                             "teaches at cap. XIX. longus and novus are regular right "
                             "through, so the comparative and superlative of this table can "
                             "be practised on a word that has both."),
    "adj12r": dict(part="adjective", label="1st/2nd declension in -er", example="pulcher -chra -chrum",
                   decl=12,
                   stock=["pulcher", "niger", "miser", "aeger", "noster"],
                   stock_note="pulcher is cap. V's own -er adjective; niger, aeger and miser "
                              "show the stem dropping its e, and noster keeps it."),
    "adj12ius": dict(part="adjective", label="1st/2nd declension, genitive -īus",
                     example="sōlus -a -um (gen. -īus)", decl=12,
                     stock=["nullus", "solus", "totus", "ullus"],
                     stock_note="The four the course teaches of the ūnus / sōlus / tōtus group, "
                                "in the order it teaches them (nūllus IV, sōlus V, tōtus XIII, "
                                "ūllus XIX)."),
    "adj12rius": dict(part="adjective", label="1st/2nd declension in -er, genitive -īus",
                      example="alter altera alterum", decl=12,
                      stock=["alter", "uter", "neuter", "uterque"],
                      stock_note="The whole table: the four words cap. XIV introduces together."),
    "adj12alius": dict(part="adjective", label="alius -a -ud", example="alius -a -ud",
                       decl=12, stock=["alius"],
                       stock_note="The table is the word: the only adjective with neuter -ud."),
    "adj3": dict(part="adjective", label="3rd declension, two endings (-is, -e)",
                 example="brevis -e", decl=3,
                 stock=["brevis", "fortis", "gravis", "omnis", "facilis"],
                 stock_note="brevis, fortis and gravis are cap. XII's own two-ending "
                            "adjectives; omnis is the commonest in the course, and facilis "
                            "carries the -illimus superlative of cap. XVII."),
    "adj3one": dict(part="adjective", label="3rd declension, one ending", example="ingēns (gen. ingentis)",
                    decl=3,
                    stock=["prudens", "ingens", "audax", "felix", "ferox"],
                    stock_note="The one-ending type, where the nominative is the same for all "
                               "three genders and only the genitive shows the stem — the five "
                               "the course prints, from prūdēns (XVII) to fēlīx (XXIX)."),
    "adj3three": dict(part="adjective", label="3rd declension, three endings",
                      example="ācer ācris ācre", decl=3,
                      stock=["celer", "acer"],
                      stock_note="Both of them: the only three-ending adjectives the course "
                                 "teaches (celer XXVI, ācer XXXIV)."),
    "adj3cons": dict(part="adjective", label="3rd declension, consonant stem",
                     example="vetus (gen. veteris)", decl=3,
                     stock=["pauper", "dives", "vetus", "senex"],
                     stock_note="The consonant stems: ablative singular -e, genitive plural "
                                "-um, neuter plural -a, against the i-stem's -ī / -ium / -ia. "
                                "pauper and dīves are the pair cap. XIX teaches together."),
    # ---- pronouns --------------------------------------------------------
    "is": dict(part="pronoun", label="is, ea, id", example="is, ea, id", stock=["is"],
               stock_note="The table is the word."),
    "hic": dict(part="pronoun", label="hic, haec, hoc", example="hic, haec, hoc", stock=["hic"],
                stock_note="The table is the word."),
    "ille": dict(part="pronoun", label="ille, illa, illud", example="ille, illa, illud",
                 stock=["ille"], stock_note="The table is the word."),
    "iste": dict(part="pronoun", label="iste, ista, istud", example="iste, ista, istud",
                 stock=["iste"], stock_note="The table is the word."),
    "ipse": dict(part="pronoun", label="ipse, ipsa, ipsum", example="ipse, ipsa, ipsum",
                 stock=["ipse"], stock_note="The table is the word."),
    "idem": dict(part="pronoun", label="īdem, eadem, idem", example="īdem, eadem, idem",
                 stock=["idem"], stock_note="The table is the word."),
    "qui": dict(part="pronoun", label="quī, quae, quod (relative)", example="quī, quae, quod",
                stock=["qui"], stock_note="The table is the word."),
    "quis": dict(part="pronoun", label="quis, quid (interrogative)", example="quis, quid",
                 stock=["quis"], stock_note="The table is the word."),
    "ego": dict(part="pronoun", label="ego / nōs", example="ego, meī", stock=["ego"],
                aliases=["nos"],
                stock_note="The table is the word: nōs is its plural column, not a second "
                           "word, though the glossary files it as a headword of its own."),
    "tu": dict(part="pronoun", label="tū / vōs", example="tū, tuī", stock=["tu"],
               aliases=["vos"],
               stock_note="The table is the word: vōs is its plural column."),
    "se": dict(part="pronoun", label="sē (reflexive)", example="sē, suī", stock=["se"],
               stock_note="The table is the word."),
    "aliquis": dict(part="pronoun", label="aliquis, aliquid", example="aliquis, aliquid",
                    stock=["aliquis"], stock_note="The table is the word."),
    "aliqui": dict(part="pronoun", label="aliquī, aliqua, aliquod", example="aliquī, aliqua, aliquod",
                   stock=["aliqui"], stock_note="The table is the word."),
    "quidam": dict(part="pronoun", label="quīdam, quaedam, quoddam", example="quīdam, quaedam, quoddam",
                   stock=["quidam"], stock_note="The table is the word."),
    "quisque": dict(part="pronoun", label="quisque, quaeque, quidque", example="quisque, quidque",
                    stock=["quisque"], stock_note="The table is the word."),
    "quisquam": dict(part="pronoun", label="quisquam, quidquam", example="quisquam, quidquam",
                     stock=["quisquam"], stock_note="The table is the word."),
    # ---- verbs -----------------------------------------------------------
    "conj1": dict(part="verb", label="1st conjugation (-āre)", example="amō, amāre, amāvī, amātum",
                  conj=1,
                  stock=["voco", "canto", "amo", "laudo", "ambulo"],
                  stock_note="vocō and cantō are cap. III's own first-conjugation verbs "
                             "(with pulsō), so the chapter's drill has the chapter's words; "
                             "amō and laudō are the ones Ørberg's Grammatica Latina "
                             "conjugates, and ambulō is the commonest of them in the course."),
    "conj2": dict(part="verb", label="2nd conjugation (-ēre)", example="videō, vidēre, vīdī, vīsum",
                  conj=2,
                  stock=["video", "habeo", "respondeo", "timeo", "taceo"],
                  stock_note="videō and respondeō open cap. III, habeō cap. IV; taceō and "
                             "timeō keep the -ē- through every tense."),
    "conj3": dict(part="verb", label="3rd conjugation (-ere)", example="dīcō, dīcere, dīxī, dictum",
                  conj=3,
                  stock=["pono", "dico", "scribo", "lego", "mitto"],
                  stock_note="pōnō is the third-conjugation verb cap. IV teaches, where the "
                             "short -e- that becomes -i- and then -u- is easiest to see, "
                             "with dīcō; the other three are the ones the course prints "
                             "most."),
    "conj3io": dict(part="verb", label="3rd conjugation -iō", example="capiō, capere, cēpī, captum",
                    conj=3,
                    stock=["accipio", "aspicio", "facio", "capio", "fugio"],
                    stock_note="accipiō and aspiciō, cap. VIII, are the first -iō verbs the "
                               "course teaches; capiō and faciō are the two the book names "
                               "for this type (faciō also carries the short imperative fac), "
                               "and fugiō comes in at cap. XII."),
    "conj4": dict(part="verb", label="4th conjugation (-īre)", example="audiō, audīre, audīvī, audītum",
                  conj=4,
                  stock=["audio", "dormio", "venio", "aperio", "scio"],
                  stock_note="audiō, dormiō and veniō are cap. III's own fourth-conjugation "
                             "verbs; aperiō and sciō carry it on."),
    "sum": dict(part="verb", label="sum, esse, fuī", example="sum, esse, fuī, futūrum",
                stock=["sum"], stock_note="The table is the word."),
    "possum": dict(part="verb", label="possum, posse, potuī", example="possum, posse, potuī",
                   stock=["possum"], stock_note="The table is the word."),
    "eo": dict(part="verb", label="eō, īre, iī", example="eō, īre, iī, itum",
               stock=["eo"], stock_note="The table is the word."),
    "fero": dict(part="verb", label="ferō, ferre, tulī", example="ferō, ferre, tulī, lātum",
                 stock=["fero"], stock_note="The table is the word."),
    "volo": dict(part="verb", label="volō, velle, voluī", example="volō, velle, voluī",
                 stock=["volo"], stock_note="The table is the word."),
    "nolo": dict(part="verb", label="nōlō, nōlle, nōluī", example="nōlō, nōlle, nōluī",
                 stock=["nolo"], stock_note="The table is the word."),
    "malo": dict(part="verb", label="mālō, mālle, māluī", example="mālō, mālle, māluī",
                 stock=["malo"], stock_note="The table is the word."),
    "fio": dict(part="verb", label="fīō, fierī, factus sum", example="fīō, fierī, factus sum",
                stock=["fio"], stock_note="The table is the word."),
    "sumcomp": dict(part="verb", label="compounds of sum", example="absum, abesse, āfuī",
                    stock=["absum", "adsum", "desum", "prosum"],
                    stock_note="absum and adsum are the pair cap. IV introduces together; "
                               "dēsum and prōsum show the two irregular spellings (deest, "
                               "prōdest)."),
    "eocomp": dict(part="verb", label="compounds of eō", example="exeō, exīre, exiī",
                   stock=["exeo", "abeo", "adeo", "redeo"],
                   stock_note="The four the course prints most, from cap. VII (exeō, adeō) "
                              "to cap. XV (redeō)."),
    "ferocomp": dict(part="verb", label="compounds of ferō", example="afferō, afferre, attulī",
                     stock=["affero", "aufero", "refero", "offero"],
                     stock_note="afferō comes in at cap. XIV; all four have their own perfect "
                                "and supine stems (attulī, abstulī, rettulī, obtulī)."),
    # ---- numerals --------------------------------------------------------
    "unus": dict(part="numeral", label="ūnus, ūna, ūnum", example="ūnus, ūna, ūnum",
                 stock=["unus"], stock_note="The table is the word."),
    "duo": dict(part="numeral", label="duo, duae, duo", example="duo, duae, duo",
                stock=["duo"], stock_note="The table is the word."),
    "tres": dict(part="numeral", label="trēs, tria", example="trēs, tria",
                 stock=["tres"], stock_note="The table is the word."),
    "numord": dict(part="numeral", label="ordinals and distributives (like bonus)",
                   example="prīmus -a -um",
                   stock=["primus", "secundus", "tertius", "quartus", "decimus"],
                   stock_note="prīmus and secundus are cap. I's own ordinals; the whole "
                              "series declines like bonus, so the first five are enough to "
                              "show it."),
}

#: skills.json's `paradigm_keys` → the table (or the group inside several
#: tables) it now names.  This is the corrected KEY_CLASS: the app reads it
#: instead of guessing a class from `cat`.
KEY_MAP: dict[str, dict] = {
    **{k: {"tables": [k]} for k in [
        "decl1", "decl2m", "decl2n", "decl2r", "decl3", "decl3n", "decl3i", "decl3in",
        "decl4", "decl4n", "decl5", "adj12", "adj3", "adj3cons",
        "conj1", "conj2", "conj3", "conj3io", "conj4",
        "sum", "possum", "eo", "fero", "volo", "nolo", "malo", "fio",
        "is", "hic", "ille", "iste", "ipse", "idem", "qui", "quis", "ego", "tu", "se",
        "unus", "duo", "tres", "vis", "deus", "domus", "iuppiter"]},
    # the comparative is a GROUP inside every adjective table, never a table of
    # its own: no glossary entry renders ADJ_COMP alone.
    "adjcomp": {"tables": ["adj12", "adj12r", "adj3", "adj3one", "adj3three", "adj3cons"],
                "group": "comp"},
}

#: The chapter that *introduces* a table, where the book gives it a chapter of
#: its own later than it teaches the table's first word.  Ørberg prints pater
#: and māter in cap. II but teaches the third declension in cap. IX, and
#: skills.json says so itself: the dative lesson of cap. VII lists `decl3` among
#: the paradigms it draws on, while `third-declension` is the skill that
#: introduces it.  Every other table is introduced in the chapter that teaches
#: its first stock word (build(), below), and the first stock word of a pinned
#: table must be taught by then.
INTRODUCED_BY = {
    "decl3": "third-declension", "decl3i": "third-declension",
    "decl3n": "third-declension-neuter", "decl3in": "third-declension-neuter",
    "decl4": "fourth-declension", "decl4n": "fourth-declension",
    "decl5": "fifth-declension",
}


# ---------------------------------------------------------------------------
# the glossary


def strip_macrons(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if not unicodedata.combining(c))


def load_entries(glossary: dict) -> list[dict]:
    """
    Every distinct entry that can carry a table, in glossary order, each with
    the form key and index that locate it (`_key`, `_i`).  The identity is the
    one tests/latin_forms/parity.py uses, so the counts here are that file's.
    """
    seen, out = set(), []
    for key, entries in glossary.items():
        for i, e in enumerate(entries):
            if e.get("pos") not in POS_WITH_TABLES:
                continue
            ident = (e.get("h"), e.get("pos"), tuple(e.get("cat") or []),
                     tuple(e.get("roots") or []), e.get("gender"), e.get("kind"), e.get("lemma"))
            if ident in seen:
                continue
            seen.add(ident)
            e = dict(e)
            e["_key"] = key
            e["_i"] = i
            out.append(e)
    return out


def rendered(entry: dict) -> tuple[str, list[tuple[str, str]]] | None:
    """(paradigm kind, [(group id, cell id)]) for one entry, or None."""
    p = lf.paradigm(entry)
    if not p:
        return None
    kind = p["kind"]
    out = []
    for section in p["sections"]:
        gid = group_id(section)
        for row in section["rows"]:
            for c in row["cells"]:
                if c.get("empty") or not c.get("key"):
                    continue
                out.append((gid, cell_id(c["key"], kind)))
    return kind, out


# ---------------------------------------------------------------------------
# the course's own evidence: which chapter teaches a word, and how often it prints


def load_vocab() -> dict[tuple[str, str], dict]:
    """(headword, pos) → {chapter, count} from the chapter vocabulary decks."""
    out: dict[tuple[str, str], dict] = {}
    for path in sorted(VOCAB_DIR.glob("[0-9][0-9].json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        chapter = data["chapter"]
        for w in data.get("words", []):
            key = (strip_macrons(w.get("lemma") or "").lower(), w.get("pos"))
            out.setdefault(key, {"chapter": chapter, "count": w.get("count") or 0,
                                 "dict": w.get("dict")})
    return out


VOCAB_POS = {"N": "N", "ADJ": "ADJ", "V": "V", "VPAR": "V", "PRON": "PRON", "NUM": "NUM"}
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
WORD_RE = re.compile(r"[A-Za-zĀĒĪŌŪȲāēīōūȳ]+")


def roman_to_int(s: str) -> int:
    total, prev = 0, 0
    for ch in reversed(s.upper()):
        v = ROMAN.get(ch, 0)
        total += -v if v < prev else v
        prev = max(prev, v)
    return total


def library_forms_by_chapter() -> dict[int, set[str]]:
    """chapter → the macron-stripped word forms the course prints in it."""
    out: dict[int, set[str]] = defaultdict(set)
    for path in sorted(BUILD_DIR.glob("review-[0-9][0-9].json")):
        chapter = int(path.stem.split("-")[1])
        for unit in json.loads(path.read_text(encoding="utf-8")).get("units", []):
            for tok in WORD_RE.findall(unit.get("la") or ""):
                out[chapter].add(strip_macrons(tok).lower())
    for path in sorted(BUILD_DIR.glob("week-[0-9][0-9].json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        m = re.match(r"([IVXLC]+)", data["week"].get("chapter") or "")
        if not m:
            continue
        chapter = roman_to_int(m.group(1))
        for unit in data.get("units", []):
            for tok in WORD_RE.findall(unit.get("la") or ""):
                out[chapter].add(strip_macrons(tok).lower())
    return dict(out)


def forms_by_headword(entries: list[dict]) -> dict[str, set[str]]:
    """form (macron-stripped, lower) → the headwords that print it."""
    out: dict[str, set[str]] = defaultdict(set)
    for e in entries:
        try:
            forms = lf.single_forms(e)
        except Exception:
            continue
        for f in forms:
            out[strip_macrons(f).lower()].add(e["h"])
    return out


def first_library_chapter(entries, by_chapter, owners) -> int | None:
    """
    The earliest chapter that prints a form of one of these entries — counting
    only forms **no other headword** also makes, so `virī` (vir, not vīrus) and
    `virum` cannot date a word by another word's appearance.
    """
    hs = {e["h"] for e in entries}
    forms = set()
    for e in entries:
        try:
            candidates = lf.single_forms(e)
        except Exception:
            continue
        for f in candidates:
            key = strip_macrons(f).lower()
            if owners.get(key, set()) <= hs:
                forms.add(key)
    if not forms:
        return None
    for chapter in sorted(by_chapter):
        if forms & by_chapter[chapter]:
            return chapter
    return None


# ---------------------------------------------------------------------------
# building


def build() -> tuple[dict, list[str]]:
    problems: list[str] = []
    glossary = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    skills_raw = json.loads(SKILLS.read_text(encoding="utf-8"))
    vocab = load_vocab()
    entries = load_entries(glossary)

    # Every entry that has a table, filed under the table it renders. `render`
    # is keyed by the entry object's identity — `entries` holds every one of
    # them for the whole of this function, so the ids cannot be reused.
    by_table: dict[str, list[dict]] = defaultdict(list)
    render: dict[int, tuple[str, list[tuple[str, str]]]] = {}
    unfiled = []
    for e in entries:
        r = rendered(e)
        if not r:
            continue
        render[id(e)] = r
        tid = table_of(e)
        if tid is None:
            unfiled.append(f"{e['h']} ({e['pos']} {e.get('cat')}) renders a table but no rule claims it")
            continue
        by_table[tid].append(e)
    problems += unfiled

    for tid in sorted(set(by_table) - set(TABLES)):
        problems.append(f"table {tid!r} is realised by {len(by_table[tid])} entries "
                        f"but has no catalogue entry")
    for tid in sorted(set(TABLES) - set(by_table)):
        problems.append(f"table {tid!r} is in the catalogue but no glossary entry renders it")

    # a section may not print the same cell id twice, or the id could not name it
    for tid, es in by_table.items():
        for e in es:
            per_group = defaultdict(Counter)
            for gid, cid in render[id(e)][1]:
                per_group[gid][cid] += 1
            for gid, counts in per_group.items():
                dupes = [c for c, n in counts.items() if n > 1]
                if dupes:
                    problems.append(f"{tid}/{e['h']}: {gid} prints {dupes[0]!r} twice")

    # which skills name a table, and the chapter that introduces it
    skills = skills_raw.get("skills", [])
    skill_chapter = {s["id"]: s.get("chapter") for s in skills}
    skills_for: dict[str, list[str]] = defaultdict(list)
    drill_skills: dict[str, list[str]] = defaultdict(list)     # names the table itself, not a group of it
    group_skills: dict[tuple[str, str], list[str]] = defaultdict(list)
    chapter_from_skill: dict[str, int] = {}
    category_of: dict[str, Counter] = defaultdict(Counter)
    for s in skills:
        for key in s.get("paradigms") or []:
            spec = KEY_MAP.get(key)
            if not spec:
                continue
            for tid in spec["tables"]:
                skills_for[tid].append(s["id"])
                if s.get("category"):
                    category_of[tid][s["category"]] += 1
                if spec.get("group"):
                    # a key that names a GROUP (adjcomp = the comparative inside
                    # an adjective's table) dates the group, never the table
                    group_skills[(tid, spec["group"])].append(s["id"])
                    continue
                drill_skills[tid].append(s["id"])
                ch = s.get("chapter")
                if ch and (tid not in chapter_from_skill or ch < chapter_from_skill[tid]):
                    chapter_from_skill[tid] = ch
    for tid, skill_id in INTRODUCED_BY.items():
        if skill_id not in skill_chapter:
            problems.append(f"{tid}: INTRODUCED_BY names the skill {skill_id!r}, which skills.json does not have")
        elif skill_chapter[skill_id]:
            chapter_from_skill[tid] = skill_chapter[skill_id]
    for key in skills_raw.get("paradigm_keys", {}):
        if key not in KEY_MAP:
            problems.append(f"skills.json names the paradigm key {key!r}, which the catalogue does not map")

    by_chapter = library_forms_by_chapter()
    owners = forms_by_headword(entries)

    DEFAULT_CATEGORY = {"noun": "noun-case", "adjective": "adjective", "pronoun": "pronoun",
                        "verb": "verb-form", "numeral": "numeral"}

    parts: dict[str, list[dict]] = defaultdict(list)
    for tid, meta in TABLES.items():
        es = by_table.get(tid) or []
        if not es:
            continue
        kind = render[id(es[0])][0]
        # An alias is a second headword the generator sends to the SAME hand
        # table (nōs is ego's plural column, not another word). It renders the
        # table, but it is not another word to build it on.
        aliases = set(meta.get("aliases") or [])
        own = [e for e in es if e["h"] not in aliases] or es

        # ---- groups and cells: the union over every lemma of the table
        groups: dict[str, list[str]] = {}
        seen_cells: dict[str, set[str]] = defaultdict(set)
        lemmas_with_group: Counter = Counter()
        for e in es:
            gs = set()
            for gid, cid in render[id(e)][1]:
                if cid not in seen_cells[gid]:
                    seen_cells[gid].add(cid)
                    groups.setdefault(gid, []).append(cid)
                gs.add(gid)
            lemmas_with_group.update(gs)

        # ---- stock words
        stock = []
        for h in meta["stock"]:
            cands = [e for e in es if e["h"] == h]
            if not cands:
                problems.append(f"{tid}: stock word {h!r} does not render this table")
                continue
            cands.sort(key=lambda e: (
                0 if e["pos"] != "VPAR" else 1,
                0 if "+" not in (e.get("lemma") or "") else 1,
                # Whitaker files the common noun and the proper noun of one
                # word apart (deus "god" and Deus "God"); the table is the
                # common one, so its own lowercase line leads — the chip and
                # the column header printed "Deus -ī m" (QA N-2)
                0 if (e.get("lemma") or "")[:1].islower() else 1,
                -len(render[id(e)][1]),
                -(e.get("n") or 0),
            ))
            e = cands[0]
            v = vocab.get((h, VOCAB_POS[e["pos"]]))
            item = {"h": h, "lemma": e.get("lemma"), "pos": e["pos"],
                    "key": e["_key"], "i": e["_i"]}
            if e.get("gender"):
                item["gender"] = e["gender"]
            if e.get("kind"):
                item["kind"] = e["kind"]
            if v:
                item["chapter"] = v["chapter"]
                item["count"] = v["count"]
                item["taught"] = True
            else:
                item["taught"] = False
                if e.get("n"):
                    item["count"] = e["n"]
                lib = first_library_chapter(cands, by_chapter, owners)
                if lib:
                    item["chapter"] = lib
            item["groups"] = sorted({g for g, _ in render[id(e)][1]})
            stock.append(item)
        # Three to five where the course teaches that many, all of them where it
        # teaches fewer, at least one always.
        taught_hs = {e["h"] for e in own if (e["h"], VOCAB_POS[e["pos"]]) in vocab}
        floor = 3 if len(taught_hs) >= 3 else max(1, len(taught_hs))
        if not stock:
            problems.append(f"{tid}: no stock word")
        elif len(stock) < min(floor, len({e['h'] for e in own})):
            problems.append(f"{tid}: {len(stock)} stock words, but the course teaches "
                            f"{len(taught_hs)} words of this table")
        if len(stock) > 5:
            problems.append(f"{tid}: {len(stock)} stock words — three to five is the rule")
        if len(taught_hs) < 3:
            missed = sorted(taught_hs - {s["h"] for s in stock})
            if missed:
                problems.append(f"{tid}: the course teaches only {len(taught_hs)} words of "
                                f"this table and {missed} is not among the stock")
        for gid in groups:
            if not any(gid in s["groups"] for s in stock):
                problems.append(f"{tid}: no stock word renders the group {gid!r}")

        # ---- the chapter that introduces the table.  The course introduces a
        # table when it teaches the table's model word — the first stock word —
        # so that is the chapter, and the check below holds every table to it:
        # a chapter-one skill drills chapter-one words.  INTRODUCED_BY pins the
        # declensions the book gives a chapter of their own (pater and māter
        # are taught in cap. II, the third declension in cap. IX).  A skill that
        # merely lists a table earlier (present-indicative-3rd names eō in
        # cap. III; the book conjugates it in cap. VI) does not date it, and
        # neither does a stray word of the table taught before its model word.
        # Where the course teaches no word of the table, the library decides:
        # the earliest chapter that prints the first stock word, or any word.
        chapter, source = None, None
        first = stock[0] if stock else None
        if tid in INTRODUCED_BY and tid in chapter_from_skill:
            chapter, source = chapter_from_skill[tid], "skill"
        elif first and first.get("taught"):
            chapter = first["chapter"]
            source = "skill" if chapter_from_skill.get(tid) == chapter else "vocabulary"
        else:
            chapter = (first or {}).get("chapter") or first_library_chapter(es, by_chapter, owners)
            source = "library" if chapter else None
        # ---- the rule, as a check on the data: the first stock word must be
        # introduced at or before the table's own chapter.  For a pinned table
        # that is the pin; for every other table the chapter *is* the first
        # word's, so the check is held against the skills instead — a skill of
        # chapter c that names the table drills it in chapter c, and when the
        # course has taught a word of the table by then (a regular one: a
        # deponent cannot lead an active table) the first stock word must be
        # taught by then too.  A skill that names a table before the course
        # teaches any word of it (present-indicative-3rd and eō) is not an
        # error of the stock; the table keeps its own chapter.
        if first and chapter:
            if not first.get("chapter"):
                problems.append(f"{tid}: first stock word {first['h']!r} is neither taught by a "
                                f"deck nor printed in a chapter, so it cannot lead the stock")
            elif first["chapter"] > chapter:
                problems.append(f"{tid}: first stock word {first['h']!r} is introduced in chapter "
                                f"{first['chapter']}, after the table's own chapter {chapter}")
            elif tid not in INTRODUCED_BY:
                by_chapter_word: dict[int, str] = {}
                for e in own:
                    v = vocab.get((e["h"], VOCAB_POS[e["pos"]]))
                    if v and e.get("kind") not in ("dep", "semidep"):
                        by_chapter_word.setdefault(v["chapter"], e["h"])
                for skill_id in sorted(set(drill_skills.get(tid, [])),
                                       key=lambda k: (skill_chapter.get(k) or 99, k)):
                    c = skill_chapter.get(skill_id)
                    if not c or c >= first["chapter"]:
                        continue
                    avail = sorted((ch, h) for ch, h in by_chapter_word.items() if ch <= c)
                    if avail:
                        problems.append(f"{tid}: {skill_id} (chapter {c}) drills this table, but its "
                                        f"first stock word {first['h']!r} is taught in chapter "
                                        f"{first['chapter']} — {avail[0][1]!r} is taught by chapter {avail[0][0]}")
                        break

        # ---- the axes the data can honestly offer
        axes = build_axes(tid, meta, kind, own, groups, vocab, lemmas_with_group)
        for a in axes:
            if len(a["values"]) < 2:
                problems.append(f"{tid}: axis {a['id']!r} has only one value, so it cannot filter")
            for val in a["values"]:
                if not (val.get("lemmas") or val.get("cells")):
                    problems.append(f"{tid}: axis {a['id']!r} offers {val['v']!r}, "
                                    f"which nothing in the data has")

        table = {
            "id": tid,
            "label": meta["label"],
            "part": meta["part"],
            "kind": kind,
            "example": meta["example"],
            "category": (category_of[tid].most_common(1)[0][0] if category_of.get(tid)
                         else DEFAULT_CATEGORY[meta["part"]]),
            "chapter": chapter,
            "chapter_from": source,
            "skills": sorted(set(skills_for.get(tid, []))),
            "entries": len(es),
            "headwords": len({e["h"] for e in own}),
            "taught_headwords": len(taught_hs),
            "groups": [dict({"id": g, "label": group_label(g), "cells": cells,
                             "lemmas": lemmas_with_group[g]},
                            **({"skills": sorted(set(group_skills[(tid, g)]))}
                               if group_skills.get((tid, g)) else {}))
                       for g, cells in groups.items()],
            "axes": axes,
            "stock_note": meta["stock_note"],
            "stock": stock,
        }
        for extra in ("decl", "conj"):
            if meta.get(extra):
                table[extra] = meta[extra]
        if aliases:
            table["aliases"] = sorted(aliases)
        parts[meta["part"]].append(table)

    for part in parts:
        parts[part].sort(key=lambda t: (t["chapter"] or 99, t["id"]))

    catalogue = {
        "version": 1,
        "generated_by": "pipeline/build_paradigm_catalogue.py",
        "id_scheme": {
            "slot_order": SLOT_ORDER,
            "slot_of": SLOT_OF,
            "kind_prefix": sorted(KIND_PREFIX),
            "noun_gender_in_cell_id": False,
            "cell": "<table id>#<cell id>",
            "group": "<table id>#<group id>",
        },
        "select": SELECT,
        "keys": KEY_MAP,
        "parts": [{"id": p, "label": PART_LABEL[p], "tables": parts[p]}
                  for p in PART_ORDER if parts.get(p)],
        "totals": {
            "tables": sum(len(v) for v in parts.values()),
            "entries": sum(len(v) for v in by_table.values()),
            "headwords": len({e["h"] for es in by_table.values() for e in es}),
            "cells": sum(len(g["cells"]) for v in parts.values() for t in v for g in t["groups"]),
        },
    }
    return catalogue, problems


AXIS_LABEL = {"gender": "gender", "case": "case", "number": "number", "degree": "degree",
              "tense": "tense", "mood": "mood", "voice": "voice", "person": "person",
              "deponent": "deponent", "chapter": "chapter"}
CELL_AXES = ["degree", "tense", "mood", "voice", "person", "number", "case", "gender"]


def build_axes(tid, meta, kind, entries, groups, vocab, lemmas_with_group) -> list[dict]:
    """
    The axes this table can really filter on.  A *lemma* axis chooses the word
    the table is built on; a *cell* axis chooses which cells to drill.  An axis
    is offered only when the data holds at least two of its values.
    """
    axes: list[dict] = []
    # cell axes, read straight off the cell ids the table really has
    per_slot: dict[str, Counter] = defaultdict(Counter)
    slot_groups: dict[str, set[str]] = defaultdict(set)
    for gid, cells in groups.items():
        for cid in cells:
            for token in cid.split("."):
                slot = SLOT_OF.get(token)
                if slot:
                    per_slot[slot][token] += 1
                    slot_groups[slot].add(gid)
    for slot in CELL_AXES:
        counts = per_slot.get(slot)
        if not counts or len(counts) < 2:
            continue
        if slot == "gender" and kind == "noun":
            continue
        values = [{"v": v, "cells": n} for v, n in sorted(counts.items(),
                                                          key=lambda kv: -kv[1])]
        if slot == "degree":
            for val in values:
                val["lemmas"] = lemmas_with_group.get(val["v"], 0)
        axes.append({"id": slot, "label": AXIS_LABEL[slot], "scope": "cell",
                     "groups": sorted(slot_groups[slot]), "values": values})

    # Lemma axes are counted in HEADWORDS, not entries: an axis that only tells
    # two readings of one word apart (fīō is filed once as regular and once as
    # semi-deponent) cannot choose a different word to build the table on, so it
    # is not an axis.
    def lemma_axis(axis_id, value_of):
        by_value: dict[str, set[str]] = defaultdict(set)
        for e in entries:
            v = value_of(e)
            if v is not None:
                by_value[v].add(e["h"])
        if len(by_value) < 2 or len({h for hs in by_value.values() for h in hs}) < 2:
            return
        values = sorted(({"v": v, "lemmas": len(hs)} for v, hs in by_value.items()),
                        key=lambda d: -d["lemmas"])
        axes.append({"id": axis_id, "label": AXIS_LABEL.get(axis_id, str(axis_id)),
                     "scope": "lemma", "values": values})

    if kind == "noun":
        lemma_axis("gender", lambda e: e.get("gender"))
    if meta["part"] == "verb":
        lemma_axis("deponent",
                   lambda e: "deponent" if e.get("kind") in ("dep", "semidep") else "regular")
    lemma_axis("chapter",
               lambda e: vocab[(e["h"], VOCAB_POS[e["pos"]])]["chapter"]
               if (e["h"], VOCAB_POS[e["pos"]]) in vocab else None)
    for a in axes:
        if a["id"] == "chapter" and a["scope"] == "lemma":
            cs = sorted(v["v"] for v in a["values"])
            a["range"] = [cs[0], cs[-1]]
            a["values"].sort(key=lambda v: v["v"])
    return axes


# ---------------------------------------------------------------------------


def report(catalogue: dict) -> str:
    lines = []
    for part in catalogue["parts"]:
        lines.append(f"\n{part['label']}")
        for t in part["tables"]:
            stock = ", ".join(s["h"] for s in t["stock"])
            ch = t["chapter"] if t["chapter"] else "—"
            lines.append(f"  {t['id']:12} ch {str(ch):>3} ({t['chapter_from'] or 'unknown':<10}) "
                         f"{t['headwords']:>4} words · {sum(len(g['cells']) for g in t['groups']):>3} cells · "
                         f"{len(t['groups']):>2} groups · axes "
                         f"{','.join(a['id'] for a in t['axes']) or '—'}")
            lines.append(f"                 stock: {stock}")
    tot = catalogue["totals"]
    lines.append(f"\n{tot['tables']} tables · {tot['headwords']} headwords · "
                 f"{tot['entries']} entries · {tot['cells']} named cells")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="build and check, write nothing")
    ap.add_argument("--report", action="store_true", help="print the table roster")
    args = ap.parse_args(argv)

    catalogue, problems = build()
    if args.report:
        print(report(catalogue))
    if problems:
        print(f"\n{len(problems)} problem(s):", file=sys.stderr)
        for p in problems:
            print("   ", p, file=sys.stderr)
        return 1
    if not args.check:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(catalogue, ensure_ascii=False, separators=(",", ":"))
        OUT_PATH.write_text(text, encoding="utf-8")
        print(f"{catalogue['totals']['tables']} tables, "
              f"{catalogue['totals']['cells']} named cells, "
              f"{len(text.encode('utf-8'))/1024:.1f} KB → {OUT_PATH}")
    else:
        print(f"ok: {catalogue['totals']['tables']} tables, no problems")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
