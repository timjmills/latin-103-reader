#!/usr/bin/env node
// Dev-only fixture generator for workstream D (Reader UI).
// Builds data/build/week-01.json, data/build/highlights-week-01.json and
// data/build/weeks.json from the hand-aligned Week 1 data, in the CONTRACT.md
// shape, so the UI can be exercised before the A/C pipelines land. A and C
// overwrite these files with real output; this script never runs in app/.
//
//   node tests/make-fixture.mjs            (writes only files that are missing)
//   node tests/make-fixture.mjs --force    (overwrites)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const out = join(root, 'data', 'build');
mkdirSync(out, { recursive: true });

const blocks = JSON.parse(readFileSync(join(root, 'data/week01-aligned-sentences.json'), 'utf8'));
const notes = JSON.parse(readFileSync(join(root, 'data/grammar-notes-week01.json'), 'utf8'));

// "[With Quintus being silent]" style alternatives → strip; collapse doubled spaces.
function cleanEn(en) {
  return en.replace(/\s*\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
}
function tagsFrom(en) {
  const tags = [];
  for (const m of en.matchAll(/\[([^\]]*)\]/g)) {
    const t = m[1];
    const colon = t.indexOf(':');
    if (colon > 0) tags.push({ label: t.slice(0, colon).trim().toLowerCase(), la: t.slice(colon + 1).trim(), kind: 'construction' });
    else tags.push({ label: t.trim(), la: null, kind: 'gloss' });
  }
  return tags;
}

const partsSeen = new Map();
const units = [];
let order = 0;
for (const b of blocks) {
  if (!partsSeen.has(b.part)) partsSeen.set(b.part, { part: b.part, lines: b.lines });
  b.sents.forEach((s, i) => {
    units.push({
      id: `w01:${s.id}`,
      order: order++,
      part: b.part,
      line_no: b.line,
      block_start: i === 0,
      unit_type: 'sentence',
      speaker: null,
      la: s.la,
      en: cleanEn(s.en),
      en_raw: s.en,
      note: notes[s.id] ?? null,
      tags: tagsFrom(s.en),
    });
  });
}

const week = {
  n: 1,
  id: 'w01',
  title: 'Thēseus et Mīnōtaurus',
  source: 'FR',
  chapter: 'XXV',
  has_line_numbers: true,
  focus: {
    key: 'deponent',
    label: 'Deponent verbs',
    blurb: 'Verbs that look passive but mean active — watch the imperatives in -re and -minī.',
  },
  parts: [...partsSeen.values()],
};

const highlights = [
  { unit_id: 'w01:91.1', text: 'Laetāminī', label: 'deponent imperative, plural',
    note: "Command to the citizens: 'rejoice!'. Deponent, so the -minī ending looks passive but the meaning is active." },
  { unit_id: 'w01:91.2', text: 'Intuēminī', label: 'deponent imperative, plural',
    note: "'Look at my bloody sword!' — a plural command to the same citizens. Deponent: passive shape, active sense." },
  { unit_id: 'w01:91.3', text: 'Sequiminī', label: 'deponent imperative, plural',
    note: "'Follow me to the harbour!' The -minī ending marks a plural command on a deponent verb." },
  { unit_id: 'w01:91.5', text: 'sequere', label: 'deponent imperative, singular',
    note: "Theseus turns to Ariadne alone: 'follow me'. Singular deponent imperative in -re; it looks like an infinitive but is a command." },
  { unit_id: 'w01:91.6', text: 'Proficīscere', label: 'deponent imperative, singular',
    note: "'Set out with me to Athens!' Another singular command in -re from a deponent verb (proficīscor)." },
  { unit_id: 'w01:63.10', text: 'Opperīre', label: 'deponent imperative, singular',
    note: "Theseus to Ariadne: 'wait for me here'. opperior is deponent, so its singular imperative ends in -re." },
];

function write(name, data) {
  const p = join(out, name);
  if (existsSync(p) && !force) { console.log(`keep   ${p}`); return; }
  writeFileSync(p, JSON.stringify(data, null, 1) + '\n', 'utf8');
  console.log(`wrote  ${p}`);
}
write('week-01.json', { week, units });
write('highlights-week-01.json', highlights);
write('weeks.json', [week]);
console.log(`${units.length} units, ${highlights.length} highlights`);
