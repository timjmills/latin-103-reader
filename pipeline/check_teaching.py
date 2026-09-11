"""Validator for the written teaching sentences and the lesson `teach` blocks.

Contract: docs/GRAMMAR-CONTRACT.md, "# Teaching rebuild (2026-09-09)", sections 1 and 2.

Checks, per skill:
  * app/data/grammar/sentences/<skill>.json is valid JSON and has the contract shape
  * every printed word is in the cumulative vocabulary (a deck at or before the
    skill's chapter), or a proper name of the book's cast, or the construction's
    own function word - every exception is listed with its justification
  * 5-8 printed words, or the sentence carries its own `note` saying why not
  * `focus` occurs verbatim in `la`
  * every sentence id is unique (within the file and across all files checked)
  * the gloss has one entry per printed word, in order
  * app/data/grammar/lessons/<skill>.json carries a `teach` block of 4-6 steps
  * every sentence id a step references exists, and every step has sentences
  * every paradigm key used is in the paradigm_keys map in skills.json
  * every paradigm cell key parses in this repo's cell-key convention
  * the skill's `plain` string appears verbatim in the first step that names the term

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teaching.py [skill ...]
        PYTHONIOENCODING=utf-8 python pipeline/check_teaching.py --word 15 sequitur ...
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAM = ROOT / "app" / "data" / "grammar"

DEFAULT_SKILLS = [
    "personal-pronouns",
    "active-personal-endings",
    "irregular-verbs-present",
    "deponent-verbs",
    "ablative-absolute",
    "ablative-degree",
    "passive-personal-endings",
    "adverbs",
]

# Proper names of the book's cast. The decks hold no proper names at all
# (contract 7.2), so the contract admits them by name; each is spelled as
# Familia Romana prints it.
# Proper names of the book's cast, with the cases they are printed in. The
# decks hold no proper names at all (contract 7.2 measured eight capitalised
# entries in 34 decks, all adjectives), so the contract admits them by name;
# each is spelled as Familia Romana prints it and declined here so an inflected
# name is admitted too, and only in its real forms.
NAME_STEMS = {
    # nominative, declension pattern, who
    "Iulius": ("2m-ius", "book cast: Iulius, the father"),
    "Marcus": ("2m", "book cast: Marcus, the elder son"),
    "Quintus": ("2m", "book cast: Quintus, the younger son"),
    "Davus": ("2m", "book cast: Davus, the slave"),
    "Medus": ("2m", "book cast: Medus, the runaway slave"),
    "Diodorus": ("2m", "book cast: Diodorus, the schoolmaster of cap. XV"),
    "Sextus": ("2m", "book cast: Sextus, a pupil in cap. XV"),
    "Titus": ("2m", "book cast: Titus, a pupil in cap. XV"),
    "Neptunus": ("2m", "book cast: Neptunus, the sea god invoked in cap. XVI"),
    "Iulia": ("1f", "book cast: Iulia, the daughter"),
    "Aemilia": ("1f", "book cast: Aemilia, the mother"),
    "Syra": ("1f", "book cast: Syra, the nurse"),
    "Lydia": ("1f", "book cast: Lydia, Medus's companion"),
    "Roma": ("1f", "book cast: Roma, the city"),
    "Ostia": ("1f", "book cast: Ostia, the harbour of cap. XVI"),
    "Graecia": ("1f", "book cast: Graecia, where Medus sails"),
    "Tusculum": ("2n", "book cast: Tusculum, the family's town"),
}

_ENDINGS = {
    "1f": ["a", "ae", "ae", "am", "a", "a"],
    "2m": ["us", "i", "o", "um", "o", "e"],
    "2m-ius": ["us", "i", "o", "um", "o", ""],
    "2n": ["um", "i", "o", "um", "o", "um"],
}


def _name_forms() -> dict[str, str]:
    """Every case of every cast name, macrons stripped -> its justification."""
    out = {}
    for nom, (pattern, why) in NAME_STEMS.items():
        stem = nom[: -len(_ENDINGS[pattern][0])]
        for end in _ENDINGS[pattern]:
            out[strip_macrons(stem + end)] = why
    return out


# The construction's own function words, allowed by the contract even where a
# deck has not yet printed them. Every one of these is in fact also in a deck at
# or before the chapter that uses it; the map records why each is here.
FUNCTION_WORDS = {
    "ut": "construction word (contract 1)",
    "ne": "construction word (contract 1)",
    "cum": "construction word (contract 1)",
    "si": "construction word (contract 1)",
    "quam": "construction word: 'than' with a comparative",
}

CASES = {"nom", "gen", "dat", "acc", "abl", "voc", "loc"}
NUMBERS = {"sg", "pl"}
GENDERS = {"m", "f", "n"}
TENSES = {"pres", "impf", "fut", "perf", "plupf", "futperf"}
MOODS = {"ind", "subj", "imper", "inf", "ptc"}
VOICES = {"act", "pass"}
PERSONS = {"1sg", "2sg", "3sg", "1pl", "2pl", "3pl"}
DEGREES = {"pos", "comp", "sup"}  # adjective tables, §4a: degree.case.number.gender
CHECK_KINDS = {"recognise", "parse", "blank", "chart", "translate", "choose"}


def strip_macrons(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    ).lower()


def norm_word(w: str) -> str:
    w = w.strip().strip("—–-")
    w = re.sub(r"^[\"'“‘\(\[]+", "", w)
    w = re.sub(r"[\"'”’\)\]\.,;:!\?]+$", "", w)
    return strip_macrons(w)


NAMES = _name_forms()


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


GLOSSARY = load_json(ROOT / "app" / "data" / "glossary.json")
SKILLS = {s["id"]: s for s in load_json(GRAM / "skills.json")["skills"]}
PARADIGM_KEYS = set(load_json(GRAM / "skills.json")["paradigm_keys"])

sys.path.insert(0, str(ROOT / "pipeline"))
import latin_forms  # noqa: E402  (needs ROOT on the path)


def _variant_index() -> dict[str, set[str]]:
    """Dictionary-form variant -> the glossary headwords that print it.

    A glossary lemma may offer alternatives ("a / ab"), and the decks print only
    one of them; both are the same word, so both headwords are admitted.
    """
    out: dict[str, set[str]] = {}
    for entries in GLOSSARY.values():
        for e in entries:
            h = e.get("h")
            if not h:
                continue
            head = re.split(r",", e.get("lemma", ""))[0]
            for alt in head.split("/"):
                alt = alt.strip()
                if alt:
                    out.setdefault(strip_macrons(alt), set()).add(h)
    return out


VARIANTS = _variant_index()


def deck_entries(lemma: str):
    """The glossary entries for a deck's dictionary form."""
    key = strip_macrons(lemma)
    return [
        e
        for e in GLOSSARY.get(key, [])
        if e.get("h") == key
        or strip_macrons(re.split(r"[ ,]", e["lemma"].strip())[0]) == key
    ]


