# -*- coding: utf-8 -*-
"""Every skill, enforced — the build check of GRAMMAR-CONTRACT.md §13.

    set PYTHONIOENCODING=utf-8
    python pipeline/check_skill_coverage.py                 # one line per failing row, then a summary
    python pipeline/check_skill_coverage.py --matrix        # the full 88 x rows table as markdown
    python pipeline/check_skill_coverage.py --skill <id>    # every row of one skill, with reasons

Exit status is 1 when any skill fails any row that the data can decide.

Each of the 88 skills in app/data/grammar/skills.json is first classified —
the three lesson-only skills by name (LESSON_ONLY, with the reason each is
excused), every other by its category (the `paradigms` list then names its
tables):

    lesson-only        elegiac-couplet · prosody-scansion · principal-parts
    table skill        noun-case · adjective · pronoun · verb-form · vocabulary,
                       when `paradigms` names at least one table
    sentence skill     syntax · verb-use, and any skill of a table category whose
                       `paradigms` is empty (ablative-degree, adverbs): with no
                       table to drill, its unlimited practice is the generator

A skill whose sentences file says `lesson_only` but is not one of the three is
reported, not accepted (its row 3 fails).

Then every row of §13's table is tested against the data on disk.  Rows that
concern the app rather than the data — scaffolded tables, per-box feedback,
the same-session re-test, "Just drill it", two-tap entry, the reading tie-in —
are checked as far as the data allows (a table skill must name at least one
catalogue table with stock words; a sentence skill at least five templates; a
lesson-only skill must be one of the declared ones and say so) and are
otherwise reported as "app" (app-side) rather than asserted.  A row that does
not apply to a class is "-" (n/a).

The rows, as the check names them:

    1a  Learn as micro-steps         4–6 numbered steps, each with title, say, show and (except
                                     lesson-only) a check that resolves
    1b  step text ≤ 60 words         every step's `say`, counted in printed words   (§10)
    1c  noticing opener              step 1 carries `notice` {sentences[2], ask, tap|options}  (§10 amendment)
    1d  completed worked examples    ≥ 3 `worked`; the first fully given, every later one asks  (§2, §8)
    2   written sentences            ≥ 12, 5–8 words, cumulative vocabulary, focus, gloss  (§1);
                                     lesson-only: ≥ 4 illustrative lines (a metre skill's each with `scan`)
    3   unlimited practice           table: ≥ 1 catalogue table with stock words, the first of
                                     them taught by the table's own chapter  (§4a, §11)
                                     sentence: ≥ 5 templates, pilot-reviewed  (§11)
                                     lesson-only: excused, the reason stated (by the sentences
                                     file, or by LESSON_ONLY here)
    4   scaffolded table             the named tables have enough cells for 80/50/20/0  (§12) — app
    5   mixed practice / axes        table: every named table offers honest axes  (§5, §12)
                                     sentence: the written set and the generated set both exist
    6   per-box feedback and hint    every check in the teach block is a judgeable box  (§3, §12) — app
    7   re-test · Just drill it ·    material for a blocked ten, and a pattern the reading
        two-tap · reading tie-in     tie-in can light  (§10) — app; lesson-only: tie-in only

The vocabulary rule of row 2 is pipeline/validate_teaching.py's own — its
resolve() is imported, not reimplemented — so the two agree word for word: a
printed word is inside the cumulative vocabulary of the skill's chapter, or a
proper name of the book's cast and places (§1 admits them; the decks hold
none), or the construction's own function word (-que on enclitics).  The
cumulative deck forms are built once per chapter and shared by every skill of
that chapter.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import validate_teaching as VT                           # noqa: E402

GRAM = os.path.join(ROOT, "app", "data", "grammar")

#: The three skills §13's lesson-only column excuses from unlimited practice,
#: each with the reason the map shows in place of a dead control.  The two
#: metre skills are "lesson only" from Wave 2 on (nothing to parse or fill in);
#: principal-parts is a vocabulary skill whose material is the dictionary line
#: itself — the stems are read off the four parts, not generated from a table,
#: so no catalogue table and no template sentence can drill it without end.
LESSON_ONLY: dict[str, str] = {
    "elegiac-couplet": "metre is taught, not drilled: the lines are scanned and read, "
                       "and there is nothing to parse or fill in",
    "prosody-scansion": "prosody is taught, not drilled: syllable length and elision are "
                        "shown on the line, and there is nothing to parse or fill in",
    "principal-parts": "the principal parts are the dictionary line itself: the stems are "
                       "read off the four parts of each verb, not generated from a table, "
                       "so the written sentences are the whole of its practice",
}

TABLE_CATEGORIES = frozenset({"noun-case", "adjective", "pronoun", "verb-form", "vocabulary"})
SENTENCE_CATEGORIES = frozenset({"syntax", "verb-use"})
LESSON_ONLY_CATEGORIES = frozenset({"metre"})

CLASSES = ("table", "sentence", "lesson-only")

#: (row id, short name, contract reference)
ROWS: list[tuple[str, str, str]] = [
    ("1a", "micro-steps", "§2"),
    ("1b", "text <= 60 words", "§10"),
    ("1c", "noticing opener", "§10 amendment"),
    ("1d", "completed worked examples", "§2, §8"),
    ("2", "written sentences", "§1"),
    ("3", "unlimited practice", "§11"),
    ("4", "scaffolded table", "§12"),
    ("5", "mixed practice / axes", "§5, §12"),
    ("6", "per-box feedback and hint", "§3, §12"),
    ("7", "re-test / just drill / two-tap / tie-in", "§10"),
]
ROW_IDS = [r[0] for r in ROWS]

PASS, FAIL, APP, NA = "pass", "FAIL", "app", "-"

MAX_SAY_WORDS = 60
MIN_SENTENCES = 12
MIN_ILLUSTRATIVE = 4
MIN_TEMPLATES = 5
MIN_WORKED = 3
MIN_SCAFFOLD_CELLS = 4

FEATURES = frozenset({"case", "number", "gender", "tense", "mood", "voice",
                      "person", "degree", "construction", "form"})
CHECK_KINDS = frozenset({"recognise", "parse", "blank", "chart"})
SENTENCE_CHECK_KINDS = frozenset({"recognise", "parse", "blank"})
TEMPLATE_REVIEW_KEYS = ("reviewed", "review", "pilot", "reviewed_by")


# ------------------------------------------------------------------ loading

def _load(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def _maybe(path):
    if not os.path.exists(path):
        return None
    try:
        return _load(path)
    except Exception as exc:                                  # noqa: BLE001
        return {"__error__": str(exc)}


def load_skills() -> tuple[list[dict], set[str]]:
    smap = _load(os.path.join(GRAM, "skills.json"))
    return smap["skills"], set(smap.get("paradigm_keys") or {})


def load_catalogue() -> tuple[dict[str, dict], dict[str, dict]]:
    """(tables by id, `keys` map: paradigm key -> {tables, group?})."""
    cat = _load(os.path.join(GRAM, "paradigms.json"))
    tables = {t["id"]: t for part in cat["parts"] for t in part["tables"]}
    return tables, cat["keys"]


# --------------------------------------------------------------- vocabulary

class Vocabulary:
    """The cumulative vocabulary per chapter, as validate_teaching.py builds it
    for one skill — the deck lemmas to the chapter and every form they take —
    built once per chapter here and shared by every skill of that chapter."""

    def __init__(self):
        self.glossary = VT.load(os.path.join(ROOT, "app", "data", "glossary.json"))
        vdir = os.path.join(GRAM, "vocab")
        self.decks = {int(n[:2]): _load(os.path.join(vdir, n))["words"]
                      for n in os.listdir(vdir) if re.fullmatch(r"\d\d\.json", n)}
        self._by_chapter: dict[int, tuple[set[str], dict]] = {}

    def to_chapter(self, chapter: int) -> tuple[set[str], dict]:
        if chapter not in self._by_chapter:
            words = [w for c in sorted(self.decks) if c <= chapter for w in self.decks[c]]
            allowed = {VT.strip_macrons(w["lemma"]) for w in words}
            forms, _parses = VT.deck_forms(words, self.glossary)
            self._by_chapter[chapter] = (allowed, forms)
        return self._by_chapter[chapter]

    def resolve(self, word: str, skill: dict):
        """validate_teaching.resolve: (kind, lemma, enclitic), or None when no
        rule admits the word — kind is deck, name or function."""
        allowed, forms = self.to_chapter(skill["chapter"])
        return VT.resolve(word, allowed, forms, self.glossary,
                          VT.FUNCTION_WORDS.get(skill["id"], set()))


# ----------------------------------------------------------------- helpers

_MD = re.compile(r"[*_`]+")


def say_words(text: str) -> int:
    """Printed words of a step's prose: whitespace tokens that carry a letter."""
    plain = _MD.sub("", text or "")
    return sum(1 for t in plain.split() if re.search(r"[^\W\d_]", t))


