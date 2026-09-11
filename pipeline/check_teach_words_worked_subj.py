#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
check_teach_words_worked_subj.py - GRAMMAR-CONTRACT.md section 8, checked over
the subjunctive / periphrastic batch of cap. XXIX-XXXII.

    set PYTHONIOENCODING=utf-8
    python pipeline/check_teach_words_worked_subj.py [skill ...]

Default skills: cum-causal, indirect-question, deliberative-subjunctive,
future-perfect, gerundive, passive-periphrastic, dative-of-agent,
perfect-subjunctive.

For every teach step of every named skill it holds that:

  1. the lesson, its sentences file and paradigms.json are valid JSON;
  2. a chart check names a table (its own `key`, else the step's `show.key`)
     that paradigms.json knows, and every cell id it lists is a cell of that
     table;
  3. every lemma in the chart's `words` is one of that table's stock words in
     paradigms.json (section 4a - the authority; a step must not invent its
     own words), none is repeated, and every named word really renders every
     listed cell when driven through pipeline/latin_forms.paradigm() - the
     rendered forms are printed so the practice set can be read;
     a chart with no `words` is reported with the stock order it falls back to;
  4. every `worked.sentence` exists in the skill's OWN sentences file (section
     8: never the library), and the sentence's `focus` occurs in its `la`;
  5. every feature in `given` / `ask` is one of the eight parse features
     (degree, tense, mood, voice, person, case, number, gender) or the literal
     "why"; "why" is asked, never given; nothing is named twice or in both;
  6. one single reading of the focus word carries every named feature at once,
     and when the skill declares a `paradigm_focus` in skills.json that reading
     agrees with it - so `vocem` is checked as the present subjunctive of vocō
     the deliberative skill means, never as the accusative of vōx. Readings
     come from the two authorities the app uses: glossary.json's own `parses`
     and the generator pipeline/latin_forms.py (held cell-for-cell identical
     to app/js/paradigms.js by tests/latin_forms/parity.py), because the
     glossary is keyed by the forms the book prints and most written-sentence
     forms are not among them;
  7. the FIRST worked example of a skill asks nothing (shown fully parsed),
     every later one asks strictly more than the one before, and "why" is
     asked at least once per skill.

Exit status 0 when everything holds.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_teach_worked as base  # noqa: E402  (loads glossary, catalogue, generator)

ROOT = base.ROOT
FEATURES = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender")

DEFAULT_SKILLS = [
    "cum-causal",
    "indirect-question",
    "deliberative-subjunctive",
    "future-perfect",
    "gerundive",
    "passive-periphrastic",
    "dative-of-agent",
    "perfect-subjunctive",
]


