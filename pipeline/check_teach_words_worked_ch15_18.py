"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8,
over the cap. XV-XVIII batch: personal-pronouns, active-personal-endings,
irregular-verbs-present, deponent-verbs, ablative-absolute, ablative-degree,
passive-personal-endings, adverbs.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed (2026-09-10)".

Per skill, over app/data/grammar/lessons/<skill>.json:

  A. chart `words`
     * the lesson, its sentences file and paradigms.json are valid JSON
     * every chart check names a table (its own `key`, else `show.key`) in
       app/data/grammar/paradigms.json
     * every cell id in a chart check - and in the step's `show.reveal` - is in
       that table's cell list
     * every lemma in `words` is in that table's `stock` list, none repeated
     * a chart check with no `words` is reported with the stock list it falls
       back to, so the fallback is a decision, not an accident

  B. `worked`
     * the sentence id exists in app/data/grammar/sentences/<skill>.json (the
       skill's OWN file - never the library) and its `focus` occurs in its `la`
     * every feature in `given` / `ask` is a parse feature the focus word
       really has, or the literal "why" (asked, never given)
     * the parse is the one the app itself would put on the word: the
       glossary's own `parses` unioned with pipeline/latin_forms.forms (the
       cell-for-cell port of app/js/paradigms.js) over every headword, so a
       form the glossary never keys (lātrant, nēmine, vidente) is still parsed;
       the reading is chosen through the skill's own `parse_filter` with the
       app's entryAllowed/parseMatches rules (items.js), so an ambiguous form
       lends only the reading this skill is about; and the derived features
       are the app's (items.js featureValue): an adverb carries `degree`
       (positive when unmarked), a deponent's `voice` is "dep", `person`
       needs person and number, and `construction` is a feature only of a
       skill whose `feature` is "construction" (the syntax skills)
     * a focus of more than one word (an ablative absolute) is covered by
       choosing at most one parse per token
     * no feature is named twice across `given` and `ask`
     * the first worked example of a skill asks nothing; every later one asks
       strictly more than the one before; "why" is asked at least once
     * (note, not error) the worked sentence's own `step` matches the step it
       sits in, and it is not also the step's check sentence

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_words_worked_ch15_18.py [skill ...]
Exit status 0 when everything holds.
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
    "personal-pronouns",
    "active-personal-endings",
    "irregular-verbs-present",
    "deponent-verbs",
    "ablative-absolute",
    "ablative-degree",
    "passive-personal-endings",
    "adverbs",
]

# items.js FEATURES less `form`; lessons.js WORKED_FEATURES is these plus "why".
FEATURES = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender", "construction")
FEATURE_SET = set(FEATURES)
FILTER_KEYS = ("case", "number", "gender", "tense", "voice", "mood", "person", "degree")
NOMINAL_POS = {"N", "ADJ", "PRON", "NUM", "VPAR"}


def fold(s: str) -> str:
    bare = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return bare.lower().strip(".,;:!?()[]—–-")


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def value_in(v, want) -> bool:
    want = want if isinstance(want, list) else [want]
    return str(v) in [str(w) for w in want]


def is_deponent(entry) -> bool:
    return entry.get("kind") in ("dep", "semidep")


def entry_allowed(entry, filt) -> bool:
    """items.js entryAllowed."""
    if not filt:
        return True
    pos = entry.get("pos")
    if filt.get("pos") is not None and not value_in(pos, filt["pos"]) and not (pos == "VPAR" and value_in("V", filt["pos"])):
        return False
    if filt.get("pos") is None:
        if (filt.get("case") is not None or filt.get("gender") is not None) and pos not in NOMINAL_POS:
            return False
        if any(filt.get(k) is not None for k in ("tense", "mood", "voice", "person")) and pos not in ("V", "VPAR"):
            return False
        if filt.get("degree") is not None and pos not in ("ADJ", "ADV"):
            return False
    if filt.get("h") is not None and not value_in(entry.get("h"), filt["h"]):
        return False
    if filt.get("decl") is not None and not value_in((entry.get("cat") or [None])[0], filt["decl"]):
        return False
    if filt.get("deponent") is True and not is_deponent(entry):
        return False
    return True


def parse_matches(p, filt) -> bool:
    """items.js parseMatches."""
    for k in FILTER_KEYS:
        if filt.get(k) is None:
            continue
        v = (p.get("degree") or ("pos" if p.get("case") else None)) if k == "degree" else p.get(k)
        if v is None or not value_in(v, filt[k]):
            return False
    return True