_CUM_CACHE: dict[int, tuple[dict, dict]] = {}


def cumulative(chapter: int) -> tuple[dict, dict]:
    """(headwords, forms) for every deck at or before `chapter`.

    headwords: normalised glossary headword -> (chapter, printed lemma)
    forms:     normalised inflected form    -> (chapter, printed lemma, {spellings})

    Every regular form of every deck word is generated by pipeline/latin_forms.py
    - the same tables app/js/paradigms.js draws - so a word counts as inside the
    vocabulary in any of its inflections, and its macrons can be checked too.
    """
    if chapter in _CUM_CACHE:
        return _CUM_CACHE[chapter]
    heads: dict[str, tuple[int, str]] = {}
    forms: dict[str, tuple[int, str, set]] = {}
    for ch in range(1, chapter + 1):
        deck = GRAM / "vocab" / f"{ch:02d}.json"
        if not deck.exists():
            continue
        for w in deck and load_json(deck)["words"]:
            lemma = w["lemma"]
            heads.setdefault(strip_macrons(lemma), (ch, lemma))
            for h in VARIANTS.get(strip_macrons(lemma), ()):
                heads.setdefault(h, (ch, lemma))
            for e in deck_entries(lemma):
                if e.get("h"):
                    heads.setdefault(e["h"], (ch, lemma))
                try:
                    generated = latin_forms.forms(e)
                except Exception:
                    continue
                for f, _parse in generated:
                    for piece in f.split():
                        k = strip_macrons(piece)
                        if k not in forms:
                            forms[k] = (ch, lemma, {piece})
                        else:
                            forms[k][2].add(piece)
    _CUM_CACHE[chapter] = (heads, forms)
    return heads, forms


