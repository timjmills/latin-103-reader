// Stage-3 kinds (GRAMMAR-CONTRACT.md "Generated kinds"): production in
// context, built from the same candidates as the wave-1 kinds. They enter a
// skill's rotation once it reaches stage 3 (scheduler.js STAGE3_KINDS).
//
//   transform  one word of a book sentence changed by paradigms.js — number
//              (sg ↔ pl), tense (pres ↔ impf, pres → perf), voice (act ↔
//              pass), or the statement after "imperat ut" (pres ind → pres
//              subj); the learner types the changed form; only a change the
//              table produces as exactly one cell (one form) is offered.
//   reorder    a book sentence of ≤ 8 words scrambled; punctuation stays on
//              its word; the book's order is the answer (input `order`).
//   translate  a course-week sentence (units with `en`) with the English
//              hidden; the learner writes, reveals, and grades right / partly
//              / wrong (input `self`, logged self: true, weighted as hinted).
//
//   createStage3({ items, paradigm, rand }).generate({ skill, kind, stage, currentWeek, currentWeekN }) → item | null

import { stripMacrons } from '../tokenize.js';
import { cellsFor, lemmaGloss, featureLabel, CASE_LABEL, TENSE_LABEL, MOOD_LABEL, patternSpans, compilePatterns, strippedText } from './items.js';
import { isShelfWeek } from '../sync.js';

export const STAGE3_KINDS = Object.freeze(['transform', 'reorder', 'translate']);
export const REORDER_MAX_WORDS = 8;
/**
 * The 103 weeks whose units are verse (weeks 13 and 14: the elegiac couplet,
 * the hendecasyllable, the scansion lesson). A verse line's word order is
 * metrical, not grammatical, so no learner can reason to it from a case ending
 * — `reorder` never draws from them (QA M11; GRAMMAR-PLAN §9 puts poetry last).
 */
export const VERSE_WEEKS = Object.freeze([13, 14]);
export const isVerseWeek = (n) => VERSE_WEEKS.includes(Number(n));
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const NUMBER_NAME = { sg: 'singular', pl: 'plural' };
const cellForms = (c) => [...String(c.text ?? '').split(' / '), ...(c.alt ? [c.alt] : [])].map((s) => s.replace(/\s+-a -um$/, '').replace(/\s+esse$/, '').replace(/\s+īrī$/, '').trim()).filter(Boolean);

/** The sentence as whitespace chunks (punctuation kept with its word). Pure. */
export function chunksOf(la) {
  return String(la ?? '').trim().split(/\s+/).filter(Boolean);
}
/** True when the chunk order given (indexes into `chunks`) reads the original sentence — chunks of the same text are interchangeable. Pure. */
export function orderMatches(chunks, order) {
  if (!Array.isArray(order) || order.length !== chunks.length) return false;
  return order.every((idx, i) => chunks[idx] != null && chunks[idx] === chunks[i]);
}
/** A scrambled order that differs from the original (null when the sentence cannot be scrambled — one distinct chunk). Pure given `rand`. */
export function scramble(chunks, rand = Math.random) {
  const idx = chunks.map((_, i) => i);
  if (new Set(chunks).size < 2) return null;
  for (let tries = 0; tries < 20; tries++) { const s = shuffle(idx, rand); if (!orderMatches(chunks, s)) return s; }
  return null;
}

/**
 * The transformations a candidate offers: [{ op, label, parse }] where
 * `parse` is the target parse of the changed form and `label` the
 * instruction. Pure.
 */
