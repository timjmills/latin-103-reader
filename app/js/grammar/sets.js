// Chapter sets (GRAMMAR-CONTRACT.md "Wave 2"): the question-word sets
// (data/grammar/questions/NN.json), the vocabulary decks
// (data/grammar/vocab/NN.json) and the pensa (public.pensa, private, through
// store-grammar.js). Each set is a pseudo-skill for the scheduler —
// `questions-NN`, `vocab-NN`, `vocab-NN-rev`, `pensum-NN` — with the same
// states and rows as a grammar skill, so Learn / Add / Practise and the mixed
// session treat them alike (the session caps them at 3 per 10 unless the
// preset is "This week").
//
//   createSetLoader({ fetchJson })            manifests + chapter files (tests pass a fetcher)
//   setSkills({ questions, vocab, pensa })    → Map id → pseudo-skill
//   createSetItems({ sets, units, pool, rand }).generate({ skill, kind, stage }) → item | null
//   matchQuestion(typed, answers, sentence)   answer matching: macron-stripped, case-insensitive, the full sentence accepted
//   POPULATIONS / populationOf                the four kinds, and which one a skill is
//   mixGrid({ chapters, skills, order, sets, drillable })  the chapters × kinds the library can offer
//   normaliseMix / mixIn / mixWhole / mixHolds / filterMix / mixToggle / mixCounts   the learner's ticks
//   mixNote(sel, grid) / mixTitle(sel, grid)   what a mixed set mixes, and the copy that says so
//   resolveRef(la, ref) / resolveList(la, list)  a question's `{ span }` / `{ parts }` references → the Latin they stand for
//
// A question set's answers and choices are references into the sentence the
// item names, not the book's words (PROMPT.md §5): they are resolved on the
// device against the private text, and an item whose sentence is missing is
// hidden rather than shown half-resolved.
//
// Item kinds: `question` (input type | choice | tap from the item; the
// answering sentence shown after with the answer lit), `vocab` (Latin →
// English choice; every other item a 4-pair `match`; the reverse deck typed
// from stage 2), `pensum` (A: endings typed inline; B: word blanks from a
// tappable bank; C: a question, typed or tap). `unverified` pensum items are hidden.

import { tokenize, stripMacrons } from '../tokenize.js';
import { roman, shelfChapter } from '../sync.js';
import { normaliseAnswer, la, partsText, q } from './items.js';
import { spine, chapterMaterial } from './chapter.js';

export const SET_KINDS = Object.freeze(['question', 'vocab', 'pensum']);
const pad = (n) => String(n).padStart(2, '0');
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/**
 * The question words the contract lists, keyed by every inflected form the sets
 * ship. 88 items carry `quem`, `cui`, `cuius`, `quae`, `quī`, `quod`; the
 * generated hint read "A cuius question: the answer is in the chapter", and the
 * "≥ 8 different question words" rule was measured on the raw field (m12). The
 * inflected form is kept for display; `qword` is the lemma.
 */
const QWORD_LEMMA = {
  quem: 'quis', quid: 'quid', cui: 'quis', cuius: 'quis', quo: 'quis', quibus: 'quis', quis: 'quis',
  quae: 'quī', qui: 'quī', quod: 'quī', quam: 'quī', quos: 'quī', quas: 'quī', quorum: 'quī', quarum: 'quī',
  qualis: 'quālis', quale: 'quālis', qualem: 'quālis', quot: 'quot', uter: 'uter', utra: 'uter', utrum: 'uter',
};
/** The lemma of a question word, macrons and case ignored; null when there is none. Pure. */
export function qwordLemma(qword) {
  const raw = String(qword ?? '').trim();
  if (!raw) return null;
  return QWORD_LEMMA[stripMacrons(raw).toLowerCase()] ?? raw;
}
const POS_LABEL = { N: 'noun', ADJ: 'adjective', V: 'verb', ADV: 'adverb', PRON: 'pronoun', PREP: 'preposition', CONJ: 'conjunction', NUM: 'numeral', INTERJ: 'interjection' };

/* ------------------------------------------------------------ chapters */
/** "XXVII (FS 1, 5); FL 63–65" → 27; a number stays a number; null when unreadable. Pure. */
export function fromRoman(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const m = /^\s*([MDCLXVI]+)/i.exec(String(s ?? ''));
  if (!m) { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : null; }
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let out = 0;
  const t = m[1].toUpperCase();
  for (let i = 0; i < t.length; i++) { const a = v[t[i]], b = v[t[i + 1]] ?? 0; out += a < b ? -a : a; }
  return out || null;
}
/**
 * The Familia Romana chapter a library week reads: a shelf week's chapter
 * (review shelf n − 100, colloquia n − 200 — colloquium N accompanies chapter
 * N), a course week's `chapter` field. Pure.
 */
export function chapterOfWeek(week) {
  if (!week) return null;
  const c = shelfChapter(week.n);
  if (c != null) return c;
  return fromRoman(week.chapter);
}

