// Pure merge / outbox logic for store.js. No I/O, no DOM — unit-tested in
// tests/store.outbox.test.mjs. Every row carries an ISO `updated_at`; the
// newest timestamp wins (the server enforces the same rule in lww_touch()).

export const DEFAULT_SETTINGS = Object.freeze({
  size: 3,
  noteSize: 4,             // Settings → Type "Notes": glosses, captions, panel rows and notes, 1–7 (4 = the reading size's own proportion)
  face: 'serif',
  theme: 'system',
  compact: false,
  showEnglish: 'hidden',
  showHighlights: true,
  showUnderlines: true,
  showMargin: true,
  showAudio: true,         // toolbar "Audio" toggle (`a`): play buttons, transport, follow-along cursor
  showSummaries: true,     // Settings → Reading: the "Summary" disclosure under each part heading
  plainOpen: false,        // "In plain words" under a note: stays open once the learner has opened one
  showGlossEnglish: false, // Settings → Reading: the English under every margin gloss, always shown
  showPictures: true,      // Settings → Reading: the textbook's illustrations beside their sentences
  lineMode: 'flow',        // Settings → Reading "Book lines": 'book' lays passage view out one printed line per line, every line numbered (CONTRACT.md "Book lines")
  audioRate: 1,            // playback speed, one of RATE_STEPS (0.5–1.2); pitch is preserved
  panelWidth: null,        // px, chosen with the divider; null = the CSS default
  lastPosition: null,      // { week_n, unit_id, view, at }: where the learner was (CONTRACT.md "Reading progress"); null = never read
});

/**
 * `settings.lastPosition` from any source: `{ week_n, unit_id, view, at }`
 * with a positive integer week, a non-empty unit id, `view` one of
 * 'passage' | 'sentence' (else 'passage') and `at` an ISO timestamp or null;
 * anything unusable → null. Pure.
 */
export function normaliseLastPosition(value) {
  if (!value || typeof value !== 'object') return null;
  const week_n = Math.round(Number(value.week_n));
  const unit_id = typeof value.unit_id === 'string' ? value.unit_id.trim() : '';
  if (!Number.isFinite(week_n) || week_n < 1 || !unit_id) return null;
  const view = value.view === 'sentence' ? 'sentence' : 'passage';
  const at = ts(value.at) ? new Date(ts(value.at)).toISOString() : null;
  return { week_n, unit_id, view, at };
}

/* --------------------------------------------------- reading progress */
// CONTRACT.md "Reading progress" / "Reviews": one row per sentence,
// { unit_id, week_n, read_at (the first pass), reads, last_read_at (the latest
// pass), updated_at }. A sentence read again ≥ REVIEW_GAP_MS after its
// last_read_at is a review (reads + 1, last_read_at = now; read_at never
// moves); within the gap it is the same session and nothing changes. Rows
// merge field by field wherever two copies meet (mergeProgressRow): reads =
// max, last_read_at = max, read_at = min — so a review made on either device
// stands and nothing is ever undone by a stale copy.

export const REVIEW_GAP_MS = 30 * 60 * 1000;

/** How many passes a progress Map value records: a row's `reads` as a whole number ≥ 1; anything else (a bare read_at, `true`, junk) is one pass. Pure. */
export function readsOf(value) {
  return value && typeof value === 'object' ? Math.max(1, Math.floor(Number(value.reads)) || 1) : 1;
}

/** A progress row with every field present: reads ≥ 1 (default 1), last_read_at (default read_at). Pure. */
export function normaliseProgressRow(row) {
  if (!row || typeof row !== 'object') return null;
  const read_at = row.read_at || row.last_read_at || null;
  const reads = readsOf(row);
  const last_read_at = ts(row.last_read_at) ? row.last_read_at : read_at;
  return { ...row, read_at, reads, last_read_at, updated_at: row.updated_at || last_read_at };
}

/**
 * The latest pass over a sentence, from a progress Map value: a row
 * (last_read_at, else read_at), a bare read_at string (the getProgress() view)
 * or `true` (a Set entry: read, time unknown). null for nothing. Pure.
 */
