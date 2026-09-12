"""Validate grammar question sets: app/data/grammar/questions/NN.json.

Usage: python pipeline/validate_questions.py app/data/grammar/questions/25.json ...
Checks: JSON shape (docs/GRAMMAR-CONTRACT.md "Question sets"), unit ids exist in
data/build (the weeks and the review shelf alike), tap answers are words of the
unit sentence, choice items have 4 unique choices containing an answer, >= 24
items, >= 8 question words, ids unique and sequential (qNN-KK).

Answers and choices are span references into the private text, not the book's
words (pipeline/latin_text.py); they are resolved against the item's sentence
before any of the above is measured.
"""
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from latin_text import resolve_ref  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The fourteen canonical question words plus the case-forms of quis/quī the
# contract allows, exactly as pipeline/check_questions.py has them — without
# them 64 shipped items read as "bad qword".
QWORDS = {'quis', 'quid', 'cūr', 'ubi', 'quō', 'unde', 'quandō', 'quōmodo',
          'quot', 'quālis', 'uter', 'num', 'nōnne', '-ne',
          'quem', 'cui', 'cuius', 'quae', 'quod', 'quī', 'quibus'}
WORD = re.compile(r"[A-Za-zĀĒĪŌŪȲāēīōūȳ]+")


def load_units():
    """Every unit in data/build, keyed by id — chapters 1-24 cite review-NN.json."""
    units = {}
    for f in glob.glob(os.path.join(ROOT, 'data', 'build', '*.json')):
        try:
            d = json.load(open(f, encoding='utf-8'))
        except (ValueError, UnicodeDecodeError):
            continue
        if not isinstance(d, dict) or 'units' not in d:
            continue
        for u in d['units']:
            units.setdefault(u['id'], u)
    return units


def resolved(la, refs):
    """A list of answers/choices as the text they stand for; None where one cannot be."""
    return [resolve_ref(la, r) for r in refs or []]


def check(path, units):
    d = json.load(open(path, encoding='utf-8'))
    ch, items, errs = d['chapter'], d['items'], []
    for k in ('chapter', 'week_id', 'title', 'items'):
        if k not in d:
            errs.append(f'missing top-level {k}')
    ids = [i['id'] for i in items]
    if len(set(ids)) != len(ids):
        errs.append('duplicate ids')
    for n, i in enumerate(items, 1):
        exp = f'q{ch:02d}-{n:02d}'
        if i['id'] != exp:
            errs.append(f"{i['id']}: expected id {exp}")
        for k in ('qword', 'q', 'en', 'unit_id', 'answers', 'input', 'hint'):
            if k not in i:
                errs.append(f"{i['id']}: missing {k}")
        if i.get('qword') not in QWORDS:
            errs.append(f"{i['id']}: bad qword {i.get('qword')}")
        if not i.get('answers'):
            errs.append(f"{i['id']}: no answers")
        if not i.get('q', '').endswith('?'):
            errs.append(f"{i['id']}: q lacks ?")
        if i.get('part') not in (None, 'FS', 'FL'):
            errs.append(f"{i['id']}: bad part {i.get('part')}")
        u = units.get(i.get('unit_id'))
        if not u:
            errs.append(f"{i['id']}: unit {i.get('unit_id')} missing")
            continue
        answers = resolved(u['la'], i['answers'])
        if None in answers:
            errs.append(f"{i['id']}: an answer does not resolve against: {u['la']}")
            continue
        if i['input'] == 'tap':
            ws = set(WORD.findall(u['la']))
            if not any(a in ws for a in answers):
                errs.append(f"{i['id']}: tap answers {answers} not a word of: {u['la']}")
        elif i['input'] == 'choice':
            c = resolved(u['la'], i.get('choices', []))
            if None in c:
                errs.append(f"{i['id']}: a choice does not resolve against: {u['la']}")
                continue
            if len(c) != 4:
                errs.append(f"{i['id']}: choice needs exactly 4 choices")
            if not any(a in c for a in answers):
                errs.append(f"{i['id']}: no answer among choices")
            if len(set(c)) != len(c):
                errs.append(f"{i['id']}: duplicate choices")
        elif i['input'] != 'type':
            errs.append(f"{i['id']}: bad input {i['input']}")
    qws = collections.Counter(i['qword'] for i in items)
    inp = collections.Counter(i['input'] for i in items)
    parts = collections.Counter(i.get('part', 'FR') for i in items)
    if len(items) < 24:
        errs.append('fewer than 24 items')
    if len(qws) < 8:
        errs.append('fewer than 8 question words')
    print(f"ch {ch} ({d.get('week_id')}, {d.get('title')}): {len(items)} items; "
          f"{len(qws)} qwords {dict(qws)}; inputs {dict(inp)}; parts {dict(parts)}")
    for e in errs:
        print('  ERR', e)
    return not errs


if __name__ == '__main__':
    units = load_units()
    ok = all([check(p, units) for p in sys.argv[1:]])
    sys.exit(0 if ok else 1)
