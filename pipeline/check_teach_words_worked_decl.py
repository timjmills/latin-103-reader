#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
check_teach_words_worked_decl.py - GRAMMAR-CONTRACT.md section 8, checked over
the noun / adjective / participle batch of caps. XI-XIV.

    set PYTHONIOENCODING=utf-8
    python pipeline/check_teach_words_worked_decl.py [skill ...]   # default: the eight below

Rules, per teach step of every named skill:

  JSON      the lesson, its sentences file, paradigms.json and the vocab decks
            are valid JSON.

  A. chart `words`
     A1  the chart's key resolves through paradigms.json `keys` to one table,
         or (adjcomp) to a group inside several tables;
     A2  every cell id is a cell of that table - and, when the key names a
         group, a cell of that group;
     A3  every lemma in `words` is a stock word of a resolved table, and no
         lemma repeats;
     A4  every word really renders every cell, driven through
         pipeline/latin_forms.paradigm() and the section-4a id scheme;
     A5  every word is inside the skill's cumulative chapter vocabulary
         (app/data/grammar/vocab/NN.json for some NN <= the skill's chapter) -
         decisions 3 and 6: a cell is practised on words the learner has met;
     A6  a chart with no `words` is reported with the stock list it falls
         back to, so the omission is a visible choice.

  B. `worked`
     B1  the sentence id is in the skill's OWN sentences file, and its focus
         occurs verbatim in `la`;
     B2  every feature in `given` / `ask` is one of the eight parse features
         or the literal "why", "why" only in `ask`, nothing named twice;
     B3  the focus word really has every named feature, on ONE reading that
         also satisfies the skill's own parse_filter (skills.json) - proved
         against app/data/glossary.json's parses and, for forms the library
         never prints, latin_forms.forms() over glossary-headwords.json;
     B4  given + ask cover every feature slot that intended reading carries
         (a completed example is a complete parse - nothing is left unsaid);
     B5  the first worked example of the skill asks nothing; every later one
         asks strictly more than the one before, so the last asks the most;
     B6  "why" is asked at least once per skill.

Exit status 0 when everything holds.
"""
from __future__ import annotations

import glob
import json
import os
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import latin_forms as LF  # noqa: E402

SKILLS = ["third-declension-neuter", "fourth-declension", "dative-possession",
          "comparative", "fifth-declension", "ablative-time", "superlative",
          "present-participle"]

FEATURES = ("degree", "tense", "mood", "voice", "person", "case", "number", "gender")


def fold(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().replace("v", "u").replace("j", "i").strip(".,;:!?()[]")


def load(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return json.load(fh)


# ------------------------------------------------------------------ authorities
GLOSSARY = load("app/data/glossary.json")
HEADINDEX = load("app/data/glossary-headwords.json")
CATALOGUE = load("app/data/grammar/paradigms.json")
SKILLS_DOC = load("app/data/grammar/skills.json")
SKILL_ROWS = SKILLS_DOC["skills"] if isinstance(SKILLS_DOC, dict) else SKILLS_DOC
SKILL = {s["id"]: s for s in SKILL_ROWS}

BY_FOLD = {}
for _k, _v in GLOSSARY.items():
    BY_FOLD.setdefault(fold(_k), []).extend(_v)

BY_HEADWORD = {}
for _h, _pos, _key, _i in HEADINDEX["headwords"]:
    _ents = GLOSSARY.get(_key or _h, [])
    if _i < len(_ents):
        BY_HEADWORD.setdefault(fold(_h), []).append(_ents[_i])

TABLE = {}
for _part in CATALOGUE["parts"]:
    for _t in _part["tables"]:
        TABLE[_t["id"]] = _t

VOCAB_FIRST = {}   # (folded lemma, pos) -> first chapter deck it is in
for _f in sorted(glob.glob(os.path.join(ROOT, "app", "data", "grammar", "vocab", "[0-9][0-9].json"))):
    _ch = int(os.path.basename(_f)[:2])
    for _w in load(_f)["words"]:
        VOCAB_FIRST.setdefault((fold(_w["lemma"]), _w["pos"]), _ch)

SLOT_ORDER = CATALOGUE["id_scheme"]["slot_order"]


def cell_id(key, table_kind):
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


def resolve_key(key):
    """(tables, group) for a chart key: a table id, or a skills.json key."""
    ent = CATALOGUE["keys"].get(key)
    if ent:
        return [TABLE[i] for i in ent["tables"] if i in TABLE], ent.get("group")
    return ([TABLE[key]] if key in TABLE else []), None


def cell_form(headword, cid, tables):
    """What `headword` prints in cell `cid`, on the resolved tables only."""
    want_kinds = {t["kind"] for t in tables}
    out = []
    for e in BY_HEADWORD.get(fold(headword), []):
        try:
            p = LF.paradigm(e)
        except Exception:
            continue
        if not p or p["kind"] not in want_kinds:
            continue
        for section in p["sections"]:
            for row in section["rows"]:
                for c in row["cells"]:
                    if c.get("empty") or not c.get("key"):
                        continue
                    if cell_id(c["key"], p["kind"]) == cid:
                        out.append(c.get("text"))
    return out


_GENERATED = None


def generated_index():
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
                    idx.setdefault(fold(f), []).append((e, p))
        _GENERATED = idx
    return _GENERATED


def readings(form):
    """Every (entry, parse) either authority gives `form`."""
    out, seen = [], set()

    def add(entry, parse):
        p = {k: v for k, v in parse.items() if k in FEATURES and v is not None}
        t = (entry.get("h"), entry.get("pos"), tuple(sorted((k, str(v)) for k, v in p.items())))
        if t not in seen:
            seen.add(t)
            out.append((entry, p))

    for entry in BY_FOLD.get(fold(form), []):
        for p in entry.get("parses", []):
            add(entry, p)
    for entry, p in generated_index().get(fold(form), []):
        add(entry, p)
    return out


def matches_filter(entry, parse, filt):
    for key, want in (filt or {}).items():
        want = [str(w) for w in (want if isinstance(want, list) else [want])]
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
        if got is None or str(got) not in want:
            return False
    return True


# ------------------------------------------------------------------ the check
def check(skills):
    errors, lines = [], []
    totals = {"chart": 0, "words": 0, "worked": 0}
    for skill in skills:
        lesson = load("app/data/grammar/lessons/%s.json" % skill)
        sents = load("app/data/grammar/sentences/%s.json" % skill)
        by_id = {s["id"]: s for s in sents["sentences"]}
        chapter = sents.get("chapter") or SKILL[skill].get("chapter")
        filt = SKILL[skill].get("parse_filter")
        lines.append("%s  (chapter %s, parse_filter %s)" % (skill, chapter, json.dumps(filt)))
        n_chart = n_words = 0
        worked_seen = []

        for step in lesson.get("teach", []):
            n = step.get("n")
            where = "%s step %s" % (skill, n)
            chk = step.get("check") or {}
            show = step.get("show") or {}

            if chk.get("kind") == "chart":
                n_chart += 1
                key = chk.get("key") or show.get("key")
                tables, group = resolve_key(key or "")
                if not tables:
                    errors.append("%s: chart key %r names no table (A1)" % (where, key))
                    continue
                cells = {c for t in tables for g in t["groups"]
                         if group is None or g["id"] == group for c in g["cells"]}
                stock = {}
                for t in tables:
                    for s in t["stock"]:
                        stock.setdefault(fold(s["h"]), []).append(t["id"])
                for cid in chk.get("cells", []):
                    if cid not in cells:
                        errors.append("%s: cell %r is not a cell of %s%s (A2)"
                                      % (where, cid, key, " group " + group if group else ""))
                words = chk.get("words")
                label = "%s[%s]" % (key, ", ".join(chk.get("cells", [])))
                if words is None:
                    fallback = [s["h"] for t in tables for s in t["stock"]]
                    lines.append("  step %s chart %s  words omitted -> stock %s (A6)"
                                 % (n, label, ", ".join(fallback)))
                    continue
                n_words += 1
                if not isinstance(words, list) or not words:
                    errors.append("%s: `words` must be a non-empty list (A3)" % where)
                    continue
                if len({fold(w) for w in words}) != len(words):
                    errors.append("%s: `words` repeats a lemma (A3)" % where)
                rendered = []
                for w in words:
                    if fold(w) not in stock:
                        errors.append("%s: %r is not a stock word of %s (stock: %s) (A3)"
                                      % (where, w, key, ", ".join(sorted(stock))))
                        continue
                    forms = []
                    for cid in chk.get("cells", []):
                        got = cell_form(w, cid, tables)
                        if not got:
                            errors.append("%s: %r renders no %s (A4)" % (where, w, cid))
                        else:
                            forms.append(got[0])
                    rendered.append("%s -> %s" % (w, " / ".join(forms)))
                    pos = {"noun": "N", "adjective": "ADJ", "verb": "V"}
                    kinds = {pos.get(t["kind"], t["kind"]) for t in tables}
                    first = min((VOCAB_FIRST.get((fold(w), k)) for k in kinds
                                 if VOCAB_FIRST.get((fold(w), k))), default=None)
                    if first is None:
                        errors.append("%s: %r is in no vocab deck at all (A5)" % (where, w))
                    elif first > chapter:
                        errors.append("%s: %r first appears in chapter %d, past this skill's %d (A5)"
                                      % (where, w, first, chapter))
                lines.append("  step %s chart %s  words %s" % (n, label, "; ".join(rendered)))

            wk = step.get("worked")
            if wk is None:
                continue
            sid = wk.get("sentence")
            if sid not in by_id:
                errors.append("%s: worked sentence %r is not in sentences/%s.json (B1)" % (where, sid, skill))
                continue
            sent = by_id[sid]
            focus = sent.get("focus", "")
            if focus not in sent.get("la", ""):
                errors.append("%s: focus %r is not verbatim in %s la (B1)" % (where, focus, sid))
            given = list(wk.get("given") or [])
            ask = list(wk.get("ask") or [])
            if "why" in given:
                errors.append("%s: 'why' belongs in `ask`, not `given` (B2)" % where)
            named = [f for f in given + ask if f != "why"]
            if len(set(named)) != len(named) or ask.count("why") > 1:
                errors.append("%s: a feature is named twice: given=%s ask=%s (B2)" % (where, given, ask))
            bad = [f for f in named if f not in FEATURES]
            if bad:
                errors.append("%s: not parse features: %s (B2)" % (where, bad))
            all_reads = readings(focus)
            reads = [(e, p) for e, p in all_reads if matches_filter(e, p, filt)]
            if not all_reads:
                errors.append("%s: no authority parses the focus %r (B3)" % (where, focus))
            elif not reads:
                errors.append("%s: no reading of %r satisfies parse_filter %s (B3)" % (where, focus, filt))
            else:
                need = set(named)
                fits = [(e, p) for e, p in reads if need <= set(p)]
                if not fits:
                    slots = sorted({k for _, p in reads for k in p})
                    errors.append("%s: %r has no single reading with %s (it has %s) (B3)"
                                  % (where, focus, sorted(need), "+".join(slots)))
                else:
                    slots = [k for k in FEATURES if any(k in p for _, p in fits)]
                    missing = [k for k in slots if k not in need]
                    if missing:
                        errors.append("%s: %r also has %s - neither given nor asked (B4)"
                                      % (where, focus, missing))
                    e0, p0 = fits[0]
                    lines.append("  step %s worked %s focus %s [%s %s: %s]  given %s  ask %s"
                                 % (n, sid, focus, e0.get("pos"), e0.get("h"),
                                    " ".join("%s=%s" % (k, p0[k]) for k in FEATURES if k in p0),
                                    given or "-", ask or "-"))
            worked_seen.append((n, sid, given, ask))

        if worked_seen:
            n0, s0, _, a0 = worked_seen[0]
            if a0:
                errors.append("%s: first worked example (step %s, %s) asks %s; it must be shown whole (B5)"
                              % (skill, n0, s0, a0))
            sizes = [len(a) for *_, a in worked_seen]
            for i in range(1, len(sizes)):
                if sizes[i] <= sizes[i - 1]:
                    errors.append("%s: worked example at step %s asks %d, not more than the %d before it (B5)"
                                  % (skill, worked_seen[i][0], sizes[i], sizes[i - 1]))
            if not any("why" in a for *_, a in worked_seen):
                errors.append("%s: 'why' is never asked (B6)" % skill)
        else:
            lines.append("  (no worked examples)")
        if n_chart == 0:
            lines.append("  (no chart checks - no `words` apply)")
        totals["chart"] += n_chart
        totals["words"] += n_words
        totals["worked"] += len(worked_seen)
        lines.append("  => %d chart check(s), %d with words; %d worked example(s), ask sizes %s"
                     % (n_chart, n_words, len(worked_seen), [len(a) for *_, a in worked_seen]))
    return lines, errors, totals


def main():
    skills = sys.argv[1:] or SKILLS
    lines, errors, totals = check(skills)
    print("\n".join(lines))
    print()
    if errors:
        for e in errors:
            print("FAIL", e)
        print("\n%d problem(s)." % len(errors))
        return 1
    print("OK  %d skills, %d chart checks (%d with words), %d worked examples - every rule holds."
          % (len(skills), totals["chart"], totals["words"], totals["worked"]))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
