"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8,
over the subjunctive skills of cap. XXVII-XXVIII.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed (2026-09-10)".

It runs the rules of pipeline/check_teach_words_worked.py and settles one thing
that batch never met: six of these eight skills are `feature: construction`
skills (skills.json), whose parse item asks "what is this clause doing?" of the
clause's verb. The engine names that slot `construction` (items.js FEATURES,
lessons.js WORKED_FEATURES), so a worked example may give or ask it - but only
in a construction skill, where the focus word is the verb of the construction
the skill is about. In a tense skill (imperfect-subjunctive, sequence-of-tenses)
it is not a feature the skill parses and is refused.

Checks, per skill, over app/data/grammar/lessons/<skill>.json:

  A. chart `words`
     * the lesson file is valid JSON with a `teach` list
     * every chart check names a table (its own `key`, else the step's
       `show.key`) that exists in app/data/grammar/paradigms.json
     * every cell id in a chart check is in that table's cell list
     * every lemma in `words` is in that table's `stock` list, none repeated
     * a chart check with no `words` is reported with the stock list it
       therefore falls back to
     * (bonus) every `show.reveal` cell id resolves in the shown table under the
       engine's own forgiveness (items.js resolveCellId: `3sg` for `3.sg`)

  B. `worked`
     * the sentence id exists in app/data/grammar/sentences/<skill>.json
     * that sentence's `focus` occurs verbatim in its `la`
     * every feature named in `given` / `ask` is a parse feature the focus word
       really has - one reading of the form, chosen by the skill's own
       `parse_filter`, carries every morphological feature named - or
       `construction` in a construction skill, or the literal "why" (ask only)
     * no feature is named in both `given` and `ask`, and none is repeated
     * the first worked example of the skill asks nothing
     * `ask` grows strictly across the skill, so the last asks the most
     * "why" is asked at least once per skill
     * (bonus) the worked sentence belongs to the step it is worked in
       (its own `step` equals the teach step's `n`)

Feature names are the nine the app's own parser recognises (items.js FEATURES):
degree, tense, mood, voice, person, case, number, gender, construction. The
check is on the feature *key*: `given` / `ask` name a feature, never a value.

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_words_worked_subjunctive.py [skill ...]
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
    "subjunctive-wish-command",
    "potential-subjunctive",
    "indirect-command",
    "purpose-clause",
    "result-clause",
    "imperfect-subjunctive",
    "sequence-of-tenses",
    "cum-narrative",
]

MORPH = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender")
MORPH_SET = set(MORPH)


def fold(s: str) -> str:
    """The glossary's key form: macrons off, lower case, no edge punctuation."""
    bare = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return bare.lower().strip(".,;:!?()[]—–-")


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def paradigm_index(cat) -> dict:
    """table id -> {'cells': set, 'stock': [lemma, ...], 'label': str}."""
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


def resolve_cell(cid: str, cells: set):
    """items.js resolveCellId: exact, else person+number split, else a degree prefix."""
    if cid in cells:
        return cid
    split = re.sub(r"([123])(sg|pl)(?![a-z0-9])", r"\1.\2", cid)
    if split != cid and split in cells:
        return split
    for degree in ("pos", "comp", "super"):
        if f"{degree}.{split}" in cells:
            return f"{degree}.{split}"
    return None


_GENERATED = None


def generated_index(glossary):
    """folded form -> [(entry, parse)], every form the app itself can generate.

    The glossary is keyed by the forms the book prints, so a teaching sentence's
    `ambulēmus` or `putet` has no key. The parses here come from
    pipeline/latin_forms.forms - the pipeline's cell-for-cell port of
    app/js/paradigms.js - run over every headword in glossary-headwords.json,
    so a feature is checked against the form the app would generate. Lazy:
    built on the first miss only."""
    global _GENERATED
    if _GENERATED is None:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from latin_forms import forms  # noqa: E402  (pipeline-local module)

        head = load(ROOT / "app" / "data" / "glossary-headwords.json")
        idx = {}
        for h, _pos, key, i in head["headwords"]:
            entries = glossary.get(key or h) or []
            if i >= len(entries):
                continue
            entry = entries[i]
            try:
                generated = forms(entry, include_multiword=True)
            except Exception:  # noqa: BLE001
                continue
            for f, p in generated:
                idx.setdefault(fold(f), []).append((entry, p))
        _GENERATED = idx
    return _GENERATED


