"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8,
over the perfect-system skills of cap. XXI-XXII.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed (2026-09-10)".

It runs the same rules as pipeline/check_teach_words_worked.py and two more
things besides, because this batch needs them:

  * **Forms the library never prints.**  The glossary is keyed by inflected
    form, so `laudāta`, `victī`, `secūtae`, `factū` and thirty others have no
    key at all and a glossary-only check cannot parse them.  The parses here
    come from `pipeline/latin_forms.forms` - the pipeline's cell-for-cell port
    of app/js/paradigms.js, which declines participles right through and gives
    the supine its own `{mood: supine, case: …}` - run over every headword in
    app/data/glossary-headwords.json, unioned with the glossary's own parses.
    So a feature is checked against the form the app itself would generate.

  * **A focus that is more than one word.**  `laudātus est`, `iānuā clausā`,
    `carptās esse`: the periphrastic verb and the ablative absolute are two
    words and the skill is about the pair.  A named feature must be carried by
    a parse of one of the tokens, and the whole named set must be coverable by
    choosing at most one parse per token - so `person` may come from `est`
    while `gender` comes from the participle, but nothing may be named that no
    token carries.  For a single-word focus this is exactly "one parse of the
    form carries every named feature".

Checks, per skill, over app/data/grammar/lessons/<skill>.json:

  A. chart `words`
     * the lesson file is valid JSON with a `teach` list
     * every chart check names a table (its own `key`, else the step's
       `show.key`) that exists in app/data/grammar/paradigms.json
     * every cell id in a chart check is in that table's cell list
     * every lemma in `words` is in that table's `stock` list
     * no lemma is repeated inside one `words` array
     * a chart check with no `words` is reported, with the stock list it
       therefore falls back to

  B. `worked`
     * the sentence id exists in app/data/grammar/sentences/<skill>.json
     * that sentence's `focus` occurs verbatim in its `la`
     * every feature named in `given` / `ask` is a parse feature the focus word
       really has, or the literal "why" (allowed in `ask` only)
     * the reading that supplies those features is the skill's own: it carries
       the values of the skill's `paradigm_focus` in skills.json (perfect-active
       = perf ind act, supine = mood supine, ...) or, for the four skills with
       none, the reading given in EXPECTED below.  So `lēgī` in perfect-active
       is read as the perfect of legō, never as the dative of lēx, and asking
       its `case` would fail.
     * no feature is named in both `given` and `ask`, and none is repeated
     * the first worked example of the skill asks nothing
     * `ask` grows: every later one asks strictly more than the one before
     * "why" is asked at least once per skill

Feature names are the eight the app's own parser recognises (items.js FEATURES,
lessons.js WORKED_FEATURES): degree, tense, mood, voice, person, case, number,
gender. The check is on the feature *key*: `given` / `ask` name a feature, never
a value, so a step is right when the focus word's parse carries that slot at all
(asking the `number` of an infinitive, or the `tense` of a noun, is what this
catches).

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_words_worked_perfect.py [skill ...]
"""

from __future__ import annotations

import json
import sys
import unicodedata
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from latin_forms import forms  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GRAM = ROOT / "app" / "data" / "grammar"

DEFAULT_SKILLS = [
    "principal-parts",
    "perfect-active",
    "perfect-passive-participle",
    "perfect-passive",
    "perfect-infinitive",
    "supine",
    "ablative-absolute-perfect",
    "perfect-deponent-participle",
]

FEATURES = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender")
FEATURE_SET = set(FEATURES)

# The reading a worked focus must have, for skills whose skills.json entry has
# no paradigm_focus. Values as latin_forms.forms prints them.
EXPECTED = {
    "principal-parts": {"tense": "perf"},
    "perfect-passive-participle": {"mood": "ptc", "tense": "perf", "voice": "pass"},
    "perfect-deponent-participle": {"mood": "ptc", "tense": "perf"},
    "ablative-absolute-perfect": {"mood": "ptc", "tense": "perf", "voice": "pass", "case": "abl"},
}


def fold(s: str) -> str:
    """The glossary's key form: macrons off, lower case, no edge punctuation."""
    bare = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return bare.lower().strip(".,;:!?()[]—–-")


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def paradigm_index(cat) -> dict:
    """table id -> {'cells': set, 'stock': [lemma, ...]}."""
    out = {}
    for part in cat["parts"]:
        for table in part["tables"]:
            cells = set()
            for group in table["groups"]:
                for cell in group["cells"]:
                    cells.add(cell if isinstance(cell, str) else cell["id"])
            out[table["id"]] = {
                "cells": cells,
                "stock": [s["h"] for s in table["stock"]],
                "label": table.get("label", ""),
            }
    return out