def template_words(la: str) -> int:
    """A template's printed length once filled: each {slot} is one word."""
    return len(VT.printed_words(re.sub(r"\{[^}]*\}", "X", la or "")))


def classify(skill: dict, sentences: dict | None) -> str:
    if skill["id"] in LESSON_ONLY or skill["category"] in LESSON_ONLY_CATEGORIES:
        return "lesson-only"
    if isinstance(sentences, dict) and sentences.get("lesson_only"):
        return "lesson-only"
    if skill["category"] in SENTENCE_CATEGORIES:
        return "sentence"
    if not skill.get("paradigms"):
        # A skill of a table category that names no catalogue table has no
        # ending to drill without end: its only unlimited practice is a
        # sentence generator, so it is a sentence skill (§11) — the app makes
        # the same call, offering "Its tables" only when `paradigms` is set.
        # Today: ablative-degree (multō / paulō are two fixed words, not a
        # table) and adverbs (the catalogue has no adverb-formation table).
        return "sentence"
    return "table"


def _join(problems: list[str], limit: int = 3) -> str:
    if len(problems) <= limit:
        return "; ".join(problems)
    return "; ".join(problems[:limit]) + f"; … {len(problems) - limit} more"


# -------------------------------------------------------------------- rows

class Ctx:
    """Everything the row checks read, loaded once."""

    def __init__(self):
        self.skills, self.paradigm_keys = load_skills()
        self.tables, self.keys = load_catalogue()
        self.vocab = Vocabulary()

    def resolve_tables(self, skill: dict) -> tuple[list[dict], list[str]]:
        """The catalogue tables a skill's paradigm keys name, and any problems."""
        found: "OrderedDict[str, dict]" = OrderedDict()
        problems = []
        for key in skill.get("paradigms") or []:
            if key not in self.paradigm_keys:
                problems.append(f"paradigm key {key!r} is not in skills.json paradigm_keys")
                continue
            entry = self.keys.get(key)
            if not entry:
                problems.append(f"paradigm key {key!r} has no entry in paradigms.json keys")
                continue
            for tid in entry.get("tables") or []:
                t = self.tables.get(tid)
                if not t:
                    problems.append(f"key {key!r} names table {tid!r}, not in the catalogue")
                else:
                    found.setdefault(tid, t)
        return list(found.values()), problems


