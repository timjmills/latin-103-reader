#!/usr/bin/env python
"""
build_vocab.py — chapter vocabulary decks for the grammar section (wave 2, P).

    python pipeline/build_vocab.py              # chapters 1–34 → app/data/grammar/vocab/NN.json
    python pipeline/build_vocab.py 1 7 30       # selected chapters (the library is still read whole)
    python pipeline/build_vocab.py --check      # validate the committed files only
    python pipeline/build_vocab.py --report     # print every deck (lemma, dict, count) after building

Shape: docs/GRAMMAR-CONTRACT.md, "Vocabulary deck vocab/NN.json".

Where a word belongs
  The library is read in chapter order — chapters 1–24 from the review shelf
  (data/build/review-NN.json), 25–34 from the course weeks
  (data/build/week-NN.json, chapter = the Roman numeral that opens
  week.chapter; a Fabulae Syrae / Fabellae week belongs to its FR chapter,
  and inside a chapter the Familia Romana units come first).  Every token is
  lemmatised and a lemma belongs to the first chapter it occurs in; its
  `unit_id` is the first sentence of that chapter that contains it and
  `count` is its number of occurrences in the whole library (1–34).

Lemmatising
  A token's readings are the glossary's entries for its form
  (app/data/glossary.json, already ranked with build_glossary's PREFERRED /
  SENSE_OVERRIDES); a form the glossary lacks (the shelf's chapters were not
  in the glossary's token set) is analysed with Whitaker through
  build_glossary's own analyse / build_entry / rank_and_filter, so the entry
  has the same shape and spelling rules; those analyses are cached in
  data/build/vocab-whitaker.json.  When a form has several readings
  (servī: serviō imper. / servus gen.) the glossary's first reading is kept
  unless another reading's lemma is far better attested by unambiguous forms
  elsewhere in the library (servus, servum, servōs …: at least three times
  the first reading's anchors, and at least three); pronoun readings are
  always the glossary's first (its PREFERRED order separates quī from quis);
  a form whose first reading is a numeral is a numeral (ūna, secundus stay
  out unless the glossary lists the adjective first); FORM_OVERRIDES pins
  the few forms the glossary ranks oddly (ecce → hic).
  Left out: proper names (a form that is capitalised in every occurrence and
  occurs somewhere other than sentence-initially, or whose reading is a
  capitalised noun — except the adjectives of nationality, NATIONAL_ADJ),
  numerals (pos NUM, Roman numerals), enclitics (the -que / -ne / -ve the
  glossary splits off; the host word is counted), gloss abbreviations
  (ABBR / ENDING / PREFIX / STEM), and single letters.

Dictionary forms
  nouns "puella, -ae f." / "frāter, frātris m."; adjectives "magnus, -a, -um";
  verbs carry `parts` = the glossary's principal parts and `dict` the same;
  `decl` is the declension of nouns and adjectives (null otherwise);
  `meaning` is the glossary's first (preferred) sense.

Nothing here touches app/js or supabase/.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from macrons import canonical, strip_macrons  # noqa: E402

BUILD = ROOT / "data" / "build"
GLOSSARY = ROOT / "app" / "data" / "glossary.json"
OUT_DIR = ROOT / "app" / "data" / "grammar" / "vocab"
WHITAKER_CACHE = BUILD / "vocab-whitaker.json"

CHAPTERS = range(1, 35)
WORD_RE = re.compile(r"[A-Za-zĀĒĪŌŪȲāēīōūȳ]+")
ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
SKIP_POS = {"NUM", "ABBR", "ENDING", "PREFIX", "STEM"}
SENTENCE_END = re.compile(r"[.!?…:][\"'”’»)\]]*$")
# capitalised adjectives the book lists as vocabulary (never proper names)
FORM_OVERRIDES = {"ecce": "ecce"}  # form → headword (h) to use
NATIONAL_ADJ = {"romanus", "graecus", "latinus", "germanus", "gallicus", "aegyptius", "italicus",
                "christianus", "punicus", "troianus", "siculus", "britannicus", "hispanus", "iudaeus"}


def roman_to_int(s: str) -> int:
    total = 0
    for i, ch in enumerate(s):
        v = ROMAN_VALUES[ch]
        total += -v if i + 1 < len(s) and ROMAN_VALUES[s[i + 1]] > v else v
    return total


def skeleton(tok: str) -> str:
    return strip_macrons(tok).lower()


# ------------------------------------------------------------------ library

def library_units() -> dict[int, list[dict]]:
    """chapter → units in reading order (FR units before FS/FL within a chapter)."""
    out: dict[int, list[dict]] = defaultdict(list)
    for c in range(1, 25):
        p = BUILD / f"review-{c:02d}.json"
        if p.exists():
            out[c] += json.loads(p.read_text(encoding="utf-8"))["units"]
    by_chapter: dict[int, list[tuple[int, int, list[dict]]]] = defaultdict(list)
    for p in sorted(BUILD.glob("week-??.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        wk = data["week"]
        m = re.match(r"([IVXLC]+)", wk["chapter"])
        if not m:
            continue
        c = roman_to_int(m.group(1))
        fr = 0 if wk["source"] == "FR" else 1
        by_chapter[c].append((fr, wk["n"], data["units"]))
    for c, weeks in by_chapter.items():
        for _, _, units in sorted(weeks, key=lambda t: (t[0], t[1])):
            out[c] += units
    return dict(sorted(out.items()))


def tokens_of(la: str) -> list[tuple[str, bool]]:
    """(token, sentence-initial?) for every word of a unit's Latin."""
    out = []
    prev_end = 0
    initial = True
    for m in WORD_RE.finditer(la):
        between = la[prev_end:m.start()]
        if out and (SENTENCE_END.search(between.strip()) or re.search(r"[.!?…]", between)):
            initial = True
        out.append((m.group(), initial))
        initial = False
        prev_end = m.end()
    return out


