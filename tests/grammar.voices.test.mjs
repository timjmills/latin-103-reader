import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withPassive, bothVoices, passiveNote } from '../app/js/grammar/voices.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const skills = new Map((Array.isArray(raw) ? raw : raw.skills).map((s) => [s.id, s]));
const lesson = (id) => JSON.parse(readFileSync(new URL(`../app/data/grammar/lessons/${id}.json`, import.meta.url), 'utf8'));
const stepsOf = (l) => (Array.isArray(l.teach) ? l.teach : l.teach.steps);

test('which skills are both voices’: a tense or mood and no voice', () => {
  for (const id of ['future-perfect', 'pluperfect', 'present-subjunctive', 'imperfect-subjunctive', 'perfect-subjunctive', 'pluperfect-subjunctive']) assert.ok(bothVoices(skills.get(id)), id);
  for (const id of ['perfect-active', 'future-active', 'imperfect-passive', 'passive-voice', 'principal-parts', 'ablative-place']) assert.ok(!bothVoices(skills.get(id)), id);
});

test('every active box gets its passive below it, as many of one as of the other, with how the passive is made', () => {
  const l = lesson('future-perfect');
  const out = withPassive(skills.get('future-perfect'), l);
  const s = stepsOf(out)[1];
  assert.deepEqual(s.check.cells, ['futperf.ind.act.1.sg', 'futperf.ind.act.2.sg', 'futperf.ind.act.3.sg', 'futperf.ind.pass.1.sg', 'futperf.ind.pass.2.sg', 'futperf.ind.pass.3.sg']);
  assert.deepEqual(s.show.reveal.slice(3), ['futperf.ind.pass.1.sg', 'futperf.ind.pass.2.sg', 'futperf.ind.pass.3.sg']);
  assert.match(s.passive, /perfect participle .* erō, eris, erit/);
  assert.equal(stepsOf(l)[1].check.cells.length, 3, 'the lesson read from disk is untouched');
});

test('a page that already asks a passive is not asked it twice; a skill of one voice is left alone', () => {
  const out = withPassive(skills.get('imperfect-subjunctive'), lesson('imperfect-subjunctive'));
  const third = stepsOf(out)[3];
  assert.deepEqual(third.check.cells, ['impf.subj.pass.3.sg', 'impf.subj.pass.3.pl']);
  const l = lesson('perfect-active');
  assert.equal(withPassive(skills.get('perfect-active'), l), l);
});

test('passiveNote: the helping verb for each tense, the endings for the rest', () => {
  assert.match(passiveNote('plupf.ind.act.1.sg'), /eram/);
  assert.match(passiveNote('perf.subj.act.1.sg'), /sim, sīs/);
  assert.match(passiveNote('impf.subj.act.1.sg'), /infinitive\) \+ -r, -ris/);
  assert.equal(passiveNote('nom.sg'), '');
});