def form_parses(glossary, headwords) -> dict:
    """folded form -> [set of feature keys], every reading the app can generate.

    `latin_forms.forms` is the pipeline's port of app/js/paradigms.js, so this
    is the parse the app itself would put on the form; the glossary's own
    `parses` are unioned in for the readings a generator does not reach
    (irregulars, second lemmas, enclitic splits).
    """
    idx: dict[str, list[frozenset]] = {}
    def add(form, parse):
        pairs = frozenset((k, str(v)) for k, v in parse.items() if v is not None and k in FEATURE_SET)
        if not pairs:
            return
        bucket = idx.setdefault(fold(form), [])
        if pairs not in bucket:
            bucket.append(pairs)
    for h, _pos, key, i in headwords["headwords"]:
        entry = glossary.get(key or h)
        if not entry or i >= len(entry):
            continue
        for form, parse in forms(entry[i]):
            add(form, parse)
    for key, entries in glossary.items():
        for entry in entries:
            for parse in entry.get("parses") or []:
                add(key, parse)
    return idx


def covers(idx, focus: str, named: set, expect: dict) -> tuple[bool, list, set, frozenset | None]:
    """Can `named` be covered by one reading per token of `focus`, with the
    union of those readings carrying every value in `expect`?

    Returns (ok, tokens, features the focus really carries, the reading used).
    """
    tokens = [t for t in (fold(w) for w in focus.split()) if t]
    per_token = [idx.get(t, []) for t in tokens]
    have = {k for readings in per_token for pairs in readings for k, _ in pairs}
    want_pairs = {(k, str(v)) for k, v in expect.items()}
    per_token = [r for r in per_token if r]
    if not per_token:
        return False, tokens, have, None
    # at most one reading per token: the empty choice is allowed for each
    choices = [[frozenset()] + r for r in per_token]
    best = None
    for combo in product(*choices):
        union = frozenset().union(*combo)
        if want_pairs <= union and named <= {k for k, _ in union}:
            if best is None or len(union) > len(best):
                best = union
    return best is not None, tokens, have, best