/* -------------------------------------------------------------- loader */
/** A loader over `fetchJson(name)` (relative to data/grammar/): the two manifests once, each chapter file once; a missing file is null. */
export function createSetLoader({ fetchJson }) {
  const cache = new Map();
  // A rejection is *not* memoised (M10): the entry is dropped so a later loadAll retries, and the failure is logged rather than swallowed.
  const once = (name, fn) => {
    if (!cache.has(name)) cache.set(name, fn().catch((e) => { cache.delete(name); console.warn(`[grammar] chapter set ${name} could not be loaded`, e?.message || e); return null; }));
    return cache.get(name);
  };
  const manifest = (dir) => once(`${dir}/index.json`, async () => { const raw = await fetchJson(`${dir}/index.json`); return manifestChapters(raw); });
  const chapter = (dir, c) => once(`${dir}/${pad(c)}.json`, () => fetchJson(`${dir}/${pad(c)}.json`));
  /** { questions: Map chapter → set, vocab: Map chapter → deck } — every listed chapter loaded. */
  const normOf = (dir, d) => (dir === 'questions' ? normaliseQuestionSet(d) : normaliseVocab(d));
  async function load(chaptersWanted = null) {
    const out = { questions: new Map(), vocab: new Map(), failed: [] };
    for (const dir of ['questions', 'vocab']) {
      const listed = await manifest(dir);
      if (listed == null) out.failed.push(`${dir}/index.json`);
      const chapters = (listed ?? []).filter((c) => chaptersWanted == null || chaptersWanted.includes(c));
      const docs = await Promise.all(chapters.map((c) => chapter(dir, c)));
      docs.forEach((d, i) => { const norm = normOf(dir, d); if (norm) out[dir].set(norm.chapter ?? chapters[i], norm); else out.failed.push(`${dir}/${pad(chapters[i])}.json`); });
    }
    return out;
  }
  /** Every listed chapter. */
  const loadAll = () => load(null);
  /** One chapter only — what the weeks-menu Today card needs (M6): two files, not 68. */
  const loadChapter = (c) => load([Number(c)]);
  return { loadAll, loadChapter };
}
/** `{ "chapters": [1, 7] }` (or a list) → [1, 7]; anything else → null. Pure. */
export function manifestChapters(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.chapters) ? raw.chapters : null;
  if (!list) return null;
  return [...new Set(list.map((x) => (typeof x === 'string' ? Number(x.replace(/\.json$/i, '')) : Number(x))).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}
/* ------------------------------------------------- sentence references
 * Ørberg's Latin never ships in the public app (PROMPT.md §5): a question
 * file that needs the book's own words carries *where they are*, not what
 * they say. An accepted answer or a choice is therefore either
 *
 *   "Minimē"                      our own wording — a form, a name, a phrase
 *   { "span": [3, 6] }            words 3–6 of the item's sentence
 *   { "parts": [ … ] }            our wording woven around such runs
 *
 * and the words arrive at resolve time from the private text the device
 * fetched by `unit_id`. pipeline/latin_text.py holds the line the public
 * files are checked against; pipeline/span_questions.py writes them.
 */
/** A stored answer or choice, validated: a string, `{ span }` or `{ parts }`; null when unusable. Pure. */
export function normaliseRef(ref) {
  const span = (s) => (Array.isArray(s) && s.length === 2 && s.every((n) => Number.isInteger(n)) && s[0] >= 0 && s[1] >= s[0] ? { span: [s[0], s[1]] } : null);
  if (typeof ref === 'string') return ref.trim() || null;
  if (!ref || typeof ref !== 'object') return null;
  if (ref.span) return span(ref.span);
  if (Array.isArray(ref.parts) && ref.parts.length) {
    const parts = ref.parts.map((p) => (typeof p === 'string' ? (p.trim() || null) : span(p?.span)));
    return parts.every(Boolean) ? { parts } : null;
  }
  return null;
}
/** The parts of a resolved reference as one string: one space between them, none before punctuation. Pure. */
const joinParts = (parts) => parts.join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
/**
 * A stored answer or choice → the Latin it stands for, read out of `la`.
 * `null` when it cannot be resolved (no sentence, or an index past its end) —
 * the caller hides the item rather than grading against a guess. Pure.
 */
export function resolveRef(la, ref) {
  if (typeof ref === 'string') return ref;
  if (!ref || typeof ref !== 'object') return null;
  const words = tokenize(String(la ?? '')).filter((t) => t.isWord);
  const slice = (s) => {
    const [i, j] = Array.isArray(s) ? s : [];
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < i || j >= words.length) return null;
    return String(la).slice(words[i].start, words[j].end);
  };
  if (ref.span) return slice(ref.span);
  if (Array.isArray(ref.parts)) {
    const out = [];
    for (const p of ref.parts) { const t = typeof p === 'string' ? p : slice(p?.span); if (t == null) return null; out.push(t); }
    return out.length ? joinParts(out) : null;
  }
  return null;
}
/** Every answer or choice of a list resolved against `la`; null when any one cannot be. Pure. */
export function resolveList(la, list) {
  const out = [];
  for (const ref of list || []) { const t = resolveRef(la, ref); if (t == null) return null; out.push(t); }
  return out;
}
/** Resolved answers with their macron-stripped variants, deduped — what the matcher and the feedback use. Pure. */
export const withStripped = (answers) => [...new Set((answers || []).flatMap((a) => [a.trim(), stripMacrons(a.trim())]))];

/** Pure: a question set with every item usable (answers and choices kept as references, input defaulted). */
export function normaliseQuestionSet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const chapter = Number(raw.chapter) || null;
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((it) => it && typeof it.q === 'string' && Array.isArray(it.answers) && it.answers.length).map((it, i) => {
    const answers = it.answers.map(normaliseRef).filter(Boolean);
    const input = ['type', 'choice', 'tap'].includes(it.input) ? it.input : 'type';
    const choices = (Array.isArray(it.choices) ? it.choices : []).map(normaliseRef).filter(Boolean);
    return { id: String(it.id ?? `q${pad(chapter ?? 0)}-${pad(i + 1)}`), qword: qwordLemma(it.qword), qwordForm: it.qword ?? null, q: it.q, en: typeof it.en === 'string' ? it.en : '', unit_id: typeof it.unit_id === 'string' ? it.unit_id : null, answers, input: input === 'choice' && choices.length < 2 ? 'type' : input, choices, hint: typeof it.hint === 'string' ? it.hint : '' };
  }).filter((it) => it.answers.length);
  return { chapter, week_id: typeof raw.week_id === 'string' ? raw.week_id : null, title: typeof raw.title === 'string' ? raw.title : '', items };
}
/** Pure: a vocabulary deck with every word usable. */
export function normaliseVocab(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const chapter = Number(raw.chapter) || null;
  const words = (Array.isArray(raw.words) ? raw.words : []).filter((w) => w && typeof w.lemma === 'string' && typeof w.meaning === 'string' && w.meaning.trim()).map((w) => ({
    lemma: w.lemma.trim(), dict: typeof w.dict === 'string' && w.dict ? w.dict : w.lemma.trim(), pos: typeof w.pos === 'string' ? w.pos : '', gender: w.gender ?? null, decl: w.decl ?? null,
    meaning: w.meaning.trim(), parts: typeof w.parts === 'string' ? w.parts : null, unit_id: typeof w.unit_id === 'string' ? w.unit_id : null, count: Number(w.count) || 0,
  }));
  // The same lemma with one part of speech twice (a comparative beside its positive) is one word: the first stands. liber / līber (noun and adjective) are two.
  const seen = new Set();
  return { chapter, words: words.filter((w) => { const k = `${w.lemma}|${w.pos}`; return !seen.has(k) && seen.add(k); }) };
}
/** Pure: the pensa rows (public.pensa) grouped by chapter: Map chapter → { A: [...], B: [...], C: [...] }, unverified items dropped. */
export function groupPensa(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const c = Number(r?.chapter);
    const kind = String(r?.kind ?? '').toUpperCase();
    if (!Number.isFinite(c) || !['A', 'B', 'C'].includes(kind)) continue;
    const items = (Array.isArray(r.items) ? r.items : []).map((it, i) => ({ ...it, i })).filter((it) => {
      if (!it || it.unverified) return false;
      if (kind === 'C') return typeof it.q === 'string' && Array.isArray(it.answers);
      if (typeof it.text !== 'string' || !Array.isArray(it.blanks) || !it.blanks.length) return false;
      // The holes in the text and the blanks must correspond one to one, or the wrong answer is paired with the wrong hole (m6).
      const holes = pensumSegments(it.text).filter((sg) => sg.blank != null).length;
      if (holes !== it.blanks.length) { console.warn(`[grammar] pensum ${c}${kind} item ${it.i}: ${holes} blanks in the text, ${it.blanks.length} answers — hidden`); return false; }
      return true;
    });
    if (!out.has(c)) out.set(c, { A: [], B: [], C: [] });
    out.get(c)[kind] = items;
  }
  return out;
}

