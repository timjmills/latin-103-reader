// node --test tests/ — the reader's half of the pointer-dictionary.
//
// The user asked for the meaning on the pointer "throughout", and the reader
// is where they read. What the pointer opens there is the reader's own
// dictionary, not the Grammar section's, so what is tested here is the
// reader's own two decisions plus the wiring that carries them:
//
//   - glossTipRows(): what the tooltip says, and what it deliberately leaves
//     to the click (the switcher, the senses, the paradigm, the buttons);
//   - glossAlreadyShown(): which words the pointer keeps quiet on, because a
//     setting of the reader's is already showing what they mean;
//   - the wiring, at the source, because it is DOM and pointer work and the
//     app has no DOM harness: the tooltip is opened by the shared machine,
//     never focused, and the click path is untouched.
//
// No Latin from the book appears here: the words below are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glossTipRows, glossAlreadyShown } from '../app/js/reader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const READER = readFileSync(join(ROOT, 'app/js/reader.js'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'app/js/main.js'), 'utf8');
const PANELS = readFileSync(join(ROOT, 'app/css/panels.css'), 'utf8');

/* --------------------------------------------------- what it says */

test('glossTipRows: the ranked-first reading, split the way the panel splits it', () => {
  const rows = glossTipRows({
    readings: [{ meaning: 'to/for the garden · in/by the garden', parse: 'dative or ablative singular', lemma: 'hortulus', category: 'noun, 2nd declension' }],
    total: 1,
  });
  assert.equal(rows.miss, false);
  assert.deepEqual(rows.meanings, ['to/for the garden', 'in/by the garden']);
  assert.equal(rows.parse, 'dative or ablative singular');
  assert.equal(rows.lemma, 'hortulus');
  assert.equal(rows.category, 'noun, 2nd declension');
  assert.equal(rows.more, null, 'one entry needs no count');
});

test('glossTipRows: every sense of the ranked-first reading, not just the head word', () => {
  // The learner's own example (2026-09-12): the tooltip said "game" and kept "school" back, because
  // `meaning` is built from the head word of senses[0] alone. Senses need no press, so they are in.
  const rows = glossTipRows({
    readings: [{
      meaning: 'the game (object)',
      parse: 'accusative singular',
      lemma: 'lūdus -ī m',
      category: '2nd declension',
      senses: ['game, play, sport, pastime, entertainment, fun', 'school, elementary school'],
    }],
    total: 1,
  });
  assert.deepEqual(rows.senses, [
    'game, play, sport, pastime, entertainment, fun',
    'school, elementary school',
  ]);
  // The case line is still the case line: the list widens it, it does not replace it.
  assert.deepEqual(rows.meanings, ['the game (object)']);
});

test('glossTipRows: a reading with no senses yields an empty list, never undefined', () => {
  for (const r of [{ meaning: 'a wave' }, { meaning: 'a wave', senses: null }, { meaning: 'a wave', senses: [] }]) {
    assert.deepEqual(glossTipRows({ readings: [r], total: 1 }).senses, []);
  }
  assert.deepEqual(glossTipRows(null).senses, [], 'a miss still has the field');
});

test('glossTipRows: the senses shown are the first reading’s only', () => {
  const rows = glossTipRows({
    readings: [{ meaning: 'I want', senses: ['want, wish, be willing'] }, { meaning: 'I fly', senses: ['fly'] }],
    total: 2,
  });
  assert.deepEqual(rows.senses, ['want, wish, be willing']);
  assert.match(rows.more, /^2 entries\b/, 'the other reading is reached by pressing');
});

test('glossTipRows: a second reading is counted, not shown — choosing between them needs a press', () => {
  const rows = glossTipRows({ readings: [{ meaning: 'a wave' }], total: 3 });
  assert.match(rows.more, /^3 entries\b/);
  assert.deepEqual(rows.meanings, ['a wave']);
  assert.equal(rows.parse, null);
  assert.equal(rows.lemma, null);
});

test('glossTipRows: a word the dictionary has not got says so, as the panel does', () => {
  for (const g of [null, undefined, { readings: [], total: 0 }, {}]) {
    const rows = glossTipRows(g);
    assert.equal(rows.miss, true, `${JSON.stringify(g)} should read as a miss`);
    assert.deepEqual(rows.meanings, []);
    assert.equal(rows.more, null);
  }
});

/* ------------------------------------- which words it keeps quiet on */

// A stand-in for a word element: only `closest` and `querySelector` are asked of it.
function wordIn({ ancestors = [], en = null } = {}) {
  const box = { querySelector: (sel) => (en && sel.split(', ').some((s) => en.cls === s.slice(1)) ? en : null) };
  return {
    closest(sel) {
      const want = sel.split(', ');
      return ancestors.some((a) => want.includes(`.${a}`)) ? box : null;
    },
  };
}
const shown = () => true;
const hidden = () => false;

test('glossAlreadyShown: the looked-up list already prints the meaning, the parse and the lemma', () => {
  assert.equal(glossAlreadyShown(wordIn({ ancestors: ['lookups__item'] }), hidden), true);
});