def load_json(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return json.load(fh)


def focus_filter(skill_row):
    """skills.json paradigm_focus -> {feature: [allowed values as str]}."""
    pf = (skill_row or {}).get("paradigm_focus") or {}
    out = {}
    for k, v in pf.items():
        if k in FEATURES:
            out[k] = [str(x) for x in (v if isinstance(v, list) else [v])]
    return out


def readings_for(form, filt):
    """(all readings, readings that agree with the skill's paradigm_focus)."""
    allr = base.readings(form)
    if not filt:
        return allr, allr
    keep = []
    for p in allr:
        ok = True
        for k, allowed in filt.items():
            if str(p.get(k)) not in allowed:
                ok = False
                break
        if ok:
            keep.append(p)
    return allr, keep


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    skills = [a for a in argv if not a.startswith("-")] or DEFAULT_SKILLS

    skills_doc = load_json("app/data/grammar/skills.json")
    rows = skills_doc["skills"] if isinstance(skills_doc, dict) else skills_doc
    by_id = {r["id"]: r for r in rows}

    errors = []
    lines = []
    totals = {"chart": 0, "chart_words": 0, "worked": 0}

    for skill in skills:
        lines.append(skill)
        try:
            lesson = load_json(f"app/data/grammar/lessons/{skill}.json")
            sents_doc = load_json(f"app/data/grammar/sentences/{skill}.json")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{skill}: JSON invalid: {exc}")
            continue
        sentences = {s["id"]: s for s in sents_doc["sentences"]}
        filt = focus_filter(by_id.get(skill))
        worked_seen = []

        for step in lesson.get("teach") or []:
            n = step.get("n")
            where = f"{skill} step {n}"
            check = step.get("check") or {}
            show = step.get("show") or {}

            # ---- chart checks and their words
            if check.get("kind") == "chart":
                totals["chart"] += 1
                key = check.get("key") or show.get("key")
                tables = base.table_of(key) if key else []
                if not tables:
                    errors.append(f"{where}: chart check names no known table ({key!r})")
                    continue
                table = tables[0]
                cells_known = set()
                for g in table["groups"]:
                    for c in g["cells"]:
                        cells_known.add(c if isinstance(c, str) else c["id"])
                stock = [s["h"] for s in table["stock"]]
                cells = list(check.get("cells") or [])
                for c in cells:
                    if c not in cells_known:
                        errors.append(f"{where}: cell {c!r} is not in table {table['id']!r}")
                words = check.get("words")
                if words is None:
                    lines.append(
                        f"  step {n} chart {table['id']}[{', '.join(cells)}]"
                        f"  words omitted -> stock order {', '.join(stock)}"
                    )
                    practise = stock
                else:
                    totals["chart_words"] += 1
                    if len(set(words)) != len(words):
                        errors.append(f"{where}: words repeats a lemma: {words}")
                    for w in words:
                        if w not in stock:
                            errors.append(
                                f"{where}: {w!r} is not a stock word of {table['id']!r} "
                                f"(stock: {', '.join(stock)})"
                            )
                    lines.append(
                        f"  step {n} chart {table['id']}[{', '.join(cells)}]  words {', '.join(words)}"
                    )
                    practise = words
                for w in practise:
                    rendered = []
                    for c in cells:
                        got = base.cell_form(w, c, tables)
                        if not got:
                            errors.append(f"{where}: {w!r} renders no cell {c!r} of {table['id']!r}")
                        else:
                            rendered.append(got[0])
                    lines.append(f"      {w:8} -> {', '.join(rendered)}")

            # ---- worked examples
            worked = step.get("worked")
            if not worked:
                continue
            totals["worked"] += 1
            sid = worked.get("sentence")
            sent = sentences.get(sid)
            if sent is None:
                errors.append(f"{where}: worked sentence {sid!r} is not in sentences/{skill}.json")
                continue
            focus = sent.get("focus") or ""
            if focus not in (sent.get("la") or ""):
                errors.append(f"{where}: focus {focus!r} does not occur in {sid}")
            given = list(worked.get("given") or [])
            ask = list(worked.get("ask") or [])
            if "why" in given:
                errors.append(f"{where}: 'why' may be asked, never given")
            named = [f for f in given + ask if f != "why"]
            bad = [f for f in named if f not in FEATURES]
            if bad:
                errors.append(f"{where}: not parse features: {bad}")
            if len(set(named)) != len(named):
                errors.append(f"{where}: a feature is named twice: given={given} ask={ask}")
            allr, keep = readings_for(focus, filt)
            need = set(f for f in named if f in FEATURES)
            fits = [p for p in keep if need <= set(k for k, v in p.items() if v is not None)]
            if not allr:
                errors.append(f"{where}: no reading at all for focus {focus!r} ({sid})")
            elif not keep:
                errors.append(f"{where}: no reading of {focus!r} agrees with paradigm_focus {filt}")
            elif not fits:
                slots = sorted({k for p in keep for k, v in p.items() if v is not None})
                errors.append(
                    f"{where}: no single reading of {focus!r} carries {sorted(need)} "
                    f"(the skill's readings carry: {', '.join(slots)})"
                )
            else:
                p = fits[0]
                desc = " ".join(f"{k}={p[k]}" for k in FEATURES if p.get(k) is not None)
                lines.append(
                    f"  step {n} worked {sid} focus {focus} [{desc}; "
                    f"{len(keep)} of {len(allr)} readings fit the skill]"
                    f"  given {given or '-'}  ask {ask or '-'}"
                )
            worked_seen.append((n, sid, given, ask))

        # ---- per-skill rules on the worked sequence
        if worked_seen:
            n1, sid1, _, ask1 = worked_seen[0]
            if ask1:
                errors.append(f"{skill}: first worked example (step {n1}, {sid1}) asks {ask1}; it must be shown fully")
            for i in range(1, len(worked_seen)):
                if len(worked_seen[i][3]) <= len(worked_seen[i - 1][3]):
                    errors.append(
                        f"{skill}: worked example at step {worked_seen[i][0]} asks "
                        f"{len(worked_seen[i][3])}, not more than the {len(worked_seen[i - 1][3])} before it"
                    )
            if not any("why" in a for _, _, _, a in worked_seen):
                errors.append(f"{skill}: 'why' is never asked")
        else:
            lines.append("  (no worked examples)")

    print("\n".join(lines))
    print()
    print(
        f"{len(skills)} skills - {totals['chart']} chart checks "
        f"({totals['chart_words']} with words, {totals['chart'] - totals['chart_words']} on stock order) "
        f"- {totals['worked']} worked examples"
    )
    if errors:
        print()
        for e in errors:
            print("FAIL", e)
        print(f"\n{len(errors)} problem(s).")
        return 1
    print("OK - every check passes")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
