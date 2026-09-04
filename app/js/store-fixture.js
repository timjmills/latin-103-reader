// Dev-only Store + auth implementation (CONTRACT.md "Store interface").
// Reads /data/build/*.json; keeps lookups and settings in localStorage so the
// UI's persistence paths are exercised. Chosen by main.js when ?fixture=1 or
// when app/config.js is missing / has no SUPABASE_URL.

import { normaliseAlignmentRows } from './sync.js';

const LS_LOOKUPS = 'l103.lookups';
const LS_SETTINGS = 'latin103.settings';
const LS_ALIGN = 'l103.align.';

export const DEFAULT_SETTINGS = Object.freeze({
  size: 3, face: 'serif', theme: 'system', compact: false,
  showEnglish: 'hidden', showHighlights: true, showUnderlines: true, showMargin: true, showAudio: true, showSummaries: true, plainOpen: false, showGlossEnglish: false, panelWidth: null,
});

const base = new URL('../../data/build/', import.meta.url);
// The repo root is served in dev (python -m http.server 8000 → /audio/week-NN.mp3);
// recordings never live under app/ and are never committed.
const audioBase = new URL('../../audio/', import.meta.url);
const listeners = new Set();
const cache = {
  weeks: null, units: new Map(), highlights: new Map(),
  audio: new Map(),       // weekN → object URL of an upload (memory only)
  aligned: new Map(),     // weekN → pipeline alignment rows (data/build/audio/week-NN.alignment.json app_rows) or null
  localAudio: new Map(),  // weekN → audio/week-NN.mp3 URL when the dev server has it, else null
};

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

async function pipelineAlignment(n) {
  if (!cache.aligned.has(n)) {
    let rows = null;
    try { rows = (await fetchJSON(`audio/week-${pad(n)}.alignment.json`)).app_rows ?? null; }
    catch { rows = null; }
    cache.aligned.set(n, Array.isArray(rows) ? rows : null);
  }
  return cache.aligned.get(n) ?? [];
}
async function localAudioUrl(n) {
  if (!cache.localAudio.has(n)) {
    const url = new URL(`week-${pad(n)}.mp3`, audioBase).href;
    let ok = false;
    try { ok = (await fetch(url, { method: 'HEAD' })).ok; } catch { ok = false; }
    cache.localAudio.set(n, ok ? url : null);
  }
  return cache.localAudio.get(n);
}

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

// Section summaries (week.parts[].summary_en / summary_la): until the build
// carries them, week 1's first two parts get two invented ones, in memory
// only, so the Summary disclosures can be exercised. Not the book's text.
const DEMO_SUMMARIES = [
  {
    en: 'Syra tells Quintus the story of Theseus: how the young hero sailed to Crete and faced the Minotaur in the labyrinth.',
    la: 'Syra fābulam dē Thēseō nārrat. Quīntus audit. Thēseus in Crētam nāvigat et Mīnōtaurum in labyrinthō petit.',
  },
  {
    en: 'Ariadne gives Theseus a thread and a sword; he kills the Minotaur, finds his way out, and flees with her by night.',
    la: 'Ariadna Thēseō fīlum et gladium dat. Thēseus Mīnōtaurum necat, ē labyrinthō exit et cum Ariadnā nocte fugit.',
  },
];
function withDemoSummaries(week) {
  if (!week || week.n !== 1 || !Array.isArray(week.parts) || week.parts[0]?.summary_en) return week;
  week.parts = week.parts.map((p, i) => (DEMO_SUMMARIES[i] ? { ...p, summary_en: DEMO_SUMMARIES[i].en, summary_la: DEMO_SUMMARIES[i].la } : p));
  return week;
}

