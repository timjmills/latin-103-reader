// Dev-only Store + auth implementation (CONTRACT.md "Store interface").
// Reads /data/build/*.json; keeps lookups and settings in localStorage so the
// UI's persistence paths are exercised. Chosen by main.js when ?fixture=1 or
// when app/config.js is missing / has no SUPABASE_URL.

import { DEFAULT_SETTINGS, normaliseAlignmentRows, normaliseLastPosition, makeProgressRows, weekOfUnit, isDayKey, cleanMs } from './sync.js';

const LS_LOOKUPS = 'l103.lookups';
const LS_SETTINGS = 'latin103.settings';
const LS_ALIGN = 'l103.align.';
const LS_PROGRESS = 'l103.progress';   // { unit_id: read_at } — reading progress (CONTRACT.md), kept apart from the lookups
const LS_STUDY = 'l103.study';         // { "YYYY-MM-DD": active_ms } — the study log (CONTRACT.md "Study log")

// The one list of defaults (sync.js): the fixture never drifts from the real store.
export { DEFAULT_SETTINGS };

const base = new URL('../../data/build/', import.meta.url);
// The repo root is served in dev (python -m http.server 8000 → /audio/week-NN.mp3);
// recordings never live under app/ and are never committed.
const audioBase = new URL('../../audio/', import.meta.url);
const listeners = new Set();
const cache = {
  weeks: null, units: new Map(), highlights: new Map(), pictures: new Map(),
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

// Pictures (CONTRACT.md "Pictures"): data/build/pictures-week-NN.json, images
// served from data/build/pictures/week-NN/<file> by the dev server. Until the
// pipeline has cropped any, week 1 gets two drawn placeholders (an SVG data
// URL — not the book's art) on w01:29.1 and w01:60.1 so the layout can be
// tried: one beside dense margin notes, one portrait.
function placeholderSvg(w, h, label) {
  const rings = [];
  for (let i = 0, inset = 0.08; i < 5; i++, inset += 0.07) {
    rings.push(`<rect x="${Math.round(w * inset)}" y="${Math.round(h * inset)}" width="${Math.round(w * (1 - 2 * inset))}" height="${Math.round(h * (1 - 2 * inset))}" fill="none" stroke="#7c7062" stroke-width="${Math.round(w / 180)}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f4f0e8"/>${rings.join('')}`
    + `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="${Math.round(Math.min(w, h) / 9)}" fill="#5e544a">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const DEMO_PICTURES = [
  { id: 'w01/demo-1', unit_id: 'w01:29.1', caption: 'labyrinthus -ī m', caption_en: 'labyrinth', page: 197, width: 900, height: 620, sort: 0, url: placeholderSvg(900, 620, 'labyrinthus') },
  { id: 'w01/demo-2', unit_id: 'w01:60.1', caption: 'Ariadna fīlum Thēseō dat', caption_en: 'Ariadne gives Theseus the thread', page: 199, width: 640, height: 820, sort: 0, url: placeholderSvg(640, 820, 'Ariadna') },
];
async function loadPictures(weekN) {
  const n = Number(weekN);
  if (!cache.pictures.has(n)) {
    let rows = null;
    try {
      const raw = await fetchJSON(`pictures-week-${pad(n)}.json`);
      rows = (Array.isArray(raw) ? raw : []).map((p) => ({
        id: p.id, unit_id: p.unit_id, caption: p.caption ?? null, caption_en: p.caption_en ?? null,
        page: p.page ?? null, width: p.width ?? null, height: p.height ?? null, sort: p.sort ?? 0,
        url: new URL(`pictures/week-${pad(n)}/${String(p.file || '').split('/').pop()}`, base).href,
      }));
    } catch { rows = n === 1 ? DEMO_PICTURES.map((p) => ({ ...p })) : []; }
    cache.pictures.set(n, rows);
  }
  return cache.pictures.get(n);
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
  getPictures: (weekN) => loadPictures(weekN),
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
  getSettings() {
    const s = { ...DEFAULT_SETTINGS, ...readJSON(LS_SETTINGS, {}) };
    s.lastPosition = normaliseLastPosition(s.lastPosition);
    return s;
  },
  async setSettings(patch) {
    const next = { ...this.getSettings(), ...patch };
    next.lastPosition = normaliseLastPosition(next.lastPosition);
    writeJSON(LS_SETTINGS, next);
    return next;
  },
  /** The last position on its own (store.js keeps the settings row's clock out of it; here it is the same write). */
  async setLastPosition(lastPosition) {
    return this.setSettings({ lastPosition });
  },
  // Reading progress (CONTRACT.md "Reading progress"): localStorage-backed like the lookups, and never mixed with them.
  async getProgress() { return new Map(Object.entries(readJSON(LS_PROGRESS, {}))); },
  async markRead(unitIds) {
    const all = readJSON(LS_PROGRESS, {});
    const rows = makeProgressRows(unitIds, new Set(Object.keys(all)));
    if (!rows.length) return;
    for (const r of rows) all[r.unit_id] = r.read_at;
    writeJSON(LS_PROGRESS, all);
  },
  async resetProgress(weekN = null) {
    const n = weekN == null ? null : Number(weekN);
    const all = readJSON(LS_PROGRESS, {});
    for (const id of Object.keys(all)) if (n == null || weekOfUnit(id) === n) delete all[id];
    writeJSON(LS_PROGRESS, all);
  },
  // Study log (CONTRACT.md "Study log"): active ms per local day, localStorage-backed; never mixed with progress or lookups.
  async getStudyDays() {
    const all = readJSON(LS_STUDY, {});
    return new Map(Object.entries(all).filter(([d]) => isDayKey(d)).map(([d, ms]) => [d, cleanMs(ms)]));
  },
  async addActiveTime(day, ms) {
    if (!isDayKey(day) || !cleanMs(ms)) return;
    const all = readJSON(LS_STUDY, {});
    all[day] = cleanMs(all[day]) + cleanMs(ms);
    writeJSON(LS_STUDY, all);
  },
  async clearStudyLog() { writeJSON(LS_STUDY, {}); },
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
    if (e.key === LS_PROGRESS) emit('progress');
    if (e.key === LS_STUDY) emit('study');
  });
}

export const auth = {
  async signIn() { return { email: 'fixture@local' }; },
  async signOut() { console.info('[fixture] signOut'); },
  user() { return { email: 'fixture@local' }; },
  onChange() { return () => {}; },
};
