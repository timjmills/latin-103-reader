// node --test tests/ — every sense a word has, not just the first, and the two
// words the learner reported:
//
//   "the dictionary popups give only one definition when sometimes there is
//    more - for example volo could be I want or I fly and when its fly, the
//    definition only says want. Similar with 'Lūdum' … which means 'game',
//    'play', 'sport,' or 'school'. But the dictionary only says 'game'."
//
// Two faults in two layers, and this file holds both apart:
//
//   Display. `meaningLine()` builds a *grammatical* line out of the head word
//   of senses[0] — "the game (object)" — which is what tells the learner lūdum
//   is the object, and it must keep doing exactly that. The list was already on
//   `describe()`; the grammar popup simply never printed it. Held below by what
//   `describe()` returns and by the exact text the popup composes from it.
//
//   Data. volō, velle "want" and volō, volāre "fly" are one headword with two
//   paradigms, and SENSE_OVERRIDES was keyed on (part of speech, headword), so
//   velle's senses were stamped on the fly-verb: hovering *volat* asserted
//   "he/she/it wants". The guard at the bottom is the one that matters — it
//   fails if any headword's differing paradigms ever share one sense list
//   again, so this cannot come back quietly.
//
// The popup's DOM cannot be built here (no document), so its composition is
// tested through the same pure calls it makes, and its wiring is read out of
// the source with every comment line stripped first — a test that passes
// against the comment explaining the rule is worse than no test.
//
// No Latin from the book appears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { setGlossary, lookup, describe } from '../app/js/dictionary.js';
import { panelPlace } from '../app/js/grammar/ui.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'app', 'data', f), 'utf8'));
const GLOSSARY = load('glossary.json');
setGlossary(GLOSSARY, load('function-words.json'), load('glosses.json'));

/** Source with every comment line taken out, so no assertion below can pass against prose. */
const code = (src) => src
  .split(/\r?\n/)
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
  .join('\n');
const UI_CODE = code(readFileSync(path.join(ROOT, 'app/js/grammar/ui.js'), 'utf8'));
const CSS_CODE = code(readFileSync(path.join(ROOT, 'app/css/grammar.css'), 'utf8'));

const readingOf = (form, h, pos) => {
  const r = lookup(form);
  const e = r.entries.find((x) => x.h === h && (!pos || x.pos === pos));
  assert.ok(e, `${form}: no ${h} (${pos ?? 'any'}) reading`);
  return e;
};

/* ------------------------------------------------ fault 1: the senses are there */

test('lūdum keeps its grammatical first line AND carries every sense', () => {
  const d = describe(readingOf('lūdum', 'ludus'), { form: 'Lūdum' });
  // The case line is the point of the first line and must not change: it is what says "object".
  assert.equal(d.meaning, 'the game (object)');
  assert.equal(d.parse, 'accusative singular');
  assert.match(d.lemma, /^lūdus -ī m/);
  // …and the senses the learner said were missing are all present, in order.
  assert.deepEqual(d.senses, [
    'game, play, sport, pastime, entertainment, fun',
    'school, elementary school',
  ]);
  // "school" is reachable, which is the whole complaint.
  assert.ok(d.senses.some((s) => /school/.test(s)));
  // The first line still says only "game" — deliberately. The list is what widens it.
  assert.ok(!/school/.test(d.meaning));
});

test('a one-sense word still returns a list, so the popup has no special case', () => {
  const d = describe(readingOf('volat', 'volo', 'V'));
  assert.ok(Array.isArray(d.senses));
  assert.deepEqual(d.senses, ['fly']);
});

/* ------------------------------------------------ fault 2: two verbs, two meanings */

test('volat is the flying volō and says so', () => {
  const e = readingOf('volat', 'volo', 'V');
  assert.equal(e.lemma, 'volō, volāre, volāvī, volātum');
  assert.deepEqual(e.cat, [1, 1]);
  const d = describe(e);
  assert.equal(d.meaning, 'he/she/it flies');
  assert.deepEqual(d.senses, ['fly']);
  // The regression itself: this reading must never again claim to be "want".
  assert.ok(!/want|wish|willing/i.test(d.meaning));
  assert.ok(!d.senses.some((s) => /want|wish|willing/i.test(s)));
});

test('vult is still the wanting volō', () => {
  const d = describe(readingOf('vult', 'volo', 'V'));
  assert.equal(d.meaning, 'he/she/it wants');
  assert.deepEqual(d.senses, ['want, wish, be willing']);
});

