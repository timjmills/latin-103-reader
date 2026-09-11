"""Validator for the two teach-step additions of GRAMMAR-CONTRACT.md section 8,
with the app's own morphology as the source of truth for parse features.

Contract: docs/GRAMMAR-CONTRACT.md, "## 8. Teach-step schema, completed".

The earlier check (pipeline/check_teach_words_worked.py) reads a focus word's
features out of app/data/glossary.json, which is keyed by the book's own
inflected forms only. The purpose-written teaching sentences (§1) use forms the
book never printed (profecta est, lūsūrī, discesserātis, intret …), so here the
features come from app/js/paradigms.js itself, driven from node through
tests/latin_forms/dump_js_forms.mjs: a form has a feature when a cell of its
lemma's own table carries that slot.

Checks, per skill, over app/data/grammar/lessons/<skill>.json:

  A. chart `words`
     * the lesson file is valid JSON with a `teach` list
     * every chart check names a table (its own `key`, else the step's
       `show.key`) that exists in app/data/grammar/paradigms.json
     * every cell id in a chart check is in that table's cell list
     * every lemma in `words` is in that table's `stock` list, none repeated
     * a chart check with no `words` is reported with the stock list it falls
       back to, and with the step's own `word` when that word is not stock
       (the engine cannot then drill the word the step teaches on)

  B. `worked`
     * the sentence id exists in app/data/grammar/sentences/<skill>.json
     * that sentence's `focus` occurs verbatim in its `la`
     * every feature named in `given` / `ask` is one of the eight parse
       features (degree, tense, mood, voice, person, case, number, gender) or
       the literal "why" (allowed in `ask` only); none named twice
     * every named feature is a slot that one reading of the focus form really
       carries, where the readings are the skill's own (they pass the skill's
       parse_filter, so an ambiguous form cannot lend a feature it does not
       have in this skill)
     * the first worked example of the skill asks nothing
     * `ask` grows across the skill: every later one asks more than the one
       before, so the last asks the most
     * "why" is asked at least once per skill

How a form's readings are found. The focus is split on spaces. A one-word
focus is looked up (macrons and case folded, as the glossary keys are) among
every form paradigms.js generates for the glossary headwords whose roots could
begin it. A two-word focus is a participle plus a form of sum: the participle
is read on its own (mood ptc, tense, voice, case, number, gender), and the pair
is also read as one verb form — with a finite sum, the periphrastic tense
(perf / plupf / futperf), the auxiliary's mood, person and number; with esse,
an infinitive of the participle's tense. An imperative cell carries person 2,
as the glossary's own parse of an imperative does. A gerund carries mood
(gerund) and case. A pronoun cell whose gender paradigms.js leaves null has no
gender feature.

Usage:  PYTHONIOENCODING=utf-8 python pipeline/check_teach_forms.py [skill ...]
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAM = ROOT / "app" / "data" / "grammar"
DUMP = ROOT / "tests" / "latin_forms" / "dump_js_forms.mjs"

DEFAULT_SKILLS = [
    "perfect-deponent",
    "future-participle",
    "future-infinitive",
    "pluperfect",
    "ablative-comparison",
    "deponent-imperatives",
    "gerund",
    "present-subjunctive",
]

FEATURES = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender")
TABLE_POS = {"V", "VPAR", "N", "ADJ", "PRON", "NUM"}
PERIPHRASTIC_TENSE = {"pres": "perf", "impf": "plupf", "fut": "futperf"}


def fold(s: str) -> str:
    bare = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return bare.lower().strip(".,;:!?()[]—–-")


def load(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


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


# ---------------------------------------------------------------------------
# readings from paradigms.js


def reading_of(key: dict, entry: dict) -> dict:
    """A cell key -> {feature: value} for the eight parse features."""
    kind = key.get("kind")
    r = {}
    if kind == "finite":
        r = {k: key.get(k) for k in ("tense", "mood", "voice", "person", "number")}
    elif kind == "imper":
        r = {"mood": "imper", "tense": key.get("tense") or "pres", "voice": key.get("voice"),
             "number": key.get("number"), "person": "2"}
    elif kind == "inf":
        r = {"mood": "inf", "tense": key.get("tense"), "voice": key.get("voice")}
    elif kind == "gerund":
        r = {"mood": "gerund", "case": key.get("case")}
    elif kind == "supine":
        r = {"mood": "supine", "case": key.get("case")}
    elif kind == "ptcdecl":
        r = {"mood": "ptc", "tense": key.get("tense"), "voice": key.get("voice"),
             "case": key.get("case"), "number": key.get("number"), "gender": key.get("gender")}
    elif kind == "nominal":
        r = {"case": key.get("case"), "number": key.get("number"),
             "gender": key.get("gender") or entry.get("gender"), "degree": key.get("degree")}
    elif kind in ("ptc", "gerundive"):
        return {}  # printed undeclined; the declined cells carry the features
    return {k: v for k, v in r.items() if v is not None}


def build_form_index(glossary, headwords, words: set[str]) -> dict:
    """fold(form) -> [(entry, reading)], over the headwords whose roots could begin one of `words`."""
    want = {fold(w) for w in words}
    picked = []
    seen = set()
    for h, pos, key, i in headwords["headwords"]:
        if pos not in TABLE_POS:
            continue
        entry = glossary[key or h][i]
        roots = [fold(r) for r in (entry.get("roots") or []) if r and r != "-"]
        irregular = pos in ("V", "VPAR") and (entry.get("cat") or [0])[0] == 5
        hit = pos == "PRON" or irregular or any(
            len(r) >= 2 and any(w.startswith(r) for w in want) for r in roots)
        if not hit:
            continue
        ident = (h, pos, entry.get("lemma"))
        if ident in seen:
            continue
        seen.add(ident)
        picked.append(entry)
    fd, tmp = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(picked, fh, ensure_ascii=False)
    try:
        res = subprocess.run(["node", str(DUMP), tmp], capture_output=True, text=True,
                             encoding="utf-8", check=True, cwd=str(ROOT))
    finally:
        os.unlink(tmp)
    dumped = json.loads(res.stdout)
    index: dict = {}
    for entry, table in zip(picked, dumped):
        if not table:
            continue
        for f in table["forms"]:
            reading = reading_of(f["key"], entry)
            if not reading:
                continue
            index.setdefault(fold(f["text"]), []).append((entry, reading))
    return index


def readings_of(index: dict, focus: str) -> list:
    """Every reading of a focus (one word, or participle + a form of sum)."""
    parts = focus.split()
    if len(parts) == 1:
        return list(index.get(fold(parts[0]), []))
    if len(parts) != 2:
        return []
    first, second = parts
    aux = [(e, r) for e, r in index.get(fold(second), []) if e.get("h") == "sum"]
    ptcs = [(e, r) for e, r in index.get(fold(first), []) if r.get("mood") == "ptc"]
    out = list(ptcs)
    for e, ptc in ptcs:
        for _, a in aux:
            if a.get("mood") == "inf" and a.get("tense") == "pres":
                out.append((e, {**ptc, "mood": "inf"}))
            elif a.get("mood") in ("ind", "subj") and a.get("tense") in PERIPHRASTIC_TENSE:
                out.append((e, {**ptc, "mood": a["mood"],
                                "tense": PERIPHRASTIC_TENSE[a["tense"]] if ptc.get("tense") == "perf" else ptc.get("tense"),
                                "person": a.get("person"), "number": a.get("number")}))
    return out


def passes_filter(entry: dict, reading: dict, filt) -> bool:
    for key, want in (filt or {}).items():
        wants = [str(w) for w in (want if isinstance(want, list) else [want])]
        if key == "deponent":
            got = entry.get("kind") == "dep"
            if str(got) not in wants and got is not bool(want):
                return False
            continue
        if key == "pos":
            got = entry.get("pos")
        elif key == "h":
            got = entry.get("h")
        elif key in ("decl", "conj"):
            cat = entry.get("cat") or []
            got = cat[0] if key == "decl" and cat else (cat[1] if len(cat) > 1 else None)
        else:
            got = reading.get(key)
        if got is None or str(got) not in wants:
            return False
    return True


# ---------------------------------------------------------------------------


def main(argv):
    skills = [a for a in argv if not a.startswith("-")] or DEFAULT_SKILLS
    tables = paradigm_index(load(GRAM / "paradigms.json"))
    glossary = load(ROOT / "app" / "data" / "glossary.json")
    headwords = load(ROOT / "app" / "data" / "glossary-headwords.json")
    skills_doc = load(GRAM / "skills.json")
    rows = skills_doc["skills"] if isinstance(skills_doc, dict) else skills_doc
    filters = {s["id"]: s.get("parse_filter") for s in rows}

    errors: list[str] = []
    lines: list[str] = []
    n_chart = n_words = n_worked = 0

    # pass 1: load, and gather every focus word that needs a reading
    loaded = {}
    focus_words: set[str] = set()
    for skill in skills:
        try:
            lesson = load(GRAM / "lessons" / f"{skill}.json")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: lesson JSON invalid: {exc}")
            continue
        try:
            sentences = {s["id"]: s for s in load(GRAM / "sentences" / f"{skill}.json")["sentences"]}
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: sentences JSON invalid: {exc}")
            continue
        loaded[skill] = (lesson, sentences)
        for step in lesson.get("teach") or []:
            sid = (step.get("worked") or {}).get("sentence")
            if sid in sentences:
                focus_words.update(sentences[sid].get("focus", "").split())
    index = build_form_index(glossary, headwords, focus_words)

    for skill in skills:
        if skill not in loaded:
            continue
        lesson, sentences = loaded[skill]
        filt = filters.get(skill)
        lines.append(skill)
        worked_seen = []
        for step in lesson.get("teach") or []:
            n = step.get("n")
            where = f"{skill} step {n}"
            check = step.get("check") or {}
            show = step.get("show") or {}

            # ---- A
            if check.get("kind") == "chart":
                n_chart += 1
                table_id = check.get("key") or show.get("key")
                if table_id not in tables:
                    errors.append(f"{where}: chart check names no known table (got {table_id!r})")
                    continue
                table = tables[table_id]
                cells = check.get("cells") or []
                for cell in cells:
                    if cell not in table["cells"]:
                        errors.append(f"{where}: cell {cell!r} is not in table {table_id!r}")
                words = check.get("words")
                own = check.get("word") or show.get("word")
                own_note = ""
                if own and fold(own) not in table["stock"]:
                    own_note = f"  (step's own word {own} is not stock)"
                if words is None:
                    lines.append(f"  step {n} chart {table_id}[{', '.join(cells)}]"
                                 f"  words omitted -> stock {', '.join(table['stock'])}{own_note}")
                else:
                    n_words += 1
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in table["stock"]:
                            errors.append(f"{where}: {w!r} is not stock for {table_id!r} "
                                          f"(stock: {', '.join(table['stock'])})")
                    lines.append(f"  step {n} chart {table_id}[{', '.join(cells)}]"
                                 f"  words {', '.join(words)}{own_note}")

            # ---- B
            worked = step.get("worked")
            if worked is None:
                continue
            n_worked += 1
            sid = worked.get("sentence")
            sent = sentences.get(sid)
            if sent is None:
                errors.append(f"{where}: worked sentence {sid!r} is not in sentences/{skill}.json")
                continue
            focus = sent.get("focus", "")
            if focus not in sent.get("la", ""):
                errors.append(f"{where}: focus {focus!r} does not occur in {sid}")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may only be asked, never given")
            named = [f for f in given + ask if f != "why"]
            if len(set(named)) != len(named):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            bad = [f for f in named if f not in FEATURES]
            if bad:
                errors.append(f"{where}: not parse features: {bad}")
            all_readings = readings_of(index, focus)
            readings = [(e, r) for e, r in all_readings if passes_filter(e, r, filt)]
            if not all_readings:
                errors.append(f"{where}: paradigms.js generates no reading of focus {focus!r} ({sid})")
            elif not readings:
                errors.append(f"{where}: no reading of {focus!r} passes the skill's parse_filter {filt}")
            else:
                slots = [k for k in FEATURES if any(k in r for _, r in readings)]
                need = set(named)
                fits = [(e, r) for e, r in readings if need <= set(r)]
                if named and not fits:
                    errors.append(f"{where}: {focus!r} has no reading carrying {sorted(need)} "
                                  f"(slots it really has here: {', '.join(slots) or 'none'})")
                else:
                    e, r = (fits or readings)[0]
                    lemma = e.get("h")
                    lines.append(f"  step {n} worked {sid} focus {focus} [{lemma}: "
                                 f"{'+'.join(slots)}; {len(readings)} of {len(all_readings)} readings in this skill]"
                                 f"  given {given or '-'} ask {ask or '-'}")
            worked_seen.append((n, sid, given, ask))

        if worked_seen:
            first_n, first_sid, _, first_ask = worked_seen[0]
            if first_ask:
                errors.append(f"{skill}: the first worked example (step {first_n}, {first_sid}) "
                              f"asks {first_ask}; it must be shown fully")
            sizes = [len(a) for _, _, _, a in worked_seen]
            for i in range(1, len(sizes)):
                if sizes[i] <= sizes[i - 1]:
                    errors.append(f"{skill}: worked example {i + 1} (step {worked_seen[i][0]}) asks "
                                  f"{sizes[i]}, not more than the {sizes[i - 1]} before it")
            if not any("why" in a for _, _, _, a in worked_seen):
                errors.append(f"{skill}: 'why' is never asked")
        else:
            lines.append("  (no worked examples)")

    print("\n".join(lines))
    print()
    print(f"{len(skills)} skills - {n_chart} chart checks ({n_words} with words, "
          f"{n_chart - n_words} on the table's stock order) - {n_worked} worked examples")
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