def main(argv):
    skills = [a for a in argv if not a.startswith("-")] or DEFAULT_SKILLS
    cat = load(GRAM / "paradigms.json")
    tables = paradigm_index(cat)
    glossary = load(ROOT / "app" / "data" / "glossary.json")
    headwords = load(ROOT / "app" / "data" / "glossary-headwords.json")
    idx = form_parses(glossary, headwords)
    skills_json = load(GRAM / "skills.json")
    focus_of = {sk["id"]: sk.get("paradigm_focus") for sk in (skills_json["skills"] if isinstance(skills_json, dict) else skills_json)}

    errors = []
    lines = []
    n_chart = n_worked = n_words = 0

    for skill in skills:
        lesson_path = GRAM / "lessons" / (skill + ".json")
        sent_path = GRAM / "sentences" / (skill + ".json")
        try:
            lesson = load(lesson_path)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: lesson JSON invalid: {exc}")
            continue
        try:
            sentences = {s["id"]: s for s in load(sent_path)["sentences"]}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: sentences JSON invalid: {exc}")
            continue

        expect = focus_of.get(skill) or EXPECTED.get(skill) or {}
        if not expect:
            errors.append(f"{skill}: no paradigm_focus in skills.json and no EXPECTED reading here")
        lines.append(f"{skill}  (worked focus must read as {' '.join(f'{k}={v}' for k, v in expect.items()) or '?'})")
        worked_seen = []

        for step in lesson.get("teach") or []:
            n = step.get("n")
            where = f"{skill} step {n}"
            check = step.get("check") or {}
            show = step.get("show") or {}

            # ---- A. chart words
            if check.get("kind") == "chart":
                n_chart += 1
                table_id = check.get("key") or show.get("key")
                if table_id not in tables:
                    errors.append(f"{where}: chart check names no known table (got {table_id!r})")
                    continue
                table = tables[table_id]
                for cell in check.get("cells") or []:
                    if cell not in table["cells"]:
                        errors.append(f"{where}: cell {cell!r} is not in table {table_id!r}")
                words = check.get("words")
                cells_txt = ", ".join(check.get("cells") or [])
                if words is None:
                    lines.append(
                        f"  step {n} chart {table_id}[{cells_txt}]"
                        f"  words omitted -> stock {', '.join(table['stock'])}"
                    )
                else:
                    n_words += 1
                    if not words:
                        errors.append(f"{where}: words is empty; omit it to mean the stock list")
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in table["stock"]:
                            errors.append(
                                f"{where}: {w!r} is not stock for table {table_id!r} "
                                f"(stock: {', '.join(table['stock'])})"
                            )
                    lines.append(
                        f"  step {n} chart {table_id}[{cells_txt}]  words {', '.join(words)}"
                    )

            # ---- B. worked
            worked = step.get("worked")
            if worked is None:
                continue
            n_worked += 1
            sid = worked.get("sentence")
            sent = sentences.get(sid)
            if sent is None:
                errors.append(f"{where}: worked sentence {sid!r} is not in {sent_path.name}")
                continue
            focus = sent.get("focus") or ""
            if not focus or focus not in sent.get("la", ""):
                errors.append(f"{where}: focus {focus!r} does not occur in {sid} la")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may only be asked, never given")
            named_list = [f for f in given + ask if f != "why"]
            if len(set(named_list)) != len(named_list):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            bad = [f for f in named_list if f not in FEATURE_SET]
            if bad:
                errors.append(f"{where}: not parse features: {bad}")
            named = set(named_list) & FEATURE_SET
            ok, tokens, have, reading = covers(idx, focus, named, expect)
            if not any(idx.get(t) for t in tokens):
                errors.append(f"{where}: no parse at all for focus {focus!r} ({sid})")
            elif not ok:
                errors.append(
                    f"{where}: {focus!r} has no reading of the skill's kind "
                    f"({' '.join(f'{k}={v}' for k, v in expect.items())}) carrying {sorted(named)} "
                    f"(features it has in any reading: {', '.join(sorted(have)) or 'none'})"
                )
            else:
                carried = "+".join(f for f in FEATURES if f in {k for k, _ in reading})
                lines.append(
                    f"  step {n} worked {sid} focus {focus} [{len(tokens)} word"
                    f"{'' if len(tokens) == 1 else 's'}, read as {' '.join(str(v) for v in expect.values())}, "
                    f"carries {carried}]  given {given or '-'} ask {ask or '-'}"
                )
            worked_seen.append((n, sid, given, ask))

        # ---- per-skill worked rules
        if worked_seen:
            first_n, first_sid, _, first_ask = worked_seen[0]
            if first_ask:
                errors.append(
                    f"{skill}: the first worked example (step {first_n}, {first_sid}) "
                    f"asks {first_ask}; it must be shown fully"
                )
            sizes = [len(a) for _, _, _, a in worked_seen]
            for i in range(1, len(sizes)):
                if sizes[i] <= sizes[i - 1]:
                    errors.append(
                        f"{skill}: worked example {i + 1} (step {worked_seen[i][0]}) asks "
                        f"{sizes[i]}, not more than the {sizes[i - 1]} before it"
                    )
            if not any("why" in a for _, _, _, a in worked_seen):
                errors.append(f"{skill}: 'why' is never asked")
        else:
            lines.append("  (no worked examples)")

    print("\n".join(lines))
    print()
    print(
        f"{len(skills)} skills - {n_chart} chart checks ({n_words} with words, "
        f"{n_chart - n_words} on the table's stock order) - {n_worked} worked examples"
    )
    print(f"{len(idx)} distinct forms indexed from {headwords['count']} headwords")
    if errors:
        print()
        print(f"{len(errors)} PROBLEMS")
        for e in errors:
            print("  " + e)
        return 1
    print("OK - no problems")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