test('volō the form offers both verbs, each with its own dictionary form and sense', () => {
  const r = lookup('volō');
  const velle = r.entries.find((e) => e.h === 'volo' && e.lemma.includes('velle'));
  const volare = r.entries.find((e) => e.h === 'volo' && e.lemma.includes('volāre'));
  assert.ok(velle, 'the wanting volō');
  // Before the builder fix the two lexemes had identical senses, so the duplicate-merge in
  // build_glossary.py deleted the flying one outright: the form volō had no "fly" reading at all.
  assert.ok(volare, 'the flying volō');
  assert.deepEqual(describe(velle).senses, ['want, wish, be willing']);
  assert.deepEqual(describe(volare).senses, ['fly']);
  assert.equal(describe(velle).meaning, 'I want');
  assert.equal(describe(volare).meaning, 'I fly');
});

/* ------------------------------------------------ what the popup composes */

// The popup prints, per reading: the meaning split on ' · ', the parse (unless held), the
// dictionary form · category — and, on the FIRST reading only, the sense list. This rebuilds
// that text from the same calls so the exact wording is pinned.
const popupText = (form, { parse = true, max = 4 } = {}) => {
  const r = lookup(form);
  return r.entries.slice(0, max).map((entry, i) => {
    const d = describe(entry, { form });
    const lines = [...String(d.meaning ?? '').split(/\s+·\s+/)];
    if (d.parse && parse) lines.push(d.parse);
    lines.push(d.lemma + (d.category ? ` · ${d.category}` : ''));
    if (!i && d.senses?.length) lines.push(...d.senses.map((s, j) => `${j + 1}. ${s}`));
    return lines.join('\n');
  }).join('\n---\n');
};

test('the popup text for lūdum', () => {
  assert.equal(popupText('lūdum'), [
    'the game (object)',
    'accusative singular',
    'lūdus -ī m · 2nd declension',
    '1. game, play, sport, pastime, entertainment, fun',
    '2. school, elementary school',
  ].join('\n'));
});

test('the popup text for volat — the reported bug, as the learner would read it', () => {
  assert.equal(popupText('volat'), [
    'he/she/it flies',
    'present indicative, 3rd person singular',
    'volō, volāre, volāvī, volātum · 1st conjugation',
    '1. fly',
  ].join('\n'));
});

test('the popup text for vult', () => {
  assert.equal(popupText('vult'), [
    'he/she/it wants',
    'present indicative, 3rd person singular',
    'volō, velle, voluī · irregular verb',
    '1. want, wish, be willing',
  ].join('\n'));
});

test('only the first reading gets a sense list, so the popup cannot become a wall', () => {
  const text = popupText('volō');
  const blocks = text.split('\n---\n');
  assert.ok(blocks.length > 1, 'volō has rival readings');
  assert.match(blocks[0], /^\d\. /m);
  for (const b of blocks.slice(1)) assert.ok(!/^\d\. /m.test(b), 'an alternate reading printed a list');
});

test('a held-back parse (§17.1) does not hold back the senses', () => {
  const held = popupText('lūdum', { parse: false });
  assert.ok(!held.includes('accusative singular'), 'the parse is held');
  // Senses name no case, number or person; the meaning line already shown says "(object)" outright.
  assert.ok(held.includes('1. game, play, sport, pastime, entertainment, fun'));
  assert.ok(held.includes('2. school, elementary school'));
});

/* ------------------------------------------------ wiring (source-read, comments stripped) */

