"""Validate grammar question sets: app/data/grammar/questions/NN.json.

Usage: python pipeline/validate_questions.py app/data/grammar/questions/25.json ...
Checks: JSON shape (docs/GRAMMAR-CONTRACT.md "Question sets"), unit ids exist in
data/build/week-*.json, tap answers are words of the unit sentence, choice items
have 4 unique choices containing an answer, >= 24 items, >= 8 question words,
ids unique and sequential (qNN-KK).
"""
import collections
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QWORDS = {'quis', 'quid', 'cūr', 'ubi', 'quō', 'unde', 'quandō', 'quōmodo',
          'quot', 'quālis', 'uter', 'num', 'nōnne', '-ne'}
WORD = re.compile(r"[A-Za-zĀĒĪŌŪȲāēīōūȳ]+")


def load_units():
    units = {}
    for f in glob.glob(os.path.join(ROOT, 'data', 'build', 'week-*.json')):
        d = json.load(open(f, encoding='utf-8'))
        for u in d['units']:
            units[u['id']] = u
    return units


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
        if i['input'] == 'tap':
            ws = set(WORD.findall(u['la']))
            if not any(a in ws for a in i['answers']):
                errs.append(f"{i['id']}: tap answers {i['answers']} not a word of: {u['la']}")
        elif i['input'] == 'choice':
            c = i.get('choices', [])
            if len(c) != 4:
                errs.append(f"{i['id']}: choice needs exactly 4 choices")
            if not any(a in c for a in i['answers']):
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
