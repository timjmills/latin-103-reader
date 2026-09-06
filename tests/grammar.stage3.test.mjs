// node --test tests/ — the stage-3 kinds (GRAMMAR-CONTRACT.md "Generated
// kinds"): transform (one word changed by paradigms.js, only unambiguous
// cells), reorder (≤ 8 words, punctuation on its word), translate (course
// units with English, self-graded), and the generator over every kind
// (generate.js) with the stage-3 fallback to a wave-1 kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems } from '../app/js/grammar/items.js';
import { createStage3, transformOps, chunksOf, REORDER_MAX_WORDS } from '../app/js/grammar/stage3.js';
import { createGenerator } from '../app/js/grammar/generate.js';
import { judge } from '../app/js/grammar/session.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/grammar/skills.json', import.meta.url), 'utf8'));
const S = indexSkills(raw).skills;
const N = (lemma, h, cat, gender, roots, parses, senses) => ({ lemma, h, pos: 'N', cat, gender, roots, parses, senses, enc: null });
const V = (lemma, h, cat, roots, parses, senses, kind = null) => ({ lemma, h, pos: 'V', cat, roots, parses, senses, enc: null, kind });
const nk = (c, n, g) => ({ case: c, number: n, gender: g });
const fin = (tense, mood, person, number, voice = 'act') => ({ tense, voice, mood, person, number });
const PUELLA = ['puella -ae f', 'puella', [1, 1], 'f', ['puell', 'puell']];
const DO = ['dō, dāre, dedī, datum', 'do', [1, 1], ['d', 'd', 'ded', 'dat']];
const G = {
  ariadna: [N('Ariadna -ae f', 'ariadna', [1, 1], 'f', ['Ariadn', 'Ariadn'], [nk('nom', 'sg', 'f'), nk('voc', 'sg', 'f'), nk('abl', 'sg', 'f')], ['Ariadne'])],
  theseo: [N('Thēseus -ī m', 'theseus', [2, 1], 'm', ['Thēse', 'Thēse'], [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm')], ['Theseus'])],
  filum: [N('fīlum -ī n', 'filum', [2, 2], 'n', ['fīl', 'fīl'], [nk('nom', 'sg', 'n'), nk('acc', 'sg', 'n'), nk('voc', 'sg', 'n')], ['thread, string'])],
  dedit: [V(...DO, [fin('perf', 'ind', 3, 'sg')], ['give'])],
  dat: [V(...DO, [fin('pres', 'ind', 3, 'sg')], ['give'])],
  puellae: [N(...PUELLA, [nk('gen', 'sg', 'f'), nk('dat', 'sg', 'f'), nk('nom', 'pl', 'f'), nk('voc', 'pl', 'f')], ['girl'])],
  puero: [N('puer -ī m', 'puer', [2, 3], 'm', ['puer', 'puer'], [nk('dat', 'sg', 'm')], ['boy'])],
  regi: [N('rēx, rēgis m', 'rex', [3, 1], 'm', ['rēx', 'rēg'], [nk('dat', 'sg', 'm')], ['king'])],
  librum: [N('liber -brī m', 'liber', [2, 3], 'm', ['liber', 'libr'], [nk('acc', 'sg', 'm')], ['book'])],
  servus: [N('servus -ī m', 'servus', [2, 1], 'm', ['serv', 'serv'], [nk('nom', 'sg', 'm')], ['slave'])],
  servo: [N('servus -ī m', 'servus', [2, 1], 'm', ['serv', 'serv'], [nk('dat', 'sg', 'm'), nk('abl', 'sg', 'm')], ['slave'])],
  iulius: [N('Iūlius -ī m', 'iulius', [2, 1], 'm', ['Iūli', 'Iūli'], [nk('nom', 'sg', 'm')], ['Julius'])],
  rosam: [N('rosa -ae f', 'rosa', [1, 1], 'f', ['ros', 'ros'], [nk('acc', 'sg', 'f')], ['rose'])],
  filiae: [N('fīlia -ae f', 'filia', [1, 1], 'f', ['fīli', 'fīli'], [nk('gen', 'sg', 'f'), nk('dat', 'sg', 'f'), nk('nom', 'pl', 'f')], ['daughter'])],
  // oblīta reads as nom. sg. f. AND nom./acc. pl. n. — "make it singular" would be unanswerable.
  oblita: [{ lemma: 'oblītus -a -um', h: 'oblitus', pos: 'ADJ', cat: [1, 1], roots: ['oblīt', 'oblīt'], parses: [nk('nom', 'sg', 'f'), nk('nom', 'pl', 'n'), nk('acc', 'pl', 'n')], senses: ['forgetful'], enc: null }],
  suae: [{ lemma: 'suus -a -um', h: 'suus', pos: 'ADJ', cat: [1, 1], roots: ['su', 'su'], parses: [nk('gen', 'sg', 'f'), nk('dat', 'sg', 'f'), nk('nom', 'pl', 'f')], senses: ['his own'], enc: null }],
};
const lookup = (form) => ({ form, entries: G[form] ?? [], via: G[form] ? 'exact' : 'miss', enclitic: null });
const units = [
  { id: 'w01:63.10', la: 'Ariadna Thēseō fīlum dedit.', en: 'Ariadne gave Theseus the thread.', week_n: 1 },
  { id: 'w07:1.1', la: 'Servus puerō librum dat.', en: 'The slave gives the boy a book.', week_n: 7 },
  { id: 'w07:2.3', la: 'Servus rēgī librum dat.', en: 'The slave gives the king a book.', week_n: 7 },
  { id: 'r07:3.1', la: 'Iūlius fīliae suae rosam dat.', en: '', week_n: 107 },
];
const ADJ_UNITS = [{ id: 'w07:5.1', la: 'Puella oblīta rēgī rosam dat.', en: 'The forgetful girl gives the king a rose.', week_n: 7 }];
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const mk = (rand = () => 0.4) => { const items = createItems({ units, lookup, paradigm, skills: S, storage: mem(), rand }); return { items, stage3: createStage3({ items, paradigm, rand }) }; };

test('transformOps: a noun offers the other number; a finite verb its number, neighbouring tenses, the voice (3rd person, not deponent) and the indirect command; nothing for a participle without a table', () => {
  const noun = { token: { text: 'puerō' }, entry: G.puero[0], parse: nk('dat', 'sg', 'm') };
  assert.deepEqual(transformOps(noun).map((o) => o.op), ['num-pl']);
  const verb = { token: { text: 'dat' }, entry: G.dat[0], parse: fin('pres', 'ind', 3, 'sg') };
  assert.deepEqual(transformOps(verb).map((o) => o.op), ['num-pl', 'tense-impf', 'tense-perf', 'voice-pass', 'ind-command']);
  const dep = { token: { text: 'loquitur' }, entry: { ...G.dat[0], kind: 'dep' }, parse: fin('pres', 'ind', 3, 'sg', 'pass') };
  assert.ok(!transformOps(dep).some((o) => o.op.startsWith('voice')));
  assert.deepEqual(transformOps(null), []);
});

test('transform: the changed form is one cell of the table; the book\'s form is exact; feedback shows the original sentence; typed answers are macron-optional', () => {
  const { stage3 } = mk();
  const seen = new Set();
  let cycle = new Set();
  // Two unambiguous datives in the fixture, one op each. A key is unique per
  // (kind, unit, token, op) and never comes round twice inside a cycle; the
  // item that opens a fresh cycle carries repeat: true (items.js createPool).
  for (let i = 0; i < 6; i++) {
    const it = stage3.generate({ skill: 'dative-indirect-object', kind: 'transform', stage: 3 });
    assert.ok(it, 'a transform item');
    assert.equal(it.kind, 'transform'); assert.equal(it.input, 'type');
    assert.ok(it.key.startsWith('transform:'));
    if (it.repeat) cycle = new Set();
    assert.equal(cycle.has(it.key), false, `no key comes round twice inside a cycle: ${it.key}`);
    cycle.add(it.key); seen.add(it.key);
    if (i < 2) assert.equal(it.repeat, false, 'the two fresh spots come first');
    assert.ok(it.answer.length >= 1 && it.answer.every((a) => a && a !== it.target.text), `the change differs from the book: ${it.answer}`);
    assert.equal(it.feedback.sentence, it.prompt.la);
    assert.ok(it.prompt.question.includes(it.target.text));
    assert.equal(judge(it, it.answer[0]).correct, true);
    assert.equal(judge(it, it.answer[0].replace(/ō/g, 'o').replace(/ī/g, 'i').replace(/ē/g, 'e').replace(/ā/g, 'a')).correct, true);
    assert.equal(judge(it, it.target.text).correct, false);
  }
  assert.equal(seen.size, 2, 'both spots were drawn before any repeat');
  const plural = [...seen].find((k) => /num-pl$/.test(k));
  assert.ok(plural, 'the dative noun offers its plural');
  // The key is (kind, unit, token, op) and stable: the same spot always keys the same.
  assert.deepEqual([...seen].sort(), ['transform:w07:1.1:puero:1:num-pl', 'transform:w07:2.3:regi:1:num-pl']);
});

test('transform skips a form whose reading is ambiguous in the very feature the instruction moves (oblīta is both nom. sg. f. and nom. pl. n.)', () => {
  const noun = { token: { text: 'oblīta' }, entry: G.oblita[0], parse: nk('nom', 'sg', 'f') };
  // The op is offered in the abstract — it is the generator that must refuse it.
  assert.deepEqual(transformOps(noun).map((o) => o.op), ['num-pl']);
  const items = createItems({ units: ADJ_UNITS, lookup, paradigm, skills: S, storage: mem() });
  const s3 = createStage3({ items, paradigm });
  assert.equal(s3.generate({ skill: 'adjective-agreement', kind: 'transform', stage: 3 }), null, 'no transform item from an ambiguous form');
  // The unambiguous dative in the same sentence still yields one for its own skill.
  assert.ok(s3.generate({ skill: 'dative-indirect-object', kind: 'transform', stage: 3 }), 'rēgī is unambiguous in number');
});

test('reorder: sentences of 3–8 words, scrambled, punctuation kept on its word; the order input judges by the book\'s order', () => {
  const { stage3 } = mk();
  const it = stage3.generate({ skill: 'dative-indirect-object', kind: 'reorder', stage: 3 });
  assert.ok(it && it.input === 'order' && it.key.startsWith('reorder:'));
  assert.ok(it.chunks.length <= REORDER_MAX_WORDS && it.chunks.length >= 3);
  assert.equal(it.chunks.join(' '), it.prompt.la ?? it.feedback.sentence);
  assert.ok(it.chunks.some((c) => /[.!?]$/.test(c)), 'the full stop stays on its word');
  assert.notDeepEqual(it.scrambled, it.chunks.map((_, i) => i));
  assert.equal(judge(it, it.chunks.map((_, i) => i)).correct, true);
  assert.equal(judge(it, it.scrambled).correct, false);
  // A sentence over 8 words never becomes a reorder item.
  const long = { id: 'w07:9.9', la: 'Servus puerō librum dat et servus rēgī librum dat et dat.', en: 'x', week_n: 7 };
  const items = createItems({ units: [long], lookup, paradigm, skills: S, storage: mem() });
  assert.equal(createStage3({ items, paradigm }).generate({ skill: 'dative-indirect-object', kind: 'reorder' }), null);
  assert.equal(chunksOf('  a  b ').length, 2);
});

test('translate: course units with English only (never the shelf), the construction\'s words lit, self-graded; the attempt is logged self: true and weighted as hinted', async () => {
  const { stage3 } = mk();
  const ids = new Set();
  for (let i = 0; i < 3; i++) { const it = stage3.generate({ skill: 'dative-indirect-object', kind: 'translate', stage: 3 }); assert.ok(it && it.input === 'self'); ids.add(it.unit_id); assert.ok(it.answer[0].length > 5, 'the English is the model'); assert.ok(it.lit.includes(it.target.index), 'the target is lit'); assert.ok(!/^r/.test(it.unit_id)); }
  assert.equal(ids.size, 3);
  assert.equal(stage3.generate({ skill: 'dative-indirect-object', kind: 'translate' }).repeat, true, 'three course sentences, then the pool wraps');
  // Through the runner: self: true, hinted, partial for "partly".
  const { createPractice } = await import('../app/js/grammar/session.js');
  const { createGrammarStore } = await import('../app/js/grammar/store-grammar.js');
  const { addToPractice } = await import('../app/js/grammar/scheduler.js');
  const g = createGrammarStore({ mode: 'local', storage: mem() });
  await g.ready();
  await g.setState({ ...addToPractice('dative-indirect-object'), stage: 3, stability_days: 4, due_at: new Date(Date.now() - 1000).toISOString() });
  const { items } = mk();
  const gen = createGenerator({ items, stage3: createStage3({ items, paradigm }), skills: S });
  const plan = [{ skill: 'dative-indirect-object', kind: 'translate', stage: 3, currentWeek: false }];
  const p = createPractice({ plan, gstore: g, items: gen, skillsIndex: { skills: S }, preset: 'one-skill', size: 1, oneSkill: 'dative-indirect-object' });
  const first = p.start();
  assert.equal(first.item.kind, 'translate');
  const r = await p.runner.answer('partly');
  assert.equal(r.attempt.self, true); assert.equal(r.attempt.hinted, true); assert.equal(r.attempt.partial, true); assert.equal(r.attempt.answer, 'self: partly');
  assert.equal(g.getState('dative-indirect-object').stability_days, 4, 'partly holds the stability');
});

test('generate.js: stage-3 kinds fall back to a wave-1 kind when the skill offers none; set kinds only for set skills; drillable over both maps', () => {
  const { items, stage3 } = mk();
  const gen = createGenerator({ items, stage3, skills: S });
  // genitive-of has no candidate here: nothing at all.
  assert.equal(gen.generate({ skill: 'genitive-of', kind: 'transform' }), null);
  // A skill with candidates but no English → translate falls through to a wave-1 kind, the neighbours' kinds last.
  const items2 = createItems({ units: units.map((u) => ({ ...u, en: '' })), lookup, paradigm, skills: S, storage: mem(), rand: () => 0.4 });
  const gen2 = createGenerator({ items: items2, stage3: createStage3({ items: items2, paradigm }), skills: S });
  const it = gen2.generate({ skill: 'dative-indirect-object', kind: 'translate', stage: 3, avoid: ['blank'] });
  assert.ok(it && it.kind !== 'translate');
  assert.notEqual(it.kind, 'blank');
  assert.equal(gen.generate({ skill: 'dative-indirect-object', kind: 'vocab' }), null);
  assert.equal(gen.drillable('dative-indirect-object'), true);
  assert.equal(gen.drillable('nope'), false);
});