def feature_keys(p, entry, skill) -> frozenset:
    """The feature slots items.js featureValue would fill for this parse."""
    keys = set()
    if p.get("case") is not None:
        keys.add("case")
    if p.get("gender") is not None or entry.get("gender") is not None:
        keys.add("gender")
    if p.get("number") is not None:
        keys.add("number")
    if p.get("degree") or p.get("case") or entry.get("pos") == "ADV":
        keys.add("degree")
    if is_deponent(entry) or p.get("voice") is not None:
        keys.add("voice")
    if p.get("person") is not None and p.get("number"):
        keys.add("person")
    if skill.get("feature") == "construction":
        keys.add("construction")
    mood = p.get("mood")
    if mood:
        keys.add("mood")
        if p.get("tense") or mood in ("gerund", "gerundive", "supine", "imper"):
            keys.add("tense")
    return frozenset(keys)


def paradigm_index(cat) -> dict:
    out = {}
    for part in cat["parts"]:
        for table in part["tables"]:
            cells = set()
            for group in table["groups"]:
                for cell in group["cells"]:
                    cells.add(cell if isinstance(cell, str) else cell["id"])
            out[table["id"]] = {"cells": cells, "stock": [s["h"] for s in table["stock"]]}
    return out


def form_index(glossary, headwords) -> dict:
    """folded form -> [(entry, parse)], the glossary's parses plus the generator's."""
    idx: dict[str, list] = {}
    seen: set = set()

    def add(form, entry, parse):
        sig = (fold(form), id(entry), json.dumps(parse, sort_keys=True))
        if sig in seen:
            return
        seen.add(sig)
        idx.setdefault(fold(form), []).append((entry, parse))

    for key, entries in glossary.items():
        for entry in entries:
            for parse in entry.get("parses") or []:
                add(key, entry, parse)
    for h, _pos, key, i in headwords["headwords"]:
        entry = glossary.get(key or h)
        if not entry or i >= len(entry):
            continue
        for form, parse in forms(entry[i]):
            add(form, entry[i], parse)
    return idx


def readings_of(idx, token: str, filt, skill):
    """(readings in this skill, all readings) for one token, as feature-key sets."""
    all_r = idx.get(fold(token), [])
    in_skill = [(e, p) for e, p in all_r if entry_allowed(e, filt) and parse_matches(p, filt)]
    return in_skill, all_r


def covers(per_token: list[list[frozenset]], named: set) -> bool:
    per_token = [r for r in per_token if r]
    if not per_token:
        return not named
    choices = [[frozenset()] + r for r in per_token]
    return any(named <= set().union(*combo) for combo in product(*choices))


