"""Validate the written teaching sentences and lesson `teach` blocks for the
course-103 skills of chapters 32-34.

    PYTHONIOENCODING=utf-8 python pipeline/validate_teaching_103.py [skill ...]

Checks (GRAMMAR-CONTRACT.md, "Teaching rebuild (2026-09-09)", §1 and §2):

* every file is valid JSON;
* every printed word of every sentence is inside the cumulative vocabulary for
  the skill's chapter, or a proper name of the book's cast, or the
  construction's own function word — anything else is named, and the only ones
  allowed through are the listed EXCEPTIONS, each printed with its reason;
* five to eight printed words, or the sentence carries its own `note`;
* the declared `words` count is the real one;
* `focus` occurs verbatim inside `la`;
* every sentence id is unique across every file checked;
* `gloss` covers every printed word, in order;
* the `teach` block has four to six steps, numbered 1..n, each with one check;
* every sentence a teach step names exists in that skill's sentence file, and
  every teaching step has at least one sentence of its own;
* every paradigm key a teach step names is in `paradigm_keys` in skills.json
  and among the skill's own `paradigms`, and every cell key is well formed;
* step 1 words the term exactly as the skill's `plain` string words it.

How a word is resolved: the vocabulary decks list dictionary headwords, so a
printed form counts as inside the vocabulary when it is either a form the
generator (`pipeline/latin_forms.py`, the Python twin of app/js/paradigms.js)
builds from an allowed headword, or a form the corpus glossary already indexes
under one.  Enclitic -que / -ne / -ve is stripped and the stem retried.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import latin_forms as LF                                    # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GRAMMAR = ROOT / "app" / "data" / "grammar"

WORD_RE = re.compile("[A-Za-zāēīōūȳĀĒĪŌŪȲæÆœŒ̄]+")
_MACRON = {
    "ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u", "ȳ": "y",
    "Ā": "A", "Ē": "E", "Ī": "I", "Ō": "O", "Ū": "U", "Ȳ": "Y",
    "̄": "", "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe",
}

#: The book's cast and its places, by declension.  The decks hold no proper
#: names at all (contract §7.2), so a name is allowed by the contract's own
#: rule and is never reported as a breach.
NAME_STEMS = [
    ("iūli", "2m"), ("mārc", "2m"), ("quīnt", "2m"), ("dāv", "2m"),
    ("mēd", "2m"), ("aemili", "2m"), ("cornēli", "2m"), ("sext", "2m"),
    ("tit", "2m"), ("diodōr", "2m"), ("sabidi", "2m"),
    ("iūli", "1f"), ("aemili", "1f"), ("syr", "1f"), ("lȳdi", "1f"),
    ("dēli", "1f"), ("fabi", "1f"), ("rōm", "1f"), ("osti", "1f"),
    ("graeci", "1f"), ("itali", "1f"), ("campani", "1f"), ("crēt", "1f"),
    ("tūscul", "2n"), ("brundisi", "2n"),
]
_ENDINGS = {
    "1f": ["a", "ae", "am", "ā", "ārum", "īs", "ās"],
    "2m": ["us", "ī", "ō", "um", "e", "ōrum", "īs", "ōs"],
    "2n": ["um", "ī", "ō", "a", "ōrum", "īs"],
}


def plain(word: str) -> str:
    out = "".join(_MACRON.get(ch, ch) for ch in unicodedata.normalize("NFC", word))
    return out.lower()


NAMES = {plain(stem + end) for stem, decl in NAME_STEMS for end in _ENDINGS[decl]}

#: Function words a construction owns.  Everything else must be in a deck.
FUNCTION_WORDS = {"ut", "ne", "cum", "si", "utinam", "dummodo"}
#: One deck word, two spellings: the decks index `ab` and `ex` only.
VARIANTS = {"a": "ab", "e": "ex"}

#: Words allowed although neither the generator nor the corpus index has that
#: form.  Each carries the reason it is nevertheless inside the vocabulary.
EXCEPTIONS = {
    "Mementō": "meminī, meminisse is in the chapter 32 deck; the generator "
               "builds no imperative for a perfect-only verb and the course "
               "texts never print this form, but mementō is that verb's "
               "future imperative and Ørberg's own headline example for this "
               "skill (cap. XXXIII).",
}

CASES = ("nom", "gen", "dat", "acc", "abl", "voc", "loc")
NUMBERS = ("sg", "pl")
GENDERS = ("m", "f", "n")
TENSES = ("pres", "impf", "fut", "perf", "plupf", "futperf")
MOODS = ("ind", "subj", "imper")
VOICES = ("act", "pass")
PERSONS = ("1sg", "2sg", "3sg", "1pl", "2pl", "3pl")


def valid_cell(key):
    """`dat.sg`, `dat.pl.f`, `plupf.subj.act.3sg`, `fut.imper.act.2pl`."""
    if not isinstance(key, str):
        return False
    parts = key.split(".")
    if len(parts) in (2, 3) and parts[0] in CASES:
        return parts[1] in NUMBERS and (len(parts) == 2 or parts[2] in GENDERS)
    if len(parts) == 4 and parts[0] in TENSES and parts[1] in MOODS:
        if parts[2] not in VOICES:
            return False
        if parts[1] == "imper":
            return parts[3] in NUMBERS or parts[3] in PERSONS
        return parts[3] in PERSONS
    return False


def words_of(la):
    return WORD_RE.findall(la)


def load_json(path):
    with Path(path).open(encoding="utf-8") as fh:
        return json.load(fh)


def cumulative_vocab(chapter):
    """Dictionary headwords taught at or before `chapter`: (dicts, lemmas)."""
    dicts, lemmas = set(), set()
    for n in range(1, chapter + 1):
        deck = GRAMMAR / "vocab" / ("%02d.json" % n)
        if not deck.exists():
            continue
        for w in load_json(deck)["words"]:
            dicts.add(w["dict"])
            lemmas.add(plain(w["lemma"]))
    return dicts, lemmas


def build_lookup():
    return load_json(ROOT / "app" / "data" / "glossary.json")


_ALLOWED = {}


def allowed_forms(chapter, glossary):
    """Every spelling (macrons stripped) the chapter's vocabulary can print."""
    if chapter in _ALLOWED:
        return _ALLOWED[chapter]
    dicts, lemmas = cumulative_vocab(chapter)
    entries, forms = {}, set()
    for spellings in glossary.values():
        for e in spellings:
            entries.setdefault(
                (e.get("lemma"), e.get("pos"), tuple(e.get("roots") or [])), e)
    for e in entries.values():
        if e.get("lemma") in dicts or plain(e.get("h") or "") in lemmas:
            for f in LF.single_forms(e):
                forms.add(plain(f))
    for spelling, spellings in glossary.items():
        for e in spellings:
            if e.get("lemma") in dicts or plain(e.get("h") or "") in lemmas:
                forms.add(plain(spelling))
                break
    forms |= lemmas
    _ALLOWED[chapter] = forms
    return forms