# ------------------------------------------------------------------ lemmatiser

class Lemmatiser:
    def __init__(self, glossary: dict[str, list[dict]]):
        self.glossary = glossary
        self.cache: dict[str, list[dict]] = {}
        if WHITAKER_CACHE.exists():
            try:
                self.cache = json.loads(WHITAKER_CACHE.read_text(encoding="utf-8"))
            except ValueError:
                self.cache = {}
        self._parser = None
        self._speller = None
        self.dirty = False

    def _whitaker(self, form: str, spellings: Counter) -> list[dict]:
        import build_glossary as bg
        if self._parser is None:
            from whitakers_words.parser import Parser
            self._parser = Parser(frequency="F")
            bg.INFL_FREQ.update(bg.inflection_freq_map(self._parser))
            self._speller = bg.Speller()
        key = canonical(form)
        recs = bg.analyse(self._parser, key)
        for sp, n in spellings.items():
            self._speller.learn_form(sp, n)
            for rec in recs:
                self._speller.learn(sp, rec)
        entries = [bg.build_entry(r, self._speller) for r in recs]
        ranked = bg.rank_and_filter(recs, entries, key)
        ranked += bg.supine_entries(ranked, key)
        for e in ranked:
            e.pop("raw", None)
        return ranked

    def entries(self, form: str, spellings: Counter | None = None) -> list[dict]:
        """Readings of a form: the glossary's, else Whitaker's (cached)."""
        key = skeleton(form)
        if key in self.glossary:
            return self.glossary[key]
        ckey = canonical(form)
        if ckey in self.glossary:
            return self.glossary[ckey]
        if ckey not in self.cache:
            self.cache[ckey] = self._whitaker(form, spellings or Counter({form: 1}))
            self.dirty = True
        return self.cache[ckey]

    def save(self) -> None:
        if self.dirty:
            WHITAKER_CACHE.parent.mkdir(parents=True, exist_ok=True)
            WHITAKER_CACHE.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
            self.dirty = False


def lemma_key(e: dict) -> tuple[str, str]:
    """(lemma string, pos) — the identity of a word across chapters (VPAR counts as
    its verb; macrons ignored so a glossary entry and a Whitaker one agree)."""
    pos = "V" if e["pos"] == "VPAR" else e["pos"]
    return (canonical(e["lemma"]), pos)


def is_proper_entry(e: dict) -> bool:
    return e["pos"] == "N" and e["lemma"][:1].isupper()


def usable(e: dict) -> bool:
    return e["pos"] not in SKIP_POS and not is_proper_entry(e) and bool(e.get("senses"))


# ------------------------------------------------------------------ dictionary forms

def dict_form(e: dict) -> tuple[str, str | None]:
    """→ (dict, parts)."""
    lemma = e["lemma"]
    pos = e["pos"]
    if pos in ("V", "VPAR"):
        return lemma, lemma
    if pos == "N":
        m = re.match(r"^(\S+)\s+(.*?)\s*(m|f|n|m/f|c)?\s*(\(.*\))?$", lemma)
        if m and m.group(2):
            head, gen, g = m.group(1), m.group(2).strip(), m.group(3)
            return f"{head}, {gen} {g}." if g else f"{head}, {gen}", None
        return lemma, None
    if pos == "ADJ":
        parts = lemma.split()
        return ", ".join(parts) if len(parts) > 1 else lemma, None
    return lemma, None


def headword(e: dict) -> str:
    return e["lemma"].split(",")[0].split()[0]


