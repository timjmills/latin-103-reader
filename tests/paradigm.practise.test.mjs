// Practising a whole paradigm (2026-10-03): the English under each form, the
// chapter that teaches each part, and the judging of a typed form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setGlossary, lookup, cellMeaning } from '../app/js/dictionary.js';
import { paradigm, keyParse } from '../app/js/paradigms.js';
import { cellChapter } from '../app/js/paradigm-chapters.js';
import { foldForm, cellAnswers, cellRight, chapterParts } from '../app/js/wordpanel.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
setGlossary(read('../app/data/glossary.json'), read('../app/data/function-words.json'));
const skillsData = read('../app/data/grammar/skills.json');
const skills = Array.isArray(skillsData) ? skillsData : skillsData.skills;

const entryOf = (form) => { const r = lookup(form); return r.entries?.[0] ?? r[0]; };
/** The cells of a word's table as { section, row, col, text, key }. */
function cells(form) {
  const e = entryOf(form);
  const t = paradigm(e, []);
  const out = [];
  for (const s of t.sections) s.rows.forEach((r) => r.cells.forEach((c, ci) => { if (!c.empty) out.push({ section: s.title, row: r.label, col: s.headers?.[ci] ?? '', text: c.text, key: c.key, c }); }));
  return { e, t, out };
}
const find = (list, section, row, col = null) => list.find((x) => x.section === section && x.row === row && (col == null || x.col === col));

test('a table knows the word it is of, without carrying it into a copy', () => {
  const { e, t } = cells('puellam');
  assert.equal(t.entry, e);
  assert.equal({ ...t }.entry, undefined, 'a spread (maskParadigm) must not keep the word');
  assert.ok(!JSON.stringify(t).includes('"entry"'));
});

test('every noun form has its English', () => {
  const { e, out } = cells('puellam');
  const en = (row, col) => cellMeaning(e, find(out, out[0].section, row, col).key);
  assert.equal(en('accusative', 'singular'), 'the girl (object)');
  assert.equal(en('genitive', 'plural'), 'of the girls');
  assert.equal(en('dative', 'singular'), 'to/for the girl');
  for (const x of out) assert.ok(cellMeaning(e, x.key), `no English for ${x.text}`);
});

test('every verb form has its English, the subjunctive and the command said once', () => {
  const { e, out } = cells('amat');
  const by = (text) => cellMeaning(e, out.find((x) => x.text === text).key);
  assert.equal(by('amat'), 'he/she/it loves');
  assert.equal(by('amantur'), 'they are loved');
  assert.equal(by('amēmus'), 'we may love');
  assert.equal(by('amā'), 'love!');
  for (const x of out) assert.ok(cellMeaning(e, x.key), `no English for ${x.text} (${JSON.stringify(x.key)})`);
});

test('adjective and pronoun forms have their English', () => {
  const adj = cells('bonus');
  for (const x of adj.out) assert.ok(cellMeaning(adj.e, x.key), `no English for ${x.text}`);
  assert.equal(cellMeaning(adj.e, adj.out.find((x) => x.key.case === 'gen').key), 'of good');
  const pron = cells('ille');
  for (const x of pron.out) assert.ok(cellMeaning(pron.e, x.key), `no English for ${x.text}`);
});

test('each part of a table is tied to the chapter that teaches it', () => {
  const noun = cells('puellam');
  const ch = (list, e, section, row, col) => cellChapter(skills, e, find(list, section, row, col).key);
  const s = noun.out[0].section;
  assert.deepEqual(['nominative', 'genitive', 'accusative', 'vocative', 'ablative', 'dative'].map((r) => ch(noun.out, noun.e, s, r, 'singular')), [1, 2, 3, 4, 5, 7]);
  const verb = cells('amat');
  const v = (section, row, col) => ch(verb.out, verb.e, section, row, col);
  assert.equal(v('present indicative', 'he / she / it', 'active'), 3);
  assert.equal(v('present indicative', 'I', 'active'), 15);
  assert.equal(v('present indicative', 'they', 'passive'), 6);
  assert.equal(v('present indicative', 'we', 'passive'), 17);
  assert.equal(v('imperfect indicative', 'we', 'active'), 19);
  assert.equal(v('perfect indicative', 'I', 'passive'), 21, 'the compound perfect passive comes with its participle');
  assert.equal(v('pluperfect indicative', 'I', 'passive'), 24);
  assert.equal(v('present subjunctive', 'I', 'active'), 27, 'a construction skill (deliberative, person 1) does not decide a form');
  assert.equal(v('perfect subjunctive', 'we', 'active'), 32);
  assert.equal(v('pluperfect subjunctive', 'they', 'active'), 33);
  const rex = cells('rēgem');
  for (const x of rex.out) assert.equal(cellChapter(skills, rex.e, x.key), 9, 'the third declension comes with cap. IX');
  const altus = cells('altus');
  const comp = altus.out.filter((x) => x.key.degree === 'comp');
  assert.ok(comp.length && comp.every((x) => cellChapter(skills, altus.e, x.key) === 12), 'a regular comparative comes with cap. XII');
});

