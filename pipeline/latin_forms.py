#!/usr/bin/env python
"""
latin_forms.py — a pure form generator: glossary entry → every regular
inflected form, macronised, keyed by parse.

    from latin_forms import forms, paradigm
    forms(glossary_entry)            # [(form, parse), ...]
    paradigm(glossary_entry)         # the tables app/js/paradigms.js draws

The tables are a cell-for-cell port of app/js/paradigms.js, so the pipeline and
the app can never disagree about a form (tests/latin_forms/test_parity.py runs
both and compares every cell).  `forms()` adds what a *table* does not need but
a *generator* does: participles, gerundives and comparatives declined right
through, adverbs of adjectives, and the alternative spellings (eī / iī).

An entry is the glossary shape (app/data/glossary.json):
    {pos, cat: [d, v], roots: [r0, r1, r2, r3], gender, kind, lemma, h}
`build(...)` makes one from a lemma + principal parts.

Parses use the glossary's own vocabulary — case/number/gender, mood
(ind subj imper inf ptc gerundive gerund supine), tense (pres impf fut perf
plupf futperf), voice (act pass), person (1 2 3), degree (comp super).
"""
from __future__ import annotations

import re
import unicodedata

__all__ = ["forms", "paradigm", "build", "single_forms", "form_index",
           "declension_name", "adjective_name", "conjugation_name", "noun_number"]

CASES = ["nom", "gen", "dat", "acc", "abl", "voc"]
GENDERS = ["m", "f", "n"]
PERSONS = [(1, "sg"), (2, "sg"), (3, "sg"), (1, "pl"), (2, "pl"), (3, "pl")]
TENSES = ["pres", "impf", "fut", "perf", "plupf", "futperf"]
TENSE_LABEL = {"pres": "present", "impf": "imperfect", "fut": "future",
               "perf": "perfect", "plupf": "pluperfect", "futperf": "future perfect"}
CASE_LABEL = {"nom": "nominative", "gen": "genitive", "dat": "dative", "acc": "accusative",
              "abl": "ablative", "voc": "vocative", "loc": "locative"}
PERSON_LABEL = {"1sg": "I", "2sg": "you (sg.)", "3sg": "he / she / it",
                "1pl": "we", "2pl": "you (pl.)", "3pl": "they"}

_COMBINING = re.compile(r"[̀-ͯ]")


def _plain(s: str) -> str:
    return _COMBINING.sub("", unicodedata.normalize("NFD", s))


# --------------------------------------------------------------------- cells

def cell(stem: str, ending: str, key: dict | None = None) -> dict:
    s, e = stem or "", ending or ""
    return {"stem": s, "ending": e, "text": s + e, "key": key}


def split_cell(s, key: dict | None = None) -> dict:
    """'ill|e' → cell('ill','e'); 'ego' → cell('','ego'); '—' → an empty cell."""
    if s is None or s in ("—", "-"):
        return {"stem": "", "ending": "", "text": "—", "key": key, "empty": True}
    i = s.find("|")
    return cell("", s, key) if i < 0 else cell(s[:i], s[i + 1:], key)


def nk(c, n, g, **extra) -> dict:
    k = {"kind": "nominal", "case": c, "number": n, "gender": g}
    k.update(extra)
    return k


def fk(tense, mood, voice, i) -> dict:
    return {"kind": "finite", "tense": tense, "mood": mood, "voice": voice,
            "person": PERSONS[i][0], "number": PERSONS[i][1]}


# Whitaker's stems reach us with some long vowels missing, and a few carrying a
# macron that does not belong.  These are the verb stems Familia Romana itself
# spells otherwise; the comment on each line is what the book prints.  Every
# other macron repair below is derived, not listed.
STEM_MACRONS = {
    "ardeo":   {0: "ārd", 1: "ārd"},    # ārdēre, ārdentem, ārdentī
    "pareo":   {0: "pār", 1: "pār"},    # pārēre, pāret, pārent, pārēbō
    "lateo":   {1: "lat"},              # latēre, latet, latent — not lātus
    "fateor":  {1: "fat"},              # fatērī, fatētur, fatentī — not fātum
    "nato":    {1: "nat"},              # natāre, natat, natandō — not nātus
    "novo":    {1: "nov"},              # novus, novum; nōvī belongs to nōscō
    "labo":    {1: "lab"},              # labāre — lābī, lābitur are lābor
    "fabulor": {0: "fābul"},            # fābulārī, fābula
    "prodo":   {0: "prōd"},             # prōdere = prō + dō
    "velo":    {1: "vēl"},              # vēlō from vēlum; vēla, vēlīs
}
_VERB_POS = ("V", "VPAR")
_MACRON = "\u0304"   # U+0304, the combining macron: "a" + _MACRON is ā


def _letters(s: str) -> list[list[str]]:
    """'ārd' → [['a', _MACRON], ['r', ''], ['d', '']] — base letters with their marks."""
    out: list[list[str]] = []
    for ch in unicodedata.normalize("NFD", s or ""):
        if unicodedata.combining(ch) and out:
            out[-1][1] += ch
        else:
            out.append([ch, ""])
    return out


def merge_macrons(base: str, derived: str) -> str:
    """Give `derived` the macrons `base` carries, over the letters they share.

    Only ever ADDS a macron, and stops at the first letter that differs, so a
    derived stem that is legitimately longer than its base (sērior beside serus)
    keeps its own quantity.  A comparative or superlative never changes the
    quantity of the stem it is built on — fōrmōs- gives fōrmōsior,
    fōrmōsissimus — so the shared letters can be filled in safely.
    Kept in step with mergeMacrons() in app/js/paradigms.js.
    """
    if not base or not derived:
        return derived
    b, d = _letters(base), _letters(derived)
    changed = False
    for i in range(min(len(b), len(d))):
        if b[i][0] != d[i][0]:
            break
        if _MACRON in b[i][1] and _MACRON not in d[i][1]:
            d[i][1] += _MACRON
            changed = True
    if not changed:
        return derived
    return unicodedata.normalize("NFC", "".join(c + m for c, m in d))


def root(entry: dict, i: int, fallback: str = "") -> str:
    r = entry.get("roots") or []
    v = r[i] if i < len(r) else None
    v = v if v and v != "-" else fallback
    fix = STEM_MACRONS.get(entry.get("h") or "")
    if fix and i in fix and entry.get("pos") in _VERB_POS and _plain(fix[i]) == _plain(v):
        return fix[i]
    # Whitaker drops the stem's macrons from the comparative and superlative
    # stems of an adjective (fōrmōs- but formosi-, formōsissi-).  Put them back.
    if i in (2, 3) and entry.get("pos") in ("ADJ", "ADV") and v:
        base = r[1] if len(r) > 1 and r[1] and r[1] != "-" else (r[0] if r else "")
        return merge_macrons(base, v)
    return v


def _cat(entry: dict) -> tuple[int, int]:
    c = entry.get("cat") or []
    d = c[0] if len(c) > 0 and c[0] else 0
    v = c[1] if len(c) > 1 and c[1] else 0
    return d, v


# --------------------------------------------------------------------- nouns

NOUN_ENDINGS = {
    "1":    {"sg": ["a", "ae", "ae", "am", "ā", "a"], "pl": ["ae", "ārum", "īs", "ās", "īs", "ae"]},
    "1g6":  {"sg": ["ē", "ēs", "ae", "ēn", "ē", "ē"], "pl": ["ae", "ārum", "īs", "ās", "īs", "ae"]},
    "1g7":  {"sg": ["ēs", "ae", "ae", "ēn", "ē", "ē"], "pl": ["ae", "ārum", "īs", "ās", "īs", "ae"]},
    "1g8":  {"sg": ["ās", "ae", "ae", "ān", "ā", "ā"], "pl": ["ae", "ārum", "īs", "ās", "īs", "ae"]},
    "2m":   {"sg": ["us", "ī", "ō", "um", "ō", "e"], "pl": ["ī", "ōrum", "īs", "ōs", "īs", "ī"]},
    "2n":   {"sg": ["um", "ī", "ō", "um", "ō", "um"], "pl": ["a", "ōrum", "īs", "a", "īs", "a"]},
    "2r":   {"sg": ["", "ī", "ō", "um", "ō", ""], "pl": ["ī", "ōrum", "īs", "ōs", "īs", "ī"]},
    "2nus": {"sg": ["us", "ī", "ō", "us", "ō", "us"], "pl": None},
    "2g6":  {"sg": ["os", "ī", "ō", "on", "ō", "e"], "pl": ["ī", "ōrum", "īs", "ōs", "īs", "ī"]},
    "2g8":  {"sg": ["on", "ī", "ō", "on", "ō", "on"], "pl": ["a", "ōrum", "īs", "a", "īs", "a"]},
    "3":    {"sg": ["", "is", "ī", "em", "e", ""], "pl": ["ēs", "um", "ibus", "ēs", "ibus", "ēs"]},
    "3n":   {"sg": ["", "is", "ī", "", "e", ""], "pl": ["a", "um", "ibus", "a", "ibus", "a"]},
    "3i":   {"sg": ["", "is", "ī", "em", "e", ""], "pl": ["ēs", "ium", "ibus", "ēs", "ibus", "ēs"]},
    "3in":  {"sg": ["", "is", "ī", "", "ī", ""], "pl": ["ia", "ium", "ibus", "ia", "ibus", "ia"]},
    "4":    {"sg": ["us", "ūs", "uī", "um", "ū", "us"], "pl": ["ūs", "uum", "ibus", "ūs", "ibus", "ūs"]},
    "4n":   {"sg": ["ū", "ūs", "ū", "ū", "ū", "ū"], "pl": ["ua", "uum", "ibus", "ua", "ibus", "ua"]},
    "5":    {"sg": ["ēs", "eī", "eī", "em", "ē", "ēs"], "pl": ["ēs", "ērum", "ēbus", "ēs", "ēbus", "ēs"]},
}

IRREGULAR_NOUNS = {
    "vis": {"title": "vīs (irregular 3rd declension)",
            "note": "Singular from vī-, plural from vīr-; genitive and dative singular are rare.",
            "sg": ["vī|s", "—", "—", "v|im", "v|ī", "vī|s"],
            "pl": ["vīr|ēs", "vīr|ium", "vīr|ibus", "vīr|ēs", "vīr|ibus", "vīr|ēs"], "gender": "f"},
    "deus": {"title": "deus (2nd declension, irregular plural)",
             "note": "Vocative singular deus; plural dī / deī, dīs / deīs.",
             "sg": ["de|us", "de|ī", "de|ō", "de|um", "de|ō", "de|us"],
             "pl": ["d|ī", "de|ōrum", "d|īs", "de|ōs", "d|īs", "d|ī"], "gender": "m"},
    "domus": {"title": "domus (4th declension with 2nd-declension forms)",
              "note": "domī = at home (locative), domum = home(wards), domō = from home.",
              "sg": ["dom|us", "dom|ūs", "dom|uī", "dom|um", "dom|ō", "dom|us"],
              "pl": ["dom|ūs", "dom|uum", "dom|ibus", "dom|ōs", "dom|ibus", "dom|ūs"], "gender": "f"},
    "iuppiter": {"title": "Iuppiter (irregular)", "note": "Oblique cases from Iov-.",
                 "sg": ["Iuppiter", "Iov|is", "Iov|ī", "Iov|em", "Iov|e", "Iuppiter"],
                 "pl": None, "gender": "m"},
}

NON_I_STEM = {
    "canis", "iuvenis", "panis", "sedes", "vates", "volucris", "mensis", "apis",
    "vetus", "pauper", "dives", "senex", "princeps", "sospes", "superstes", "compos",
    "particeps", "caelebs", "pater", "mater", "frater", "parens",
}

# The contracted vocative singular of a 2nd-declension noun in -ius (Iūlī,
# Vergilī, fīlī) belongs to PROPER NAMES in -ius, plus the two common nouns
# fīlius and genius — Allen & Greenough §49.c, Bennett §25.2, Gildersleeve &
# Lodge §33. An ordinary common noun in -ius keeps the regular -ie: gladie,
# fluvie, nūntie.  Kept in step with CONTRACTED_VOC in app/js/paradigms.js.
CONTRACTED_VOC = {"filius", "genius"}
# The glossary's only proper-name signal is the capital on the lemma.
CAPITAL = re.compile(r"^[A-ZĀĒĪŌŪȲ]")