def word_ok(word: str, cum) -> tuple[bool, str, bool]:
    """Is this printed word inside the cumulative vocabulary?

    Returns (ok, why, macrons_ok)."""
    heads, forms = cum
    key = norm_word(word)
    printed = re.sub(r"^[\"'“‘\(\[]+|[\"'”’\)\]\.,;:!\?]+$", "", word.strip())
    if not key:
        return True, "punctuation", True
    if key in NAMES:
        return True, NAMES[key], True
    if key in forms:
        ch, lemma, spellings = forms[key]
        ok_macrons = printed in spellings or printed[:1].lower() + printed[1:] in spellings
        return True, f"deck {ch:02d} ({lemma})", ok_macrons
    if key in heads:
        ch, lemma = heads[key]
        return True, f"deck {ch:02d} ({lemma})", True
    for e in GLOSSARY.get(key, []):
        h = e.get("h")
        if h and h in heads:
            ch, lemma = heads[h]
            return True, f"deck {ch:02d} ({lemma})", True
    if key in FUNCTION_WORDS:
        return True, FUNCTION_WORDS[key], True
    return False, "NOT in the cumulative vocabulary", True


def cell_key_ok(key: str) -> bool:
    """Cell-key convention: nominal 'case[.number][.gender]', finite
    'tense.mood.voice.person+number', infinitive 'inf.tense.voice',
    participle 'ptc.tense.voice', supine / gerund 'supine.case', 'gerund.case'
    (paradigms.js keys those cells {kind: 'supine'|'gerund', case}), imperative
    'imper.tense.voice.number' (paradigms.js keys those {kind: 'imper', tense,
    voice, number})."""
    parts = key.split(".")
    if parts[0] in DEGREES and len(parts) > 1 and parts[1] in CASES:
        parts = parts[1:]  # §4a adjective cell: strip the degree, check the rest
    if parts[0] in ("supine", "gerund"):
        return len(parts) == 2 and parts[1] in CASES
    if parts[0] == "imper":
        return (
            len(parts) == 4
            and parts[1] in TENSES
            and parts[2] in VOICES
            and parts[3] in NUMBERS
        )
    if parts[0] == "gerundive":
        return len(parts) == 1
    if parts[0] == "inf":
        return len(parts) == 3 and parts[1] in TENSES and parts[2] in VOICES
    if parts[0] == "ptc":
        return len(parts) == 3 and parts[1] in TENSES and parts[2] in VOICES
    if parts[0] in TENSES:
        if len(parts) == 5:  # §4a finite cell: tense.mood.voice.person.number
            return (
                parts[1] in MOODS
                and parts[2] in VOICES
                and parts[3] in {"1", "2", "3"}
                and parts[4] in NUMBERS
            )
        return (
            len(parts) == 4
            and parts[1] in MOODS
            and parts[2] in VOICES
            and parts[3] in PERSONS
        )
    if parts[0] in CASES:
        if len(parts) == 1:
            return True
        if len(parts) == 2:
            return parts[1] in NUMBERS
        if len(parts) == 3:
            return parts[1] in NUMBERS and parts[2] in GENDERS
    return False


