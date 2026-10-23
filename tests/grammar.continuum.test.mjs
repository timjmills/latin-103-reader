// The path (2026-10-23): every skill and table from the easiest to the hardest, with "too hard / too easy".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPath, climbFrom } from '../app/js/grammar/continuum.js';

const { skills } = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const path = buildPath(skills);
const by = new Map(skills.map((s) => [s.id, s]));

test('every skill is on the path once, and every table once', () => {
  assert.equal(path.order.length, skills.length);
  assert.equal(new Set(path.order).size, skills.length);
  const tables = new Set(skills.flatMap((s) => s.paradigms ?? []));
  const onPath = path.steps.filter((s) => s.kind === 'table').map((s) => s.id);
  assert.equal(onPath.length, tables.size);
  assert.deepEqual(new Set(onPath), tables);
});

test('a skill comes after everything it builds on', () => {
  for (const s of skills) for (const p of s.prereqs ?? []) assert.ok(path.of(p) < path.of(s.id), `${p} before ${s.id}`);
});

test('a table comes after its first skill', () => {
  for (const [i, st] of path.steps.entries()) {
    if (st.kind !== 'table') continue;
    assert.ok(path.index.get(`skill:${st.after}`) < i, `${st.id} after ${st.after}`);
    assert.ok(by.get(st.after).paradigms.includes(st.id));
  }
});

test('the path starts at the root and the chapters never go backwards', () => {
  assert.equal(path.order[0], 'nominative-subject');
  for (let i = 1; i < path.order.length; i++) assert.ok(by.get(path.order[i - 1]).chapter <= by.get(path.order[i]).chapter);
});

test('too hard goes to what it builds on; too easy to what builds on it', () => {
  for (const s of skills) {
    const e = path.easier(s.id);
    const h = path.harder(s.id);
    if (s.prereqs?.length) assert.deepEqual(new Set(e), new Set(s.prereqs));
    else if (path.of(s.id) > 0) assert.deepEqual(e, [path.prev(s.id)]);
    for (const x of h) assert.ok(path.of(x) > path.of(s.id), `${x} is harder than ${s.id}`);
    for (const x of e) assert.ok(path.of(x) < path.of(s.id), `${x} is easier than ${s.id}`);
  }
  // Only the very last skill has nowhere harder to go; only the first nowhere easier.
  const noHarder = skills.filter((s) => !path.harder(s.id).length).map((s) => s.id);
  assert.deepEqual(noHarder, [path.order[path.order.length - 1]]);
  assert.deepEqual(skills.filter((s) => !path.easier(s.id).length).map((s) => s.id), ['nominative-subject']);
});

test('climbing takes the next ones still to learn', () => {
  const known = new Set(path.order.slice(0, 3));
  assert.deepEqual(climbFrom(path, null, (id) => !known.has(id), 2), path.order.slice(3, 5));
  assert.deepEqual(climbFrom(path, path.order[10], () => true, 1), [path.order[10]]);
});

test('a skill unknown to the path has no neighbours', () => {
  assert.deepEqual(path.easier('nope'), []);
  assert.deepEqual(path.harder('nope'), []);
  assert.equal(path.of('nope'), -1);
});