# ---------------------------------------------------------------------------
# Number: plūrālia tantum, and the words that have no plural.
#
# A word used only in the plural has NO singular — Alpēs, castra, moenia,
# līberī, dīvitiae — and a name of one person or place has no plural — Mārcus,
# Rōma, Neptūnus.  Printing the missing number invents Latin, and the chart
# drill then asks the learner to produce the invented form: the first item of
# the first chapter session was "Give the dative singular of Athēniēnsēs"
# (qa/grammar/QA-NAV-SESSION.md M1).  So the missing number is left out of the
# table altogether, exactly as the vulgus type already leaves out its plural —
# and because forms() reads the table, the generator stops making those forms
# too.  A cell that does not exist cannot become a question.
#
# Nothing here is a guess: every word is decided by the data on its own entry.
#
#   1  `entry["num"]` ('pl' / 'sg'), when something upstream already knows.
#   2  the standalone `pl` on the lemma.  build_glossary's NAMES list writes it
#      exactly where Ørberg's own vocabulary gives the word only in the plural
#      — Alpēs Alpium f pl, moenia -ium n pl, Athēniēnsēs Athēniēnsium m pl,
#      and the peoples in -ānī / -ēnsēs.  (Familia Romana: the margin gloss at
#      cap. XVI reads "Alpēs -ium f pl"; the Index vocābulōrum lists
#      "moenia -ium n 25.11" with no singular head.)  Note the *token*: vīs is
#      written "… f · pl. vīrēs -ium", where "pl." is not this marker — and vīs
#      is an IRREGULAR_NOUN with its own hand table in any case.
#   3  Whitaker's own marker on the HEAD sense: "(in the plural)", "(pl.)",
#      "usually plural".  He puts it on the head sense of a plūrāle tantum
#      (armum -ī n "arms (in the plural)"; tenebra -ae f "darkness (in the
#      plural)"; castrum -ī n "camp (military; usually plural castra)") and on
#      a LATER sense of a word that merely has one plural-only meaning (aqua
#      "rain, rainfall (in the plural)", hortus "park (in the plural)"), so
#      only the head sense counts.  Ørberg's Index vocābulōrum agrees word for
#      word on the ones he teaches: castra -ōrum n 12.93, arma -ōrum n 12.34,
#      līberī -ōrum m 2.21, dīvitiae -ārum f 29.27, tenebrae -ārum f 34.83,
#      moenia -ium n 25.11 — every one of them printed with no singular head.
#   4  a proper name off the project's own name list (`proper`) names one
#      person, place or god and has no plural: Ørberg never prints Mārcī (pl.)
#      or Rōmārum, but the generator was building them, and the drill could ask
#      for them.  Allen & Greenough, "Defective Nouns" §§99–103 (nouns wanting
#      the plural — proper names, names of materials, abstract nouns; nouns
#      used only in the plural) and §107 (a plural with a meaning of its own,
#      castra / litterae).  The exceptions are the gentile nouns and the
#      capitalised common nouns the course really does print in the plural.
#
# Kept in step with nounNumber() in app/js/paradigms.js.

#: Whitaker's plural marker, as senses.py rewrites it and as he writes it.
SENSE_PLURAL = re.compile(r"\(in the plural\)|\(pl\.\)|usu(?:ally|\.|,)\s*plural"
                          r"|usually in the plural", re.I)

# Names on the project's own list whose plural the course really prints, so
# `proper` must not take it away.  Measured over the whole library (the course
# weeks, the review shelf, the Colloquia, the margin glosses and the drills):
# each of these appears there in a form that can only be a plural.
#   Rōmānōrum / Rōmānīs / Rōmānōs  34   Germānōrum … 27   Graecōrum … 16
#   Christiānōrum … 13   Athēniēnsēs … 12   Iūdaeōrum … 5   nymphārum … 4
# Mūsa is the ninth: one of nine, and printed Mūsae wherever the course names
# them together.
PROPER_PLURAL = {"romanus", "graecus", "germanus", "christianus", "iudaeus",
                 "atheniensis", "nympha", "musa"}

# Whitaker's head-sense marker, overruled.  Every flagged word was read against
# Ørberg's Index vocābulōrum, which agrees with him word for word — castra
# -ōrum n, arma -ōrum n, tenebrae -ārum f, dīvitiae -ārum f, kalendae -ārum f,
# nōnae -ārum f pl, cūnae -ārum f, dēliciae -ārum f, nūgae -ārum f, frūgēs -um
# f, viscera -um n, līberī -ōrum m, moenia -ium n — except on these two, where
# Ørberg prints a singular head because Whitaker has filed two words under one:
#   gena -ae f 11.8      — he glosses it "cheeks (in the plural)"
#   lectus -ī m 10.125   — "chosen, picked, selected men (in the plural)" and
#                          "bed, couch" share his headword; the bed is the word
#                          the course teaches, and it is a singular.
NOT_PLURAL_ONLY = {"gena", "lectus"}

# The residue, decided by hand because no marker in the data carries it.
# aurum: a name of a material.  Ørberg's Index vocābulōrum prints "aurum -ī n
# 22.15" and the book never uses a plural of it; Allen & Greenough put the
# names of materials among the nouns wanting the plural.
SINGULAR_ONLY = {"aurum"}

GENDER_WORD = {"m": "m", "f": "f", "n": "n", "c": "m/f"}


def noun_number(entry: dict) -> str | None:
    """'pl' when the noun is used only in the plural, 'sg' when only in the
    singular, None otherwise.  Nouns only; see the block comment above."""
    if not entry or entry.get("pos") != "N":
        return None
    # An irregular has a hand table with both numbers written out (vīs / vīrēs).
    if entry.get("h") in IRREGULAR_NOUNS:
        return None
    num = entry.get("num")
    if num in ("pl", "sg"):
        return num
    lemma = entry.get("lemma") or ""
    if "pl" in lemma.split():
        return "pl"
    senses = entry.get("senses") or []
    if senses and SENSE_PLURAL.search(senses[0]) and entry.get("h") not in NOT_PLURAL_ONLY:
        return "pl"
    if entry.get("h") in SINGULAR_ONLY:
        return "sg"
    if entry.get("proper") and entry.get("h") not in PROPER_PLURAL:
        return "sg"
    return None


def noun_table_key(entry: dict) -> str | None:
    d, v = _cat(entry)
    g = entry.get("gender")
    if d == 3 and entry.get("h") in NON_I_STEM:
        return "3n" if g == "n" else "3"
    if d == 1:
        return {6: "1g6", 7: "1g7", 8: "1g8"}.get(v, "1")
    if d == 2:
        if v == 2:
            return "2n"
        if v == 3:
            return "2r"
        if v == 4:
            # Whitaker's N 2 4 is the -ium / -ius stem (aedificium, gladius),
            # whose nominative is stem + um / us: an ordinary 2nd-declension
            # noun, not the "neuter in -us" (vulgus) type.
            return "2n" if g == "n" else "2m"
        if v in (6, 7, 9):
            return "2g6"
        if v == 8:
            return "2g8"
        if v == 1 and g == "n":
            # vulgus, virus, pelagus: nom = acc = voc in -us, no plural.
            return "2nus"
        return "2n" if g == "n" else "2m"
    if d == 3:
        if v == 4:
            return "3in"
        if v == 3:
            return "3in" if g == "n" else "3i"
        if v == 2:
            return "3n"
        if g == "n" and v != 1:
            return "3n"
        return "3"
    if d == 4:
        return "4n" if (v == 2 or g == "n") else "4"
    if d == 5:
        return "5"
    return None


ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"]


def declension_name(entry: dict) -> str | None:
    d, v = _cat(entry)
    if entry.get("pos") != "N":
        return None
    if d == 9:
        return "indeclinable noun"
    if not d:
        return None
    s = f"{ORDINAL[d]} declension"
    if d == 3 and v in (3, 4) and entry.get("h") not in NON_I_STEM:
        s += " (i-stem)"
    if (d == 1 and v >= 6) or (d == 2 and v >= 6) or (d == 3 and v >= 6):
        s += " (Greek)"
    if d == 2 and v == 3:
        s += " (-er / -ir)"
    if entry.get("gender") == "n":
        s += ", neuter"
    return s


def _noun_stems(entry: dict, key: str) -> dict:
    r0 = root(entry, 0)
    r1 = root(entry, 1, r0)
    nom_stem = r0
    nom_end = NOUN_ENDINGS[key]["sg"][0] if key in NOUN_ENDINGS else ""
    if key in ("3", "3n", "3i", "3in", "2r"):
        nom_stem, nom_end = r0, ""
        if r0 != r1 and r0.startswith(r1) and r0[len(r1):] in ("is", "es", "s", "e", "x"):
            nom_stem, nom_end = r1, r0[len(r1):]
    return {"r0": r0, "r1": r1, "nomStem": nom_stem, "nomEnd": nom_end}


def _noun_paradigm(entry: dict, locative: bool = False) -> dict | None:
    h = entry.get("h")
    if h in IRREGULAR_NOUNS:
        return _irregular_noun(entry, IRREGULAR_NOUNS[h])
    key = noun_table_key(entry)
    if not key:
        return None
    tbl = NOUN_ENDINGS[key]
    st = _noun_stems(entry, key)
    r1, nom_stem, nom_end = st["r1"], st["nomStem"], st["nomEnd"]
    g = entry.get("gender") or "c"
    neuter = g == "n"
    # A 2nd-declension masculine in -ius. Only a proper name (and fīlius,
    # genius) contracts the vocative to -ī; see CONTRACTED_VOC above.
    ius_stem = key == "2m" and r1[-1:] in ("i", "ī")
    contracted = (r1[:-1] + "ī") if ius_stem else None
    ius_voc = ius_stem and (h in CONTRACTED_VOC or bool(CAPITAL.match(entry.get("lemma") or "")))

    def build(num):
        ends = tbl[num]
        if not ends:
            return None
        out = []
        for i, c in enumerate(CASES):
            stem, end = r1, ends[i]
            if num == "sg" and (c in ("nom", "voc") or (neuter and c == "acc")):
                if key.startswith("3") or key == "2r":
                    stem, end = nom_stem, nom_end
                if ius_voc and c == "voc":
                    stem, end = r1[:-1], "ī"
            if key == "5" and c in ("gen", "dat") and num == "sg" and re.search(r"[aeiouāēīōū]$", r1):
                end = "ēī"
            # No "alt" on the genitive: the contracted fīlī is a vocative in
            # this chart, and an alt is an accepted drill answer wherever it is
            # read, so one string would answer two rows.
            out.append(cell(stem, end, nk(c, num, g)))
        return out

    # A word used only in one number gets only that number's column: the missing
    # cells are never built, so nothing can ask for them.  A table that already
    # has no plural (vulgus, Iuppiter) is left exactly as it was.
    num = noun_number(entry) if tbl["pl"] else None
    sg = None if num == "pl" else build("sg")
    pl = None if num == "sg" else build("pl")
    headers = ["singular", "plural"] if (sg and pl) else (["singular"] if sg else ["plural"])
    rows = []
    for i, c in enumerate(CASES):
        cells = ([sg[i]] if sg else []) + ([pl[i]] if pl else [])
        rows.append({"label": CASE_LABEL[c], "cells": cells})
    if locative:
        loc_end = "ae" if key.startswith("1") else "ī" if key[0] in "23" else None
        if loc_end:
            cells = [cell(r1, loc_end, nk("loc", "sg", g))] if sg else []
            if pl:
                cells.append(cell(r1, tbl["pl"][4], nk("loc", "pl", g)))
            rows.append({"label": CASE_LABEL["loc"], "cells": cells})
    # Only the number fact: app/js/paradigms.js prints this same sentence and
    # then appends the table's own declension note (i-stem, -ius vocative), which
    # this side has never carried.
    note = None
    if num == "pl":
        dic = f"{pl[0]['text']} -{tbl['pl'][1]} {GENDER_WORD.get(g, '')}".strip()
        note = (f"Used only in the plural — {dic}. It has no singular, so the "
                "table has no singular column.")
    elif num == "sg":
        note = ("A name: it stands for one person or place, so it has no plural."
                if entry.get("proper") and entry.get("h") not in SINGULAR_ONLY
                else "Used only in the singular: it has no plural in use.")
    out = {"kind": "noun", "title": f"{entry.get('lemma', '')} · {declension_name(entry) or 'noun'}",
           "sections": [{"title": "cases", "headers": headers, "rows": rows}]}
    if note:
        out["note"] = note
    return out


def _irregular_noun(entry: dict, t: dict) -> dict:
    rows = []
    for i, c in enumerate(CASES):
        cells = [split_cell(t["sg"][i], nk(c, "sg", t["gender"]))]
        if t["pl"]:
            cells.append(split_cell(t["pl"][i], nk(c, "pl", t["gender"])))
        rows.append({"label": CASE_LABEL[c], "cells": cells})
    return {"kind": "noun", "title": t["title"], "note": t.get("note"),
            "sections": [{"title": "cases", "headers": ["singular", "plural"] if t["pl"] else ["singular"],
                          "rows": rows}]}


# ---------------------------------------------------------------- adjectives

