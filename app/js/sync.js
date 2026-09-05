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

/**
 * Rows for `reading_progress` from the unit ids to mark read: one per id
 * not already in `existing` (Map / Set of unit ids), de-duplicated, with
 * `week_n` from the id (ids of no week are dropped). Pure — markRead() is
 * idempotent because of this.
 */
export function makeProgressRows(unitIds, existing, now = new Date().toISOString()) {
  const out = [];
  const seen = new Set();
  for (const id of unitIds || []) {
    if (typeof id !== 'string' || !id || seen.has(id) || existing?.has?.(id)) continue;
    const week_n = weekOfUnit(id);
    if (week_n == null) continue;
    seen.add(id);
    out.push({ unit_id: id, week_n, read_at: now, updated_at: now });
  }
  return out;
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
 * is). With an empty outbox rows the server no longer has are pruned too.
 * Pure.
 */
export function mergeProgress(localMap, remoteRows, ops) {
  if (progressPending(ops)) return { merged: localMap, changed: [], removed: 0, skipped: true };
  const { merged, changed } = mergeRows(localMap, remoteRows, (r) => r.unit_id);
  let removed = 0;
  if (!(ops || []).length) {
    const remoteIds = new Set((remoteRows || []).map((r) => r.unit_id));
    for (const k of [...merged.keys()]) if (!remoteIds.has(k)) { merged.delete(k); removed += 1; }
  }
  return { merged, changed, removed, skipped: false };
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
