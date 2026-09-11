// Drill items (GRAMMAR-CONTRACT.md "Drill items"): generated on the device
// from the library's sentences and the dictionary's parses — nothing is
// hand-written, nothing copyrighted leaves the library. Wave 1 kinds:
// recognise (choice / tap), chart (a paradigm cell, or a row / column when
// learning), parse (choice at stage 1, typed from stage 2), blank (typed;
// choice at stage 1). Every item carries the target's dictionary form + meaning
// and `meanings` for every word, so a drill tests the grammar, never the vocab.
//
//   createItems({ units, lookup, paradigm, skills, storage, rand, gold })
//     .generate({ skill, kind, stage, currentWeek, currentWeekN, avoid }) → item | null
//     .candidates(skillId) → the pool (for the skill map's counts)
//     .drillable(skillId) → true when the skill can produce an item at all
//
// What a skill asks about is its `feature` (skills.json): case · gender ·
// number · tense · mood · voice · person · degree · construction · form.
// Construction skills (the function-named case skills and the syntax skills)
// ask what the form is *doing* — "What is this dative doing here?", "What kind
// of clause is this?" — with the confusable constructions as the choices, so
// a wrong answer names the pair the learner mixes up.
//
// Candidates come from sentences matched by the skill's `patterns` (together
// with `parse_filter`), plus "gold" sentences: the lesson's own example units
// and the reader's grammar-focus highlights whose label names the
// construction (`highlight_match`). Whitaker's spare parses are trimmed by
// what the sentence shows: the macrons on the form, a preposition before it,
// agreement with a neighbouring word, a vocative only where someone is
// addressed; a reading the entry's own paradigm cannot produce is dropped.
//
// Answer matching (pure, tested): normaliseAnswer, matchesForm, parseFeatures, matchParse, matchFunction.

import { tokenize, stripMacrons } from '../tokenize.js';
import { weekOfUnit, isShelfWeek } from '../sync.js';
import { scopeByChapter, scopeNote } from './chapter.js';

/* ----------------------------------------------------------- labels */
export const FEATURES = Object.freeze(['case', 'gender', 'number', 'tense', 'mood', 'voice', 'person', 'degree', 'construction', 'form']);
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
  'pres imper': 'the command form', 'fut imper': "the 'you shall' command", 'pres inf': "the 'to do' form", 'perf inf': "the 'to have done' form", 'fut inf': "the 'to be going to' form",
  'pres ptc': "the '-ing' word", 'perf ptc': "the 'having been done' word", 'fut ptc': "the 'about to' word",
};
const NUMBER_LABEL = { sg: { name: 'singular', plain: 'one' }, pl: { name: 'plural', plain: 'more than one' } };
const GENDER_LABEL = { m: { name: 'masculine', plain: 'he-words' }, f: { name: 'feminine', plain: 'she-words' }, n: { name: 'neuter', plain: 'it-words' }, c: { name: 'masculine or feminine', plain: 'common gender' } };
const VOICE_LABEL = { act: { name: 'active', plain: 'the subject does it' }, pass: { name: 'passive', plain: 'it is done to the subject' }, dep: { name: 'deponent', plain: 'passive form, active meaning' } };
const PERSON_WORD = { 1: '1st person', 2: '2nd person', 3: '3rd person' };
const PERSON_PLAIN = { '1 sg': 'I', '2 sg': 'you (one)', '3 sg': 'he / she / it', '1 pl': 'we', '2 pl': 'you (all)', '3 pl': 'they' };
const DEGREE_LABEL = { pos: { name: 'positive', plain: 'the plain form' }, comp: { name: 'comparative', plain: "the '-er / more' form" }, super: { name: 'superlative', plain: "the '-est / most / very' form" } };
const FORM_LABEL = {
  que: { name: '-que: and', plain: 'joins to the word before it' }, ne: { name: '-ne: a question', plain: 'turns the sentence into a yes/no question' }, ve: { name: '-ve: or', plain: 'an alternative' },
  stem1: { name: 'present stem', plain: 'from the 1st / 2nd principal part' }, stem2: { name: 'perfect stem', plain: 'from the 3rd principal part' }, stem3: { name: 'participle stem', plain: 'from the 4th principal part' },
};
const MOOD_ONLY_LABEL = { gerund: ['gerund', "the '-ing' noun"], gerundive: ['gerundive', "the 'to be done' adjective"], supine: ['supine', "the '-um / -u' form after motion or an adjective"] };
const CASE_FILLERS = ['nom', 'gen', 'dat', 'acc', 'abl'];
const TM_FILLERS = ['pres ind', 'impf ind', 'perf ind', 'fut ind', 'plupf ind', 'pres subj', 'impf subj', 'perf subj', 'plupf subj'];
const NONFINITE_FILLERS = ['pres inf', 'perf inf', 'pres ptc', 'perf ptc', 'fut ptc', 'pres imper', 'gerund', 'gerundive', 'supine'];
const PERSON_FILLERS = ['1 sg', '2 sg', '3 sg', '1 pl', '2 pl', '3 pl'];
const FILLERS = { case: CASE_FILLERS, gender: ['m', 'f', 'n'], number: ['sg', 'pl'], voice: ['act', 'pass', 'dep'], person: PERSON_FILLERS, degree: ['pos', 'comp', 'super'], form: ['que', 'ne', 've'] };
const MACRON_RE = /[āēīōūȳĀĒĪŌŪȲ]/;

/** True when `v` is the filter value or one of a filter's listed values. Pure. */
export const valueIn = (v, f) => (f == null ? true : Array.isArray(f) ? f.map(String).includes(String(v)) : String(v) === String(f));

/**
 * The dimension a skill's items ask about. Takes a skill (its explicit
 * `feature`, skills.json) or a bare filter (inferred, for older callers and
 * tests): 'case' (nouns, adjectives, pronouns), 'tense' (verbs; participles
 * and infinitives as "perfect participle", "present infinitive"), 'degree',
 * or null (nothing to ask: blank items only).
 */
export function featureKey(skillOrFilter) {
  if (!skillOrFilter || typeof skillOrFilter !== 'object') return null;
  if (Array.isArray(skillOrFilter)) return featureKey(skillOrFilter[0]);
  if (typeof skillOrFilter.feature === 'string') return FEATURES.includes(skillOrFilter.feature) ? skillOrFilter.feature : null;
  if ('feature' in skillOrFilter && skillOrFilter.feature === null) return null;
  const filter = 'parse_filter' in skillOrFilter ? (Array.isArray(skillOrFilter.parse_filter) ? skillOrFilter.parse_filter[0] : skillOrFilter.parse_filter) : skillOrFilter;
  if (!filter || typeof filter !== 'object') return null;
  if (filter.case) return 'case';
  if (filter.tense || filter.mood || filter.deponent) return 'tense';
  if (filter.degree) return 'degree';
  const pos = Array.isArray(filter.pos) ? filter.pos[0] : filter.pos;
  if (pos === 'V' || pos === 'VPAR') return 'tense';
  if (pos === 'N') return 'gender';
  if (pos === 'ADJ' || pos === 'PRON') return 'case';
  return null;
}
const TM_KEY = (key) => key === 'tense' || key === 'mood' || key === 'tm';
const isDeponent = (entry) => entry?.kind === 'dep' || entry?.kind === 'semidep';
const PERFECT_TENSES = new Set(['perf', 'plupf', 'futperf']);
/** The principal-parts stem a form is built on. Pure. */
export function stemOf(p) {
  if (!p) return null;
  if (p.mood === 'supine' || (p.mood === 'ptc' && p.tense !== 'pres') || (p.voice === 'pass' && PERFECT_TENSES.has(p.tense)) || (p.mood === 'inf' && p.tense === 'fut')) return 'stem3';
  if (PERFECT_TENSES.has(p.tense)) return 'stem2';
  if (p.tense || p.mood) return 'stem1';
  return null;
}
/** The value of a feature for one parse (and its entry / skill where the feature lives there). Pure. */
export function featureValue(p, key, entry = null, skill = null) {
  if (!p || !key) return null;
  if (key === 'case') return p.case ?? null;
  if (key === 'gender') return p.gender ?? entry?.gender ?? null;
  if (key === 'number') return p.number ?? null;
  if (key === 'degree') return p.degree || (p.case || entry?.pos === 'ADV' ? 'pos' : null);
  if (key === 'voice') return isDeponent(entry) ? 'dep' : (p.voice ?? null);
  if (key === 'person') return p.person != null && p.number ? `${p.person} ${p.number}` : null;
  if (key === 'construction') return skill?.id ?? null;
  if (key === 'form') return entry?.enc || stemOf(p);
  if (!p.mood) return null;
  if (p.mood === 'ptc' || p.mood === 'inf') return p.tense ? `${p.tense} ${p.mood}` : null;
  if (p.mood === 'gerund' || p.mood === 'gerundive' || p.mood === 'supine') return p.mood;
  if (p.mood === 'imper') return `${p.tense || 'pres'} imper`;
  return p.tense ? `${p.tense} ${p.mood}` : null;
}
/**
 * True when a feature value satisfies the skill's own filter, so it can never
 * be a distractor for it. A filter that says nothing about the feature fits
 * nothing (C1: it must not make every value "fit"). Pure.
 */