// Plain-words layer (CONTRACT.md): until the build carries `note_simple`,
// week 1 gets invented sample text in memory only — `note_simple` on the first
// three units with a note, `simple` on the first two highlights and `en` on the
// first three margin glosses — so the "In plain words" disclosures and the
// gloss English can be exercised. Not the book's text, not a teacher's notes.
export const DEMO_PLAIN = Object.freeze({
  notes: [
    'Syra has finished her story and wants to go. Quintus says "do not leave me!" — Latin says "be unwilling to leave" to tell someone not to do something. The word for "he says" sits in the middle of what he says; that is normal.',
    '"I want you to stay here." The person who should do the staying ("you") takes the ending that usually marks the object, because the whole idea "you staying" is what Quintus wants.',
    'A command to one person: "tell!". "Some story" means any story at all — Quintus does not have a particular one in mind.',
  ],
  highlights: [
    'This verb looks passive ("was set out") but means something active: "he set out". Verbs like this are called deponent — their endings are passive, their meaning is not.',
    'The ending -ī makes this an infinitive ("to speak"). It looks like a passive infinitive, but it means the active thing: Ariadne began to speak.',
  ],
  glosses: ['a story (from the verb "to speak")', 'a lamb — a small sheep', 'by chance; for no reason'],
});
/** Mutates copies: sample plain-words text on week 1's first units/highlights/glosses (only when the build has none). Pure. */
export function withPlainDemo(units, highlights = null) {
  const out = units.map((u) => ({ ...u, note_simple: typeof u.note_simple === 'string' ? u.note_simple : null }));
  if (!out.some((u) => u.note_simple)) {
    let n = 0;
    for (const u of out) { if (u.note && n < DEMO_PLAIN.notes.length) u.note_simple = DEMO_PLAIN.notes[n++]; }
  }
  if (!out.some((u) => (u.margin ?? []).some((m) => m?.en))) {
    let g = 0;
    for (const u of out) {
      u.margin = (u.margin ?? []).map((m) => (m && g < DEMO_PLAIN.glosses.length && typeof m.en !== 'string' ? { ...m, en: DEMO_PLAIN.glosses[g++] } : m));
    }
  }
  // Like store.js: a missing `en` is null, never undefined.
  for (const u of out) {
    if (Array.isArray(u.margin)) u.margin = u.margin.map((m) => (m && typeof m.en !== 'string' ? { ...m, en: null } : m));
  }
  if (!highlights) return { units: out, highlights };
  const hs = highlights.map((h) => ({ ...h, simple: typeof h.simple === 'string' ? h.simple : null }));
  if (!hs.some((h) => h.simple)) hs.slice(0, DEMO_PLAIN.highlights.length).forEach((h, i) => { h.simple = DEMO_PLAIN.highlights[i]; });
  return { units: out, highlights: hs };
}

async function loadWeek(weekN) {
  if (!cache.units.has(weekN)) {
    const data = await fetchJSON(`week-${pad(weekN)}.json`);
    const demo = weekN === 1 && demoMargins();
    let units = data.units.map((u) => ({ ...u, margin: demo && DEMO_MARGIN[u.id] ? DEMO_MARGIN[u.id] : (u.margin ?? []) }));
    if (weekN === 1) units = withPlainDemo(units).units;
    cache.units.set(weekN, units);
    if (!cache.weeks) cache.weeks = [withDemoSummaries(data.week)];
  }
  return cache.units.get(weekN);
}

export const store = {
  async ready() {
    try { cache.weeks = (await fetchJSON('weeks.json')).map(withDemoSummaries); }
    catch { await loadWeek(1); }
    return true;
  },
  async getWeeks() { if (!cache.weeks) await this.ready(); return cache.weeks; },
  getUnits: (weekN) => loadWeek(weekN),
  async getHighlights(weekN) {
    if (!cache.highlights.has(weekN)) {
      try {
        const rows = await fetchJSON(`highlights-week-${pad(weekN)}.json`);
        cache.highlights.set(weekN, weekN === 1 ? withPlainDemo([], rows).highlights : rows);
      }
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
  // A manual alignment (localStorage) wins; otherwise the pipeline's
  // data/build/audio/week-NN.alignment.json (app_rows, with timed words).
  async getAlignment(weekN) {
    const n = Number(weekN);
    const local = readJSON(LS_ALIGN + n, null);
    if (Array.isArray(local) && local.length) return normaliseAlignmentRows(local);
    return normaliseAlignmentRows(await pipelineAlignment(n));
  },
  async saveAlignment(weekN, rows) { writeJSON(LS_ALIGN + Number(weekN), normaliseAlignmentRows(rows)); },
  // An upload lives in memory for the session (upload → align → play); with no
  // upload, the repo's own audio/week-NN.mp3 is used when the dev server has it.
  async getAudioUrl(weekN) {
    const n = Number(weekN);
    return cache.audio.get(n) ?? (await localAudioUrl(n));
  },
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