/* --------------------------------------------------------- pseudo-skills */
export const SET_CATEGORY = { questions: 'questions', vocab: 'vocabulary', pensum: 'pensum' };
/**
 * The chapter sets as scheduler skills (Map id → skill). `questions` / `vocab`:
 * Map chapter → set; `pensa`: groupPensa(). Each skill carries `set`
 * ('questions' | 'vocab' | 'pensum'), `chapter`, `count`, `kinds` (one),
 * `rev` for the English → Latin deck, `data` (the set itself). Pure.
 */
export function setSkills({ questions = new Map(), vocab = new Map(), pensa = new Map(), weeks = [] } = {}) {
  const out = new Map();
  const weekOf = (chapter, weekId) => weekId ? weeks.find((w) => w.id === weekId) ?? null : weeks.find((w) => chapterOfWeek(w) === chapter) ?? null;
  const common = (id, set, chapter, title, plain, kinds, count, extra = {}) => ({
    id, set, chapter, title, plain, latin_label: null, category: SET_CATEGORY[set], course: null, week: null, notes_pages: [],
    prereqs: [], confusable_with: [], paradigms: [], paradigm_focus: null, patterns: [], parse_filter: null, feature: null, kinds, count, summary: plain, ...extra,
  });
  for (const [chapter, set] of questions) {
    const wk = weekOf(chapter, set.week_id);
    out.set(`questions-${pad(chapter)}`, common(`questions-${pad(chapter)}`, 'questions', chapter, `Questions · Cap. ${roman(chapter)}`, `quis / quid / ubi … about chapter ${roman(chapter)}${set.title ? ` (${set.title})` : ''}`, ['question'], set.items.length, { data: set, week_n: wk?.n ?? null, week_id: set.week_id ?? wk?.id ?? null }));
  }
  for (const [chapter, deck] of vocab) {
    const wk = weekOf(chapter, null);
    out.set(`vocab-${pad(chapter)}`, common(`vocab-${pad(chapter)}`, 'vocab', chapter, `Vocabulary · Cap. ${roman(chapter)}`, `the chapter's new words, Latin → English`, ['vocab'], deck.words.length, { data: deck, rev: false, week_n: wk?.n ?? null }));
    out.set(`vocab-${pad(chapter)}-rev`, common(`vocab-${pad(chapter)}-rev`, 'vocab', chapter, `Vocabulary · Cap. ${roman(chapter)} · English → Latin`, `the chapter's new words, English → Latin (an optional extra deck)`, ['vocab'], deck.words.length, { data: deck, rev: true, week_n: wk?.n ?? null }));
  }
  for (const [chapter, p] of pensa) {
    const count = p.A.length + p.B.length + p.C.length;
    if (!count) continue;
    const wk = weekOf(chapter, null);
    out.set(`pensum-${pad(chapter)}`, common(`pensum-${pad(chapter)}`, 'pensum', chapter, `Pensa · Cap. ${roman(chapter)}`, `Ørberg's Pensum A, B and C for chapter ${roman(chapter)} (practise only)`, ['pensum'], count, { data: p, week_n: wk?.n ?? null }));
  }
  return out;
}
/** The set skills of one chapter, in Questions · Vocabulary · Pensa order (the reverse deck after its own). Pure. */
export function setsOfChapter(sets, chapter) {
  const c = pad(chapter);
  return [`questions-${c}`, `vocab-${c}`, `vocab-${c}-rev`, `pensum-${c}`].map((id) => sets.get(id)).filter(Boolean);
}
/** Every chapter with a set, ascending. Pure. */
export const setChapters = (sets) => [...new Set([...sets.values()].map((s) => s.chapter))].sort((a, b) => a - b);

/* --------------------------------------------- what a mixed set may mix */
/**
 * The four populations a mixed session draws from, in the order the Practice
 * setup lays them across the top of its grid. They are not a new taxonomy:
 * the first is the book's grammar skills (`skills.json`), and the other three
 * are exactly the chapter sets `setSkills` above builds — `set` on the
 * pseudo-skill says which.
 */
export const POPULATIONS = Object.freeze(['skills', 'questions', 'vocab', 'pensum']);
/** What each is called on screen — the map's own words for the same rows (ui.js SET_ROW_LABEL). */
export const POPULATION_LABEL = Object.freeze({ skills: 'Skills', questions: 'Questions', vocab: 'Vocabulary', pensum: 'Pensa' });
/** …and as a phrase a sentence can carry: "only the vocabulary decks and the pensa". */
export const POPULATION_PHRASE = Object.freeze({ skills: 'the grammar skills', questions: "the chapters' questions", vocab: 'the vocabulary decks', pensum: 'the pensa' });

/** Which population a skill belongs to: a chapter set says so in `set`, everything else is a grammar skill. Pure. */
export function populationOf(skill) {
  const set = skill && typeof skill === 'object' ? skill.set : null;
  return POPULATIONS.includes(set) ? set : 'skills';
}

/* ------------------------------------------ the mix, chapter by chapter */
/**
 * **What the learner ticks** (their ask of 2026-09-13: "a menu with the
 * chapters laid out vertically and horizontally you can select the pense,
 * practice, vocab, or story questions to include in the practice"). The mix
 * is no longer four switches over the whole library but a grid: a chapter a
 * row, a population a column, and one **cell** — a chapter's things of one
 * kind — the unit the learner turns on and off.
 *
 * A selection is a list of **tokens**, and there are two kinds of token,
 * because the grid has two kinds of control and they mean different things:
 *
 *   `'vocab'`      a whole **column**: that kind, every chapter, including
 *                  chapters that reach the library later. This is exactly
 *                  what the old global toggle meant, so a stored
 *                  `settings.grammar.populations` — `['pensum']`, "Pensa
 *                  only" — **is already a selection in the new shape** and
 *                  goes on meaning what it meant. There is no migration step,
 *                  nothing to rewrite and nothing to lose; and an older
 *                  device, which can read only these, degrades to the columns
 *                  it understands rather than to nothing.
 *   `'vocab:26'`   one **cell**: chapter XXVI's vocabulary, that chapter and
 *                  no other.
 *
 * …and `null` — never chosen, or "All" — is everything there is, now and
 * whatever arrives.
 *
 * **A chapter that arrives later** joins the mix in every column the learner
 * took whole, and stays out of every column they picked chapter by chapter.
 * Neither answer is right for both learners, so the selection records which
 * was made: "all the vocabulary" goes on meaning all the vocabulary, and
 * "these three chapters" is not quietly widened to four. Being out is never
 * silent — the grid draws the row, with its boxes unticked, and the note
 * under it counts the chapters in each column.
 *
 * **Material that has gone** — a deck that failed to fetch, pensa before
 * sign-in — leaves its token naming nothing: it matches no skill, so it
 * filters nothing, and the grid draws no control where there is nothing to
 * drill. The token is **kept** in the stored selection rather than pruned, so
 * the tick comes back with the material. Nothing here ever turns a cell *on*,
 * so a library that shrinks can never widen the mix.
 */