def main(argv):
    skills = [a for a in argv if not a.startswith("-")] or DEFAULT_SKILLS
    tables = paradigm_index(load(GRAM / "paradigms.json"))
    glossary = load(ROOT / "app" / "data" / "glossary.json")
    headwords = load(ROOT / "app" / "data" / "glossary-headwords.json")
    idx = form_index(glossary, headwords)
    rows = load(GRAM / "skills.json")
    rows = rows["skills"] if isinstance(rows, dict) else rows
    skill_rows = {s["id"]: s for s in rows}

    errors, notes, lines = [], [], []
    n_chart = n_words = n_worked = 0

    for skill_id in skills:
        skill = skill_rows.get(skill_id)
        if skill is None:
            errors.append(f"{skill_id}: not in skills.json")
            continue
        filt = skill.get("parse_filter") or {}
        try:
            lesson = load(GRAM / "lessons" / f"{skill_id}.json")
            sents = {s["id"]: s for s in load(GRAM / "sentences" / f"{skill_id}.json")["sentences"]}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill_id}: JSON invalid: {exc}")
            continue
        chart_tables = [t for t in skill.get("paradigms") or [] if t in tables]
        lines.append(f"{skill_id}  (chart tables: {', '.join(chart_tables) or 'none - no chart-capable paradigm'})")
        worked_seen = []

        for step in lesson.get("teach") or []:
            n = step.get("n")
            where = f"{skill_id} step {n}"
            check = step.get("check") or {}
            show = step.get("show") or {}

            if show.get("kind") == "paradigm":
                t = tables.get(show.get("key"))
                if t is None:
                    errors.append(f"{where}: show names unknown table {show.get('key')!r}")
                else:
                    for cell in show.get("reveal") or []:
                        if cell not in t["cells"]:
                            errors.append(f"{where}: show.reveal cell {cell!r} not in {show.get('key')!r}")

            if check.get("kind") == "chart":
                n_chart += 1
                table_id = check.get("key") or show.get("key")
                if table_id not in tables:
                    errors.append(f"{where}: chart names unknown table {table_id!r}")
                    continue
                table = tables[table_id]
                for cell in check.get("cells") or []:
                    if cell not in table["cells"]:
                        errors.append(f"{where}: cell {cell!r} not in table {table_id!r}")
                cells_txt = ", ".join(check.get("cells") or [])
                words = check.get("words")
                if words is None:
                    lines.append(f"  step {n} chart {table_id}[{cells_txt}]  words omitted -> stock {', '.join(table['stock'])}")
                else:
                    n_words += 1
                    if not words:
                        errors.append(f"{where}: words is empty; omit it to mean the stock list")
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in table["stock"]:
                            errors.append(f"{where}: {w!r} is not stock for {table_id!r} (stock: {', '.join(table['stock'])})")
                    lines.append(f"  step {n} chart {table_id}[{cells_txt}]  words {', '.join(words)}")

            worked = step.get("worked")
            if worked is None:
                continue
            n_worked += 1
            sid = worked.get("sentence")
            sent = sents.get(sid)
            if sent is None:
                errors.append(f"{where}: worked sentence {sid!r} is not in sentences/{skill_id}.json")
                continue
            focus = sent.get("focus", "")
            if not focus or focus not in sent.get("la", ""):
                errors.append(f"{where}: focus {focus!r} does not occur in {sid}")
            if sent.get("step") != n:
                notes.append(f"{where}: worked sentence {sid} is filed under step {sent.get('step')}")
            if check.get("sentence") == sid:
                notes.append(f"{where}: worked sentence {sid} is also the step's check sentence")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may only be asked, never given")
            named = [f for f in given + ask if f != "why"]
            if len(set(named)) != len(named):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            bad = [f for f in named if f not in FEATURE_SET]
            if bad:
                errors.append(f"{where}: not worked features: {bad}")
            if "construction" in named and skill.get("feature") != "construction":
                errors.append(f"{where}: 'construction' is a feature only of a construction skill (this one is {skill.get('feature')!r})")

            tokens = [t for t in focus.split() if fold(t)]
            per_token, have, outside = [], set(), []
            for tok in tokens:
                in_skill, all_r = readings_of(idx, tok, filt, skill)
                use = in_skill
                if not in_skill and all_r:
                    use = all_r
                    outside.append(tok)
                keys = [feature_keys(p, e, skill) for e, p in use]
                per_token.append(keys)
                have |= set().union(*keys) if keys else set()
            if not any(per_token):
                errors.append(f"{where}: no parse at all for focus {focus!r} ({sid})")
            elif len(outside) == len(tokens):
                # A multi-word focus (noun + participle) has one token the
                # filter is about; only when no token fits is it worth a note.
                notes.append(
                    f"{where}: {', '.join(outside)} has no reading inside parse_filter {filt}; "
                    f"checked on every reading of the form"
                )
            need = {f for f in named if f in FEATURE_SET}
            if any(per_token) and not covers(per_token, need):
                errors.append(
                    f"{where}: {focus!r} has no reading carrying {sorted(need)} "
                    f"(features it really has here: {', '.join(f for f in FEATURES if f in have) or 'none'})"
                )
            else:
                slots = "+".join(f for f in FEATURES if f in have)
                lines.append(
                    f"  step {n} worked {sid} focus {focus} [{len(tokens)} word{'s' if len(tokens) > 1 else ''}, "
                    f"carries {slots}]  given {given or '-'} ask {ask or '-'}"
                )
            worked_seen.append((n, sid, given, ask))

        if worked_seen:
            first_n, first_sid, _, first_ask = worked_seen[0]
            if first_ask:
                errors.append(f"{skill_id}: first worked example (step {first_n}, {first_sid}) asks {first_ask}; it must be shown fully")
            sizes = [len(a) for _, _, _, a in worked_seen]
            for i in range(1, len(sizes)):
                if sizes[i] <= sizes[i - 1]:
                    errors.append(f"{skill_id}: worked example {i + 1} (step {worked_seen[i][0]}) asks {sizes[i]}, not more than the {sizes[i - 1]} before it")
            if not any("why" in a for _, _, _, a in worked_seen):
                errors.append(f"{skill_id}: 'why' is never asked")
            lines.append(f"  worked examples: {len(worked_seen)}, ask sizes {sizes}")
        else:
            errors.append(f"{skill_id}: no worked examples")

    print("\n".join(lines))
    print()
    print(
        f"{len(skills)} skills - {n_chart} chart checks ({n_words} with words, "
        f"{n_chart - n_words} on the table's stock order) - {n_worked} worked examples"
    )
    if notes:
        print()
        print(f"{len(notes)} notes")
        for x in notes:
            print("  " + x)
    if errors:
        print()
        print(f"{len(errors)} PROBLEMS")
        for e in errors:
            print("  " + e)
        return 1
    print()
    print("OK - no problems")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
