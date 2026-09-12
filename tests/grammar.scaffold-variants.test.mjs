// node --test tests/ — GRAMMAR-CONTRACT.md §19: a scaffolded table comes up in
// **different valid arrangements** on different attempts, so practising 80%
// three times is three exercises and not one memorised picture. Over the real
// catalogue in `app/data/grammar/paradigms.json`, not a fixture, because what
// is being tested is a property of real tables: which of their cells print the
// same form, and how those groups happen to add up.
//
//   1  a variant is a number: 0 — the first meeting — is the settled table;
//   2  the same variant is always the same table, different ones are not;
//   3  the count a level gives never moves with the variant;
//   4  every invariant of §12 survives every variant: same-form cells all or
//      none, the taught cell never given, no given cell answering a blank one,
//      the anchors still preferred, at least one cell left to fill;
//   5  the variety is real and measured — over eight variants the cells the
//      learner has to fill cover far more of the table than one fixed
//      arrangement's do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills, indexCatalogue } from '../app/js/grammar/lessons.js';
import { createCatalogueItems, normaliseAnswer } from '../app/js/grammar/items.js';
import { scaffoldGiven, scaffoldItem, scaffoldLeak, scaffoldVariant, isAnchorKey, chartCellKey } from '../app/js/grammar/session.js';

