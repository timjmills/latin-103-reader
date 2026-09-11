// Dump every inflected FORM app/js/paradigms.js produces for a list of
// glossary entries, with the structured key of its cell, so a Python check
// can ask "which parse features does this written form really carry?" for
// forms the book-keyed glossary never saw (the purpose-written teaching
// sentences of docs/GRAMMAR-CONTRACT.md §1).
//
//   node tests/latin_forms/dump_js_forms.mjs entries.json > forms.json
//
// Per entry: { h, pos, kind, gender, forms: [{ text, key }, …] } or null when
// the entry has no table. A verb's perfect and future participles are printed
// undeclined by paradigms.js ("secūtus -a -um"), so each is also declined here
// through paradigms.js's own 1st/2nd-declension adjective table (the same move
// paradigms.js makes for ordinals), and those cells carry kind "ptcdecl" with
// the participle's tense and voice beside case, number and gender. A cell
// printing two alternatives ("futūrus esse / fore") is split into both.
import { readFileSync } from 'node:fs';
import { paradigm } from '../../app/js/paradigms.js';

function collect(p, out, extra) {
  for (const s of p.sections) {
    for (const r of s.rows) {
      for (const c of r.cells) {
        if (c.empty || !c.key) continue;
        for (const text of String(c.text).split(' / ')) {
          out.push({ text: text.trim(), key: { ...c.key, ...extra } });
        }
      }
    }
  }
}

function declineParticiple(entry, cell, out) {
  // "secūtus -a -um" (perf) / "scrīptūrus -a -um" (fut): the adjective stem is
  // the cell's stem plus whatever precedes the "-us -a -um".
  const m = /^(.*?)us -a -um$/.exec(cell.ending || '');
  if (!m) return;
  const stem = cell.stem + m[1];
  const fake = { lemma: `${stem}us -a -um`, h: entry.h, pos: 'ADJ', cat: [1, 1], roots: [stem, stem, '-', '-'], enc: null };
  const p = paradigm(fake, []);
  if (!p) return;
  const extra = { kind: 'ptcdecl', tense: cell.key.tense, voice: cell.key.voice };
  const tmp = [];
  collect(p, tmp, extra);
  for (const f of tmp) {
    delete f.key.degree;
    out.push(f);
  }
}

const entries = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = entries.map((e) => {
  const p = paradigm(e, []);
  if (!p) return null;
  const forms = [];
  collect(p, forms, {});
  if (e.pos === 'V' || e.pos === 'VPAR') {
    for (const s of p.sections) {
      for (const r of s.rows) {
        for (const c of r.cells) {
          if (c.empty || !c.key || c.key.kind !== 'ptc') continue;
          declineParticiple(e, c, forms);
        }
      }
    }
  }
  return { h: e.h, pos: e.pos, kind: e.kind ?? null, gender: e.gender ?? null, lemma: e.lemma, forms };
});
process.stdout.write(JSON.stringify(out));
