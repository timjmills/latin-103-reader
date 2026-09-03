#!/usr/bin/env node
// Seed Supabase with the pipeline output, as the signed-in user.
//
//   node scripts/seed.mjs                 seed every data/build/week-NN.json present
//   node scripts/seed.mjs --weeks 1,3     only those weeks
//   node scripts/seed.mjs --dry-run       show what would be sent, no sign-in, no network
//
// Credentials: SEED_EMAIL / SEED_PASSWORD in .env (gitignored) or the environment,
// otherwise you are prompted. Re-running is safe: weeks and units are upserted,
// units that vanished from the JSON are deleted, highlights are replaced per week,
// and the week's updated_at is bumped so devices re-download that week.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadConfig, credentials, signIn, client, chunk, pad2 } from './lib/supa.mjs';

const BUILD = join(ROOT, 'data', 'build');
const BATCH = 200;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const weeksArg = args.includes('--weeks') ? args[args.indexOf('--weeks') + 1] : null;
const onlyWeeks = weeksArg ? new Set(weeksArg.split(',').map((s) => Number(s.trim())).filter(Boolean)) : null;

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('  !', ...a);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function discoverWeeks() {
  if (!existsSync(BUILD)) throw new Error(`Missing ${BUILD}. Run the pipeline first (see pipeline/README.md).`);
  const files = readdirSync(BUILD).filter((f) => /^week-\d\d\.json$/.test(f)).sort();
  const weeks = [];
  for (const f of files) {
    const n = Number(f.slice(5, 7));
    if (onlyWeeks && !onlyWeeks.has(n)) continue;
    const doc = readJson(join(BUILD, f));
    const hlFile = join(BUILD, `highlights-week-${pad2(n)}.json`);
    const highlights = existsSync(hlFile) ? readJson(hlFile) : [];
    weeks.push({ n, file: f, week: doc.week, units: doc.units, highlights, hasHighlightFile: existsSync(hlFile) });
  }
  return weeks;
}

function validate({ n, week, units, highlights }) {
  const problems = [];
  if (!week || week.n !== n) problems.push(`week.n (${week?.n}) does not match file week-${pad2(n)}.json`);
  if (!week?.id || !week?.title || !week?.source) problems.push('week needs id, title, source');
  const ids = new Set();
  units.forEach((u, i) => {
    if (!u.id) problems.push(`unit #${i} has no id`);
    if (ids.has(u.id)) problems.push(`duplicate unit id ${u.id}`);
    ids.add(u.id);
    if (typeof u.la !== 'string' || !u.la.trim()) problems.push(`unit ${u.id} has empty la`);
    if (u.order !== i) problems.push(`unit ${u.id} has order ${u.order}, expected ${i}`);
  });
  const byId = new Map(units.map((u) => [u.id, u]));
  highlights.forEach((h, i) => {
    const u = byId.get(h.unit_id);
    if (!u) { problems.push(`highlight #${i} points at unknown unit ${h.unit_id}`); return; }
    if (!h.text || !u.la.includes(h.text)) warn(`week ${n}: highlight "${h.text}" is not a substring of ${h.unit_id} — the UI will not find it`);
    if (!h.label) problems.push(`highlight #${i} (${h.unit_id}) has no label`);
  });
  return problems;
}

function rowsFor({ n, week, units, highlights }, uid) {
  const weekRow = {
    user_id: uid, n, id: week.id, title: week.title, source: week.source,
    chapter: week.chapter ?? null, has_line_numbers: Boolean(week.has_line_numbers),
    focus: week.focus ?? null, parts: week.parts ?? [],
  };
  const unitRows = units.map((u) => ({
    user_id: uid, id: u.id, week_n: n, order: u.order, part: u.part ?? null,
    line_no: u.line_no ?? null, block_start: Boolean(u.block_start),
    unit_type: u.unit_type || 'sentence', speaker: u.speaker ?? null,
    la: u.la, en: u.en ?? '', en_raw: u.en_raw ?? null, note: u.note ?? null, tags: u.tags ?? [],
  }));
  const hlRows = highlights.map((h) => ({
    user_id: uid, week_n: n, unit_id: h.unit_id, text: h.text,
    occurrence: h.occurrence ?? 1, label: h.label, note: h.note ?? null,
  }));
  return { weekRow, unitRows, hlRows };
}

const q = (v) => encodeURIComponent(v);
const inList = (ids) => `(${ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')})`;