ADJ_12 = {
    "sg": [["us", "a", "um"], ["ī", "ae", "ī"], ["ō", "ae", "ō"], ["um", "am", "um"], ["ō", "ā", "ō"], ["e", "a", "um"]],
    "pl": [["ī", "ae", "a"], ["ōrum", "ārum", "ōrum"], ["īs", "īs", "īs"], ["ōs", "ās", "a"], ["īs", "īs", "īs"], ["ī", "ae", "a"]],
}
ADJ_3 = {
    "sg": [["", "", ""], ["is", "is", "is"], ["ī", "ī", "ī"], ["em", "em", ""], ["ī", "ī", "ī"], ["", "", ""]],
    "pl": [["ēs", "ēs", "ia"], ["ium", "ium", "ium"], ["ibus", "ibus", "ibus"], ["ēs", "ēs", "ia"], ["ibus", "ibus", "ibus"], ["ēs", "ēs", "ia"]],
}
ADJ_3_CONS = {
    "sg": [["", "", ""], ["is", "is", "is"], ["ī", "ī", "ī"], ["em", "em", ""], ["e", "e", "e"], ["", "", ""]],
    "pl": [["ēs", "ēs", "a"], ["um", "um", "um"], ["ibus", "ibus", "ibus"], ["ēs", "ēs", "a"], ["ibus", "ibus", "ibus"], ["ēs", "ēs", "a"]],
}
ADJ_COMP = {
    "sg": [["or", "or", "us"], ["ōris", "ōris", "ōris"], ["ōrī", "ōrī", "ōrī"], ["ōrem", "ōrem", "us"], ["ōre", "ōre", "ōre"], ["or", "or", "us"]],
    "pl": [["ōrēs", "ōrēs", "ōra"], ["ōrum", "ōrum", "ōrum"], ["ōribus", "ōribus", "ōribus"], ["ōrēs", "ōrēs", "ōra"], ["ōribus", "ōribus", "ōribus"], ["ōrēs", "ōrēs", "ōra"]],
}
# A participle declines like a 3rd-declension adjective, but its ablative
# singular is -e when it is a participle proper (Ørberg, Grammatica Latina XIV:
# "ā puerō dormiente"); -ī belongs to it used as an adjective.  Both are
# generated — -ī as the alternative.
ADJ_PTC = {
    "sg": [["", "", ""], ["is", "is", "is"], ["ī", "ī", "ī"], ["em", "em", ""], ["e", "e", "e"], ["", "", ""]],
    "pl": [["ēs", "ēs", "ia"], ["ium", "ium", "ium"], ["ibus", "ibus", "ibus"], ["ēs", "ēs", "ia"], ["ibus", "ibus", "ibus"], ["ēs", "ēs", "ia"]],
}


def _adj_section(title, stem_for, table, degree, extra=None, suffix=""):
    rows = []
    for num in ("sg", "pl"):
        for i, c in enumerate(CASES):
            cells = []
            for gi, g in enumerate(GENDERS):
                stem, ending = stem_for(c, num, g, table[num][i][gi])
                cells.append(cell(stem, ending + suffix, nk(c, num, g, degree=degree, **(extra or {}))))
            rows.append({"label": f"{CASE_LABEL[c]} {'sg.' if num == 'sg' else 'pl.'}", "cells": cells})
    return {"title": title, "headers": ["masculine", "feminine", "neuter"], "rows": rows}


def adjective_name(entry: dict) -> str:
    d, v = _cat(entry)
    if entry.get("kind") == "comp" or d == 0:
        return "comparative adjective"
    if d == 1:
        return ("1st/2nd declension adjective (-er)" if v == 2 else
                "1st/2nd declension adjective (genitive -īus)" if v in (3, 4, 5) else
                "1st/2nd declension adjective")
    if d == 3:
        return {1: "3rd declension adjective (one ending)",
                2: "3rd declension adjective (two endings)",
                3: "3rd declension adjective (three endings)"}.get(v, "3rd declension adjective")
    if d == 9:
        return "indeclinable adjective"
    return "adjective"


#: Adjectives build_glossary keeps as one word with a fixed enclitic on the end.
#: Whitaker's roots are the bare stem (uter- / utr-, plēr-), so the table has to
#: hang the enclitic back on every cell, exactly as _pronoun_paradigm does for
#: quisque: uterque, utraque, utrumque, utrīusque, utrīque (Allen & Greenough
#: §151.a), plērīque, plēraeque, plēraque, plērōrumque (§151.b).  Kept in step
#: with ADJ_SUFFIX in app/js/paradigms.js.
ADJ_SUFFIX = {"uterque": "que", "plerique": "que"}


def _adjective_paradigm(entry: dict) -> dict | None:
    d, v = _cat(entry)
    r0 = root(entry, 0)
    r1 = root(entry, 1, r0)
    r2 = root(entry, 2)
    r3 = root(entry, 3)
    sections = []
    suffix = ADJ_SUFFIX.get(entry.get("h") or "", "")
    comp_only = bool((entry.get("lemma") or "").endswith("or -us")) and not d

    if not comp_only and d in (1, 3):
        if d == 1:
            ius_type = v in (3, 4, 5)

            def stem_for(c, num, g, end):
                if num == "sg":
                    if ius_type and c == "gen":
                        return r1, "īus"
                    if ius_type and c == "dat":
                        return r1, "ī"
                    if v == 5 and g == "n" and c in ("nom", "acc", "voc"):
                        return r1, "ud"
                    if v in (2, 4) and g == "m" and c in ("nom", "voc"):
                        return r0, ""
                return r1, end
        else:
            def stem_for(c, num, g, end):
                if num == "sg" and (c in ("nom", "voc") or (g == "n" and c == "acc")):
                    if v == 1:
                        return r0, ""
                    if v == 2:
                        return r1, ("e" if g == "n" else "is")
                    if v == 3:
                        return (r0, "") if g == "m" else (r1, "e" if g == "n" else "is")
                    return r0, ""
                return r1, end
        cons = d == 3 and entry.get("h") in NON_I_STEM
        sections.append(_adj_section("positive", stem_for,
                                     ADJ_12 if d == 1 else (ADJ_3_CONS if cons else ADJ_3), "pos",
                                     suffix=suffix))
    if r2 or comp_only:
        cs = r0 if comp_only else r2
        sections.append(_adj_section("comparative" if comp_only else f"comparative ({cs}or, {cs}us)",
                                     lambda c, num, g, end, cs=cs: (cs, end), ADJ_COMP,
                                     "pos" if comp_only else "comp", suffix=suffix))
    if r3:
        sections.append(_adj_section(f"superlative ({r3}mus -a -um)",
                                     lambda c, num, g, end: (r3, "m" + end), ADJ_12, "super",
                                     suffix=suffix))
    if not sections:
        return None
    return {"kind": "adjective", "title": f"{entry.get('lemma', '')} · {adjective_name(entry)}",
            "sections": sections}


# ------------------------------------------------------------------ pronouns

PRON_TABLES = {
    "is": {"title": "is, ea, id · he, she, it; that", "headers": ["masculine", "feminine", "neuter"],
           "sg": [["i|s", "e|a", "i|d"], ["e|ius", "e|ius", "e|ius"], ["e|ī", "e|ī", "e|ī"],
                  ["e|um", "e|am", "i|d"], ["e|ō", "e|ā", "e|ō"]],
           "pl": [["e|ī / i|ī", "e|ae", "e|a"], ["e|ōrum", "e|ārum", "e|ōrum"],
                  ["e|īs / i|īs", "e|īs / i|īs", "e|īs / i|īs"], ["e|ōs", "e|ās", "e|a"],
                  ["e|īs / i|īs", "e|īs / i|īs", "e|īs / i|īs"]]},
    "hic": {"title": "hic, haec, hoc · this", "headers": ["masculine", "feminine", "neuter"],
            "sg": [["h|ic", "h|aec", "h|oc"], ["h|uius", "h|uius", "h|uius"], ["h|uic", "h|uic", "h|uic"],
                   ["h|unc", "h|anc", "h|oc"], ["h|ōc", "h|āc", "h|ōc"]],
            "pl": [["h|ī", "h|ae", "h|aec"], ["h|ōrum", "h|ārum", "h|ōrum"], ["h|īs", "h|īs", "h|īs"],
                   ["h|ōs", "h|ās", "h|aec"], ["h|īs", "h|īs", "h|īs"]]},
    "ille": {"title": "ille, illa, illud · that", "headers": ["masculine", "feminine", "neuter"],
             "sg": [["ill|e", "ill|a", "ill|ud"], ["ill|īus", "ill|īus", "ill|īus"], ["ill|ī", "ill|ī", "ill|ī"],
                    ["ill|um", "ill|am", "ill|ud"], ["ill|ō", "ill|ā", "ill|ō"]],
             "pl": [["ill|ī", "ill|ae", "ill|a"], ["ill|ōrum", "ill|ārum", "ill|ōrum"], ["ill|īs", "ill|īs", "ill|īs"],
                    ["ill|ōs", "ill|ās", "ill|a"], ["ill|īs", "ill|īs", "ill|īs"]]},
    "iste": {"title": "iste, ista, istud · that (of yours)", "headers": ["masculine", "feminine", "neuter"],
             "sg": [["ist|e", "ist|a", "ist|ud"], ["ist|īus", "ist|īus", "ist|īus"], ["ist|ī", "ist|ī", "ist|ī"],
                    ["ist|um", "ist|am", "ist|ud"], ["ist|ō", "ist|ā", "ist|ō"]],
             "pl": [["ist|ī", "ist|ae", "ist|a"], ["ist|ōrum", "ist|ārum", "ist|ōrum"], ["ist|īs", "ist|īs", "ist|īs"],
                    ["ist|ōs", "ist|ās", "ist|a"], ["ist|īs", "ist|īs", "ist|īs"]]},
    "ipse": {"title": "ipse, ipsa, ipsum · -self", "headers": ["masculine", "feminine", "neuter"],
             "sg": [["ips|e", "ips|a", "ips|um"], ["ips|īus", "ips|īus", "ips|īus"], ["ips|ī", "ips|ī", "ips|ī"],
                    ["ips|um", "ips|am", "ips|um"], ["ips|ō", "ips|ā", "ips|ō"]],
             "pl": [["ips|ī", "ips|ae", "ips|a"], ["ips|ōrum", "ips|ārum", "ips|ōrum"], ["ips|īs", "ips|īs", "ips|īs"],
                    ["ips|ōs", "ips|ās", "ips|a"], ["ips|īs", "ips|īs", "ips|īs"]]},
    "idem": {"title": "īdem, eadem, idem · the same", "headers": ["masculine", "feminine", "neuter"],
             "sg": [["ī|dem", "ea|dem", "i|dem"], ["eius|dem", "eius|dem", "eius|dem"], ["eī|dem", "eī|dem", "eī|dem"],
                    ["eun|dem", "ean|dem", "i|dem"], ["eō|dem", "eā|dem", "eō|dem"]],
             "pl": [["eī|dem / iī|dem", "eae|dem", "ea|dem"], ["eōrun|dem", "eārun|dem", "eōrun|dem"],
                    ["eīs|dem / iīs|dem", "eīs|dem", "eīs|dem"], ["eōs|dem", "eās|dem", "ea|dem"],
                    ["eīs|dem / iīs|dem", "eīs|dem", "eīs|dem"]]},
    "qui": {"title": "quī, quae, quod · who, which, that", "headers": ["masculine", "feminine", "neuter"],
            "sg": [["qu|ī", "qu|ae", "qu|od"], ["c|uius", "c|uius", "c|uius"], ["c|ui", "c|ui", "c|ui"],
                   ["qu|em", "qu|am", "qu|od"], ["qu|ō", "qu|ā", "qu|ō"]],
            "pl": [["qu|ī", "qu|ae", "qu|ae"], ["qu|ōrum", "qu|ārum", "qu|ōrum"], ["qu|ibus", "qu|ibus", "qu|ibus"],
                   ["qu|ōs", "qu|ās", "qu|ae"], ["qu|ibus", "qu|ibus", "qu|ibus"]]},
    "quis": {"title": "quis, quid · who? what?", "headers": ["masculine / feminine", "neuter"],
             "sg": [["qu|is", "qu|id"], ["c|uius", "c|uius"], ["c|ui", "c|ui"], ["qu|em", "qu|id"], ["qu|ō", "qu|ō"]],
             "pl": [["qu|ī", "qu|ae"], ["qu|ōrum", "qu|ōrum"], ["qu|ibus", "qu|ibus"], ["qu|ōs", "qu|ae"],
                    ["qu|ibus", "qu|ibus"]], "genders": ["c", "n"]},
    "ego": {"title": "ego · I", "headers": ["singular (I)", "plural (we)"],
            "sg": [["ego", "n|ōs"], ["me|ī", "nostr|um / nostr|ī"], ["m|ihi", "n|ōbīs"], ["m|ē", "n|ōs"],
                   ["m|ē", "n|ōbīs"]], "personal": True},
    "tu": {"title": "tū · you", "headers": ["singular (you)", "plural (you all)"],
           "sg": [["t|ū", "v|ōs"], ["tu|ī", "vestr|um / vestr|ī"], ["t|ibi", "v|ōbīs"], ["t|ē", "v|ōs"],
                  ["t|ē", "v|ōbīs"]], "personal": True},
    "se": {"title": "sē · himself, herself, itself, themselves", "headers": ["singular and plural"],
           "sg": [["—"], ["su|ī"], ["s|ibi"], ["s|ē / s|ēsē"], ["s|ē / s|ēsē"]], "personal": True,
           "note": "No nominative: the reflexive always refers back to the subject."},
}
PRON_TABLES["nos"] = PRON_TABLES["ego"]
PRON_TABLES["vos"] = PRON_TABLES["tu"]