/** One cell of the grid, as a token. Pure. */
export const mixCell = (kind, chapter) => `${kind}:${Math.round(Number(chapter))}`;
/**
 * A token read back: `{ kind, chapter }` for a cell, `{ kind, chapter: null }`
 * for a whole column, `null` for anything that is neither — a population this
 * app does not have, or a chapter that is not a number. Pure.
 */
export function mixToken(token) {
  const s = typeof token === 'string' ? token : '';
  const i = s.indexOf(':');
  const kind = i < 0 ? s : s.slice(0, i);
  if (!POPULATIONS.includes(kind)) return null;
  if (i < 0) return { kind, chapter: null };
  const n = Math.round(Number(s.slice(i + 1)));
  return Number.isFinite(n) && n >= 1 ? { kind, chapter: n } : null;
}

/**
 * **What this library can actually offer**, chapter by chapter and kind by
 * kind: the rows and columns the grid draws, and the only cells a selection
 * can name. A row appears for a chapter that holds something drillable and
 * for no other, and a cell carries the ids it stands for — so a cell that
 * could not produce a question is never offered in the first place.
 *
 * The material is `chapter.js`'s answer and not a second one: `chapterMaterial`
 * already says which skills and which sets are a chapter's, and the map's
 * by-chapter view is drawn from the same call.
 *
 *   { kinds, rows: [ { chapter, roman, title, cells, ids } ], loose }
 *
 * `kinds` are the populations with something in them, in POPULATIONS order —
 * the columns. `loose` is anything drillable that no chapter owns (a grammar
 * skill with no chapter of its own; no shipped skill is one). It has no cell,
 * so it can only ever ride in on a whole column, and it is named here rather
 * than lost without a word. Pure.
 */
export function mixGrid({ chapters = null, skills = new Map(), order = null, sets = new Map(), drillable = () => true } = {}) {
  const entries = new Map(spine(chapters).map((c) => [c.n, c]));
  // A chapter set may reach this either way round — as its own Map, or already merged into `skills` —
  // and `chapterMaterial` reads the two lists from different places, so the set map is completed here.
  const allSets = new Map([...[...skills].filter(([, s]) => s?.set), ...sets]);
  const claimed = new Set(entries.keys());
  for (const s of [...skills.values(), ...sets.values()]) {
    const n = Math.round(Number(s?.chapter));
    if (Number.isFinite(n) && n >= 1) claimed.add(n);
  }
  const rows = [];
  const placed = new Set();
  for (const n of [...claimed].sort((a, b) => a - b)) {
    const material = chapterMaterial(n, { skills, order, sets: allSets, entry: entries.get(n) ?? null });
    const cells = {};
    const ids = [];
    for (const k of POPULATIONS) {
      const here = material.members.filter((s) => populationOf(s) === k && drillable(s.id)).map((s) => s.id);
      if (!here.length) continue;
      cells[k] = here;
      ids.push(...here);
      for (const id of here) placed.add(id);
    }
    if (!ids.length) continue;
    const e = entries.get(n);
    rows.push({ chapter: n, roman: e?.roman ?? roman(n), title: e?.title ?? '', cells, ids });
  }
  const loose = {};
  for (const s of new Map([...skills, ...allSets]).values()) {
    if (!s || placed.has(s.id) || !drillable(s.id)) continue;
    (loose[populationOf(s)] ||= []).push(s.id);
  }
  return { kinds: POPULATIONS.filter((k) => rows.some((r) => r.cells[k]) || loose[k]?.length), rows, loose };
}

/** Every chapter the grid offers one kind in, ascending. Pure. */
const kindChapters = (grid, kind) => (grid?.rows ?? []).filter((r) => r.cells?.[kind]).map((r) => r.chapter);

/**
 * The learner's selection, cleaned. `null` in — never chosen — is `null` out:
 * everything, now and whatever arrives. Anything else comes back as a
 * canonical token list: no duplicates, cells dropped where their own column
 * is already in whole, columns in POPULATIONS order and cells by chapter
 * inside them. A token this app cannot read at all is dropped; a token naming
 * material the library does not hold **today** is kept. Given a grid, a
 * selection holding every column the library offers is everything, and comes
 * back as `null` — so a population that was missing when the choice was saved
 * (pensa before sign-in) is not shut out when it arrives. Pure.
 */
export function normaliseMix(value, grid = null) {
  if (value == null) return null;
  const list = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? Object.entries(value).filter(([, on]) => on).map(([k]) => k) : []);
  const kinds = new Set();
  const cells = new Map();
  for (const t of list) {
    const tok = mixToken(t);
    if (!tok) continue;
    if (tok.chapter == null) { kinds.add(tok.kind); continue; }
    if (!cells.has(tok.kind)) cells.set(tok.kind, new Set());
    cells.get(tok.kind).add(tok.chapter);
  }
  const offered = grid?.kinds ?? null;
  if (offered?.length && offered.every((k) => kinds.has(k))) return null;
  const out = [];
  for (const k of POPULATIONS) {
    if (kinds.has(k)) { out.push(k); continue; }
    for (const n of [...(cells.get(k) ?? [])].sort((a, b) => a - b)) out.push(mixCell(k, n));
  }
  return out;
}
/** Is one cell of the grid in the mix? Pure. */
export function mixIn(sel, kind, chapter) {
  if (sel == null) return true;
  if (!Array.isArray(sel)) return false;
  if (sel.includes(kind)) return true;
  const n = Math.round(Number(chapter));
  return Number.isFinite(n) && n >= 1 && sel.includes(mixCell(kind, n));
}
/** Is a whole column in — that kind, every chapter, including ones that arrive later? Pure. */
export const mixWhole = (sel, kind) => sel == null || (Array.isArray(sel) && sel.includes(kind));
/** Does the mix hold this skill (or chapter set)? A thing no chapter owns rides only on a whole column. Pure. */
export const mixHolds = (sel, skill) => mixIn(sel, populationOf(skill), skill?.chapter);
/** The skills of `skills` (Map id → skill) the selection lets through. Pure. */
export function filterMix(skills, sel) {
  if (sel == null) return new Map(skills);
  return new Map([...skills].filter(([, s]) => mixHolds(sel, s)));
}
/**
 * The selection after one control on the grid is pressed. `what` is the
 * control: `{ kind }` a column heading, `{ chapter }` a chapter name,
 * `{ kind, chapter }` one cell, and `'all'` / `'none'` the pair beside the
 * grid.
 *
 * A column heading is not a bulk tick over the rows on screen: it says "this
 * kind, whole", so pressing it writes the column token and pressing it again
 * empties the column. Taking one cell out of a column that was taken whole
 * **writes the column out first** — the other chapters stay in by name, and
 * the column stops speaking for chapters that have not arrived. Pure.
 */