def resolve(form, chapter, glossary):
    """'in' | 'name' | 'function' | 'exception' | None."""
    if form in EXCEPTIONS:
        return "exception"
    forms = allowed_forms(chapter, glossary)
    key = plain(form)
    stems = [key, VARIANTS.get(key)]
    if key.endswith("que"):
        stems.append(key[:-3])
    if key.endswith(("ne", "ve")):
        stems.append(key[:-2])
    for stem in stems:
        if not stem:
            continue
        if stem in forms:
            return "in"
        if stem in NAMES:
            return "name"
        if stem in FUNCTION_WORDS:
            return "function"
    return None


def check_skill(skill_id, skills, glossary, seen_ids, problems, used_exc):
    meta = skills[skill_id]
    chapter = meta["chapter"]
    paradigm_keys = set(skills["_paradigm_keys"])

    sfile = load_json(GRAMMAR / "sentences" / (skill_id + ".json"))
    lfile = load_json(GRAMMAR / "lessons" / (skill_id + ".json"))

    def fail(msg):
        problems.append("%s: %s" % (skill_id, msg))

    if sfile.get("skill") != skill_id:
        fail("sentence file `skill` is %r" % sfile.get("skill"))
    if sfile.get("chapter") != chapter:
        fail("sentence file chapter %r, skills.json says %r"
             % (sfile.get("chapter"), chapter))

    ids, longest = set(), 0
    tally = {"in": 0, "name": 0, "function": 0}
    for s in sfile["sentences"]:
        sid = s["id"]
        if sid in seen_ids:
            fail("duplicate sentence id %s" % sid)
        seen_ids.add(sid)
        ids.add(sid)

        ws = words_of(s["la"])
        longest = max(longest, len(ws))
        if s.get("words") != len(ws):
            fail("%s: `words` says %r, printed words are %d"
                 % (sid, s.get("words"), len(ws)))
        if not 5 <= len(ws) <= 8 and not s.get("note"):
            fail("%s: %d words and no `note` giving the reason" % (sid, len(ws)))
        if s.get("focus") not in s.get("la", ""):
            fail("%s: focus %r not verbatim in `la`" % (sid, s.get("focus")))
        if [g["w"] for g in s.get("gloss", [])] != ws:
            fail("%s: gloss does not match the printed words in order" % sid)
        if not s.get("en"):
            fail("%s: no English" % sid)
        for field in ("step", "stage", "kinds"):
            if field not in s:
                fail("%s: missing %r" % (sid, field))
        for kind in s.get("kinds", ()):
            if kind not in meta["kinds"]:
                fail("%s: kind %r is not one of the skill's kinds %r"
                     % (sid, kind, meta["kinds"]))
        for w in ws:
            verdict = resolve(w, chapter, glossary)
            if verdict is None:
                fail("%s: %r is outside the cumulative vocabulary to chapter %d"
                     % (sid, w, chapter))
            elif verdict == "exception":
                used_exc.add(w)
            else:
                tally[verdict] += 1

    teach = lfile.get("teach")
    if not teach:
        fail("lesson has no `teach` block")
        return len(sfile["sentences"]), 0, longest, tally
    if not 4 <= len(teach) <= 6:
        fail("teach has %d steps, four to six required" % len(teach))
    if teach and meta.get("plain") and meta["plain"] not in (teach[0].get("say") or ""):
        fail("teach step 1 does not word the term as the skill's `plain` string")
    for i, step in enumerate(teach, 1):
        where = "teach step %d" % i
        if step.get("n") != i:
            fail("%s: `n` is %r" % (where, step.get("n")))
        for field in ("title", "say", "check"):
            if not step.get(field):
                fail("%s: missing %r" % (where, field))
        if not isinstance(step.get("check"), dict):
            fail("%s: needs exactly one check" % where)
        blocks = [b for b in (step.get("show"), step.get("check"))
                  if isinstance(b, dict)]
        for block in blocks:
            for field in ("id", "sentence"):
                ref = block.get(field)
                for one in ([ref] if isinstance(ref, str) else (ref or [])):
                    if one not in ids:
                        fail("%s: names sentence %r, which does not exist"
                             % (where, one))
            if block.get("kind") == "paradigm" or "key" in block:
                key = block.get("key")
                if key not in paradigm_keys:
                    fail("%s: paradigm key %r is not in paradigm_keys"
                         % (where, key))
                elif key not in (meta.get("paradigms") or []):
                    fail("%s: paradigm %r is not one of the skill's paradigms"
                         % (where, key))
            for cell in (block.get("reveal") or []) + (block.get("cells") or []):
                if not valid_cell(cell):
                    fail("%s: malformed cell key %r" % (where, cell))
    steps_used = {s.get("step") for s in sfile["sentences"]}
    for step in teach:
        if step.get("n") not in steps_used:
            fail("teach step %r has no sentence of its own" % step.get("n"))
    return len(sfile["sentences"]), len(teach), longest, tally