def _table_cells(table: dict) -> set[str]:
    return {c for g in table.get("groups") or [] for c in g.get("cells") or []}


def _table_for_step(ctx: Ctx, skill: dict, step: dict) -> tuple[str | None, set[str] | None]:
    key = (step.get("check") or {}).get("key") or (step.get("show") or {}).get("key")
    if not key:
        return None, None
    entry = ctx.keys.get(key)
    if not entry:
        return key, None
    cells: set[str] = set()
    for tid in entry.get("tables") or []:
        t = ctx.tables.get(tid)
        if t:
            grp = entry.get("group")
            for g in t.get("groups") or []:
                if grp and g.get("id") != grp:
                    continue
                cells.update(g.get("cells") or [])
    return key, cells


def row_1a(ctx, skill, cls, lesson, sents):
    if not isinstance(lesson, dict) or "__error__" in (lesson or {}):
        return FAIL, "lesson file missing or unreadable"
    teach = lesson.get("teach")
    if not teach:
        return FAIL, "the lesson has no teach block"
    p = []
    if not 4 <= len(teach) <= 6:
        p.append(f"{len(teach)} steps, not four to six")
    ns = [st.get("n") for st in teach]
    if ns != list(range(1, len(teach) + 1)):
        p.append(f"step numbers {ns}")
    ids = {s.get("id") for s in (sents or {}).get("sentences") or []} if isinstance(sents, dict) else set()
    for st in teach:
        n = st.get("n")
        for k in ("title", "say", "show"):
            if not st.get(k):
                p.append(f"step {n} has no {k!r}")
        show = st.get("show") or {}
        if show.get("kind") == "sentence" and show.get("id") not in ids:
            p.append(f"step {n} shows sentence {show.get('id')!r}, which does not exist")
        if cls == "lesson-only":
            continue
        chk = st.get("check")
        if not chk:
            p.append(f"step {n} has no check")
            continue
        kind = chk.get("kind")
        if kind not in CHECK_KINDS:
            p.append(f"step {n} check kind {kind!r} unknown")
        elif kind == "chart":
            if not chk.get("cells"):
                p.append(f"step {n} chart check names no cells")
        elif chk.get("sentence") not in ids:
            p.append(f"step {n} check names sentence {chk.get('sentence')!r}, which does not exist")
    return (FAIL, _join(p)) if p else (PASS, f"{len(teach)} steps")


