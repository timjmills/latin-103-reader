// Dev-only Store + auth implementation (CONTRACT.md "Store interface").
// Reads /data/build/*.json; keeps lookups and settings in localStorage so the
// UI's persistence paths are exercised. Chosen by main.js when ?fixture=1 or
// when app/config.js is missing / has no SUPABASE_URL.

const LS_LOOKUPS = 'l103.lookups';
const LS_SETTINGS = 'latin103.settings';
const LS_ALIGN = 'l103.align.';

export const DEFAULT_SETTINGS = Object.freeze({
  size: 3, face: 'serif', theme: 'system', compact: false,
  showEnglish: 'hidden', showHighlights: true, showUnderlines: true, showMargin: true, panelWidth: null,
});

const base = new URL('../../data/build/', import.meta.url);
const listeners = new Set();
const cache = { weeks: null, units: new Map(), highlights: new Map(), audio: new Map() };   // audio: weekN → object URL (memory only)

function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}
async function fetchJSON(name) {
  const res = await fetch(new URL(name, base));
  if (!res.ok) throw new Error(`fixture: ${name} → ${res.status}`);
  return res.json();
}
function emit(kind) { for (const cb of listeners) cb(kind); }
const pad = (n) => String(n).padStart(2, '0');

// ?margins=demo — a handful of invented Ørberg-style glosses on week 1, in
// memory only, so the margin-notes UI can be exercised before the
// extraction pipeline has produced data/build/margin-week-NN.json.
const DEMO_MARGIN = {
  'w01:1.1': [{ line: 1, la: 'facta -ōrum n pl = rēs gestae' }],
  'w01:4.1': [{ line: 4, la: 'fābula -ae f = nārrātiō' }, { line: 5, la: 'agnus -ī m = ovis parva' }],
  'w01:29.1': [{ line: 29, la: 'frequēns -entis = crēber' }],
  'w01:60.1': [{ line: 60, la: 'virgō -inis f = puella innūpta' }],
};
const demoMargins = () => {
  try { return new URLSearchParams(location.search).get('margins') === 'demo'; } catch { return false; }
};

async function loadWeek(weekN) {
  if (!cache.units.has(weekN)) {
    const data = await fetchJSON(`week-${pad(weekN)}.json`);
    const demo = weekN === 1 && demoMargins();
    cache.units.set(weekN, data.units.map((u) => ({ ...u, margin: demo && DEMO_MARGIN[u.id] ? DEMO_MARGIN[u.id] : (u.margin ?? []) })));
    if (!cache.weeks) cache.weeks = [data.week];
  }
  return cache.units.get(weekN);
}

export const store = {
  async ready() {
    try { cache.weeks = await fetchJSON('weeks.json'); }
    catch { await loadWeek(1); }
    return true;
  },
  async getWeeks() { if (!cache.weeks) await this.ready(); return cache.weeks; },
  getUnits: (weekN) => loadWeek(weekN),
  async getHighlights(weekN) {
    if (!cache.highlights.has(weekN)) {
      try { cache.highlights.set(weekN, await fetchJSON(`highlights-week-${pad(weekN)}.json`)); }
      catch { cache.highlights.set(weekN, []); }
    }
    return cache.highlights.get(weekN);
  },
  async getLookups() { return new Map(Object.entries(readJSON(LS_LOOKUPS, {}))); },
  async addLookup(form, unitId) {
    const all = readJSON(LS_LOOKUPS, {});
    if (!all[form]) {
      all[form] = { first_seen_unit_id: unitId, learned_at: null, created_at: new Date().toISOString() };
      writeJSON(LS_LOOKUPS, all);
    }
  },
  async markLearned(form) {
    const all = readJSON(LS_LOOKUPS, {});
    if (all[form]) { all[form].learned_at = new Date().toISOString(); writeJSON(LS_LOOKUPS, all); }
  },
  async unlearn(form) {
    const all = readJSON(LS_LOOKUPS, {});
    if (all[form]) { all[form].learned_at = null; writeJSON(LS_LOOKUPS, all); }
  },
  async removeLookup(form) {
    const all = readJSON(LS_LOOKUPS, {});
    delete all[form]; writeJSON(LS_LOOKUPS, all);
  },
  getSettings() { return { ...DEFAULT_SETTINGS, ...readJSON(LS_SETTINGS, {}) }; },
  async setSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    writeJSON(LS_SETTINGS, next);
    return next;
  },
  async getAlignment(weekN) { return readJSON(LS_ALIGN + weekN, []); },
  async saveAlignment(weekN, rows) { writeJSON(LS_ALIGN + weekN, rows); },
  // Audio lives in memory for the session: enough to exercise upload → align → play.
  async getAudioUrl(weekN) { return cache.audio.get(Number(weekN)) ?? null; },
  async uploadAudio(weekN, file) {
    if (!file) throw new Error('Choose an audio file first.');
    const old = cache.audio.get(Number(weekN));
    if (old) URL.revokeObjectURL(old);
    cache.audio.set(Number(weekN), URL.createObjectURL(file));
  },
  onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
};

// Cross-tab changes look like sync events.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LS_LOOKUPS) emit('lookups');
    if (e.key === LS_SETTINGS) emit('settings');
  });
}

export const auth = {
  async signIn() { return { email: 'fixture@local' }; },
  async signOut() { console.info('[fixture] signOut'); },
  user() { return { email: 'fixture@local' }; },
  onChange() { return () => {}; },
};