DEFAULT = ["wishes-utinam", "pluperfect-subjunctive",
           "conditions-contrary-to-fact", "future-imperative", "dative-verbs",
           "dummodo", "elegiac-couplet", "prosody-scansion"]


def main(argv):
    raw = load_json(GRAMMAR / "skills.json")
    skills = {s["id"]: s for s in raw["skills"]}
    skills["_paradigm_keys"] = raw["paradigm_keys"]
    glossary = build_lookup()

    problems, seen_ids, rows, used_exc = [], set(), [], set()
    totals = {"in": 0, "name": 0, "function": 0}
    for skill_id in (argv or DEFAULT):
        n, steps, longest, tally = check_skill(
            skill_id, skills, glossary, seen_ids, problems, used_exc)
        rows.append((skill_id, skills[skill_id]["chapter"], n, steps, longest))
        for k in totals:
            totals[k] += tally[k]

    width = max(len(r[0]) for r in rows)
    print("%s  ch  sentences  steps  longest" % "skill".ljust(width))
    for skill_id, chapter, n, steps, longest in rows:
        print("%s  %2d  %9d  %5d  %7d"
              % (skill_id.ljust(width), chapter, n, steps, longest))
    print()
    print("words checked: %d inside the cumulative deck vocabulary, %d proper "
          "names of the book's cast, %d the construction's own function word."
          % (totals["in"], totals["name"], totals["function"]))
    if used_exc:
        print("exceptions allowed through, each with its justification:")
        for w in sorted(used_exc):
            print("  %s - %s" % (w, EXCEPTIONS[w]))
    else:
        print("exceptions allowed through: none.")
    print()
    if problems:
        print("%d problems:" % len(problems))
        for p in problems:
            print(" -", p)
        return 1
    print("PASS  JSON valid | every word inside the cumulative vocabulary or "
          "an allowed name or function word | word counts 5-8 or noted | "
          "`words` counts true | focus verbatim in `la` | every sentence id "
          "unique | gloss complete and in order | 4-6 teach steps, each with "
          "one check and a sentence of its own | step 1 words the term as the "
          "skill's `plain` string | every referenced sentence exists | every "
          "paradigm key valid against paradigm_keys and the skill's own "
          "paradigms | every cell key well formed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
