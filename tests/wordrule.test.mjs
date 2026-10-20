// How a word's forms are made (2026-10-20): the type and the rule a practised table and the game open on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { wordRule } from '../app/js/wordrule.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
setGlossary(read('../app/data/glossary.json'), read('../app/data/function-words.json'));
const ruleOf = (w, pos) => { const e = lookup(w).entries.find((x) => x.pos === pos); return wordRule(e, paradigm(e, [])); };
const step = (r, head) => r.steps.find((s) => s.head === head);

test('a verb: its conjugation, its stems from its parts, and its own forms as examples', () => {
  const r = ruleOf('amō', 'V');
  assert.equal(r.type, '1st conjugation verb');
  assert.match(step(r, 'Present stem').text, /^amā- \(amāre/);
  assert.deepEqual(step(r, 'Present').eg, ['amō', 'amās', 'amat', 'amāmus', 'amātis', 'amant']);
  assert.match(step(r, 'Perfect stem').text, /^amāv- \(amāvī without -ī\)/);
  assert.match(step(r, 'Perfect passive').text, /^amātus, -a, -um/);
  assert.equal(ruleOf('regō', 'V').type, '3rd conjugation verb');
  assert.match(step(ruleOf('regō', 'V'), 'Present stem').text, /^reg- /);
  assert.equal(ruleOf('capiō', 'V').type, '3rd conjugation (-iō) verb');
  assert.equal(ruleOf('audiō', 'V').type, '4th conjugation verb');
});

test('a deponent is ruled as one: passive endings, its infinitive without -rī or -ī', () => {
  const h = ruleOf('hortor', 'V');
  assert.match(h.type, /^deponent, 1st conjugation/);
  assert.match(step(h, 'Present stem').text, /^hortā- \(hortārī, the infinitive without -rī\)/);
  assert.match(step(ruleOf('sequor', 'V'), 'Present stem').text, /^sequ- \(sequī, the infinitive without -ī\)/);
});

test('an irregular verb says so, and gives its forms', () => {
  const r = ruleOf('sum', 'V');
  assert.equal(r.type, 'irregular verb');
  assert.deepEqual(step(r, 'Irregular').eg.slice(0, 3), ['sum', 'es', 'est']);
});

test('a noun: declension and gender, the stem from the genitive, the endings case by case', () => {
  const p = ruleOf('puella', 'N');
  assert.equal(p.type, '1st declension noun, feminine');
  assert.match(step(p, 'Stem').text, /^puell- \(the genitive singular puellae without -ae\)/);
  assert.match(step(p, 'Plural').text, /gen -ārum/);
  const r = ruleOf('rēx', 'N');
  assert.match(step(r, 'Singular').text, /nom rēx, gen -is/, 'a nominative not made as stem + ending is shown whole');
  assert.ok(step(ruleOf('nōmen', 'N'), 'Neuter'));
});

test('an adjective: its kind, its stem, and its comparison', () => {
  const b = ruleOf('bonus', 'ADJ');
  assert.equal(b.type, '1st/2nd declension adjective');
  assert.match(step(b, 'Stem').text, /^bon- /);
  assert.deepEqual(step(b, 'Comparison').eg, ['melior, melius', 'optimus -a -um']);
  assert.match(ruleOf('fortis', 'ADJ').type, /^3rd declension adjective/);
});