test('a word with a skill of its own takes that chapter for the forms it names', () => {
  const bonus = cells('bonus');
  for (const x of bonus.out.filter((y) => y.key.degree === 'comp' || y.key.degree === 'super')) assert.equal(cellChapter(skills, bonus.e, x.key), 19, 'melior, optimus: the irregular comparison');
  const noli = cells('nōlī');
  for (const x of noli.out.filter((y) => y.key.kind === 'imper')) assert.equal(cellChapter(skills, noli.e, x.key), 20);
  const est = cells('est');
  assert.equal(cellChapter(skills, est.e, est.out.find((x) => x.text === 'est').key), 3, 'the irregular-verbs row does not move est');
});

test('a deponent infinitive keeps its tense chapter', () => {
  const { e, out } = cells('loquitur');
  const inf = (row) => cellChapter(skills, e, out.find((x) => x.section === 'infinitives' && x.row === row).key);
  assert.deepEqual([inf('present'), inf('perfect'), inf('future')], [16, 21, 23]);
});

test('a typed form is judged with macrons optional, v/u and j/i one letter', () => {
  assert.equal(foldForm('  Nārrāvit! '), 'narrauit');
  assert.ok(cellRight('narro', ['nārrō']));
  assert.ok(cellRight('NĀRRŌ', ['nārrō']));
  assert.ok(cellRight('amavit', ['amāvit']));
  assert.ok(!cellRight('narra', ['nārrō']));
  assert.ok(!cellRight('', ['nārrō']));
  assert.deepEqual(cellAnswers({ text: 'amātus -a -um' }), ['amātus -a -um', 'amātus']);
  assert.deepEqual(cellAnswers({ text: 'amāris', alt: 'amāre' }), ['amāris', 'amāre']);
  assert.deepEqual(cellAnswers({ text: '—', empty: true }), []);
  assert.ok(cellRight('amatus sum', cellAnswers({ text: 'amātus sum' })));
  // Two forms in one cell, or a form with its note: each is right on its own.
  assert.deepEqual(cellAnswers({ text: 'eī / iī', alt: 'iī' }), ['eī', 'iī']);
  assert.deepEqual(cellAnswers({ text: 'futūrus esse / fore' }), ['futūrus esse', 'fore']);
  assert.deepEqual(cellAnswers({ text: 'iēns (euntis)' }), ['iēns']);
  assert.ok(cellRight('fore', cellAnswers({ text: 'futūrus esse / fore' })));
});

test('the parts are named by what they cover, in chapter order', () => {
  const parts = chapterParts([
    { ch: 15, section: 'present indicative', col: 'active', row: 'I' },
    { ch: 3, section: 'present indicative', col: 'active', row: 'he / she / it' },
    { ch: 6, section: 'present indicative', col: 'passive', row: 'he / she / it' },
    { ch: 19, section: 'imperfect indicative', col: 'active', row: 'I' },
    { ch: 19, section: 'imperfect indicative', col: 'passive', row: 'I' },
    { ch: null, section: 'imperative', col: 'passive', row: 'you (sg.)' },
  ]);
  assert.deepEqual(parts.map((p) => p.ch), [3, 6, 15, 19, null]);
  assert.equal(parts[0].name, 'present indicative active: he / she / it');
  assert.equal(parts[3].name, 'imperfect indicative');
  const noun = chapterParts([{ ch: 1, section: 'cases', col: 'singular', row: 'nominative' }, { ch: 1, section: 'cases', col: 'plural', row: 'nominative' }, { ch: 7, section: 'cases', col: 'singular', row: 'dative' }, { ch: 7, section: 'cases', col: 'plural', row: 'dative' }]);
  assert.equal(noun[1].name, 'dative', 'a one-section table names the case alone');
});

test('keyParse says the cell in the dictionary\'s terms', () => {
  assert.deepEqual(keyParse({ kind: 'finite', tense: 'pres', mood: 'ind', voice: 'act', person: '3', number: 'sg' }), { tense: 'pres', mood: 'ind', voice: 'act', person: '3', number: 'sg' });
  assert.deepEqual(keyParse({ kind: 'nominal', case: 'dat', number: 'pl' }), { case: 'dat', number: 'pl' });
  assert.equal(keyParse(null), null);
});