QU_COMPOUNDS = {
    "aliquis": {"base": "quis", "prefix": "ali", "suffix": "", "title": "aliquis, aliquid · someone, something",
                "note": "Declines like quis with ali- in front; feminine aliqua, neuter plural aliqua."},
    "aliqui": {"base": "qui", "prefix": "ali", "suffix": "", "title": "aliquī, aliqua, aliquod · some"},
    "quisque": {"base": "quis", "prefix": "", "suffix": "que", "title": "quisque, quaeque, quidque · each"},
    "quisquam": {"base": "quis", "prefix": "", "suffix": "quam", "title": "quisquam, quidquam · anyone, anything"},
    "quidam": {"base": "qui", "prefix": "", "suffix": "dam", "title": "quīdam, quaedam, quoddam · a certain",
               "note": "Before -dam an m becomes n: quendam, quandam, quōrundam."},
    "quicumque": {"base": "qui", "prefix": "", "suffix": "cumque",
                  "title": "quīcumque, quaecumque, quodcumque · whoever, whatever"},
    "quilibet": {"base": "qui", "prefix": "", "suffix": "libet", "title": "quīlibet · anyone you like"},
    "quivis": {"base": "qui", "prefix": "", "suffix": "vīs", "title": "quīvīs · anyone you please"},
}


def _pronoun_paradigm(entry: dict) -> dict | None:
    h = entry.get("h")
    t = PRON_TABLES.get(h)
    prefix = suffix = ""
    if not t and h in QU_COMPOUNDS:
        c = QU_COMPOUNDS[h]
        t = dict(PRON_TABLES[c["base"]])
        t["title"] = c["title"]
        t["note"] = c.get("note")
        prefix, suffix = c["prefix"], c["suffix"]
    if not t:
        return None
    genders = t.get("genders") or ([None] if t.get("personal") else GENDERS)
    case_list = ["nom", "gen", "dat", "acc", "abl"]

    def mk(s, key):
        if " / " in s:
            a, b = s.split(" / ")
            ca, cb = mk(a, key), mk(b, key)
            c = dict(ca)
            c["text"] = f"{ca['text']} / {cb['text']}"
            c["alt"] = cb["text"]
            return c
        c = split_cell(s, key)
        if c.get("empty"):
            return c
        if prefix or suffix:
            stem, ending = c["stem"], c["ending"]
            if suffix == "dam" and c["text"].endswith("m"):
                ending = re.sub(r"m$", "n", ending)
            return cell(prefix + stem, ending + suffix, key)
        return c

    rows = []
    if t.get("personal"):
        for i, c in enumerate(case_list):
            cells = []
            for col, s in enumerate(t["sg"][i]):
                num = ("sg" if col == 0 else "pl") if len(t["headers"]) == 2 else None
                cells.append(mk(s, nk(c, num, None)))
            rows.append({"label": CASE_LABEL[c], "cells": cells})
        return {"kind": "pronoun", "title": t["title"], "note": t.get("note"),
                "sections": [{"title": "cases", "headers": t["headers"], "rows": rows}]}
    for num in ("sg", "pl"):
        for i, c in enumerate(case_list):
            cells = [mk(s, nk(c, num, genders[gi])) for gi, s in enumerate(t[num][i])]
            rows.append({"label": f"{CASE_LABEL[c]} {'sg.' if num == 'sg' else 'pl.'}", "cells": cells})
    return {"kind": "pronoun", "title": t["title"], "note": t.get("note"),
            "sections": [{"title": "cases", "headers": t["headers"], "rows": rows}]}


# --------------------------------------------------------------------- verbs

CONJ = {
    1: {
        "pres": {"act": ["ō", "ās", "at", "āmus", "ātis", "ant"],
                 "pass": ["or", "āris", "ātur", "āmur", "āminī", "antur"]},
        "impf": {"act": ["ābam", "ābās", "ābat", "ābāmus", "ābātis", "ābant"],
                 "pass": ["ābar", "ābāris", "ābātur", "ābāmur", "ābāminī", "ābantur"]},
        "fut": {"act": ["ābō", "ābis", "ābit", "ābimus", "ābitis", "ābunt"],
                "pass": ["ābor", "āberis", "ābitur", "ābimur", "ābiminī", "ābuntur"]},
        "presSubj": {"act": ["em", "ēs", "et", "ēmus", "ētis", "ent"],
                     "pass": ["er", "ēris", "ētur", "ēmur", "ēminī", "entur"]},
        "impfSubj": {"act": ["ārem", "ārēs", "āret", "ārēmus", "ārētis", "ārent"],
                     "pass": ["ārer", "ārēris", "ārētur", "ārēmur", "ārēminī", "ārentur"]},
        "imper": {"act": ["ā", "āte"], "pass": ["āre", "āminī"], "futAct": ["ātō", "ātōte"], "fut3": ["ātō", "antō"]},
        "inf": {"act": "āre", "pass": "ārī"}, "presPtc": "āns", "gerund": "and", "presPtcGen": "antis",
    },
    2: {
        "pres": {"act": ["eō", "ēs", "et", "ēmus", "ētis", "ent"],
                 "pass": ["eor", "ēris", "ētur", "ēmur", "ēminī", "entur"]},
        "impf": {"act": ["ēbam", "ēbās", "ēbat", "ēbāmus", "ēbātis", "ēbant"],
                 "pass": ["ēbar", "ēbāris", "ēbātur", "ēbāmur", "ēbāminī", "ēbantur"]},
        "fut": {"act": ["ēbō", "ēbis", "ēbit", "ēbimus", "ēbitis", "ēbunt"],
                "pass": ["ēbor", "ēberis", "ēbitur", "ēbimur", "ēbiminī", "ēbuntur"]},
        "presSubj": {"act": ["eam", "eās", "eat", "eāmus", "eātis", "eant"],
                     "pass": ["ear", "eāris", "eātur", "eāmur", "eāminī", "eantur"]},
        "impfSubj": {"act": ["ērem", "ērēs", "ēret", "ērēmus", "ērētis", "ērent"],
                     "pass": ["ērer", "ērēris", "ērētur", "ērēmur", "ērēminī", "ērentur"]},
        "imper": {"act": ["ē", "ēte"], "pass": ["ēre", "ēminī"], "futAct": ["ētō", "ētōte"], "fut3": ["ētō", "entō"]},
        "inf": {"act": "ēre", "pass": "ērī"}, "presPtc": "ēns", "gerund": "end", "presPtcGen": "entis",
    },
    3: {
        "pres": {"act": ["ō", "is", "it", "imus", "itis", "unt"],
                 "pass": ["or", "eris", "itur", "imur", "iminī", "untur"]},
        "impf": {"act": ["ēbam", "ēbās", "ēbat", "ēbāmus", "ēbātis", "ēbant"],
                 "pass": ["ēbar", "ēbāris", "ēbātur", "ēbāmur", "ēbāminī", "ēbantur"]},
        "fut": {"act": ["am", "ēs", "et", "ēmus", "ētis", "ent"],
                "pass": ["ar", "ēris", "ētur", "ēmur", "ēminī", "entur"]},
        "presSubj": {"act": ["am", "ās", "at", "āmus", "ātis", "ant"],
                     "pass": ["ar", "āris", "ātur", "āmur", "āminī", "antur"]},
        "impfSubj": {"act": ["erem", "erēs", "eret", "erēmus", "erētis", "erent"],
                     "pass": ["erer", "erēris", "erētur", "erēmur", "erēminī", "erentur"]},
        "imper": {"act": ["e", "ite"], "pass": ["ere", "iminī"], "futAct": ["itō", "itōte"], "fut3": ["itō", "untō"]},
        "inf": {"act": "ere", "pass": "ī"}, "presPtc": "ēns", "gerund": "end", "presPtcGen": "entis",
    },
    "3io": {
        "pres": {"act": ["iō", "is", "it", "imus", "itis", "iunt"],
                 "pass": ["ior", "eris", "itur", "imur", "iminī", "iuntur"]},
        "impf": {"act": ["iēbam", "iēbās", "iēbat", "iēbāmus", "iēbātis", "iēbant"],
                 "pass": ["iēbar", "iēbāris", "iēbātur", "iēbāmur", "iēbāminī", "iēbantur"]},
        "fut": {"act": ["iam", "iēs", "iet", "iēmus", "iētis", "ient"],
                "pass": ["iar", "iēris", "iētur", "iēmur", "iēminī", "ientur"]},
        "presSubj": {"act": ["iam", "iās", "iat", "iāmus", "iātis", "iant"],
                     "pass": ["iar", "iāris", "iātur", "iāmur", "iāminī", "iantur"]},
        "impfSubj": {"act": ["erem", "erēs", "eret", "erēmus", "erētis", "erent"],
                     "pass": ["erer", "erēris", "erētur", "erēmur", "erēminī", "erentur"]},
        "imper": {"act": ["e", "ite"], "pass": ["ere", "iminī"], "futAct": ["itō", "itōte"], "fut3": ["itō", "iuntō"]},
        "inf": {"act": "ere", "pass": "ī"}, "presPtc": "iēns", "gerund": "iend", "presPtcGen": "ientis",
    },
    4: {
        "pres": {"act": ["iō", "īs", "it", "īmus", "ītis", "iunt"],
                 "pass": ["ior", "īris", "ītur", "īmur", "īminī", "iuntur"]},
        "impf": {"act": ["iēbam", "iēbās", "iēbat", "iēbāmus", "iēbātis", "iēbant"],
                 "pass": ["iēbar", "iēbāris", "iēbātur", "iēbāmur", "iēbāminī", "iēbantur"]},
        "fut": {"act": ["iam", "iēs", "iet", "iēmus", "iētis", "ient"],
                "pass": ["iar", "iēris", "iētur", "iēmur", "iēminī", "ientur"]},
        "presSubj": {"act": ["iam", "iās", "iat", "iāmus", "iātis", "iant"],
                     "pass": ["iar", "iāris", "iātur", "iāmur", "iāminī", "iantur"]},
        "impfSubj": {"act": ["īrem", "īrēs", "īret", "īrēmus", "īrētis", "īrent"],
                     "pass": ["īrer", "īrēris", "īrētur", "īrēmur", "īrēminī", "īrentur"]},
        "imper": {"act": ["ī", "īte"], "pass": ["īre", "īminī"], "futAct": ["ītō", "ītōte"], "fut3": ["ītō", "iuntō"]},
        "inf": {"act": "īre", "pass": "īrī"}, "presPtc": "iēns", "gerund": "iend", "presPtcGen": "ientis",
    },
}
PERF = {
    "perf": ["ī", "istī", "it", "imus", "istis", "ērunt"],
    "plupf": ["eram", "erās", "erat", "erāmus", "erātis", "erant"],
    "futperf": ["erō", "eris", "erit", "erimus", "eritis", "erint"],
    "perfSubj": ["erim", "erīs", "erit", "erīmus", "erītis", "erint"],
    "plupfSubj": ["issem", "issēs", "isset", "issēmus", "issētis", "issent"],
}
SUM_FORMS = {
    "perf": ["sum", "es", "est", "sumus", "estis", "sunt"],
    "plupf": ["eram", "erās", "erat", "erāmus", "erātis", "erant"],
    "futperf": ["erō", "eris", "erit", "erimus", "eritis", "erunt"],
    "perfSubj": ["sim", "sīs", "sit", "sīmus", "sītis", "sint"],
    "plupfSubj": ["essem", "essēs", "esset", "essēmus", "essētis", "essent"],
}
SHORT_IMPERATIVES = {"dic": "dīc", "duc": "dūc", "fac": "fac"}


def conjugation_name(entry: dict) -> str | None:
    d, v = _cat(entry)
    kind = entry.get("kind")
    r0 = root(entry, 0)
    name = None
    if d == 1:
        name = "1st conjugation"
    elif d == 2:
        name = "2nd conjugation"
    elif d == 3 and v == 1:
        name = "3rd conjugation (-iō)" if r0.endswith("i") else "3rd conjugation"
    elif d == 3 and v == 4:
        name = "4th conjugation"
    elif d in (5, 6, 7) or (d == 3 and v in (2, 3)):
        name = "irregular verb"
    if kind == "dep":
        return f"deponent, {name}" if name else "deponent verb"
    if kind == "semidep":
        return f"semi-deponent, {name}" if name else "semi-deponent verb"
    if kind == "impers":
        return f"impersonal, {name}" if name else "impersonal verb"
    if kind == "perfdef":
        return "defective verb (perfect forms only)"
    return name


def conj_key(entry: dict):
    d, v = _cat(entry)
    r0 = root(entry, 0)
    if d == 1:
        return 1
    if d == 2:
        return 2
    if d == 3 and v == 4:
        return 4
    if d == 3 and v == 1:
        return "3io" if r0.endswith("i") else 3
    return None


def _person_rows(cols):
    return [{"label": PERSON_LABEL[f"{p}{n}"], "cells": [col[i] for col in cols]}
            for i, (p, n) in enumerate(PERSONS)]