export function lastReadOf(value) {
  if (value == null || value === false) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.last_read_at || value.read_at || null;
  return null;
}

/**
 * True when the sentence counts as read *for now*: it has a value and its
 * latest pass is within `gapMs` of `now` (or has no usable time — a Set entry,
 * a bad timestamp — which is taken as read for good). False for an unread
 * sentence and for one whose next pass would be a review. Pure.
 */
export function readSettled(value, now = Date.now(), gapMs = REVIEW_GAP_MS) {
  if (value == null || value === false) return false;
  const at = ts(lastReadOf(value));
  if (!at) return true;
  return ts(now) - at < gapMs;
}

/**
 * Rows for `reading_progress` from the unit ids that met the read rule:
 * a first read (a new row, reads 1) for an id not in `existing` (a Map of
 * unit_id → row, or a Set of ids), a review (reads + 1, last_read_at = now,
 * read_at kept) for a row whose last pass is ≥ `gapMs` before `now`, and
 * nothing for one read within the gap (or a Set entry). De-duplicated;
 * `week_n` from the id (ids of no week are dropped). Pure — markRead() is
 * idempotent within a session because of this.
 */
export function makeProgressRows(unitIds, existing, now = new Date().toISOString(), gapMs = REVIEW_GAP_MS) {
  const out = [];
  const seen = new Set();
  const nowMs = ts(now);
  for (const id of unitIds || []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    const week_n = weekOfUnit(id);
    if (week_n == null) continue;
    const cur = existing?.get?.(id) ?? (existing?.has?.(id) ? true : null);
    if (cur == null) {
      seen.add(id);
      out.push({ unit_id: id, week_n, read_at: now, reads: 1, last_read_at: now, updated_at: now });
      continue;
    }
    if (readSettled(cur, nowMs, gapMs) || typeof cur !== 'object') continue;
    const row = normaliseProgressRow(cur);
    seen.add(id);
    out.push({ ...row, unit_id: id, week_n: row.week_n ?? week_n, reads: row.reads + 1, last_read_at: now, updated_at: now });
  }
  return out;
}

/**
 * Two copies of one sentence's row → the one that stands: reads = max,
 * last_read_at = max, read_at = min, updated_at = max. Either side may be
 * missing (the other comes back normalised). Pure.
 */
export function mergeProgressRow(a, b) {
  const x = normaliseProgressRow(a);
  const y = normaliseProgressRow(b);
  if (!x) return y;
  if (!y) return x;
  const later = (p, q) => (ts(q) > ts(p) ? q : p);
  const earlier = (p, q) => (p && q ? (ts(q) < ts(p) ? q : p) : p || q);
  return {
    ...x, ...y,
    unit_id: x.unit_id ?? y.unit_id,
    week_n: x.week_n ?? y.week_n,
    read_at: earlier(x.read_at, y.read_at),
    reads: Math.max(x.reads, y.reads),
    last_read_at: later(x.last_read_at, y.last_read_at),
    updated_at: later(x.updated_at, y.updated_at),
  };
}

/** True when two rows say the same about a sentence (reads, read_at, last_read_at). Pure. */
export function sameProgressRow(a, b) {
  if (!a || !b) return !a && !b;
  const x = normaliseProgressRow(a);
  const y = normaliseProgressRow(b);
  return x.reads === y.reads && ts(x.read_at) === ts(y.read_at) && ts(x.last_read_at) === ts(y.last_read_at);
}

/** True when the outbox still holds a `reading_progress` op (a markRead batch or a reset not yet on the server). Pure. */
export function progressPending(ops) {
  return (ops || []).some((op) => op && op.table === 'reading_progress');
}

/**
 * Merge the server's `reading_progress` rows into the local Map (unit_id →
 * row). While any reading_progress op is still in the outbox (`ops`) nothing
 * is merged — a pull that overlaps a reset must not resurrect the rows the
 * reset just deleted locally (`skipped: true`, the local Map comes back as
 * is). Rows meet field by field (mergeProgressRow: reads = max, last_read_at
 * = max, read_at = min); `changed` lists the ids whose row differs after it.
 * With an empty outbox rows the server no longer has are pruned too. Pure.
 */
