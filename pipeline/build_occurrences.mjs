// node pipeline/build_occurrences.mjs [--out app/data/grammar/occurrences.json] [--check]
//
// The reading tie-in (docs/GRAMMAR-CONTRACT.md §10, "Amended the same day"):
// after Learn or a drill, the summary says how many times the construction
// occurs in the learner's chapter and links the chapter with them lit. This
// builds that table once, offline, for every skill × every chapter I–XXXIV:
// **counts and unit ids only — never a word of the book** (PROMPT.md §5).
//
// Two sources, and every entry says which it came from:
//   "h"  the hand-marked highlights whose label names the construction
//        (data/shelf-notes-NN.json for chapters I–XXIV, data/build/
//        highlights-week-NN.json for the course weeks) — authoritative;
//   "s"  the skill's own patterns + parse_filter run through the app's real
//        scanner (app/js/grammar/items.js createItems → scanUnit), for the
//        chapters the highlights do not mark that skill in.
// Where both exist the highlight count is `n` and the scanner count is kept
// beside it as `s`. The chapter → reading map is app/js/chapters.js, read
// here, never re-typed.
//
// A label is matched to a skill by the skill's own `highlight_match` (the
// regex the app uses for gold items) plus LABELS below, which names the
// shelf's plainer labels the app regex does not reach. Both are applied
// macron-stripped and case-insensitively. `--check` prints every label no
// skill claims. Exit status 1 when a build check fails: a highlight names a
// unit id data/build does not hold, or a chapter has no readings.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));

