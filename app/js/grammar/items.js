// Drill items (GRAMMAR-CONTRACT.md "Drill items"): generated on the device
// from the library's sentences and the dictionary's parses — nothing is
// hand-written, nothing copyrighted leaves the library. Wave 1 kinds:
// recognise (choice), chart (a paradigm cell, or a column when learning),
// parse (choice at stage 1, typed from stage 2), blank (typed; choice at
// stage 1). Every item carries the target's dictionary form + meaning and
// `meanings` for every word, so a drill tests the grammar, never the vocab.
//
//   createItems({ units, lookup, paradigm, skills, storage, rand })
//     .generate({ skill, kind, stage, currentWeek, currentWeekN }) → item | null
//     .candidates(skillId) → the pool (for the skill map's counts)
//
// Answer matching (pure, tested): normaliseAnswer, matchesForm, parseFeatures, matchParse.

import { tokenize, stripMacrons } from '../tokenize.js';
import { weekOfUnit, isShelfWeek } from '../sync.js';

/* ----------------------------------------------------------- labels */
export const CASE_LABEL = {
  nom: { name: 'nominative', plain: 'the subject form' },
  gen: { name: 'genitive', plain: "the 'of' form" },
  dat: { name: 'dative', plain: "the 'to/for' form" },
  acc: { name: 'accusative', plain: 'the object form' },
  abl: { name: 'ablative', plain: "the 'by/with/from' form" },
  voc: { name: 'vocative', plain: 'the address form' },
  loc: { name: 'locative', plain: "the 'at/in' form" },
};
export const TENSE_LABEL = { pres: 'present', impf: 'imperfect', fut: 'future', perf: 'perfect', plupf: 'pluperfect', futperf: 'future perfect' };
export const MOOD_LABEL = { ind: 'indicative', subj: 'subjunctive', imper: 'imperative', inf: 'infinitive' };
export const TM_PLAIN = {
  'pres ind': "the 'is doing / does' tense", 'impf ind': "the 'was doing / used to' tense", 'fut ind': "the 'will do' tense",
  'perf ind': "the 'did / has done' tense", 'plupf ind': "the 'had done' tense", 'futperf ind': "the 'will have done' tense",
  'pres subj': "the 'may / let' form", 'impf subj': "the 'might / would' form", 'perf subj': "the 'may have done' form", 'plupf subj': "the 'might have done' form",
};
const NUMBER_LABEL = { sg: 'singular', pl: 'plural' };
const PERSON_LABEL = { 1: '1st person', 2: '2nd person', 3: '3rd person' };
const CASE_FILLERS = ['nom', 'gen', 'dat', 'acc', 'abl'];
const TM_FILLERS = ['pres ind', 'impf ind', 'perf ind', 'fut ind', 'plupf ind', 'pres subj', 'impf subj', 'perf subj', 'plupf subj'];

/** True when `v` is the filter value or one of a filter's listed values. Pure. */
export const valueIn = (v, f) => (f == null ? true : Array.isArray(f) ? f.map(String).includes(String(v)) : String(v) === String(f));

/**
 * The dimension a skill's items ask about: 'case' (nouns, adjectives,
 * pronouns), 'tm' (tense + mood, participles and infinitives included),
 * 'degree' (comparison), or null (adverbs, enclitics: blank items only).
 */