export function mergeProgress(localMap, remoteRows, ops) {
  if (progressPending(ops)) return { merged: localMap, changed: [], removed: 0, skipped: true };
  const merged = new Map(localMap);
  const changed = [];
  for (const row of remoteRows || []) {
    if (!row || !row.unit_id) continue;
    const cur = merged.get(row.unit_id);
    const next = mergeProgressRow(cur, row);
    if (cur && sameProgressRow(cur, next)) continue;
    merged.set(row.unit_id, next);
    changed.push(row.unit_id);
  }
  let removed = 0;
  if (!(ops || []).length) {
    const remoteIds = new Set((remoteRows || []).map((r) => r?.unit_id));
    for (const k of [...merged.keys()]) if (!remoteIds.has(k)) { merged.delete(k); removed += 1; }
  }
  return { merged, changed, removed, skipped: false };
}

/**
 * One realtime `postgres_changes` payload on `reading_progress` applied to
 * the Map (unit_id → row): a DELETE drops the row; an INSERT / UPDATE is
 * merged field by field (mergeProgressRow), so an own echo or a stale copy
 * changes nothing. Same shape as applyRealtime(). Pure.
 */
export function applyProgressRealtime(map, payload) {
  const type = payload?.eventType;
  if (type === 'DELETE') return applyRealtime(map, payload, (row) => row.unit_id);
  if (type !== 'INSERT' && type !== 'UPDATE') return { map, changed: false, key: null };
  const row = payload.new;
  const key = row?.unit_id ?? null;
  if (key == null) return { map, changed: false, key };
  const cur = map.get(key);
  const next = mergeProgressRow(cur, row);
  if (cur && sameProgressRow(cur, next)) return { map, changed: false, key };
  const out = new Map(map);
  out.set(key, next);
  return { map: out, changed: true, key };
}

