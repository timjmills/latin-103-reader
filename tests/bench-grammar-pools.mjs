// node tests/bench-grammar-pools.mjs [skill …] — dev only: the drill pools over the real
// glossary and the local build (data/build/week-*.json + review-*.json). Prints per-skill
// pool sizes (all / unambiguous / gold) and, for the named skills, a few generated items.
import { readFileSync, readdirSync } from 'node:fs';
import { setGlossary, lookup } from '../app/js/dictionary.js';
import { paradigm } from '../app/js/paradigms.js';
import { indexSkills } from '../app/js/grammar/lessons.js';
import { createItems } from '../app/js/grammar/items.js';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
setGlossary(read('app/data/glossary.json'), (() => { try { return read('app/data/function-words.json'); } catch { return {}; } })(), (() => { try { return read('app/data/glosses.json'); } catch { return {}; } })());
const index = indexSkills(read('app/data/grammar/skills.json'));
const units = [];
const highlights = new Map();
for (const f of readdirSync(new URL('data/build/', root))) {
  if (/^(week|review)-\d+\.json$/.test(f)) units.push(...read(`data/build/${f}`).units);
  if (/^highlights-week-\d+\.json$/.test(f)) for (const h of read(`data/build/${f}`)) { if (!highlights.has(h.unit_id)) highlights.set(h.unit_id, []); highlights.get(h.unit_id).push(h); }
}
const lessonUnits = new Map();
for (const id of index.skills.keys()) {
  try { const l = read(`app/data/grammar/lessons/${id}.json`); lessonUnits.set(id, (l.core || []).filter((b) => b.type === 'examples').flatMap((b) => b.units || [])); } catch { /* no lesson */ }
}
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const items = createItems({ units, lookup, paradigm, skills: index.skills, storage: mem(), gold: { highlights, lessonUnits } });
const t0 = performance.now();
const rows = [];
for (const id of index.order) {
  const c = items.candidates(id);
  rows.push([id, c.length, c.filter((x) => !x.ambiguous).length, c.filter((x) => x.gold).length, c.filter((x) => x.verified).length]);
}
console.log(`${units.length} units · pools in ${Math.round(performance.now() - t0)} ms`);
console.log('skill | all | unambiguous | gold | verified');
for (const r of rows) console.log(r.join(' | '));
for (const id of process.argv.slice(2)) {
  console.log(`\n== ${id}`);
  for (const kind of ['recognise', 'parse', 'blank', 'chart']) for (const tap of [false, true]) {
    if (kind !== 'recognise' && tap) continue;
    const it = items.generate({ skill: id, kind, stage: kind === 'parse' ? 2 : 1, tap });
    if (!it) { console.log(kind, '→ null'); continue; }
    console.log(`${kind}${tap ? ' (tap)' : ''} → ${it.kind}/${it.input} key=${it.key}`);
    console.log('  Q:', it.prompt.question, it.prompt.la ? `\n  la: ${it.prompt.la.slice(0, 160)}` : '');
    if (it.choices) console.log('  choices:', it.choices.map((c) => `${c.label}${c.correct ? ' ✓' : ''}${c.skill ? ` [${c.skill}]` : ''}`).join(' | '));
    if (it.answer) console.log('  answer:', it.answer.slice(0, 3).join(' / '));
    console.log('  fb:', it.feedback.short);
    if (it.confuse) console.log('  confuse:', JSON.stringify(it.confuse).slice(0, 200));
  }
}
