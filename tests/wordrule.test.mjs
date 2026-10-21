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

test('a skill\'s rule says how each type makes its forms', async () => {
  const { readFileSync } = await import('node:fs');
  const { setGlossary, lookup } = await import('../app/js/dictionary.js');
  const { paradigm } = await import('../app/js/paradigms.js');
  const { wordRule, focusRule } = await import('../app/js/wordrule.js');
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
  setGlossary(read('../app/data/glossary.json'), read('../app/data/function-words.json'));
  const data = read('../app/data/grammar/skills.json');
  const skills = Array.isArray(data) ? data : data.skills;
  const rule = (w, id) => { const e = lookup(w).entries[0]; return focusRule(wordRule(e, paradigm(e, [])), skills.find((s) => s.id === id)); };
  const say = (r) => r.steps.map((s) => `${s.head}: ${s.text}`).join(' | ');
  // The present subjunctive: an a-verb's vowel becomes e, the others add -a-.
  assert.match(say(rule('amat', 'present-subjunctive')), /ā becomes e/);
  assert.match(say(rule('monet', 'present-subjunctive')), /-am, -ās, -at/);
  assert.ok(!/Imperfect/.test(say(rule('amat', 'present-subjunctive'))), 'only the tense the skill is about');
  // The imperfect: 1st and 2nd keep their vowel and add -bam; 3rd adds -ēbam.
  assert.match(say(rule('amat', 'imperfect-active')), /Stem \+ -bam/);
  assert.match(say(rule('regit', 'imperfect-active')), /-ēbam/);
  // The imperfect subjunctive is the infinitive + the endings, said with this verb's own infinitive.
  assert.match(say(rule('regit', 'imperfect-subjunctive')), /The infinitive regere \+ -m/);
  // A passive skill on an ordinary verb: the passive endings and the tense's own sign, not the active endings.
  const ip = say(rule('regit', 'imperfect-passive'));
  assert.match(ip, /-ēbam/);
  assert.match(ip, /-r, -ris, -tur/);
  assert.ok(!/Add -ō, -is/.test(ip));
  // The perfect and pluperfect subjunctive: the perfect stem's -erim / -issem, the participle + sim / essem.
  const ps = say(rule('regit', 'perfect-subjunctive'));
  assert.match(ps, /rēx- \+ -erim/);
  assert.match(ps, /rēctus, -a, -um.* \+ sim/);
  assert.ok(!/ā becomes e|-ēbam|Perfect -ī, -istī/.test(ps), 'not the present’s or the indicative’s steps');
  assert.match(say(rule('amat', 'pluperfect-subjunctive')), /amāvisse \+ -m/);
  assert.match(say(rule('hortatur', 'perfect-subjunctive')), /hortātus, -a, -um \+ sim/);
  // A deponent's imperfect subjunctive names the stem it adds -rer to.
  assert.match(say(rule('hortatur', 'imperfect-subjunctive')), /Present stem: hortā-/);
});