/** Read sentences per week: Map week_n → count, from a progress Map keyed by unit id (the week comes from the id). Pure. */
export function progressByWeek(progress) {
  const out = new Map();
  for (const id of progress?.keys?.() ?? []) {
    const n = weekOfUnit(id);
    if (n == null) continue;
    out.set(n, (out.get(n) ?? 0) + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ study log */
// CONTRACT.md "Study log" / "Study log merge": table `study_days` (day,
// device, active_ms) — active reading time per local calendar day, one row
// per device (`device` = a random id kept in localStorage, `main` for the
// baseline backfilled by migration 0012). Local-first like progress. Each
// device sends its *own* running total for the day and the server keeps the
// max per (day, device) row (a re-sent total is harmless, two tabs of one
// device share a row and never double-count); on read the devices' rows are
// summed per day (studyDaysView), so a phone and a laptop add up.

/** The local calendar day of `value` (Date | epoch ms | ISO string; default now) as "YYYY-MM-DD". Pure. */
export function localDay(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** True for a "YYYY-MM-DD" day key. Pure. */
export const isDayKey = (day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''));

/** Non-negative integer ms from any value (NaN / negative / non-numbers → 0). Pure. */
export function cleanMs(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The device id of the baseline rows (migration 0012's default) and of any row that names no device. */
export const STUDY_MAIN_DEVICE = 'main';
/** Joins day and device into one study-row key: "YYYY-MM-DD␟device" (U+241F, never in a day or a device id). */
export const STUDY_KEY_SEP = '␟';

/** A non-empty device id, else STUDY_MAIN_DEVICE. Pure. */
export function cleanDevice(device) {
  const d = String(device ?? '').trim();
  return d && !d.includes(STUDY_KEY_SEP) ? d : STUDY_MAIN_DEVICE;
}

/** The key a study row is kept under locally (the IndexedDB `study_rows` store and the in-memory Map): `day␟device`; null for a bad day. Pure. */
export function studyKey(day, device) {
  return isDayKey(day) ? `${day}${STUDY_KEY_SEP}${cleanDevice(device)}` : null;
}

/** A study row from a server / realtime / cached row: { key, day, device, active_ms, updated_at }; null for a bad day. Pure. */
export function normaliseStudyRow(row) {
  if (!row || !isDayKey(row.day)) return null;
  const device = cleanDevice(row.device);
  return { key: studyKey(row.day, device), day: row.day, device, active_ms: cleanMs(row.active_ms), updated_at: row.updated_at ?? null };
}

/**
 * This device's `study_days` row after `ms` more active time on `day`: the
 * existing total plus `ms` (nothing negative, nothing fractional), with a
 * fresh updated_at. `existing` may be null. Pure.
 */
export function addStudyMs(existing, day, ms, now = new Date().toISOString(), device = STUDY_MAIN_DEVICE) {
  if (!isDayKey(day)) return null;
  const dev = cleanDevice(device);
  return { key: studyKey(day, dev), day, device: dev, active_ms: cleanMs(existing?.active_ms) + cleanMs(ms), updated_at: now };
}

/** True when the outbox still holds a `study_days` op (a day's total or a clear not yet on the server). Pure. */
export function studyPending(ops) {
  return (ops || []).some((op) => op && op.table === 'study_days');
}

/**
 * Merge the server's `study_days` rows into the local Map (key → row, key =
 * studyKey(day, device)): per row the larger active_ms stands (the server
 * keeps the max too, so nothing is ever lowered). While a study_days op is
 * still in the outbox nothing is merged (`skipped: true`) — a pull
 * overlapping a clear must not bring the cleared days back; with an empty
 * outbox rows the server no longer has are dropped too. `changed` lists the
 * keys that moved. Pure.
 */
export function mergeStudyDays(localMap, remoteRows, ops) {
  if (studyPending(ops)) return { merged: localMap, changed: [], removed: 0, skipped: true };
  const merged = new Map(localMap);
  const changed = [];
  const remoteKeys = new Set();
  for (const raw of remoteRows || []) {
    const row = normaliseStudyRow(raw);
    if (!row) continue;
    remoteKeys.add(row.key);
    const cur = merged.get(row.key);
    if (!cur || row.active_ms > cleanMs(cur.active_ms)) {
      merged.set(row.key, { ...row, updated_at: row.updated_at ?? cur?.updated_at ?? null });
      changed.push(row.key);
    }
  }
  let removed = 0;
  if (!(ops || []).length) {
    for (const k of [...merged.keys()]) if (!remoteKeys.has(k)) { merged.delete(k); removed += 1; }
  }
  return { merged, changed, removed, skipped: false };
}

/**
 * Public shape for store.getStudyDays(): Map day → active_ms (integer ms),
 * the devices' rows summed per day. Takes the store's Map (key → row) or a
 * plain day → ms Map (the fixture store). Pure.
 */
export function studyDaysView(map) {
  const out = new Map();
  for (const [key, row] of map || []) {
    const day = row && typeof row === 'object' && row.day != null ? row.day : String(key).split(STUDY_KEY_SEP)[0];
    if (!isDayKey(day)) continue;
    out.set(day, (out.get(day) ?? 0) + cleanMs(row && typeof row === 'object' ? row.active_ms : row));
  }
  return out;
}

export const RATE_MIN = 0.5;
export const RATE_MAX = 1.2;
/** The playback speeds offered (one decimal, 0.5–1.2). */
export const RATE_STEPS = Object.freeze([0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2]);

/**
 * Playback speed as a number in [RATE_MIN, RATE_MAX], rounded to one decimal
 * so it always lands on a RATE_STEPS value. Numbers and numeric strings are
 * accepted; anything else (null, '', booleans, NaN) → `fallback`. Pure.
 */
export function clampRate(value, fallback = DEFAULT_SETTINGS.audioRate) {
  if (value == null || value === '' || typeof value === 'boolean') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, n)) * 10) / 10;
}

/**
 * Timed words of one alignment row as the UI expects them: `[{t, s, e}]` in
 * text order, absolute ms, bad entries dropped. Anything that is not an
 * array (older rows, manual alignments) → []. Pure.
 */
export function cleanWords(words) {
  if (!Array.isArray(words)) return [];
  const out = [];
  for (const w of words) {
    if (!w || typeof w.t !== 'string' || !w.t.trim()) continue;
    const s = Number(w.s), e = Number(w.e);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    const start = Math.max(0, Math.round(s));
    out.push({ t: w.t, s: start, e: Math.max(start, Math.round(e)) });
  }
  return out;
}

/**
 * Where a row's audio ends, or null: `end_ms` must be a finite number no
 * earlier than `start_ms`; anything else (absent — a manual alignment or a row
 * cached before the field existed — null, NaN, a string) → null, which means
 * "until the next row starts". Pure.
 */
export function cleanEndMs(end, start = 0) {
  if (end == null || end === '' || typeof end === 'boolean') return null;
  const n = Number(end);
  if (!Number.isFinite(n)) return null;
  return Math.max(Math.max(0, Math.round(start)), Math.round(n));
}

/**
 * Alignment rows as `store.getAlignment()` hands them out: `{unit_id,
 * start_ms, end_ms, synth, words}` in start_ms order — `words` normalised
 * with cleanWords(), `end_ms` with cleanEndMs() (null when absent), `synth`
 * a boolean (true only when the row says so: a synthesised voice reads this
 * unit). Rows without a unit id or a numeric start are dropped. Pure.
 */
export function normaliseAlignmentRows(rows) {
  return (rows || [])
    .filter((r) => r && r.unit_id && Number.isFinite(Number(r.start_ms)))
    .map((r) => {
      const start_ms = Math.max(0, Math.round(Number(r.start_ms)));
      return { unit_id: String(r.unit_id), start_ms, end_ms: cleanEndMs(r.end_ms, start_ms), synth: r.synth === true, words: cleanWords(r.words) };
    })
    .sort((a, b) => a.start_ms - b.start_ms);
}

/**
 * Picture rows (table `pictures`, CONTRACT.md "Pictures") as the store keeps
 * them: `{id, unit_id, path, caption, caption_en, page, width, height, sort}`.
 * Rows without an id, a unit or a storage path are dropped; captions are
 * trimmed strings or null; page / width / height are positive integers or
 * null; `sort` is a number (0 when missing). Pure.
 */
export function normalisePictureRows(rows) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const int = (v) => { const n = Math.round(Number(v)); return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : null; };
  return (rows || [])
    .filter((r) => r && r.id && r.unit_id && typeof r.path === 'string' && r.path.trim())
    .map((r) => ({
      id: String(r.id), unit_id: String(r.unit_id), path: r.path.trim(),
      caption: str(r.caption), caption_en: str(r.caption_en),
      page: int(r.page), width: int(r.width), height: int(r.height),
      sort: Number.isFinite(Number(r.sort)) && r.sort !== null && r.sort !== '' ? Number(r.sort) : 0,
    }));
}

export const SIZE_MIN = 1;
export const SIZE_MAX = 8;

/**
 * Type-size step as an integer in [SIZE_MIN, SIZE_MAX]. Numbers (and numeric
 * strings) are rounded and clamped; anything else → `fallback`. Pure.
 */
export function clampSize(value, fallback = DEFAULT_SETTINGS.size) {
  if (value == null || value === '' || typeof value === 'boolean') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
}
export const NOTE_SIZE_MIN = 1;
export const NOTE_SIZE_MAX = 7;

/**
 * Notes-size step (glosses, captions, panel notes) as an integer in
 * [NOTE_SIZE_MIN, NOTE_SIZE_MAX]; the same rules as clampSize(). Pure.
 */
export function clampNoteSize(value, fallback = DEFAULT_SETTINGS.noteSize) {
  if (value == null || value === '' || typeof value === 'boolean') return fallback;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(NOTE_SIZE_MAX, Math.max(NOTE_SIZE_MIN, n));
}
/**
 * A boolean setting from any source: booleans pass, "true"/"1"/1 → true,
 * "false"/"0"/0/"" → false (case- and space-insensitive), anything else →
 * `fallback`. A row hand-edited or written by an older client must never
 * read "false" as on. Pure.
 */
export function clampBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return value === 1;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0' || v === '') return false;
  }
  return fallback;
}
/** Every boolean in DEFAULT_SETTINGS — coerced with clampBool() wherever settings are read or patched. */
export const BOOL_SETTINGS = Object.freeze(Object.keys(DEFAULT_SETTINGS).filter((k) => typeof DEFAULT_SETTINGS[k] === 'boolean'));
const withSize = (data) => {
  const out = { ...data, size: clampSize(data.size), noteSize: clampNoteSize(data.noteSize), audioRate: clampRate(data.audioRate), lastPosition: normaliseLastPosition(data.lastPosition) };
  for (const k of BOOL_SETTINGS) out[k] = clampBool(data[k], DEFAULT_SETTINGS[k]);
  return out;
};