export function featureKey(filter) {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return null;
  if (filter.case) return 'case';
  if (filter.tense || filter.mood || filter.deponent) return 'tm';
  if (filter.degree) return 'degree';
  const pos = Array.isArray(filter.pos) ? filter.pos[0] : filter.pos;
  if (pos === 'V' || pos === 'VPAR') return 'tm';
  if (pos === 'ADV' || pos === 'CONJ' || pos === 'PREP') return null;
  return 'case';
}
export function featureValue(p, key) {
  if (!p || !key) return null;
  if (key === 'case') return p.case ?? null;
  if (key === 'degree') return p.degree || (p.case ? 'pos' : null);
  if (!p.mood) return null;
  if (p.mood === 'ptc' || p.mood === 'inf') return p.tense ? `${p.tense} ${p.mood}` : null;
  if (p.mood === 'gerund' || p.mood === 'gerundive' || p.mood === 'supine') return p.mood;
  return p.tense ? `${p.tense} ${p.mood}` : null;
}
/** True when a feature value satisfies the skill's filter (so it can never be a distractor). Pure. */
export function valueFits(value, filter, key) {
  if (value == null) return false;
  if (key === 'case') return valueIn(value, filter.case);
  if (key === 'degree') return valueIn(value, filter.degree);
  const [t, m] = String(value).split(' ');
  if (!m) return valueIn(value, filter.mood);
  return valueIn(t, filter.tense) && valueIn(m, filter.mood);
}
const DEGREE_LABEL = { pos: { name: 'positive', plain: 'the plain form' }, comp: { name: 'comparative', plain: "the '-er / more' form" }, super: { name: 'superlative', plain: "the '-est / most / very' form" } };
const MOOD_ONLY_LABEL = { gerund: ["gerund", "the '-ing' noun"], gerundive: ["gerundive", "the 'to be done' adjective"], supine: ["supine", "the '-um / -u' form after motion or an adjective"] };
/** { name, plain, full } for a feature value ("dative", "the 'to/for' form", "dative — the 'to/for' form"). */
export function featureLabel(key, value) {
  if (key === 'case') { const c = CASE_LABEL[value]; return c ? { name: c.name, plain: c.plain, full: `${c.name} — ${c.plain}` } : { name: String(value), plain: '', full: String(value) }; }
  if (key === 'degree') { const d = DEGREE_LABEL[value]; return d ? { name: d.name, plain: d.plain, full: `${d.name} — ${d.plain}` } : { name: String(value), plain: '', full: String(value) }; }
  if (MOOD_ONLY_LABEL[value]) { const [name, plain] = MOOD_ONLY_LABEL[value]; return { name, plain, full: `${name} — ${plain}` }; }
  const [t, m] = String(value).split(' ');
  const name = m === 'ptc' ? `${TENSE_LABEL[t] ?? t} participle` : m === 'inf' ? `${TENSE_LABEL[t] ?? t} infinitive` : `${TENSE_LABEL[t] ?? t} ${MOOD_LABEL[m] ?? m}`;
  const plain = TM_PLAIN[value] ?? (m === 'ptc' ? "the '-ing / having been done' form" : m === 'inf' ? "the 'to do' form" : m === 'imper' ? 'the command form' : '');
  return { name, plain, full: plain ? `${name} — ${plain}` : name };
}

