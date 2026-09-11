"""Validator for the written teaching sentences and the lesson `teach` blocks.

Contract: docs/GRAMMAR-CONTRACT.md, "# Teaching rebuild (2026-09-09)", §1 and §2.

Run:
    PYTHONIOENCODING=utf-8 python pipeline/validate_written_sentences.py [skill ...]
    PYTHONIOENCODING=utf-8 python pipeline/validate_written_sentences.py --word 8 hic haec

What it checks, per skill:

  sentences file (app/data/grammar/sentences/<skill>.json)
    * valid JSON, `skill` and `chapter` agree with skills.json
    * every printed word is inside the CUMULATIVE vocabulary (a deck at or
      before the skill's chapter), or a proper name of the book's cast, or the
      construction's own function word - every word admitted by one of those
      two exceptions is listed by name with its justification
    * the macrons are the ones the paradigm tables print (every deck word is
      inflected by pipeline/latin_forms.py, the same tables app/js/paradigms.js
      draws, and the printed spelling must be one of them)
    * five to eight printed words, or the sentence carries its own `note`
    * the declared `words` count is the real one
    * `focus` occurs verbatim inside `la`
    * every sentence id is unique, here and across every file checked
    * `gloss` has one entry per printed word, in order, each with a meaning
    * `stage` is 1, 2 or 3 and every `kind` is one the skill declares

  lesson file (app/data/grammar/lessons/<skill>.json)
    * a `teach` block of four to six steps, numbered 1..n
    * `core`, `more` and `sources` are still there, untouched
    * step 1 carries the skill's `plain` gloss verbatim
    * every step has a title, a `say`, and exactly one `check`
    * every sentence id a step names exists in that skill's sentence file
    * every paradigm key a step names is in the `paradigm_keys` map in
      skills.json AND is one of the skill's own `paradigms`
    * every paradigm cell key parses in the catalogue's id scheme (contract
      §4a) and names a cell the table it is shown on really has
    * a paradigm step that names a `word` names one the catalogue's own
      selection rules build that very table on, and exactly one
    * a deponent skill names a `word` on every paradigm step, and it is a
      deponent - without one the table is built on the catalogue's stock
      word (conj3 is dico), so the lesson would print a real passive and
      caption it with the deponent it is trying to teach
    * every step has at least one sentence of its own, and no sentence points
      at a step that does not exist
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAM = ROOT / "app" / "data" / "grammar"

SKILLS_HERE = [
    "ablative-agent",
    "dative-indirect-object",
    "demonstratives",
    "demonstrative-pronouns",
    "relative-pronoun",
    "third-declension",
    "infinitive",
    "accusative-infinitive",
]

# Proper names of the book's cast. The decks hold no proper names at all
# (contract §7.2: only eight capitalised entries exist across all 34 decks, and
# all of them are adjectives), so the contract admits names by rule, not as an
# exception to be reported as a breach. A name is recognised by its glossary
# headword, so every case of it counts (Iulius, Iulium, Iulio, ...).
NAMES = {
    "iulius": "book cast: Iulius, the father",
    "aemilia": "book cast: Aemilia, the mother",
    "marcus": "book cast: Marcus, the elder son",
    "quintus": "book cast: Quintus, the younger son",
    "iulia": "book cast: Iulia, the daughter",
    "syra": "book cast: Syra, the nurse",
    "davus": "book cast: Davus, the slave",
    "medus": "book cast: Medus, the runaway slave",
    "lydia": "book cast: Lydia, Medus's companion",
    "delia": "book cast: Delia, the slave girl",
    "cornelius": "book cast: Cornelius, the neighbour",
    "albinus": "book cast: Albinus, the shopkeeper",
    "ursus": "book cast: Ursus, the litter-bearer",
    "sextus": "book cast: Sextus, the schoolboy",
    "roma": "book cast: Roma, the city",
    "tusculum": "book cast: Tusculum, the family's town",
    "graecia": "book cast: Graecia, Greece",
    "neptunus": "book cast: Neptunus, the sea god",
}

# The construction's own function words (contract §1). Each is listed with the
# reason it is here rather than in a deck.
FUNCTION_WORDS = {
    "ut": "construction word (contract §1)",
    "ne": "construction word (contract §1)",
    "cum": "construction word (contract §1)",
    "si": "construction word (contract §1)",
    # `quam` "than" belongs to no deck: the comparative's own construction word.
    # It happens to be spelled like the accusative feminine singular of quī
    # (deck 02), which is why it passed before this line existed, and the deck
    # reading is still preferred where one exists - as it is for `cum` and `sī`.
    "quam": "construction word (contract §1)",
}

# A printed spelling the decks record under another headword. Both rows are the
# same fact: a preposition the decks print in its pre-vowel form is spelled
# differently before a consonant — `ab`/`ā` (the ablative of agent needs both),
# `ex`/`ē` (ē nāve beside ex oppidō).
DECK_ALIASES = {
    "a": ("ab", "the deck's ab (deck 05) in its pre-consonant spelling ā"),
    "e": ("ex", "the deck's ex (deck 05) in its pre-consonant spelling ē"),
}

# Printed spellings the decks hold but the generated forms cannot produce,
# because the glossary entry behind the deck word is wrong or its table is
# defective. Each row names the deck word, the exact spelling that is correct,
# and the data fault to repair; a word is admitted only when it is spelled
# exactly right, so a real macron slip is still caught. Every row here is a
# standing repair job on app/data/glossary.json (and, for `modo`, on the deck
# built from it) - not a licence to write these words any other way.
GLOSSARY_DEFECTS = {
    "perveniant": (
        "perveniant", "deck 28 (perveniō)",
        "the glossary root is pervēn-, so it generates pervēniant; the verb is "
        "perveniō, pervenīre, pervēnī with a short e in the present stem",
    ),
    "cenavissent": (
        "cēnāvissent", "deck 30 (cēnō)",
        "the glossary prints cēnō's perfect stems without macrons (cenavī, cenatum), "
        "so it generates cenavissent for cēnāvissent",
    ),
    "dabo": (
        "dabō", "deck 04 (dō)",
        "dō is generated as a plain first conjugation, giving dāre and dābō; its a is "
        "short everywhere but dā and dās",
    ),
    "memento": (
        "mementō", "deck 32 (meminī)",
        "meminī's defective table generates no imperative at all, so mementō is missing",
    ),
    "ne": (
        "nē", "deck 27 (nē)",
        "the deck's nē is stored with the root 'ne', so no macronised form is generated; "
        "nē is in any case the construction's own function word (contract §1)",
    ),
    "modo": (
        "modo", "deck 11 (modo)",
        "the deck prints modō, but the particle 'only, provided that' has a short final o; "
        "modō with the macron is the ablative of modus",
    ),
}

# The enclitics the tokeniser must peel off before a lookup: rīdetque is rīdet
# + -que, and neither half is a deck word on its own spelling.
ENCLITICS = ("que", "ne", "ve")

CASES = {"nom", "gen", "dat", "acc", "abl", "voc", "loc"}
NUMBERS = {"sg", "pl"}
GENDERS = {"m", "f", "n", "c"}
TENSES = {"pres", "impf", "fut", "perf", "plupf", "futperf"}
MOODS = {"ind", "subj", "imper", "inf", "ptc"}
VOICES = {"act", "pass"}
PERSONS = {"1sg", "2sg", "3sg", "1pl", "2pl", "3pl"}
CHECK_KINDS = {"recognise", "parse", "blank", "chart", "translate", "choose"}
SHOW_KINDS = {"sentence", "paradigm"}


def strip_macrons(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    ).lower()


def bare(word: str) -> str:
    """The printed word without surrounding punctuation, macrons kept."""
    w = word.strip()
    w = re.sub(r"^[\"'“‘\(\[]+", "", w)
    w = re.sub(r"[\"'”’\)\]\.,;:!\?]+$", "", w)
    return w


def key_of(word: str) -> str:
    return strip_macrons(bare(word))


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


GLOSSARY = load_json(ROOT / "app" / "data" / "glossary.json")
_SK = load_json(GRAM / "skills.json")
SKILLS = {s["id"]: s for s in _SK["skills"]}
PARADIGM_KEYS = set(_SK["paradigm_keys"])

_PARADIGMS = load_json(GRAM / "paradigms.json")
SLOT_ORDER = _PARADIGMS["id_scheme"]["slot_order"]
SLOT_OF = _PARADIGMS["id_scheme"]["slot_of"]
KIND_PREFIX = set(_PARADIGMS["id_scheme"]["kind_prefix"])
#: paradigm_keys -> its raw catalogue entry ({"tables": [...], "group"?: ...})
_KEY_ENTRIES = _PARADIGMS["keys"]
#: table id -> every cell id in it, so a lesson cannot name a cell that is not
#: there (contract §4a: the id is derived from the cell's own key).
CATALOGUE_CELLS = {
    t["id"]: {c if isinstance(c, str) else c["id"] for g in t["groups"] for c in g["cells"]}
    for part in _PARADIGMS["parts"]
    for t in part["tables"]
}

sys.path.insert(0, str(ROOT / "pipeline"))
import latin_forms  # noqa: E402  (needs pipeline/ on the path)
import build_paradigm_catalogue as catalogue  # noqa: E402


def entries_for(lemma_or_form: str):
    """Glossary entries whose headword is this word."""
    k = strip_macrons(lemma_or_form)
    out = []
    for e in GLOSSARY.get(k, []):
        head = strip_macrons(re.split(r"[ ,]", e["lemma"].strip())[0])
        if e.get("h") == k or head == k:
            out.append(e)
    return out


def entries_filed_elsewhere(lemma: str, pos: str | None):
    """Entries a deck word is a form of, when the glossary files it elsewhere.

    A plural-only noun is printed by the deck the way the book prints it
    (`castra, -ōrum n.`, deck 12) while the glossary holds it under an invented
    singular (`castrum`, whose own forms are castra, castrōrum, castrīs and
    nothing else - it carries `sp: "castra"` to say so). `entries_for` asks the
    two spellings to agree, so the deck word resolves to nothing and every form
    of it is reported as outside the vocabulary, which is the opposite of true.

    An entry is admitted here only when the deck word is one of that entry's own
    generated forms AND the parts of speech agree - without the second test the
    noun `lītus` (deck 25, shore) would drag in the whole of `linō, linere,
    lēvī, lītum`, whose perfect participle it merely looks like.
    """
    k = strip_macrons(lemma)
    return [
        e
        for e in GLOSSARY.get(k, [])
        if (pos is None or e.get("pos") == pos) and k in spellings_of(e)
    ]


def spellings_of(entry) -> dict[str, set[str]]:
    """{normalised form: {printed spellings}} for one glossary entry."""
    out: dict[str, set[str]] = {}
    try:
        generated = latin_forms.forms(entry)
    except Exception:
        return out
    for f, _parse in generated:
        for piece in f.split():
            out.setdefault(strip_macrons(piece), set()).add(piece)
    return out


_NAME_FORMS: dict[str, tuple[str, set[str]]] | None = None


def name_forms() -> dict[str, tuple[str, set[str]]]:
    """{normalised form: (justification, {printed spellings})} for the cast."""
    global _NAME_FORMS
    if _NAME_FORMS is not None:
        return _NAME_FORMS
    out: dict[str, tuple[str, set[str]]] = {}
    for head, why in NAMES.items():
        # Only the proper noun itself: the glossary also carries adjectives
        # built on these names (Iūlius -a -um), whose forms are not the name.
        for e in [x for x in entries_for(head) if x.get("pos") == "N"]:
            for k, spell in spellings_of(e).items():
                if k in out:
                    out[k][1].update(spell)
                else:
                    out[k] = (why, set(spell))
    _NAME_FORMS = out
    return out


_CUM: dict[int, tuple[dict, dict]] = {}


def cumulative(chapter: int):
    """(headwords, forms) for every deck at or before `chapter`.

    headwords  normalised glossary headword -> (chapter, printed lemma)
    forms      normalised inflected form    -> (chapter, printed lemma, {spellings})
    """
    if chapter in _CUM:
        return _CUM[chapter]
    heads: dict[str, tuple[int, str]] = {}
    forms: dict[str, tuple[int, str, set]] = {}
    for ch in range(1, chapter + 1):
        deck = GRAM / "vocab" / f"{ch:02d}.json"
        if not deck.exists():
            continue
        for w in load_json(deck)["words"]:
            lemma = w["lemma"]
            heads.setdefault(strip_macrons(lemma), (ch, lemma))
            entries = entries_for(lemma)
            # The deck word the glossary files under another headword: take its
            # forms, but do not register that headword, so `castrum` itself -
            # the singular the book never prints - stays outside the set.
            filed_elsewhere = not entries
            if filed_elsewhere:
                entries = entries_filed_elsewhere(lemma, w.get("pos"))
            for e in entries:
                if e.get("h") and not filed_elsewhere:
                    heads.setdefault(e["h"], (ch, lemma))
                for k, spell in spellings_of(e).items():
                    if k in forms:
                        forms[k][2].update(spell)
                    else:
                        forms[k] = (ch, lemma, set(spell))
    _CUM[chapter] = (heads, forms)
    return heads, forms


def word_ok(word: str, chapter: int):
    """(ok, why, macrons_ok, is_exception) for one printed word."""
    heads, forms = cumulative(chapter)
    k = key_of(word)
    printed = bare(word)
    if not k:
        return True, "punctuation", True, False
    lower = printed[:1].lower() + printed[1:]

    defect = GLOSSARY_DEFECTS.get(k)
    if defect and printed in (defect[0], defect[0][:1].upper() + defect[0][1:]):
        return True, f"{defect[1]} - GLOSSARY DEFECT: {defect[2]}", True, True

    if k in forms:
        ch, lemma, spell = forms[k]
        if printed in spell or lower in spell:
            return True, f"deck {ch:02d} ({lemma})", True, False
        # The same letters can be an inflected form of one deck word and the
        # dictionary form of another: `arma` is the imperative of armō (armā)
        # and the headword arma, -ōrum n, which the glossary files under an
        # invented singular (armum) so it never reaches the forms map. Fall
        # through to the deck headwords before calling the macrons wrong.
        if k in heads:
            ch2, lemma2 = heads[k]
            return True, f"deck {ch2:02d} ({lemma2})", True, False
        return True, f"deck {ch:02d} ({lemma})", False, False
    nf = name_forms()
    if k in nf:
        why, spell = nf[k]
        return True, why, (printed in spell or lower in spell), True
    if k in heads:
        ch, lemma = heads[k]
        return True, f"deck {ch:02d} ({lemma})", True, False
    if k in DECK_ALIASES:
        alias, why = DECK_ALIASES[k]
        if strip_macrons(alias) in heads:
            return True, why, True, True
    for e in GLOSSARY.get(k, []):
        h = e.get("h")
        if h and h in heads:
            ch, lemma = heads[h]
            return True, f"deck {ch:02d} ({lemma})", True, False
        if h and h in NAMES:
            return True, NAMES[h], True, True
    if k in FUNCTION_WORDS:
        return True, FUNCTION_WORDS[k], True, True
    for enc in ENCLITICS:
        if k.endswith(enc) and len(k) > len(enc) + 1:
            stem = printed[: len(printed) - len(enc)]
            ok, why, macrons, exc = word_ok(stem, chapter)
            if ok:
                return ok, f"{why} + enclitic -{enc}", macrons, exc
    return False, "NOT in the cumulative vocabulary", True, False


def entries_rendering(word: str, paradigm_key: str) -> list[dict]:
    """Glossary entries for `word` that the catalogue builds `paradigm_key` on.

    The branch logic is the catalogue's own (`build_paradigm_catalogue.table_of`,
    the ordered `select` rules of paradigms.json), so a `word` is admitted here
    only if the app would draw that table on it.
    """
    tables = set((_KEY_ENTRIES.get(paradigm_key) or {}).get("tables") or [paradigm_key])
    return [e for e in entries_for(word) if catalogue.table_of(e) in tables]


def is_deponent(entry: dict) -> bool:
    return entry.get("kind") in ("dep", "semidep")


def cell_key_ok(key: str) -> bool:
    """A cell id in the catalogue's own scheme (contract §4a).

    The slots are written in one fixed order and the ones a key does not carry
    are left out, so an id parses back to a key without knowing the order:

        degree · tense · mood · voice · person · case · number · gender

    A key whose kind is neither nominal nor finite is prefixed with its kind
    (`gerund`, `gerundive`, `imper`, `inf`, `ptc`, `supine`), so a gerund's
    accusative and a noun's cannot collide:

        nom.sg · pos.nom.sg.m · comp.dat.pl.n · perf.ind.act.3.sg
        imper.pres.act.pl · inf.perf.pass · ptc.pres.act
        gerund.acc · supine.abl · gerundive

    `id_scheme` in app/data/grammar/paradigms.json is the authority, and this
    reads it rather than restating it: every segment must be a value the
    scheme knows, no two segments may claim the same slot, and the segments
    must run in slot order.
    """
    parts = key.split(".")
    if not parts or not all(parts):
        return False
    if parts[0] in KIND_PREFIX:
        if len(parts) == 1:
            return True
        parts = parts[1:]
    seen = -1
    for seg in parts:
        slot = SLOT_OF.get(seg)
        if slot is None:
            return False
        i = SLOT_ORDER.index(slot)
        if i <= seen:
            return False
        seen = i
    return True


def cells_of(paradigm_key: str) -> set[str] | None:
    """Every cell id the table behind a skills.json paradigm key really has.

    None when the key names no single table (`adjcomp` is a group inside six
    adjective tables, not a table of its own).
    """
    entry = _KEY_ENTRIES.get(paradigm_key) or {}
    tables = entry.get("tables") or []
    if len(tables) != 1 or entry.get("group"):
        return None
    return CATALOGUE_CELLS.get(tables[0])


def table_shows_voice(paradigm_key: str) -> bool:
    """Whether this table's own cells tell active from passive.

    A verb table does; an adjective, noun or pronoun table has no voice slot at
    all. An unknown key answers yes, so it is asked the harder question.
    """
    cells = cells_of(paradigm_key)
    if cells is None:
        return True
    return any(SLOT_OF.get(seg) == "voice" for c in cells for seg in c.split("."))


def paradigm_word_problems(meta, i, slot, pk, spec) -> list[str]:
    """`word`: which lemma the step's table is built on.

    A table with several stock words prints the first of them unless the step
    says otherwise, so a step whose prose names a particular verb must name it
    here too. For a deponent skill the point is sharper than tidiness: conj3's
    stock word is dico, so an unnamed table would print dicor / diceris /
    dicitur - a real passive - under a caption about sequor.

    That last hazard is a hazard of voice, so it is asked only of a table whose
    cells carry one. `adj12` is `bonus`: it has no voice to get wrong, and a
    deponent's participle takes exactly those endings, which is what the step
    showing it says.
    """
    out: list[str] = []
    # `parse_filter` may be an any-of list of filters (enclitics, irregular-comparison);
    # items.js scans it filter by filter, so read every clause here too.
    pf = meta.get("parse_filter") or {}
    clauses = pf if isinstance(pf, list) else [pf]
    deponent_skill = (
        any(bool((c or {}).get("deponent")) for c in clauses) and table_shows_voice(pk)
    )
    word = spec.get("word")
    if word is None:
        if deponent_skill:
            out.append(
                f"step {i} {slot}: paradigm {pk!r} names no `word`; a deponent skill "
                f"must, or the table is built on the catalogue's stock word, which is "
                f"not a deponent"
            )
        return out
    hits = entries_rendering(word, pk)
    if not hits:
        out.append(
            f"step {i} {slot}: `word` {word!r} is not a word the {pk!r} table is built on"
        )
    elif len(hits) > 1:
        out.append(
            f"step {i} {slot}: `word` {word!r} is ambiguous - {len(hits)} glossary "
            f"entries render {pk!r}"
        )
    elif deponent_skill and not is_deponent(hits[0]):
        out.append(
            f"step {i} {slot}: `word` {word!r} is not a deponent, so a deponent skill "
            f"must not build {pk!r} on it"
        )
    return out


def check_skill(skill, seen_ids, out):
    problems: list[str] = []
    stats = {
        "skill": skill,
        "sentences": 0,
        "steps": 0,
        "longest": 0,
        "exceptions": {},
    }
    meta = SKILLS.get(skill)
    if meta is None:
        out.append(f"  ! {skill}: not in skills.json")
        return 1, stats
    chapter = meta["chapter"]

    spath = GRAM / "sentences" / f"{skill}.json"
    if not spath.exists():
        out.append(f"  ! {skill}: {spath} missing")
        return 1, stats
    data = load_json(spath)
    if data.get("skill") != skill:
        problems.append(f"file `skill` is {data.get('skill')!r}, expected {skill!r}")
    if data.get("chapter") != chapter:
        problems.append(
            f"file `chapter` is {data.get('chapter')!r}, skills.json says {chapter}"
        )

    sents = data.get("sentences") or []
    stats["sentences"] = len(sents)
    # The twelve is a floor for a skill that is DRILLED: it exists so generated
    # items do not repeat quickly. A skill with `parse_filter: null` yields no
    # generated items at all, and a sentence file that says so with
    # `lesson_only` holds illustrations for the lesson only - the two metre
    # skills each hold four lines of verse, which is the right number. Padding
    # those to twelve would mean inventing eight more hexameters to no purpose.
    lesson_only = bool(data.get("lesson_only")) and meta.get("parse_filter") is None
    stats["lesson_only"] = lesson_only
    if len(sents) < 12 and not lesson_only:
        problems.append(
            f"only {len(sents)} sentences; the contract asks for twelve"
            + (
                "  (a lesson-only skill is exempt: say so with `lesson_only: true` "
                "in the sentence file, and only where parse_filter is null)"
                if meta.get("parse_filter") is None
                else ""
            )
        )

    by_id: dict[str, dict] = {}
    steps_used: set[int] = set()
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
            problems.append(f"{sid}: `words` is {s.get('words')!r}, counted {n}")
        if not (5 <= n <= 8) and not s.get("note"):
            problems.append(f"{sid}: {n} words and no `note` giving the reason")
        focus = s.get("focus") or ""
        if not focus:
            problems.append(f"{sid}: no `focus`")
        elif focus not in la:
            problems.append(f"{sid}: focus {focus!r} not verbatim in `la`")
        if not s.get("en"):
            problems.append(f"{sid}: no `en`")
        if s.get("stage") not in (1, 2, 3):
            problems.append(f"{sid}: `stage` must be 1, 2 or 3")
        step = s.get("step")
        if not isinstance(step, int):
            problems.append(f"{sid}: `step` missing or not a number")
        else:
            steps_used.add(step)
        kinds = s.get("kinds") or []
        if not kinds:
            problems.append(f"{sid}: no `kinds`")
        for k in kinds:
            if k not in meta["kinds"]:
                problems.append(
                    f"{sid}: kind {k!r} is not one of the skill's kinds {meta['kinds']}"
                )

        gloss = s.get("gloss") or []
        if len(gloss) != n:
            problems.append(f"{sid}: gloss has {len(gloss)} entries for {n} words")
        else:
            for i, (g, w) in enumerate(zip(gloss, words)):
                if key_of(g.get("w", "")) != key_of(w):
                    problems.append(f"{sid}: gloss[{i}] is {g.get('w')!r}, word is {w!r}")
                elif bare(g.get("w", "")) != bare(w):
                    problems.append(
                        f"{sid}: gloss[{i}] {g.get('w')!r} differs in macrons from {w!r}"
                    )
                if not g.get("m"):
                    problems.append(f"{sid}: gloss[{i}] ({g.get('w')}) has no meaning")

        for w in words:
            ok, why, macrons, exc = word_ok(w, chapter)
            if not ok:
                problems.append(f"{sid}: {w!r} - {why}")
            elif not macrons:
                problems.append(f"{sid}: {w!r} - not spelled that way in {why}")
            elif exc:
                stats["exceptions"].setdefault((bare(w), why), 0)
                stats["exceptions"][(bare(w), why)] += 1

    lpath = GRAM / "lessons" / f"{skill}.json"
    lesson = load_json(lpath)
    for block in ("core", "more", "sources"):
        if block not in lesson:
            problems.append(f"lesson lost its `{block}` block")
    teach = lesson.get("teach")
    if not teach:
        problems.append("lesson has no `teach` block")
        return finish(skill, problems, stats, out)
    stats["steps"] = len(teach)
    if not (4 <= len(teach) <= 6):
        problems.append(f"teach has {len(teach)} steps; the contract asks for four to six")

    plain_seen = False
    for i, st in enumerate(teach, 1):
        if st.get("n") != i:
            problems.append(f"step {i}: `n` is {st.get('n')!r}")
        if not st.get("title"):
            problems.append(f"step {i}: no title")
        say = st.get("say") or ""
        if len(say.split()) < 15:
            problems.append(f"step {i}: `say` is too short to teach anything")
        if meta["plain"] in say:
            plain_seen = True
        if i == 1 and not plain_seen:
            problems.append("step 1 does not carry the skill's `plain` gloss verbatim")

        for slot in ("show", "check"):
            spec = st.get(slot)
            if spec is None:
                if slot == "check":
                    problems.append(f"step {i}: no check")
                continue
            kind = spec.get("kind")
            if slot == "show" and kind not in SHOW_KINDS:
                problems.append(f"step {i}: show kind {kind!r} is unknown")
            if slot == "check" and kind not in CHECK_KINDS:
                problems.append(f"step {i}: check kind {kind!r} is unknown")
            sid = spec.get("id") or spec.get("sentence")
            if kind == "sentence" or (slot == "check" and kind in ("recognise", "parse", "blank", "translate", "choose")):
                if sid not in by_id:
                    problems.append(f"step {i} {slot}: sentence {sid!r} does not exist")
            if kind == "paradigm" or spec.get("key"):
                pk = spec.get("key")
                if pk not in PARADIGM_KEYS:
                    problems.append(
                        f"step {i} {slot}: paradigm key {pk!r} is not in paradigm_keys"
                    )
                elif meta["paradigms"] and pk not in meta["paradigms"]:
                    problems.append(
                        f"step {i} {slot}: paradigm {pk!r} is not one of the skill's"
                    )
                else:
                    problems += paradigm_word_problems(meta, i, slot, pk, spec)
            # a chart check names no paradigm of its own: it drills the table
            # the same step has just shown
            table_key = spec.get("key") or (st.get("show") or {}).get("key")
            known = cells_of(table_key) if table_key else None
            for cellkey in list(spec.get("reveal") or []) + list(spec.get("cells") or []):
                if not cell_key_ok(cellkey):
                    problems.append(f"step {i} {slot}: cell key {cellkey!r} is malformed")
                elif known is not None and cellkey not in known:
                    problems.append(
                        f"step {i} {slot}: {table_key} has no cell {cellkey!r}"
                    )
            if slot == "check" and kind == "chart" and not spec.get("cells"):
                problems.append(f"step {i}: a chart check names no cells")

    for st in teach:
        if st.get("n") not in steps_used:
            problems.append(f"step {st.get('n')}: no sentence carries `step`: {st.get('n')}")
    for n in sorted(steps_used):
        if n > len(teach):
            problems.append(f"sentences point at step {n}, which does not exist")

    return finish(skill, problems, stats, out)


def finish(skill, problems, stats, out):
    head = (
        f"  {skill:<24} {stats['sentences']:>2} sentences   "
        f"{stats['steps']} teach steps   longest {stats['longest']} words"
        + ("   lesson-only" if stats.get("lesson_only") else "")
    )
    out.append(head if not problems else head + "   <-- PROBLEMS")
    for p in problems:
        out.append(f"      ! {p}")
    return len(problems), stats


def main(argv):
    if argv and argv[0] == "--word":
        chapter = int(argv[1])
        for w in argv[2:]:
            ok, why, mac, exc = word_ok(w, chapter)
            flag = "ok " if ok and mac else ("MACRON" if ok else "NO ")
            print(f"{flag:<7}{w:<16} {why}")
        return 0

    skills = argv or SKILLS_HERE
    out: list[str] = []
    seen: dict[str, str] = {}
    total = 0
    allstats = []
    print(f"validate_written_sentences: {len(skills)} skills")
    print()
    for skill in skills:
        n, stats = check_skill(skill, seen, out)
        total += n
        allstats.append(stats)
    print("\n".join(out))
    print()
    exceptions: dict[tuple[str, str], int] = {}
    for st in allstats:
        for k, n in st["exceptions"].items():
            exceptions[k] = exceptions.get(k, 0) + n
    print(f"words admitted by exception ({len(exceptions)} distinct), each justified:")
    for (w, why), n in sorted(exceptions.items(), key=lambda x: strip_macrons(x[0][0])):
        print(f"    {w:<12} x{n:<3} {why}")
    print()
    print(
        f"sentences: {sum(s['sentences'] for s in allstats)}"
        f"   ids: {len(seen)} unique"
        f"   teach steps: {sum(s['steps'] for s in allstats)}"
    )
    print(f"problems: {total}")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