def row_1b(ctx, skill, cls, lesson, sents):
    teach = (lesson or {}).get("teach") if isinstance(lesson, dict) else None
    if not teach:
        return FAIL, "no teach block"
    over = [(st.get("n"), say_words(st.get("say", ""))) for st in teach]
    over = [(n, w) for n, w in over if w > MAX_SAY_WORDS]
    if over:
        return FAIL, "steps over sixty words: " + ", ".join(f"{n} ({w})" for n, w in over)
    longest = max(say_words(st.get("say", "")) for st in teach)
    return PASS, f"longest step {longest} words"


def row_1c(ctx, skill, cls, lesson, sents):
    teach = (lesson or {}).get("teach") if isinstance(lesson, dict) else None
    if not teach:
        return FAIL, "no teach block"
    first = teach[0]
    notice = first.get("notice")
    if not notice:
        return FAIL, "step 1 has no \"notice\" opener"
    p = []
    ids = {s.get("id") for s in (sents or {}).get("sentences") or []} if isinstance(sents, dict) else set()
    ss = notice.get("sentences") or []
    if len(ss) != 2:
        p.append(f"notice names {len(ss)} sentences, not two")
    for sid in ss:
        if sid not in ids:
            p.append(f"notice sentence {sid!r} does not exist")
    if not notice.get("ask"):
        p.append("notice has no question")
    # Mirror app/js/grammar/lessons.js normaliseNotice exactly: it reads `options`
    # (+ `answer`) or `tap: "focus"`, and nothing else. Any other spelling falls
    # back to tap-the-focus, which asks the learner to tap a word that does not
    # answer the question — so an unread key is a failure here, not a warning.
    options = notice.get("options")
    tap = notice.get("tap")
    if "choices" in notice:
        p.append('notice uses "choices"; the loader reads "options"')
    if tap not in (None, "focus"):
        p.append(f'notice "tap" is {tap!r}; the loader reads only "focus"')
    if options:
        if not isinstance(options, list) or len(options) < 2 or not all(isinstance(o, str) and o.strip() for o in options):
            p.append("notice options must be two or more non-empty strings")
        ans = notice.get("answer")
        if isinstance(ans, int):
            if not (isinstance(options, list) and 0 <= ans < len(options)):
                p.append("notice answer index is outside its options")
        elif not isinstance(ans, str) or ans not in (options if isinstance(options, list) else []):
            p.append("notice answer is not one of its options")
    elif tap != "focus":
        p.append("notice is answered neither by tap: focus nor by options")
    return (FAIL, _join(p)) if p else (PASS, "notice on step 1")