export function valueFits(value, filter, key) {
  if (value == null || !filter) return false;
  if (key === 'case' || key === 'gender' || key === 'number' || key === 'degree') return filter[key] != null && valueIn(value, filter[key]);
  if (key === 'voice') return value === 'dep' ? filter.deponent === true : (filter.voice != null && valueIn(value, filter.voice));
  if (key === 'person') { const [pe, nu] = String(value).split(' '); return filter.person != null && valueIn(pe, filter.person) && (filter.number == null || valueIn(nu, filter.number)); }
  if (key === 'form') return filter.enc != null && filter.enc === value;
  if (key === 'construction') return false;
  const [t, m] = String(value).split(' ');
  if (!m) return filter.mood != null && valueIn(value, filter.mood);
  if (filter.tense == null && filter.mood == null) return false;
  return valueIn(t, filter.tense) && valueIn(m, filter.mood);
}
/** { name, plain, full } for a feature value ("dative", "the 'to/for' form", "dative — the 'to/for' form"). `opts.skills` names constructions. */
export function featureLabel(key, value, opts = {}) {
  const mk = (name, plain) => ({ name, plain, full: plain ? `${name} — ${plain}` : name });
  const table = { case: CASE_LABEL, degree: DEGREE_LABEL, gender: GENDER_LABEL, number: NUMBER_LABEL, voice: VOICE_LABEL, form: FORM_LABEL }[key];
  if (table) { const c = table[value]; return c ? mk(c.name, c.plain) : mk(String(value), ''); }
  if (key === 'person') { const [pe, nu] = String(value).split(' '); return mk(`${PERSON_WORD[pe] ?? pe} ${NUMBER_LABEL[nu]?.name ?? nu ?? ''}`.trim(), PERSON_PLAIN[value] ?? ''); }
  if (key === 'construction') {
    const s = opts.skills?.get?.(value);
    const f = s?.function || s?.title || String(value);
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(f);
    return m ? mk(m[1], m[2]) : mk(f, '');
  }
  if (key == null) return opts.skill ? mk(opts.skill.title, opts.skill.plain) : mk(String(value ?? ''), '');
  if (MOOD_ONLY_LABEL[value]) { const [name, plain] = MOOD_ONLY_LABEL[value]; return mk(name, plain); }
  const [t, m] = String(value).split(' ');
  const name = m === 'ptc' ? `${TENSE_LABEL[t] ?? t} participle` : m === 'inf' ? `${TENSE_LABEL[t] ?? t} infinitive` : m === 'imper' ? `${t === 'fut' ? 'future ' : ''}imperative` : `${TENSE_LABEL[t] ?? t} ${MOOD_LABEL[m] ?? m}`;
  const plain = TM_PLAIN[value] ?? (m === 'ptc' ? "the '-ing / having been done' form" : m === 'inf' ? "the 'to do' form" : m === 'imper' ? 'the command form' : '');
  return mk(name, plain);
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
const NOMINAL_POS = new Set(['N', 'ADJ', 'PRON', 'NUM', 'VPAR']);
/**
 * True when the entry itself fits the filter: part of speech, lemma list (`h`),
 * declension (`decl` = cat[0]), deponent. An adverb never satisfies a case
 * filter and a noun never a tense filter, whatever Whitaker lists. Pure.
 */
export function entryAllowed(entry, filter) {
  if (!entry || !filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
  if (filter.pos != null && !valueIn(entry.pos, filter.pos) && !(entry.pos === 'VPAR' && valueIn('V', filter.pos))) return false;
  if (filter.pos == null) {
    if ((filter.case != null || filter.gender != null) && !NOMINAL_POS.has(entry.pos)) return false;
    if ((filter.tense != null || filter.mood != null || filter.voice != null || filter.person != null) && entry.pos !== 'V' && entry.pos !== 'VPAR') return false;
    if (filter.degree != null && entry.pos !== 'ADJ' && entry.pos !== 'ADV') return false;
  }
  if (filter.h != null && !valueIn(entry.h, filter.h)) return false;
  if (filter.enc != null && entry.enc !== filter.enc) return false;
  if (filter.decl != null && !valueIn(entry.cat?.[0], filter.decl)) return false;
  if (filter.deponent === true && !isDeponent(entry)) return false;
  return true;
}
const headSense = (entry) => String(entry?.senses?.[0] ?? '').split(/[;]/)[0].split(',').slice(0, 2).join(',').trim();
export const lemmaGloss = (entry) => (entry ? `${entry.lemma} — ${headSense(entry)}` : '');
/** The head alone: for the rare item whose full citation would spell its own answer (femina *fēminae* f). */
export const headGloss = (entry) => (entry ? `${String(entry.lemma ?? '').split(/[\s,]/)[0]} — ${headSense(entry)}` : '');

/* ------------------------------------------------- answer matching */
/** Macron-optional, case-insensitive, punctuation dropped, spaces collapsed. Pure. */
export function normaliseAnswer(s) {
  return stripMacrons(String(s ?? '')).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * Does a line the item *shows* spell one of the forms it accepts? Whole words,
 * macrons optional — the same reading the grader does. Nothing an item prints
 * before it is answered may pass this (QA-FINAL B1): not the blanked sentence,
 * not the question, and not the dictionary line, whose citation carries the
 * genitive of a noun and the principal parts of a verb.
 */
export const spellsAnswer = (text, answers) => {
  const hay = ` ${normaliseAnswer(text)} `;
  return (answers || []).some((a) => a && hay.includes(` ${normaliseAnswer(a)} `));
};
/** Latin forms only: v/u and j/i are one letter for matching (never applied to the English of a typed parse). */
const foldVU = (s) => s.replace(/v/g, 'u').replace(/j/g, 'i');
/** True when the typed form matches one of the accepted answers (macrons optional, v/u and j/i folded). Pure. */
export function matchesForm(typed, answers) {
  const t = foldVU(normaliseAnswer(typed));
  if (!t) return false;
  return (answers || []).some((a) => foldVU(normaliseAnswer(a)) === t);
}

/** Latin forms with the macrons kept: case-insensitive, punctuation dropped, v/u and j/i still folded (an orthographic variant, not a length contrast). Pure. */
export function normaliseExact(s) {
  return String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** True when the typed form matches an accepted answer *with its macrons* — for drills where the vowel's length is the exercise (pensum blanks). Pure. */
export function matchesFormExact(typed, answers) {
  const t = foldVU(normaliseExact(typed));
  if (!t) return false;
  return (answers || []).some((a) => foldVU(normaliseExact(a)) === t);
}

const SYN = {
  case: { nominative: 'nom', nom: 'nom', genitive: 'gen', gen: 'gen', dative: 'dat', dat: 'dat', accusative: 'acc', acc: 'acc', ablative: 'abl', abl: 'abl', vocative: 'voc', voc: 'voc', locative: 'loc', loc: 'loc' },
  number: { singular: 'sg', sing: 'sg', sg: 'sg', s: 'sg', plural: 'pl', plur: 'pl', pl: 'pl', p: 'pl' },
  tense: { present: 'pres', pres: 'pres', imperfect: 'impf', impf: 'impf', imperf: 'impf', future: 'fut', fut: 'fut', perfect: 'perf', perf: 'perf', pluperfect: 'plupf', plupf: 'plupf', plup: 'plupf', 'future perfect': 'futperf', futperf: 'futperf', 'fut perf': 'futperf' },
  mood: { indicative: 'ind', ind: 'ind', indic: 'ind', subjunctive: 'subj', subj: 'subj', subjunct: 'subj', imperative: 'imper', imper: 'imper', infinitive: 'inf', inf: 'inf', participle: 'ptc', ptc: 'ptc', gerund: 'gerund', gerundive: 'gerundive', supine: 'supine' },
  voice: { active: 'act', act: 'act', passive: 'pass', pass: 'pass', deponent: 'dep', dep: 'dep' },
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
const keyRe = (k) => new RegExp(`(^|[^a-z])${normaliseAnswer(k).replace(/\s+/g, '\\s+')}([^a-z]|$)`);
/**
 * A typed function ("indirect object", "purpose") against a construction
 * item: right when it names one of the accepted phrases and none of the
 * confusable ones; `confused` = the confusable skill it named instead. Pure.
 */
export function matchFunction(typed, expect) {
  const t = normaliseAnswer(typed);
  if (!t) return { correct: false, confused: null };
  const hit = (expect?.accept || []).some((k) => keyRe(k).test(t));
  let confused = null;
  for (const [k, skill] of Object.entries(expect?.reject || {})) if (keyRe(k).test(t)) { confused = skill; break; }
  return { correct: hit && !confused, confused };
}

/* ---------------------------------------------------------- pool */
/**
 * Used item keys per skill/kind so nothing repeats until the pool is
 * exhausted (localStorage-backed; any getItem/setItem object). `choose` draws
 * from the *whole* key list: the unused keys first, and among those the
 * preferred tiers in order (gold, this week, nouns, short sentences); the
 * used-set resets only when every key has been drawn (`wrapped`).
 */
export function createPool(storage, key = 'l103.grammar.used') {
  let data = {};
  try { data = JSON.parse(storage?.getItem?.(key) || '{}') || {}; } catch { data = {}; }
  const save = () => { try { storage?.setItem?.(key, JSON.stringify(data)); } catch { /* private mode */ } };
  return {
    used(skill, kind) { return new Set(data[`${skill}|${kind}`] ?? []); },
    /** Pick from `keys` one not used yet, preferring the first non-empty `tiers` subset; when every key has been used the pool starts over. Returns the key (see `chooseInfo` for the wrap flag). */
    choose(skill, kind, keys, rand = Math.random, tiers = []) { return this.chooseInfo(skill, kind, keys, rand, tiers)?.key ?? null; },
    /**
     * `want` asks for one exact key back — a redo playing an item the learner
     * missed (GRAMMAR-CONTRACT.md "Redo what was wrong"). The pool hands it
     * over when the key is still in `keys`, marks it used like any other draw,
     * and answers **null** when it has gone (the sentence left the library, the
     * deck changed): the caller then drops the slot quietly rather than
     * substituting a different item under the same name.
     */
    chooseInfo(skill, kind, keys, rand = Math.random, tiers = [], want = null) {
      if (!keys.length) return null;
      const k = `${skill}|${kind}`;
      let used = new Set(data[k] ?? []);
      if (want != null) {
        if (!keys.includes(want)) return null;
        used.add(want);
        data[k] = [...used];
        save();
        return { key: want, wrapped: false, left: keys.filter((x) => !used.has(x)).length, wanted: true };
      }
      let fresh = keys.filter((x) => !used.has(x));
      let wrapped = false;
      if (!fresh.length) { used = new Set(); fresh = keys; wrapped = true; }
      let from = fresh;
      for (const tier of tiers) { const sub = fresh.filter((x) => tier.has(x)); if (sub.length) { from = sub; break; } }
      const pick = from[Math.floor(rand() * from.length)];
      used.add(pick);
      data[k] = [...used];
      save();
      return { key: pick, wrapped, left: fresh.length - 1 };
    },
    reset(skill = null) { if (skill == null) data = {}; else for (const k of Object.keys(data)) if (k.startsWith(`${skill}|`)) delete data[k]; save(); },
  };
}

/* ---------------------------------------------------- patterns */
/** skills.json patterns are Python regexes with a leading (?i); JS takes the flag instead. Bad ones are skipped. Pure. */
export function compilePatterns(patterns) {
  const out = [];
  for (const p of patterns || []) {
    if (typeof p !== 'string') continue;
    const src = p.replace(/^\(\?i\)/, '');
    try { out.push(new RegExp(src, 'gi')); } catch { /* unsupported syntax: skip */ }
  }
  return out;
}
/** Macron-stripped copy of a sentence with a map from original offsets to stripped offsets (æ → ae shifts them). Pure. */
export function strippedText(la) {
  let s = '';
  const map = new Array(la.length + 1);
  for (let i = 0; i < la.length; i++) { map[i] = s.length; s += stripMacrons(la[i]); }
  map[la.length] = s.length;
  return { text: s, map };
}
/** The spans [start, end) of `la` (stripped offsets) that the patterns match. Pure. */
export function patternSpans(la, regexes, stripped = strippedText(la)) {
  const spans = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped.text)) !== null) {
      if (m[0].length) spans.push([m.index, m.index + m[0].length]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return spans;
}
const inSpans = (spans, s, e) => spans.some(([a, b]) => s >= a && e <= b);

/* ---------------------------------------------------- candidates */
const weekOf = (id) => weekOfUnit(id);   // w07:… → 7; the review shelf's r07:… → 107 (sync.js)
const genderOk = (cellGender, g) => !cellGender || !g || cellGender === g || (cellGender === 'c' && (g === 'm' || g === 'f')) || (g === 'c' && (cellGender === 'm' || cellGender === 'f'));
/** The paradigm cells one parse names (mirrors paradigms.js keyMatches). Pure. */
export function cellsFor(table, p) {
  const out = [];
  if (!table || !p) return out;
  for (const sec of table.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
    const k = c?.key;
    if (!k || c.empty) continue;
    let ok = false;
    if (k.kind === 'nominal') {
      ok = !!p.case && (!p.mood || p.mood === 'ptc' || p.mood === 'gerundive') && p.case === k.case && (!p.number || !k.number || p.number === k.number) && genderOk(k.gender, p.gender)
        && (!k.degree || (p.degree || 'pos') === k.degree) && (k.degree || !p.degree || p.degree === 'pos') && (!k.mood || p.mood === k.mood) && (k.mood || !p.mood) && (!k.tense || !p.tense || p.tense === k.tense);
    } else if (k.kind === 'finite') ok = p.tense === k.tense && p.mood === k.mood && p.voice === k.voice && String(p.person) === String(k.person) && p.number === k.number;
    else if (k.kind === 'imper') ok = p.mood === 'imper' && p.voice === k.voice && p.number === k.number && (p.tense || 'pres') === k.tense && (!k.person || String(p.person) === String(k.person));
    else if (k.kind === 'inf') ok = p.mood === 'inf' && p.tense === k.tense && p.voice === k.voice;
    else if (k.kind === 'ptc') ok = p.mood === 'ptc' && p.tense === k.tense && p.voice === k.voice;
    else if (k.kind === 'gerundive') ok = p.mood === 'gerundive';
    else if (k.kind === 'gerund') ok = p.mood === 'gerund' && p.case === k.case;
    else if (k.kind === 'supine') ok = p.mood === 'supine' && p.case === k.case;
    if (ok) out.push(c);
  }
  return out;
}
const cellForms = (c) => [c.text, c.alt, ...String(c.text ?? '').split(' / ')].filter(Boolean).map((s) => String(s).replace(/\s+-a -um$/, '').replace(/\s+esse$/, '').replace(/\s+īrī$/, '').trim());
const VOC_CUE_RE = /(^|[\s"'“‘(])(ō|o|mī|mi)$/i;
// Words that are words, whatever Whitaker splits off them: never an enclitic target (itaque, quisque …), never a noun (sēcum = sē + cum).
const LEXICAL_QUE = new Set(['itaque', 'neque', 'quoque', 'undique', 'denique', 'utique', 'atque', 'absque', 'plerumque', 'ubique', 'usque', 'namque', 'quandoque', 'quisque', 'quaeque', 'quidque', 'quodque', 'quemque', 'quamque', 'cuique', 'cuiusque', 'quoque', 'quaque', 'quorumque', 'quarumque', 'quibusque', 'quosque', 'quasque', 'uterque', 'utraque', 'utrumque', 'utriusque', 'utrique', 'utrumque', 'utramque', 'utroque', 'utraque', 'quicumque', 'quaecumque', 'quodcumque', 'quandocumque', 'ubicumque', 'quotienscumque', 'quisquis', 'quidquid', 'quicquid']);
const NEVER_TARGET = new Set(['secum', 'mecum', 'tecum', 'nobiscum', 'vobiscum', 'quocum', 'quacum', 'quibuscum', 'quicum']);
const PREP_GOVERNS = (entry) => (entry?.pos === 'PREP' ? [entry.kind, ...(entry.parses || []).map((p) => p.governs)].filter((g) => g === 'abl' || g === 'acc') : []);

/**
 * Every word in `unit.la` whose dictionary parses satisfy the skill's
 * parse_filter. `ambiguous` — the word also reads as another value of the
 * skill's feature (puellae: genitive or dative; servīs: dative or ablative),
 * so only blank items may use it. `opts`: { paradigm (verifies readings
 * against the entry's own table), patterns (compiled; a token must sit in a
 * match), gold (spans [start, end, source] in unit offsets that count without
 * a pattern), lookup / tokens caches }. Pure given `lookup`.
 */
export function scanUnit(unit, skill, lookup, opts = {}) {
  // An any-of list of filters (the enclitics: [{enc:'que'},{enc:'ne'}]) is scanned filter by filter.
  if (Array.isArray(skill.parse_filter)) return skill.parse_filter.flatMap((f) => scanUnit(unit, { ...skill, parse_filter: f }, lookup, opts));
  const filter = skill.parse_filter;
  if (!filter || typeof filter !== 'object') return [];
  const key = featureKey(skill);
  // A construction is ambiguous through its form: the case (or tense) the filter names, not the function itself.
  const ak = key === 'construction' ? (filter.case ? 'case' : (filter.mood || filter.tense) ? 'tense' : null) : key;
  const la = String(unit.la ?? '');
  const toks = opts.tokens?.(la) ?? tokenize(la);
  const look = opts.lookup ?? lookup;
  const regexes = opts.patterns ?? [];
  const strippedLa = regexes.length ? (opts.stripped?.(la) ?? strippedText(la)) : null;
  const spans = regexes.length ? patternSpans(la, regexes, strippedLa) : null;
  const gold = opts.gold ?? [];
  const macronised = MACRON_RE.test(la);
  const words = toks.filter((t) => t.isWord);
  // Sentence-level cues, once per call: someone is addressed when a 2nd-person verb or an exclamation is about.
  const looked = new Map();
  const lookOf = (t) => { if (!looked.has(t.form)) looked.set(t.form, look(t.form)); return looked.get(t.form); };
  let second = /!/.test(la);
  if (!second) for (const t of words) { if (t.text.length < 2) continue; if ((lookOf(t)?.entries || []).some((e) => (e.pos === 'V' || e.pos === 'VPAR') && (e.parses || []).some((p) => String(p.person) === '2' || p.mood === 'imper'))) { second = true; break; } }
  const between = (a, b) => (a && b ? toks.filter((t) => !t.isWord && t.start >= a.end && t.end <= b.start).map((t) => t.text).join('') : '');
  const nominalReadings = (t) => (lookOf(t)?.entries || []).filter((e) => NOMINAL_POS.has(e.pos) && !e.enc).flatMap((e) => e.parses || []).filter((p) => p.case);
  const out = [];
  for (let wi = 0; wi < words.length; wi++) {
    const t = words[wi];
    if (t.text.length < 2) continue;
    const res = lookOf(t);
    const all = res?.entries || [];
    if (!all.length) continue;
    // The enclitic fallback strips -que from words that are words (quisque, itaque): never a target; nor is sē + cum a noun.
    if (NEVER_TARGET.has(t.form)) continue;
    if (all.some((e) => e.enc) && (LEXICAL_QUE.has(t.form) || all.some((e) => !e.enc && e.pos !== 'ENDING'))) { if (filter.enc) continue; }
    if (res.via === 'enclitic' && all.some((e) => e.pos === 'PRON' || e.pos === 'CONJ' || e.pos === 'ADV')) continue;
    const goldSpan = gold.find(([s, e]) => t.start >= s && t.end <= e) ?? null;
    if (spans && !goldSpan && !inSpans(spans, strippedLa.map[t.start], strippedLa.map[t.end])) continue;
    const entries = all.filter((e) => entryAllowed(e, filter));
    if (!entries.length) continue;
    // A form that reads as a noun *and* as a verb (īrī: Īris or īre) is left alone for every kind: the
    // dictionary's first entry is not always the sentence's, and a drill must never gloss a word wrongly.
    const classOf = (e) => (e.pos === 'V' ? 'verb' : e.pos === 'VPAR' ? null : NOMINAL_POS.has(e.pos) ? 'nominal' : 'other');
    const classes = new Set(all.filter((e) => e.pos !== 'ENDING' && !e.enc && e.pos !== 'PREP').map(classOf).filter(Boolean));
    if (classes.size > 1) continue;
    // What the sentence shows: a preposition governing the word, a vocative cue, the neighbours it could agree with.
    const prev = words[wi - 1], next = words[wi + 1];
    const beforeText = between(prev, t);
    const afterText = between(t, next);
    // A preposition governs the word after it and any nominal (or et / -que) run up to it: "in hortīs magnīs et pulchrīs".
    const governs = new Set();
    for (let j = wi - 1; j >= Math.max(0, wi - 4); j--) {
      const w = words[j];
      if (/[,.;:!?]/.test(between(w, words[j + 1]))) break;
      const es = lookOf(w)?.entries || [];
      const g = es.flatMap(PREP_GOVERNS);
      if (g.length) { for (const x of g) governs.add(x); break; }
      if (!es.some((e) => NOMINAL_POS.has(e.pos)) && w.form !== 'et') break;
    }
    const addressed = VOC_CUE_RE.test(la.slice(0, t.start).trimEnd()) || (/,/.test(beforeText) && /[,!]/.test(afterText)) || (wi === 0 && /^[,!]/.test(afterText.trim()));
    const vocOk = second || addressed;
    const neighbours = [prev && !/[,.;:!?]/.test(beforeText) ? prev : null, next && !/[,.;:!?]/.test(afterText) ? next : null].filter(Boolean);
    // A word standing *directly* after a word that is nothing but a preposition (in, ex — never cum or
    // post, which also read as a conjunction or an adverb) must be in a case that preposition governs.
    // An entry whose readings here are all other cases cannot account for the word, whatever its stem
    // happens to spell: "in Latiō" is not the nominative of a word `latiō lationis f` (QA B2).
    const prepOnly = (w) => { const es = (lookOf(w)?.entries || []).filter((x) => x.pos !== 'ENDING' && !x.enc); return es.length > 0 && es.every((x) => x.pos === 'PREP'); };
    const directGoverns = new Set(prev && !/[,.;:!?]/.test(beforeText) && prepOnly(prev) ? (lookOf(prev)?.entries || []).flatMap(PREP_GOVERNS) : []);
    /** The readings the entry's *own table* gives the printed word in a case the preposition governs. */
    const governedReadings = (e, table) => {
      const out = [];
      const norm = stripMacrons(t.text).toLowerCase();
      const exact = t.text.toLowerCase();
      for (const sec of table?.sections ?? []) for (const row of sec.rows ?? []) for (const c of row.cells ?? []) {
        const k = c?.key;
        if (!k || c.empty || k.kind !== 'nominal' || k.mood || !directGoverns.has(k.case)) continue;
        const forms = cellForms(c);
        if (!forms.some((f) => String(f).toLowerCase() === exact) && !(!macronised && forms.some((f) => stripMacrons(String(f)).toLowerCase() === norm))) continue;
        const p = { case: k.case, number: k.number, gender: k.gender ?? e.gender ?? undefined };
        if (k.degree) p.degree = k.degree;
        if (!out.some((q) => q.case === p.case && q.number === p.number && q.gender === p.gender && q.degree === p.degree)) out.push(p);
      }
      return out;
    };
    const trim = (e, parses) => {
      let ps = parses.filter((p) => p.case !== 'voc' || vocOk);
      if (governs.size && ps.some((p) => p.case && governs.has(p.case))) ps = ps.filter((p) => !p.case || governs.has(p.case));
      const table = opts.paradigm ? opts.paradigm(e) : null;
      // Whitaker's rows for a form can be thinner than the word (montēs: nominative and vocative, no
      // accusative). Where the preposition settles the case, the entry's own table has the last word:
      // it either spells the printed form in that case — and that reading replaces the rows — or it
      // cannot account for the word here at all and the entry is dropped (QA B2).
      if (directGoverns.size && NOMINAL_POS.has(e.pos) && ps.length && ps.every((p) => p.case && !directGoverns.has(p.case))) {
        ps = governedReadings(e, table);
        if (!ps.length) return [];
      }
      if (table) {
        const norm = stripMacrons(t.text).toLowerCase();
        const exact = t.text.toLowerCase();
        const verdict = ps.map((p) => { const cells = cellsFor(table, p); if (!cells.length) return 'unknown'; const forms = cells.flatMap(cellForms); if (forms.some((f) => f.toLowerCase() === exact)) return 'exact'; return forms.some((f) => stripMacrons(f).toLowerCase() === norm) ? 'loose' : 'no'; });
        const kept = verdict.filter((v) => v !== 'no');
        ps = ps.filter((p, i) => verdict[i] !== 'no');
        if (macronised && kept.includes('exact') && kept.includes('loose')) { const v2 = verdict.filter((v) => v !== 'no'); ps = ps.filter((p, i) => v2[i] !== 'loose'); }
      }
      if (NOMINAL_POS.has(e.pos) && new Set(ps.map((p) => p.case)).size > 1 && neighbours.length) {
        const shared = neighbours.flatMap(nominalReadings);
        const agree = ps.filter((p) => shared.some((q) => q.case === p.case && (!p.number || !q.number || q.number === p.number) && genderOk(q.gender, p.gender)));
        if (agree.length && agree.length < ps.length) ps = agree;
      }
      return ps;
    };
    // A word the dictionary holds as both a noun and an adjective (amīcus, Rōmānus, malum) is read as
    // the adjective only where the sentence shows the noun it agrees with: "vir amīcus" yes, "amīcus
    // meus" — whose only neighbour is itself an adjective — no. Without this an *adjective*-agreement
    // drill teaches that the subject noun of its sentence is an adjective (QA B2).
    const nounAlso = all.some((e) => e.pos === 'N' && !e.enc && trim(e, e.parses || []).length > 0);
    const nounNeighbourFor = (p) => neighbours.some((n) => (lookOf(n)?.entries || [])
      .filter((e2) => e2.pos === 'N' && !e2.enc).flatMap((e2) => e2.parses || [])
      .some((q) => q.case === p.case && (!p.number || !q.number || q.number === p.number) && genderOk(q.gender, p.gender)));
    let entry = null, parse = null, verified = false;
    const values = new Set();
    const nominalValues = new Map();   // N vs ADJ readings (Rōmānī): distinct classes when they disagree on the feature
    // A noun reading names the word better than an adjective's (Aemiliae: the name, not "Aemilian"); pronouns next.
    // A capitalised word in the sentence takes a capitalised headword first of all: Mārcō is Mārcus, not mārcēre.
    const capToken = /^[A-ZĀĒĪŌŪȲ]/.test(t.text);
    const named = (e) => (capToken && /^[A-ZĀĒĪŌŪȲ]/.test(String(e.lemma ?? '')) ? 0 : 1);
    const rank = (e) => (e.pos === 'N' ? 0 : e.pos === 'PRON' ? 1 : e.pos === 'V' || e.pos === 'VPAR' ? 2 : 3);
    for (const e of [...entries].sort((a, b) => named(a) - named(b) || rank(a) - rank(b))) {
      let ps = trim(e, e.parses || []);
      if (e.pos === 'ADJ' && nounAlso) ps = ps.filter(nounNeighbourFor);
      const table = opts.paradigm ? opts.paradigm(e) : null;
      const printed = t.text.toLowerCase();
      for (const p of ps) {
        const v = featureValue(p, key, e, skill);
        const av = ak === key ? v : featureValue(p, ak, e, skill);
        if (av) values.add(av);
        if (v && (e.pos === 'N' || e.pos === 'ADJ')) { if (!nominalValues.has(e.pos)) nominalValues.set(e.pos, new Set()); nominalValues.get(e.pos).add(v); }
        if (!entry && parseMatches(p, filter) && (!key || v)) {
          entry = e; parse = p;
          // Verified means the headword's own stem prints *this* word: the cells existing is not enough
          // (`latiō lationis f` has an ablative cell — but it spells lationē, not the book's Latiō).
          const forms = table ? cellsFor(table, p).flatMap(cellForms) : [];
          verified = forms.some((f) => String(f).toLowerCase() === printed)
            || (!macronised && forms.some((f) => stripMacrons(String(f)).toLowerCase() === stripMacrons(printed)));
        }
      }
    }
    if (!entry) continue;
    if (filter.pos == null && nominalValues.size === 2) { const [a, b] = [...nominalValues.values()]; if ([...a].some((v) => !b.has(v)) || [...b].some((v) => !a.has(v))) continue; }
    // Enclitic readings (-que) count only for an enclitic skill; glossary entries that are only endings never do.
    if (entry.pos === 'ENDING' || (filter.enc ? entry.enc !== filter.enc : !!entry.enc)) continue;
    out.push({ unit, token: t, index: wi, entry, parse, ambiguous: values.size > 1, values: [...values], ambKey: ak, value: featureValue(parse, key, entry, skill), gold: goldSpan?.[2] ?? null, verified });
  }
  return out;
}

/* ------------------------------------------------------ generator */
const shuffle = (arr, rand) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const SHORT_LA = 180;
const blankOut = (la, t) => `${la.slice(0, t.start)}___${la.slice(t.end)}`;
const meaningsOf = (la) => tokenize(la).filter((t) => t.isWord).map((t) => ({ text: t.text, form: t.form, start: t.start }));
const firstWord = (lemma) => String(lemma ?? '').split(/[\s,]/)[0];
const PARSE_WORD = { case: 'case', number: 'number', gender: 'gender', tense: 'tense', mood: 'mood', voice: 'voice', person: 'person', degree: 'degree' };
const joinWords = (ws) => (ws.length <= 1 ? ws.join('') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`);

/**
 * Sentence sources for the "gold" items: `gold.lessonUnits` (Map skill id →
 * [unit ids] from the lessons' example blocks) and `gold.highlights` (Map unit
 * id → [{ text, label }] from the reader's grammar-focus rows).
 */
export function createItems({ units = [], lookup, paradigm = null, skills, storage = null, rand = Math.random, gold = null }) {
  const skillMap = skills instanceof Map ? skills : new Map((skills?.skills ?? skills ?? []).map((s) => [s.id, s]));
  const pool = createPool(storage);
  const cache = new Map();   // skill id → candidates
  const unitList = units.map((u) => ({ ...u, week_n: u.week_n ?? weekOf(u.id) }));

  // Per-form / per-sentence memos: the same forms recur across 4 000 sentences, so a scan is filter checks, not lookups.
  const lookMemo = new Map();
  const look = (form) => { if (!lookMemo.has(form)) lookMemo.set(form, lookup(form)); return lookMemo.get(form); };
  const tokMemo = new Map();
  const toks = (la) => { if (!tokMemo.has(la)) tokMemo.set(la, tokenize(la)); return tokMemo.get(la); };
  const stripMemo = new Map();
  const stripped = (la) => { if (!stripMemo.has(la)) stripMemo.set(la, strippedText(la)); return stripMemo.get(la); };
  const tableMemo = new Map();
  function safeParadigm(entry, parse) { try { return paradigm ? paradigm(entry, parse ? [parse] : []) : null; } catch { return null; } }
  const plainTable = (entry) => { const k = entry?.lemma ?? ''; if (!tableMemo.has(k)) tableMemo.set(k, entry ? safeParadigm(entry, null) : null); return tableMemo.get(k); };
  const patMemo = new Map();
  const patternsOf = (skill) => { if (!patMemo.has(skill.id)) patMemo.set(skill.id, compilePatterns(skill.patterns)); return patMemo.get(skill.id); };
  const exclMemo = new Map();
  const excludesOf = (skill) => { if (!exclMemo.has(skill.id)) exclMemo.set(skill.id, compilePatterns(skill.exclude_patterns)); return exclMemo.get(skill.id); };
  const hlMemo = new Map();
  const hlRe = (skill) => { if (!hlMemo.has(skill.id)) { let re = null; try { re = skill.highlight_match ? new RegExp(skill.highlight_match.replace(/^\(\?i\)/, ''), 'i') : null; } catch { re = null; } hlMemo.set(skill.id, re); } return hlMemo.get(skill.id); };

  /** Gold spans for a unit: the whole sentence for a lesson example; the highlighted text for a matching grammar-focus row. */
  function goldSpans(unit, skill) {
    const out = [];
    if ((gold?.lessonUnits?.get?.(skill.id) || []).includes(unit.id)) out.push([0, unit.la.length, 'lesson']);
    const re = hlRe(skill);
    if (re) for (const h of gold?.highlights?.get?.(unit.id) || []) {
      if (!h?.text || !re.test(stripMacrons(String(h.label ?? '')))) continue;
      let at = unit.la.indexOf(h.text);
      if (at < 0) at = stripMacrons(unit.la).toLowerCase().indexOf(stripMacrons(h.text).toLowerCase());
      if (at >= 0) out.push([at, at + h.text.length, 'highlight']);
    }
    return out;
  }
  const scanOpts = (skill, unit) => ({ paradigm: paradigm ? plainTable : null, patterns: patternsOf(skill), gold: goldSpans(unit, skill), lookup: look, tokens: toks, stripped });
  /** A sentence a sibling construction owns (`exclude_patterns`: a result signal word before ut, a verb of commanding …) yields nothing for this skill unless it is gold. */
  const excluded = (unit, skill) => { const ex = excludesOf(skill); if (!ex.length) return false; const st = stripped(unit.la); return ex.some((re) => { re.lastIndex = 0; return re.test(st.text); }); };
  const scan = (unit, skill) => { const g = goldSpans(unit, skill); if (!g.length && excluded(unit, skill)) return []; return scanUnit(unit, skill, look, { ...scanOpts(skill, unit), gold: g }); };

  function candidates(skillId) {
    if (!cache.has(skillId)) {
      const skill = skillMap.get(skillId);
      const out = [];
      if (skill && skill.parse_filter) for (const u of unitList) if (typeof u.la === 'string' && u.la) out.push(...scan(u, skill));
      cache.set(skillId, out);
    }
    return cache.get(skillId);
  }
  const drillable = (skillId) => { const s = skillMap.get(skillId); return !!s?.parse_filter && candidates(skillId).length > 0; };

  const key = (skill) => featureKey(skill);
  const labelOf = (k, v, skill = null) => featureLabel(k, v, { skills: skillMap, skill });
  const filterOf = (skill) => (Array.isArray(skill.parse_filter) ? skill.parse_filter[0] : (skill.parse_filter || {}));
  /** The one value a skill stands for in its feature (dative-indirect-object → 'dat'; purpose-clause → its id), or null when it names none. */
  const singleValue = (skill, k) => {
    const f = filterOf(skill);
    if (k === 'construction') return skill.id;
    if (k === 'case' || k === 'gender' || k === 'number' || k === 'degree') return typeof f[k] === 'string' ? f[k] : null;
    if (k === 'voice') return f.deponent === true ? 'dep' : (typeof f.voice === 'string' ? f.voice : null);
    if (k === 'person') return typeof f.number === 'string' && f.person != null && !Array.isArray(f.person) ? `${f.person} ${f.number}` : null;
    if (k === 'form') return typeof f.enc === 'string' ? f.enc : null;
    if (TM_KEY(k)) {
      if (typeof f.mood === 'string' && f.mood === 'imper') return `${typeof f.tense === 'string' ? f.tense : 'pres'} imper`;
      if (typeof f.tense === 'string' && typeof f.mood === 'string') return `${f.tense} ${f.mood}`;
      return typeof f.mood === 'string' && !f.tense && MOOD_ONLY_LABEL[f.mood] ? f.mood : null;
    }
    return null;
  };
  const caseOf = (skill) => { const f = filterOf(skill); return typeof f.case === 'string' ? f.case : null; };
  const constructionSkills = () => [...skillMap.values()].filter((s) => key(s) === 'construction' && s.parse_filter);
  const nonFinite = (v) => /\b(inf|ptc|imper)$/.test(String(v)) || !!MOOD_ONLY_LABEL[v];
  /** The confusable values (with the skill each names) and the fillers a recognise item can offer against `own`. */
  const distractorValues = (skill, own, c = null, { sameCaseOnly = false } = {}) => {
    const k = key(skill);
    const filter = filterOf(skill);
    const cs0 = caseOf(skill);
    const conf = (skill.confusable_with || []).map((id) => skillMap.get(id)).filter((s) => s && key(s) === k && !(sameCaseOnly && cs0 && caseOf(s) !== cs0))
      .map((s) => ({ skill: s.id, value: singleValue(s, k) }))
      .filter((d) => d.value && d.value !== own && !valueFits(d.value, filter, k));
    const seen = new Set(conf.map((x) => x.value));
    let fillers = [];
    if (k === 'construction') {
      const cs = caseOf(skill);
      const others = constructionSkills().filter((s) => s.id !== skill.id && !seen.has(s.id) && !(sameCaseOnly && cs && caseOf(s) !== cs));
      const sameCase = others.filter((s) => cs && caseOf(s) === cs);
      const sameCat = others.filter((s) => !sameCase.includes(s) && s.category === skill.category && (cs ? caseOf(s) != null : caseOf(s) == null));
      fillers = [...shuffle(sameCase, rand), ...shuffle(sameCat, rand)].map((s) => ({ skill: s.id, value: s.id }));
    } else {
      let poolValues = FILLERS[k] ?? TM_FILLERS;
      if (TM_KEY(k)) poolValues = nonFinite(own) ? [...NONFINITE_FILLERS, ...TM_FILLERS] : TM_FILLERS;
      if (k === 'voice' && c && c.entry?.pos !== 'V' && c.entry?.pos !== 'VPAR') poolValues = ['act', 'pass'];
      fillers = shuffle(poolValues.filter((v) => v !== own && !seen.has(v) && !valueFits(v, filter, k)), rand).map((value) => ({ skill: null, value }));
    }
    return { own, conf: conf.filter((x, i) => conf.findIndex((y) => y.value === x.value) === i), fillers };
  };
  /** Choices for a recognise / parse item: the confusables first, shuffled with fillers; null when fewer than two real choices exist. */
  const choicesFor = (skill, c, k, n = 4, opts = {}) => {
    const { conf, fillers } = distractorValues(skill, c.value, c, opts);
    const options = [...shuffle(conf, rand), ...fillers].slice(0, n - 1);
    if (!options.length) return null;
    return shuffle([{ value: c.value, correct: true, skill: skill.id }, ...options.map((d) => ({ value: d.value, correct: false, skill: d.skill }))], rand)
      .map((ch) => ({ ...ch, label: labelOf(k, ch.value, skill).name, plain: labelOf(k, ch.value, skill).plain }));
  };

  const base = (skill, kind, stage, c, scope = null) => ({
    skill: skill.id, kind, stage, unit_id: c?.unit?.id ?? null, week_n: c?.unit?.week_n ?? null, scope,
    target: c ? { text: c.token.text, form: c.token.form, start: c.token.start, end: c.token.end, index: c.index } : null,
    entry: c?.entry ?? null, parse: c?.parse ?? null,
    meanings: c ? meaningsOf(c.unit.la) : [],
    gold: c?.gold ?? null,
  });
  /** How a wrong answer given another way (a tapped word, a typed case, a typed form) maps back to a confusable skill. */
  const confuseMap = (skill, c, k) => {
    const out = { values: {}, indexes: {}, forms: {} };
    const { conf } = distractorValues(skill, c?.value ?? null, c);
    for (const d of conf) if (d.skill) out.values[d.value] = d.skill;
    if (c) {
      for (const id of skill.confusable_with || []) {
        const s = skillMap.get(id);
        if (!s?.parse_filter) continue;
        for (const x of scan(c.unit, s)) if (x.index !== c.index && !out.indexes[x.index]) out.indexes[x.index] = id;
      }
      // Other cells of the target's own paradigm → the confusable skill that stands for that case / tense (a typed or chart form maps to it).
      const table = plainTable(c.entry);
      const ak = c.ambKey ?? k;
      const skillForValue = (v) => {
        if (k === 'construction') return (skill.confusable_with || []).map((id) => skillMap.get(id)).find((s) => s && key(s) === 'construction' && (ak === 'case' ? caseOf(s) === v : singleValue(s, 'tense') === v))?.id ?? null;
        return out.values[v] ?? null;
      };
      if (table && (ak === 'case' || TM_KEY(ak))) for (const sec of table.sections ?? []) for (const row of sec.rows ?? []) for (const cell of row.cells ?? []) {
        if (!cell?.key || cell.empty) continue;
        const v = cell.key.kind === 'nominal' ? cell.key.case : cell.key.kind === 'finite' ? `${cell.key.tense} ${cell.key.mood}` : null;
        const own = ak === k ? c.value : featureValue(c.parse, ak, c.entry, skill);
        const sid = v && v !== own ? skillForValue(v) : null;
        if (sid) for (const f of cellForms(cell)) out.forms[normaliseAnswer(f)] = sid;
      }
    }
    return out;
  };
  const feedbackFor = (skill, c, k) => {
    const lab = c && c.value ? labelOf(k, c.value, skill) : { name: skill.title, plain: skill.plain, full: skill.plain };
    const table = paradigm && c?.entry ? safeParadigm(c.entry, c.parse) : null;
    const readings = c?.ambiguous ? c.values.map((v) => labelOf(c.ambKey ?? k, v, skill).name).join(' or ') : null;
    const what = k === 'construction' && c?.parse?.case && c.entry.pos !== 'V' ? `${CASE_LABEL[c.parse.case]?.name ?? c.parse.case}, ${lab.name}` : lab.name;
    return {
      short: c ? (c.ambiguous ? `${c.token.text} is the form of ${c.entry.lemma} that fits; the ending could be ${readings} — the sentence decides.` : `${c.token.text} is ${what} — ${lab.plain} — from ${c.entry.lemma}.`) : `${lab.full}.`,
      term: skill.plain, label: lab, table, lemma: c?.entry?.lemma ?? null, sense: c ? headSense(c.entry) : null,
      paradigm: { key: skill.paradigms?.[0] ?? null, highlight: Array.isArray(skill.parse_filter) ? null : skill.parse_filter },
    };
  };

  const pickCandidate = (skill, kind, { unambiguous, currentWeek, currentWeekN, chapter = null, where = null, itemKey = null }) => {
    let pool_ = candidates(skill.id);
    if (where) pool_ = pool_.filter(where);
    if (unambiguous) pool_ = pool_.filter((c) => !c.ambiguous);
    else { const clear = pool_.filter((c) => !c.ambiguous); if (clear.length >= 5) pool_ = clear; }   // blank: forms the sentence reads one way, while there are enough
    if (!pool_.length) return null;
    // A chapter scopes the draw before anything else orders it: its own sentences, else the chapters at or
    // before it, else the wider library with the item saying so (chapter.js "the sentence's chapter"). A redo
    // names one exact item, and that item is what it is — the scope would only make it undrawable.
    const scoped = itemKey != null ? { list: pool_, scope: null, counts: null } : scopeByChapter(pool_, chapter);
    pool_ = scoped.list;
    const keyOf = (c) => `${kind}:${c.unit.id}:${c.token.form}:${c.index}`;
    const keys = pool_.map(keyOf);
    const tiers = [];
    tiers.push(new Set(pool_.filter((c) => c.gold).map(keyOf)));   // the lesson's own examples and the labelled highlights first
    // The ≈ 20 % current-week slots draw from a course week only (n ≤ 14): a shelf chapter being read is never 'this week'.
    if (currentWeek && currentWeekN != null && !isShelfWeek(currentWeekN)) tiers.push(new Set(pool_.filter((c) => c.unit.week_n === currentWeekN).map(keyOf)));
    // A function skill drills nouns before pronouns (mihi / tibi teach little about the receiver of a gift), while enough nouns exist.
    if (key(skill) === 'construction' && caseOf(skill)) { const nouns = pool_.filter((c) => c.entry.pos === 'N'); if (nouns.length >= 5) tiers.push(new Set(nouns.map(keyOf))); }
    // Shorter sentences first: a drill reads one sentence, not a paragraph (long ones come once the short ones are spent).
    tiers.push(new Set(pool_.filter((c) => c.unit.la.length <= SHORT_LA).map(keyOf)));
    const got = pool.chooseInfo(skill.id, kind, keys, rand, tiers.filter((t) => t.size), itemKey);
    if (!got) return null;
    const c = pool_[keys.indexOf(got.key)];
    return { c, key: got.key, wrapped: got.wrapped, scope: scopeNote(chapter, scoped.scope, c) };
  };

  const recogniseQuestion = (skill, c, k) => {
    const X = c.token.text;
    if (k === 'construction') {
      if (c.parse?.case && (c.entry.pos === 'N' || c.entry.pos === 'PRON' || c.entry.pos === 'ADJ')) return `What is this ${CASE_LABEL[c.parse.case]?.name ?? c.parse.case} (${X}) doing here?`;
      if (c.parse?.mood === 'subj') return `${X} is subjunctive: what kind of clause is it in?`;
      return `What is ${X} doing here?`;
    }
    return { case: `Which case is ${X} here?`, gender: `Which gender is ${X}?`, number: `Which number is ${X} here?`, voice: `Which voice is ${X} here?`, person: `Which person and number is ${X}?`, degree: `Which degree is ${X}?`, form: skill.id === 'principal-parts' ? `Which stem is ${X} built on?` : `What does the ending of ${X} do here?` }[k] ?? `Which tense and mood is ${X} here?`;
  };

  function recognise(skill, stage, opts) {
    const k = key(skill);
    if (!k) return null;
    // A redo asks for one exact item back, and a recognise item has two shapes over one candidate: the
    // `recognise-tap:` key is the tap-the-word variant, the plain `recognise:` key the multiple choice.
    // The prefix therefore settles `tap` as well as the candidate, so the item comes back as it was.
    const wantTap = opts.itemKey == null ? null : /^recognise-tap:/.test(String(opts.itemKey));
    const got = pickCandidate(skill, 'recognise', { unambiguous: true, ...opts, itemKey: opts.itemKey == null ? null : String(opts.itemKey).replace(/^recognise-tap:/, 'recognise:') });
    if (!got) return null;
    const { c, key: itemKey, wrapped, scope } = got;
    // "What is this dative doing?" offers the dative's other jobs; a construction without a case offers the other clause types.
    const choices = choicesFor(skill, c, k, 4, { sameCaseOnly: k === 'construction' }) ?? choicesFor(skill, c, k);
    if (!choices || choices.length < 2) return null;   // one button is no question
    const lab = labelOf(k, c.value, skill);
    const confuse = confuseMap(skill, c, k);
    // Every other recognise item is "tap the word": the sentence's words are the
    // choices, and any word the skill's filter fits is right (accept = word indexes).
    if (wantTap ?? (opts.tap ?? rand() < 0.5)) {
      const accept = candidates(skill.id).filter((x) => x.unit.id === c.unit.id && x.value === c.value && !x.ambiguous).map((x) => x.index);
      return { ...base(skill, 'recognise', stage, c, scope), key: itemKey.replace(/^recognise:/, 'recognise-tap:'), input: 'tap', repeat: wrapped,
        prompt: { la: c.unit.la, question: `Tap the word that is ${lab.name} — ${lab.plain}`, gloss: null, hint: skill.summary },
        answer: [c.token.text], accept: accept.length ? accept : [c.index], choices: null, confuse, feedback: feedbackFor(skill, c, k) };
    }
    return { ...base(skill, 'recognise', stage, c, scope), key: itemKey, input: 'choice', repeat: wrapped,
      prompt: { la: c.unit.la, question: recogniseQuestion(skill, c, k), gloss: lemmaGloss(c.entry), hint: skill.summary },
      answer: [c.value], choices, confuse, feedback: feedbackFor(skill, c, k) };
  }

  /** What a typed parse must name, per feature: exactly what the question asks. */
  const parseExpect = (skill, c) => {
    const p = c.parse;
    const k = key(skill);
    const dep = isDeponent(c.entry);
    const nominal = { case: p.case, number: p.number, gender: p.gender };
    if (k === 'case' || k === 'number') return { values: nominal, required: p.number ? ['case', 'number'] : ['case'] };
    if (k === 'gender') return { values: nominal, required: p.number ? ['gender', 'case', 'number'] : ['gender', 'case'] };
    if (k === 'degree') return { values: { degree: p.degree || 'pos', case: p.case, number: p.number, gender: p.gender }, required: p.case ? ['degree', 'case', 'number'] : ['degree'] };
    if (p.mood === 'ptc' || p.mood === 'gerundive') return { values: { tense: p.tense, mood: p.mood, voice: dep ? undefined : p.voice, case: p.case, number: p.number, gender: p.gender }, required: [...(p.tense ? ['tense'] : []), ...(p.voice && !dep ? ['voice'] : []), 'case', ...(p.number ? ['number'] : []), ...(p.gender ? ['gender'] : [])] };
    if (p.mood === 'gerund' || p.mood === 'supine') return { values: { mood: p.mood, case: p.case }, required: ['mood', ...(p.case ? ['case'] : [])] };
    if (p.mood === 'inf') return { values: { tense: p.tense, mood: p.mood, voice: dep ? undefined : p.voice }, required: ['tense', 'mood', ...(p.voice && !dep ? ['voice'] : [])] };
    const finite = { tense: p.tense, mood: p.mood, person: p.person != null ? String(p.person) : undefined, number: p.number, voice: dep ? undefined : p.voice };
    if (k === 'person') return { values: finite, required: ['person', 'number'] };
    if (k === 'voice') return { values: finite, required: dep ? ['tense', 'mood'] : ['voice', 'tense', 'mood'] };
    if (p.mood === 'imper') return { values: finite, required: ['mood', ...(p.number ? ['number'] : [])] };
    return { values: finite, required: ['tense', 'mood'] };
  };
  const parseName = (skill, p, entry = null) => {
    const k = key(skill);
    const cn = (x) => `${CASE_LABEL[x.case]?.name ?? x.case}${x.number ? ` ${NUMBER_LABEL[x.number]?.name ?? x.number}` : ''}`;
    if (k === 'gender') return `${GENDER_LABEL[p.gender]?.name ?? p.gender ?? ''}${p.case ? `, ${cn(p)}` : ''}`.trim();
    if (k === 'case' || k === 'number') return cn(p);
    if (k === 'degree') return `${DEGREE_LABEL[p.degree || 'pos']?.name ?? p.degree}${p.case ? `, ${cn(p)}` : ''}`.trim();
    if (p.mood === 'ptc' || p.mood === 'gerundive') return `${labelOf('tense', featureValue(p, 'tense'), skill).name}${p.voice && !isDeponent(entry) ? ` ${VOICE_LABEL[p.voice]?.name ?? p.voice}` : ''}${p.case ? `, ${cn(p)}${p.gender ? ` ${GENDER_LABEL[p.gender]?.name ?? ''}` : ''}` : ''}`.trim();
    if (p.mood === 'gerund' || p.mood === 'supine') return `${p.mood}${p.case ? `, ${CASE_LABEL[p.case]?.name ?? p.case}` : ''}`;
    if (p.mood === 'inf') return `${TENSE_LABEL[p.tense] ?? p.tense} infinitive${p.voice && !isDeponent(entry) ? ` ${VOICE_LABEL[p.voice]?.name}` : ''}`;
    if (p.mood === 'imper') return `imperative${p.number ? ` ${NUMBER_LABEL[p.number]?.name}` : ''}`;
    const who = p.person ? `, ${PERSON_WORD[p.person]} ${NUMBER_LABEL[p.number]?.name ?? ''}` : '';
    if (k === 'person') return `${PERSON_WORD[p.person] ?? p.person} ${NUMBER_LABEL[p.number]?.name ?? p.number ?? ''}`.trim();
    if (k === 'voice') return `${isDeponent(entry) ? 'deponent' : VOICE_LABEL[p.voice]?.name ?? ''} ${TENSE_LABEL[p.tense] ?? p.tense} ${MOOD_LABEL[p.mood] ?? p.mood}${who}`.trim();
    return `${TENSE_LABEL[p.tense] ?? p.tense} ${MOOD_LABEL[p.mood] ?? p.mood}${who}`.trim();
  };
  const parseQuestion = (skill, c, expect) => {
    const p = c.parse;
    const req = expect.required.map((r) => PARSE_WORD[r]).filter(Boolean);
    const tail = p.mood === 'ptc' ? ' (it is a participle)' : p.mood === 'gerundive' ? ' (it is a gerundive)' : '';
    return `Parse ${c.token.text}: ${joinWords(req)}${tail}`;
  };
  const parsePlaceholder = (expect) => {
    const r = expect.required;
    if (r.includes('degree')) return 'e.g. comparative, nominative singular';
    if (r.includes('gender') && r.includes('tense')) return 'e.g. perfect passive, accusative singular feminine';
    if (r.includes('gender')) return 'e.g. feminine, nominative singular';
    if (r.includes('person')) return 'e.g. 1st person plural';
    if (r.includes('voice')) return 'e.g. passive, present indicative';
    if (r[0] === 'mood') return 'e.g. gerund, accusative';
    if (r.includes('tense')) return 'e.g. imperfect subjunctive';
    return 'e.g. dative singular';
  };
  const functionKeys = (s) => { const f = s?.function || s?.title || s?.id || ''; const head = f.split(' (')[0]; return [...new Set([head, ...(s?.function_keys || [])].map((x) => normaliseAnswer(x)).filter(Boolean))]; };

  function parseItem(skill, stage, opts) {
    const k = key(skill);
    if (!k) return null;
    const got = pickCandidate(skill, 'parse', { unambiguous: true, ...opts });
    if (!got) return null;
    const { c, key: itemKey, wrapped, scope } = got;
    const confuse = confuseMap(skill, c, k);
    if (k === 'construction') {
      // A construction is parsed by its job: "indirect object", "purpose" — choices at stage 1, typed from stage 2.
      const choices = choicesFor(skill, c, k);
      if (!choices || choices.length < 2) return null;
      const caseName = c.parse?.case && c.entry.pos !== 'V' ? CASE_LABEL[c.parse.case]?.name ?? c.parse.case : null;
      const withCase = (ch) => ({ ...ch, label: caseName ? `${CASE_LABEL[caseOf(skillMap.get(ch.value)) ?? c.parse.case]?.name ?? caseName} — ${ch.label}` : ch.label });
      const reject = {};
      for (const ch of choices) if (!ch.correct && ch.skill) for (const kw of functionKeys(skillMap.get(ch.skill))) reject[kw] = ch.skill;
      const expect = { kind: 'function', accept: functionKeys(skill), reject };
      const item = { ...base(skill, 'parse', stage, c, scope), key: itemKey, input: stage >= 2 ? 'type' : 'choice', repeat: wrapped,
        prompt: { la: c.unit.la, question: caseName ? (stage >= 2 ? `${c.token.text} is ${caseName}: what is it doing here? (its function)` : `${c.token.text}: which case, and what is it doing here?`) : `What is ${c.token.text} doing here? (the construction)`, gloss: lemmaGloss(c.entry), hint: skill.summary, placeholder: 'e.g. indirect object' },
        answer: [labelOf(k, c.value, skill).name], expect, choices: null, confuse, feedback: feedbackFor(skill, c, k) };
      if (item.input === 'choice') { item.choices = choices.map(withCase); item.answer = [c.value]; }
      return item;
    }
    const expect = parseExpect(skill, c);
    const canonical = parseName(skill, c.parse, c.entry);
    const item = { ...base(skill, 'parse', stage, c, scope), key: itemKey, input: stage >= 2 ? 'type' : 'choice', repeat: wrapped,
      prompt: { la: c.unit.la, question: parseQuestion(skill, c, expect), gloss: lemmaGloss(c.entry), hint: skill.summary, placeholder: parsePlaceholder(expect) },
      answer: [canonical], expect, expectKey: k, choices: null, confuse, feedback: feedbackFor(skill, c, k) };
    if (item.input === 'choice') {
      const { conf, fillers } = distractorValues(skill, c.value, c);
      const others = [...shuffle(conf, rand), ...fillers].slice(0, 2);
      const p = c.parse;
      const alt = p.number ? { ...p, number: p.number === 'sg' ? 'pl' : 'sg' } : null;
      const withValue = (d) => {
        if (k === 'case') return { ...p, case: d.value };
        if (k === 'degree') return { ...p, degree: d.value };
        if (k === 'gender') return { ...p, gender: d.value };
        if (k === 'number') return { ...p, number: d.value };
        if (k === 'voice') return { ...p, voice: d.value === 'dep' ? 'pass' : d.value };
        if (k === 'person') { const [pe, nu] = d.value.split(' '); return { ...p, person: pe, number: nu }; }
        const [t, m] = d.value.split(' ');
        return m ? { ...p, tense: t, mood: m } : { ...p, mood: t, tense: undefined };
      };
      const entryFor = (d) => (k === 'voice' && d.value === 'dep' ? { ...c.entry, kind: 'dep' } : (k === 'voice' ? { ...c.entry, kind: null } : c.entry));
      const opts_ = [
        { value: canonical, correct: true, skill: skill.id },
        ...(alt ? [{ value: parseName(skill, alt, c.entry), correct: false, skill: null }] : []),
        ...others.map((d) => ({ value: parseName(skill, withValue(d), entryFor(d)), correct: false, skill: d.skill })),
      ];
      const seen = new Set();
      item.choices = shuffle(opts_.filter((o) => o.value && !seen.has(o.value) && seen.add(o.value)), rand).map((o) => ({ ...o, label: o.value }));
      if (item.choices.length < 2) return null;
      item.answer = [canonical];
    }
    return item;
  }

  function blank(skill, stage, opts) {
    const k = key(skill);
    // The item prints the dictionary line ("the right form of soror") and hides the inflected one, so
    // nothing it shows may spell the form it wants back (QA-FINAL B1). Three ways it could, all of
    // them out: the word *is* its own dictionary form (soror); the line carries it anyway, in the
    // citation (sequor, sequī, *secūtus* sum) or in the meaning (nox noctis f — night; prīmā
    // *nocte*…); or the sentence prints the same word a second time, outside the blank.
    const noGiveaway = (c) => {
      const as = [c.token.text, stripMacrons(c.token.text)];
      return !spellsAnswer(lemmaGloss(c.entry), as) && !spellsAnswer(blankOut(c.unit.la, c.token), as);
    };
    const got = pickCandidate(skill, 'blank', { unambiguous: false, ...opts, where: noGiveaway });
    if (!got) return null;
    const { c, key: itemKey, wrapped, scope } = got;
    const answer = [c.token.text, stripMacrons(c.token.text)];
    const lab = c.value ? labelOf(k, c.value, skill) : { name: skill.title, plain: skill.plain };
    const item = { ...base(skill, 'blank', stage, c, scope), key: itemKey, input: stage >= 2 ? 'type' : 'choice', repeat: wrapped,
      prompt: { la: blankOut(c.unit.la, c.token), question: `Fill the blank with the right form of ${firstWord(c.entry.lemma)}`, gloss: lemmaGloss(c.entry), hint: `${lab.name} — ${lab.plain}` },
      answer, choices: null, confuse: confuseMap(skill, c, k), feedback: feedbackFor(skill, c, k) };
    if (item.input === 'choice') {
      const table = plainTable(c.entry);
      const forms = new Set();
      for (const s of table?.sections ?? []) for (const r of s.rows) for (const cell of r.cells) if (cell && !cell.empty && cell.text && cell.text !== '—') forms.add(cell.text.split(' / ')[0]);
      const norm = normaliseAnswer(c.token.text);
      const others = shuffle([...forms].filter((f) => normaliseAnswer(f) !== norm), rand).slice(0, 3);
      if (!others.length) return null;
      item.choices = shuffle([{ value: c.token.text, correct: true }, ...others.map((f) => ({ value: f, correct: false }))], rand).map((o) => ({ ...o, label: o.value, skill: null }));
    }
    return item;
  }

  /** True when a paradigm cell is one the skill drills (nominal, finite and the non-finite tables alike). */
  const cellMatches = (cell, filter, k) => {
    const kk = cell?.key;
    if (!kk || cell.empty || !filter) return false;
    const tm = TM_KEY(k) || k === 'voice' || k === 'person';
    if (kk.kind === 'nominal') {
      if (tm || kk.mood) return false;   // participle cells inside a verb table are not the verb's finite forms
      if (filter.case == null && filter.gender == null && filter.degree == null && filter.number == null && !(filter.pos === 'N' || filter.pos === 'ADJ' || filter.pos === 'PRON' || filter.h || filter.decl)) return false;
      if (filter.case == null && kk.case === 'voc') return false;   // a declension skill drills the cases in use, not the address form
      return valueIn(kk.case, filter.case) && valueIn(kk.number, filter.number) && (filter.degree == null || valueIn(kk.degree ?? 'pos', filter.degree)) && (filter.gender == null || !kk.gender || valueIn(kk.gender, filter.gender));
    }
    if (!tm && k !== 'construction') return false;
    if (kk.kind === 'finite') return (filter.mood == null || valueIn('ind', filter.mood) || valueIn('subj', filter.mood)) && valueIn(kk.tense, filter.tense) && valueIn(kk.mood, filter.mood) && valueIn(kk.voice, filter.voice) && valueIn(kk.person, filter.person);
    if (kk.kind === 'inf') return filter.mood != null && valueIn('inf', filter.mood) && valueIn(kk.tense, filter.tense) && valueIn(kk.voice, filter.voice);
    if (kk.kind === 'imper') return filter.mood != null && valueIn('imper', filter.mood) && valueIn(kk.tense, filter.tense) && valueIn(kk.voice, filter.voice) && valueIn(kk.number, filter.number);
    if (kk.kind === 'ptc') return filter.mood != null && valueIn('ptc', filter.mood) && valueIn(kk.tense, filter.tense) && valueIn(kk.voice, filter.voice);
    if (kk.kind === 'gerundive' || kk.kind === 'gerund' || kk.kind === 'supine') return filter.mood != null && valueIn(kk.kind, filter.mood) && (kk.case == null || valueIn(kk.case, filter.case));
    return false;
  };
  function chart(skill, stage, opts, { full = false } = {}) {
    if (!paradigm) return null;
    const k = key(skill);
    const filter = filterOf(skill);
    // The lemmas the skill's sentences use, one paradigm each; the pool is keyed by lemma + cell.
    // A chart has no sentence, but its word came from one, so the chapter scopes which words it may ask about.
    const scoped = opts.itemKey != null ? { list: candidates(skill.id), scope: null } : scopeByChapter(candidates(skill.id), opts.chapter ?? null);
    const seen = new Map();
    for (const c of scoped.list) if (!seen.has(c.entry.h)) seen.set(c.entry.h, c);
    const entries = [...seen.values()];
    if (!entries.length) return null;
    let keys = [];
    let spots = [];
    for (const c of entries) {
      const table = plainTable(c.entry);
      if (!table) continue;
      table.sections.forEach((s, si) => s.rows.forEach((r, ri) => r.cells.forEach((cell, ci) => {
        // A case skill drills the positive section of an adjective table; only a degree skill asks for the comparative or superlative.
        if (k !== 'degree' && table.sections.length > 1 && s.rows[0]?.cells[0]?.key?.kind === 'nominal' && (s.rows[0].cells[0].key.degree ?? 'pos') !== 'pos') return;
        if (cellMatches(cell, filter, k)) { keys.push(`chart:${c.entry.h}:${si}.${ri}.${ci}`); spots.push({ c, table, si, ri, ci }); }
      })));
    }
    if (!keys.length) return null;
    // The citation head is itself a cell of the table (cēna is the nominative singular of cēna;
    // possum is the first person of possum), and the question names the head: "Give the nominative
    // singular of cēna" answers itself — and so, in its own way, does "the present indicative, he /
    // she / it of eō", whose answer is *it*. Cells the question's own words spell are left out of the
    // pool, unless they are all the skill has: then a self-answering chart beats no chart at all.
    const answersOf = (sp) => { const cell = sp.table.sections[sp.si].rows[sp.ri].cells[sp.ci]; return [cell?.text, cell?.alt, ...String(cell?.text ?? '').split(' / ')].filter(Boolean); };
    const shownOf = (sp) => { const sec = sp.table.sections[sp.si]; return `${firstWord(sp.c.entry.lemma)} ${sec.title ?? ''} ${sec.rows[sp.ri].label ?? ''} ${sec.headers?.[sp.ci] ?? ''}`; };
    const open = spots.map((sp, i) => i).filter((i) => !spellsAnswer(shownOf(spots[i]), answersOf(spots[i])));
    if (open.length) { keys = open.map((i) => keys[i]); spots = open.map((i) => spots[i]); }
    const got = pool.chooseInfo(skill.id, 'chart', keys, rand, [], opts.itemKey ?? null);
    if (!got) return null;   // a redo whose cell the table no longer has: dropped, never swapped for another cell
    const spot = spots[keys.indexOf(got.key)];
    const { c, table, si, ri, ci } = spot;
    const section = table.sections[si];
    const cellAnswers = (cell) => [cell.text, ...(cell.alt ? [cell.alt] : []), ...String(cell.text).split(' / ')].filter(Boolean);
    const target = section.rows[ri].cells[ci];
    const colLabel = section.headers?.[ci] ?? '';
    const kind = target.key?.kind;
    const finite = kind === 'finite';
    const nominal = kind === 'nominal';
    // "comparative" / "superlative" is named on an adjective table (G1-03); the positive section needs no label unless the skill is about degree.
    let degreeTitle = nominal && table.sections.length > 1 && section.title ? section.title.replace(/\s*\(.*\)\s*$/, '') : '';
    if (k !== 'degree' && /^positive/i.test(degreeTitle)) degreeTitle = '';
    const genderCols = nominal && (section.headers?.length ?? 0) >= 3;
    // "dative singular" for a noun; "dative sg. masculine, superlative" on an adjective; "imperfect subjunctive, we (passive)" for a verb — the tense and mood are the point.
    const cellLabel = (r, cj = ci) => {
      const col = cj >= 0 ? (section.headers?.[cj] ?? '') : '';
      if (finite) return `${section.title}, ${r.label}${col ? ` (${col})` : ''}`;
      if (nominal) return `${degreeTitle ? `${degreeTitle}, ` : ''}${r.label}${col ? ` ${col}` : ''}`;
      return `${section.title ? `${section.title}: ` : ''}${r.label}${col ? ` (${col})` : ''}`;
    };
    let cells;
    if (full && genderCols && k === 'case') {
      // A case skill on an adjective table fills the case's row across the genders, not a whole gender column (G1-22).
      cells = section.rows[ri].cells.map((cell, cj) => ({ row: ri, col: cj, label: cellLabel(section.rows[ri], cj), answer: cellAnswers(cell), empty: !!cell?.empty })).filter((x) => !x.empty);
    } else if (full) {
      cells = section.rows.map((r, rj) => ({ row: rj, col: ci, label: cellLabel(r), answer: cellAnswers(r.cells[ci]), empty: !!r.cells[ci]?.empty })).filter((x) => !x.empty);
    } else cells = [{ row: ri, col: ci, label: cellLabel(section.rows[ri]), answer: cellAnswers(target) }];
    const cellKey = target.key;
    const lab = nominal && k === 'degree' ? labelOf('degree', cellKey.degree ?? 'pos') : nominal ? labelOf('case', cellKey.case) : finite ? labelOf('tense', `${cellKey.tense} ${cellKey.mood}`)
      : kind === 'inf' || kind === 'ptc' || kind === 'imper' ? labelOf('tense', `${cellKey.tense} ${kind}`) : kind ? labelOf('tense', kind) : { name: skill.title, plain: skill.plain, full: skill.plain };
    const lemma = c.entry.lemma;
    const head = firstWord(lemma);
    // A noun's citation prints its genitive and a verb's its principal parts, and a meaning sometimes
    // quotes a phrase (nox noctis f — night; prīmā *nocte*…), so the dictionary line can be the answer
    // key for the very cell being asked (femina *fēminae* f → "give the genitive singular of femina").
    // The line then gives up as much as it must: the citation, then the meaning (QA-FINAL B1).
    const asked = cells.flatMap((x) => x.answer || []);
    const chartGloss = [lemmaGloss(c.entry), headGloss(c.entry), head].find((g) => !spellsAnswer(g, asked)) ?? head;
    const fullQuestion = full && genderCols && k === 'case' ? `Fill in the ${cellLabel(section.rows[ri], -1)} of ${head} in every gender`
      : full ? `Fill in the ${finite ? `${section.title}${colLabel ? ` (${colLabel})` : ''}` : (degreeTitle ? `${degreeTitle} ` : '') + (colLabel || section.title)} of ${head}` : null;
    return { ...base(skill, 'chart', stage, null, scopeNote(opts.chapter ?? null, scoped.scope, c)), key: got.key, input: 'chart', entry: c.entry, lemma, repeat: got.wrapped,
      prompt: { la: null, question: full ? fullQuestion : `Give the ${cellLabel(section.rows[ri])} of ${head}`, gloss: chartGloss, hint: `${lab.name} — ${lab.plain}` },
      answer: cellAnswers(target),
      chart: { table, section: si, col: ci, target: { row: ri, col: ci }, cells, full, head },
      meanings: [], confuse: { values: {}, indexes: {}, forms: {} },
      feedback: { ...feedbackFor(skill, null, k), short: `${target.text} is the ${cellLabel(section.rows[ri])} of ${lemma} — ${lab.plain}.`, table, lemma, sense: headSense(c.entry) } };
  }

  const FNS = { recognise, parse: parseItem, blank, chart: (s, st, o, x) => chart(s, st, o, x) };
  /**
   * An item for a session slot. When the asked kind cannot be built the other
   * kinds are tried — those not in `avoid` (the neighbours' kinds) first — and
   * the item that comes back says which kind it is.
   */
  function generate({ skill: skillId, kind, stage = 1, currentWeek = false, currentWeekN = null, chapter = null, full = false, tap = undefined, avoid = [], itemKey = null } = {}) {
    const skill = typeof skillId === 'string' ? skillMap.get(skillId) : skillId;
    if (!skill || !skill.parse_filter) return null;
    const opts = { currentWeek, currentWeekN, chapter, tap, itemKey };
    const fn = FNS[kind];
    if (!fn) return null;
    // A redo asks for one named item (GRAMMAR-CONTRACT.md "Redo what was wrong"). Neither of the two
    // fallbacks below may run for it: a different sentence, or a different kind, would be a different
    // item wearing the same name. Nothing to rebuild → null, and the session drops the slot quietly.
    if (itemKey != null) return fn(skill, stage, opts, { full });
    let item = fn(skill, stage, opts, { full });
    if (!item && currentWeek) item = fn(skill, stage, { currentWeek: false, currentWeekN: null, chapter, tap }, { full });
    if (!item) { // fall back through the other kinds so a session slot is never empty — the neighbours' kinds last
      const allowed = skill.kinds?.length ? skill.kinds : ['recognise', 'chart', 'parse', 'blank'];
      const order = ['blank', 'recognise', 'parse', 'chart'].filter((a) => a !== kind && allowed.includes(a));
      for (const alt of [...order.filter((a) => !avoid.includes(a)), ...order.filter((a) => avoid.includes(a))]) { item = FNS[alt](skill, stage, { currentWeek: false, currentWeekN: null, chapter }, { full }); if (item) break; }
    }
    return item;
  }

  return { generate, candidates, drillable, pool, skills: skillMap, scan, meaningsOf };
}
