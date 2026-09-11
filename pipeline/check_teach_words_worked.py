"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed (2026-09-10)".

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
       really has - one dictionary parse of the form must carry every named
       feature - or the literal "why" (allowed in `ask` only)
     * no feature is named in both `given` and `ask`, and none is repeated
     * the first worked example of the skill asks nothing
     * every later one asks at least as much as the one before, and the last
       asks the most (`ask` grows across the skill)
     * "why" is asked at least once per skill

Feature names are the eight the app's own parser recognises (items.js SYN):
degree, tense, mood, voice, person, case, number, gender - plus `construction`,
which lessons.js WORKED_FEATURES admits and items.js workedFeature answers with
the skill's own id, so it is allowed only on a skill whose `feature` is
`construction`. The check is on the feature *key*: `given` / `ask` name a
feature, never a value, so a step is right when the focus word's parse carries
that slot at all (asking the `number` of an infinitive, or the `tense` of a
noun, is what this catches).

Four readings of the glossary mirror items.js so the checker says what the app
will do: an adjective or adverb reading with no `degree` is positive
(featureValue); a `deponent: true` filter is the entry's `kind` (isDeponent); a
`pos: V` filter admits a VPAR entry (entryAllowed); and the cum-compounds
(mēcum, sēcum, nōbīscum ...) are never a candidate at all (NEVER_TARGET), so a
worked example on one of them would render nothing. A focus of more than one
word (an ablative absolute) is read word by word: the engine matches no single
token to it and takes the sentence's first clear candidate instead.

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_words_worked.py [skill ...]
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAM = ROOT / "app" / "data" / "grammar"

DEFAULT_SKILLS = [
    "ablative-agent",
    "dative-indirect-object",
    "demonstratives",
    "demonstrative-pronouns",
    "relative-pronoun",
    "third-declension",
    "infinitive",
    "accusative-infinitive",
]

FEATURES = {"degree", "tense", "mood", "voice", "person", "case", "number", "gender"}
# items.js NEVER_TARGET: sē + cum is not a noun, and never a drill target.
NEVER_TARGET = {"secum", "mecum", "tecum", "nobiscum", "vobiscum", "quocum", "quacum", "quibuscum", "quicum"}


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


def parses_of(glossary, form: str):
    """Every dictionary parse of an inflected form, as sets of feature keys.

    items.js featureValue reads an adjective or adverb reading that names no
    degree as the positive, so `degree` is a slot such a reading carries.
    """
    entries = glossary.get(fold(form)) or []
    out = []
    for entry in entries:
        for parse in entry.get("parses") or []:
            keys = {k for k, v in parse.items() if v is not None and k in FEATURES}
            if "degree" not in keys and (parse.get("case") or entry.get("pos") == "ADV")                     and entry.get("pos") in ("ADJ", "ADV"):
                keys.add("degree")
            out.append((entry, parse, keys))
    return out


def matches_filter(entry, parse, filt) -> bool:
    """The skill's own parse_filter, so the *intended* reading is the one checked."""
    for key, want in (filt or {}).items():
        want = want if isinstance(want, list) else [want]
        if key == "pos":
            got = entry.get("pos")
            if got == "VPAR" and "V" in [str(w) for w in want]:
                got = "V"
        elif key == "deponent":
            if want == [True] and entry.get("kind") not in ("dep", "semidep"):
                return False
            continue
        elif key == "h":
            got = entry.get("h")
        elif key == "decl":
            cat = entry.get("cat") or []
            got = cat[0] if cat else None
        elif key == "conj":
            cat = entry.get("cat") or []
            got = cat[1] if len(cat) > 1 else None
        elif key == "gender":
            got = parse.get("gender") or entry.get("gender")
        else:
            got = parse.get(key)
        if got is None or str(got) not in [str(w) for w in want]:
            return False
    return True


def main(argv):
    skills = [a for a in argv if not a.startswith("-")] or DEFAULT_SKILLS
    cat = load(GRAM / "paradigms.json")
    tables = paradigm_index(cat)
    glossary = load(ROOT / "app" / "data" / "glossary.json")
    skills_doc = load(GRAM / "skills.json")
    skill_rows = skills_doc["skills"] if isinstance(skills_doc, dict) else skills_doc
    filters = {s["id"]: s.get("parse_filter") for s in skill_rows}
    skill_feature = {s["id"]: s.get("feature") for s in skill_rows}

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

        lines.append(f"{skill}")
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
                if words is None:
                    lines.append(
                        f"  step {n} chart {table_id}[{', '.join(check.get('cells') or [])}]"
                        f"  words omitted -> stock {', '.join(table['stock'])}"
                    )
                else:
                    n_words += 1
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in table["stock"]:
                            errors.append(
                                f"{where}: {w!r} is not stock for table {table_id!r} "
                                f"(stock: {', '.join(table['stock'])})"
                            )
                    lines.append(
                        f"  step {n} chart {table_id}[{', '.join(check.get('cells') or [])}]"
                        f"  words {', '.join(words)}"
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
            focus = sent.get("focus", "")
            if focus not in sent.get("la", ""):
                errors.append(f"{where}: focus {focus!r} does not occur in {sid} la")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may only be asked, never given")
            named = [f for f in given + ask if f != "why"]
            if len(set(named)) != len(named):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            allowed = FEATURES | ({"construction"} if skill_feature.get(skill) == "construction" else set())
            bad_names = [f for f in named if f not in allowed]
            if bad_names:
                errors.append(f"{where}: not parse features: {bad_names}")
            named = [f for f in named if f in FEATURES]   # `construction` is the skill's id: every reading carries it
            focus_words = focus.split()
            if any(fold(w) in NEVER_TARGET for w in focus_words):
                errors.append(f"{where}: focus {focus!r} is a cum-compound the scanner never targets, so the worked example would render nothing")
            # The intended reading only: the skill's own parse_filter picks it,
            # so an ambiguous form cannot lend a feature it does not have here
            # (volāre is an infinitive in this skill, never the imperative that
            # would supply `person`).
            filt = filters.get(skill)
            all_readings, readings = [], []
            for w in focus_words:
                rs = parses_of(glossary, w)
                all_readings += rs
                readings += [r for r in rs if matches_filter(r[0], r[1], filt)]
            if not all_readings:
                errors.append(f"{where}: no dictionary parse for focus {focus!r} ({sid})")
            elif not readings:
                errors.append(
                    f"{where}: no reading of {focus!r} matches the skill's parse_filter {filt}"
                )
            elif named:
                need = set(named)
                fits = [r for r in readings if need <= r[2]]
                slots = [k for k in ("degree", "tense", "mood", "voice", "person",
                                     "case", "number", "gender")
                         if any(k in keys for _, _, keys in readings)]
                if not fits:
                    errors.append(
                        f"{where}: {focus!r} has no reading carrying {sorted(need)} "
                        f"(features it really has here: {', '.join(slots) or 'none'})"
                    )
                else:
                    # `given` / `ask` name features, not values, so print the
                    # slots the intended reading(s) carry, not one parse's values.
                    lines.append(
                        f"  step {n} worked {sid} focus {focus} "
                        f"[{fits[0][0].get('pos')}, features {'+'.join(slots)}, "
                        f"{len(readings)} of {len(all_readings)} readings in this skill]"
                        f"  given {given or '-'} ask {ask or '-'}"
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