def check_skill(skill: str, seen_ids: dict, report: list) -> tuple[int, dict]:
    """Returns (number of problems, per-skill stats)."""
    problems = []
    stats = {"skill": skill, "sentences": 0, "steps": 0, "longest": 0,
             "exceptions": [], "spelling": []}

    meta = SKILLS.get(skill)
    if meta is None:
        report.append(f"  ! {skill}: not in skills.json")
        return 1, stats
    chapter = meta["chapter"]
    cum = cumulative(chapter)

    spath = GRAM / "sentences" / f"{skill}.json"
    if not spath.exists():
        report.append(f"  ! {skill}: {spath} missing")
        return 1, stats
    data = load_json(spath)

    if data.get("skill") != skill:
        problems.append(f"file `skill` is {data.get('skill')!r}, expected {skill!r}")
    if data.get("chapter") != chapter:
        problems.append(
            f"file `chapter` is {data.get('chapter')!r}, skills.json says {chapter}"
        )

    sents = data.get("sentences", [])
    stats["sentences"] = len(sents)
    by_id = {}
    steps_used = set()
    for s in sents:
        sid = s.get("id")
        if not sid:
            problems.append("a sentence has no id")
            continue
        if sid in seen_ids:
            problems.append(f"{sid}: id already used by {seen_ids[sid]}")
        seen_ids[sid] = skill
        if sid in by_id:
            problems.append(f"{sid}: duplicate id inside the file")
        by_id[sid] = s

        la = s.get("la", "")
        words = la.split()
        n = len(words)
        stats["longest"] = max(stats["longest"], n)
        if s.get("words") != n:
            problems.append(f"{sid}: `words` is {s.get('words')}, counted {n}")
        if not (5 <= n <= 8) and not s.get("note"):
            problems.append(f"{sid}: {n} words and no `note` giving the reason")

        focus = s.get("focus", "")
        if not focus:
            problems.append(f"{sid}: no `focus`")
        elif focus not in la:
            problems.append(f"{sid}: focus {focus!r} not verbatim in `la`")

        if not s.get("en"):
            problems.append(f"{sid}: no `en`")

        gloss = s.get("gloss", [])
        if len(gloss) != n:
            problems.append(f"{sid}: gloss has {len(gloss)} entries for {n} words")
        else:
            for i, (g, w) in enumerate(zip(gloss, words)):
                if norm_word(g.get("w", "")) != norm_word(w):
                    problems.append(
                        f"{sid}: gloss[{i}] is {g.get('w')!r}, word is {w!r}"
                    )
                if not g.get("m"):
                    problems.append(f"{sid}: gloss[{i}] ({g.get('w')}) has no meaning")

        step = s.get("step")
        if not isinstance(step, int):
            problems.append(f"{sid}: `step` missing or not a number")
        else:
            steps_used.add(step)
        if s.get("stage") not in (1, 2, 3):
            problems.append(f"{sid}: `stage` must be 1, 2 or 3")
        kinds = s.get("kinds") or []
        if not kinds:
            problems.append(f"{sid}: no `kinds`")
        for k in kinds:
            if k not in meta["kinds"]:
                problems.append(f"{sid}: kind {k!r} is not one of the skill's kinds")

        for w in words:
            ok, why, macrons = word_ok(w, cum)
            if not ok:
                problems.append(f"{sid}: {w!r} - {why}")
            elif not macrons:
                stats["spelling"].append((sid, w, why))
            elif why in NAMES.values() or why in FUNCTION_WORDS.values():
                stats["exceptions"].append((norm_word(w), why))

    if len(sents) < 12:
        problems.append(f"only {len(sents)} sentences; the contract asks for twelve")

    lpath = GRAM / "lessons" / f"{skill}.json"
    lesson = load_json(lpath)
    teach = lesson.get("teach")
    if not teach:
        problems.append("lesson has no `teach` block")
        return len(problems), _finish(skill, problems, stats, report)
    stats["steps"] = len(teach)
    if not (4 <= len(teach) <= 6):
        problems.append(f"teach has {len(teach)} steps; the contract asks for 4-6")
    for b in ("core", "more", "sources"):
        if b not in lesson:
            problems.append(f"lesson lost its `{b}` block")

    plain_seen = False
    for i, st in enumerate(teach, 1):
        if st.get("n") != i:
            problems.append(f"step {i}: `n` is {st.get('n')}")
        if not st.get("title"):
            problems.append(f"step {i}: no title")
        say = st.get("say", "")
        if len(say.split()) < 15:
            problems.append(f"step {i}: `say` is too short to teach anything")
        if meta["plain"] in say:
            plain_seen = True
        elif not plain_seen and i == 1:
            problems.append("step 1 does not carry the skill's `plain` gloss verbatim")

        for slot in ("show", "check"):
            spec = st.get(slot)
            if spec is None:
                if slot == "check":
                    problems.append(f"step {i}: no check")
                continue
            kind = spec.get("kind")
            if kind == "sentence" or "sentence" in spec:
                sid = spec.get("id") or spec.get("sentence")
                if sid not in by_id:
                    problems.append(f"step {i} {slot}: sentence {sid!r} does not exist")
            if kind == "paradigm" or "key" in spec:
                key = spec.get("key")
                if key not in PARADIGM_KEYS:
                    problems.append(
                        f"step {i} {slot}: paradigm key {key!r} not in paradigm_keys"
                    )
                elif meta["paradigms"] and key not in meta["paradigms"]:
                    problems.append(
                        f"step {i} {slot}: paradigm {key!r} is not one of the skill's"
                    )
            for cell in (spec.get("reveal") or []) + (spec.get("cells") or []):
                if not cell_key_ok(cell):
                    problems.append(f"step {i} {slot}: cell key {cell!r} is malformed")
            if slot == "check" and kind not in CHECK_KINDS:
                problems.append(f"step {i}: check kind {kind!r} is unknown")
            if slot == "check" and kind in ("recognise", "parse", "blank"):
                sid = spec.get("sentence") or spec.get("id")
                if sid not in by_id:
                    problems.append(f"step {i}: check needs a sentence, got {sid!r}")

    for st in teach:
        n = st.get("n")
        if n not in steps_used:
            problems.append(f"step {n}: no sentence carries `step`: {n}")
    for n in sorted(steps_used):
        if n > len(teach):
            problems.append(f"sentences point at step {n}, which does not exist")

    return len(problems), _finish(skill, problems, stats, report)