export function mixToggle(sel, what, grid = null) {
  if (what === 'all') return null;
  if (what === 'none') return [];
  const kinds = new Set();
  const cells = new Set();
  if (sel == null) for (const k of (grid?.kinds ?? POPULATIONS)) kinds.add(k);
  else for (const t of Array.isArray(sel) ? sel : []) {
    const tok = mixToken(t);
    if (!tok) continue;
    if (tok.chapter == null) kinds.add(tok.kind); else cells.add(mixCell(tok.kind, tok.chapter));
  }
  const dropColumn = (k) => { kinds.delete(k); for (const c of [...cells]) if (mixToken(c)?.kind === k) cells.delete(c); };
  const setCell = (k, n, on) => {
    if (on) { if (!kinds.has(k)) cells.add(mixCell(k, n)); return; }
    if (kinds.delete(k)) for (const m of kindChapters(grid, k)) cells.add(mixCell(k, m));
    cells.delete(mixCell(k, n));
  };
  const kind = typeof what?.kind === 'string' ? what.kind : null;
  const chapter = what?.chapter == null ? null : Math.round(Number(what.chapter));
  if (kind && chapter != null) setCell(kind, chapter, !mixIn(sel, kind, chapter));
  else if (kind) { const whole = kinds.has(kind); dropColumn(kind); if (!whole) kinds.add(kind); }
  else if (chapter != null) {
    const here = (grid?.rows ?? []).find((r) => r.chapter === chapter)?.cells ?? {};
    const ks = POPULATIONS.filter((k) => here[k]);
    const allOn = ks.length > 0 && ks.every((k) => mixIn(sel, k, chapter));
    for (const k of ks) setCell(k, chapter, !allOn);
  }
  return normaliseMix([...kinds, ...cells], grid);
}
/**
 * What the grid's own labels count, and what the copy below it reads off: per
 * column the chapters in it (and whether the column was taken whole, which is
 * a different thing from every chapter of it being ticked), per row how many
 * of that chapter's kinds are in. Pure.
 */
export function mixCounts(sel, grid) {
  const kinds = {};
  for (const k of grid?.kinds ?? []) {
    const chaps = kindChapters(grid, k);
    kinds[k] = { whole: mixWhole(sel, k), on: chaps.filter((n) => mixIn(sel, k, n)).length, of: chaps.length };
  }
  const rows = new Map((grid?.rows ?? []).map((r) => {
    const ks = (grid?.kinds ?? []).filter((k) => r.cells?.[k]);
    return [r.chapter, { on: ks.filter((k) => mixIn(sel, k, r.chapter)).length, of: ks.length }];
  }));
  return { kinds, rows };
}
const andList = (parts) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
/**
 * What a mixed set really holds, said in one sentence — the line the Practice
 * setup shows under the grid and the session header repeats. A header that
 * says "Practice" over a set of nothing but vocabulary is a lie the learner
 * only finds out item by item, so the copy names the populations that are in,
 * how many chapters of each when it is not all of them, and, when any kind is
 * missing altogether, the ones that are out. Pure.
 */
export function mixNote(sel, grid) {
  const can = grid?.kinds ?? [];
  const c = mixCounts(sel, grid);
  const on = can.filter((k) => c.kinds[k].on);
  const off = can.filter((k) => !c.kinds[k].on);
  if (!can.length) return 'Nothing here can be drilled yet.';
  if (!on.length) return 'Nothing is in the mix. Tick a box, or press All.';
  if (!off.length && on.every((k) => c.kinds[k].on === c.kinds[k].of)) return `Everything: ${andList(can.map((k) => POPULATION_PHRASE[k]))}.`;
  const phrase = (k) => `${POPULATION_PHRASE[k]}${c.kinds[k].on < c.kinds[k].of ? ` (${c.kinds[k].on} of ${c.kinds[k].of} chapters)` : ''}`;
  return `Only ${andList(on.map(phrase))}${off.length ? ` — ${andList(off.map((k) => POPULATION_PHRASE[k]))} left out` : ''}.`;
}
/**
 * The same choice as a few words for a session's own title ("Vocabulary +
 * Pensa · 3 chapters"), or '' when the mix is everything there is and the
 * title needs no qualifier. Pure.
 */
export function mixTitle(sel, grid) {
  const can = grid?.kinds ?? [];
  const c = mixCounts(sel, grid);
  const on = can.filter((k) => c.kinds[k].on);
  if (!on.length) return '';
  const chapters = (grid?.rows ?? []).filter((r) => on.some((k) => r.cells?.[k] && mixIn(sel, k, r.chapter))).map((r) => r.chapter);
  const could = (grid?.rows ?? []).filter((r) => on.some((k) => r.cells?.[k])).length;
  const kindPart = on.length === can.length ? '' : on.map((k) => POPULATION_LABEL[k]).join(' + ');
  if (chapters.length >= could) return kindPart ? `${kindPart} only` : '';
  const where = chapters.length === 1 ? `Cap. ${roman(chapters[0])}` : `${chapters.length} chapters`;
  return kindPart ? `${kindPart} · ${where}` : where;
}

/* ------------------------------------------------------ answer matching */
/** The word tokens of a Latin string, macron-stripped and lower-cased. Pure. */
const wordsOf = (s) => tokenize(String(s ?? '')).filter((t) => t.isWord).map((t) => t.form);
/**
 * A typed answer to a question: right when it equals an accepted answer
 * (macrons and case ignored, punctuation dropped), or the answering sentence
 * itself, or a sentence that contains the answer whole and whose every word is
 * in the sentence (a full-sentence answer built from the passage). Pure.
 */