def parses_of(glossary, form: str):
    """Every parse of an inflected form: (entry, parse, feature keys), from the
    glossary's own parses, else from the forms the app generates."""
    key = fold(form)
    entries = glossary.get(key) or glossary.get(key.replace("v", "u")) or []
    pairs = [(e, p) for e in entries for p in (e.get("parses") or [])]
    if not pairs:
        gen = generated_index(glossary)
        pairs = gen.get(key) or gen.get(key.replace("v", "u")) or []
    out = []
    for entry, parse in pairs:
        keys = {k for k, v in parse.items() if v is not None and k in MORPH_SET}
        out.append((entry, parse, keys))
    return out


def matches_filter(entry, parse, filt) -> bool:
    """The skill's own parse_filter, so the *intended* reading is the one checked."""
    for key, want in (filt or {}).items():
        want = want if isinstance(want, list) else [want]
        if key == "pos":
            got = entry.get("pos")
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
    rows = {s["id"]: s for s in skill_rows}

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
        row = rows.get(skill)
        if row is None:
            errors.append(f"{skill}: not in skills.json")
            continue
        is_construction = row.get("feature") == "construction"
        filt = row.get("parse_filter")
        allowed = MORPH_SET | ({"construction"} if is_construction else set())

        lines.append(f"{skill}  [feature {row.get('feature')}; paradigms {', '.join(row.get('paradigms') or []) or 'none'}]")
        worked_seen = []

        for step in lesson.get("teach") or []:
            n = step.get("n")
            where = f"{skill} step {n}"
            check = step.get("check") or {}
            show = step.get("show") or {}

            # ---- bonus: the shown table's reveal ids resolve
            if show.get("kind") == "paradigm":
                t = tables.get(show.get("key"))
                if t is None:
                    errors.append(f"{where}: show names no known table (got {show.get('key')!r})")
                else:
                    for cid in show.get("reveal") or []:
                        if resolve_cell(cid, t["cells"]) is None:
                            errors.append(f"{where}: reveal {cid!r} resolves to no cell of {show.get('key')!r}")

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
                    if not isinstance(words, list) or not words:
                        errors.append(f"{where}: words must be a non-empty list")
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in table["stock"]:
                            errors.append(
                                f"{where}: {w!r} is not stock for table {table_id!r} "
                                f"(stock: {', '.join(table['stock'])})"
                            )
                    lines.append(f"  step {n} chart {table_id}[{cells_txt}]  words {', '.join(words)}")

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
            if sent.get("step") != n:
                errors.append(f"{where}: worked sentence {sid} belongs to step {sent.get('step')}, not this one")
            if check.get("sentence") == sid:
                errors.append(f"{where}: worked sentence {sid} is also the step's check sentence")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may only be asked, never given")
            named = [f for f in given + ask if f != "why"]
            if len(set(named)) != len(named):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            bad_names = [f for f in named if f not in allowed]
            if bad_names:
                errors.append(
                    f"{where}: not parse features of this skill: {bad_names}"
                    + ("" if is_construction else " (construction is only a feature of a construction skill)")
                )
            morph_named = [f for f in named if f in MORPH_SET]
            all_readings = parses_of(glossary, focus)
            readings = [r for r in all_readings if matches_filter(r[0], r[1], filt)]
            if not all_readings:
                errors.append(f"{where}: no dictionary parse for focus {focus!r} ({sid})")
            elif not readings:
                errors.append(f"{where}: no reading of {focus!r} matches the skill's parse_filter {filt}")
            else:
                need = set(morph_named)
                fits = [r for r in readings if need <= r[2]]
                slots = [k for k in MORPH if any(k in keys for _, _, keys in readings)]
                if is_construction:
                    slots.append("construction")
                if not fits:
                    errors.append(
                        f"{where}: {focus!r} has no reading carrying {sorted(need)} "
                        f"(features it really has here: {', '.join(slots) or 'none'})"
                    )
                else:
                    p = fits[0][1]
                    val = "+".join(str(p.get(k)) for k in ("tense", "mood", "voice", "person", "number") if p.get(k))
                    lines.append(
                        f"  step {n} worked {sid} focus {focus} [{fits[0][0].get('h')}: {val}; "
                        f"features {'+'.join(slots)}; {len(readings)} of {len(all_readings)} readings in this skill]"
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
            lines.append(f"  ask sizes across the skill: {' -> '.join(str(s) for s in sizes)}")
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