test('glossAlreadyShown: a margin gloss or a caption keeps quiet only while its English is on show', () => {
  const gloss = { ancestors: ['mnotes__item'], en: { cls: 'mnotes__en' } };
  const caption = { ancestors: ['pic'], en: { cls: 'pic__en' } };
  assert.equal(glossAlreadyShown(wordIn(gloss), shown), true, 'the English is on the page: a second copy is noise');
  assert.equal(glossAlreadyShown(wordIn(gloss), hidden), false, 'the English is behind its chip: the pointer is the only way to the meaning');
  assert.equal(glossAlreadyShown(wordIn(caption), shown), true);
  assert.equal(glossAlreadyShown(wordIn(caption), hidden), false);
  // A gloss with no English at all is Latin explaining Latin: nothing is being repeated.
  assert.equal(glossAlreadyShown(wordIn({ ancestors: ['mnotes__item'] }), shown), false);
});

test('glossAlreadyShown: the reading text itself is always hoverable', () => {
  assert.equal(glossAlreadyShown(wordIn({ ancestors: ['la'] }), shown), false);
  assert.equal(glossAlreadyShown(wordIn(), shown), false);
  assert.equal(glossAlreadyShown(null, shown), false);
});

/* ------------------------------------------------------- the wiring */

test('the reader opens its tooltip through the shared machine, not a second one of its own', () => {
  assert.match(READER, /from '\.\/hovergloss\.js'/, 'the reader no longer shares the Grammar section’s hover');
  assert.match(READER, /word: '\.w, \.r-wx'/, 'the reader’s words are no longer what the pointer looks for');
  assert.match(READER, /cls: 'r-wx'/, 'plain-text Latin is no longer cut into its own hover-only spans');
  // Its own class, not `.w`: a cut word must not become a control, or a click on a caption or a
  // chapter title would start doing what a click on a reading word does.
  assert.doesNotMatch(READER, /cls: 'w'/, 'cut words would become reading words, and a click on them would change meaning');
});

test('the reader says which of its words keep quiet, even though the answer is not "a tap item"', () => {
  assert.match(READER, /skip: \(w\) => outside\(w\) \|\| glossAlreadyShown\(w, /, 'the reader no longer answers the question the Grammar section answers with `g-w--pick`');
  // Asked of the CSS rather than of the setting, so the rule cannot drift from what is on screen.
  assert.match(READER, /getComputedStyle\(node\)\.display !== 'none'/, 'the rule reads a setting again, and can now disagree with the page');
});

test('the tooltip takes no focus and no pointer, and the click is untouched', () => {
  const fn = /function showTip\(w\) \{([\s\S]*?)\n  \}/.exec(READER);
  assert.ok(fn, 'showTip() is gone');
  assert.doesNotMatch(fn[1], /\.focus\(/, 'the tooltip would pull the caret out of whatever has it');
  assert.doesNotMatch(fn[1], /store\.|addLookup|markLearned/, 'resting the pointer on a word would record a lookup');
  assert.match(fn[1], /aria-hidden': 'true'/, 'the tooltip would be announced twice over, and cannot be reached');
  assert.match(PANELS, /\.wtip \{[^}]*pointer-events: none/, 'the tooltip would take the pointer and flicker as the mouse reached it');
  // The click path: still the one `word` event the panel listens for.
  assert.match(READER, /if \(w\) \{ setCurrentFrom\(w\); emit\('word', wordFrom\(w\)\); return; \}/, 'a click no longer does what it did');
});

test('the shell hands the pointer the same ranked lookup the panel makes on a click', () => {
  const fn = /const gloss = \(text, \{ context = '', at \} = \{\}\) => \{([\s\S]*?)\n  \};/.exec(MAIN);
  assert.ok(fn, 'the shell no longer builds the pointer’s lookup');
  assert.match(fn[1], /dict\.lookup\(text, context \? \{ context/, 'the tooltip would rank readings without the sentence they are in');
  assert.doesNotMatch(fn[1], /store\.|addLookup|markLearned/, 'the pointer would write to the store');
});

test('the shell gives the pointer the Latin it draws itself, and keeps it off another section’s panel', () => {
  assert.match(MAIN, /reader\.hoverGloss\(\$\('#chapter'\), \{ off: '#chapter-panel-grammar' \}\)/, 'the chapter page lost the pointer-dictionary, or gained a second one over the Grammar section’s');
  assert.match(MAIN, /reader\.hoverGloss\(\$\('#weeks'\)\)/, 'the weeks menu’s chapter names are Latin too');
});

test('the tooltip wears the popup’s own clothes, from the project’s tokens', () => {
  const rule = /\.wtip \{([^}]*)\}/.exec(PANELS);
  assert.ok(rule, 'the tooltip has no style of its own');
  // It is rendered with class "popup wtip", so border, ground, radius and shadow come from .popup.
  assert.match(READER, /class: 'popup wtip'/, 'the tooltip is no longer the same box as the popup');
  assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,8}\b|\boklch\(|\brgb\(/, 'a hard-coded colour crept into the tooltip');
  assert.doesNotMatch(rule[1], /font-size:\s*\d+px/, 'a px font size crept into the tooltip');
});
