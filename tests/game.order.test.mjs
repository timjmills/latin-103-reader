import { test } from 'node:test';
import assert from 'node:assert/strict';

// game.js touches the DOM only when a game is played; the ordering is pure.
const { byGroup } = await import('../app/js/game.js');

const f = (word, voice, person, group) => ({ key: `${word}|${voice}|${person}`, group, form: { kind: 'finite', voice, person } });

test('byGroup: every active form before any passive one, each column kept together, in the table’s order', () => {
  // a table read row by row: I active, I passive, you active, you passive …
  const rowWise = [];
  for (const p of [1, 2, 3]) for (const v of ['act', 'pass']) rowWise.push(f('vocō', v, p, `vocō|${v}`));
  assert.deepEqual(byGroup(rowWise).map((x) => x.key), ['vocō|act|1', 'vocō|act|2', 'vocō|act|3', 'vocō|pass|1', 'vocō|pass|2', 'vocō|pass|3']);
  // several words: no word's passive comes before another word's active
  const words = [...['amō', 'videō'].flatMap((w) => ['act', 'pass'].flatMap((v) => [1, 2].map((p) => f(w, v, p, `${w}|${v}`))))];
  const out = byGroup(words).map((x) => x.key);
  assert.deepEqual(out, ['amō|act|1', 'amō|act|2', 'videō|act|1', 'videō|act|2', 'amō|pass|1', 'amō|pass|2', 'videō|pass|1', 'videō|pass|2']);
  // forms with no voice (a noun's cases) keep their order
  const cases = [{ key: 'a', group: 'sg', form: { case: 'nom' } }, { key: 'b', group: 'pl', form: { case: 'nom' } }, { key: 'c', group: 'sg', form: { case: 'acc' } }];
  assert.deepEqual(byGroup(cases).map((x) => x.key), ['a', 'c', 'b']);
});
