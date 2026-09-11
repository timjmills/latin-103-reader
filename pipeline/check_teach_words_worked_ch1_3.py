#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
check_teach_words_worked_ch1_3.py -- GRAMMAR-CONTRACT.md section 8, checked
for the eight chapter 1-3 skills (default) or any skills named on the command
line.

    set PYTHONIOENCODING=utf-8
    python pipeline/check_teach_words_worked_ch1_3.py [skill ...]

Holds, per skill, over app/data/grammar/lessons/<skill>.json:

  JSON     the lesson, its own sentences file, paradigms.json and skills.json
           parse.

  A. chart words
     * a chart check names a table (its own `key`, else the step's `show.key`)
       that paradigms.json catalogues;
     * every cell id in the check is one that table names;
     * every lemma in `words` is one of that table's stock words (section 4a
       is the authority; a step never invents its own), and none repeats;
     * a chart check with no `words` is listed with the stock order it falls
       back to, so the omission is a stated choice.

  B. worked examples
     * `worked.sentence` exists in the skill's OWN sentences file, never the
       library, and that sentence's `focus` occurs in its `la`;
     * every feature in `given` / `ask` is one the focus word really has, or
       the literal "why" (ask only). A morphological feature (case, number,
       gender, tense, mood, voice, person, degree) is proved against
       app/data/glossary.json's own `parses` for the focus form (macrons
       stripped, an enclitic -que / -ne / -ve stripped when the glossary has
       no entry for the whole form, which is what the app's lookup does), and
       ONE reading must carry all of them at once. `form` is real only when
       the focus form carries an enclitic and the skill's feature is `form`;
       `construction` only when the skill's feature is `construction` and a
       parse of the focus matches the skill's `parse_filter`;
     * `given` and `ask` do not overlap and neither repeats;
     * the first worked example of the skill asks nothing; `ask` never
       shrinks across the skill and the last asks the most; "why" is asked at
       least once per skill.

  Also reported, not counted as failures (outside section 8): a `show.reveal`
  id that the shown table does not name -- the engine matches reveal ids
  against the same cell list (lessons.js indexCatalogue), so such an id
  reveals nothing.