def row_1d(ctx, skill, cls, lesson, sents):
    teach = (lesson or {}).get("teach") if isinstance(lesson, dict) else None
    if not teach:
        return FAIL, "no teach block"
    ids = {s.get("id") for s in (sents or {}).get("sentences") or []} if isinstance(sents, dict) else set()
    worked = [(st.get("n"), st.get("worked")) for st in teach if st.get("worked")]
    p = []
    if len(worked) < MIN_WORKED:
        p.append(f"{len(worked)} worked examples, fewer than {MIN_WORKED} (one shown, two completed)")
    for i, (n, w) in enumerate(worked):
        if w.get("sentence") not in ids:
            p.append(f"step {n} worked sentence {w.get('sentence')!r} does not exist")
        given, ask = list(w.get("given") or []), list(w.get("ask") or [])
        if i == 0 and ask:
            p.append(f"step {n}: the first worked example must be shown fully parsed, but asks {ask}")
        if i > 0 and not ask:
            p.append(f"step {n}: a later worked example asks nothing")
        bad = [f for f in given + ask if f not in FEATURES and f != "why"]
        if bad:
            p.append(f"step {n}: unknown features {bad}")
        if set(given) & set(ask):
            p.append(f"step {n}: {sorted(set(given) & set(ask))} both given and asked")
    return (FAIL, _join(p)) if p else (PASS, f"{len(worked)} worked examples")


def _sentence_problems(ctx, skill, s: dict, need_scan: bool) -> list[str]:
    p = []
    sid = s.get("id") or "?"
    la = s.get("la") or ""
    ws = VT.printed_words(la)
    if s.get("words") != len(ws):
        p.append(f"{sid}: \"words\" {s.get('words')} but {len(ws)} printed")
    if not 5 <= len(ws) <= 8 and not s.get("note"):
        p.append(f"{sid}: {len(ws)} words and no note")
    if not s.get("focus") or s["focus"] not in la:
        p.append(f"{sid}: focus not verbatim in la")
    if need_scan:
        if not s.get("scan"):
            p.append(f"{sid}: no scan")
    else:
        gl = [g.get("w") for g in (s.get("gloss") or [])]
        if gl != ws:
            p.append(f"{sid}: gloss does not list every word in order")
    for w in ws:
        if ctx.vocab.resolve(w, skill) is None:
            p.append(f"{sid}: {w!r} outside the cumulative vocabulary to chapter {skill['chapter']}")
    return p


def row_2(ctx, skill, cls, lesson, sents):
    if not isinstance(sents, dict) or "__error__" in sents:
        return FAIL, "sentences file missing or unreadable"
    ss = sents.get("sentences") or []
    p = []
    if sents.get("chapter") != skill["chapter"]:
        p.append(f"file chapter {sents.get('chapter')} != skill chapter {skill['chapter']}")
    if cls == "lesson-only":
        if len(ss) < MIN_ILLUSTRATIVE:
            p.append(f"{len(ss)} illustrative lines, fewer than {MIN_ILLUSTRATIVE}")
    elif len(ss) < MIN_SENTENCES:
        p.append(f"{len(ss)} sentences, fewer than {MIN_SENTENCES}")
    seen = set()
    for s in ss:
        if s.get("id") in seen:
            p.append(f"duplicate id {s.get('id')!r}")
        seen.add(s.get("id"))
        p.extend(_sentence_problems(ctx, skill, s,
                                    need_scan=(skill["category"] in LESSON_ONLY_CATEGORIES)))
    what = "illustrative lines" if cls == "lesson-only" else "sentences"
    return (FAIL, _join(p)) if p else (PASS, f"{len(ss)} {what}")


