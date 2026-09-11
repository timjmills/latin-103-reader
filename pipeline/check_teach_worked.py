#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
check_teach_worked.py — the two GRAMMAR-CONTRACT.md §8 additions, checked.

    set PYTHONIOENCODING=utf-8
    python pipeline/check_teach_worked.py [skill ...]     # default: the eight below

For every teach step of every named skill it holds that:

  1. the lesson, its sentences file and paradigms.json are valid JSON;
  2. every lemma in a chart check's `words` is one of that table's stock words
     in app/data/grammar/paradigms.json (§4a — the authority; a step must not
     invent its own words), spelled exactly as the stock `h` headword the
     engine matches (lessons.js: `words: [headword]`, ASCII, as the other
     98 chart checks and KEY_MODELS spell it — `scribo`, not `scrībō`);
  3. every cell id in a chart check is a cell that table really names, and
     every word named for it really renders that cell (driven through
     latin_forms.paradigm() and the §4a id scheme);
  4. every `worked.sentence` exists in the skill's OWN sentences file (§8:
     "never from the library");
  5. every feature in `given` / `ask` is a parse feature the sentence's focus
     word really carries — proved against the two authorities the app itself
     uses, app/data/glossary.json's own `parses` and pipeline/latin_forms.py
     (which tests/latin_forms/parity.py holds cell-for-cell identical to
     app/js/paradigms.js) — or the literal "why"; a two-word periphrastic (participle +
     a form of sum) is read by composing the participle's own readings with the
     sum form's, since the table prints only its naming form; and one single reading of
     the word carries all of them at once, so a worked example never mixes two
     parses of an ambiguous form;
  6. `given` and `ask` do not overlap, and "why" is asked, never given;
  7. the FIRST worked example of a skill asks nothing (§8: "shown fully
     parsed"), every later one asks something, `ask` grows strictly across the
     skill so the last asks the most, and "why" is asked at least once per skill.

Exit status 0 when everything holds.
"""
from __future__ import annotations

import json
import os
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import latin_forms as LF                                    # noqa: E402

SKILLS = ["wishes-utinam", "pluperfect-subjunctive", "conditions-contrary-to-fact",
          "future-imperative", "dative-verbs", "dummodo", "elegiac-couplet",
          "prosody-scansion"]

FEATURES = ("case", "gender", "number", "tense", "mood", "voice", "person", "degree")


def fold(s):
    """The spelling the glossary is keyed by: no macrons, lower case, u for v."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().replace("v", "u").replace("j", "i")


def load(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------- authorities
GLOSSARY = load("app/data/glossary.json")
HEADINDEX = load("app/data/glossary-headwords.json")
CATALOGUE = load("app/data/grammar/paradigms.json")

BY_FOLD = {}
for _k, _v in GLOSSARY.items():
    BY_FOLD.setdefault(fold(_k), []).extend(_v)

BY_HEADWORD = {}
for _h, _pos, _key, _i in HEADINDEX["headwords"]:
    _ents = GLOSSARY.get(_key or _h, [])
    if _i < len(_ents):
        BY_HEADWORD.setdefault(_h, []).append(_ents[_i])

BY_HEADWORD_FOLDED = {}
for _h, _entries in BY_HEADWORD.items():
    BY_HEADWORD_FOLDED.setdefault(fold(_h), []).extend(_entries)

TABLE = {}
for _part in CATALOGUE["parts"]:
    for _t in _part["tables"]:
        TABLE[_t["id"]] = _t


def table_of(key):
    """The catalogue table(s) a teach step's paradigm key names."""
    ids = CATALOGUE["keys"].get(key, {}).get("tables") or [key]
    return [TABLE[i] for i in ids if i in TABLE]


_GENERATED = None


def generated_index():
    """form (folded) -> its parses, over every headword the library holds.

    Built by driving pipeline/latin_forms.py itself, so nothing here
    re-implements the morphology; it is the generator's own answer."""
    global _GENERATED
    if _GENERATED is None:
        idx = {}
        for entries in BY_HEADWORD.values():
            for e in entries:
                try:
                    generated = LF.forms(e, include_multiword=True)
                except Exception:
                    continue
                for f, p in generated:
                    idx.setdefault(fold(f), []).append(p)
        _GENERATED = idx
    return _GENERATED


SLOT_ORDER = CATALOGUE["id_scheme"]["slot_order"]
KIND_PREFIX = set(CATALOGUE["id_scheme"]["kind_prefix"])


def cell_id(key, table_kind):
    """The catalogue id of one paradigm cell, from its own key (§4a)."""
    if key.get("kind") == "gerundive":
        return "gerundive"
    slots = {s: key.get(s) for s in SLOT_ORDER}
    if key.get("kind") == "nominal" and table_kind == "noun":
        slots["gender"] = None
    if key.get("kind") == "imper" and not slots["tense"]:
        slots["tense"] = "pres"
    body = [str(slots[s]) for s in SLOT_ORDER if slots[s]]
    if key.get("kind") in ("nominal", "finite"):
        return ".".join(body)
    return ".".join([key["kind"]] + body)


def cell_form(headword, cid, tables=None):
    """What `headword` prints in cell `cid` — [] when it renders no such cell."""
    out = []
    for e in BY_HEADWORD_FOLDED.get(fold(headword), []):
        try:
            p = LF.paradigm(e)
        except Exception:
            continue
        if not p:
            continue
        for section in p["sections"]:
            for row in section["rows"]:
                for c in row["cells"]:
                    if c.get("empty") or not c.get("key"):
                        continue
                    if cell_id(c["key"], p["kind"]) == cid:
                        out.append(c.get("text"))
    return out


def readings(form):
    """Every parse either authority gives `form`, anywhere in the library."""
    out, seen = [], set()

    def add(parse):
        p = {k: v for k, v in parse.items() if k in FEATURES}
        t = tuple(sorted((k, str(v)) for k, v in p.items()))
        if t not in seen:
            seen.add(t)
            out.append(p)

    for entry in BY_FOLD.get(fold(form), []):
        for p in entry.get("parses", []):
            add(p)
    for p in generated_index().get(fold(form), []):
        add(p)
    for p in periphrastic_readings(form):
        add(p)
    return out


# A two-word periphrastic — a participle with a form of `sum` after it — is one
# verb form whose first word agrees with its subject. The table prints only its
# naming form (`scrīptūrus esse`, `profectus est`), so the agreeing forms a
# sentence really shows (`scrīptūrum esse` after an accusative subject,
# `profecta est` of a woman) are reached by composing the participle's own
# readings with the `sum` form's, which is how the app's scanner reads them too.
PERIPHRASTIC_TENSE = {"pres": "perf", "impf": "plupf", "fut": "futperf"}


def periphrastic_readings(form):
    words = form.split()
    if len(words) != 2:
        return []
    first, second = words
    parts = [p for p in readings(first) if p.get("mood") == "ptc"]
    if not parts:
        return []
    out = []
    for aux in readings(second):
        if aux.get("mood") == "inf" and aux.get("tense") == "pres" and aux.get("voice") == "act":
            # participle + esse: the future (or perfect passive) infinitive, agreeing
            for p in parts:
                out.append({"mood": "inf", "tense": p.get("tense"), "voice": p.get("voice"),
                            "case": p.get("case"), "number": p.get("number"), "gender": p.get("gender")})
        elif aux.get("mood") in ("ind", "subj") and aux.get("voice") == "act" and aux.get("tense") in PERIPHRASTIC_TENSE:
            # perfect participle + a finite sum: the perfect-system passive, agreeing
            for p in parts:
                if p.get("tense") != "perf" or p.get("case") != "nom" or p.get("number") != aux.get("number"):
                    continue
                out.append({"tense": PERIPHRASTIC_TENSE[aux["tense"]], "mood": aux["mood"], "voice": "pass",
                            "person": aux.get("person"), "number": aux.get("number"), "gender": p.get("gender")})
    return out


def check(skills):
    errors, report = [], []
    for skill in skills:
        lesson = load("app/data/grammar/lessons/%s.json" % skill)
        sents = load("app/data/grammar/sentences/%s.json" % skill)
        by_id = {s["id"]: s for s in sents["sentences"]}
        charts = workeds = 0
        prev_ask = None
        asked_why = False
        first = True
        for step in lesson.get("teach", []):
            where = "%s step %s" % (skill, step["n"])
            chk = step.get("check") or {}

            # (2) + (3) the chart check
            if chk.get("kind") == "chart":
                tables = table_of(chk.get("key", ""))
                if not tables:
                    errors.append("%s: chart key %r names no table" % (where, chk.get("key")))
                else:
                    cells = {c for t in tables for g in t["groups"] for c in g["cells"]}
                    stock = [s["h"] for t in tables for s in t["stock"]]
                    by_fold = {fold(h): h for h in stock}
                    for cid in chk.get("cells", []):
                        if cid not in cells:
                            errors.append("%s: cell %r is not a cell of %s"
                                          % (where, cid, chk.get("key")))
                    words = chk.get("words")
                    if words is not None:
                        charts += 1
                        if not isinstance(words, list) or not words:
                            errors.append("%s: `words` must be a non-empty list" % where)
                        for w in words or []:
                            if w not in stock:
                                if fold(w) in by_fold:
                                    errors.append("%s: %r is spelled with macrons; the engine "
                                                  "matches the stock headword %r exactly"
                                                  % (where, w, by_fold[fold(w)]))
                                else:
                                    errors.append("%s: %r is not a stock word of %s (stock: %s)"
                                                  % (where, w, chk.get("key"), ", ".join(stock)))
                                continue
                            for cid in chk.get("cells", []):
                                if not cell_form(fold(w), cid, tables):
                                    errors.append("%s: %r renders no %s"
                                                  % (where, w, cid))
                        if len({fold(w) for w in words or []}) != len(words or []):
                            errors.append("%s: `words` repeats a lemma" % where)

            # (4)-(7) the worked example
            wk = step.get("worked")
            if wk is None:
                continue
            workeds += 1
            sid = wk.get("sentence")
            if sid not in by_id:
                errors.append("%s: worked sentence %r is not in %s.json" % (where, sid, skill))
                continue
            focus = by_id[sid].get("focus")
            given = list(wk.get("given") or [])
            ask = list(wk.get("ask") or [])
            if set(given) & set(ask):
                errors.append("%s: %s is both given and asked"
                              % (where, sorted(set(given) & set(ask))))
            if "why" in given:
                errors.append("%s: 'why' belongs in `ask`, not `given`" % where)
            asked_why = asked_why or "why" in ask
            named = [f for f in given + ask if f != "why"]
            reads = readings(focus)
            if not reads:
                errors.append("%s: no authority parses the focus word %r" % (where, focus))
            else:
                bad = [f for f in named if not any(f in r for r in reads)]
                if bad:
                    errors.append("%s: %r has no feature %s" % (where, focus, bad))
                elif not any(all(f in r for f in named) for r in reads):
                    errors.append("%s: no single reading of %r carries %s"
                                  % (where, focus, named))
            if first:
                if ask:
                    errors.append("%s: the first worked example of %s must ask nothing"
                                  % (where, skill))
                first = False
            else:
                if not ask:
                    errors.append("%s: a later worked example must ask something" % where)
                if prev_ask is not None and len(ask) <= prev_ask:
                    errors.append("%s: `ask` must grow across the skill (%d -> %d)"
                                  % (where, prev_ask, len(ask)))
            prev_ask = len(ask)
        if workeds and not asked_why:
            errors.append("%s: no worked example asks 'why'" % skill)
        report.append((skill, charts, workeds))
    return report, errors


def main():
    skills = sys.argv[1:] or SKILLS
    report, errors = check(skills)
    width = max(len(s) for s, _, _ in report)
    for skill, charts, workeds in report:
        print("  %-*s  %d chart check(s) with words   %d worked example(s)"
              % (width, skill, charts, workeds))
    print()
    if errors:
        for e in errors:
            print("FAIL", e)
        print("\n%d problem(s)." % len(errors))
        return 1
    print("OK  %d skills, %d chart checks, %d worked examples - every check passes."
          % (len(report), sum(c for _, c, _ in report), sum(w for _, _, w in report)))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