def _regular_verb_paradigm(entry: dict) -> dict | None:
    ck = conj_key(entry)
    if not ck:
        return None
    C = CONJ[ck]
    r0 = root(entry, 0)
    r1 = root(entry, 1, r0)
    r2 = root(entry, 2)
    r3 = root(entry, 3)
    kind = entry.get("kind")
    dep, semi, impers = kind == "dep", kind == "semidep", kind == "impers"
    sections = []
    voices = ["pass"] if dep else ["act", "pass"]
    empty = lambda: {"stem": "", "ending": "—", "text": "—", "key": None, "empty": True}

    def header_for(vc):
        return "deponent" if dep else ("active" if vc == "act" else "passive")

    def present_system(tense, table, mood):
        cols, heads = [], []
        for vc in voices:
            if semi and vc == "pass":
                continue
            cols.append([cell(r1, e, fk(tense, mood, vc, i)) for i, e in enumerate(table[vc])])
            heads.append(header_for(vc))
        return {"title": f"{TENSE_LABEL[tense]} {'subjunctive' if mood == 'subj' else 'indicative'}",
                "headers": heads, "rows": _person_rows(cols)}

    def perfect_system(tense, mood):
        cols, heads = [], []
        active_ends = (PERF["perfSubj"] if tense == "perf" else PERF["plupfSubj"]) if mood == "subj" else PERF[tense]
        aux_key = ("perfSubj" if tense == "perf" else "plupfSubj") if mood == "subj" else tense
        aux = SUM_FORMS[aux_key]
        if not dep and not semi:
            if r2:
                cols.append([cell(r2, e, fk(tense, mood, "act", i)) for i, e in enumerate(active_ends)])
            else:
                cols.append([dict(empty(), key=fk(tense, mood, "act", i)) for i in range(6)])
            heads.append("active")
        if r3:
            cols.append([cell(r3, f"{'us' if i < 3 else 'ī'} {a}", fk(tense, mood, "pass", i))
                         for i, a in enumerate(aux)])
            heads.append("deponent" if (dep or semi) else "passive")
        return {"title": f"{TENSE_LABEL[tense]} {'subjunctive' if mood == 'subj' else 'indicative'}",
                "headers": heads, "rows": _person_rows(cols)}

    sections.append(present_system("pres", C["pres"], "ind"))
    sections.append(present_system("impf", C["impf"], "ind"))
    sections.append(present_system("fut", C["fut"], "ind"))
    sections.append(perfect_system("perf", "ind"))
    sections.append(perfect_system("plupf", "ind"))
    sections.append(perfect_system("futperf", "ind"))
    sections.append(present_system("pres", C["presSubj"], "subj"))
    sections.append(present_system("impf", C["impfSubj"], "subj"))
    sections.append(perfect_system("perf", "subj"))
    sections.append(perfect_system("plupf", "subj"))

    cols, heads = [], []
    if not dep:
        sg, sg_stem = C["imper"]["act"][0], r1
        short = SHORT_IMPERATIVES.get(_plain(r1))
        if short:
            sg, sg_stem = "", short
        cols.append([cell(sg_stem, sg, {"kind": "imper", "tense": "pres", "voice": "act", "number": "sg"}),
                     cell(r1, C["imper"]["act"][1], {"kind": "imper", "tense": "pres", "voice": "act", "number": "pl"})])
        heads.append("active")
    if not semi:
        cols.append([cell(r1, C["imper"]["pass"][0], {"kind": "imper", "tense": "pres", "voice": "pass", "number": "sg"}),
                     cell(r1, C["imper"]["pass"][1], {"kind": "imper", "tense": "pres", "voice": "pass", "number": "pl"})])
        heads.append("deponent" if dep else "passive")
    rows = [{"label": "you (sg.)", "cells": [c[0] for c in cols]},
            {"label": "you (pl.)", "cells": [c[1] for c in cols]}]
    if not dep:
        def fut_row(label, ending, key):
            return {"label": label,
                    "cells": [cell(r1, ending, key) if ci == 0 else empty() for ci in range(len(cols))]}
        rows.append(fut_row("future, you (sg.) / he", C["imper"]["futAct"][0],
                            {"kind": "imper", "tense": "fut", "voice": "act", "number": "sg"}))
        rows.append(fut_row("future, you (pl.)", C["imper"]["futAct"][1],
                            {"kind": "imper", "tense": "fut", "voice": "act", "number": "pl", "person": 2}))
        rows.append(fut_row("future, they", C["imper"]["fut3"][1],
                            {"kind": "imper", "tense": "fut", "voice": "act", "number": "pl", "person": 3}))
    sections.append({"title": "imperative", "headers": heads, "rows": rows})

    heads = ["deponent"] if dep else ["active", "passive"]
    pres_act = cell(r1, C["inf"]["act"], {"kind": "inf", "tense": "pres", "voice": "act"})
    pres_pass = cell(r1, C["inf"]["pass"], {"kind": "inf", "tense": "pres", "voice": "pass"})
    perf_act = cell(r2, "isse", {"kind": "inf", "tense": "perf", "voice": "act"}) if r2 else empty()
    perf_pass = cell(r3, "us esse", {"kind": "inf", "tense": "perf", "voice": "pass"}) if r3 else empty()
    fut_act = cell(r3, "ūrus esse", {"kind": "inf", "tense": "fut", "voice": "act"}) if r3 else empty()
    fut_pass = cell(r3, "um īrī", {"kind": "inf", "tense": "fut", "voice": "pass"}) if r3 else empty()
    if dep:
        rows = [{"label": "present", "cells": [pres_pass]}, {"label": "perfect", "cells": [perf_pass]},
                {"label": "future", "cells": [fut_act]}]
    else:
        rows = [{"label": "present", "cells": [pres_act, empty() if semi else pres_pass]},
                {"label": "perfect", "cells": [empty() if semi else perf_act, perf_pass]},
                {"label": "future", "cells": [fut_act, empty() if semi else fut_pass]}]
    sections.append({"title": "infinitives", "headers": heads, "rows": rows})

    rows = [{"label": "present active",
             "cells": [cell(r1, C["presPtc"], {"kind": "ptc", "tense": "pres", "voice": "act"})],
             "note": f"genitive {r1}{C['presPtcGen']}"}]
    if r3:
        rows.append({"label": "perfect (active meaning)" if dep else "perfect passive",
                     "cells": [cell(r3, "us -a -um", {"kind": "ptc", "tense": "perf", "voice": "pass"})]})
        rows.append({"label": "future active",
                     "cells": [cell(r3, "ūrus -a -um", {"kind": "ptc", "tense": "fut", "voice": "act"})]})
    rows.append({"label": "gerundive (future passive)",
                 "cells": [cell(r1, C["gerund"] + "us -a -um", {"kind": "gerundive"})]})
    sections.append({"title": "participles", "headers": ["form"], "rows": rows})
    g = C["gerund"]
    sections.append({"title": "gerund", "headers": ["form"], "rows": [
        {"label": "genitive", "cells": [cell(r1, g + "ī", {"kind": "gerund", "case": "gen"})]},
        {"label": "dative", "cells": [cell(r1, g + "ō", {"kind": "gerund", "case": "dat"})]},
        {"label": "accusative", "cells": [cell(r1, g + "um", {"kind": "gerund", "case": "acc"})]},
        {"label": "ablative", "cells": [cell(r1, g + "ō", {"kind": "gerund", "case": "abl"})]},
    ]})
    if r3:
        sections.append({"title": "supine", "headers": ["form"], "rows": [
            {"label": "accusative (-um)", "cells": [cell(r3, "um", {"kind": "supine", "case": "acc"})]},
            {"label": "ablative (-ū)", "cells": [cell(r3, "ū", {"kind": "supine", "case": "abl"})]},
        ]})
    if impers:
        for s in sections:
            s["rows"] = [r for r in s["rows"] if not re.match(r"^(I|you|we|they)", r["label"])]
    return {"kind": "verb", "title": f"{entry.get('lemma', '')} · {conjugation_name(entry) or 'verb'}",
            "sections": sections}


# ------------------------------------------------ irregular verbs (hand tables)