def row_3(ctx, skill, cls, lesson, sents, templates):
    if cls == "table":
        tables, p = ctx.resolve_tables(skill)
        if not skill.get("paradigms"):
            p.append("names no paradigm table (paradigms is empty)")
        no_stock = [t["id"] for t in tables if not t.get("stock")]
        if no_stock:
            p.append(f"tables without stock words: {no_stock}")
        for t in tables:
            first = (t.get("stock") or [None])[0]
            if first and t.get("chapter") and (first.get("chapter") or 99) > t["chapter"]:
                p.append(f"{t['id']}: first stock word {first['h']!r} is introduced in chapter "
                         f"{first.get('chapter')}, after the table's chapter {t['chapter']}")
        if p:
            return FAIL, _join(p)
        return PASS, ", ".join(f"{t['id']} ({len(t['stock'])} stock)" for t in tables)
    if cls == "sentence":
        if templates is None:
            return FAIL, "no templates file (app/data/grammar/templates/<skill>.json)"
        if "__error__" in templates:
            return FAIL, f"templates file unreadable — {templates['__error__']}"
        ts = templates.get("templates") or []
        p = []
        if templates.get("skill") != skill["id"]:
            p.append(f"templates file's skill is {templates.get('skill')!r}")
        if len(ts) < MIN_TEMPLATES:
            p.append(f"{len(ts)} templates, fewer than {MIN_TEMPLATES}")
        seen = set()
        for t in ts:
            tid = t.get("id") or "?"
            if tid in seen:
                p.append(f"duplicate template id {tid!r}")
            seen.add(tid)
            for k in ("la", "en", "slots", "focus"):
                if not t.get(k):
                    p.append(f"{tid}: no {k!r}")
            slots = t.get("slots") or {}
            # {ab} is the generator's ā / ab macro (contract §11a), not a slot
            used = set(re.findall(r"\{(\w+)(?::[^}]*)?\}", t.get("la") or "")) - {"ab"}
            missing = used - set(slots)
            if missing:
                p.append(f"{tid}: slots {sorted(missing)} used but not declared")
            # `focus` is a slot name or a printed word; a two-word construction
            # (an ablative absolute: noun + participle) may name a list of them.
            focus = t.get("focus")
            printed = VT.printed_words(t.get("la") or "")
            for f in (focus if isinstance(focus, list) else [focus]) if focus else []:
                if not isinstance(f, str) or (f not in slots and f not in printed):
                    p.append(f"{tid}: focus {f!r} is neither a slot nor a printed word")
            n = template_words(t.get("la") or "")
            if not 5 <= n <= 8 and not t.get("note"):
                p.append(f"{tid}: {n} words when filled and no note")
        if not any(templates.get(k) for k in TEMPLATE_REVIEW_KEYS):
            p.append("no pilot-review record in the file (reviewed / review / pilot)")
        if p:
            return FAIL, _join(p)
        return PASS, f"{len(ts)} templates, reviewed"
    # lesson-only: excused, stated
    if skill["id"] not in LESSON_ONLY:
        return FAIL, f"classified lesson-only but not one of the declared skills {sorted(LESSON_ONLY)}"
    if isinstance(sents, dict) and sents.get("lesson_only") and sents.get("note"):
        return PASS, "excused; the sentences file says why"
    return PASS, "excused: " + LESSON_ONLY[skill["id"]]


def row_4(ctx, skill, cls, lesson, sents):
    if cls == "lesson-only":
        return NA, ""
    if cls == "sentence" and not skill.get("paradigms"):
        return NA, "no table named"
    tables, p = ctx.resolve_tables(skill)
    if not tables:
        return FAIL, _join(p) if p else "names no catalogue table"
    thin = [t["id"] for t in tables if len(_table_cells(t)) < MIN_SCAFFOLD_CELLS]
    if thin:
        return FAIL, f"tables too small to scaffold at 80/50/20: {thin}"
    return APP, f"{len(tables)} table(s) with cells to scaffold; levels and auto are app-side"


def row_5(ctx, skill, cls, lesson, sents, templates):
    if cls == "lesson-only":
        return NA, ""
    if cls == "table":
        tables, p = ctx.resolve_tables(skill)
        if not tables:
            return FAIL, _join(p) if p else "names no catalogue table"
        for t in tables:
            axes = t.get("axes") or []
            if not axes:
                p.append(f"{t['id']} offers no axis")
            for a in axes:
                vals = a.get("values") or []
                if len(vals) < 2:
                    p.append(f"{t['id']} axis {a.get('id')} has fewer than two values")
                empty = [v.get("v") for v in vals if not (v.get("cells") or v.get("lemmas"))]
                if empty:
                    p.append(f"{t['id']} axis {a.get('id')} offers empty values {empty}")
        if p:
            return FAIL, _join(p)
        return PASS, "; ".join(f"{t['id']}: {','.join(a['id'] for a in t['axes'])}" for t in tables)
    # sentence: written / generated / both
    n = len((sents or {}).get("sentences") or []) if isinstance(sents, dict) else 0
    p = []
    if n < MIN_SENTENCES:
        p.append(f"written set has {n} sentences")
    nt = len((templates or {}).get("templates") or []) if isinstance(templates, dict) else 0
    if nt < MIN_TEMPLATES:
        p.append("generated set: " + ("no templates file" if templates is None else f"{nt} templates"))
    if p:
        return FAIL, _join(p)
    return PASS, f"written ({n}) and generated ({nt}) both available"


