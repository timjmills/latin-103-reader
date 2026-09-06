#!/usr/bin/env python
"""
attestation.py — does latin_forms generate every form the glossary already
attests, with the same parse?

    python tests/latin_forms/attestation.py            # the whole glossary
    python tests/latin_forms/attestation.py --sample 300
    python tests/latin_forms/attestation.py --lemma amo

The glossary (app/data/glossary.json) is form → [entry], each entry carrying the
lemma's roots and the parses of *that* form.  Every (lemma, form, parse) is a
fact the generator must reproduce: same spelling once macrons are compared, same
parse.  Where the two disagree the glossary is not automatically right — the
report separates the kinds of mismatch so each can be judged.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))

import latin_forms as lf          # noqa: E402
from macrons import strip_macrons  # noqa: E402

GLOSSARY = ROOT / "app" / "data" / "glossary.json"

NO_PARADIGM = {"NUM": "a cardinal above three: indeclinable"}

PARSE_KEYS = ("case", "number", "gender", "mood", "tense", "voice", "person", "degree")
# entries the generator is not meant to cover
SKIP_POS = {"ADV", "PREP", "CONJ", "INTERJ", "ABBR", "STEM", "PREFIX", "ENDING"}
SKIP_KIND = {"perfdef"}


def key(form: str) -> str:
    return strip_macrons(form).lower().replace("j", "i").replace("v", "u")


def norm(parse: dict) -> tuple:
    out = []
    for k in PARSE_KEYS:
        v = parse.get(k)
        if v is None:
            continue
        out.append((k, str(v)))
    return tuple(out)


def parse_matches(want: dict, got: dict) -> bool:
    """`got` (generated) explains `want` (the glossary's parse)."""
    for k in PARSE_KEYS:
        a, b = want.get(k), got.get(k)
        if a is None:
            continue
        if k == "gender":
            if b is None:
                continue
            if a == "c" and b in ("m", "f", "c"):
                continue
            if b == "c" and a in ("m", "f", "c"):
                continue
        if str(a) != str(b):
            return False
    return True


def lemma_id(e: dict) -> tuple:
    return (e.get("h"), e.get("lemma"), e.get("kind"), tuple(e.get("cat") or []),
            tuple(e.get("roots") or []), e.get("gender"))


def load_lemmas(glossary: dict) -> dict[tuple, dict]:
    """lemma → {entry, forms: {form_key: [parses]}} over every attested spelling."""
    out: dict[tuple, dict] = {}
    for form, entries in glossary.items():
        for e in entries:
            if e.get("pos") in SKIP_POS or e.get("kind") in SKIP_KIND:
                continue
            lid = lemma_id(e)
            rec = out.setdefault(lid, {"entry": e, "forms": defaultdict(list), "pos": set()})
            rec["pos"].add(e.get("pos"))
            f = form
            enc = e.get("enc")
            if enc and f.lower().endswith(enc) and len(f) > len(enc):
                f = f[: -len(enc)]           # the glossary keys 'multique' under multus + -que
            for p in e.get("parses") or []:
                if not p:
                    continue
                rec["forms"][f].append(p)
    return out


def generator_entry(rec: dict) -> dict:
    """The entry to generate from: a verb's V entry covers its VPAR forms too."""
    e = dict(rec["entry"])
    if e.get("pos") == "VPAR":
        e["pos"] = "V"
    return e


# Known, deliberate divergences between the generator (which follows Ørberg's
# Grammatica Latina, as app/js/paradigms.js does) and Whitaker's WORDS, whose
# analyses the glossary records.  Each is a form Whitaker will *parse* but the
# textbook never *asks for*; generating them would only blur the pensa answers.
def divergence(entry: dict, form: str, parse: dict, kind: str) -> str | None:
    pos, (d, v) = entry.get("pos"), (list(entry.get("cat") or []) + [0, 0])[:2]
    f = key(form)
    c, num, case = parse.get("case"), parse.get("number"), parse.get("case")
    if pos in ("V", "VPAR"):
        if (parse.get("voice") == "pass" and parse.get("person") == 2 and num == "sg"
                and parse.get("mood") == "ind" and f.endswith("re")):
            return "verb: 2sg passive -re for -ris (agere = ageris)"
        if (parse.get("tense") == "perf" and parse.get("voice") == "act"
                and parse.get("person") == 3 and num == "pl" and f.endswith("ere")):
            return "verb: 3pl perfect -ēre for -ērunt (convēnēre)"
        if entry.get("h") in ("eo", "abeo", "adeo", "exeo", "redeo", "transeo", "ineo", "pereo")                 and ("iiss" in f or "iist" in f):
            return "eō: uncontracted iisse / iistī beside īsse / īstī"
        if d == 5 and f.endswith("sens") or d == 5 and "sent" in f:
            return "sum-compound: present participle absēns / praesēns (sum itself has none)"
    if pos == "N":
        if case == "gen" and num == "pl" and f.endswith("um") and d in (1, 2):
            return "noun: archaic genitive plural -um for -ārum / -ōrum (deum, fīlium)"
        if d == 3 and case == "gen" and num == "pl":
            return "noun: 3rd declension genitive plural -ium / -um (the i-stem line)"
        if d == 3 and case == "abl" and num == "sg":
            return "noun: 3rd declension ablative singular -e / -ī"
        if d == 3 and case == "acc" and num == "pl" and f.endswith("is"):
            return "noun: 3rd declension accusative plural -īs for -ēs"
        if entry.get("h") == "deus":
            return "deus: the dī / deī, dīs / deīs / diīs spellings"
    if pos in ("ADJ", "NUM", "PRON"):
        if case == "acc" and num == "pl" and f.endswith("is"):
            return "adjective: 3rd declension accusative plural -īs for -ēs"
        if d == 3 and case == "abl" and num == "sg":
            return "adjective: 3rd declension ablative singular -e / -ī"
        if d == 3 and case == "gen" and num == "pl":
            return "adjective: 3rd declension genitive plural -ium / -um"
        if case == "voc" and num == "sg" and parse.get("gender") == "m":
            return "adjective: Whitaker gives the vocative as the nominative (nūllus for nūlle)"
    if pos == "N":
        if d == 4 and case in ("gen", "nom", "voc") and f.endswith("i"):
            return "noun: Whitaker's 4th declension alternates (senātī for senātūs)"
        if case == "loc":
            return "noun: locative of a word the table has no locative row for"
        if entry.get("h") in ("domus", "vis", "iuppiter"):
            return "noun: an irregular whose hand table is Ørberg's, not Whitaker's"
        if parse.get("gender") and entry.get("gender") and parse["gender"] != entry["gender"]:
            return "noun: a heteroclite gender Whitaker records against the other gender's entry"
        if d == 3 and case == "acc" and num == "sg" and f.endswith("im"):
            return "noun: i-stem accusative -im (sitim, turrim) — the app notes it, the table omits it"
    if pos in ("PRON", "NUM"):
        if case == "voc":
            return "pronoun / numeral: Whitaker gives a vocative the hand table has no row for"
        if entry.get("h") in ("quis", "qui", "aliquis", "aliqui", "quisquam", "quisque", "quidam"):
            return "quis / quī: Whitaker analyses the two paradigms as one lemma"
        if entry.get("h") == "idem" and not f.startswith(("i", "e")) is False:
            return "īdem: Whitaker files the bare is-forms under īdem"
        if f.endswith("cum") or f.endswith("ne") or f.endswith("ue"):
            return "pronoun: an enclitic spelling (mēcum, hicine)"
    if pos == "VPAR" or parse.get("mood") == "ptc":
        if case == "abl" and num == "sg":
            return "participle: ablative singular -e / -ī"
        if case == "acc" and num == "pl" and f.endswith("is"):
            return "participle: accusative plural -īs for -ēs"
        if case == "gen" and num == "pl":
            return "participle: genitive plural -ium / -um"
    return None


def check(rec: dict) -> list[tuple]:
    e = generator_entry(rec)
    gen = lf.forms(e, include_multiword=True)
    if not gen:
        return [("no-paradigm", e.get("lemma"), "", "", NO_PARADIGM.get(e.get("pos"))
                 or ("indeclinable / a table the app does not draw"
                     if (e.get("cat") or [0])[0] == 9 else None))]
    by_key: dict[str, list[dict]] = defaultdict(list)
    for f, p in gen:
        by_key[key(f)].append(p)
        # a form the glossary spells without the final macron, and enclitic-free
        by_key[key(f).rstrip("-")].append(p)
    misses = []
    for form, parses in rec["forms"].items():
        k = key(form)
        cand = by_key.get(k)
        if not cand:
            reason = None
            for p in parses:
                reason = divergence(e, form, p, "form-missing")
                if reason:
                    break
            misses.append(("form-missing", e.get("lemma"), form, "", reason))
            continue
        for p in parses:
            if not any(parse_matches(p, g) for g in cand):
                misses.append(("parse-missing", e.get("lemma"), form,
                               " ".join(f"{a}={b}" for a, b in norm(p)),
                               divergence(e, form, p, "parse-missing")))
    return misses


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=0, help="check this many lemmas per class")
    ap.add_argument("--lemma", default=None)
    ap.add_argument("--kind", default=None, help="only this mismatch kind")
    ap.add_argument("--limit", type=int, default=60)
    a = ap.parse_args(argv)

    glossary = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    lemmas = load_lemmas(glossary)
    if a.lemma:
        lemmas = {k: v for k, v in lemmas.items() if k[0] == a.lemma}

    # a class is (pos, declension/conjugation, variant, kind) — sample across all
    classes: dict[tuple, list] = defaultdict(list)
    for lid, rec in lemmas.items():
        e = rec["entry"]
        cat = tuple(e.get("cat") or [])
        classes[(e.get("pos"), cat, e.get("kind"))].append((lid, rec))
    picked = []
    for cls, items in sorted(classes.items(), key=lambda kv: str(kv[0])):
        items.sort(key=lambda kv: str(kv[0]))
        picked += items[:a.sample] if a.sample else items

    kinds: Counter = Counter()
    per_class: Counter = Counter()
    reasons: Counter = Counter()
    unexplained = 0
    total_forms = 0
    shown = []
    ok_lemmas = 0
    for lid, rec in picked:
        total_forms += len(rec["forms"])
        ms = check(rec)
        if not ms:
            ok_lemmas += 1
        for m in ms:
            kinds[m[0]] += 1
            e = rec["entry"]
            if m[4]:
                reasons[m[4]] += 1
                continue
            unexplained += 1
            per_class[(m[0], e.get("pos"), tuple(e.get("cat") or []), e.get("kind"))] += 1
            if not a.kind or m[0] == a.kind:
                shown.append(m)

    print(f"lemmas checked {len(picked)}  (classes {len(classes)})   "
          f"attested forms {total_forms}   clean lemmas {ok_lemmas}")
    print("mismatches:", dict(kinds))
    print()
    print("explained by a known divergence:")
    for r, n in reasons.most_common(40):
        print(f"  {n:5d}  {r}")
    print()
    print(f"UNEXPLAINED {unexplained}")
    print()
    for (mk, pos, cat, kind), n in per_class.most_common(30):
        print(f"  {n:5d}  {mk:14s} {pos} {list(cat)} {kind or ''}")
    print()
    for m in shown[:a.limit]:
        print("   ", " | ".join(str(x) for x in m))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