IRREGULAR_VERBS = {
    "sum": {
        "title": "sum, esse, fuī, futūrum · be", "note": "No passive. futūrus = about to be.",
        "ind": {
            "pres": ["s|um", "e|s", "es|t", "s|umus", "es|tis", "s|unt"],
            "impf": ["er|am", "er|ās", "er|at", "er|āmus", "er|ātis", "er|ant"],
            "fut": ["er|ō", "er|is", "er|it", "er|imus", "er|itis", "er|unt"],
            "perf": ["fu|ī", "fu|istī", "fu|it", "fu|imus", "fu|istis", "fu|ērunt"],
            "plupf": ["fu|eram", "fu|erās", "fu|erat", "fu|erāmus", "fu|erātis", "fu|erant"],
            "futperf": ["fu|erō", "fu|eris", "fu|erit", "fu|erimus", "fu|eritis", "fu|erint"],
        },
        "subj": {
            "pres": ["s|im", "s|īs", "s|it", "s|īmus", "s|ītis", "s|int"],
            "impf": ["es|sem", "es|sēs", "es|set", "es|sēmus", "es|sētis", "es|sent"],
            "perf": ["fu|erim", "fu|erīs", "fu|erit", "fu|erīmus", "fu|erītis", "fu|erint"],
            "plupf": ["fu|issem", "fu|issēs", "fu|isset", "fu|issēmus", "fu|issētis", "fu|issent"],
        },
        "imper": {"sg": "es", "pl": "es|te", "futSg": "es|tō", "futPl": "es|tōte"},
        # fore = futūrum esse — Ørberg glosses it so in cap. XXXIII ("fore (īnf fut)
        # = futūrum/-am … esse", beside "pācem fore spērēmus"); Allen & Greenough
        # §170.b.  A compound takes it too: adfore, dēfore, prōfore.
        "inf": {"pres": "es|se", "perf": "fu|isse", "fut": "fut|ūrus esse / fore"},
        "ptc": {"fut": "fut|ūrus -a -um"},
    },
    "possum": {
        "title": "possum, posse, potuī · be able, can",
        "note": "pot- + sum; pos- before s. No passive, no imperative.",
        "ind": {
            "pres": ["pos|sum", "pot|es", "pot|est", "pos|sumus", "pot|estis", "pos|sunt"],
            "impf": ["pot|eram", "pot|erās", "pot|erat", "pot|erāmus", "pot|erātis", "pot|erant"],
            "fut": ["pot|erō", "pot|eris", "pot|erit", "pot|erimus", "pot|eritis", "pot|erunt"],
            "perf": ["potu|ī", "potu|istī", "potu|it", "potu|imus", "potu|istis", "potu|ērunt"],
            "plupf": ["potu|eram", "potu|erās", "potu|erat", "potu|erāmus", "potu|erātis", "potu|erant"],
            "futperf": ["potu|erō", "potu|eris", "potu|erit", "potu|erimus", "potu|eritis", "potu|erint"],
        },
        "subj": {
            "pres": ["pos|sim", "pos|sīs", "pos|sit", "pos|sīmus", "pos|sītis", "pos|sint"],
            "impf": ["pos|sem", "pos|sēs", "pos|set", "pos|sēmus", "pos|sētis", "pos|sent"],
            "perf": ["potu|erim", "potu|erīs", "potu|erit", "potu|erīmus", "potu|erītis", "potu|erint"],
            "plupf": ["potu|issem", "potu|issēs", "potu|isset", "potu|issēmus", "potu|issētis", "potu|issent"],
        },
        "inf": {"pres": "pos|se", "perf": "potu|isse"},
        "ptc": {"pres": "pot|ēns"},
    },
    "eo": {
        "title": "eō, īre, iī, itum · go",
        "note": "Present participle iēns, genitive euntis. Gerund eundī. Passive only in compounds (trānsītur).",
        "ind": {
            "pres": ["e|ō", "ī|s", "i|t", "ī|mus", "ī|tis", "e|unt"],
            "impf": ["ī|bam", "ī|bās", "ī|bat", "ī|bāmus", "ī|bātis", "ī|bant"],
            "fut": ["ī|bō", "ī|bis", "ī|bit", "ī|bimus", "ī|bitis", "ī|bunt"],
            "perf": ["i|ī", "ī|stī", "i|it", "i|imus", "ī|stis", "i|ērunt"],
            "plupf": ["i|eram", "i|erās", "i|erat", "i|erāmus", "i|erātis", "i|erant"],
            "futperf": ["i|erō", "i|eris", "i|erit", "i|erimus", "i|eritis", "i|erint"],
        },
        "subj": {
            "pres": ["e|am", "e|ās", "e|at", "e|āmus", "e|ātis", "e|ant"],
            "impf": ["ī|rem", "ī|rēs", "ī|ret", "ī|rēmus", "ī|rētis", "ī|rent"],
            "perf": ["i|erim", "i|erīs", "i|erit", "i|erīmus", "i|erītis", "i|erint"],
            "plupf": ["ī|ssem", "ī|ssēs", "ī|sset", "ī|ssēmus", "ī|ssētis", "ī|ssent"],
        },
        "imper": {"sg": "ī", "pl": "ī|te", "futSg": "ī|tō", "futPl": "ī|tōte"},
        # īrī is the one passive form of eō the course meets: every verb's future
        # passive infinitive is built on it — Ørberg, cap. XXIII, Grammatica
        # Latina: "'laudātum īrī' … quī ex supīnō et 'īrī' cōnstat".
        "inf": {"pres": "ī|re", "perf": "ī|sse", "fut": "it|ūrus esse", "presPass": "ī|rī"},
        "ptc": {"pres": "i|ēns (euntis)", "fut": "it|ūrus -a -um", "gerundive": "e|undus -a -um"},
        "gerund": "e|und", "supine": "it",
    },
    "fero": {
        "title": "ferō, ferre, tulī, lātum · carry, bring, bear",
        "note": "Present system drops the vowel before r, s, t: fers, fert, ferre.",
        "ind": {
            "pres": ["fer|ō", "fer|s", "fer|t", "fer|imus", "fer|tis", "fer|unt"],
            "impf": ["fer|ēbam", "fer|ēbās", "fer|ēbat", "fer|ēbāmus", "fer|ēbātis", "fer|ēbant"],
            "fut": ["fer|am", "fer|ēs", "fer|et", "fer|ēmus", "fer|ētis", "fer|ent"],
            "perf": ["tul|ī", "tul|istī", "tul|it", "tul|imus", "tul|istis", "tul|ērunt"],
            "plupf": ["tul|eram", "tul|erās", "tul|erat", "tul|erāmus", "tul|erātis", "tul|erant"],
            "futperf": ["tul|erō", "tul|eris", "tul|erit", "tul|erimus", "tul|eritis", "tul|erint"],
        },
        "indPass": {
            "pres": ["fer|or", "fer|ris", "fer|tur", "fer|imur", "fer|iminī", "fer|untur"],
            "impf": ["fer|ēbar", "fer|ēbāris", "fer|ēbātur", "fer|ēbāmur", "fer|ēbāminī", "fer|ēbantur"],
            "fut": ["fer|ar", "fer|ēris", "fer|ētur", "fer|ēmur", "fer|ēminī", "fer|entur"],
            "perf": ["lāt|us sum", "lāt|us es", "lāt|us est", "lāt|ī sumus", "lāt|ī estis", "lāt|ī sunt"],
            "plupf": ["lāt|us eram", "lāt|us erās", "lāt|us erat", "lāt|ī erāmus", "lāt|ī erātis", "lāt|ī erant"],
            "futperf": ["lāt|us erō", "lāt|us eris", "lāt|us erit", "lāt|ī erimus", "lāt|ī eritis", "lāt|ī erunt"],
        },
        "subj": {
            "pres": ["fer|am", "fer|ās", "fer|at", "fer|āmus", "fer|ātis", "fer|ant"],
            "impf": ["fer|rem", "fer|rēs", "fer|ret", "fer|rēmus", "fer|rētis", "fer|rent"],
            "perf": ["tul|erim", "tul|erīs", "tul|erit", "tul|erīmus", "tul|erītis", "tul|erint"],
            "plupf": ["tul|issem", "tul|issēs", "tul|isset", "tul|issēmus", "tul|issētis", "tul|issent"],
        },
        "subjPass": {
            "pres": ["fer|ar", "fer|āris", "fer|ātur", "fer|āmur", "fer|āminī", "fer|antur"],
            "impf": ["fer|rer", "fer|rēris", "fer|rētur", "fer|rēmur", "fer|rēminī", "fer|rentur"],
            "perf": ["lāt|us sim", "lāt|us sīs", "lāt|us sit", "lāt|ī sīmus", "lāt|ī sītis", "lāt|ī sint"],
            "plupf": ["lāt|us essem", "lāt|us essēs", "lāt|us esset", "lāt|ī essēmus", "lāt|ī essētis", "lāt|ī essent"],
        },
        "imper": {"sg": "fer", "pl": "fer|te", "futSg": "fer|tō", "futPl": "fer|tōte",
                  "passSg": "fer|re", "passPl": "fer|iminī"},
        "inf": {"pres": "fer|re", "perf": "tul|isse", "fut": "lāt|ūrus esse", "presPass": "fer|rī",
                "perfPass": "lāt|us esse", "futPass": "lāt|um īrī"},
        "ptc": {"pres": "fer|ēns", "perf": "lāt|us -a -um", "fut": "lāt|ūrus -a -um",
                "gerundive": "fer|endus -a -um"},
        "gerund": "fer|end", "supine": "lāt",
    },
    "volo": {
        "title": "volō, velle, voluī · want, be willing",
        "note": "No passive, no imperative. vīs = you want (not the noun vīs).",
        "ind": {
            "pres": ["vol|ō", "vī|s", "vul|t", "vol|umus", "vul|tis", "vol|unt"],
            "impf": ["vol|ēbam", "vol|ēbās", "vol|ēbat", "vol|ēbāmus", "vol|ēbātis", "vol|ēbant"],
            "fut": ["vol|am", "vol|ēs", "vol|et", "vol|ēmus", "vol|ētis", "vol|ent"],
            "perf": ["volu|ī", "volu|istī", "volu|it", "volu|imus", "volu|istis", "volu|ērunt"],
            "plupf": ["volu|eram", "volu|erās", "volu|erat", "volu|erāmus", "volu|erātis", "volu|erant"],
            "futperf": ["volu|erō", "volu|eris", "volu|erit", "volu|erimus", "volu|eritis", "volu|erint"],
        },
        "subj": {
            "pres": ["vel|im", "vel|īs", "vel|it", "vel|īmus", "vel|ītis", "vel|int"],
            "impf": ["vel|lem", "vel|lēs", "vel|let", "vel|lēmus", "vel|lētis", "vel|lent"],
            "perf": ["volu|erim", "volu|erīs", "volu|erit", "volu|erīmus", "volu|erītis", "volu|erint"],
            "plupf": ["volu|issem", "volu|issēs", "volu|isset", "volu|issēmus", "volu|issētis", "volu|issent"],
        },
        "inf": {"pres": "vel|le", "perf": "volu|isse"},
        "ptc": {"pres": "vol|ēns"},
    },
    "nolo": {
        "title": "nōlō, nōlle, nōluī · not want, be unwilling",
        "note": "nōn + volō. Its imperative nōlī / nōlīte + infinitive is the usual way to say \"don't\".",
        "ind": {
            "pres": ["nōl|ō", "nōn vīs", "nōn vult", "nōl|umus", "nōn vultis", "nōl|unt"],
            "impf": ["nōl|ēbam", "nōl|ēbās", "nōl|ēbat", "nōl|ēbāmus", "nōl|ēbātis", "nōl|ēbant"],
            "fut": ["nōl|am", "nōl|ēs", "nōl|et", "nōl|ēmus", "nōl|ētis", "nōl|ent"],
            "perf": ["nōlu|ī", "nōlu|istī", "nōlu|it", "nōlu|imus", "nōlu|istis", "nōlu|ērunt"],
            "plupf": ["nōlu|eram", "nōlu|erās", "nōlu|erat", "nōlu|erāmus", "nōlu|erātis", "nōlu|erant"],
            "futperf": ["nōlu|erō", "nōlu|eris", "nōlu|erit", "nōlu|erimus", "nōlu|eritis", "nōlu|erint"],
        },
        "subj": {
            "pres": ["nōl|im", "nōl|īs", "nōl|it", "nōl|īmus", "nōl|ītis", "nōl|int"],
            "impf": ["nōl|lem", "nōl|lēs", "nōl|let", "nōl|lēmus", "nōl|lētis", "nōl|lent"],
            "perf": ["nōlu|erim", "nōlu|erīs", "nōlu|erit", "nōlu|erīmus", "nōlu|erītis", "nōlu|erint"],
            "plupf": ["nōlu|issem", "nōlu|issēs", "nōlu|isset", "nōlu|issēmus", "nōlu|issētis", "nōlu|issent"],
        },
        "imper": {"sg": "nōl|ī", "pl": "nōl|īte", "futSg": "nōl|ītō", "futPl": "nōl|ītōte"},
        "inf": {"pres": "nōl|le", "perf": "nōlu|isse"},
        "ptc": {"pres": "nōl|ēns"},
    },
    "malo": {
        "title": "mālō, mālle, māluī · prefer", "note": "magis + volō. No passive, no imperative.",
        "ind": {
            "pres": ["māl|ō", "māvīs", "māvult", "māl|umus", "māvultis", "māl|unt"],
            "impf": ["māl|ēbam", "māl|ēbās", "māl|ēbat", "māl|ēbāmus", "māl|ēbātis", "māl|ēbant"],
            "fut": ["māl|am", "māl|ēs", "māl|et", "māl|ēmus", "māl|ētis", "māl|ent"],
            "perf": ["mālu|ī", "mālu|istī", "mālu|it", "mālu|imus", "mālu|istis", "mālu|ērunt"],
            "plupf": ["mālu|eram", "mālu|erās", "mālu|erat", "mālu|erāmus", "mālu|erātis", "mālu|erant"],
            "futperf": ["mālu|erō", "mālu|eris", "mālu|erit", "mālu|erimus", "mālu|eritis", "mālu|erint"],
        },
        "subj": {
            "pres": ["māl|im", "māl|īs", "māl|it", "māl|īmus", "māl|ītis", "māl|int"],
            "impf": ["māl|lem", "māl|lēs", "māl|let", "māl|lēmus", "māl|lētis", "māl|lent"],
            "perf": ["mālu|erim", "mālu|erīs", "mālu|erit", "mālu|erīmus", "mālu|erītis", "mālu|erint"],
            "plupf": ["mālu|issem", "mālu|issēs", "mālu|isset", "mālu|issēmus", "mālu|issētis", "mālu|issent"],
        },
        "inf": {"pres": "māl|le", "perf": "mālu|isse"},
    },
    "fio": {
        "title": "fīō, fierī, factus sum · become, be made, happen",
        "note": "Serves as the passive of faciō. Active-looking present system, passive perfect system.",
        "ind": {
            "pres": ["fī|ō", "fī|s", "fi|t", "fī|mus", "fī|tis", "fī|unt"],
            "impf": ["fī|ēbam", "fī|ēbās", "fī|ēbat", "fī|ēbāmus", "fī|ēbātis", "fī|ēbant"],
            "fut": ["fī|am", "fī|ēs", "fī|et", "fī|ēmus", "fī|ētis", "fī|ent"],
            "perf": ["fact|us sum", "fact|us es", "fact|us est", "fact|ī sumus", "fact|ī estis", "fact|ī sunt"],
            "plupf": ["fact|us eram", "fact|us erās", "fact|us erat", "fact|ī erāmus", "fact|ī erātis", "fact|ī erant"],
            "futperf": ["fact|us erō", "fact|us eris", "fact|us erit", "fact|ī erimus", "fact|ī eritis", "fact|ī erunt"],
        },
        "subj": {
            "pres": ["fī|am", "fī|ās", "fī|at", "fī|āmus", "fī|ātis", "fī|ant"],
            "impf": ["fi|erem", "fi|erēs", "fi|eret", "fi|erēmus", "fi|erētis", "fi|erent"],
            "perf": ["fact|us sim", "fact|us sīs", "fact|us sit", "fact|ī sīmus", "fact|ī sītis", "fact|ī sint"],
            "plupf": ["fact|us essem", "fact|us essēs", "fact|us esset", "fact|ī essēmus", "fact|ī essētis", "fact|ī essent"],
        },
        "imper": {"sg": "fī", "pl": "fī|te"},
        "inf": {"pres": "fi|erī", "perf": "fact|us esse", "fut": "fact|um īrī"},
        # fīō has no perfect stem of its own: it borrows faciō's whole fourth
        # principal part, so the future participle is factūrus and the supine
        # factum (Allen & Greenough §204.b; the supine is already in factum īrī).
        "ptc": {"perf": "fact|us -a -um", "fut": "fact|ūrus -a -um",
                "gerundive": "faci|endus -a -um"},
        "supine": "fact",
        "perfIsPassive": True,
    },
}


