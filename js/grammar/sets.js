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
//
// Item kinds: `question` (input type | choice | tap from the item; the
// answering sentence shown after with the answer lit), `vocab` (Latin →
// English choice; every other item a 4-pair `match`; the reverse deck typed
// from stage 2), `pensum` (A: endings typed inline; B: word blanks from a
// tappable bank; C: a question, typed or tap). `unverified` pensum items are hidden.

import { tokenize, stripMacrons } from '../tokenize.js';
import { roman } from '../sync.js';
import { normaliseAnswer } from './items.js';

export const SET_KINDS = Object.freeze(['question', 'vocab', 'pensum']);
const pad = (n) => String(n).padStart(2, '0');
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
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
/** The Familia Romana chapter a library week reads: the shelf's n − 100, a course week's `chapter` field. Pure. */
export function chapterOfWeek(week) {
  if (!week) return null;
  const n = Number(week.n);
  if (n > 100) return n - 100;
  return fromRoman(week.chapter);
}

/* -------------------------------------------------------------- loader */
/** A loader over `fetchJson(name)` (relative to data/grammar/): the two manifests once, each chapter file once; a missing file is null. */
export function createSetLoader({ fetchJson }) {
  const cache = new Map();
  const once = (name, fn) => { if (!cache.has(name)) cache.set(name, fn().catch(() => null)); return cache.get(name); };
  const manifest = (dir) => once(`${dir}/index.json`, async () => { const raw = await fetchJson(`${dir}/index.json`); return manifestChapters(raw); });
  const chapter = (dir, c) => once(`${dir}/${pad(c)}.json`, () => fetchJson(`${dir}/${pad(c)}.json`));
  /** { questions: Map chapter → set, vocab: Map chapter → deck } — every listed chapter loaded. */
  async function loadAll() {
    const out = { questions: new Map(), vocab: new Map() };
    for (const dir of ['questions', 'vocab']) {
      const chapters = (await manifest(dir)) ?? [];
      const docs = await Promise.all(chapters.map((c) => chapter(dir, c)));
      docs.forEach((d, i) => { const norm = dir === 'questions' ? normaliseQuestionSet(d) : normaliseVocab(d); if (norm) out[dir].set(norm.chapter ?? chapters[i], norm); });
    }
    return out;
  }
  return { loadAll };
}
/** `{ "chapters": [1, 7] }` (or a list) → [1, 7]; anything else → null. Pure. */
export function manifestChapters(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.chapters) ? raw.chapters : null;
  if (!list) return null;
  return [...new Set(list.map((x) => (typeof x === 'string' ? Number(x.replace(/\.json$/i, '')) : Number(x))).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
}
/** Pure: a question set with every item usable (answers with macron-stripped variants, input defaulted). */
export function normaliseQuestionSet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const chapter = Number(raw.chapter) || null;
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((it) => it && typeof it.q === 'string' && Array.isArray(it.answers) && it.answers.length).map((it, i) => {
    const answers = [...new Set(it.answers.filter((a) => typeof a === 'string' && a.trim()).flatMap((a) => [a.trim(), stripMacrons(a.trim())]))];
    const input = ['type', 'choice', 'tap'].includes(it.input) ? it.input : 'type';
    const choices = Array.isArray(it.choices) ? it.choices.filter((c) => typeof c === 'string' && c.trim()) : [];
    return { id: String(it.id ?? `q${pad(chapter ?? 0)}-${pad(i + 1)}`), qword: it.qword ?? null, q: it.q, en: typeof it.en === 'string' ? it.en : '', unit_id: typeof it.unit_id === 'string' ? it.unit_id : null, answers, input: input === 'choice' && choices.length < 2 ? 'type' : input, choices, hint: typeof it.hint === 'string' ? it.hint : '' };
  });
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
    const items = (Array.isArray(r.items) ? r.items : []).map((it, i) => ({ ...it, i })).filter((it) => it && !it.unverified && (kind === 'C' ? typeof it.q === 'string' && Array.isArray(it.answers) : typeof it.text === 'string' && Array.isArray(it.blanks) && it.blanks.length));
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
/** The word indexes any of the answers occupies in the sentence (a tap item's accepted taps). Pure. */
export function answerIndexes(la, answers) {
  const out = new Set();
  for (const a of answers || []) for (const i of phraseIndexes(la, a)) out.add(i);
  // A single-word answer that is only inflected differently is not in the sentence: nothing to accept, the caller falls back to typing.
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

/* ------------------------------------------------------------ generator */
/**
 * Items for the chapter sets. `pool` is items.js's createPool (used keys per
 * skill / kind, so nothing repeats until the set is spent); `units` for the
 * sentences questions refer to.
 */
export function createSetItems({ sets, units = [], pool, rand = Math.random }) {
  const unitOf = (id) => units.find((u) => u.id === id) ?? null;
  const meaningsOf = (la) => tokenize(la).filter((t) => t.isWord).map((t) => ({ text: t.text, form: t.form, start: t.start }));
  const base = (skill, kind, stage) => ({ skill: skill.id, kind, stage, unit_id: null, week_n: skill.week_n ?? null, target: null, entry: null, parse: null, meanings: [], gold: null, confuse: { values: {}, indexes: {}, forms: {} }, set: skill.set, chapter: skill.chapter });

  function question(skill, stage) {
    const set = skill.data;
    const keyOf = (it) => `question:${it.id}`;
    const keys = set.items.map(keyOf);
    if (!keys.length) return null;
    const got = pool.chooseInfo(skill.id, 'question', keys, rand);
    const it = set.items[keys.indexOf(got.key)];
    const unit = it.unit_id ? unitOf(it.unit_id) : null;
    let input = it.input;
    let accept = null;
    if (input === 'tap') { accept = unit ? answerIndexes(unit.la, it.answers) : []; if (!accept.length) input = 'type'; }
    const item = { ...base(skill, 'question', stage), key: got.key, input, repeat: got.wrapped, unit_id: it.unit_id, question: it,
      prompt: { la: input === 'tap' && unit ? unit.la : null, question: it.q, en: it.en, gloss: null, hint: it.hint || `A ${it.qword ?? 'question'} question: the answer is in the chapter.`, placeholder: 'the answer in Latin (macrons optional)' },
      answer: it.answers, choices: null, meanings: input === 'tap' && unit ? meaningsOf(unit.la) : [],
      feedback: { short: unit ? `The chapter says: ${unit.la}` : `The answer is ${it.answers[0]}.`, term: skill.plain, label: null, table: null, lemma: null, sense: null, paradigm: null, sentence: unit?.la ?? null, sentenceEn: unit?.en || null, lit: unit ? answerIndexes(unit.la, it.answers) : [] } };
    if (input === 'choice') {
      const correctSet = new Set(it.answers.map(normaliseAnswer));
      const opts = it.choices.map((c) => ({ value: c, label: c, correct: correctSet.has(normaliseAnswer(c)), skill: null }));
      if (!opts.some((o) => o.correct)) opts.unshift({ value: it.answers[0], label: it.answers[0], correct: true, skill: null });
      item.choices = shuffle(opts, rand).slice(0, 4);
      if (!item.choices.some((o) => o.correct)) item.choices[0] = opts.find((o) => o.correct);
    }
    if (input === 'tap') item.accept = accept;
    return item;
  }

  const sameChapterDistractors = (deck, word, n, by = (w) => w.meaning) => {
    const others = deck.words.filter((w) => w.lemma !== word.lemma && normaliseAnswer(by(w)) !== normaliseAnswer(by(word)));
    const samePos = others.filter((w) => w.pos === word.pos);
    const picked = shuffle(samePos, rand).slice(0, n);
    if (picked.length < n) picked.push(...shuffle(others.filter((w) => !picked.includes(w)), rand).slice(0, n - picked.length));
    return picked;
  };
  const dictLine = (w) => (w.parts ? `${w.dict} · ${w.parts}` : w.dict);
  function vocab(skill, stage, opts = {}) {
    const deck = skill.data;
    if (!deck.words.length) return null;
    const rev = !!skill.rev;
    const suffix = rev ? ':rev' : '';
    const keyOf = (w) => `vocab:${pad(skill.chapter)}:${w.lemma}${suffix}`;
    const keys = deck.words.map(keyOf);
    const got = pool.chooseInfo(skill.id, 'vocab', keys, rand);
    const w = deck.words[keys.indexOf(got.key)];
    const posName = POS_LABEL[w.pos] ?? (w.pos || 'word');
    const common = { ...base(skill, 'vocab', stage), key: got.key, repeat: got.wrapped, word: w, unit_id: w.unit_id,
      feedback: { short: `${w.lemma} — ${w.meaning}. ${dictLine(w)}`, term: skill.plain, label: null, table: null, lemma: w.lemma, sense: w.meaning, paradigm: null, dict: dictLine(w) } };
    // Every other Latin → English item is a match: four words of the chapter against their meanings (opts.match forces either way).
    const useMatch = !rev && deck.words.length >= 4 && (opts.match ?? rand() < 0.5);
    if (useMatch) {
      const others = sameChapterDistractors(deck, w, 3);
      const pairs = shuffle([w, ...others], rand).map((x) => ({ la: x.lemma, en: x.meaning, dict: dictLine(x) }));
      const right = shuffle(pairs.map((p, i) => ({ text: p.en, pair: i })), rand);
      return { ...common, key: got.key.replace(/^vocab:/, 'vocab-match:'), input: 'match', pairs, right,
        prompt: { la: null, question: 'Match each word to its meaning', gloss: null, hint: `Four ${POS_LABEL[w.pos] ? `${posName}s` : 'words'} from chapter ${roman(skill.chapter)}.` },
        answer: pairs.map((p) => `${p.la} — ${p.en}`), choices: null };
    }
    if (!rev) {
      const others = sameChapterDistractors(deck, w, 3);
      const choices = shuffle([{ value: w.meaning, label: w.meaning, correct: true, skill: null }, ...others.map((o) => ({ value: o.meaning, label: o.meaning, correct: false, skill: null }))], rand);
      if (choices.length < 2) return null;
      return { ...common, input: 'choice', prompt: { la: null, question: `What does ${w.lemma} mean?`, gloss: null, hint: `A ${posName}${w.gender ? `, ${w.gender}.` : ''}${w.decl ? ` ${w.decl}${['st', 'nd', 'rd'][w.decl - 1] ?? 'th'} declension` : ''}.` }, answer: [w.meaning], choices };
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

  function pensum(skill, stage) {
    const p = skill.data;
    const entries = [...p.A.map((it) => ({ kind: 'A', it })), ...p.B.map((it) => ({ kind: 'B', it })), ...p.C.map((it) => ({ kind: 'C', it }))];
    if (!entries.length) return null;
    const keys = entries.map((e) => `pensum:${pad(skill.chapter)}:${e.kind}:${e.it.i}`);
    const got = pool.chooseInfo(skill.id, 'pensum', keys, rand);
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
        feedback: { ...common.feedback, short: unit ? `The chapter says: ${unit.la}` : `The answer is ${it.answers[0]}.`, sentence: unit?.la ?? null, sentenceEn: unit?.en || null, lit: unit ? accept : [] } };
    }
    const segments = pensumSegments(it.text);
    const blanks = it.blanks.map((b, i) => ({ i: Number.isFinite(Number(b.i)) ? Number(b.i) : i, stem: b.stem ?? '', answers: [...new Set((b.answers || []).flatMap((a) => [a, stripMacrons(a)]))], note: b.note ?? '', bank: Array.isArray(b.bank) ? b.bank : [] })).sort((a, b) => a.i - b.i);
    const filled = segments.map((s) => (s.blank != null ? (blanks[s.blank]?.stem ?? '') + (blanks[s.blank]?.answers[0] ?? '') : s.text)).join('');
    if (kind === 'A') {
      return { ...common, input: 'inline', segments, blanks, prompt: { la: null, question: 'Pensum A: type the endings', gloss: null, hint: blanks.map((b) => b.note).filter(Boolean).join(' · ') || 'Each blank wants an ending; the stem is given.' },
        answer: blanks.map((b) => b.answers[0]), choices: null, feedback: { ...common.feedback, short: `${filled}`, sentence: filled } };
    }
    const bank = shuffle([...new Set([...blanks.flatMap((b) => b.bank), ...blanks.map((b) => b.answers[0])])], rand);
    return { ...common, input: 'bank', segments, blanks, bank, prompt: { la: null, question: 'Pensum B: fill each blank from the words below', gloss: null, hint: 'Tap a word for the next empty blank; tap a filled blank to empty it.' },
      answer: blanks.map((b) => b.answers[0]), choices: null, feedback: { ...common.feedback, short: `${filled}`, sentence: filled } };
  }

  const FNS = { question, vocab, pensum };
  function generate({ skill: skillId, kind, stage = 1, match = undefined } = {}) {
    const skill = typeof skillId === 'string' ? sets.get(skillId) : skillId;
    if (!skill?.set) return null;
    const fn = FNS[kind] ?? FNS[skill.kinds[0]];
    return fn ? fn(skill, stage, { match }) : null;
  }
  const drillable = (id) => (sets.get(id)?.count ?? 0) > 0;
  return { generate, drillable, sets };
}