def _finish(skill, problems, stats, report):
    head = (
        f"  {skill:<26} {stats['sentences']:>2} sentences  "
        f"{stats['steps']} teach steps  longest {stats['longest']} words"
    )
    report.append(head if not problems else head + "   <-- PROBLEMS")
    for p in problems:
        report.append(f"      ! {p}")
    return stats


def main(argv):
    if argv and argv[0] == "--word":
        chapter = int(argv[1])
        cum = cumulative(chapter)
        for w in argv[2:]:
            ok, why, macrons = word_ok(w, cum)
            flag = "ok " if ok and macrons else ("MAC" if ok else "NO ")
            print(f"{flag} {w:<18} {why}")
        return 0

    skills = argv or DEFAULT_SKILLS
    report = []
    seen_ids = {}
    total = 0
    allstats = []
    print(f"check_teaching: {len(skills)} skills")
    print()
    for skill in skills:
        n, stats = check_skill(skill, seen_ids, report)
        total += n
        allstats.append(stats)
    print("\n".join(report))
    print()
    exceptions = {}
    for st in allstats:
        for w, why in st["exceptions"]:
            exceptions.setdefault((w, why), 0)
            exceptions[(w, why)] += 1
    print(
        f"words outside the decks ({len(exceptions)} distinct), each with its justification:"
    )
    for (w, why), n in sorted(exceptions.items()):
        print(f"    {w:<14} x{n:<3} {why}")
    print()
    spelling = [x for st in allstats for x in st["spelling"]]
    print(f"spellings the form generator prints otherwise ({len(spelling)}), each checked by hand:")
    for sid, w, why in spelling:
        print(f"    {sid:<10} {w:<14} {why}")
    print()
    print(f"sentences: {sum(s['sentences'] for s in allstats)}   ids: {len(seen_ids)} unique")
    print(f"problems: {total}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
