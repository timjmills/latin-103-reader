// Dev-only Store + auth implementation (CONTRACT.md "Store interface").
// Reads /data/build/*.json; keeps lookups and settings in localStorage so the
// UI's persistence paths are exercised. Chosen by main.js when ?fixture=1 or
// when app/config.js is missing / has no SUPABASE_URL.

import { DEFAULT_SETTINGS, normaliseAlignmentRows, normaliseLastPosition, makeProgressRows, normaliseProgressRow, weekOfUnit, isDayKey, cleanMs, roman, isShelfWeek, shelfKind, shelfChapter, COLLO_BASE } from './sync.js';
import { tokenize } from './tokenize.js';

const LS_LOOKUPS = 'l103.lookups';
const LS_SETTINGS = 'latin103.settings';
const LS_ALIGN = 'l103.align.';
const LS_PROGRESS = 'l103.progress';   // { unit_id: { week_n, read_at, reads, last_read_at } } — reading progress (CONTRACT.md "Reviews"), kept apart from the lookups; an older bare read_at value is one pass
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
/** The progress rows in localStorage as a Map unit_id → full row (a bare read_at string from before reviews is one pass). */
function progressRows(all = readJSON(LS_PROGRESS, {})) {
  const out = new Map();
  for (const [id, v] of Object.entries(all || {})) {
    const row = normaliseProgressRow(typeof v === 'string' ? { unit_id: id, week_n: weekOfUnit(id), read_at: v } : { unit_id: id, week_n: weekOfUnit(id), ...v });
    if (row?.read_at) out.set(id, row);
  }
  return out;
}
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
// ?lines=none — every unit without printed-line data, so the Book lines
// switch's "no printed line numbers" state can be exercised on any week.
const noLines = () => {
  try { return new URLSearchParams(location.search).get('lines') === 'none'; } catch { return false; }
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

// Book lines (CONTRACT.md "Book lines"): until the build carries `unit.lines`,
// week 1 gets plausible printed-line breaks in memory only — every ~55
// characters at a word boundary, numbered on from each block's `line_no` —
// so the book layout can be exercised. Not the book's own line breaks; the
// pipeline's data replaces them the moment a unit of the week has `lines`.
// Like the pipeline, a line's `start` is the first *letter* of its first
// word (tokenize() word starts), not the quote or bracket in front of it.
export const DEMO_LINE_WIDTH = 55;
/** Pure: the units with `lines` synthesised (a copy); untouched when any unit already has line data. */
export function withDemoLines(units, width = DEMO_LINE_WIDTH) {
  if (units.some((u) => Array.isArray(u.lines) && u.lines.length)) return units.map((u) => ({ ...u, lines: Array.isArray(u.lines) ? u.lines : [] }));
  const out = [];
  let line = null;   // the printed line being filled, and how much of it is used
  let col = 0;
  for (const u of [...units].sort((a, b) => a.order - b.order)) {
    if (u.block_start || line == null) { line = u.line_no ?? null; col = 0; }
    if (line == null || typeof u.la !== 'string') { out.push({ ...u, lines: [] }); continue; }
    const lines = [];
    const words = tokenize(u.la).filter((t) => t.isWord);
    const re = /\S+/g;
    let m;
    let first = true;
    while ((m = re.exec(u.la))) {
      const word = m[0];
      const need = (col > 0 ? 1 : 0) + word.length;
      if (col > 0 && col + need > width) { line += 1; col = 0; }
      if (first || col === 0) {
        const w = words.find((t) => t.start >= m.index && t.start < m.index + word.length);   // the chunk's first letter (`"Quis` → Q); a letterless chunk keeps its own start
        if (first || lines[lines.length - 1].line !== line) lines.push({ line, start: first ? 0 : (w?.start ?? m.index) });
      }

      col += (col > 0 ? 1 : 0) + word.length;
      first = false;
    }
    out.push({ ...u, lines });
  }
  return out;
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

// Review shelf (GRAMMAR-CONTRACT.md "Review shelf"): two chapters of Familia
// Romana as library weeks n = 100 + chapter (r01, r07), Latin only (`en` = ""),
// no audio and no pictures, line numbers as usual — so the shelf UI can be
// tried offline. Each chapter carries the shelf teaching layer the real store
// serves (`data/shelf-notes-NN.json`): two lēctiōnēs with an English and a
// simple-Latin summary, sentence notes with their plain-words version, and
// grammar-focus highlights. The sentences, notes and summaries alike are
// invented on the chapters' themes (the book's own text is never committed).
const SHELF_BASE = 100;
const isShelf = (n) => isShelfWeek(n);
const SHELF_TEXT = {
  1: { title: 'Imperium Rōmānum', focus: { key: 'nominative', label: 'Nominative: the subject', blurb: 'The subject form (puella, fluvius, oppidum) and singular against plural.' }, la: [
    'Rōma in Italiā est.', 'Italia in Eurōpā est.', 'Gallia quoque in Eurōpā est.', 'Ubi est Hispānia?', 'Hispānia in Eurōpā est, nōn in Asiā.',
    'Nīlus fluvius magnus est.', 'Tiberis fluvius parvus est.', 'Multī fluviī in Eurōpā sunt.', 'Sardinia īnsula est.', 'Corsica et Sardinia īnsulae sunt.',
    'Brundisium oppidum Rōmānum est.', 'Quid est Brundisium? Oppidum est.',
  ] },
  7: { title: 'Puella et Rosa', focus: { key: 'dative', label: 'Dative case: indirect objects', blurb: "The 'to/for' form: the person something is given to." }, la: [
    'Iūlia in hortō est.', 'Puella rosās videt et rīdet.', 'Iūlius fīliae suae rosam dat.', 'Iūlia patrī grātiās agit.', 'Mārcus sorōrī nihil dat.',
    'Aemilia puerīs māla dat.', 'Quīntus mātrī mālum ostendit.', 'Cui Iūlius ōsculum dat? Iūliae.', 'Syra puellae speculum tenet.', 'Puella sē in speculō videt.',
    'Ecce rosa in nāsō puellae!', 'Iūlia laeta ē hortō exit.',
  ] },
};
// The teaching layer for the two shelf chapters: `parts` (each with both
// summaries, over the sentences it names), `notes` (unit id → note +
// note_simple) and `highlights` (a phrase of the sentence, the label the
// grammar map matches on, the note and its plain-words version). Invented, in
// the same style as SHELF_TEXT above.
const SHELF_TEACH = {
  1: {
    parts: [
      { part: 'Lēctiō prīma', from: 1, to: 6,
        summary_en: 'Rome is in Italy and Italy in Europe; Gaul is in Europe too. Where is Spain? In Europe, not in Asia. The Nile is a big river.',
        summary_la: 'Rōma in Italiā est, Italia in Eurōpā. Gallia quoque in Eurōpā est. Hispānia in Eurōpā est, nōn in Asiā. Nīlus fluvius magnus est.' },
      { part: 'Lēctiō secunda', from: 7, to: 12,
        summary_en: 'The Tiber is a small river, but there are many rivers in Europe. Sardinia is an island, and Corsica and Sardinia together are islands. Brundisium is a Roman town.',
        summary_la: 'Tiberis fluvius parvus est, sed multī fluviī in Eurōpā sunt. Sardinia īnsula est; Corsica et Sardinia īnsulae sunt. Brundisium oppidum Rōmānum est.' },
    ],
    notes: {
      5: { note: 'in + ablative says where something is: in Eurōpā, in Asiā — the -ā is long, and that long -ā is the case ending. nōn denies the phrase it stands in front of, not the verb.',
        note_simple: "'Spain is in Europe, not in Asia.' After in for a place, the noun changes its ending: Eurōpa becomes in Eurōpā. nōn ('not') goes in front of the words it denies." },
      8: { note: 'Multī fluviī are both nominative plural: the adjective agrees with its noun in case, number and gender, and a plural subject takes sunt, not est.',
        note_simple: "'There are many rivers in Europe.' More than one thing takes sunt ('are') where one takes est ('is'), and the word for 'many' copies the plural ending of 'rivers'." },
      10: { note: 'Two subjects joined by et count as more than one: īnsulae sunt, not īnsula est. The complement īnsulae stands in the nominative, like the subject.',
        note_simple: "'Corsica and Sardinia are islands.' Two names joined by et ('and') are more than one, so the sentence uses sunt ('are') and the plural word for islands." },
      12: { note: "Quid, 'what?', stands first. The answer repeats only the new word — oppidum est — because est already carries 'it is'.",
        note_simple: "'What is Brundisium? It is a town.' Latin asks with Quid ('what') at the front, and the answer leaves out 'it': the verb est says it already." },
    },
    highlights: [
      { line: 1, text: 'in Italiā', label: 'ablative: place where',
        note: 'in + ablative for where something is. Italia becomes in Italiā, and the long -ā is the ending doing the work of English "in".',
        simple: "'Rome is in Italy.' To say where something is, Latin puts in in front and lengthens the ending: Italia → in Italiā." },
      { line: 8, text: 'Multī fluviī', label: 'nominative plural: the subject',
        note: 'Both words are nominative plural — the -ī ending on each. The adjective agrees with its noun, so "many" is plural because "rivers" is.',
        simple: "'Many rivers' is the subject of the sentence, and both words end in -ī because there is more than one river." },
      { line: 10, text: 'īnsulae', label: 'nominative plural: the complement',
        note: 'The word after sunt describes the subject, so it is nominative too — īnsulae, not īnsulās.',
        simple: "'…are islands.' The word after 'are' says what the subject is, so it takes the subject ending, not the object one." },
    ],
  },
  7: {
    parts: [
      { part: 'Lēctiō prīma', from: 1, to: 6,
        summary_en: 'Julia is in the garden, where she sees the roses and laughs. Julius gives his daughter a rose and she thanks her father. Marcus gives his sister nothing, while Aemilia gives the boys apples.',
        summary_la: 'Iūlia in hortō est et rosās videt. Iūlius fīliae suae rosam dat, et puella patrī grātiās agit. Mārcus sorōrī nihil dat; Aemilia puerīs māla dat.' },
      { part: 'Lēctiō secunda', from: 7, to: 12,
        summary_en: 'Quintus shows his mother an apple, and Julius gives a kiss — to Julia. Syra holds the mirror for the girl, who sees herself in it. A rose is on her nose, and Julia leaves the garden happy.',
        summary_la: 'Quīntus mātrī mālum ostendit. Iūlius Iūliae ōsculum dat. Syra puellae speculum tenet et puella sē in speculō videt. Iūlia laeta ē hortō exit.' },
    ],
    notes: {
      3: { note: 'dat takes two objects at once: the thing given (rosam, accusative) and the person it goes to (fīliae, dative). suae is the reflexive possessive — his own daughter, not somebody else\'s.',
        note_simple: "'Julius gives his own daughter a rose.' The rose is what is given, so it takes the object ending -am; the daughter is who gets it, so she takes the 'to/for' ending -ae." },
      5: { note: 'sorōrī is the dative singular of the third-declension soror: -ī, where a first-declension noun would have -ae. nihil, "nothing", is the thing given.',
        note_simple: "'Marcus gives his sister nothing.' soror ('sister') makes its 'to/for' form with -ī: sorōrī. nihil means 'nothing'." },
      6: { note: 'puerīs is the dative plural, -īs. māla is the neuter plural of mālum, "apples" — with a long ā, and so a different word from mala, "bad things".',
        note_simple: "'Aemilia gives the boys apples.' The boys are who get them, so they take the plural 'to/for' ending -īs. māla, with a long a, is the plural of mālum, an apple." },
      8: { note: 'Cui is the dative of quis: "to whom?". The answer gives the dative alone, Iūliae — the rest of the sentence is understood from the question.',
        note_simple: "'To whom does Julius give a kiss? To Julia.' Cui asks 'to whom'; the answer is just the 'to/for' form of the name." },
    },
    highlights: [
      { line: 3, text: 'fīliae', label: 'dative: indirect object',
        note: 'The daughter is the one the rose ends up with, so she stands in the dative while rosam, the thing given, is accusative. -ae is the first-declension dative singular.',
        simple: "The daughter is who gets the rose, so she is in the dative (the 'to/for' form): fīliae. Latin needs no word for 'to' — the ending does it." },
      { line: 5, text: 'sorōrī', label: 'dative: indirect object',
        note: 'soror is third declension, so its dative singular is sorōrī. The case is the same as fīliae above; only the declension differs.',
        simple: "sorōrī is the 'to/for' form of soror, 'sister'. Words like soror make it with -ī instead of -ae." },
      { line: 6, text: 'puerīs', label: 'dative plural: indirect object',
        note: 'More than one receiver: the dative plural of puer is puerīs. The apples given stay accusative.',
        simple: "puerīs is the 'to/for' form for more than one boy. The apples are still what is given, so they keep the object ending." },
      { line: 8, text: 'Cui', label: 'dative of quis: to whom?',
        note: 'Cui is the dative of the question word quis — "to whom?" — and it is answered by another dative, Iūliae.',
        simple: "Cui means 'to whom?'. The answer to a 'to whom' question is itself in the 'to/for' form: Iūliae." },
    ],
  },
};
const shelfPart = (c, line) => (SHELF_TEACH[c]?.parts ?? []).find((p) => line >= p.from && line <= p.to) ?? null;
function shelfWeek(c) {
  const t = SHELF_TEXT[c];
  const teach = SHELF_TEACH[c];
  const parts = teach
    ? teach.parts.map((p) => ({ part: p.part, lines: `${p.from}–${p.to}`, source: 'FR', summary_en: p.summary_en, summary_la: p.summary_la }))
    : [{ part: `Capitulum ${c}`, lines: `1–${t.la.length}`, source: 'FR' }];
  return { n: SHELF_BASE + c, id: `r${pad(c)}`, title: t.title, source: 'FR', chapter: roman(c), has_line_numbers: true, focus: t.focus,
    parts, unit_count: t.la.length };
}
function shelfUnits(c) {
  const t = SHELF_TEXT[c];
  const teach = SHELF_TEACH[c];
  return t.la.map((la, i) => {
    const line = i + 1;
    const part = shelfPart(c, line);
    const n = teach?.notes?.[line] ?? null;
    return {
      id: `r${pad(c)}:${line}.1`, order: i, part: part?.part ?? `Capitulum ${c}`, source: 'FR', line_no: line,
      block_start: part ? line === part.from : i % 3 === 0, unit_type: 'sentence', speaker: null,
      la, en: '', en_raw: null, note: n?.note ?? null, note_simple: n?.note_simple ?? null, tags: [], margin: [], lines: [{ line, start: 0 }], week_n: SHELF_BASE + c,
    };
  });
}
/** The chapter's grammar-focus highlights, addressed to the units the fixture built. */
function shelfHighlights(c) {
  return (SHELF_TEACH[c]?.highlights ?? []).map((h) => ({ unit_id: `r${pad(c)}:${h.line}.1`, text: h.text, label: h.label, note: h.note, simple: h.simple }));
}
const shelfWeeks = () => Object.keys(SHELF_TEXT).map((c) => shelfWeek(Number(c)));

// Colloquia Personarum (GRAMMAR-CONTRACT.md "Wave 3 · Colloquia shelf"): two
// colloquia as library weeks n = 200 + colloquium (c01, c07), Latin only, one
// unit per speaker turn (`unit_type: "speech"`, `speaker` set), no line
// numbers and no marginal glosses — so the second shelf can be tried offline.
// The turns are invented on the colloquia's themes (the book is never committed).
const COLLO_TEXT = {
  1: { title: 'Mārcus et Iūlia', focus: { key: 'nominative', label: 'Nominative: the subject', blurb: 'Who is speaking, and who is spoken of.' }, turns: [
    ['MĀRCUS', 'Ubi est Iūlia?'], ['IŪLIA', 'Hīc sum, Mārce.'], ['MĀRCUS', 'Quid agis?'], ['IŪLIA', 'Rosās numerō.'],
    ['MĀRCUS', 'Quot rosae sunt?'], ['IŪLIA', 'Sex rosae sunt.'], ['MĀRCUS', 'Rosae pulchrae sunt.'], ['IŪLIA', 'Ita est.'],
    ['MĀRCUS', 'Ecce Quīntus venit.'], ['QUĪNTUS', 'Salvēte, Mārce et Iūlia!'], ['IŪLIA', 'Salvē, Quīnte.'], ['MĀRCUS', 'In hortum eāmus.'],
  ] },
  7: { title: 'Iūlius et Syra', focus: { key: 'dative', label: 'Dative case: indirect objects', blurb: "The 'to/for' form, heard in a dialogue." }, turns: [
    ['IŪLIUS', 'Syra, quid puellae dās?'], ['SYRA', 'Speculum eī dō, domine.'], ['IŪLIUS', 'Cūr speculum?'], ['SYRA', 'Iūlia sē vidēre vult.'],
    ['IŪLIUS', 'Fīliae meae rosam dabō.'], ['SYRA', 'Rosa puellae grāta erit.'], ['IŪLIUS', 'Et puerīs māla dabō.'], ['SYRA', 'Puerī tibi grātiās agent.'],
    ['IŪLIUS', 'Ubi est Mārcus?'], ['SYRA', 'Mārcus mātrī epistulam legit.'], ['IŪLIUS', 'Bene.'], ['SYRA', 'Ecce Iūlia venit, domine.'],
  ] },
};
function colloWeek(c) {
  const t = COLLO_TEXT[c];
  return { n: COLLO_BASE + c, id: `c${pad(c)}`, title: t.title, source: 'CP', chapter: roman(c), has_line_numbers: false, focus: t.focus,
    parts: [{ part: `Colloquium ${roman(c)}`, lines: '', source: 'CP' }], unit_count: t.turns.length };
}
function colloUnits(c) {
  const t = COLLO_TEXT[c];
  return t.turns.map(([speaker, la], i) => ({
    id: `c${pad(c)}:${i + 1}.1`, order: i, part: `Colloquium ${roman(c)}`, source: 'CP', line_no: null, block_start: true, unit_type: 'speech', speaker,
    la, en: '', en_raw: null, note: null, note_simple: null, tags: [], margin: [], lines: [], week_n: COLLO_BASE + c,
  }));
}
const colloWeeks = () => Object.keys(COLLO_TEXT).map((c) => colloWeek(Number(c)));

async function loadWeek(weekN) {
  if (isShelf(weekN)) {
    const c = shelfChapter(weekN);
    const collo = shelfKind(weekN) === 'colloquia';
    if (!cache.units.has(weekN)) cache.units.set(weekN, collo ? (COLLO_TEXT[c] ? colloUnits(c) : []) : (SHELF_TEXT[c] ? shelfUnits(c) : []));
    return cache.units.get(weekN);
  }
  if (!cache.units.has(weekN)) {
    const data = await fetchJSON(`week-${pad(weekN)}.json`);
    const demo = weekN === 1 && demoMargins();
    let units = data.units.map((u) => ({ ...u, margin: demo && DEMO_MARGIN[u.id] ? DEMO_MARGIN[u.id] : (u.margin ?? []) }));
    if (weekN === 1) units = withPlainDemo(units).units;
    if (noLines()) units = units.map((u) => ({ ...u, lines: [] }));
    else if (weekN === 1) units = withDemoLines(units);
    else units = units.map((u) => ({ ...u, lines: Array.isArray(u.lines) ? u.lines : [] }));   // like store.js: never undefined
    cache.units.set(weekN, units);
    if (!cache.weeks) cache.weeks = [withDemoSummaries(data.week)];
  }
  return cache.units.get(weekN);
}

export const store = {
  async ready() {
    try { cache.weeks = (await fetchJSON('weeks.json')).map(withDemoSummaries); }
    catch { await loadWeek(1); }
    cache.weeks = [...cache.weeks.filter((w) => !isShelf(w.n)), ...shelfWeeks(), ...colloWeeks()];   // the course weeks, then the review shelf, then the colloquia
    return true;
  },
  async getWeeks() { if (!cache.weeks) await this.ready(); return cache.weeks; },
  getUnits: (weekN) => loadWeek(weekN),
  async getHighlights(weekN) {
    // A review chapter's highlights come from its own teaching layer (SHELF_TEACH); the colloquia carry none.
    if (isShelf(weekN)) return shelfKind(weekN) === 'review' ? shelfHighlights(shelfChapter(weekN)) : [];
    if (!cache.highlights.has(weekN)) {
      try {
        const rows = await fetchJSON(`highlights-week-${pad(weekN)}.json`);
        cache.highlights.set(weekN, weekN === 1 ? withPlainDemo([], rows).highlights : rows);
      }
      catch { cache.highlights.set(weekN, []); }
    }
    return cache.highlights.get(weekN);
  },
  getPictures: (weekN) => (isShelf(weekN) ? Promise.resolve([]) : loadPictures(weekN)),
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
  async getProgress() { return new Map([...progressRows()].map(([id, r]) => [id, r.read_at])); },
  async getProgressRows() { return progressRows(); },
  // A first read is a new row; a sentence met again ≥ 30 min after its last pass is a review (reads + 1) — the split is makeProgressRows() in sync.js, as in store.js.
  async markRead(unitIds) {
    const all = readJSON(LS_PROGRESS, {});
    const rows = makeProgressRows(unitIds, progressRows(all), new Date().toISOString());
    if (!rows.length) return;
    for (const r of rows) all[r.unit_id] = { week_n: r.week_n, read_at: r.read_at, reads: r.reads, last_read_at: r.last_read_at };
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
    if (isShelf(n)) return [];
    const local = readJSON(LS_ALIGN + n, null);
    if (Array.isArray(local) && local.length) return normaliseAlignmentRows(local);
    return normaliseAlignmentRows(await pipelineAlignment(n));
  },
  async saveAlignment(weekN, rows) { writeJSON(LS_ALIGN + Number(weekN), normaliseAlignmentRows(rows)); },
  // An upload lives in memory for the session (upload → align → play); with no
  // upload, the repo's own audio/week-NN.mp3 is used when the dev server has it.
  async getAudioUrl(weekN) {
    const n = Number(weekN);
    if (isShelf(n)) return cache.audio.get(n) ?? null;   // no recording to look for on the dev server
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
