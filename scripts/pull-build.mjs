#!/usr/bin/env node
// Rebuild data/build from Supabase — seed.mjs in reverse, as the signed-in user.
//
//   node scripts/pull-build.mjs              write every week, shelf and colloquium
//   node scripts/pull-build.mjs --dry-run    count what is there, write nothing
//   node scripts/pull-build.mjs --verify     write, then check the files against the database
//   node scripts/pull-build.mjs --weeks 1,3  only those course weeks
//
// Credentials: SEED_EMAIL / SEED_PASSWORD in .env (gitignored) or the environment,
// otherwise you are prompted, exactly as seed.mjs does.
//
// **Why this exists.** `data/build` is a derived cache: the book's text lives in
// Supabase and the course weeks are built from `source/week-NN.md`. There was a
// script to push it up and none to pull it down, so the cache was a single point
// of failure — and on 2026-09-12 an agent's cleanup followed a junction into it
// and emptied it. Nothing was lost, because the database had all of it; but
// "nothing was lost" took an hour to establish and a script to act on. One
// command now rebuilds the whole cache from the only copy that matters.
//
// It writes only what the database can answer for. The course weeks (n 1–14)
// come out of `source/` with `pipeline/build_week.py` and are better rebuilt
// there — this writes them too, so a cold machine gets a complete cache, but
// the pipeline's own reports and the derived glossary/catalogue files are the
// pipeline's business, not this script's.
//
// This never writes to Supabase. Every call is a GET.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadEnv, loadConfig, credentials, signIn, client, pad2 } from './lib/supa.mjs';

const BUILD = join(ROOT, 'data', 'build');
const PAGE = 1000;   // PostgREST caps a response; units run to ~5,900 rows

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verify = args.includes('--verify');
const weeksArg = args.includes('--weeks') ? args[args.indexOf('--weeks') + 1] : null;
const onlyWeeks = weeksArg ? new Set(weeksArg.split(',').map((s) => Number(s.trim())).filter(Number.isFinite)) : null;

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  !', ...a);

/** A week's file name and kind, from its number alone: 1–99 course, 101–124 shelf, 201+ colloquia. */
function fileFor(n) {
  if (n >= 200) return { name: `collo-${pad2(n - 200)}.json`, kind: 'colloquium' };
  if (n >= 100) return { name: `review-${pad2(n - 100)}.json`, kind: 'review shelf' };
  return { name: `week-${pad2(n)}.json`, kind: 'course week' };
}

/** Every row of a table, a page at a time — PostgREST will not hand over 5,857 units in one go. */
async function all(api, path, order) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await api.get(`${path}${sep}order=${order}&limit=${PAGE}&offset=${from}`);
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** The columns each file carries, in the order build_week.py writes them. */
const weekDoc = (w) => ({
  n: w.n, id: w.id, title: w.title, source: w.source, chapter: w.chapter ?? null,
  has_line_numbers: Boolean(w.has_line_numbers), focus: w.focus ?? null, parts: w.parts ?? [],
});
const unitDoc = (u) => ({
  id: u.id, order: u.order, part: u.part ?? null, source: u.source ?? null,
  line_no: u.line_no ?? null, block_start: Boolean(u.block_start), unit_type: u.unit_type || 'sentence',
  speaker: u.speaker ?? null, la: u.la, en: u.en ?? '', en_raw: u.en_raw ?? null,
  note: u.note ?? null, tags: u.tags ?? [], margin: Array.isArray(u.margin) && u.margin.length ? u.margin : undefined,
});

const write = (name, data) => {
  if (dryRun) return;
  const file = join(BUILD, name);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

async function main() {
  loadEnv();
  const cfg = await loadConfig();
  if (dryRun) log('Dry run — signing in to count, writing nothing.\n');
  const api = client(cfg, await signIn(cfg, await credentials()));

  const weeks = (await all(api, '/rest/v1/weeks?select=*', 'n.asc'))
    .filter((w) => !onlyWeeks || w.n >= 100 || onlyWeeks.has(w.n));
  const units = await all(api, '/rest/v1/units?select=*', 'week_n.asc,order.asc');
  const highlights = await all(api, '/rest/v1/highlights?select=*', 'week_n.asc');
  const pictures = await all(api, '/rest/v1/pictures?select=*', 'week_n.asc');
  const aligns = await all(api, '/rest/v1/audio_alignments?select=*', 'week_n.asc');
  const pensa = await all(api, '/rest/v1/pensa?select=*', 'chapter.asc');

  log(`weeks ${weeks.length} · units ${units.length} · highlights ${highlights.length} · `
    + `pictures ${pictures.length} · alignments ${aligns.length} · pensa ${pensa.length}\n`);

  const byWeek = new Map();
  for (const u of units) { if (!byWeek.has(u.week_n)) byWeek.set(u.week_n, []); byWeek.get(u.week_n).push(u); }

  const index = [];
  for (const w of weeks) {
    const mine = byWeek.get(w.n) ?? [];
    const { name, kind } = fileFor(w.n);
    if (!mine.length) warn(`${kind} ${w.n} (${w.id}) has no units in the database — writing an empty ${name}`);
    write(name, { week: weekDoc(w), units: mine.map(unitDoc) });
    if (w.n < 100) index.push({ ...weekDoc(w), unit_count: mine.length });
    log(`  ${name.padEnd(16)} ${String(mine.length).padStart(4)} units  (${kind})`);
  }
  if (index.length) write('weeks.json', index);

  const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  for (const [n, rows] of group(highlights, 'week_n')) {
    write(`highlights-week-${pad2(n)}.json`, rows.map(({ unit_id, text, occurrence, label, note }) => ({ unit_id, text, occurrence, label, note })));
  }
  for (const [n, rows] of group(pictures, 'week_n')) write(`pictures-week-${pad2(n)}.json`, rows);
  for (const [n, rows] of group(aligns, 'week_n')) {
    write(join('audio', `week-${pad2(n)}.alignment.json`), rows.map(({ unit_id, ms }) => ({ unit_id, ms })));
  }
  if (pensa.length) write('pensa.json', pensa);

  if (dryRun) { log('\nNothing written (--dry-run).'); return; }
  log(`\nWritten to ${BUILD}`);

  if (verify) {
    // The point of the check: a copyright gate run against a *partial* corpus reports clean because it
    // has less to compare against, which is the most dangerous way for this cache to be wrong.
    let bad = 0;
    const onDisk = weeks.reduce((sum, w) => {
      const f = join(BUILD, fileFor(w.n).name);
      if (!existsSync(f)) { warn(`missing ${fileFor(w.n).name}`); bad += 1; return sum; }
      return sum + JSON.parse(readFileSync(f, 'utf8')).units.length;
    }, 0);
    log(`\nverify: ${onDisk} units on disk vs ${units.length} in the database — ${onDisk === units.length && !bad ? 'MATCH' : 'MISMATCH'}`);
    if (onDisk !== units.length || bad) process.exitCode = 1;
  }
}

main().catch((e) => { console.error(`\npull-build failed: ${e.message}`); process.exitCode = 1; });