/* ------------------------------------------------------------ labels */
// Pipeline-side label → skill regexes, over macron-stripped lower-case labels.
// They add to a skill's `highlight_match`; a list may name several skills for
// one label ("imperfect subjunctive, purpose clause" is both). Kept honest:
// a label that only names a form ("ablative plural: -is") without saying
// which use is left unclaimed rather than guessed.
export const LABELS = {
  'nominative-subject': [/^nominative/],
  'noun-gender': [/^gender:/, /^neuter plural in -a$/],
  'adjective-agreement': [/^adjective (agreeing|before its noun|first)/, /adjective agreeing/, /a number agreeing/, /adjective after its noun/, /the noun rules the adjective/],
  'enclitics': [/-ne: a yes\/no question/, /-que\b/],
  'genitive-possession': [/^genitive(?!: the whole that is counted)/, /^genitive plural/],
  'genitive-of': [/^genitive: the whole that is counted/],
  'accusative-object': [/^accusative: (the object|object|'him'|'her'|'me'|'you'|'whom|the person questioned|adjective agreeing)/, /^accusative with -que/, /^accusative inside a qui clause/, /^accusative object/],
  'accusative-destination': [/^accusative: (a town name|coming to|goal|the end of a journey|the town entered|where you are going)/, /^accusative plural: the goal/],
  'accusative-infinitive': [/^accusative \+ (passive )?infinitive/],
  'present-indicative-3rd': [/^present tense:/],
  'imperative': [/^imperative/],
  'vocative': [/^vocative/],
  'ablative-place': [/^ablative: where something is/],
  'ablative-accompaniment': [/^ablative: (with whom|a pronoun after cum|three names after one cum|what goes with)/, /^ablative plural: with whom/, /^cum as a preposition/],
  'ablative-origin': [/^ablative: (out of a place|away from|two names after one ab|the source of|where a sound comes from)/],
  'ablative-means': [/^ablative: (the thing used|carried by)/],
  'passive-voice': [/^passive( ending -n?tur|: -n?tur| beside the active|, made negative|: the one feared)/],
  'passive-personal-endings': [/^passive ending -(or|ris|mur|mini)\b/],
  'dative-indirect-object': [/^dative(?! of possession)/, /^cui: the dative/, /dative relative pronoun/, /^personal pronoun, dative/],
  'dative-possession': [/dative of possession/],
  'demonstratives': [/^(hic|ille)\b/],
  'demonstrative-pronouns': [/^is used as a pronoun/, /^ille standing alone/],
  'relative-pronoun': [/^relative pronoun/, /dative relative pronoun/],
  'third-declension': [/^3rd declension:/],
  'third-declension-neuter': [/^3rd declension neuter/],
  'fourth-declension': [/^4th declension/],
  'fifth-declension': [/^5th declension/, /5th declension$/],
  'infinitive': [/^present infinitive/, /^infinitive as the subject/],
  'comparative': [/^comparative/],
  'superlative': [/^superlative/],
  'irregular-comparison': [/^irregular (comparative|superlative)/],
  'adverbs': [/^adverb (in|of language)/, /^numeral adverb/, /^(comparative|superlative) adverb/],
  'present-participle': [/^present participle/, /deponent present participle/],
  'personal-pronouns': [/^personal pronoun/, /^reflexive pronoun/],
  'active-personal-endings': [/^person ending/],
  'irregular-verbs-present': [/^irregular verb (esse|posse|ire)/],
  'deponent-verbs': [/^deponent (verb|with a passive ending)/, /^future of a deponent/],
  'imperfect-active': [/^imperfect active/],
  'imperfect-passive': [/^imperfect passive/],
  'imperfect-irregular': [/^imperfect of (sum|abesse)/],
  'future-active': [/^future active/, /^future, main clause/],
  'future-passive': [/^future passive(?! infinitive)/],
  'future-irregular': [/^future of (sum|posse|ire)/],
  'future-infinitive': [/^future (passive )?infinitive/],
  'future-participle': [/^future participle/],
  'noli-infinitive': [/^nol(i|ite) \+ infinitive/],
  'perfect-active': [/^perfect active(?! infinitive)/, /^perfect of sum/, /^perfect after (postquam|cum primum)/],
  'perfect-infinitive': [/^perfect (active |passive )?infinitive/, /^perfect participle in an infinitive/],
  'perfect-passive-participle': [/^perfect participle/],
  'principal-parts': [/^perfect (active|participle), stem/],
  'pluperfect': [/^pluperfect (active|passive|of sum)/, /^deponent pluperfect/],
  'present-subjunctive': [/^present passive subjunctive/],
  'sequence-of-tenses': [/(primary|secondary) sequence/],
  'dative-verbs': [/^dative (object of|with) /],
  'elegiac-couplet': [/elegiac couplet|hexameter|pentameter|hendecasyllable|epigram/],
  'prosody-scansion': [/caesura|elision|syllable|diphthong|contracted form/],
};
// Where the app's own `highlight_match` reaches a label that names a sibling
// construction, the pipeline steps back: "pluperfect passive" is not the
// perfect passive, a causal or indicative cum is not the narrative cum.
export const LABEL_EXCLUDE = {
  'perfect-passive': [/^(pluperfect|future perfect)/],
  'cum-narrative': [/causal|concessive|indicative|future perfect/],
};

const stripMacrons = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const normLabel = (label) => stripMacrons(label).toLowerCase().trim();

/** The skill ids a highlight label names (the app's highlight_match plus LABELS, minus LABEL_EXCLUDE). Pure. */
export function skillsForLabel(label, skills) {
  const l = normLabel(label);
  const out = [];
  for (const s of skills) {
    const excluded = (LABEL_EXCLUDE[s.id] || []).some((re) => re.test(l));
    if (excluded) continue;
    let hit = false;
    if (s.highlight_match) { try { hit = new RegExp(s.highlight_match.replace(/^\(\?i\)/, ''), 'i').test(l); } catch { hit = false; } }
    if (!hit) hit = (LABELS[s.id] || []).some((re) => re.test(l));
    if (hit) out.push(s.id);
  }
  return out;
}

/* ------------------------------------------------------------ assembly */
/**
 * The table. `chapters`: [{ n, prefixes: [...] }] (from chapters.js); `unitIds`:
 * Set of every unit id in the build; `highlights`: [{ unit_id, label }];
 * `skills`: [{ id, ... }]; `scanned`: Map skill id → [{ unitId, ambiguous }]
 * (one entry per scanner match). Returns { table, errors, unclaimed } and
 * never throws — the caller decides what a failed check means. Pure.
 */
export function assemble({ chapters, unitIds, highlights, skills, scanned }) {
  const errors = [];
  const chapterOf = (id) => { for (const c of chapters) for (const p of c.prefixes) if (id.startsWith(p)) return c.n; return null; };
  const chapterMap = {};
  for (const c of chapters) {
    if (!c.prefixes.length) errors.push(`chapter ${c.n} has no readings`);
    const readings = c.prefixes.map((p) => p.replace(/:$/, ''));
    const has = readings.filter((r) => [...unitIds].some((id) => id.startsWith(r + ':')));
    if (!has.length) errors.push(`chapter ${c.n} has readings but no units in data/build (${readings.join(', ')})`);
    chapterMap[c.n] = { r: readings, hl: [] };
  }
  const hlReadings = new Map();
  const unclaimed = new Map();
  const perSkill = new Map(skills.map((s) => [s.id, new Map()]));
  const cell = (skillId, n) => { const m = perSkill.get(skillId); if (!m.has(n)) m.set(n, { h: 0, hids: new Set(), s: 0, sx: 0, sids: new Set() }); return m.get(n); };
  for (const h of highlights) {
    const id = String(h.unit_id ?? '');
    if (!unitIds.has(id)) { errors.push(`highlight names a unit id not in data/build: ${id}`); continue; }
    const n = chapterOf(id);
    if (n == null) { errors.push(`highlight unit ${id} belongs to no chapter`); continue; }
    const reading = id.slice(0, id.lastIndexOf(':'));
    if (!hlReadings.has(n)) hlReadings.set(n, new Set());
    hlReadings.get(n).add(reading);
    const ids = skillsForLabel(h.label ?? '', skills);
    if (!ids.length) { unclaimed.set(h.label, (unclaimed.get(h.label) || 0) + 1); continue; }
    for (const sid of ids) { const c = cell(sid, n); c.h += 1; c.hids.add(id); }
  }
  for (const [n, set] of hlReadings) chapterMap[n].hl = [...set].sort();
  const orphans = new Set();
  for (const [sid, matches] of scanned) {
    if (!perSkill.has(sid)) continue;
    for (const m of matches) {
      const n = chapterOf(m.unitId);
      if (n == null) { orphans.add(m.unitId); continue; }
      const c = cell(sid, n);
      if (m.ambiguous) c.sx += 1; else { c.s += 1; c.sids.add(m.unitId); }
    }
  }
  const table = {};
  for (const s of skills) {
    const rows = {};
    for (const [n, c] of [...perSkill.get(s.id)].sort((a, b) => a[0] - b[0])) {
      if (!c.h && !c.s && !c.sx) continue;
      const row = c.h ? { src: 'h', n: c.h, h: c.h, s: c.s, ids: packIds(c.hids) } : { src: 's', n: c.s, s: c.s, ids: packIds(c.sids) };
      if (c.sx) row.sx = c.sx;
      rows[n] = row;
    }
    table[s.id] = rows;
  }
  return { table, chapterMap, errors, unclaimed, orphans: [...orphans].sort() };
}

/**
 * Unit ids packed by reading, the reading's prefix factored out and the rest
 * space-joined in reading order: {"r07": "9.1 10.2", "w03:minos": "b1.1"}.
 * `unpackIds` is the inverse. Pure.
 */
export function packIds(ids) {
  const by = new Map();
  for (const id of [...ids].sort(byUnitOrder)) {
    const at = id.lastIndexOf(':');
    const r = id.slice(0, at), tail = id.slice(at + 1);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(tail);
  }
  return Object.fromEntries([...by].map(([r, t]) => [r, t.join(' ')]));
}
export function unpackIds(packed) {
  const out = [];
  for (const [r, t] of Object.entries(packed || {})) for (const x of String(t).split(' ')) if (x) out.push(`${r}:${x}`);
  return out;
}

/** Unit ids in reading order: prefix, then the numeric parts (r07:9.1 before r07:10.1). */
export function byUnitOrder(a, b) {
  const ka = a.split(/[:.]/), kb = b.split(/[:.]/);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i] ?? '', y = kb[i] ?? '';
    const nx = /^b?\d+$/.test(x) ? Number(x.replace('b', '')) : null, ny = /^b?\d+$/.test(y) ? Number(y.replace('b', '')) : null;
    if (nx != null && ny != null) { if (nx !== ny) return nx - ny; continue; }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Everything the file may hold: no key and no value that could carry a word of the book. Pure. */
export function checkShape(doc, skillIds) {
  const errs = [];
  const READING = /^[wrc]\d{2}(:[a-z0-9-]+)?$/;
  const TAILS = /^b?\d+(\.\d+)?( b?\d+(\.\d+)?)*$/;
  if (!doc || typeof doc !== 'object') return ['not an object'];
  for (const sid of skillIds) if (!doc.skills?.[sid]) errs.push(`skill missing: ${sid}`);
  for (const [sid, rows] of Object.entries(doc.skills ?? {})) {
    if (!skillIds.includes(sid)) errs.push(`unknown skill: ${sid}`);
    for (const [n, row] of Object.entries(rows)) {
      if (!/^\d+$/.test(n) || Number(n) < 1 || Number(n) > 34) errs.push(`${sid}: bad chapter ${n}`);
      for (const k of Object.keys(row)) if (!['src', 'n', 'h', 's', 'sx', 'ids'].includes(k)) errs.push(`${sid}/${n}: unexpected key ${k}`);
      if (row.src !== 'h' && row.src !== 's') errs.push(`${sid}/${n}: src must be h or s`);
      if (row.src === 'h' && row.n !== row.h) errs.push(`${sid}/${n}: n must be the highlight count`);
      if (row.src === 's' && row.n !== row.s) errs.push(`${sid}/${n}: n must be the scanner count`);
      const ids = row.ids;
      if (!ids || typeof ids !== 'object' || Array.isArray(ids)) { errs.push(`${sid}/${n}: ids must be an object by reading`); continue; }
      let count = 0;
      for (const [r, t] of Object.entries(ids)) {
        if (!READING.test(r)) errs.push(`${sid}/${n}: bad reading key ${r}`);
        if (typeof t !== 'string' || !TAILS.test(t)) errs.push(`${sid}/${n}/${r}: ids must be unit-id tails`);
        else count += t.split(' ').length;
      }
      if (count > row.n) errs.push(`${sid}/${n}: more ids than occurrences`);
    }
  }
  return errs;
}

/* ------------------------------------------------------------ main */
async function main(argv) {
  const outArg = argv.indexOf('--out');
  const outPath = outArg >= 0 ? argv[outArg + 1] : 'app/data/grammar/occurrences.json';
  const check = argv.includes('--check');

  const [{ chapters, readingPrefix }, dict, { paradigm }, { indexSkills }, { createItems }] = await Promise.all([
    import('../app/js/chapters.js'), import('../app/js/dictionary.js'), import('../app/js/paradigms.js'),
    import('../app/js/grammar/lessons.js'), import('../app/js/grammar/items.js'),
  ]);
  const opt = (p) => { try { return read(p); } catch { return {}; } };
  dict.setGlossary(read('app/data/glossary.json'), opt('app/data/function-words.json'), opt('app/data/glosses.json'));
  const raw = read('app/data/grammar/skills.json');
  const index = indexSkills(raw);
  const skills = raw.skills;

  // Every reading the spine names: review-NN (r), collo-NN (c), week-NN (w).
  const units = [];
  const highlights = [];
  for (const f of readdirSync(new URL('data/build/', ROOT))) {
    if (/^(week|review|collo)-\d+\.json$/.test(f)) units.push(...read(`data/build/${f}`).units);
    if (/^highlights-week-\d+\.json$/.test(f)) highlights.push(...read(`data/build/${f}`));
  }
  for (const f of readdirSync(new URL('data/', ROOT))) {
    if (/^shelf-notes-\d+\.json$/.test(f)) highlights.push(...(read(`data/${f}`).highlights || []));
  }
  const unitIds = new Set(units.map((u) => u.id));

  // The app's own scanner, wired as app/js/grammar/index.js wires it: the course weeks' highlights and
  // the lessons' example sentences are gold; the shelf's highlights are not in the app's gold set.
  const goldHl = new Map();
  for (const h of highlights) { if (!/^w/.test(h.unit_id) || !h.text) continue; if (!goldHl.has(h.unit_id)) goldHl.set(h.unit_id, []); goldHl.get(h.unit_id).push({ text: h.text, label: h.label ?? '', note: h.note ?? '' }); }
  const lessonUnits = new Map();
  for (const id of index.skills.keys()) {
    try { const l = read(`app/data/grammar/lessons/${id}.json`); lessonUnits.set(id, (l.core || []).filter((b) => b.type === 'examples').flatMap((b) => b.units || [])); } catch { /* no lesson */ }
  }
  const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
  const items = createItems({ units, lookup: dict.lookup, paradigm, skills: index.skills, storage: mem(), gold: { highlights: goldHl, lessonUnits } });
  const t0 = performance.now();
  const scanned = new Map();
  for (const s of skills) scanned.set(s.id, items.candidates(s.id).map((c) => ({ unitId: c.unit.id, ambiguous: !!c.ambiguous })));
  const scanMs = Math.round(performance.now() - t0);

  const chapterRows = chapters().map((c) => ({ n: c.n, prefixes: c.readings.map(readingPrefix) }));
  const { table, chapterMap, errors, unclaimed, orphans } = assemble({ chapters: chapterRows, unitIds, highlights, skills, scanned });

  const doc = { version: 1, built: new Date().toISOString().slice(0, 10), chapters: chapterMap, skills: table };
  const shapeErrs = checkShape(doc, skills.map((s) => s.id));
  errors.push(...shapeErrs);

  const json = JSON.stringify(doc);
  const bytes = Buffer.byteLength(json, 'utf8');
  const gz = gzipSync(Buffer.from(json)).length;
  if (!errors.length) writeFileSync(new URL(outPath, ROOT), json + '\n');

  // Report.
  const hlUnits = highlights.length;
  let totH = 0, totS = 0, cellsH = 0, cellsS = 0;
  const perSkill = [];
  for (const s of skills) {
    let h = 0, sc = 0, sOnly = 0, chH = 0, chS = 0;
    for (const row of Object.values(table[s.id])) { if (row.src === 'h') { h += row.h; sc += row.s; chH++; } else { sOnly += row.s; chS++; } }
    totH += h; totS += sOnly; cellsH += chH; cellsS += chS;
    perSkill.push([s.id, h, sc, sOnly, chH, chS]);
  }
  console.log(`${units.length} units · ${hlUnits} highlights · ${skills.length} skills · scanner ${scanMs} ms`);
  console.log(`${outPath}: ${bytes} bytes (${gz} gzipped)${errors.length ? ' — NOT WRITTEN' : ''}`);
  console.log(`cells from highlights: ${cellsH} (${totH} occurrences; the scanner counts ${perSkill.reduce((a, r) => a + r[2], 0)} beside them) · cells from the scanner only: ${cellsS} (${totS} occurrences)`);
  console.log('skill | highlight occ | scanner beside | scanner-only occ | chapters(h) | chapters(s)');
  for (const r of perSkill) console.log(r.join(' | '));
  if (check || unclaimed.size) {
    console.log(`\n${unclaimed.size} labels no skill claims (${[...unclaimed.values()].reduce((a, b) => a + b, 0)} highlights):`);
    if (check) for (const [l, c] of [...unclaimed].sort((a, b) => b[1] - a[1])) console.log(`  ${c}  ${l}`);
  }
  if (orphans.length) console.log(`\n${orphans.length} scanned units belong to no chapter (first: ${orphans.slice(0, 5).join(', ')})`);
  if (errors.length) { console.error(`\n${errors.length} build check(s) failed:`); for (const e of errors) console.error('  ' + e); process.exit(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
