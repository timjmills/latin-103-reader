// Dump the CATALOGUE IDS app/js/paradigms.js's own cells produce, so
// pipeline/test_build_paradigm_catalogue.py can prove that the ids in
// app/data/grammar/paradigms.json are the ids the app will compute.
//
//   node tests/latin_forms/dump_js_cell_ids.mjs entries.json > ids.json
//
// entries.json is a list of glossary entries.  Per entry the output is
// { kind, cells: [[group id, cell id], …] } — or null when the entry has no
// table.  The two functions below are the whole of the id scheme
// (docs/GRAMMAR-CONTRACT.md §4): they read the structured key paradigms.js
// already puts on every cell, and never a section, row or column index.
import { readFileSync } from 'node:fs';
import { paradigm } from '../../app/js/paradigms.js';

const SLOT_ORDER = ['degree', 'tense', 'mood', 'voice', 'person', 'case', 'number', 'gender'];
const KIND_PREFIX = new Set(['imper', 'inf', 'ptc', 'gerund', 'supine']);

/** The stable id of one cell, from its key. `tableKind` is paradigm.kind. */
export function cellId(key, tableKind) {
  if (key.kind === 'gerundive') return 'gerundive';
  const slots = Object.fromEntries(SLOT_ORDER.map((s) => [s, key[s]]));
  if (key.kind === 'nominal' && tableKind === 'noun') slots.gender = null;
  if (key.kind === 'imper' && !slots.tense) slots.tense = 'pres';
  const body = SLOT_ORDER.filter((s) => slots[s]).map((s) => String(slots[s]));
  if (key.kind === 'nominal' || key.kind === 'finite') return body.join('.');
  if (!KIND_PREFIX.has(key.kind)) throw new Error(`unknown cell kind ${key.kind}`);
  return [key.kind, ...body].join('.');
}

/** The stable id of one section, from the keys of its cells. */
export function groupId(section) {
  const keys = section.rows.flatMap((r) => r.cells.map((c) => c.key).filter(Boolean));
  const kinds = new Set(keys.map((k) => k.kind));
  if (kinds.size === 1 && kinds.has('finite')) {
    const tenses = new Set(keys.map((k) => k.tense));
    const moods = new Set(keys.map((k) => k.mood));
    if (tenses.size === 1 && moods.size === 1) return `${[...tenses][0]}.${[...moods][0]}`;
  }
  if (kinds.size === 1 && kinds.has('nominal')) {
    const degrees = new Set(keys.map((k) => k.degree ?? null));
    if (degrees.size === 1) return [...degrees][0] ?? 'cases';
  }
  if ([...kinds].every((k) => k === 'ptc' || k === 'gerundive')) return 'ptc';
  if (kinds.size === 1 && KIND_PREFIX.has([...kinds][0])) return [...kinds][0];
  throw new Error(`cannot name the section ${section.title}`);
}

if (process.argv[2]) {
  const entries = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const out = entries.map((e) => {
    const p = paradigm(e, []);
    if (!p) return null;
    const cells = [];
    for (const s of p.sections) {
      const gid = groupId(s);
      for (const r of s.rows) {
        for (const c of r.cells) {
          if (c.empty || !c.key) continue;
          cells.push([gid, cellId(c.key, p.kind)]);
        }
      }
    }
    return { kind: p.kind, title: p.title, cells };
  });
  process.stdout.write(JSON.stringify(out));
}