export function matchQuestion(typed, answers, sentence = '') {
  const t = normaliseAnswer(typed);
  if (!t) return false;
  const norm = (a) => normaliseAnswer(a);
  if ((answers || []).some((a) => norm(a) === t)) return true;
  const sent = norm(sentence);
  if (sent && sent === t) return true;
  const tw = t.split(' ');
  if (tw.length < 2 || !sent) return false;
  const sw = new Set(sent.split(' '));
  if (!tw.every((w) => sw.has(w))) return false;
  return (answers || []).some((a) => { const aw = norm(a).split(' ').filter(Boolean); if (!aw.length) return false; for (let i = 0; i + aw.length <= tw.length; i++) if (aw.every((w, j) => tw[i + j] === w)) return true; return false; });
}
/** The word indexes in `la` of `phrase` (whole words, macrons ignored); [] when absent. Pure. */
export function phraseIndexes(la, phrase) {
  const words = wordsOf(la);
  const want = wordsOf(phrase);
  if (!want.length) return [];
  for (let i = 0; i + want.length <= words.length; i++) if (want.every((w, j) => words[i + j] === w)) return want.map((_, j) => i + j);
  return [];
}
/**
 * The word indexes of a sentence's declared `focus`. A focus is usually one
 * word, but a construction can need two — an ablative absolute (*Cane
 * lātrante*), a periphrastic form (*itūrum esse*, *clausum est*), the two
 * verbs of a contrary-to-fact pair (*habērem* … *emerem*). A contiguous
 * phrase is matched as a phrase; when the two words are apart, each is
 * matched on its own, in order, to its first free index. [] when the focus is
 * not in the sentence. The head (first) index is the one a parse settles on.
 * Pure.
 */
export function focusIndexes(la, focus) {
  const want = wordsOf(focus || '');
  if (!want.length) return [];
  const run = phraseIndexes(la, focus);
  if (run.length || want.length === 1) return run;
  const words = wordsOf(la);
  const out = [];
  let from = 0;
  for (const w of want) {
    const at = words.indexOf(w, from);
    if (at < 0) return [];
    out.push(at); from = at + 1;
  }
  return out;
}
/**
 * The word indexes an accepted answer occupies in the sentence. `whole` (the
 * default) accepts only the indexes of answers that are **one word**: a tap is
 * a single word, so accepting any word of "in vīllā" would mark a tap on *in*
 * right (m5). Pass `whole: false` for lighting the answer in the feedback,
 * where the whole phrase should glow. A single-word answer that is only
 * inflected differently is not in the sentence: nothing to accept, and the
 * caller falls back to typing. Pure.
 */