Exit status 0 when every check holds.
"""
from __future__ import annotations

import json
import os
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
DEFAULT = [
    "nominative-subject", "noun-gender", "adjective-agreement", "enclitics",
    "genitive-possession", "genitive-of", "accusative-object", "present-indicative-3rd",
]
MORPH = ("case", "number", "gender", "tense", "mood", "voice", "person", "degree")
ENCLITICS = ("que", "ne", "ve")


def strip(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    skills = argv or DEFAULT
    problems, notes = [], []

    glossary = load(os.path.join(DATA, "glossary.json"))
    catalogue = load(os.path.join(DATA, "grammar", "paradigms.json"))
    skills_json = load(os.path.join(DATA, "grammar", "skills.json"))
    skill_rows = skills_json["skills"] if isinstance(skills_json, dict) else skills_json
    skill_by_id = {s["id"]: s for s in skill_rows}

    tables = {}
    for part in catalogue["parts"]:
        for t in part["tables"]:
            cells = [c["id"] if isinstance(c, dict) else c for g in t["groups"] for c in g["cells"]]
            tables[t["id"]] = {"cells": set(cells), "stock": [s["h"] for s in t["stock"]]}

    def entries_for(form: str):
        """Glossary readings of a form: (entries, enclitic or None). Mirrors the app: whole form
        first; else strip -que/-ne/-ve and read the host."""
        key = strip(form)
        ents = [e for e in glossary.get(key, []) if e.get("pos") != "ENDING"]
        if ents:
            encs = {e.get("enc") for e in ents}
            return ents, (encs.pop() if len(encs) == 1 and None not in encs else None)
        for enc in ENCLITICS:
            if key.endswith(enc) and len(key) > len(enc) + 1:
                host = [e for e in glossary.get(key[: -len(enc)], []) if e.get("pos") != "ENDING" and not e.get("enc")]
                if host:
                    return host, enc
        return [], None

    def matches_filter(parse, flt):
        flts = flt if isinstance(flt, list) else [flt]
        for f in flts:
            if all(k == "enc" or parse.get(k) == v for k, v in f.items()):
                return True
        return False

    total_chart = total_words = total_worked = 0
    for sid in skills:
        skill = skill_by_id.get(sid)
        if not skill:
            problems.append(f"{sid}: not in skills.json")
            continue
        try:
            lesson = load(os.path.join(DATA, "grammar", "lessons", f"{sid}.json"))
            sent_file = load(os.path.join(DATA, "grammar", "sentences", f"{sid}.json"))
        except (OSError, ValueError) as e:
            problems.append(f"{sid}: cannot load: {e}")
            continue
        if sent_file.get("skill") != sid:
            problems.append(f"{sid}: sentences file names skill {sent_file.get('skill')!r}")
        sentences = {s["id"]: s for s in sent_file["sentences"]}
        teach = lesson.get("teach")
        if not isinstance(teach, list) or not teach:
            problems.append(f"{sid}: no teach list")
            continue
        print(sid)
        chart_n = words_n = 0
        worked_rows = []
        for st in teach:
            n = st.get("n")
            show = st.get("show") or {}
            chk = st.get("check") or {}
            # -- show.reveal (reported only)
            if show.get("kind") == "paradigm":
                t = tables.get(show.get("key"))
                if not t:
                    notes.append(f"{sid} step {n}: show.key {show.get('key')!r} is not a catalogued table")
                else:
                    bad = [c for c in show.get("reveal", []) if c not in t["cells"]]
                    if bad:
                        notes.append(f"{sid} step {n}: show.reveal ids not in table {show['key']}: {bad}")
            # -- A. chart
            if chk.get("kind") == "chart":
                chart_n += 1
                key = chk.get("key") or show.get("key")
                t = tables.get(key)
                if not t:
                    problems.append(f"{sid} step {n}: chart names no catalogued table ({key!r})")
                    continue
                cells = chk.get("cells") or []
                bad = [c for c in cells if c not in t["cells"]]
                if bad:
                    problems.append(f"{sid} step {n}: chart cells not in table {key}: {bad}")
                words = chk.get("words")
                if words is None:
                    print(f"  step {n} chart {key}[{', '.join(cells)}]  words omitted -> stock order {', '.join(t['stock'])}")
                else:
                    words_n += 1
                    if not isinstance(words, list) or not words:
                        problems.append(f"{sid} step {n}: `words` present but empty")
                    else:
                        off = [w for w in words if w not in t["stock"]]
                        if off:
                            problems.append(f"{sid} step {n}: words not in {key} stock {t['stock']}: {off}")
                        if len(set(words)) != len(words):
                            problems.append(f"{sid} step {n}: repeated word in {words}")
                        print(f"  step {n} chart {key}[{', '.join(cells)}]  words {', '.join(words)}")
            # -- B. worked
            w = st.get("worked")
            if w is None:
                continue
            given = list(w.get("given") or [])
            ask = list(w.get("ask") or [])
            s = sentences.get(w.get("sentence"))
            if not s:
                problems.append(f"{sid} step {n}: worked sentence {w.get('sentence')!r} not in {sid}.json")
                continue
            focus = s.get("focus", "")
            if focus not in s.get("la", ""):
                problems.append(f"{sid} step {n}: focus {focus!r} not in la of {s['id']}")
            if "why" in given:
                problems.append(f"{sid} step {n}: 'why' may only be asked")
            if set(given) & set(ask):
                problems.append(f"{sid} step {n}: feature in both given and ask: {sorted(set(given) & set(ask))}")
            if len(set(given)) != len(given) or len(set(ask)) != len(ask):
                problems.append(f"{sid} step {n}: repeated feature")
            feats = [f for f in given + ask if f != "why"]
            ents, enc = entries_for(focus)
            if not ents:
                problems.append(f"{sid} step {n}: no glossary reading for focus {focus!r} ({s['id']})")
                continue
            morph = [f for f in feats if f in MORPH]
            other = [f for f in feats if f not in MORPH]
            for f in other:
                if f == "form":
                    if skill.get("feature") != "form":
                        problems.append(f"{sid} step {n}: 'form' asked but the skill's feature is {skill.get('feature')!r}")
                    elif not enc:
                        problems.append(f"{sid} step {n}: 'form' asked but {focus!r} carries no enclitic")
                elif f == "construction":
                    if skill.get("feature") != "construction":
                        problems.append(f"{sid} step {n}: 'construction' asked but the skill's feature is {skill.get('feature')!r}")
                    elif not any(matches_filter(p, skill.get("parse_filter") or {}) for e in ents for p in e.get("parses", [])):
                        problems.append(f"{sid} step {n}: no parse of {focus!r} matches the skill's parse_filter {skill.get('parse_filter')}")
                else:
                    problems.append(f"{sid} step {n}: unknown feature {f!r}")
            readings = [p for e in ents for p in e.get("parses", [])]
            if skill.get("feature") == "construction" and skill.get("parse_filter"):
                fit = [p for p in readings if matches_filter(p, skill["parse_filter"])]
                readings = fit or readings
            ok = [p for p in readings if all(f in p for f in morph)]
            if morph and not ok:
                have = sorted({k for p in readings for k in p})
                problems.append(f"{sid} step {n}: no single reading of {focus!r} carries {morph} (it has: {have})")
            desc = "+".join(sorted({k for p in readings for k in p}, key=lambda k: MORPH.index(k) if k in MORPH else 9))
            extra = f", enclitic -{enc}" if enc else ""
            print(f"  step {n} worked {s['id']} focus {focus} [{ents[0].get('pos')}, {desc}{extra}]  given {given} ask {ask or '-'}")
            worked_rows.append((n, ask))
        # -- per-skill sequence rules
        if worked_rows:
            first_n, first_ask = worked_rows[0]
            if first_ask:
                problems.append(f"{sid} step {first_n}: the first worked example must ask nothing, asks {first_ask}")
            sizes = [len(a) for _, a in worked_rows]
            for (n0, a0), (n1, a1) in zip(worked_rows, worked_rows[1:]):
                if len(a1) < len(a0):
                    problems.append(f"{sid} step {n1}: ask shrinks ({a0} -> {a1})")
            if len(worked_rows) > 1 and sizes[-1] < max(sizes):
                problems.append(f"{sid}: the last worked example does not ask the most")
            if len(worked_rows) > 1 and sizes[-1] == 0:
                problems.append(f"{sid}: no later worked example asks anything")
            if not any("why" in a for _, a in worked_rows):
                problems.append(f"{sid}: 'why' is never asked")
        total_chart += chart_n
        total_words += words_n
        total_worked += len(worked_rows)

    print()
    print(f"{len(skills)} skills - {total_chart} chart checks ({total_words} with words, "
          f"{total_chart - total_words} on the table's stock order) - {total_worked} worked examples")
    if notes:
        print()
        print(f"{len(notes)} NOTES (outside section 8, not failures)")
        for x in notes:
            print("  " + x)
    print()
    if problems:
        print(f"{len(problems)} PROBLEMS")
        for x in problems:
            print("  " + x)
        return 1
    print("OK - no problems")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