def row_6(ctx, skill, cls, lesson, sents):
    if cls == "lesson-only":
        return NA, ""
    teach = (lesson or {}).get("teach") if isinstance(lesson, dict) else None
    if not teach:
        return FAIL, "no teach block"
    by_id = {s.get("id"): s for s in (sents or {}).get("sentences") or []} if isinstance(sents, dict) else {}
    p, boxes = [], 0
    for st in teach:
        n = st.get("n")
        chk = st.get("check") or {}
        kind = chk.get("kind")
        if kind == "chart":
            key, cells = _table_for_step(ctx, skill, st)
            if key is None:
                p.append(f"step {n}: chart check with no table key on the step")
            elif cells is None:
                p.append(f"step {n}: table key {key!r} not in the catalogue")
            else:
                bad = [c for c in chk.get("cells") or [] if c not in cells]
                if bad:
                    p.append(f"step {n}: cells {bad} are not cells of {key!r}")
            boxes += len(chk.get("cells") or []) * max(1, len(chk.get("words") or []))
        elif kind in SENTENCE_CHECK_KINDS:
            s = by_id.get(chk.get("sentence"))
            if not s:
                p.append(f"step {n}: check sentence {chk.get('sentence')!r} does not exist")
            elif kind == "blank" and not s.get("focus"):
                p.append(f"step {n}: blank check on a sentence with no focus word")
            boxes += 1
        else:
            p.append(f"step {n}: check kind {kind!r} is not a judgeable box")
    if p:
        return FAIL, _join(p)
    return APP, f"{boxes} judgeable boxes in Learn; colour and hint are app-side"


def row_7(ctx, skill, cls, lesson, sents):
    tie = bool(skill.get("patterns")) or bool(skill.get("highlight_match"))
    if cls == "lesson-only":
        if not tie:
            return FAIL, "no patterns or highlight_match for the reading tie-in"
        return APP, "tie-in has a pattern to light; the link is app-side"
    p = []
    n = len((sents or {}).get("sentences") or []) if isinstance(sents, dict) else 0
    if n < 10:
        p.append(f"{n} written sentences, fewer than the blocked ten")
    if cls == "table":
        tables, tp = ctx.resolve_tables(skill)
        if not any(t.get("stock") for t in tables):
            p.append("no catalogue table with stock words to drill")
        p.extend(tp)
    if not tie:
        p.append("no patterns or highlight_match for the reading tie-in")
    if p:
        return FAIL, _join(p)
    return APP, "material for a blocked ten and a tie-in pattern; re-test, entry and link are app-side"


# -------------------------------------------------------------------- run

def check_skill(ctx: Ctx, skill: dict) -> dict:
    sid = skill["id"]
    lesson = _maybe(os.path.join(GRAM, "lessons", sid + ".json"))
    sents = _maybe(os.path.join(GRAM, "sentences", sid + ".json"))
    templates = _maybe(os.path.join(GRAM, "templates", sid + ".json"))
    cls = classify(skill, sents)
    rows = OrderedDict()
    rows["1a"] = row_1a(ctx, skill, cls, lesson, sents)
    rows["1b"] = row_1b(ctx, skill, cls, lesson, sents)
    rows["1c"] = row_1c(ctx, skill, cls, lesson, sents)
    rows["1d"] = row_1d(ctx, skill, cls, lesson, sents)
    rows["2"] = row_2(ctx, skill, cls, lesson, sents)
    rows["3"] = row_3(ctx, skill, cls, lesson, sents, templates)
    rows["4"] = row_4(ctx, skill, cls, lesson, sents)
    rows["5"] = row_5(ctx, skill, cls, lesson, sents, templates)
    rows["6"] = row_6(ctx, skill, cls, lesson, sents)
    rows["7"] = row_7(ctx, skill, cls, lesson, sents)
    notes = []
    if cls == "lesson-only" and sid in LESSON_ONLY:
        notes.append("lesson-only: " + LESSON_ONLY[sid])
    if cls == "lesson-only" and sid not in LESSON_ONLY:
        notes.append("lesson-only by its data, but not one of the declared lesson-only skills")
    if cls == "table" and skill.get("feature") == "construction":
        notes.append("a case used as a construction: §11 would also give it templates")
    return {"id": sid, "class": cls, "category": skill["category"],
            "chapter": skill["chapter"], "rows": rows, "notes": notes}