async function seedWeek(api, w) {
  const { weekRow, unitRows, hlRows } = rowsFor(w, api.uid);
  const n = w.n;
  const prefer = { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } };

  log(`\nWeek ${n} — ${w.week.title} (${unitRows.length} units, ${hlRows.length} highlights)`);
  await api.post('/rest/v1/weeks?on_conflict=user_id,n', [weekRow], prefer);
  log('  week row upserted');

  for (const [i, batch] of chunk(unitRows, BATCH).entries()) {
    await api.post('/rest/v1/units?on_conflict=user_id,id', batch, prefer);
    log(`  units ${i * BATCH + 1}–${i * BATCH + batch.length} upserted`);
  }

  const keep = unitRows.map((u) => u.id);
  const removed = await api.delete(`/rest/v1/units?week_n=eq.${n}&id=not.in.${q(inList(keep))}`, { headers: { Prefer: 'return=representation' } });
  if (Array.isArray(removed) && removed.length) log(`  removed ${removed.length} stale unit(s): ${removed.map((r) => r.id).join(', ')}`);

  await api.delete(`/rest/v1/highlights?week_n=eq.${n}`, { headers: { Prefer: 'return=minimal' } });
  for (const [i, batch] of chunk(hlRows, BATCH).entries()) {
    await api.post('/rest/v1/highlights', batch, { headers: { Prefer: 'return=minimal' } });
    log(`  highlights ${i * BATCH + 1}–${i * BATCH + batch.length} inserted`);
  }
  if (!hlRows.length) log(w.hasHighlightFile ? '  no highlights in file' : '  (no highlights file yet — skipped)');

  await api.patch(`/rest/v1/weeks?n=eq.${n}`, { updated_at: new Date().toISOString() }, { headers: { Prefer: 'return=minimal' } });
  log('  week watermark bumped — devices will refresh this week');
}

function printDryRun(weeks) {
  const uid = '<your-user-id>';
  log('DRY RUN — nothing is sent. Requests that would be made, in order:\n');
  for (const w of weeks) {
    const { weekRow, unitRows, hlRows } = rowsFor(w, uid);
    log(`Week ${w.n} — ${w.week.title}`);
    log(`  POST   /rest/v1/weeks?on_conflict=user_id,n        1 row`);
    log(`         ${JSON.stringify({ ...weekRow, parts: `[${weekRow.parts.length} parts]` })}`);
    for (const [i, batch] of chunk(unitRows, BATCH).entries()) {
      log(`  POST   /rest/v1/units?on_conflict=user_id,id       ${batch.length} rows (batch ${i + 1})`);
    }
    if (unitRows[0]) log(`         first: ${JSON.stringify({ ...unitRows[0], la: unitRows[0].la.slice(0, 60) + '…', en: '…', en_raw: '…', note: unitRows[0].note ? '…' : null })}`);
    log(`  DELETE /rest/v1/units?week_n=eq.${w.n}&id=not.in.(…${unitRows.length} ids…)`);
    log(`  DELETE /rest/v1/highlights?week_n=eq.${w.n}`);
    for (const [i, batch] of chunk(hlRows, BATCH).entries()) {
      log(`  POST   /rest/v1/highlights                          ${batch.length} rows (batch ${i + 1})`);
    }
    if (hlRows[0]) log(`         first: ${JSON.stringify(hlRows[0])}`);
    log(`  PATCH  /rest/v1/weeks?n=eq.${w.n}                      {"updated_at": now}`);
    log('');
  }
}

async function main() {
  const weeks = discoverWeeks();
  if (!weeks.length) {
    log(`No week files found in ${BUILD}${onlyWeeks ? ` for weeks ${[...onlyWeeks].join(',')}` : ''}.`);
    process.exit(1);
  }
  log(`Found ${weeks.length} week file(s): ${weeks.map((w) => w.file).join(', ')}`);

  let bad = 0;
  for (const w of weeks) {
    const problems = validate(w);
    for (const p of problems) warn(`week ${w.n}: ${p}`);
    bad += problems.length;
  }
  if (bad) {
    console.error(`\n${bad} problem(s) found — fix the build output before seeding.`);
    process.exit(1);
  }

  if (dryRun) { printDryRun(weeks); return; }

  const cfg = await loadConfig();
  log(`\nProject: ${cfg.url}`);
  const creds = await credentials();
  const session = await signIn(cfg, creds);
  creds.password = null;
  log(`Signed in as ${session.user.email} (${session.user.id})`);
  const api = client(cfg, session);

  for (const w of weeks) await seedWeek(api, w);

  const counts = await api.get('/rest/v1/weeks?select=n,title,units(count)&order=n');
  log('\nServer now has:');
  for (const r of counts) log(`  week ${pad2(r.n)}  ${String(r.units?.[0]?.count ?? '?').padStart(4)} units  ${r.title}`);
  log('\nDone. Open the app (or reload it) and the new weeks will download.');
}

main().catch((e) => {
  console.error(`\nSeed failed: ${e.message}`);
  process.exit(1);
});