export function answerIndexes(la, answers, { whole = true } = {}) {
  const out = new Set();
  for (const a of answers || []) {
    const idx = phraseIndexes(la, a);
    if (!idx.length) continue;
    if (whole && idx.length > 1) continue;
    for (const i of idx) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}
/** The blanks of a pensum text, in order: segments of prose and `{ blank: i }` for each run of underscores. Pure. */
export function pensumSegments(text) {
  const out = [];
  let last = 0, i = 0;
  for (const m of String(text ?? '').matchAll(/_+/g)) { if (m.index > last) out.push({ text: text.slice(last, m.index) }); out.push({ blank: i++ }); last = m.index + m[0].length; }
  if (last < String(text ?? '').length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * The pensum sentence with its blanks filled by the model answers. The stem is
 * already inside the prose segments — `blanks[].stem` is metadata, not a piece
 * of the sentence (C1). Pure.
 */
export function pensumFilled(segments, blanks) {
  return (segments || []).map((s) => (s.blank != null ? (blanks?.[s.blank]?.answers?.[0] ?? '') : s.text)).join('');
}

/* ------------------------------------------------------------ generator */
/**
 * Items for the chapter sets. `pool` is items.js's createPool (used keys per
 * skill / kind, so nothing repeats until the set is spent); `units` for the
 * sentences questions refer to.
 */
/**
 * "The chapter says: …" as parts: the lead-in is English, the sentence is
 * Latin and is marked as Latin, so the pointer opens the dictionary on its
 * words like any other Latin the section draws. `short` is derived from the
 * parts so the spoken line and the printed one cannot drift. Pure.
 */
const saysParts = (unit, answers) => {
  const parts = unit ? ['The chapter says: ', la(unit.la)] : ['The answer is ', la(answers[0]), '.'];
  return { short: partsText(parts), parts };
};

export function createSetItems({ sets, units = [], pool, rand = Math.random }) {
  const unitOf = (id) => units.find((u) => u.id === id) ?? null;
  const meaningsOf = (la) => tokenize(la).filter((t) => t.isWord).map((t) => ({ text: t.text, form: t.form, start: t.start }));
  const base = (skill, kind, stage) => ({ skill: skill.id, kind, stage, unit_id: null, week_n: skill.week_n ?? null, target: null, entry: null, parse: null, meanings: [], gold: null, confuse: { values: {}, indexes: {}, forms: {} }, set: skill.set, chapter: skill.chapter });

  /**
   * A question item with its sentence references resolved from the private
   * text: `{ unit, answers, choices }`, or null when a reference points at a
   * sentence the device does not have. A null hides the item — never a crash,
   * and never a right answer graded wrong against a half-resolved list.
   */
  const resolvedQ = new Map();
  function resolveQuestion(it) {
    if (resolvedQ.has(it)) return resolvedQ.get(it);
    const unit = it.unit_id ? unitOf(it.unit_id) : null;
    const la = unit?.la ?? '';
    const answers = resolveList(la, it.answers);
    const choices = resolveList(la, it.choices);
    const out = answers && answers.length && choices ? { unit, answers: withStripped(answers), choices } : null;
    if (!out) console.warn(`[grammar] question ${it.id}: its references do not resolve against ${it.unit_id ?? 'no sentence'}${unit ? '' : ' (not in the library)'} — the item is hidden`);
    resolvedQ.set(it, out);
    return out;
  }
  /** The items of a question set whose references resolve, memoised per skill. */
  const usableQ = new Map();
  const questionItems = (skill) => {
    if (!usableQ.has(skill.id)) usableQ.set(skill.id, (skill.data?.items ?? []).filter((it) => resolveQuestion(it) != null));
    return usableQ.get(skill.id);
  };

  function question(skill, stage, opts = {}) {
    const items = questionItems(skill);
    const keyOf = (it) => `question:${it.id}`;
    const keys = items.map(keyOf);
    if (!keys.length) return null;
    const got = pool.chooseInfo(skill.id, 'question', keys, rand, [], opts.itemKey ?? null);
    if (!got) return null;   // a redo whose question has left the set: dropped, never swapped for another one
    const it = items[keys.indexOf(got.key)];
    const { unit, answers, choices } = resolveQuestion(it);
    let input = it.input;
    let accept = null;
    if (input === 'tap') { accept = unit ? answerIndexes(unit.la, answers) : []; if (!accept.length) input = 'type'; }
    const item = { ...base(skill, 'question', stage), key: got.key, input, repeat: got.wrapped, unit_id: it.unit_id, question: it,
      prompt: { la: input === 'tap' && unit ? unit.la : null, question: it.q, en: it.en, gloss: null, hint: it.hint || `A ${it.qword ?? 'question'} question: the answer is in the chapter.`, placeholder: 'the answer in Latin (macrons optional)' },
      // The words of the question itself are glossable whatever the input (plan §3: meanings are never assumed).
      answer: answers, choices: null, meanings: input === 'tap' && unit ? meaningsOf(unit.la) : meaningsOf(it.q),
      feedback: { ...saysParts(unit, answers), term: skill.plain, label: null, table: null, lemma: null, sense: null, paradigm: null, sentence: unit?.la ?? null, sentenceEn: unit?.en || null, lit: unit ? answerIndexes(unit.la, answers, { whole: false }) : [] } };
    if (input === 'choice') {
      const correctSet = new Set(answers.map(normaliseAnswer));
      const opts = choices.map((c) => ({ value: c, label: c, correct: correctSet.has(normaliseAnswer(c)), skill: null }));
      if (!opts.some((o) => o.correct)) opts.unshift({ value: answers[0], label: answers[0], correct: true, skill: null });
      item.choices = shuffle(opts, rand).slice(0, 4);
      if (!item.choices.some((o) => o.correct)) item.choices[0] = opts.find((o) => o.correct);
    }
    if (input === 'tap') item.accept = accept;
    return item;
  }

  // Every vocabulary word in the section, by part of speech: a chapter rarely has four verbs of its own, and a
  // distractor of another part of speech lets the learner answer by shape instead of meaning (M9).
  let posIndex = null;
  const byPos = (pos) => {
    if (!posIndex) {
      posIndex = new Map();
      for (const sk of sets.values()) { if (sk.set !== 'vocab' || sk.rev) continue; for (const w of sk.data?.words ?? []) { const k = w.pos || 'X'; if (!posIndex.has(k)) posIndex.set(k, []); posIndex.get(k).push({ ...w, chapter: sk.chapter }); } }
    }
    return posIndex.get(pos || 'X') ?? [];
  };
  /**
   * Distractors for a vocabulary item: the same chapter and the same part of
   * speech first, then the same part of speech from the nearest chapters. Never
   * another part of speech — that would make the item answerable by shape.
   */
  const sameChapterDistractors = (deck, word, n, by = (w) => w.meaning) => {
    const differs = (w) => w.lemma !== word.lemma && normaliseAnswer(by(w)) !== normaliseAnswer(by(word)) && by(w);
    const chapter = Number(deck.chapter) || 0;
    const picked = shuffle(deck.words.filter((w) => w.pos === word.pos && differs(w)), rand).slice(0, n);
    if (picked.length < n) {
      const seen = new Set(picked.map((w) => `${w.lemma}|${w.pos}`));
      const near = byPos(word.pos)
        .filter((w) => differs(w) && !seen.has(`${w.lemma}|${w.pos}`))
        .sort((a, b) => Math.abs((a.chapter ?? 0) - chapter) - Math.abs((b.chapter ?? 0) - chapter));
      for (const w of near) { if (picked.length >= n) break; if (seen.has(`${w.lemma}|${w.pos}`)) continue; seen.add(`${w.lemma}|${w.pos}`); picked.push(w); }
    }
    return picked;
  };
  // A verb deck often carries its principal parts in `dict` already, and appending `parts` then printed the line
  // twice ("rīdeō, rīdēre, rīsī, rīsum · rīdeō, rīdēre, rīsī, rīsum") in the feedback and, now, in the word's hint.
  const dictLine = (w) => (w.parts && !String(w.dict ?? '').includes(w.parts) ? `${w.dict} · ${w.parts}` : w.dict);
  function vocab(skill, stage, opts = {}) {
    const deck = skill.data;
    if (!deck.words.length) return null;
    const rev = !!skill.rev;
    const suffix = rev ? ':rev' : '';
    // The key carries the part of speech: three shipped decks hold one lemma twice (liber N / ADJ), and without it the second is unreachable (M8).
    const keyOf = (w) => `vocab:${pad(skill.chapter)}:${w.lemma}:${w.pos || 'X'}${suffix}`;
    const keys = deck.words.map(keyOf);
    const got = pool.chooseInfo(skill.id, 'vocab', keys, rand, [], opts.itemKey ?? null);
    if (!got) return null;   // a redo whose word has left the deck
    const w = deck.words[keys.indexOf(got.key)];
    const posName = POS_LABEL[w.pos] ?? (w.pos || 'word');
    const common = { ...base(skill, 'vocab', stage), key: got.key, repeat: got.wrapped, word: w, unit_id: w.unit_id,
      feedback: { ...(() => { const parts = [la(w.lemma), ` — ${w.meaning}. `, la(dictLine(w))]; return { short: partsText(parts), parts }; })(), term: skill.plain, label: null, table: null, lemma: w.lemma, sense: w.meaning, paradigm: null, dict: dictLine(w) } };
    // Every other Latin → English item is a match: four words of the chapter against their meanings (opts.match forces either way).
    const useMatch = !rev && deck.words.length >= 4 && (opts.match ?? rand() < 0.5);
    if (useMatch) {
      const others = sameChapterDistractors(deck, w, 3);
      const pairs = shuffle([w, ...others], rand).map((x) => ({ la: x.lemma, en: x.meaning, dict: dictLine(x) }));
      const right = shuffle(pairs.map((p, i) => ({ text: p.en, pair: i })), rand);
      return { ...common, variant: 'match', input: 'match', pairs, right,
        prompt: { la: null, question: 'Match each word to its meaning', gloss: null, hint: `Four ${POS_LABEL[w.pos] ? `${posName}s` : 'words'} from chapter ${roman(skill.chapter)}.` },
        answer: pairs.map((p) => `${p.la} — ${p.en}`), choices: null };
    }
    if (!rev) {
      const others = sameChapterDistractors(deck, w, 3);
      const choices = shuffle([{ value: w.meaning, label: w.meaning, correct: true, skill: null }, ...others.map((o) => ({ value: o.meaning, label: o.meaning, correct: false, skill: null }))], rand);
      if (choices.length < 2) return null;
      return { ...common, input: 'choice', prompt: { la: null, ...q(['What does ', la(w.lemma), ' mean?']), gloss: null, hint: `A ${posName}${w.gender ? `, ${w.gender}.` : ''}${w.decl ? ` ${w.decl}${['st', 'nd', 'rd'][w.decl - 1] ?? 'th'} declension` : ''}.` }, answer: [w.meaning], choices };
    }
    const accepted = [...new Set([w.lemma, stripMacrons(w.lemma), w.dict.split(/[\s,]/)[0]].filter(Boolean))];
    const item = { ...common, input: stage >= 2 ? 'type' : 'choice', prompt: { la: null, question: `Which Latin word means “${w.meaning}”?`, gloss: null, hint: `A ${posName} beginning with ${w.lemma[0]}…`, placeholder: 'the Latin word (macrons optional)' }, answer: accepted, choices: null };
    if (item.input === 'choice') {
      const others = sameChapterDistractors(deck, w, 3, (x) => x.lemma);
      item.choices = shuffle([{ value: w.lemma, label: w.lemma, correct: true, skill: null }, ...others.map((o) => ({ value: o.lemma, label: o.lemma, correct: false, skill: null }))], rand);
      if (item.choices.length < 2) return null;
    }
    return item;
  }

  function pensum(skill, stage, opts = {}) {
    const p = skill.data;
    const entries = [...p.A.map((it) => ({ kind: 'A', it })), ...p.B.map((it) => ({ kind: 'B', it })), ...p.C.map((it) => ({ kind: 'C', it }))];
    if (!entries.length) return null;
    const keys = entries.map((e) => `pensum:${pad(skill.chapter)}:${e.kind}:${e.it.i}`);
    const got = pool.chooseInfo(skill.id, 'pensum', keys, rand, [], opts.itemKey ?? null);
    if (!got) return null;   // a redo whose pensum line has changed on the server
    const { kind, it } = entries[keys.indexOf(got.key)];
    const common = { ...base(skill, 'pensum', stage), key: got.key, repeat: got.wrapped, pensum: kind, feedback: { short: '', term: skill.plain, label: null, table: null, lemma: null, sense: null, paradigm: null } };
    if (kind === 'C') {
      const unit = it.unit_id ? unitOf(it.unit_id) : null;
      const answers = [...new Set(it.answers.flatMap((a) => [a, stripMacrons(a)]))];
      const accept = unit ? answerIndexes(unit.la, it.answers) : [];
      const input = unit && accept.length && rand() < 0.5 ? 'tap' : 'type';
      return { ...common, input, unit_id: it.unit_id ?? null, question: { q: it.q, answers, en: it.en ?? '' }, accept: input === 'tap' ? accept : null,
        prompt: { la: input === 'tap' ? unit.la : null, question: it.q, en: it.en ?? '', gloss: null, hint: 'Pensum C: answer from the chapter.', placeholder: 'the answer in Latin (macrons optional)' },
        answer: answers, choices: null, meanings: input === 'tap' ? meaningsOf(unit.la) : [],
        feedback: { ...common.feedback, ...saysParts(unit, it.answers), sentence: unit?.la ?? null, sentenceEn: unit?.en || null, lit: unit ? answerIndexes(unit.la, it.answers, { whole: false }) : [] } };
    }
    const segments = pensumSegments(it.text);
    // `text` owns the stem ("Rōma in Itali_ est."); `stem` is metadata for the label and for accepting the whole
    // word typed out (C1). It is never printed or joined again — that produced "ItaliItaliā".
    // Answers keep their macrons: a pensum blank is macron-sensitive (M3), because the macron *is* the ending.
    const blanks = it.blanks.map((b, i) => ({ i: Number.isFinite(Number(b.i)) ? Number(b.i) : i, stem: b.stem ?? '', answers: [...new Set((b.answers || []).filter((a) => typeof a === 'string' && a.length))], note: b.note ?? '', bank: (Array.isArray(b.bank) ? b.bank : []).filter((w) => typeof w === 'string' && w.length) })).sort((a, b) => a.i - b.i);
    if (blanks.some((b) => !b.answers.length)) return null;
    const filled = pensumFilled(segments, blanks);
    if (kind === 'A') {
      return { ...common, exact: true, input: 'inline', segments, blanks, prompt: { la: null, question: 'Pensum A: type the endings', gloss: null, hint: blanks.map((b) => b.note).filter(Boolean).join(' · ') || 'Each blank wants an ending; the stem is given. Macrons count here — the length of the vowel is part of the ending.' },
        answer: blanks.map((b) => b.answers[0]), choices: null, feedback: { ...common.feedback, short: filled, parts: [la(filled)], sentence: filled } };
    }
    // The bank is a multiset: a sentence that wants the same word twice offers two tiles (M3 / CR M3), plus the
    // distractors the book prints. Tiles are identified by position, never by their text.
    const need = new Map();
    for (const b of blanks) need.set(b.answers[0], (need.get(b.answers[0]) ?? 0) + 1);
    const tiles = [];
    for (const [w, n] of need) for (let k = 0; k < n; k++) tiles.push(w);
    for (const w of new Set(blanks.flatMap((b) => b.bank))) if (!need.has(w)) tiles.push(w);
    const bank = shuffle(tiles, rand);
    return { ...common, exact: true, input: 'bank', segments, blanks, bank, prompt: { la: null, question: 'Pensum B: fill each blank from the words below', gloss: null, hint: 'Tap a word for the next empty blank; tap a filled blank to empty it. Two words that differ only in a macron are two different forms.' },
      answer: blanks.map((b) => b.answers[0]), choices: null, feedback: { ...common.feedback, short: filled, parts: [la(filled)], sentence: filled } };
  }

  const FNS = { question, vocab, pensum };
  function generate({ skill: skillId, kind, stage = 1, match = undefined, itemKey = null } = {}) {
    const skill = typeof skillId === 'string' ? sets.get(skillId) : skillId;
    if (!skill?.set) return null;
    const fn = FNS[kind] ?? FNS[skill.kinds[0]];
    // `itemKey`: one exact item back for a redo ("Redo what was wrong"). A vocabulary word is drilled as a
    // multiple choice or as a four-way match, and the key does not say which; `match` is left as the caller
    // set it, so a redo of a vocabulary item is the same word, in whichever of its two shapes comes up.
    return fn ? fn(skill, stage, { match, itemKey }) : null;
  }
  // A question set whose sentences the device does not have yet has no items to give, whatever its `count` says.
  const drillable = (id) => { const sk = sets.get(id); if (!sk) return false; return sk.set === 'questions' && sk.data ? questionItems(sk).length > 0 : (sk.count ?? 0) > 0; };
  return { generate, drillable, sets };
}