/* ----------------------------------------------------------- parses */
const FILTER_KEYS = ['case', 'number', 'gender', 'tense', 'voice', 'mood', 'person', 'degree'];
/** True when a parse satisfies the filter's parse-level keys (each a value or a list). Pure. */
export function parseMatches(p, filter) {
  if (!p || !filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
  for (const k of FILTER_KEYS) {
    if (filter[k] == null) continue;
    const v = k === 'degree' ? (p.degree || (p.case ? 'pos' : undefined)) : p[k];
    if (v == null || !valueIn(v, filter[k])) return false;
  }
  return true;
}
/** True when the entry itself fits the filter: part of speech, lemma list (`h`), declension (`decl` = cat[0]), deponent. Pure. */
export function entryAllowed(entry, filter) {
  if (!entry || !filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
  if (filter.pos != null && !valueIn(entry.pos, filter.pos) && !(entry.pos === 'VPAR' && valueIn('V', filter.pos))) return false;
  if (filter.h != null && !valueIn(entry.h, filter.h)) return false;
  if (filter.enc != null && entry.enc !== filter.enc) return false;
  if (filter.decl != null && !valueIn(entry.cat?.[0], filter.decl)) return false;
  if (filter.deponent === true && entry.kind !== 'dep' && entry.kind !== 'semidep') return false;
  return true;
}
const headSense = (entry) => String(entry?.senses?.[0] ?? '').split(/[;]/)[0].split(',').slice(0, 2).join(',').trim();
export const lemmaGloss = (entry) => (entry ? `${entry.lemma} — ${headSense(entry)}` : '');

/* ------------------------------------------------- answer matching */
/** Macron-optional, case-insensitive, punctuation dropped, spaces collapsed. Pure. */
export function normaliseAnswer(s) {
  return stripMacrons(String(s ?? '')).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Latin forms only: v/u and j/i are one letter for matching (never applied to the English of a typed parse). */
const foldVU = (s) => s.replace(/v/g, 'u').replace(/j/g, 'i');
/** True when the typed form matches one of the accepted answers (macrons optional, v/u and j/i folded). Pure. */
export function matchesForm(typed, answers) {
  const t = foldVU(normaliseAnswer(typed));
  if (!t) return false;
  return (answers || []).some((a) => foldVU(normaliseAnswer(a)) === t);
}

const SYN = {
  case: { nominative: 'nom', nom: 'nom', genitive: 'gen', gen: 'gen', dative: 'dat', dat: 'dat', accusative: 'acc', acc: 'acc', ablative: 'abl', abl: 'abl', vocative: 'voc', voc: 'voc', locative: 'loc', loc: 'loc' },
  number: { singular: 'sg', sing: 'sg', sg: 'sg', s: 'sg', plural: 'pl', plur: 'pl', pl: 'pl', p: 'pl' },
  tense: { present: 'pres', pres: 'pres', imperfect: 'impf', impf: 'impf', imperf: 'impf', future: 'fut', fut: 'fut', perfect: 'perf', perf: 'perf', pluperfect: 'plupf', plupf: 'plupf', plup: 'plupf', 'future perfect': 'futperf', futperf: 'futperf', 'fut perf': 'futperf' },
  mood: { indicative: 'ind', ind: 'ind', indic: 'ind', subjunctive: 'subj', subj: 'subj', subjunct: 'subj', imperative: 'imper', imper: 'imper', infinitive: 'inf', inf: 'inf', participle: 'ptc', ptc: 'ptc', gerund: 'gerund', gerundive: 'gerundive', supine: 'supine' },
  degree: { positive: 'pos', comparative: 'comp', comp: 'comp', superlative: 'super', sup: 'super', super: 'super' },
  person: { '1st': '1', first: '1', '1': '1', '2nd': '2', second: '2', '2': '2', '3rd': '3', third: '3', '3': '3' },
  gender: { masculine: 'm', masc: 'm', m: 'm', feminine: 'f', fem: 'f', f: 'f', neuter: 'n', neut: 'n', n: 'n' },
};
/** The grammatical features named in a typed parse ("dat. sg." → { case: 'dat', number: 'sg' }); a word naming two values of one feature is a contradiction (kept as an array). Pure. */
export function parseFeatures(typed) {
  const text = normaliseAnswer(typed).replace(/\b(the|of|person|form|tense)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const out = {};
  const put = (k, v) => { if (out[k] == null) out[k] = v; else if (out[k] !== v) out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v]; };
  let rest = text;
  for (const phrase of ['future perfect', 'fut perf']) if (rest.includes(phrase)) { put('tense', 'futperf'); rest = rest.split(phrase).join(' '); }
  for (const w of rest.split(' ').filter(Boolean)) {
    for (const [k, table] of Object.entries(SYN)) {
      if (Object.prototype.hasOwnProperty.call(table, w)) { put(k, table[w]); break; }
    }
  }
  return out;
}
/**
 * A typed parse against what the item expects: every `required` feature must
 * be named with the right value; any other feature named must not contradict
 * the item's parse. Pure.
 */
export function matchParse(typed, expect) {
  const f = parseFeatures(typed);
  const req = expect?.required ?? Object.keys(expect?.values ?? {});
  const vals = expect?.values ?? {};
  for (const k of req) if (f[k] == null || Array.isArray(f[k]) || String(f[k]) !== String(vals[k])) return false;
  for (const [k, v] of Object.entries(f)) if (vals[k] != null && String(v) !== String(vals[k])) return false;
  return true;
}

/* ---------------------------------------------------------- pool */
/** Used item keys per skill/kind so nothing repeats until the pool is exhausted (localStorage-backed; any getItem/setItem object). */
export function createPool(storage, key = 'l103.grammar.used') {
  let data = {};
  try { data = JSON.parse(storage?.getItem?.(key) || '{}') || {}; } catch { data = {}; }
  const save = () => { try { storage?.setItem?.(key, JSON.stringify(data)); } catch { /* private mode */ } };
  return {
    used(skill, kind) { return new Set(data[`${skill}|${kind}`] ?? []); },
    /** Pick from `keys` one not used yet; when every key has been used the pool starts over. */
    choose(skill, kind, keys, rand = Math.random) {
      if (!keys.length) return null;
      const k = `${skill}|${kind}`;
      let used = new Set(data[k] ?? []);
      let fresh = keys.filter((x) => !used.has(x));
      if (!fresh.length) { used = new Set(); fresh = keys; }
      const pick = fresh[Math.floor(rand() * fresh.length)];
      used.add(pick);
      data[k] = [...used];
      save();
      return pick;
    },
    reset(skill = null) { if (skill == null) data = {}; else for (const k of Object.keys(data)) if (k.startsWith(`${skill}|`)) delete data[k]; save(); },
  };
}

/* ---------------------------------------------------- candidates */
const weekOf = (id) => weekOfUnit(id);   // w07:… → 7; the review shelf's r07:… → 107 (sync.js)

/**
 * Every word in `unit.la` whose dictionary parses satisfy the skill's
 * parse_filter. `ambiguous` — the word also reads as another value of the
 * same feature (puellae: genitive or dative; servīs: dative or ablative), so
 * only blank items may use it. Pure given `lookup`.
 */
export function scanUnit(unit, skill, lookup) {
  // An any-of list of filters (the enclitics: [{enc:'que'},{enc:'ne'}]) is scanned filter by filter.
  if (Array.isArray(skill.parse_filter)) return skill.parse_filter.flatMap((f) => scanUnit(unit, { ...skill, parse_filter: f }, lookup));
  const filter = skill.parse_filter;
  if (!filter || typeof filter !== 'object') return [];
  const key = featureKey(filter);
  const out = [];
  const toks = tokenize(unit.la);
  let wi = -1;
  for (const t of toks) {
    if (!t.isWord) continue;
    wi += 1;
    if (t.text.length < 2) continue;
    const res = lookup(t.form);
    const all = res?.entries || [];
    const entries = all.filter((e) => entryAllowed(e, filter));
    if (!entries.length) continue;
    // A form that reads as a noun *and* as a verb (īrī: Īris or īre) is left alone for every kind: the
    // dictionary's first entry is not always the sentence's, and a drill must never gloss a word wrongly.
    const classOf = (e) => (e.pos === 'V' ? 'verb' : e.pos === 'VPAR' ? null : ['N', 'ADJ', 'PRON', 'NUM'].includes(e.pos) ? 'nominal' : 'other');
    const classes = new Set(all.filter((e) => e.pos !== 'ENDING' && !e.enc).map(classOf).filter(Boolean));
    if (classes.size > 1) continue;
    let entry = null, parse = null;
    const values = new Set();
    for (const e of entries) {
      for (const p of e.parses || []) {
        const v = featureValue(p, key);
        if (v) values.add(v);
        if (!entry && parseMatches(p, filter) && (!key || v)) { entry = e; parse = p; }
      }
    }
    if (!entry) continue;
    // Enclitic readings (-que) count only for an enclitic skill; glossary entries that are only endings never do.
    if (entry.pos === 'ENDING' || (filter.enc ? entry.enc !== filter.enc : !!entry.enc)) continue;
    out.push({ unit, token: t, index: wi, entry, parse, ambiguous: values.size > 1, values: [...values], value: featureValue(parse, key) });
  }
  return out;
}

/* ------------------------------------------------------ generator */
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickOne = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const SHORT_LA = 180;
const blankOut = (la, t) => `${la.slice(0, t.start)}___${la.slice(t.end)}`;
const meaningsOf = (la) => tokenize(la).filter((t) => t.isWord).map((t) => ({ text: t.text, form: t.form, start: t.start }));

export function createItems({ units = [], lookup, paradigm = null, skills, storage = null, rand = Math.random }) {
  const skillMap = skills instanceof Map ? skills : new Map((skills?.skills ?? skills ?? []).map((s) => [s.id, s]));
  const pool = createPool(storage);
  const cache = new Map();   // skill id → candidates
  const unitList = units.map((u) => ({ ...u, week_n: u.week_n ?? weekOf(u.id) }));

  function candidates(skillId) {
    if (!cache.has(skillId)) {
      const skill = skillMap.get(skillId);
      const out = [];
      if (skill) for (const u of unitList) if (typeof u.la === 'string' && u.la) out.push(...scanUnit(u, skill, lookup));
      cache.set(skillId, out);
    }
    return cache.get(skillId);
  }

  const key = (skill) => featureKey(skill.parse_filter || {});
  const singleValue = (skill, k) => {
    const f = skill.parse_filter || {};
    if (k === 'case') return typeof f.case === 'string' ? f.case : null;
    if (k === 'degree') return typeof f.degree === 'string' ? f.degree : null;
    if (k === 'tm') return typeof f.tense === 'string' && typeof f.mood === 'string' ? `${f.tense} ${f.mood}` : (typeof f.mood === 'string' && !f.tense && MOOD_ONLY_LABEL[f.mood] ? f.mood : null);
    return null;
  };
  const distractorValues = (skill, own) => {
    const k = key(skill);
    const filter = skill.parse_filter || {};
    const conf = (skill.confusable_with || []).map((id) => skillMap.get(id)).filter((s) => s && key(s) === k)
      .map((s) => ({ skill: s.id, value: singleValue(s, k) }))
      .filter((d) => d.value && d.value !== own && !valueFits(d.value, filter, k));
    const seen = new Set(conf.map((c) => c.value));
    const pool = k === 'case' ? CASE_FILLERS : k === 'degree' ? Object.keys(DEGREE_LABEL) : TM_FILLERS;
    const fillers = pool.filter((v) => v !== own && !seen.has(v) && !valueFits(v, filter, k)).map((value) => ({ skill: null, value }));
    return { own, conf: conf.filter((c, i) => conf.findIndex((x) => x.value === c.value) === i), fillers };
  };

  const base = (skill, kind, stage, c) => ({
    skill: skill.id, kind, stage, unit_id: c?.unit?.id ?? null, week_n: c?.unit?.week_n ?? null,
    target: c ? { text: c.token.text, form: c.token.form, start: c.token.start, end: c.token.end, index: c.index } : null,
    entry: c?.entry ?? null, parse: c?.parse ?? null,
    meanings: c ? meaningsOf(c.unit.la) : [],
  });
  const feedbackFor = (skill, c, k) => {
    const lab = c && c.value ? featureLabel(k, c.value) : { name: skill.title, plain: skill.plain, full: skill.plain };
    const table = paradigm && c?.entry ? safeParadigm(c.entry, c.parse) : null;
    const readings = c?.ambiguous ? c.values.map((v) => featureLabel(k, v).name).join(' or ') : null;
    return {
      short: c ? (c.ambiguous ? `${c.token.text} is the form of ${c.entry.lemma} that fits; the ending could be ${readings} — the sentence decides.` : `${c.token.text} is ${lab.name} — ${lab.plain} — from ${c.entry.lemma}.`) : `${lab.full}.`,
      term: skill.plain, label: lab, table, lemma: c?.entry?.lemma ?? null, sense: c ? headSense(c.entry) : null,
      paradigm: { key: skill.paradigms?.[0] ?? null, highlight: skill.parse_filter },
    };
  };
  function safeParadigm(entry, parse) { try { return paradigm(entry, parse ? [parse] : []); } catch { return null; } }

  const pickCandidate = (skill, kind, { unambiguous, currentWeek, currentWeekN }) => {
    let pool_ = candidates(skill.id);
    if (unambiguous) pool_ = pool_.filter((c) => !c.ambiguous);
    else { const clear = pool_.filter((c) => !c.ambiguous); if (clear.length >= 5) pool_ = clear; }   // blank: forms the sentence reads one way, while there are enough
    if (!pool_.length) return null;
    let cands = pool_;
    // The ≈ 20 % current-week slots draw from a course week only (n ≤ 14): a shelf chapter being read is never 'this week'.
    if (currentWeek && currentWeekN != null && !isShelfWeek(currentWeekN)) { const w = pool_.filter((c) => c.unit.week_n === currentWeekN); if (w.length) cands = w; }
    // Shorter sentences first: a drill reads one sentence, not a paragraph (long ones return once the short pool is spent).
    const short = cands.filter((c) => c.unit.la.length <= SHORT_LA);
    if (short.length >= 5) cands = short;
    const keys = cands.map((c) => `${kind}:${c.unit.id}:${c.token.form}:${c.index}`);
    const chosen = pool.choose(skill.id, kind, keys, rand);
    return { c: cands[keys.indexOf(chosen)], key: chosen };
  };

  function recognise(skill, stage, opts) {
    const k = key(skill);
    if (!k) return null;
    const got = pickCandidate(skill, 'recognise', { unambiguous: true, ...opts });
    if (!got) return null;
    const { c, key: itemKey } = got;
    const { conf, fillers } = distractorValues(skill, c.value);
    const options = [...conf, ...shuffle(fillers, rand)].slice(0, 3);
    const choices = shuffle([{ value: c.value, correct: true, skill: skill.id }, ...options.map((d) => ({ value: d.value, correct: false, skill: d.skill }))], rand)
      .map((ch) => ({ ...ch, label: featureLabel(k, ch.value).name, plain: featureLabel(k, ch.value).plain }));
    const q = k === 'case' ? 'Which case is' : 'Which tense and mood is';
    // Every other recognise item is "tap the word": the sentence's words are the
    // choices, and any word the skill's filter fits is right (accept = word indexes).
    if (opts.tap ?? rand() < 0.5) {
      const lab = featureLabel(k, c.value);
      const accept = candidates(skill.id).filter((x) => x.unit.id === c.unit.id && x.value === c.value && !x.ambiguous).map((x) => x.index);
      return { ...base(skill, 'recognise', stage, c), key: itemKey.replace(/^recognise:/, 'recognise-tap:'), input: 'tap',
        prompt: { la: c.unit.la, question: `Tap the word that is ${lab.name} — ${lab.plain}`, gloss: null, hint: skill.summary },
        answer: [c.token.text], accept: accept.length ? accept : [c.index], choices: null, feedback: feedbackFor(skill, c, k) };
    }
    return { ...base(skill, 'recognise', stage, c), key: itemKey, input: 'choice',
      prompt: { la: c.unit.la, question: `${q} ${c.token.text} here?`, gloss: lemmaGloss(c.entry), hint: skill.summary },
      answer: [c.value], choices, feedback: feedbackFor(skill, c, k) };
  }

  const parseExpect = (skill, c) => {
    const p = c.parse;
    const k = key(skill);
    if (k === 'case') return { values: { case: p.case, number: p.number, gender: p.gender }, required: p.number ? ['case', 'number'] : ['case'] };
    if (k === 'degree') return { values: { degree: p.degree || 'pos', case: p.case, number: p.number }, required: ['degree'] };
    if (p.mood === 'ptc' || p.mood === 'gerundive') return { values: { tense: p.tense, mood: p.mood, case: p.case, number: p.number }, required: p.tense ? ['tense', 'case'] : ['case'] };
    return { values: { tense: p.tense, mood: p.mood, person: p.person != null ? String(p.person) : undefined, number: p.number, voice: p.voice }, required: ['tense', 'mood'] };
  };
  const parseName = (skill, p) => {
    const k = key(skill);
    if (k === 'case') return `${CASE_LABEL[p.case]?.name ?? p.case} ${NUMBER_LABEL[p.number] ?? p.number ?? ''}`.trim();
    if (k === 'degree') return `${DEGREE_LABEL[p.degree || 'pos']?.name ?? p.degree}${p.case ? `, ${CASE_LABEL[p.case]?.name ?? p.case} ${NUMBER_LABEL[p.number] ?? ''}` : ''}`.trim();
    if (p.mood === 'ptc' || p.mood === 'gerundive') return `${featureLabel('tm', featureValue(p, 'tm')).name}${p.case ? `, ${CASE_LABEL[p.case]?.name ?? p.case} ${NUMBER_LABEL[p.number] ?? ''}` : ''}`.trim();
    return `${TENSE_LABEL[p.tense] ?? p.tense} ${MOOD_LABEL[p.mood] ?? p.mood}${p.person ? `, ${PERSON_LABEL[p.person]} ${NUMBER_LABEL[p.number] ?? ''}` : ''}`.trim();
  };

  function parseItem(skill, stage, opts) {
    const k = key(skill);
    if (!k) return null;
    const got = pickCandidate(skill, 'parse', { unambiguous: true, ...opts });
    if (!got) return null;
    const { c, key: itemKey } = got;
    const expect = parseExpect(skill, c);
    const canonical = parseName(skill, c.parse);
    const item = { ...base(skill, 'parse', stage, c), key: itemKey, input: stage >= 2 ? 'type' : 'choice',
      prompt: { la: c.unit.la, question: k === 'case' ? `Parse ${c.token.text}: case and number` : `Parse ${c.token.text}: tense and mood`, gloss: lemmaGloss(c.entry), hint: skill.summary },
      answer: [canonical], expect, choices: null, feedback: feedbackFor(skill, c, k) };
    if (item.input === 'choice') {
      const { conf, fillers } = distractorValues(skill, c.value);
      const others = [...conf, ...shuffle(fillers, rand)].slice(0, 2);
      const p = c.parse;
      const alt = { ...p, number: p.number === 'sg' ? 'pl' : 'sg' };
      const withValue = (d) => (k === 'case' ? { ...p, case: d.value } : k === 'degree' ? { ...p, degree: d.value } : { ...p, tense: d.value.split(' ')[0], mood: d.value.split(' ')[1] ?? p.mood });
      const opts_ = [
        { value: canonical, correct: true, skill: skill.id },
        { value: parseName(skill, alt), correct: false, skill: null },
        ...others.map((d) => ({ value: parseName(skill, withValue(d)), correct: false, skill: d.skill })),
      ];
      const seen = new Set();
      item.choices = shuffle(opts_.filter((o) => !seen.has(o.value) && seen.add(o.value)), rand).map((o) => ({ ...o, label: o.value }));
      item.answer = [canonical];
    }
    return item;
  }

  function blank(skill, stage, opts) {
    const k = key(skill);
    const got = pickCandidate(skill, 'blank', { unambiguous: false, ...opts });
    if (!got) return null;
    const { c, key: itemKey } = got;
    const answer = [c.token.text, stripMacrons(c.token.text)];
    const lab = featureLabel(k, c.value);
    const item = { ...base(skill, 'blank', stage, c), key: itemKey, input: stage >= 2 ? 'type' : 'choice',
      prompt: { la: blankOut(c.unit.la, c.token), question: `Fill the blank with the right form of ${c.entry.lemma.split(/[\s,]/)[0]}`, gloss: lemmaGloss(c.entry), hint: `${lab.name} — ${lab.plain}` },
      answer, choices: null, feedback: feedbackFor(skill, c, k) };
    if (item.input === 'choice') {
      const table = paradigm ? safeParadigm(c.entry, null) : null;
      const forms = new Set();
      for (const s of table?.sections ?? []) for (const r of s.rows) for (const cell of r.cells) if (cell && !cell.empty && cell.text && cell.text !== '—') forms.add(cell.text.split(' / ')[0]);
      const norm = normaliseAnswer(c.token.text);
      const others = shuffle([...forms].filter((f) => normaliseAnswer(f) !== norm), rand).slice(0, 3);
      item.choices = shuffle([{ value: c.token.text, correct: true }, ...others.map((f) => ({ value: f, correct: false }))], rand).map((o) => ({ ...o, label: o.value, skill: null }));
    }
    return item;
  }

  const cellMatches = (cell, filter, k) => {
    const kk = cell?.key;
    if (!kk || cell.empty || !filter) return false;
    if (kk.kind === 'nominal') {
      if (k === 'tm' || kk.mood) return false;   // participle cells inside a verb table are not the verb's finite forms
      return valueIn(kk.case, filter.case) && valueIn(kk.number, filter.number) && (filter.degree == null || valueIn(kk.degree ?? 'pos', filter.degree)) && (filter.gender == null || !kk.gender || valueIn(kk.gender, filter.gender));
    }
    if (kk.kind === 'finite') return k === 'tm' && valueIn(kk.tense, filter.tense) && valueIn(kk.mood, filter.mood) && valueIn(kk.voice, filter.voice) && valueIn(kk.person, filter.person);
    return false;
  };
  function chart(skill, stage, opts, { full = false } = {}) {
    if (!paradigm) return null;
    const k = key(skill);
    const filter = skill.parse_filter || {};
    // The lemmas the skill's sentences use, one paradigm each; the pool is keyed by lemma + cell.
    const seen = new Map();
    for (const c of candidates(skill.id)) if (!seen.has(c.entry.h)) seen.set(c.entry.h, c);
    const entries = [...seen.values()];
    if (!entries.length) return null;
    const keys = [];
    const spots = [];
    for (const c of entries) {
      const table = safeParadigm(c.entry, null);
      if (!table) continue;
      table.sections.forEach((s, si) => s.rows.forEach((r, ri) => r.cells.forEach((cell, ci) => {
        if (cellMatches(cell, filter, k)) { keys.push(`chart:${c.entry.h}:${si}.${ri}.${ci}`); spots.push({ c, table, si, ri, ci }); }
      })));
    }
    if (!keys.length) return null;
    const chosen = pool.choose(skill.id, 'chart', keys, rand);
    const spot = spots[keys.indexOf(chosen)];
    const { c, table, si, ri, ci } = spot;
    const section = table.sections[si];
    const cellAnswers = (cell) => [cell.text, ...(cell.alt ? [cell.alt] : []), ...String(cell.text).split(' / ')].filter(Boolean);
    const target = section.rows[ri].cells[ci];
    const rowLabel = section.rows[ri].label;
    const colLabel = section.headers?.[ci] ?? '';
    const finite = target.key?.kind === 'finite';
    // "dative singular" for a noun; "imperfect subjunctive, we (passive)" for a verb — the tense and mood are the point.
    const cellLabel = (r) => (finite ? `${section.title}, ${r.label}${colLabel ? ` (${colLabel})` : ''}` : `${r.label}${colLabel ? ` ${colLabel}` : ''}`);
    const cells = full
      ? section.rows.map((r, rj) => ({ row: rj, col: ci, label: cellLabel(r), answer: cellAnswers(r.cells[ci]), empty: !!r.cells[ci]?.empty })).filter((x) => !x.empty)
      : [{ row: ri, col: ci, label: cellLabel(section.rows[ri]), answer: cellAnswers(target) }];
    const cellKey = section.rows[ri].cells[ci].key;
    const lab = k === 'case' ? featureLabel('case', cellKey.case) : k === 'tm' ? featureLabel('tm', `${cellKey.tense} ${cellKey.mood}`) : { name: skill.title, plain: skill.plain, full: skill.plain };
    const lemma = c.entry.lemma;
    return { ...base(skill, 'chart', stage, null), key: chosen, input: 'chart', entry: c.entry, lemma,
      prompt: { la: null, question: full ? `Fill in the ${finite ? `${section.title}${colLabel ? ` (${colLabel})` : ''}` : colLabel || section.title} of ${lemma.split(/[\s,]/)[0]}` : `Give the ${cellLabel(section.rows[ri])} of ${lemma.split(/[\s,]/)[0]}`, gloss: lemmaGloss(c.entry), hint: `${lab.name} — ${lab.plain}` },
      answer: cellAnswers(target),
      chart: { table, section: si, col: ci, target: { row: ri, col: ci }, cells, full },
      meanings: [], feedback: { ...feedbackFor(skill, null, k), short: `${target.text} is the ${cellLabel(section.rows[ri])} of ${lemma} — ${lab.plain}.`, table, lemma, sense: headSense(c.entry) } };
  }

  function generate({ skill: skillId, kind, stage = 1, currentWeek = false, currentWeekN = null, full = false, tap = undefined } = {}) {
    const skill = typeof skillId === 'string' ? skillMap.get(skillId) : skillId;
    if (!skill) return null;
    const opts = { currentWeek, currentWeekN, tap };
    const fn = { recognise, parse: parseItem, blank, chart: (s, st, o) => chart(s, st, o, { full }) }[kind];
    if (!fn) return null;
    let item = fn(skill, stage, opts);
    if (!item && currentWeek) item = fn(skill, stage, { currentWeek: false, currentWeekN: null });
    if (!item) { // fall back through the other kinds so a session slot is never empty
      for (const alt of ['blank', 'recognise', 'parse', 'chart']) { if (alt === kind) continue; item = ({ recognise, parse: parseItem, blank, chart: (s, st, o) => chart(s, st, o, { full }) })[alt](skill, stage, { currentWeek: false, currentWeekN: null }); if (item) break; }
    }
    return item;
  }

  return { generate, candidates, pool, skills: skillMap };
}