def run(skill_ids: list[str] | None = None) -> "OrderedDict[str, dict]":
    ctx = Ctx()
    out: "OrderedDict[str, dict]" = OrderedDict()
    for skill in ctx.skills:
        if skill_ids and skill["id"] not in skill_ids:
            continue
        out[skill["id"]] = check_skill(ctx, skill)
    return out


def summarise(results) -> dict:
    classes = Counter(r["class"] for r in results.values())
    per_row = OrderedDict()
    for rid in ROW_IDS:
        per_row[rid] = Counter(r["rows"][rid][0] for r in results.values())
    failing = [r["id"] for r in results.values() if any(st == FAIL for st, _ in r["rows"].values())]
    return {"classes": classes, "per_row": per_row, "failing": failing,
            "fail_lines": sum(c[FAIL] for c in per_row.values())}


# ----------------------------------------------------------------- output

def print_failures(results, show_all: bool = False):
    for r in results.values():
        for rid, (st, why) in r["rows"].items():
            if st == FAIL or show_all:
                name = dict((a, b) for a, b, _ in ROWS)[rid]
                print(f"{st:4} {r['id']:30} [{r['class']}]  row {rid} {name}: {why}")
        for n in r["notes"]:
            print(f"note {r['id']:30} [{r['class']}]  {n}")


def print_summary(results):
    s = summarise(results)
    print()
    print(f"{len(results)} skills: " + ", ".join(f"{k} {v}" for k, v in sorted(s["classes"].items())))
    print()
    print(f"{'row':4} {'name':40} {'pass':>5} {'app':>5} {'FAIL':>5} {'n/a':>5}")
    for rid, name, _ in ROWS:
        c = s["per_row"][rid]
        print(f"{rid:4} {name:40} {c[PASS]:5d} {c[APP]:5d} {c[FAIL]:5d} {c[NA]:5d}")
    print()
    if s["failing"]:
        print(f"FAIL — {s['fail_lines']} failing rows across {len(s['failing'])} skills")
    else:
        print("PASS — every skill meets every row the data can decide")


def print_matrix(results):
    print("| skill | class | " + " | ".join(ROW_IDS) + " |")
    print("|---|---|" + "|".join("---" for _ in ROW_IDS) + "|")
    for r in results.values():
        cells = [r["rows"][rid][0] for rid in ROW_IDS]
        print(f"| {r['id']} | {r['class']} | " + " | ".join(cells) + " |")
    print()
    print("Rows: " + "; ".join(f"{rid} {name} ({ref})" for rid, name, ref in ROWS))
    print("Cells: pass · FAIL · app (data in place; behaviour is the app's) · - (n/a for the class)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--matrix", action="store_true", help="print the 88 x rows table as markdown")
    ap.add_argument("--skill", metavar="ID", help="check one skill and print every row")
    args = ap.parse_args(argv)

    results = run([args.skill] if args.skill else None)
    if args.skill and not results:
        print(f"no skill {args.skill!r} in skills.json")
        return 2
    if args.matrix:
        print_matrix(results)
    elif args.skill:
        r = results[args.skill]
        print(f"{r['id']}  [{r['class']}]  {r['category']}, chapter {r['chapter']}")
        print_failures(results, show_all=True)
    else:
        print_failures(results)
    print_summary(results)
    return 1 if summarise(results)["failing"] else 0


if __name__ == "__main__":
    sys.exit(main())
