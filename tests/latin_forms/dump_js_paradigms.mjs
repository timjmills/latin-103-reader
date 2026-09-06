// Dump app/js/paradigms.js tables as JSON so tests/latin_forms/test_parity.py can
// compare them cell for cell with pipeline/latin_forms.py.
//
//   node tests/latin_forms/dump_js_paradigms.mjs entries.json > cells.json
//
// entries.json is a list of glossary entries; the output is, per entry, the list
// of [section title, row label, column index, cell text] of every non-empty cell.
import { readFileSync } from 'node:fs';
import { paradigm } from '../../app/js/paradigms.js';

const entries = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = entries.map((e) => {
  const p = paradigm(e, []);
  if (!p) return null;
  const cells = [];
  for (const s of p.sections) {
    for (const r of s.rows) {
      r.cells.forEach((c, i) => {
        if (c.empty) return;
        cells.push([s.title, r.label, i, c.text]);
      });
    }
  }
  return { title: p.title, note: p.note ?? null, cells };
});
process.stdout.write(JSON.stringify(out));