test('drill hint and feedback tables stay without English or practice', () => {
  const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');
  assert.match(UI, /const pt = table \? renderParadigm\(table\) : null;/);
  assert.match(UI, /const lit = fb\.table \? renderParadigm\(fb\.table\) : null;/);
});

test('the Paradigms page is a tab and a link of its own, and a table in a box keeps to the box', () => {
  const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');
  const MAIN = readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8');
  const GCSS = readFileSync(new URL('../app/css/grammar.css', import.meta.url), 'utf8');
  const MANIFEST = JSON.parse(readFileSync(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.match(UI, /\['map', 'practice', 'paradigms', 'catalogue', 'stats'\]/);
  assert.match(UI, /paradigms: renderParadigms/);
  assert.ok(MAIN.includes("openGrammarSection('paradigms')"), 'the #/paradigms route is gone');
  assert.ok(MANIFEST.shortcuts?.some((s) => s.url === './#/paradigms'));
  // `.paradigm` clips to its border; the Grammar section's bleed must not widen a scroll box past it.
  assert.match(GCSS, /#grammar \.paradigm \.pt__scroll \{ margin-inline: 0; max-width: 100%; \}/);
});

test('Word Work is a section of its own, opened per chapter', () => {
  const HTML = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const IDX = readFileSync(new URL('../app/js/grammar/index.js', import.meta.url), 'utf8');
  const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');
  const MAIN = readFileSync(new URL('../app/js/main.js', import.meta.url), 'utf8');
  assert.match(HTML, /data-section="words"[^>]*aria-label="Word Work"/, 'the header has the third button');
  assert.match(IDX, /openWordWork\(chapter = null\)/);
  assert.match(IDX, /if \(last === 'grammar' \|\| last === 'words'\) setSection\(last\);/, 'Word Work is remembered like Grammar');
  assert.match(UI, /wordwork: renderWordWork/);
  assert.ok(MAIN.includes("openGrammarSection('words'"), 'the #/words/N route is gone');
  assert.ok(MAIN.includes('routeTo(`#/words/${n}`)'), 'the chapter page lost its Word Work button');
  // A chapter's tables open in practice with only the chosen chapters switched on.
  const WP = readFileSync(new URL('../app/js/wordpanel.js', import.meta.url), 'utf8');
  assert.match(WP, /if \(preset && !details\.dataset\.preset\)/);
  assert.match(UI, /fresh\.map\(\(x\) => card\(x, \(ch\) => ch === n\)\)/, 'New in Cap. N asks only that chapter');
});

test('a vocabulary word answered right moves on by itself; nothing else does', () => {
  const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');
  assert.match(UI, /if \(item\?\.kind !== 'vocab' \|\| !result\?\.correct \|\| result\.partial\) return;/, 'only a right vocabulary answer moves on');
  assert.match(UI, /document\.addEventListener\('pointerdown', stop, true\)/, 'a touch anywhere keeps the word on screen');
  assert.equal((UI.match(/autoNextVocab\(fb, (?:item|cur\.item), result, \(\) =>/g) ?? []).length, 2, 'both the session and its short sub-set move on');
});

test('Word Work says what the chapter teaches, offers columns, and finding a word needs no spelling', () => {
  const UI = readFileSync(new URL('../app/js/grammar/ui.js', import.meta.url), 'utf8');
  const WP = readFileSync(new URL('../app/js/wordpanel.js', import.meta.url), 'utf8');
  const GCSS = readFileSync(new URL('../app/css/grammar.css', import.meta.url), 'utf8');
  assert.match(UI, /`Taught in Cap\. \$\{c\.roman\}`/, 'the chapter\'s skills box');
  assert.match(WP, /if \(opts\.focus != null\) for \(const x of sheet\) if \(x\.ch === opts\.focus\) x\.td\.classList\.add\('is-focus'\);/, 'the chapter\'s forms are marked in each table');
  assert.match(UI, /\[1, 2, 3\]\.map\(\(k\) => btn\(String\(k\)/, 'the columns control');
  assert.match(GCSS, /\.g-ww__cards\[data-cols="2"\] \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(UI, /role: 'combobox', 'aria-autocomplete': 'list'/, 'the search is a combobox with a list');
  assert.match(UI, /const randomBtn = btn\('Random word'/, 'a random word');
  assert.match(UI, /if \(q\.length >= 4\) for \(const x of suggestPool\(\)\)/, 'a form on its way finds its word by the stem');
});