/** Timestamp → epoch ms (0 for missing / unparsable). */
export function ts(value) {
  if (!value) return 0;
  const n = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

/** True when `a` is strictly newer than `b` (or `b` is absent). */
export function isNewer(a, b) {
  if (!b) return true;
  if (!a) return false;
  return ts(a.updated_at) > ts(b.updated_at);
}

/**
 * Merge remote rows into a local Map keyed by `keyOf(row)`.
 * Local-only rows are kept (they may be unflushed offline writes).
 * Returns the new Map and the keys whose local value changed.
 */
export function mergeRows(localMap, remoteRows, keyOf) {
  const merged = new Map(localMap);
  const changed = [];
  for (const row of remoteRows || []) {
    const key = keyOf(row);
    if (isNewer(row, merged.get(key))) {
      merged.set(key, row);
      changed.push(key);
    }
  }
  return { merged, changed };
}

/**
 * Apply one realtime `postgres_changes` payload to a Map.
 * payload: { eventType: 'INSERT'|'UPDATE'|'DELETE', new: row|{}, old: row|{} }
 * Own writes echo back with an identical updated_at → not newer → no change.
 */
export function applyRealtime(map, payload, keyOf) {
  const next = new Map(map);
  const type = payload?.eventType;
  if (type === 'DELETE') {
    const key = keyOf(payload.old || {});
    if (key != null && next.has(key)) {
      next.delete(key);
      return { map: next, changed: true, key };
    }
    return { map, changed: false, key };
  }
  if (type === 'INSERT' || type === 'UPDATE') {
    const row = payload.new;
    const key = keyOf(row || {});
    if (key == null) return { map, changed: false, key };
    if (isNewer(row, next.get(key))) {
      next.set(key, row);
      return { map: next, changed: true, key };
    }
  }
  return { map, changed: false, key: null };
}

/**
 * Collapse an outbox so each (table, key) is sent once, keeping the LAST op
 * for that key, in the order of its last occurrence. Op shape:
 *   { seq, table, key, op: 'upsert'|'delete'|'replace_week', row?, rows? }
 * Returns { ops, dropSeqs } — dropSeqs are superseded entries to delete.
 */
export function coalesceOutbox(ops) {
  const last = new Map();
  const dropSeqs = [];
  for (const op of ops) {
    const k = `${op.table}\u0000${op.key}`;
    const prev = last.get(k);
    if (prev) {
      dropSeqs.push(prev.seq);
      last.delete(k); // re-insert so the entry moves to its last-seen position
    }
    last.set(k, op);
  }
  return { ops: [...last.values()], dropSeqs };
}

/** New lookup row, or null when the form is already recorded (idempotent). */
export function makeLookup(existing, form, unitId, now = new Date().toISOString()) {
  if (existing) return null;
  return {
    form,
    first_seen_unit_id: unitId ?? null,
    created_at: now,
    learned_at: null,
    updated_at: now,
  };
}

/** Patched copy of a lookup row with a fresh updated_at. */
export function patchLookup(existing, patch, now = new Date().toISOString()) {
  if (!existing) return null;
  return { ...existing, ...patch, updated_at: now };
}

/** Settings blob after a patch (unknown keys allowed, defaults filled). */
export function patchSettings(current, patch, now = new Date().toISOString()) {
  const data = withSize({ ...DEFAULT_SETTINGS, ...(current?.data || {}), ...(patch || {}) });
  return { data, updated_at: now };
}

/**
 * Settings blob with only `lastPosition` replaced. The row's `updated_at`
 * is left alone: the position carries its own clock (`lastPosition.at`, see
 * mergeSettings) so a device that merely scrolls never outranks one that
 * changed a real setting. Pure.
 */
export function patchLastPosition(current, lastPosition) {
  const base = normaliseSettings(current);
  return { data: { ...base.data, lastPosition: normaliseLastPosition(lastPosition) }, updated_at: base.updated_at };
}

/** The newer of two last positions by their own `at` (a position without one loses to any with one; equal → the first). Pure. */
export function newerLastPosition(a, b) {
  const la = normaliseLastPosition(a);
  const lb = normaliseLastPosition(b);
  if (!la) return lb;
  if (!lb) return la;
  return ts(lb.at) > ts(la.at) ? lb : la;
}

/**
 * Local settings after a remote row arrives (a pull or a realtime event):
 * the row with the newer `updated_at` wins as a whole — but `lastPosition`
 * is merged on its own clock, so the newest `at` wins whichever row was
 * newer. Returns { settings, changed } — `changed` false when nothing
 * local moves (an own echo, an older row with an older position). Pure.
 */
export function mergeSettings(local, remote) {
  const cur = normaliseSettings(local);
  if (!remote) return { settings: cur, changed: false };
  const rem = normaliseSettings(remote);
  const lastPosition = newerLastPosition(cur.data.lastPosition, rem.data.lastPosition);
  const base = isNewer(rem, cur) ? rem : cur;
  const settings = { data: { ...base.data, lastPosition }, updated_at: base.updated_at };
  const changed = settings.updated_at !== cur.updated_at || JSON.stringify(settings.data) !== JSON.stringify(cur.data);
  return { settings, changed };
}

/** Normalise a settings row from any source into { data, updated_at }; `size` is clamped to 1–8, `noteSize` to 1–7, `audioRate` to 0.5–1.2, every boolean coerced (clampBool). */
export function normaliseSettings(row) {
  if (!row) return { data: { ...DEFAULT_SETTINGS }, updated_at: null };
  return { data: withSize({ ...DEFAULT_SETTINGS, ...(row.data || {}) }), updated_at: row.updated_at || null };
}

/** Public shape for store.getLookups(). */
export function lookupsView(map) {
  const out = new Map();
  for (const [form, row] of map) {
    out.set(form, {
      first_seen_unit_id: row.first_seen_unit_id ?? null,
      learned_at: row.learned_at ?? null,
      created_at: row.created_at ?? null,
    });
  }
  return out;
}

/** Week number from a unit id like "w07:12.3" → 7 (null if not parsable). */
export function weekOfUnit(unitId) {
  const m = /^w(\d+):/.exec(unitId || '');
  return m ? Number(m[1]) : null;
}

/** Zero-padded week tag: 3 → "week-03". */
export function weekTag(n) {
  return `week-${String(n).padStart(2, '0')}`;
}

/**
 * Decide which weeks need their texts re-fetched.
 * remoteWeeks / localWeeks: rows with n + updated_at; localHasUnits(n) → bool.
 */
export function staleWeeks(remoteWeeks, localWeeks, localHasUnits) {
  const local = new Map((localWeeks || []).map((w) => [w.n, w]));
  const stale = [];
  for (const rw of remoteWeeks || []) {
    const lw = local.get(rw.n);
    if (!lw || !localHasUnits(rw.n) || ts(rw.updated_at) > ts(lw.updated_at)) stale.push(rw.n);
  }
  return stale;
}