const dataDir = new URL('../app/data/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dataDir), 'utf8'));
setGlossary(read('glossary.json'), read('function-words.json'), read('glosses.json'));
const SKILLS = indexSkills(read('grammar/skills.json')).skills;
const CAT = indexCatalogue(read('grammar/paradigms.json'));
const HEADWORDS = read('glossary-headwords.json').headwords;
const items = () => createCatalogueItems({ catalogue: CAT, lookup, paradigm, headwords: HEADWORDS, skills: SKILLS });

const LEVELS = [80, 50, 20];
const VARIANTS = 8;
const idsOf = (item, given) => given.map((i) => item.chart.cells[i].cellId);
/** The same-form groups of a table, worked out here rather than read off the module under test. */
function sameFormGroups(item) {
  const byForm = new Map();
  item.chart.cells.forEach((c, i) => { for (const a of c.answer ?? []) { const f = normaliseAnswer(a); if (!f) continue; if (!byForm.has(f)) byForm.set(f, []); byForm.get(f).push(i); } });
  return [...byForm.values()].filter((g) => g.length > 1);
}
/** Every table/word pair the sweep runs over — two stock words a table is enough to meet every shape. */
function* sweep() {
  const ci = items();
  for (const [id, t] of CAT.tables) for (const w of t.stock.slice(0, 2)) {
    const item = ci.tableItem({ tableId: id, word: w });
    if (item && item.chart.cells.length > 1) yield { id, word: w.h, item };
  }
}

test('a variant is a whole number of tables already answered; 0 — the first meeting — is the settled arrangement', () => {
  assert.equal(scaffoldVariant(0), 0);
  assert.equal(scaffoldVariant(undefined), 0);
  assert.equal(scaffoldVariant(null), 0);
  assert.equal(scaffoldVariant('nonsense'), 0);
  assert.equal(scaffoldVariant(-4), 0, 'a count that has gone backwards is the first meeting again, not a crash');
  assert.equal(scaffoldVariant(3), 3);
  assert.equal(scaffoldVariant('3'), 3);
  assert.equal(scaffoldVariant(3.7), 3);
  // Variant 0 is what the caller passes on the very first attempt at a table, and it is the table §12
  // describes: the anchors first, then the rest in reading order. Omitting the option gives the same.
  const item = items().tableItem({ tableId: 'decl1', word: 'puella' });
  assert.equal(item.chart.cells.length, 12);
  for (const pc of LEVELS) assert.deepEqual(scaffoldGiven(item, { percent: pc, variant: 0 }), scaffoldGiven(item, { percent: pc }), `${pc}%`);
  const first = idsOf(item, scaffoldGiven(item, { percent: 80, variant: 0 }));
  assert.ok(first.includes('nom.sg') && first.includes('gen.sg'), 'the dictionary-form cells are given at the first meeting');
});

test('the same variant is always the same table; different variants are genuinely different tables', () => {
  const item = items().tableItem({ tableId: 'decl1', word: 'puella' });
  // Reproducible: a test can pin a variant, and a learner who comes back to the same attempt sees the same table.
  for (const pc of LEVELS) for (const v of [0, 1, 5, 97]) {
    assert.deepEqual(scaffoldGiven(item, { percent: pc, variant: v }), scaffoldGiven(item, { percent: pc, variant: v }), `${pc}% variant ${v} is not stable`);
  }
  // Different: over eight attempts at a level the learner meets several different tables, not one.
  for (const pc of LEVELS) {
    const seen = new Set();
    for (let v = 0; v < VARIANTS; v += 1) seen.add(scaffoldGiven(item, { percent: pc, variant: v }).join(','));
    assert.ok(seen.size >= 3, `${pc}%: only ${seen.size} arrangement(s) over ${VARIANTS} variants`);
  }
  // And across the whole catalogue, not just this one table: a table with more than one way to make its
  // level offers more than one table. (A table whose groups can only add up one way is allowed to be fixed —
  // 20% of a twelve-cell noun is two cells, and there are only so many pairs.)
  let varied = 0; let total = 0;
  for (const { item: it } of sweep()) {
    const seen = new Set();
    for (let v = 0; v < VARIANTS; v += 1) seen.add(scaffoldGiven(it, { percent: 80, variant: v }).join(','));
    total += 1; if (seen.size > 1) varied += 1;
  }
  assert.ok(total > 40, `tables swept: ${total}`);
  assert.ok(varied / total > 0.75, `only ${varied} of ${total} tables vary at 80%`);
});

test('the count a level gives is the level\'s, not the variant\'s: 80% is the same size table every time', () => {
  let checked = 0;
  for (const { id, word, item } of sweep()) {
    for (const pc of LEVELS) {
      const counts = new Set();
      for (let v = 0; v < VARIANTS; v += 1) counts.add(scaffoldGiven(item, { percent: pc, variant: v }).length);
      assert.equal(counts.size, 1, `${id} ${word} at ${pc}%: the variant changed the size — ${[...counts].join('/')}`);
      const n = [...counts][0];
      assert.ok(n > 0 && n < item.chart.cells.length, `${id} ${word} at ${pc}%: ${n} of ${item.chart.cells.length} given`);
      checked += 1;
    }
  }
  assert.ok(checked > 120, `checked: ${checked}`);
});

test('every variant is a valid table: same-form cells all or none, no given cell answering a blank one, the anchors still preferred', () => {
  let checked = 0; let anchored = 0; let anchorable = 0;
  for (const { id, word, item } of sweep()) {
    const groups = sameFormGroups(item);
    const anchors = item.chart.cells.map((c, i) => (isAnchorKey(chartCellKey(item, c)) ? i : -1)).filter((i) => i >= 0);
    for (const pc of LEVELS) {
      for (let v = 0; v < VARIANTS; v += 1) {
        const given = scaffoldGiven(item, { percent: pc, variant: v });
        const set = new Set(given);
        for (const g of groups) {
          const inside = g.filter((i) => set.has(i)).length;
          assert.ok(inside === 0 || inside === g.length, `${id} ${word} ${pc}% v${v}: ${item.chart.cells[g[0]].answer[0]} is given in ${inside} of ${g.length} cells`);
        }
        assert.deepEqual(scaffoldLeak(scaffoldItem(item, given)), [], `${id} ${word} ${pc}% v${v}: a given cell answers a blank one`);
        checked += 1;
      }
      // Preference, not a rule (§12): an anchor is given wherever its group of same-form cells fits the
      // level's count. It is passed over only for that arithmetic, and never because of the variant — so
      // whether the anchors are given must not itself change from variant to variant.
      if (!anchors.length) continue;
      const has = [];
      for (let v = 0; v < VARIANTS; v += 1) { const set = new Set(scaffoldGiven(item, { percent: pc, variant: v })); has.push(anchors.every((i) => set.has(i))); }
      assert.equal(new Set(has).size, 1, `${id} ${word} at ${pc}%: the variant decided whether the anchors were given`);
      anchorable += 1; if (has[0]) anchored += 1;
    }
  }
  assert.ok(checked > 1000, `checked: ${checked}`);
  assert.ok(anchored / anchorable > 0.5, `the anchors were given in only ${anchored} of ${anchorable} table/level pairs`);
});

test('the cell a step teaches is never given, at any variant — nor any cell that prints the same form as it', () => {
  const item = items().tableItem({ tableId: 'decl1', word: 'puella' });
  // puellae is the genitive singular, the dative singular, the nominative plural and the vocative plural:
  // teach the dative and all four stay blank, however the variant shuffles the rest.
  const family = ['dat.sg', 'gen.sg', 'nom.pl', 'voc.pl'];
  for (const pc of LEVELS) for (let v = 0; v < VARIANTS; v += 1) {
    const ids = idsOf(item, scaffoldGiven(item, { percent: pc, taught: ['dat.sg'], variant: v }));
    for (const id of family) assert.ok(!ids.includes(id), `${pc}% v${v}: ${id} was given`);
  }
  // The same over the catalogue: the first cell of every table, taught, is never handed back.
  for (const { id, word, item: it } of sweep()) {
    const taughtId = it.chart.cells[0].cellId;
    if (!taughtId) continue;
    for (let v = 0; v < VARIANTS; v += 1) {
      const ids = idsOf(it, scaffoldGiven(it, { percent: 80, taught: [taughtId], variant: v }));
      assert.ok(!ids.includes(taughtId), `${id} ${word} v${v}: the taught ${taughtId} was given`);
    }
  }
});

test('the variety is real: over eight variants the cells the learner fills cover far more of the table than one arrangement does', () => {
  // The measure §19 reports. For each table and level: the union of the given cells over eight variants
  // against one fixed arrangement's, and — the one the learner feels — the union of the *blank* cells,
  // which is how much of the table they are ever asked to write.
  const totals = {};
  for (const pc of LEVELS) {
    let cells = 0; let fixedGiven = 0; let unionGiven = 0; let fixedBlank = 0; let unionBlank = 0;
    for (const { item } of sweep()) {
      const n = item.chart.cells.length;
      const gU = new Set(); const bU = new Set();
      for (let v = 0; v < VARIANTS; v += 1) {
        const given = scaffoldGiven(item, { percent: pc, variant: v });
        const set = new Set(given);
        for (const i of given) gU.add(i);
        for (let i = 0; i < n; i += 1) if (!set.has(i)) bU.add(i);
      }
      const one = scaffoldGiven(item, { percent: pc, variant: 0 });
      cells += n; fixedGiven += one.length; unionGiven += gU.size; fixedBlank += n - one.length; unionBlank += bU.size;
    }
    totals[pc] = { cells, fixedGiven, unionGiven, fixedBlank, unionBlank };
  }
  const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
  for (const pc of LEVELS) {
    const t = totals[pc];
    console.log(`  ${pc}%: given ${pct(t.fixedGiven, t.cells)} fixed → ${pct(t.unionGiven, t.cells)} over ${VARIANTS} variants; filled by the learner ${pct(t.fixedBlank, t.cells)} → ${pct(t.unionBlank, t.cells)}`);
  }
  // 80% is the level the learner asked about: one fixed arrangement leaves about a fifth of the table to
  // fill and always the same fifth. Measured over the catalogue, eight variants take that past two thirds.
  assert.ok(totals[80].unionBlank / totals[80].fixedBlank > 2.5, `80%: blank cells only ${(totals[80].unionBlank / totals[80].fixedBlank).toFixed(2)}× a fixed arrangement's`);
  assert.ok(totals[80].unionBlank / totals[80].cells > 0.6, `80%: only ${pct(totals[80].unionBlank, totals[80].cells)} of the cells are ever filled by the learner`);
  assert.ok(totals[80].unionGiven / totals[80].cells > 0.95, `80%: only ${pct(totals[80].unionGiven, totals[80].cells)} of the cells are ever given`);
  for (const pc of LEVELS) assert.ok(totals[pc].unionGiven > totals[pc].fixedGiven, `${pc}%: the variants cover no more than one arrangement`);
});