test('the popup renders describe()’s senses, on the first reading only', () => {
  assert.match(UI_CODE, /g-pop__senses/, 'the popup builds a sense list');
  assert.match(UI_CODE, /!i && d\.senses\?\.length/, 'gated on the first reading');
  assert.match(CSS_CODE, /\.g-pop__senses\s*\{/, 'the list is styled');
});

test('all three surfaces show the senses, and in the same place', () => {
  // Found on the live pass: there is a THIRD surface. The reader has its full panel
  // (wordpanel.js, which always showed the list) and, separately, the tooltip the pointer and the
  // long press open (reader.js `wtip`), which did not — and that is the one the learner reads in.
  const READER = code(readFileSync(path.join(ROOT, 'app/js/reader.js'), 'utf8'));
  const PANELS = code(readFileSync(path.join(ROOT, 'app/css/panels.css'), 'utf8'));
  const WORDPANEL = code(readFileSync(path.join(ROOT, 'app/js/wordpanel.js'), 'utf8'));
  assert.match(WORDPANEL, /entry__senses/, "the reader's panel");
  assert.match(READER, /wtip__senses/, "the reader's tooltip");
  assert.match(UI_CODE, /g-pop__senses/, "the Grammar section's popup");
  assert.match(PANELS, /\.wtip__senses\s*\{/, "the tooltip's list is styled");
  // Same place in all three: after the dictionary form, never before the meaning.
  for (const [name, src, lemma, senses] of [
    ['wtip', READER, 'entry__cite', 'wtip__senses'],
    ['panel', WORDPANEL, 'entry__lemma', 'entry__senses'],
    ['popup', UI_CODE, 'g-pop__lemma', 'g-pop__senses'],
  ]) {
    assert.ok(src.indexOf(lemma) < src.indexOf(senses), `${name}: senses must follow the dictionary form`);
  }
});

test('the taller popup is placed by panelPlace, not by a second hand-rolled flip', () => {
  // panelPlace already flips above AND clamps either way; the obvious hand-rolled flip leaves the
  // foot of the popup off a phone screen when neither side fits, which is the ordinary case.
  assert.match(CSS_CODE, /\.g-pop\s*\{[^}]*max-height/s, 'a height backstop');
  assert.match(UI_CODE, /pop\.style\.width = /, 'the width is set before measuring');
  assert.match(UI_CODE, /panelPlace\(\s*\{ top: wr\.top, bottom: wr\.bottom, left: centred \}/, 'the shared placement is reused');
});

test('panelPlace keeps the popup on a 375×667 phone even when neither side fits', () => {
  // The popup is 340 wide; a word halfway down a small phone with a tall popup.
  const w = 340;
  const { x, y } = panelPlace({ top: 300, bottom: 320, left: 200 }, { h: 400, w, vw: 375, vh: 667 });
  assert.ok(x >= 8 && x + w <= 375 - 8, `x=${x} is off the screen`);
  assert.ok(y >= 8 && y + 400 <= 667 - 8, `y=${y} leaves the popup hanging off the screen`);
});

test('§21: the coarse-pointer rules stay at the end of the stylesheet', () => {
  // The sense list is styled in the popup block, not smuggled into the touch section, where a plain
  // rule written later would silently beat it on a real phone.
  const senses = CSS_CODE.indexOf('.g-pop__senses');
  const coarse = CSS_CODE.indexOf('pointer: coarse');
  assert.ok(senses > -1 && coarse > -1);
  assert.ok(senses < coarse, 'the new rule must come before the coarse block');
});

/* ------------------------------------------------ the guard against fault 2 coming back */

test('no headword carries one sense list across two different paradigms', () => {
  // A lexeme is one (headword, dictionary form, part of speech, Whitaker category). Two lexemes
  // that share a headword but differ in part of speech or category are different words — volō
  // velle and volō volāre — and must not be handed the same senses. V/VPAR of the SAME dictionary
  // form is one word split by part of speech, not a homograph, so it is collapsed first.
  const byHead = new Map();
  for (const entries of Object.values(GLOSSARY)) {
    for (const e of entries) {
      if (!e.h) continue;
      const lex = `${e.lemma}`;
      let m = byHead.get(e.h);
      if (!m) byHead.set(e.h, (m = new Map()));
      // one representative per dictionary form; prefer the finite reading
      if (!m.has(lex) || (m.get(lex).pos === 'VPAR' && e.pos !== 'VPAR')) m.set(lex, e);
    }
  }
  const clashes = [];
  for (const [h, lexemes] of byHead) {
    if (lexemes.size < 2) continue;
    const bySenses = new Map();
    for (const e of lexemes.values()) {
      const k = JSON.stringify(e.senses || []);
      if (!bySenses.has(k)) bySenses.set(k, []);
      bySenses.get(k).push(e);
    }
    for (const [k, group] of bySenses) {
      if (group.length < 2) continue;
      const paradigms = new Set(group.map((e) => `${e.pos}:${JSON.stringify(e.cat || null)}`));
      if (paradigms.size > 1) {
        clashes.push(`${h}: ${group.map((e) => `${e.lemma} [${e.pos} ${JSON.stringify(e.cat)}]`).join(' / ')} both ${k}`);
      }
    }
  }
  // Known and accepted: these are one word Whitaker files twice — an alternative supine or perfect
  // (alō alitum/altum), a variant conjugation of the same verb (bovō -ere/-āre), the same noun in
  // two declensions (colus -ī/-ūs), a gens name beside its adjective. Sharing senses is correct for
  // each. Any headword NOT on this list sharing senses across paradigms is a volō-style fault.
  const ACCEPTED = new Set([
    'alo', 'bovo', 'colus', 'cornus', 'depono', 'desum', 'implico', 'incolo',
    'italus', 'lavo', 'mitto', 'poto', 'quintilius', 'servo', 'sextius', 'tendo', 'tueor',
  ]);
  const unexpected = clashes.filter((c) => !ACCEPTED.has(c.split(':')[0]));
  assert.deepEqual(unexpected, [], `sense list shared across different paradigms:\n${unexpected.join('\n')}`);
  // volō must NOT be on the accepted list, and must not clash.
  assert.ok(!clashes.some((c) => c.startsWith('volo:')), 'volō velle and volō volāre share senses again');
});