export function transformOps(c) {
  const p = c?.parse;
  const e = c?.entry;
  if (!p || !e) return [];
  const out = [];
  const dep = e.kind === 'dep' || e.kind === 'semidep';
  const nominal = p.case && (!p.mood || p.mood === 'ptc' || p.mood === 'gerundive');
  if (nominal && p.number) {
    const to = p.number === 'sg' ? 'pl' : 'sg';
    // A personal pronoun has no gender, so "(same case and gender)" is noise there, and ego → nōs comes from a
    // suppletive table rather than from anything about the case the skill teaches (m3).
    const personal = e.pos === 'PRON' && ['ego', 'tū', 'nōs', 'vōs'].includes(String(e.lemma ?? '').toLowerCase());
    if (!personal) out.push({ op: `num-${to}`, label: `Make ${c.token.text} ${NUMBER_NAME[to]} (same case${p.gender ? ' and gender' : ''})`, parse: { ...p, number: to }, what: `${NUMBER_NAME[to]}` });
  }
  const finite = p.tense && (p.mood === 'ind' || p.mood === 'subj') && p.person != null && p.number;
  if (finite) {
    const to = p.number === 'sg' ? 'pl' : 'sg';
    out.push({ op: `num-${to}`, label: `Make ${c.token.text} ${NUMBER_NAME[to]} (same person, tense and mood)`, parse: { ...p, number: to }, what: NUMBER_NAME[to] });
    const tenses = p.mood === 'ind' ? (p.tense === 'pres' ? ['impf', 'perf'] : p.tense === 'impf' ? ['pres'] : p.tense === 'perf' ? ['pres'] : []) : (p.tense === 'pres' ? ['impf'] : p.tense === 'impf' ? ['pres'] : []);
    for (const t of tenses) out.push({ op: `tense-${t}`, label: `Put ${c.token.text} into the ${TENSE_LABEL[t]} ${MOOD_LABEL[p.mood]} (same person and number)`, parse: { ...p, tense: t }, what: `${TENSE_LABEL[t]} ${MOOD_LABEL[p.mood]}` });
    if (!dep && p.voice && String(p.person) === '3') {
      const to = p.voice === 'act' ? 'pass' : 'act';
      out.push({ op: `voice-${to}`, label: `Make ${c.token.text} ${to === 'pass' ? 'passive' : 'active'} (same person, number, tense and mood)`, parse: { ...p, voice: to }, what: to === 'pass' ? 'passive' : 'active' });
    }
    if (p.mood === 'ind' && p.tense === 'pres' && String(p.person) === '3') {
      out.push({ op: 'ind-command', label: `Put the sentence after “Iūlius imperat ut …”: what does ${c.token.text} become?`, parse: { ...p, mood: 'subj' }, what: 'present subjunctive (an indirect command)' });
    }
  }
  return out;
}