def _irregular_verb(entry: dict, t: dict, prefix: str = "") -> dict:
    sections = []
    empty = lambda: {"stem": "", "ending": "—", "text": "—", "key": None, "empty": True}

    def P(s):
        if not prefix or not s or s == "—" or s.startswith("nōn "):
            return s
        if " / " in s:                       # futūrus esse / fore → prōfore too
            return " / ".join(P(x) for x in s.split(" / "))
        # prō- keeps the old final d before a vowel: prōdes, prōdest, prōdestis,
        # prōderam, prōderō, prōderunt, prōdessem, prōdesse — but prōsum,
        # prōsumus, prōsunt, prōfuī.  Ørberg prints the pair in the margin of
        # cap. XXVII ("prōd-est prō-sunt", "prōd-esse prō-fuisse"); Allen &
        # Greenough §204 gives the whole table.  (The same d shows in prōdeō,
        # prōdīs, prōdit, prōdīre.)
        p = prefix + "d" if prefix == "prō" and re.match(r"[aeiou]", _plain(s), re.I) else prefix
        return p + s

    def voice_of(tense):
        return "pass" if t.get("perfIsPassive") and tense in ("perf", "plupf", "futperf") else "act"

    def tense_section(tense, mood):
        table = t.get("ind") if mood == "ind" else t.get("subj")
        pass_table = t.get("indPass") if mood == "ind" else t.get("subjPass")
        if not table or tense not in table:
            return None
        cols, heads = [], []
        v = voice_of(tense)
        cols.append([split_cell(P(s), fk(tense, mood, v, i)) for i, s in enumerate(table[tense])])
        heads.append("passive form" if v == "pass" else "active")
        if pass_table and tense in pass_table:
            cols.append([split_cell(P(s), fk(tense, mood, "pass", i)) for i, s in enumerate(pass_table[tense])])
            heads.append("passive")
        return {"title": f"{TENSE_LABEL[tense]} {'subjunctive' if mood == 'subj' else 'indicative'}",
                "headers": heads, "rows": _person_rows(cols)}

    for tense in TENSES:
        s = tense_section(tense, "ind")
        if s:
            sections.append(s)
    for tense in ("pres", "impf", "perf", "plupf"):
        s = tense_section(tense, "subj")
        if s:
            sections.append(s)
    if t.get("imper"):
        im = t["imper"]
        rows = [
            {"label": "you (sg.)", "cells": [split_cell(P(im["sg"]), {"kind": "imper", "tense": "pres", "voice": "act", "number": "sg"})]},
            {"label": "you (pl.)", "cells": [split_cell(P(im["pl"]), {"kind": "imper", "tense": "pres", "voice": "act", "number": "pl"})]},
        ]
        if im.get("futSg"):
            rows.append({"label": "future, you (sg.) / he",
                         "cells": [split_cell(P(im["futSg"]), {"kind": "imper", "tense": "fut", "voice": "act", "number": "sg"})]})
        if im.get("futPl"):
            rows.append({"label": "future, you (pl.)",
                         "cells": [split_cell(P(im["futPl"]), {"kind": "imper", "tense": "fut", "voice": "act", "number": "pl", "person": 2})]})
        heads = ["active"]
        if im.get("passSg"):
            rows[0]["cells"].append(split_cell(P(im["passSg"]), {"kind": "imper", "tense": "pres", "voice": "pass", "number": "sg"}))
            rows[1]["cells"].append(split_cell(P(im["passPl"]), {"kind": "imper", "tense": "pres", "voice": "pass", "number": "pl"}))
            heads.append("passive")
        sections.append({"title": "imperative", "headers": heads, "rows": rows})
    if t.get("inf"):
        inf = t["inf"]
        has_pass = bool(inf.get("presPass"))
        heads = ["active", "passive"] if has_pass else ["form"]
        rows = []

        def row(label, a, b, tense):
            v = "pass" if t.get("perfIsPassive") and tense != "pres" else "act"
            cells = [split_cell(P(a), {"kind": "inf", "tense": tense, "voice": v}) if a else empty()]
            if has_pass:
                cells.append(split_cell(P(b), {"kind": "inf", "tense": tense, "voice": "pass"}) if b else empty())
            rows.append({"label": label, "cells": cells})

        row("present", inf.get("pres"), inf.get("presPass"), "pres")
        row("perfect", inf.get("perf"), inf.get("perfPass"), "perf")
        row("future", inf.get("fut"), inf.get("futPass"), "fut")
        sections.append({"title": "infinitives", "headers": heads, "rows": rows})
    if t.get("ptc"):
        pt = t["ptc"]
        rows = []
        if pt.get("pres"):
            rows.append({"label": "present active",
                         "cells": [split_cell(P(pt["pres"]), {"kind": "ptc", "tense": "pres", "voice": "act"})]})
        if pt.get("perf"):
            rows.append({"label": "perfect passive",
                         "cells": [split_cell(P(pt["perf"]), {"kind": "ptc", "tense": "perf", "voice": "pass"})]})
        if pt.get("fut"):
            rows.append({"label": "future active",
                         "cells": [split_cell(P(pt["fut"]), {"kind": "ptc", "tense": "fut", "voice": "act"})]})
        if pt.get("gerundive"):
            rows.append({"label": "gerundive (future passive)",
                         "cells": [split_cell(P(pt["gerundive"]), {"kind": "gerundive"})]})
        sections.append({"title": "participles", "headers": ["form"], "rows": rows})
    if t.get("gerund"):
        g = split_cell(P(t["gerund"]))
        sections.append({"title": "gerund", "headers": ["form"], "rows": [
            {"label": "genitive", "cells": [cell(g["text"], "ī", {"kind": "gerund", "case": "gen"})]},
            {"label": "dative", "cells": [cell(g["text"], "ō", {"kind": "gerund", "case": "dat"})]},
            {"label": "accusative", "cells": [cell(g["text"], "um", {"kind": "gerund", "case": "acc"})]},
            {"label": "ablative", "cells": [cell(g["text"], "ō", {"kind": "gerund", "case": "abl"})]},
        ]})
    if t.get("supine"):
        sections.append({"title": "supine", "headers": ["form"], "rows": [
            {"label": "accusative (-um)", "cells": [cell(P(t["supine"]), "um", {"kind": "supine", "case": "acc"})]},
            {"label": "ablative (-ū)", "cells": [cell(P(t["supine"]), "ū", {"kind": "supine", "case": "abl"})]},
        ]})
    title = (f"{entry.get('lemma', '')} · compound of {t['title'].split(' ·')[0].split(',')[0]} (irregular)"
             if prefix else f"{t['title']} · irregular verb")
    return {"kind": "verb", "title": title, "note": t.get("note"), "sections": sections}


def _compound_of(entry: dict, base_key: str) -> dict | None:
    import copy
    base = IRREGULAR_VERBS[base_key]
    r0 = root(entry, 0)
    base_r0 = {"sum": "s", "eo": "e", "fero": "fer"}[base_key]
    prefix = r0[:len(r0) - len(base_r0)] if r0.endswith(base_r0) else r0
    if base_key == "fero":
        r2 = root(entry, 2, "tul")
        r3 = root(entry, 3, "lāt")
        t = copy.deepcopy(base)

        def swap(arr, frm, to):
            return [re.sub("^" + frm, to, s) for s in arr]

        for k in ("perf", "plupf", "futperf"):
            t["ind"][k] = swap(t["ind"][k], "tul", " " + r2)
            t["indPass"][k] = swap(t["indPass"][k], "lāt", " " + r3)
        for k in ("perf", "plupf"):
            t["subj"][k] = swap(t["subj"][k], "tul", " " + r2)
            t["subjPass"][k] = swap(t["subjPass"][k], "lāt", " " + r3)
        t["inf"]["perf"] = " " + r2 + "|isse"
        t["inf"]["perfPass"] = " " + r3 + "|us esse"
        t["inf"]["fut"] = " " + r3 + "|ūrus esse"
        t["inf"]["futPass"] = " " + r3 + "|um īrī"
        t["ptc"]["perf"] = " " + r3 + "|us -a -um"
        t["ptc"]["fut"] = " " + r3 + "|ūrus -a -um"
        t["supine"] = " " + r3
        para = _irregular_verb(entry, t, prefix)
        # the leading space marked a stem that already carries the prefix
        # (praelāt-, praetul-); drop the marker and the prefix in front of it
        def unmark(x: str) -> str:
            if x.startswith(prefix + " "):
                return x[len(prefix) + 1:]
            return x[1:] if x.startswith(" ") else x
        for sec in para["sections"]:
            for r in sec["rows"]:
                for c in r["cells"]:
                    c["text"], c["stem"] = unmark(c["text"]), unmark(c["stem"])
        return para
    return _irregular_verb(entry, base, prefix)


#: The Whitaker category each hand table belongs to.  Headwords collide: `volō,
#: volāre, volāvī, volātum` "fly" (his V 1 1, Ørberg cap. X: avēs volant) has the
#: same dictionary form as `volō, velle, voluī` (V 6 2), and his V 1 1 ghost `eō,
#: eāre` has the same as `eō, īre, iī, itum` (V 6 1).  An entry whose category is
#: not the table's is a different verb and is built regularly.  An entry with no
#: category at all is a hand supplement, and the headword is all we have to go on.
#: Kept in step with IRREGULAR_CAT in app/js/paradigms.js.
IRREGULAR_CAT = {"sum": (5, 1), "possum": (5, 2), "eo": (6, 1), "fero": (3, 2),
                 "volo": (6, 2), "nolo": (6, 2), "malo": (6, 2), "fio": (3, 3)}


def irregular_table(entry: dict) -> dict | None:
    """The hand table for this entry — only if the entry's category is its own."""
    t = IRREGULAR_VERBS.get(entry.get("h") or "")
    if not t:
        return None
    cat = IRREGULAR_CAT.get(entry.get("h"))
    if cat and entry.get("cat") and tuple(_cat(entry)) != cat:
        return None
    return t


def _verb_paradigm(entry: dict) -> dict | None:
    h = entry.get("h")
    t = irregular_table(entry)
    if t:
        return _irregular_verb(entry, t)
    d, v = _cat(entry)
    if d == 5 and v == 1 and h != "sum":
        return _compound_of(entry, "sum")
    if d == 5 and v == 2 and h != "possum":
        return None
    if d == 6 and v == 1 and h != "eo":
        return _compound_of(entry, "eo")
    if d == 3 and v == 2 and h != "fero":
        return _compound_of(entry, "fero")
    return _regular_verb_paradigm(entry)


# ------------------------------------------------------------------ numerals

NUM_TABLES = {
    "unus": {"title": "ūnus, ūna, ūnum · one", "headers": ["masculine", "feminine", "neuter"],
             "sg": [["ūn|us", "ūn|a", "ūn|um"], ["ūn|īus", "ūn|īus", "ūn|īus"], ["ūn|ī", "ūn|ī", "ūn|ī"],
                    ["ūn|um", "ūn|am", "ūn|um"], ["ūn|ō", "ūn|ā", "ūn|ō"]]},
    "duo": {"title": "duo, duae, duo · two", "headers": ["masculine", "feminine", "neuter"],
            "pl": [["du|o", "du|ae", "du|o"], ["du|ōrum", "du|ārum", "du|ōrum"],
                   ["du|ōbus", "du|ābus", "du|ōbus"], ["du|ōs / du|o", "du|ās", "du|o"],
                   ["du|ōbus", "du|ābus", "du|ōbus"]]},
    "tres": {"title": "trēs, tria · three", "headers": ["masculine / feminine", "neuter"], "genders": ["c", "n"],
             "pl": [["tr|ēs", "tr|ia"], ["tr|ium", "tr|ium"], ["tr|ibus", "tr|ibus"], ["tr|ēs", "tr|ia"],
                    ["tr|ibus", "tr|ibus"]]},
}


def _numeral_paradigm(entry: dict) -> dict | None:
    t = NUM_TABLES.get(entry.get("h"))
    if t:
        genders = t.get("genders") or GENDERS
        case_list = ["nom", "gen", "dat", "acc", "abl"]
        rows = []
        for num in ("sg", "pl"):
            if not t.get(num):
                continue
            for i, c in enumerate(case_list):
                cells = []
                for gi, s in enumerate(t[num][i]):
                    cc = split_cell(s.split(" / ")[0], nk(c, num, genders[gi]))
                    if " / " in s:
                        cc["text"] = s.replace("|", "")
                        cc["alt"] = s.split(" / ")[1].replace("|", "")
                    cells.append(cc)
                rows.append({"label": f"{CASE_LABEL[c]} {'sg.' if num == 'sg' else 'pl.'}", "cells": cells})
        return {"kind": "adjective", "title": t["title"],
                "sections": [{"title": "cases", "headers": t["headers"], "rows": rows}]}
    lemma = entry.get("lemma") or ""
    if re.search(r"-a -um$", lemma) or re.search(r"ī -ae -a$", lemma):
        stem = re.sub(r"(us|ī)$", "", re.split(r"[\s-]", lemma)[0])
        fake = dict(entry, pos="ADJ", cat=[1, 1], roots=[stem, stem, "-", "-"])
        return _adjective_paradigm(fake)
    return None


# ---------------------------------------------------------------- entry point

def paradigm(entry: dict, locative: bool = False) -> dict | None:
    """The table app/js/paradigms.js draws for this entry (no `hit` marking)."""
    if not entry:
        return None
    pos = entry.get("pos")
    try:
        if pos == "N":
            return _noun_paradigm(entry, locative=locative)
        if pos == "ADJ":
            return _adjective_paradigm(entry)
        if pos in ("V", "VPAR"):
            return _verb_paradigm(entry)
        if pos == "PRON":
            return _pronoun_paradigm(entry)
        if pos == "NUM":
            return _numeral_paradigm(entry)
    except Exception:
        return None
    return None


# ------------------------------------------------------------------ generator

def _parse_of(key: dict) -> dict | None:
    """A paradigm cell key → a glossary-shaped parse."""
    if not key:
        return None
    k = key.get("kind")
    if k == "nominal":
        p = {}
        for f in ("case", "number", "gender"):
            if key.get(f):
                p[f] = key[f]
        if key.get("degree") and key["degree"] != "pos":
            p["degree"] = key["degree"]
        if key.get("mood"):
            p["mood"] = key["mood"]
        if key.get("tense"):
            p["tense"] = key["tense"]
        if key.get("voice"):
            p["voice"] = key["voice"]
        return p
    if k == "finite":
        return {"tense": key["tense"], "voice": key["voice"], "mood": key["mood"],
                "person": key["person"], "number": key["number"]}
    if k == "imper":
        p = {"mood": "imper", "tense": key.get("tense", "pres"), "voice": key["voice"],
             "number": key["number"]}
        p["person"] = key.get("person", 2)
        return p
    if k == "inf":
        return {"mood": "inf", "tense": key["tense"], "voice": key["voice"]}
    if k == "ptc":
        return {"mood": "ptc", "tense": key["tense"], "voice": key["voice"]}
    if k == "gerundive":
        return {"mood": "gerundive"}
    if k == "gerund":
        return {"mood": "gerund", "case": key["case"]}
    if k == "supine":
        return {"mood": "supine", "case": key["case"]}
    return None