# ------------------------------------------------------------------ build

def build(chapters_wanted: list[int] | None = None, report: bool = False) -> dict[int, dict]:
    glossary = json.loads(GLOSSARY.read_text(encoding="utf-8"))
    lem = Lemmatiser(glossary)
    library = library_units()
    unit_ids = {u["id"] for units in library.values() for u in units}

    # pass 0: every token with its spellings, lower-case attestation, sentence position
    occurrences: list[tuple[int, str, str, bool]] = []  # (chapter, unit id, token, initial)
    spellings: dict[str, Counter] = defaultdict(Counter)
    lower_seen: set[str] = set()
    non_initial_cap: set[str] = set()
    for c, units in library.items():
        for u in units:
            for tok, initial in tokens_of(u["la"]):
                occurrences.append((c, u["id"], tok, initial))
                spellings[skeleton(tok)][tok] += 1
                if tok[:1].islower():
                    lower_seen.add(skeleton(tok))
                elif not initial:
                    non_initial_cap.add(skeleton(tok))

    # pass 1: candidate readings per form; anchor counts from unambiguous forms
    candidates: dict[str, list[dict]] = {}
    anchors: Counter = Counter()
    for form, sp in spellings.items():
        if len(form) == 1 and form == strip_macrons(form):
            candidates[form] = []
            continue
        all_ents = lem.entries(sp.most_common(1)[0][0], sp)
        if len(form) <= 2 and (skeleton(form) not in glossary and canonical(form) not in glossary
                               or sum(sp.values()) <= 3):
            candidates[form] = []  # a fragment the OCR left ("su", "nā", "Ōr") is not a word
            continue
        if all_ents and all_ents[0]["pos"] == "NUM":
            candidates[form] = []  # a numeral form (ūna, duo, tertius) is a numeral
            continue
        if form in FORM_OVERRIDES:
            all_ents = [e for e in all_ents if e["h"] == FORM_OVERRIDES[form]]
        ents = [e for e in all_ents if usable(e)]
        if any(not e.get("enc") for e in ents):
            ents = [e for e in ents if not e.get("enc")]  # quoque is one word, not quō + que
        # one reading per lemma, the glossary's first
        seen: set[tuple[str, str]] = set()
        uniq = []
        for e in ents:
            k = lemma_key(e)
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        candidates[form] = uniq
        if len(uniq) == 1:
            anchors[lemma_key(uniq[0])] += sum(sp.values())
    lem.save()

    # pass 2: choose a reading per form
    chosen: dict[str, dict | None] = {}
    for form, ents in candidates.items():
        if not ents:
            chosen[form] = None
            continue
        first = ents[0]
        pick = first
        if len(ents) > 1 and first["pos"] != "PRON":
            a0 = anchors[lemma_key(first)]
            # a participle reading never displaces a noun / adjective (Crēta, secundus, facta)
            alts = [e for e in ents[1:] if not (e["pos"] == "VPAR" and first["pos"] in ("N", "ADJ"))]
            if alts:
                alt = max(alts, key=lambda e: anchors[lemma_key(e)])
                if anchors[lemma_key(alt)] >= max(3, 3 * a0):
                    pick = alt
        chosen[form] = pick

    # a form that is never lower-case and occurs inside a sentence is a name,
    # unless it is one of the capitalised adjectives of nationality
    def is_name(form: str, e: dict) -> bool:
        sp = spellings[form]
        caps = sum(n for f, n in sp.items() if f[:1].isupper()) / max(1, sum(sp.values()))
        ents = lem.entries(form)
        if caps >= 0.8 and ents and is_proper_entry(ents[0]):
            return True  # Iūlius is a name even where Whitaker also offers the adjective "July"
        if e["pos"] not in ("N", "ADJ"):
            return False  # Ecce, Nōlī: capitalised by position, not names
        if caps >= 0.9 and form in non_initial_cap:
            return not (e["pos"] == "ADJ" and canonical(headword(e)) in NATIONAL_ADJ)
        if caps == 1.0 and e["pos"] == "N" and sum(sp.values()) >= 3 and skeleton(form) not in glossary:
            return True  # Albīnus: a Whitaker-only noun that is never lower-case
        return False

    # pass 3: first chapter, first unit, counts
    first: dict[tuple[str, str], tuple[int, str, dict]] = {}
    counts: Counter = Counter()
    forms_of: dict[tuple[str, str], Counter] = defaultdict(Counter)
    skipped_names: Counter = Counter()
    for c, uid, tok, initial in occurrences:
        form = skeleton(tok)
        e = chosen.get(form)
        if e is None:
            continue
        if is_name(form, e):
            skipped_names[tok] += 1
            continue
        k = lemma_key(e)
        counts[k] += 1
        forms_of[k][tok] += 1
        if k not in first:
            first[k] = (c, uid, e)

    decks: dict[int, dict] = {c: {"chapter": c, "words": []} for c in CHAPTERS}
    for k, (c, uid, e) in first.items():
        if c not in decks:
            continue
        d, parts = dict_form(e)
        head = headword(e)
        if head == strip_macrons(head):
            # the glossary spelt this headword without macrons; when the library's usual
            # spelling of that form carries them (vocābulum ×15, vocabulum ×0), use it
            sp = Counter()
            for f, n in spellings.get(skeleton(head), {}).items():
                sp[f.lower()] += n
            if sp:
                usual = sp.most_common(1)[0][0]
                if usual != strip_macrons(usual):
                    d = d.replace(head, usual, 1)
                    if parts:
                        parts = parts.replace(head, usual, 1)
                    head = usual
        word = {
            "lemma": head,
            "dict": d,
            "pos": "V" if e["pos"] == "VPAR" else e["pos"],
            "gender": e.get("gender") if e["pos"] == "N" else None,
            "decl": (e.get("cat") or [None])[0] if e["pos"] in ("N", "ADJ") else None,
            "meaning": e["senses"][0],
            "parts": parts,
            "unit_id": uid,
            "count": counts[k],
        }
        decks[c]["words"].append(word)
    for c in decks:
        decks[c]["words"].sort(key=lambda w: (-w["count"], strip_macrons(w["lemma"]).lower()))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for c in (chapters_wanted or list(CHAPTERS)):
        path = OUT_DIR / f"{c:02d}.json"
        path.write_text(json.dumps(decks[c], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"chapter {c:2d}: {len(decks[c]['words']):3d} words → {path.relative_to(ROOT)}")
        if report:
            for w in decks[c]["words"]:
                fk = next((k for k in forms_of if k[1] == w["pos"] and k[0].split(",")[0].split()[0] in (w["lemma"], strip_macrons(w["lemma"]))), None)
                forms = ", ".join(f"{f}×{n}" if n > 1 else f for f, n in forms_of[fk].most_common(6)) if fk else ""
                print(f"    {w['lemma']:16} {w['dict']:40} {w['pos']:5} {w['count']:4}  {w['meaning'][:36]:36}  [{w['unit_id']}]  {forms}")
    if skipped_names:
        print(f"proper names skipped: {len(skipped_names)} distinct, e.g. "
              + ", ".join(t for t, _ in skipped_names.most_common(12)))
    errs = check(unit_ids)
    for e in errs:
        print("ERROR", e)
    return decks


def check(unit_ids: set[str] | None = None) -> list[str]:
    errs: list[str] = []
    if unit_ids is None:
        unit_ids = {u["id"] for units in library_units().values() for u in units}
    seen: dict[tuple[str, str], int] = {}
    for c in CHAPTERS:
        path = OUT_DIR / f"{c:02d}.json"
        if not path.exists():
            errs.append(f"{path.name}: missing")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errs.append(f"{path.name}: invalid JSON ({e})")
            continue
        if data.get("chapter") != c or not isinstance(data.get("words"), list):
            errs.append(f"{path.name}: shape (chapter / words)")
            continue
        for w in data["words"]:
            for key in ("lemma", "dict", "pos", "gender", "decl", "meaning", "parts", "unit_id", "count"):
                if key not in w:
                    errs.append(f"{path.name}: {w.get('lemma')} lacks {key}")
            if w.get("unit_id") not in unit_ids:
                errs.append(f"{path.name}: {w.get('lemma')} unit_id {w.get('unit_id')} not in the library")
            k = (w.get("dict"), w.get("pos"))
            if k in seen:
                errs.append(f"{path.name}: {k} already in chapter {seen[k]}")
            seen[k] = c
            if w.get("pos") == "V" and not w.get("parts"):
                errs.append(f"{path.name}: verb {w.get('lemma')} without parts")
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chapters", nargs="*", type=int, help="chapters to write (default 1–34)")
    ap.add_argument("--check", action="store_true", help="validate app/data/grammar/vocab/*.json only")
    ap.add_argument("--report", action="store_true", help="print every deck")
    a = ap.parse_args(argv)
    if a.check:
        errs = check()
        for e in errs:
            print("ERROR", e)
        print("vocab: OK" if not errs else f"vocab: {len(errs)} problem(s)")
        return 1 if errs else 0
    bad = [c for c in a.chapters if c not in CHAPTERS]
    if bad:
        ap.error(f"chapters must be 1–34: {bad}")
    build(a.chapters or None, report=a.report)
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