export function createStage3({ items, paradigm = null, rand = Math.random }) {
  const pool = items.pool;
  const tableMemo = new Map();
  const table = (entry) => { const k = entry?.lemma ?? ''; if (!tableMemo.has(k)) { let t = null; try { t = paradigm ? paradigm(entry, []) : null; } catch { t = null; } tableMemo.set(k, t); } return tableMemo.get(k); };
  const patMemo = new Map();
  const patternsOf = (skill) => { if (!patMemo.has(skill.id)) patMemo.set(skill.id, compilePatterns(skill.patterns)); return patMemo.get(skill.id); };
  const meaningsOf = (la) => items.meaningsOf ? items.meaningsOf(la) : [];
  const base = (skill, kind, stage, c) => ({
    skill: skill.id, kind, stage, unit_id: c.unit.id, week_n: c.unit.week_n ?? null,
    target: { text: c.token.text, form: c.token.form, start: c.token.start, end: c.token.end, index: c.index }, entry: c.entry, parse: c.parse,
    meanings: meaningsOf(c.unit.la), gold: c.gold ?? null, confuse: { values: {}, indexes: {}, forms: {} },
  });
  // The draw tiers (gold first, then the current week). `list` may be richer
  // than a candidate — a transform spot is a candidate *and* an op, and each op
  // is its own key — so `candOf` reads the candidate back out of an entry.
  const tiersFor = (list, keyOf, { currentWeek, currentWeekN }, candOf = (x) => x) => {
    const tiers = [new Set(list.filter((x) => candOf(x).gold).map(keyOf))];
    if (currentWeek && currentWeekN != null && !isShelfWeek(currentWeekN)) tiers.push(new Set(list.filter((x) => candOf(x).unit.week_n === currentWeekN).map(keyOf)));
    return tiers.filter((t) => t.size);
  };
  /**
   * The feature a transform op changes — what the learner has to move. A
   * candidate whose book form reads as two values of *that* feature makes the
   * instruction unanswerable ("make oblīta singular" when oblīta is already
   * the nominative singular feminine as well as the neuter plural), so those
   * are skipped: the ambiguity that matters here is the op's, not the skill's.
   */
  const OP_FEATURE = { num: 'number', tense: 'tense', voice: 'voice', ind: 'mood' };
  const opFeature = (op) => OP_FEATURE[String(op).split('-')[0]] ?? null;
  const norm = (f) => stripMacrons(String(f)).toLowerCase();
  /** Every cell of the table whose form is `text` (macrons ignored). */
  const cellsWithForm = (t, text) => {
    const want = norm(text);
    const out = [];
    for (const sec of t?.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
      if (!c || c.empty || !c.key) continue;
      if (cellForms(c).some((f) => norm(f) === want)) out.push(c);
    }
    return out;
  };
  /** True when the book's form reads as more than one value of the feature this op moves. */
  const opAmbiguous = (entry, op, text) => {
    const feat = opFeature(op.op);
    if (!feat) return false;
    const t = table(entry);
    if (!t) return true;
    const vals = new Set();
    for (const c of cellsWithForm(t, text)) {
      const k = c.key;
      const v = feat === 'mood' ? (k.mood ?? k.kind) : k[feat];
      if (v == null) continue;
      // A nominal cell carries a gender too, and the op keeps it: two genders are as unanswerable as two numbers.
      vals.add(feat === 'number' && k.kind === 'nominal' ? `${v}/${k.gender ?? ''}` : String(v));
    }
    return vals.size > 1;
  };
  /** The one form the table gives for a parse, or null when the cell is missing, several, or itself ambiguous. */
  const formFor = (entry, parse) => {
    const t = table(entry);
    if (!t) return null;
    const cells = cellsFor(t, parse).filter((c) => c && !c.empty && c.text && c.text !== '—');
    if (cells.length !== 1) return null;
    const forms = cellForms(cells[0]);
    return forms.length ? { cell: cells[0], forms, table: t } : null;
  };

  function transform(skill, stage, opts) {
    const cands = items.candidates(skill.id).filter((c) => !c.ambiguous && c.verified && c.unit.la.length <= 180);
    const spots = [];
    for (const c of cands) {
      const own = formFor(c.entry, c.parse);
      if (!own || !own.forms.some((f) => f.toLowerCase() === c.token.text.toLowerCase())) continue;   // the book's form must be the table's own cell, exactly
      for (const op of transformOps(c)) {
        if (opAmbiguous(c.entry, op, c.token.text)) continue;
        const got = formFor(c.entry, op.parse);
        if (!got || got.forms.some((f) => stripMacrons(f).toLowerCase() === c.token.form)) continue;   // a change that reads the same is no exercise
        spots.push({ c, op, got });
      }
    }
    if (!spots.length) return null;
    const keyOf = (s) => `transform:${s.c.unit.id}:${s.c.token.form}:${s.c.index}:${s.op.op}`;
    const keys = spots.map(keyOf);
    const got = pool.chooseInfo(skill.id, 'transform', keys, rand, tiersFor(spots, keyOf, opts, (s) => s.c));
    if (!got) return null;
    const { c, op, got: cell } = spots[keys.indexOf(got.key)];
    // The tables hold lower-case stems; a proper noun keeps the book's capital so the feedback reads "Germānī", not
    // "germānī". The test is the *lemma's* capital: the book capitalises every sentence's first word, so testing the
    // token would turn "Puella cantat" into "Puellae is the plural of puella" (m2).
    const capped = /^[A-ZĀĒĪŌŪ]/.test(String(c.entry?.lemma ?? '')) ? cell.forms.map((f) => f.charAt(0).toUpperCase() + f.slice(1)) : cell.forms;
    const answers = [...new Set(capped.flatMap((f) => [f, stripMacrons(f)]))];
    const lab = c.parse.case ? featureLabel('case', c.parse.case) : featureLabel('tense', `${c.parse.tense} ${c.parse.mood}`);
    return { ...base(skill, 'transform', stage, c), key: got.key, input: 'type', repeat: got.wrapped, op: op.op,
      prompt: { la: c.unit.la, question: op.label, gloss: lemmaGloss(c.entry), hint: `${c.token.text} is ${lab.name} — ${lab.plain}; the ${op.what} sits in the table below.`, placeholder: 'the changed form (macrons optional)' },
      answer: answers, choices: null,
      feedback: { short: `${capped[0]} is the ${op.what} of ${c.entry.lemma}; the book has ${c.token.text}.`, term: skill.plain, label: lab, table: (() => { try { return paradigm ? paradigm(c.entry, [op.parse]) : null; } catch { return null; } })(), lemma: c.entry.lemma, sense: null, paradigm: null, sentence: c.unit.la, sentenceEn: c.unit.en || null } };
  }

  function reorder(skill, stage, opts) {
    const seen = new Set();
    // The hint states a parse ("bonum is nominative"), so the candidate must be one the sentence settles — the same
    // `!ambiguous && verified` filter `transform` uses (QA M1). Verse units are excluded (QA M11).
    const cands = items.candidates(skill.id).filter((c) => {
      if (c.ambiguous || !c.verified || isVerseWeek(c.unit.week_n)) return false;
      if (seen.has(c.unit.id)) return false;
      seen.add(c.unit.id);
      const ch = chunksOf(c.unit.la);
      return ch.length >= 3 && ch.length <= REORDER_MAX_WORDS && new Set(ch).size >= 2;
    });
    if (!cands.length) return null;
    const keyOf = (c) => `reorder:${c.unit.id}`;
    const keys = cands.map(keyOf);
    // Scramble is settled before the pool key is spent, so a sentence is never burned unasked (m7).
    const got = pool.chooseInfo(skill.id, 'reorder', keys, rand, tiersFor(cands, keyOf, opts));
    if (!got) return null;
    const c = cands[keys.indexOf(got.key)];
    const chunks = chunksOf(c.unit.la);
    const order = scramble(chunks, rand);
    if (!order) return null;
    // The last chip does not carry the sentence's full stop, which would say "put me last" (m1). The capital on the
    // first word is left alone: without a proper-noun test here, lower-casing *Rōma* would be the worse error.
    const display = chunks.map((w, i) => (i === chunks.length - 1 ? w.replace(/[.!?]+$/, '') : w));
    const lab = c.value ? featureLabel(skill.feature ?? 'case', c.value, { skills: items.skills, skill }) : { name: skill.title, plain: skill.plain };
    return { ...base(skill, 'reorder', stage, c), key: got.key, input: 'order', repeat: got.wrapped, chunks, display, scrambled: order,
      prompt: { la: null, question: 'Put the words back in the book\'s order', gloss: lemmaGloss(c.entry), hint: `${c.token.text} is ${lab.name} — ${lab.plain}. ${skill.summary ?? ''}`.trim() },
      answer: [c.unit.la], choices: null,
      feedback: { short: `The book has: ${c.unit.la}`, term: skill.plain, label: lab, table: null, lemma: c.entry.lemma, sense: null, paradigm: null, sentence: c.unit.la, sentenceEn: c.unit.en || null } };
  }

  function translate(skill, stage, opts) {
    const seen = new Set();
    const all = items.candidates(skill.id);
    // Same filter as `transform` (QA M1): the feedback names a parse, so it must be one the sentence settles.
    const cands = all.filter((c) => {
      if (c.ambiguous || !c.verified) return false;
      if (seen.has(c.unit.id) || !c.unit.en || isShelfWeek(c.unit.week_n)) return false;
      seen.add(c.unit.id);
      return c.unit.la.length <= 220;
    });
    if (!cands.length) return null;
    // Every verified candidate of the skill in a unit: the word indexes the app may claim carry the construction.
    const verifiedIn = (unitId) => new Set(all.filter((c) => c.unit.id === unitId && !c.ambiguous && c.verified).map((c) => c.index));
    const keyOf = (c) => `translate:${c.unit.id}`;
    const keys = cands.map(keyOf);
    const got = pool.chooseInfo(skill.id, 'translate', keys, rand, tiersFor(cands, keyOf, opts));
    if (!got) return null;
    const c = cands[keys.indexOf(got.key)];
    // The key words: every word inside the skill's pattern match (the construction), the target word at least.
    const stripped = strippedText(c.unit.la);
    const spans = patternSpans(c.unit.la, patternsOf(skill), stripped);
    const words = items.meaningsOf ? items.meaningsOf(c.unit.la) : [];
    // The pattern regex is loose (a genitive pattern lights *cui*), so the spans are intersected with the parses the
    // sentence actually settles: a word the app cannot verify is never lit as the construction (QA M1).
    const ok = verifiedIn(c.unit.id);
    const lit = words.map((w, i) => ({ w, i })).filter(({ w, i }) => ok.has(i) && spans.some(([s, e]) => stripped.map[w.start] >= s && stripped.map[w.start] < e)).map(({ i }) => i);
    if (!lit.includes(c.index)) lit.push(c.index);
    const lab = c.value ? featureLabel(skill.feature ?? 'case', c.value, { skills: items.skills, skill }) : { name: skill.title, plain: skill.plain };
    return { ...base(skill, 'translate', stage, c), key: got.key, input: 'self', repeat: got.wrapped, lit: lit.sort((a, b) => a - b),
      prompt: { la: c.unit.la, question: 'Translate the sentence, then compare', gloss: lemmaGloss(c.entry), hint: `${c.token.text} is ${lab.name} — ${lab.plain}.` },
      answer: [c.unit.en], choices: null,
      feedback: { short: `${c.token.text} is ${lab.name} — ${lab.plain} — from ${c.entry.lemma}.`, term: skill.plain, label: lab, table: null, lemma: c.entry.lemma, sense: null, paradigm: null, sentence: c.unit.la, sentenceEn: c.unit.en } };
  }

  const FNS = { transform, reorder, translate };
  function generate({ skill: skillId, kind, stage = 3, currentWeek = false, currentWeekN = null } = {}) {
    const skill = typeof skillId === 'string' ? items.skills.get(skillId) : skillId;
    if (!skill || !skill.parse_filter || !FNS[kind]) return null;
    const opts = { currentWeek, currentWeekN };
    let item = FNS[kind](skill, stage, opts);
    if (!item && currentWeek) item = FNS[kind](skill, stage, { currentWeek: false, currentWeekN: null });
    return item;
  }
  return { generate };
}