def _cell_texts(c: dict) -> list[str]:
    """Every spelling a cell stands for: 'e|ī / i|ī' → eī, iī; 'i|ēns (euntis)' → iēns."""
    t = c.get("text") or ""
    out = []
    for part in t.split(" / "):
        part = re.sub(r"\s*\([^)]*\)\s*$", "", part).strip()
        if part and part != "—":
            out.append(part)
    return out


def _decline(stem: str, table: dict, parse_base: dict, ending_prefix: str = "") -> list[tuple[str, dict]]:
    out = []
    for num in ("sg", "pl"):
        for i, c in enumerate(CASES):
            for gi, g in enumerate(GENDERS):
                p = dict(parse_base)
                p.update({"case": c, "number": num, "gender": g})
                out.append((stem + ending_prefix + table[num][i][gi], p))
    return out


def _decline_present_participle(nom: str, stem: str) -> list[tuple[str, dict]]:
    """amāns / amant- : one-termination 3rd declension; the nominative (and the
    neuter accusative and the vocative) is the printed nominative itself."""
    base = {"mood": "ptc", "tense": "pres", "voice": "act"}
    out = []
    for num in ("sg", "pl"):
        for i, c in enumerate(CASES):
            for gi, g in enumerate(GENDERS):
                p = dict(base, case=c, number=num, gender=g)
                if num == "sg" and (c in ("nom", "voc") or (g == "n" and c == "acc")):
                    out.append((nom, p))
                else:
                    out.append((stem + ADJ_PTC[num][i][gi], p))
    # the adjectival ablative singular -ī beside the participial -e
    out += [(stem + "ī", dict(base, case="abl", number="sg", gender=g)) for g in GENDERS]
    return out


def _verb_extras(entry: dict) -> list[tuple[str, dict]]:
    """Participles and gerundive declined right through — what the app's table
    shows only as 'amāt|us -a -um'."""
    out: list[tuple[str, dict]] = []
    r0 = root(entry, 0)
    r1 = root(entry, 1, r0)
    r3 = root(entry, 3)
    ck = conj_key(entry)

    if ck:
        C = CONJ[ck]
        # amāns / amant- : the nominative from presPtc, the oblique stem from presPtcGen
        out += _decline_present_participle(r1 + C["presPtc"], r1 + re.sub(r"is$", "", C["presPtcGen"]))
        out += _decline(r1 + C["gerund"], ADJ_12, {"mood": "gerundive"})
        if r3:
            out += _decline(r3, ADJ_12, {"mood": "ptc", "tense": "perf", "voice": "pass"})
            out += _decline(r3 + "ūr", ADJ_12, {"mood": "ptc", "tense": "fut", "voice": "act"})
        if entry.get("kind") == "perfdef":
            out = [x for x in out if x[1].get("tense") != "pres"]
        return out

    d, v = _cat(entry)
    if d == 5 and v == 1 and entry.get("h") != "sum":
        # a compound of sum: paradigms.js spells its perfect prefix + fu- (abfuit);
        # the entry's own perfect and participle stems are what the book prints
        r2 = root(entry, 2)
        if r2:
            for tense, ends in (("perf", PERF["perf"]), ("plupf", PERF["plupf"]),
                                ("futperf", PERF["futperf"])):
                for i, e in enumerate(ends):
                    out.append((r2 + e, dict(fk(tense, "ind", "act", i), kind=None)))
            for tense, ends in (("perf", PERF["perfSubj"]), ("plupf", PERF["plupfSubj"])):
                for i, e in enumerate(ends):
                    out.append((r2 + e, dict(fk(tense, "subj", "act", i), kind=None)))
            out.append((r2 + "isse", {"mood": "inf", "tense": "perf", "voice": "act"}))
        if r3:
            out += _decline(r3 + "ūr", ADJ_12, {"mood": "ptc", "tense": "fut", "voice": "act"})
        # absēns, praesēns: the compound has a present participle sum itself lacks
        r1 = root(entry, 1, r0)
        if r1.endswith("es"):
            out += _decline_present_participle(r1[:-2] + "sēns", r1[:-2] + "sent")

    # an irregular table: take the participles it prints and decline those
    p = paradigm(entry)
    if not p:
        return out
    for sec in p["sections"]:
        if sec["title"] != "participles":
            continue
        for row in sec["rows"]:
            for c in row["cells"]:
                key, texts = c.get("key") or {}, _cell_texts(c)
                if not texts:
                    continue
                base = texts[0]
                if key.get("kind") == "ptc" and key.get("tense") == "pres":
                    # 'abi|ēns (euntis)' names its own oblique stem; otherwise -ēns → -ent-
                    m = re.search(r"\(([^)]+)is\)", c.get("text") or "")
                    if m:
                        st = m.group(1)
                        pre = base[:-len("iēns")] if base.endswith("iēns") else ""
                        st = pre + st           # abiēns → ab + eunt-
                    else:
                        st = re.sub(r"ēns$", "ent", base)
                    if st != base:
                        out += _decline_present_participle(base, st)
                elif key.get("kind") == "ptc":
                    st = re.sub(r"us -a -um$", "", base)
                    if st != base:
                        out += _decline(st, ADJ_12, {"mood": "ptc", "tense": key["tense"],
                                                     "voice": key["voice"]})
                elif key.get("kind") == "gerundive":
                    st = re.sub(r"us -a -um$", "", base)
                    if st != base:
                        out += _decline(st, ADJ_12, {"mood": "gerundive"})
    # eō and its compounds: the table names the supine but not the participle itum
    if not any(x[1].get("tense") == "perf" for x in out):
        for sec in p["sections"]:
            if sec["title"] != "supine":
                continue
            st = sec["rows"][0]["cells"][0]["stem"]
            if st:
                out += _decline(st, ADJ_12, {"mood": "ptc", "tense": "perf", "voice": "pass"})
    return out


#: pronouns that take -cum after them: mēcum, tēcum, sēcum, nōbīscum, quōcum
_CUM_PRON = {"ego", "nos", "tu", "vos", "se", "qui", "quis", "is", "hic"}


def _pronoun_extras(entry: dict) -> list[tuple[str, dict]]:
    """mēcum, tēcum, sēcum, nōbīscum, vōbīscum, quōcum, quibuscum: the ablative
    with cum written after it."""
    if entry.get("h") not in _CUM_PRON:
        return []
    out, seen = [], set()
    para = paradigm(entry)
    if not para:
        return out
    for sec in para["sections"]:
        for row in sec["rows"]:
            for c in row["cells"]:
                key = c.get("key") or {}
                if c.get("empty") or key.get("case") != "abl":
                    continue
                for txt in _cell_texts(c):
                    if " " in txt or (txt, key.get("number")) in seen:
                        continue
                    seen.add((txt, key.get("number")))
                    p = _parse_of(key)
                    if p:
                        out.append((txt + "cum", dict(p, note="+ cum")))
    return out


def _noun_extras(entry: dict) -> list[tuple[str, dict]]:
    """What the table leaves out: the locative, and the -ius / -ium noun's
    contracted genitive singular (fīliī → fīlī) and vocative (Iūlī)."""
    out: list[tuple[str, dict]] = []
    d, v = _cat(entry)
    key = noun_table_key(entry)
    if not key:
        return out
    r0 = root(entry, 0)
    r1 = root(entry, 1, r0)
    g = entry.get("gender") or "c"
    # A word used only in the plural has no singular locative either: Athēnīs,
    # Delphīs and Puteolīs are the dative/ablative plural doing the work.
    if noun_number(entry) == "pl":
        ends = NOUN_ENDINGS[key]["pl"]
        if ends:
            out.append((r1 + ends[4], {"case": "loc", "number": "pl", "gender": g}))
        return out
    if key.startswith("1"):
        out.append((r1 + "ae", {"case": "loc", "number": "sg", "gender": g}))
    elif key.startswith("2"):
        out.append((r1 + "ī", {"case": "loc", "number": "sg", "gender": g}))
    elif key.startswith("3"):
        out.append((r1 + "ī", {"case": "loc", "number": "sg", "gender": g}))
    if d == 2 and r1[-1:] in ("i", "ī") and key in ("2m", "2n"):
        # fīlius → gen. fīliī and the contracted fīlī; Iūlius → voc. Iūlī
        out.append((r1[:-1] + "ī", {"case": "gen", "number": "sg", "gender": g}))
        if key == "2m":
            out.append((r1[:-1] + "ī", {"case": "voc", "number": "sg", "gender": g}))
    return out


def _adverb_forms(entry: dict) -> list[tuple[str, dict]]:
    """An adverb entry carries its three degrees as its 'roots'; an adjective
    makes its adverb in -ē (1st/2nd declension) or -iter / -ter (3rd)."""
    out = []
    if entry.get("pos") == "ADV":
        rs = entry.get("roots") or []
        base = rs[0] if rs and rs[0] and rs[0] != "-" else ""
        for i, deg in enumerate(("pos", "comp", "super")):
            r = rs[i] if i < len(rs) else None
            if r and r != "-":
                if i:
                    r = merge_macrons(base, r)   # nūper → nūperrime, not nuperrime
                out.append((r, {} if deg == "pos" else {"degree": deg}))
        return out
    if entry.get("pos") != "ADJ":
        return []
    d, v = _cat(entry)
    r0, r1 = root(entry, 0), root(entry, 1, root(entry, 0))
    r2, r3 = root(entry, 2), root(entry, 3)
    if d == 1:
        out.append((r1 + "ē", {}))
    elif d == 3:
        out.append((r1 + ("ter" if r1.endswith("nt") else "iter"), {}))
    if r2:
        out.append((r2 + "us", {"degree": "comp"}))   # the comparative neuter: brevius, fortius
    if r3:
        out.append((r3 + "mē", {"degree": "super"}))
    return out


def forms(entry: dict, include_multiword: bool = False) -> list[tuple[str, dict]]:
    """Every regular inflected form of the entry: [(macronised form, parse), …].

    Parses are the glossary's own shape.  Multi-word forms (amātus est,
    amātūrus esse) are left out unless `include_multiword`."""
    if not entry:
        return []
    out: list[tuple[str, dict]] = []
    pos = entry.get("pos")
    p = paradigm(entry)
    if p:
        for sec in p["sections"]:
            for row in sec["rows"]:
                for c in row["cells"]:
                    if c.get("empty"):
                        continue
                    key = c.get("key") or {}
                    if pos in ("V", "VPAR") and key.get("kind") in ("ptc", "gerundive"):
                        continue           # declined right through by _verb_extras
                    parse = _parse_of(key)
                    if parse is None:
                        continue
                    for txt in _cell_texts(c):
                        if txt.endswith(" -a -um"):
                            continue           # the participle rows: declined below
                        if " " in txt and not include_multiword:
                            continue
                        out.append((txt, parse))
    if pos in ("V", "VPAR"):
        out += _verb_extras(entry)
    if pos in ("ADJ", "ADV"):
        out += _adverb_forms(entry)
    if pos == "N":
        out += _noun_extras(entry)
    if pos == "PRON":
        out += _pronoun_extras(entry)
    # "future, you (sg.) / he": the -tō imperative is 2nd and 3rd person alike
    out += [(f, dict(pr, person=3)) for f, pr in out
            if pr.get("mood") == "imper" and pr.get("tense") == "fut"
            and pr.get("number") == "sg" and pr.get("person") == 2]
    # dedupe, keeping the first parse order
    seen = set()
    uniq = []
    for f, pr in out:
        k = (f, tuple(sorted(pr.items(), key=lambda kv: kv[0])))
        if k in seen:
            continue
        seen.add(k)
        uniq.append((f, pr))
    return uniq


def single_forms(entry: dict) -> list[str]:
    """The distinct one-word spellings the entry can take."""
    seen, out = set(), []
    for f, _ in forms(entry):
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def form_index(entry: dict) -> dict[str, list[dict]]:
    """form → its parses."""
    idx: dict[str, list[dict]] = {}
    for f, p in forms(entry):
        idx.setdefault(f, []).append(p)
    return idx


# --------------------------------------------------------------- convenience

def build(lemma: str, roots, pos: str, cat, gender: str | None = None,
          kind: str | None = None, h: str | None = None) -> dict:
    """A glossary-shaped entry from principal parts, for tests and one-offs.

        build('amō, amāre, amāvī, amātum', ['am','am','amāv','amāt'], 'V', [1,1])
    """
    from macrons import canonical
    return {"lemma": lemma, "roots": list(roots), "pos": pos, "cat": list(cat),
            "gender": gender, "kind": kind,
            "h": h or canonical(re.split(r"[ ,]", lemma)[0])}
