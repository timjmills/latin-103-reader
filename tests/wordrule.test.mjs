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

test('a card reads its parts past an enclitic and a bracketed note, and follows a one-number noun', () => {
  const byLemma = (w, lemma) => { const e = lookup(w).entries.find((x) => x.lemma === lemma); assert.ok(e, lemma); return wordRule(e, paradigm(e, [])); };
  // dāve = dā + -ve: the card is dō's, without the "+ -ue"
  const dave = byLemma('dave', 'dō, dare, dedī, datum + -ue');
  assert.equal(dave.parts, 'dō, dare, dedī, datum');
  assert.match(step(dave, 'Perfect passive').text, /datus, -a, -um \(from datum\)/);
  // "placēre (impersonal)" and "ēsse (edere)": the stem from the infinitive itself
  assert.match(step(byLemma('placet', 'placet, placēre (impersonal)'), 'Present stem').text, /^placē- \(placēre,/);
  assert.match(step(byLemma('edat', 'edō, ēsse (edere), ēdī, ēsum'), 'Present stem').text, /^ed- \(edere,/);
  // a plural-only noun says so and takes its stem from the plural; a singular-only one has no plural step
  const castra = ruleOf('castra', 'N');
  assert.ok(step(castra, 'Plural only'));
  assert.match(step(castra, 'Stem').text, /genitive plural castrōrum/);
  assert.ok(!step(castra, 'Singular'));
  const roma = ruleOf('romae', 'N');
  assert.ok(step(roma, 'Singular only'));
  assert.ok(!step(roma, 'Plural'));
  // an adjective with no positive: its comparative and superlative, and no positive endings
  const ult = byLemma('ulterior', 'ulterior, ulterius (comparative)');
  assert.ok(step(ult, 'No positive'));
  assert.ok(!step(ult, 'Endings'));
});

test('dō: its a is short, and its card and table say so', async () => {
  const { focusRule } = await import('../app/js/wordrule.js');
  const e = lookup('dat').entries.find((x) => x.pos === 'V');
  const t = paradigm(e, []);
  const r = wordRule(e, t);
  assert.equal(r.parts, 'dō, dare, dedī, datum');
  assert.match(step(r, 'Present stem').text, /^da- \(dare,/);
  assert.ok(step(r, 'Short a'));
  assert.match(step(r, 'Subjunctive').text, /the a becomes e/);
  const forms = t.sections.flatMap((s) => s.rows.flatMap((x) => x.cells.map((c) => c?.text)));
  for (const f of ['damus', 'dabam', 'dabō', 'darem', 'dās', 'dāns']) assert.ok(forms.some((x) => x?.split(' / ').includes(f)), f);
  for (const f of ['dāmus', 'dābam', 'dārem']) assert.ok(!forms.includes(f), f);
  // the note stays on a game's focused card
  const skills = read('../app/data/grammar/skills.json');
  const sk = (Array.isArray(skills) ? skills : skills.skills).find((s) => s.id === 'imperfect-active');
  assert.ok(focusRule(r, sk).steps.some((s) => s.head === 'Short a'));
});

test('the ? beside a box: how that one form is made, without its answer', async () => {
  const { formRule } = await import('../app/js/wordrule.js');
  const cellsOf = (w, pos) => { const e = lookup(w).entries.find((x) => x.pos === pos); const t = paradigm(e, []); return { r: wordRule(e, t), cells: t.sections.flatMap((s) => s.rows.flatMap((x) => x.cells)).filter((c) => c && c.key && !c.empty) }; };
  const say = (f) => f.steps.map((s) => `${s.head}: ${s.text}`).join(' | ');
  const { r, cells } = cellsOf('amat', 'V');
  const impf = cells.find((c) => c.key.tense === 'impf' && c.key.mood === 'ind' && c.key.voice === 'act');
  const f = formRule(r, impf.key);
  assert.match(say(f), /Imperfect: Stem \+ -bam/);
  assert.ok(f.steps.every((s) => !s.eg), 'no examples: they are the answers');
  assert.ok(!/amābam/.test(say(f)));
  // a passive subjunctive: its tense's way and the passive endings
  const v = cellsOf('regit', 'V');
  assert.match(say(formRule(v.r, v.cells.find((c) => c.key.tense === 'impf' && c.key.mood === 'subj' && c.key.voice === 'pass').key)), /-r, -ris, -tur/);
  // an infinitive has its own line, not the whole card
  const inf = formRule(v.r, v.cells.find((c) => c.key.kind === 'inf' && c.key.tense === 'perf' && c.key.voice === 'act').key);
  assert.ok(inf.steps.length <= 3 && /perfect stem \+ -isse/.test(say(inf)));
  // a noun: its number's endings only
  const n = cellsOf('rex', 'N');
  const pl = say(formRule(n.r, n.cells.find((c) => c.key.number === 'pl').key));
  assert.match(pl, /Plural/);
  assert.ok(!/Singular/.test(pl));
  // every cell of every kind of word gets something
  for (const [w, pos] of [['monet', 'V'], ['capit', 'V'], ['audit', 'V'], ['hortatur', 'V'], ['est', 'V'], ['puella', 'N'], ['bonus', 'ADJ'], ['fortis', 'ADJ']]) {
    const x = cellsOf(w, pos);
    for (const c of x.cells) assert.ok(formRule(x.r, c.key)?.steps.length, `${w} ${c.text}`);
  }
});
