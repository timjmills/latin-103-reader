// node --test tests/ — the check that a step teaches the sentence it names
// (GRAMMAR-CONTRACT.md §8). `sentenceItem` falls back to another sentence of
// the same skill when the named one cannot carry the asked kind, which is the
// right behaviour but hides a whole class of bug: a focus the scanner cannot
// resolve makes EVERY step of a skill quietly teach a different example, and
// nothing else in the suite notices. Two-word focuses (an ablative absolute,
// *ventūrum esse*), words with no paradigm table (adverbs) and enclitic
// readings were all in that state; these bars record where the data stands and
// may only go up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills, indexCatalogue, normaliseSentences, normaliseGenerated } from '../app/js/grammar/lessons.js';
import { createTeachItems } from '../app/js/grammar/items.js';

const dataDir = new URL('../app/data/', import.meta.url);
const read = (n) => JSON.parse(readFileSync(new URL(n, dataDir), 'utf8'));
setGlossary(read('glossary.json'), read('function-words.json'), read('glosses.json'));
const SKILLS = indexSkills(read('grammar/skills.json')).skills;
const CAT = indexCatalogue(read('grammar/paradigms.json'));
const HW = read('glossary-headwords.json').headwords;
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
// The two metre skills are lesson-only (check_skill_coverage LESSON_ONLY): their sentences are there to be
// scanned, never drilled, so no drill item is expected to be built on them.
const LESSON_ONLY = new Set(['elegiac-couplet', 'prosody-scansion', 'principal-parts']);
const SAMPLE = 12;

function measure() {
  const written = { bad: 0, n: 0, worst: [] };
  const banks = { bad: 0, n: 0, worst: [] };
  for (const f of readdirSync(new URL('grammar/sentences/', dataDir))) {
    const id = f.replace(/\.json$/, '');
    const skill = SKILLS.get(id);
    if (!skill || LESSON_ONLY.has(id)) continue;
    const w = normaliseSentences(read(`grammar/sentences/${f}`), id).sentences;
    const gp = new URL(`grammar/generated/${f}`, dataDir);
    const b = existsSync(gp) ? normaliseGenerated(JSON.parse(readFileSync(gp, 'utf8')), id).sentences.slice(0, SAMPLE) : [];
    const kindsOf = (s) => (s.kinds?.length ? s.kinds : (skill.kinds?.length ? skill.kinds : ['recognise']));
    const run = (set, all) => {
      const t = createTeachItems({ skill, sentences: all, lookup, paradigm, catalogue: CAT, skills: SKILLS, headwords: HW, storage: mem(), rand: () => 0.3 });
      return set.filter((s) => !kindsOf(s).some((k) => { try { return t.sentenceItem({ kind: k, sentence: s.id })?.taught === s.id; } catch { return false; } })).length;
    };
    const bw = run(w, w);
    written.bad += bw; written.n += w.length;
    if (bw) written.worst.push(`${id} ${bw}/${w.length}`);
    if (b.length) { const bb = run(b, [...w, ...b]); banks.bad += bb; banks.n += b.length; if (bb) banks.worst.push(`${id} ${bb}/${b.length}`); }
  }
  return { written, banks };
}
const got = measure();

test('a written sentence can be taught on itself — 99% of the drillable set', () => {
  const pct = 100 * (got.written.n - got.written.bad) / got.written.n;
  assert.ok(pct >= 99, `written yield fell to ${pct.toFixed(1)}% — ${got.written.worst.join(', ')}`);
});

test('a generated sentence can be taught on itself — 90% of a sample of every bank', () => {
  const pct = 100 * (got.banks.n - got.banks.bad) / got.banks.n;
  assert.ok(pct >= 90, `bank yield fell to ${pct.toFixed(1)}% — ${got.banks.worst.join(', ')}`);
});

test('no bank is dead: every skill with a bank can teach some of it', () => {
  const dead = got.banks.worst.filter((r) => { const [, frac] = r.split(' '); const [bad, n] = frac.split('/').map(Number); return bad === n; });
  assert.deepEqual(dead, [], `these banks yield nothing at all: ${dead.join(', ')}`);
});
