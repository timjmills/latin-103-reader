// Dictionary: lookup + learner-first description of a glossary entry.
//
//   loadGlossary(url)        fetch + index glossary.json (+ function-words.json, glosses.json next to it)
//   setGlossary(g, fw, gl)   same, from already-parsed objects (tests, prefetch)
//   lookup(form)             → { form, entries, via: 'exact'|'lower'|'enclitic'|'miss', enclitic }
//   describe(entry, opts)    → opts.compact; opts.form (as in the text) and opts.context (the unit's
//                              Latin) let the meaning line put a command / an address first
//   describe(entry, opts)    → LearnerEntry (see CONTRACT.md)
//
// The meaning line is the plain answer for THIS form ("to/for the labyrinth ·
// by/with/from the labyrinth", "they were sending / they might send
// (subjunctive)"); the parse line is the label ("dative or ablative singular").

import { stripMacrons } from './tokenize.js';
import { paradigm, declensionName, adjectiveName, conjugationName } from './paradigms.js';

let GLOSSARY = null;
let FUNCTION_WORDS = {};
let GLOSSES = {};
let GLOSS_TERMS = [];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function loadGlossary(url = './data/glossary.json') {
  const base = url.replace(/[^/]*$/, '');
  const [g, fw, gl] = await Promise.all([
    fetchJson(url),
    fetchJson(base + 'function-words.json').catch(() => ({})),
    fetchJson(base + 'glosses.json').catch(() => ({})),
  ]);
  return setGlossary(g, fw, gl);
}

export function setGlossary(glossary, functionWords = {}, glosses = {}) {
  GLOSSARY = glossary || {};
  FUNCTION_WORDS = functionWords || {};
  GLOSSES = glosses || {};
  GLOSS_TERMS = Object.keys(GLOSSES).sort((a, b) => b.length - a.length);
  return { forms: Object.keys(GLOSSARY).length };
}

export function glossaryLoaded() {
  return GLOSSARY !== null;
}

export function glossaryEntries() {
  return GLOSSARY || {};
}

// ---------------------------------------------------------------------------
// lookup

const ENCLITICS = ['que', 'ne', 've'];

function canonicalKey(s) {
  return stripMacrons(s).toLowerCase().replace(/j/g, 'i').replace(/v/g, 'u');
}

function hitKey(key) {
  if (!GLOSSARY) return null;
  if (Object.prototype.hasOwnProperty.call(GLOSSARY, key)) return GLOSSARY[key];
  return null;
}

/** Try a spelling as given, then canonical i/u. */
function findEntries(key) {
  let e = hitKey(key);
  if (e) return e;
  const c = canonicalKey(key);
  if (c !== key) e = hitKey(c);
  if (e) return e;
  // the glossary key may have kept a 'v' that the query lacks
  const withV = key.replace(/^u(?=[aeiou])/, 'v');
  if (withV !== key) e = hitKey(withV);
  return e || null;
}

/**
 * Keys drop macrons, so "hīc" (here) and "hic" (this) share one key. When the
 * query carries macrons and an uninflected entry's lemma matches it exactly,
 * that entry goes first; an uninflected lemma that contradicts the macrons
 * goes behind the rest.
 */
function preferMacronMatch(entries, raw) {
  if (!/[āēīōūȳĀĒĪŌŪȲ]/.test(raw) || entries.length < 2) return entries;
  const q = raw.toLowerCase();
  const UNINFLECTED = new Set(['ADV', 'CONJ', 'PREP', 'INTERJ']);
  const score = (e) => {
    if (!UNINFLECTED.has(e.pos) || e.enc) return 1;
    const lemma = String(e.lemma || '').split(/[\s(/]/)[0].toLowerCase();
    if (lemma === q) return 0;
    if (stripMacrons(lemma) === stripMacrons(q) && lemma !== q) return 2;
    return 1;
  };
  // whole-word readings stay ahead of enclitic splits (ubīque before ubi + -que)
  return entries.map((e, i) => [e.enc ? 1 : 0, score(e), i, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map((x) => x[3]);
}

export function lookup(form) {
  const raw = String(form ?? '').replace(/[^\p{L}]/gu, '');
  const result = { form: raw, entries: [], via: 'miss', enclitic: null };
  if (!raw || !GLOSSARY) return result;

  let entries = hitKey(raw);
  if (entries) return { ...result, entries, via: 'exact', enclitic: entries[0]?.enc ?? null };

  const lower = stripMacrons(raw).toLowerCase();
  entries = findEntries(lower);
  if (entries) {
    entries = preferMacronMatch(entries, raw);
    return { ...result, entries, via: raw === lower ? 'exact' : 'lower', enclitic: entries[0]?.enc ?? null };
  }

  for (const enc of ENCLITICS) {
    if (lower.endsWith(enc) && lower.length > enc.length + 1) {
      const base = lower.slice(0, -enc.length);
      const found = findEntries(base);
      if (found) {
        const cloned = found.map((e) => ({ ...e, enc }));
        return { ...result, entries: cloned, via: 'enclitic', enclitic: enc };
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// English helpers

const IRREGULAR_VERBS = {
  be: ['is', 'was', 'been'], have: ['has', 'had', 'had'], do: ['does', 'did', 'done'], go: ['goes', 'went', 'gone'],
  come: ['comes', 'came', 'come'], become: ['becomes', 'became', 'become'], see: ['sees', 'saw', 'seen'], give: ['gives', 'gave', 'given'],
  take: ['takes', 'took', 'taken'], make: ['makes', 'made', 'made'], say: ['says', 'said', 'said'], tell: ['tells', 'told', 'told'],
  hear: ['hears', 'heard', 'heard'], send: ['sends', 'sent', 'sent'], bring: ['brings', 'brought', 'brought'], think: ['thinks', 'thought', 'thought'],
  seek: ['seeks', 'sought', 'sought'], buy: ['buys', 'bought', 'bought'], fight: ['fights', 'fought', 'fought'], teach: ['teaches', 'taught', 'taught'],
  catch: ['catches', 'caught', 'caught'], lead: ['leads', 'led', 'led'], feed: ['feeds', 'fed', 'fed'], flee: ['flees', 'fled', 'fled'],
  hold: ['holds', 'held', 'held'], run: ['runs', 'ran', 'run'], sit: ['sits', 'sat', 'sat'], eat: ['eats', 'ate', 'eaten'],
  drink: ['drinks', 'drank', 'drunk'], begin: ['begins', 'began', 'begun'], swim: ['swims', 'swam', 'swum'], sing: ['sings', 'sang', 'sung'],
  speak: ['speaks', 'spoke', 'spoken'], break: ['breaks', 'broke', 'broken'], choose: ['chooses', 'chose', 'chosen'], drive: ['drives', 'drove', 'driven'],
  rise: ['rises', 'rose', 'risen'], write: ['writes', 'wrote', 'written'], ride: ['rides', 'rode', 'ridden'], fall: ['falls', 'fell', 'fallen'],
  know: ['knows', 'knew', 'known'], throw: ['throws', 'threw', 'thrown'], grow: ['grows', 'grew', 'grown'], fly: ['flies', 'flew', 'flown'],
  draw: ['draws', 'drew', 'drawn'], forget: ['forgets', 'forgot', 'forgotten'], get: ['gets', 'got', 'got'], put: ['puts', 'put', 'put'],
  cut: ['cuts', 'cut', 'cut'], set: ['sets', 'set', 'set'], let: ['lets', 'let', 'let'], hit: ['hits', 'hit', 'hit'], shut: ['shuts', 'shut', 'shut'],
  hurt: ['hurts', 'hurt', 'hurt'], read: ['reads', 'read', 'read'], leave: ['leaves', 'left', 'left'], keep: ['keeps', 'kept', 'kept'],
  sleep: ['sleeps', 'slept', 'slept'], feel: ['feels', 'felt', 'felt'], meet: ['meets', 'met', 'met'], lose: ['loses', 'lost', 'lost'],
  find: ['finds', 'found', 'found'], build: ['builds', 'built', 'built'], stand: ['stands', 'stood', 'stood'], understand: ['understands', 'understood', 'understood'],
  sell: ['sells', 'sold', 'sold'], pay: ['pays', 'paid', 'paid'], lay: ['lays', 'laid', 'laid'], wear: ['wears', 'wore', 'worn'],
  tear: ['tears', 'tore', 'torn'], bear: ['bears', 'bore', 'borne'], swear: ['swears', 'swore', 'sworn'], strike: ['strikes', 'struck', 'struck'],
  stick: ['sticks', 'stuck', 'stuck'], dig: ['digs', 'dug', 'dug'], hang: ['hangs', 'hung', 'hung'], win: ['wins', 'won', 'won'],
  spin: ['spins', 'spun', 'spun'], shine: ['shines', 'shone', 'shone'], shoot: ['shoots', 'shot', 'shot'], bind: ['binds', 'bound', 'bound'],
  wind: ['winds', 'wound', 'wound'], grind: ['grinds', 'ground', 'ground'], bite: ['bites', 'bit', 'bitten'], hide: ['hides', 'hid', 'hidden'],
  light: ['lights', 'lit', 'lit'], slay: ['slays', 'slew', 'slain'], lie: ['lies', 'lay', 'lain'], weep: ['weeps', 'wept', 'wept'],
  sweep: ['sweeps', 'swept', 'swept'], creep: ['creeps', 'crept', 'crept'], kneel: ['kneels', 'knelt', 'knelt'], spend: ['spends', 'spent', 'spent'],
  lend: ['lends', 'lent', 'lent'], bend: ['bends', 'bent', 'bent'], mean: ['means', 'meant', 'meant'], deal: ['deals', 'dealt', 'dealt'],
  weave: ['weaves', 'wove', 'woven'], arise: ['arises', 'arose', 'arisen'], beat: ['beats', 'beat', 'beaten'], blow: ['blows', 'blew', 'blown'],
  forbid: ['forbids', 'forbade', 'forbidden'], forgive: ['forgives', 'forgave', 'forgiven'], freeze: ['freezes', 'froze', 'frozen'], steal: ['steals', 'stole', 'stolen'],
  strive: ['strives', 'strove', 'striven'], wake: ['wakes', 'woke', 'woken'], tread: ['treads', 'trod', 'trodden'], dwell: ['dwells', 'dwelt', 'dwelt'],
  cling: ['clings', 'clung', 'clung'], fling: ['flings', 'flung', 'flung'], sting: ['stings', 'stung', 'stung'], swing: ['swings', 'swung', 'swung'],
  spring: ['springs', 'sprang', 'sprung'], sink: ['sinks', 'sank', 'sunk'], shrink: ['shrinks', 'shrank', 'shrunk'], wring: ['wrings', 'wrung', 'wrung'],
  show: ['shows', 'showed', 'shown'], sow: ['sows', 'sowed', 'sown'], prove: ['proves', 'proved', 'proven'], seem: ['seems', 'seemed', 'seemed'],
  drag: ['drags', 'dragged', 'dragged'], stop: ['stops', 'stopped', 'stopped'], beg: ['begs', 'begged', 'begged'], rub: ['rubs', 'rubbed', 'rubbed'],
  plan: ['plans', 'planned', 'planned'], carry: ['carries', 'carried', 'carried'], bury: ['buries', 'buried', 'buried'], marry: ['marries', 'married', 'married'],
  can: ['can', 'could', 'been able'], will: ['will', 'would', 'willed'], shall: ['shall', 'should', 'should'], may: ['may', 'might', 'might'],
  must: ['must', 'had to', 'had to'], ought: ['ought', 'ought', 'ought'],
};

function splitPhrase(v) {
  const i = v.indexOf(' ');
  return i < 0 ? [v, ''] : [v.slice(0, i), v.slice(i)];
}

function thirdSg(v) {
  const [w, rest] = splitPhrase(v);
  const irr = IRREGULAR_VERBS[w];
  if (irr) return irr[0] + rest;
  if (/(s|x|z|ch|sh|o)$/.test(w)) return w + 'es' + rest;
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies' + rest;
  return w + 's' + rest;
}

function pastTense(v) {
  const [w, rest] = splitPhrase(v);
  const irr = IRREGULAR_VERBS[w];
  if (irr) return irr[1] + rest;
  return regularPast(w) + rest;
}

function pastParticiple(v) {
  const [w, rest] = splitPhrase(v);
  const irr = IRREGULAR_VERBS[w];
  if (irr) return irr[2] + rest;
  return regularPast(w) + rest;
}

function regularPast(w) {
  if (/e$/.test(w)) return w + 'd';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ied';
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 4) return w + w[w.length - 1] + 'ed';
  return w + 'ed';
}

function ingForm(v) {
  const [w, rest] = splitPhrase(v);
  let out;
  if (w === 'be') out = 'being';
  else if (/ie$/.test(w)) out = w.slice(0, -2) + 'ying';
  else if (/[^eoy]e$/.test(w)) out = w.slice(0, -1) + 'ing';
  else if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w) && w.length <= 4) out = w + w[w.length - 1] + 'ing';
  else out = w + 'ing';
  return out + rest;
}

function pluralNoun(phrase) {
  const IRR = { man: 'men', woman: 'women', child: 'children', foot: 'feet', tooth: 'teeth', mouse: 'mice', goose: 'geese', ox: 'oxen',
    person: 'people', sheep: 'sheep', deer: 'deer', fish: 'fish', life: 'lives', wife: 'wives', knife: 'knives', leaf: 'leaves', wolf: 'wolves',
    half: 'halves', self: 'selves', calf: 'calves', thief: 'thieves', loaf: 'loaves', die: 'dice', penny: 'pence' };
  const words = phrase.split(' ');
  const last = words[words.length - 1];
  let pl;
  if (IRR[last]) pl = IRR[last];
  else if (/[^aeiou]y$/.test(last)) pl = last.slice(0, -1) + 'ies';
  else if (/(s|x|z|ch|sh)$/.test(last)) pl = last + 'es';
  else pl = last + 's';
  words[words.length - 1] = pl;
  return words.join(' ');
}

/** First plain item of the first sense, parentheticals removed. */
function headWord(sense) {
  let s = String(sense || '').replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  s = s.split(/[,;]/)[0].split(' or ')[0].split('/')[0];
  s = s.replace(/\s+/g, ' ').trim().replace(/[.:!?]+$/, '');
  return s;
}

function verbBase(entry) {
  let s = headWord(entry.senses?.[0] || '').toLowerCase();
  s = s.replace(/^to\s+/, '');
  // impersonals are glossed "it is fitting": strip the subject, restore the base verb
  s = s.replace(/^it\s+/, '').replace(/^(is|are)\s+/, 'be ').replace(/^is$/, 'be');
  if (!s) s = 'do';
  return s;
}

// ---------------------------------------------------------------------------
// meaning line

const SUBJ = { '1sg': 'I', '2sg': 'you', '3sg': 'he/she/it', '1pl': 'we', '2pl': 'you (pl.)', '3pl': 'they' };

function bePresent(subj) {
  if (subj === 'I') return 'am';
  if (subj === 'he/she/it' || subj === 'it') return 'is';
  return 'are';
}
function bePast(subj) {
  return subj === 'I' || subj === 'he/she/it' || subj === 'it' ? 'was' : 'were';
}
function haveForm(subj) {
  return subj === 'he/she/it' || subj === 'it' ? 'has' : 'have';
}

function verbForms(base) {
  const isBe = base === 'be' || /^be /.test(base);
  return {
    base,
    isBe,
    rest: isBe ? base.replace(/^be\s*/, '') : '',
    s3: thirdSg(base),
    past: pastTense(base),
    pp: pastParticiple(base),
    ing: ingForm(base),
  };
}

function pres(subj, V) {
  if (V.isBe) return `${subj} ${bePresent(subj)}${V.rest ? ' ' + V.rest : ''}`;
  return `${subj} ${subj === 'he/she/it' || subj === 'it' ? V.s3 : V.base}`;
}
function progressivePast(subj, V) {
  if (V.isBe) return `${subj} ${bePast(subj)}${V.rest ? ' ' + V.rest : ''}`;
  return `${subj} ${bePast(subj)} ${V.ing}`;
}

function finiteMeaning(p, V, deponent, impersonal) {
  const subj = impersonal ? 'it' : SUBJ[`${p.person}${p.number}`] || 'they';
  const mood = p.mood;
  const active = p.voice !== 'pass' || deponent;
  const t = p.tense;
  const SUBJ_TAG = ' (subjunctive)';
  if (mood === 'imper') {
    const who = p.number === 'pl' ? 'command to more than one person' : 'command to one person';
    if (p.tense === 'fut') {
      if (String(p.person) === '3') return `let ${p.number === 'pl' ? 'them' : 'him/her'} ${active ? V.base : 'be ' + V.pp}! (future command)`;
      return `${active ? V.base : 'be ' + V.pp}! (future command, ${who.replace('command ', '')})`;
    }
    return `${active ? V.base : 'be ' + V.pp}! (${who})`;
  }
  if (mood === 'inf') {
    if (active) {
      if (t === 'perf') return `to have ${V.pp}`;
      if (t === 'fut') return `to be about to ${V.base}`;
      return `to ${V.base}`;
    }
    if (t === 'perf') return `to have been ${V.pp}`;
    if (t === 'fut') return `to be going to be ${V.pp}`;
    return `to be ${V.pp}`;
  }
  if (active) {
    if (mood === 'subj') {
      if (t === 'pres') return `${pres(subj, V)} / ${subj} may ${V.base}${SUBJ_TAG}`;
      if (t === 'impf') return `${progressivePast(subj, V)} / ${subj} should ${V.base}${SUBJ_TAG}`;
      if (t === 'perf') return `${subj} ${V.past} / ${subj} may have ${V.pp}${SUBJ_TAG}`;
      if (t === 'plupf') return `${subj} had ${V.pp} / ${subj} might have ${V.pp}${SUBJ_TAG}`;
    }
    if (t === 'pres') return pres(subj, V);
    if (t === 'impf') return V.isBe ? progressivePast(subj, V) : `${progressivePast(subj, V)} / ${subj} used to ${V.base}`;
    if (t === 'fut') return `${subj} will ${V.base}`;
    if (t === 'perf') return `${subj} ${V.past} / ${subj} ${haveForm(subj)} ${V.pp}`;
    if (t === 'plupf') return `${subj} had ${V.pp}`;
    if (t === 'futperf') return `${subj} will have ${V.pp}`;
    return `${subj} ${V.base}`;
  }
  // passive
  if (mood === 'subj') {
    if (t === 'pres') return `${subj} ${bePresent(subj)} ${V.pp} / ${subj} may be ${V.pp}${SUBJ_TAG}`;
    if (t === 'impf') return `${subj} ${bePast(subj)} being ${V.pp} / ${subj} should be ${V.pp}${SUBJ_TAG}`;
    if (t === 'perf') return `${subj} ${bePast(subj)} ${V.pp} / ${subj} may have been ${V.pp}${SUBJ_TAG}`;
    if (t === 'plupf') return `${subj} had been ${V.pp} / ${subj} might have been ${V.pp}${SUBJ_TAG}`;
  }
  if (t === 'pres') return `${subj} ${bePresent(subj)} ${V.pp}`;
  if (t === 'impf') return `${subj} ${bePast(subj)} being ${V.pp}`;
  if (t === 'fut') return `${subj} will be ${V.pp}`;
  if (t === 'perf') return `${subj} ${bePast(subj)} ${V.pp} / ${subj} ${haveForm(subj)} been ${V.pp}`;
  if (t === 'plupf') return `${subj} had been ${V.pp}`;
  if (t === 'futperf') return `${subj} will have been ${V.pp}`;
  return `${subj} ${bePresent(subj)} ${V.pp}`;
}

function participleMeaning(p, V, deponent) {
  const m = p.mood;
  if (m === 'gerund') {
    const g = V.ing;
    return { gen: `of ${g}`, dat: `to/for ${g}`, acc: `${g} (after ad: for ${g})`, abl: `by ${g}` }[p.case] || g;
  }
  if (m === 'gerundive') return `to be ${V.pp} / needing to be ${V.pp}`;
  if (m === 'supine') return p.case === 'abl' ? `to ${V.base} (after an adjective: easy to ${V.base})` : `to ${V.base} (purpose, after a verb of motion)`;
  // participle
  if (p.tense === 'pres') return V.ing;
  if (p.tense === 'fut') return p.voice === 'pass' ? `to be ${V.pp}` : `about to ${V.base}`;
  if (p.tense === 'perf') return deponent ? `having ${V.pp}` : `${V.pp} / having been ${V.pp}`;
  return V.ing;
}

const NO_ARTICLE = new Set(['no one', 'nobody', 'nothing', 'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything', 'everyone', 'everything', 'each', 'none']);

function caseMeaning(c, noun, art) {
  const n = noun;
  switch (c) {
    case 'nom': return `${art}${n} (subject)`;
    case 'gen': return `of ${art}${n}`;
    case 'dat': return `to/for ${art}${n}`;
    case 'acc': return `${art}${n} (object)`;
    case 'abl': return `by/with/from ${art}${n}`;
    case 'voc': return `O ${n}!`;
    case 'loc': return `at/in ${art}${n}`;
    default: return n;
  }
}

const PRON_FORMS = {
  is: { sg: { m: 'he / that', f: 'she / that', n: 'it / that' }, pl: { m: 'they / those', f: 'they / those', n: 'they / those' } },
  hic: { sg: { m: 'this (man)', f: 'this (woman)', n: 'this (thing)' }, pl: { m: 'these', f: 'these', n: 'these' } },
  ille: { sg: { m: 'that (man)', f: 'that (woman)', n: 'that (thing)' }, pl: { m: 'those', f: 'those', n: 'those' } },
  iste: { sg: { m: 'that (of yours)', f: 'that (of yours)', n: 'that (of yours)' }, pl: { m: 'those (of yours)', f: 'those (of yours)', n: 'those (of yours)' } },
  ipse: { sg: { m: 'he himself', f: 'she herself', n: 'it itself' }, pl: { m: 'they themselves', f: 'they themselves', n: 'they themselves' } },
  idem: { sg: { m: 'the same (man)', f: 'the same (woman)', n: 'the same (thing)' }, pl: { m: 'the same', f: 'the same', n: 'the same' } },
  qui: { sg: { m: 'who / which', f: 'who / which', n: 'which / that' }, pl: { m: 'who / which', f: 'who / which', n: 'which' } },
  quis: { sg: { m: 'who?', f: 'who?', n: 'what?' }, pl: { m: 'who?', f: 'who?', n: 'what?' } },
  ego: { sg: { m: 'I', f: 'I', n: 'I' }, pl: { m: 'we', f: 'we', n: 'we' } },
  nos: { sg: { m: 'we', f: 'we', n: 'we' }, pl: { m: 'we', f: 'we', n: 'we' } },
  tu: { sg: { m: 'you', f: 'you', n: 'you' }, pl: { m: 'you (pl.)', f: 'you (pl.)', n: 'you (pl.)' } },
  vos: { sg: { m: 'you (pl.)', f: 'you (pl.)', n: 'you (pl.)' }, pl: { m: 'you (pl.)', f: 'you (pl.)', n: 'you (pl.)' } },
  se: { sg: { m: 'himself / herself / itself', f: 'himself / herself / itself', n: 'himself / herself / itself' }, pl: { m: 'themselves', f: 'themselves', n: 'themselves' } },
  aliquis: { sg: { m: 'someone', f: 'someone', n: 'something' }, pl: { m: 'some (people)', f: 'some', n: 'some (things)' } },
  quisque: { sg: { m: 'each one', f: 'each one', n: 'each thing' }, pl: { m: 'each', f: 'each', n: 'each' } },
  quidam: { sg: { m: 'a certain (man)', f: 'a certain (woman)', n: 'a certain (thing)' }, pl: { m: 'certain (people), some', f: 'certain, some', n: 'certain (things), some' } },
  quisquam: { sg: { m: 'anyone', f: 'anyone', n: 'anything' }, pl: { m: 'any', f: 'any', n: 'any' } },
};
const OBJ = { he: 'him', she: 'her', they: 'them', I: 'me', we: 'us', who: 'whom', 'he himself': 'himself', 'she herself': 'herself', 'it itself': 'itself', 'they themselves': 'themselves' };
const POSS = { he: 'his', she: 'her', it: 'its', they: 'their', I: 'my', we: 'our', you: 'your', 'you (pl.)': 'your', who: 'whose', 'he himself': 'his own', 'she herself': 'her own', 'they themselves': 'their own', 'himself / herself / itself': 'his / her / its own', themselves: 'their own' };

function objective(word) {
  return word.split(' / ').map((w) => OBJ[w] || w).join(' / ');
}

function pronounCase(c, word) {
  const first = word.split(' / ')[0];
  switch (c) {
    case 'nom': return word;
    case 'gen': {
      const p = POSS[word] || POSS[first];
      if (p && word.includes(' / ') && !POSS[word]) {
        return word.split(' / ').map((w) => POSS[w] || `of ${objective(w)}`).join(' / ');
      }
      return p || `of ${objective(word)}`;
    }
    case 'dat': return `to/for ${objective(word)}`;
    case 'acc': return `${objective(word)} (object)`;
    case 'abl': return `by/with/from ${objective(word)}`;
    case 'voc': return `O ${word}!`;
    default: return word;
  }
}

function uniq(list) {
  const seen = new Set();
  return list.filter((x) => x && !seen.has(x) && seen.add(x));
}

function isProper(entry) {
  const s = entry.senses?.[0] || '';
  return /^[A-Z]/.test(entry.lemma || '') || /^(the )?[A-Z]/.test(s);
}

/**
 * What the sentence says about the tapped form. `opts.form` is the form as it
 * appears in the text (capitalisation kept); `opts.context` is the unit's Latin.
 * Returns { initial, exclaim, addressed }: sentence-initial capital, the clause
 * the form sits in ends in "!", and the form is preceded by "ō" (vocative).
 */
function formContext(opts = {}) {
  const form = opts.form || '';
  const context = opts.context || '';
  const initial = /^[A-ZĀĒĪŌŪȲ]/.test(form) && !/^[A-ZĀĒĪŌŪȲ]{2}/.test(form);
  let exclaim = false;
  let addressed = false;
  if (form && context) {
    let at = context.indexOf(form);
    if (at < 0) at = context.toLowerCase().indexOf(form.toLowerCase());
    if (at >= 0) {
      const after = context.slice(at + form.length);
      const m = /[.!?;:…]/.exec(after);
      exclaim = !!m && m[0] === '!';
      const before = context.slice(0, at).trimEnd();
      addressed = /(^|[\s"'“‘(])[ōo]$/i.test(before);
    }
  }
  return { initial, exclaim, addressed };
}

export function meaningLine(entry, opts = {}) {
  const parses = entry.parses || [];
  const pos = entry.pos;
  const first = entry.senses?.[0] || '';
  const ctx = formContext(opts);
  if (pos === 'N') {
    const rawHead = headWord(first) || entry.h;
    const hasThe = /^the /i.test(rawHead);
    const head = rawHead.replace(/^(the|a|an) /i, '');
    const proper = isProper(entry);
    const art = hasThe ? 'the ' : proper || NO_ARTICLE.has(head.toLowerCase()) ? '' : 'the ';
    if (!parses.length) return head;
    // every case reading is shown, the vocative last ("the citizens (subject) · O citizens!")
    // — unless the sentence addresses someone ("cīvēs meī!", "ō Mārce"), then it comes first
    const cased = parses.filter((p) => p.case);
    const vocFirst = ctx.exclaim || ctx.addressed;
    const shown = [...cased].sort((a, b) => ((a.case === 'voc') === (b.case === 'voc') ? 0 : (a.case === 'voc') === vocFirst ? -1 : 1));
    const parts = shown.map((p) => caseMeaning(p.case, p.number === 'pl' && !proper ? pluralNoun(head) : head, art));
    return uniq(parts).join(' · ') || head;
  }
  if (pos === 'PRON') {
    const table = PRON_FORMS[entry.h];
    if (table && parses.length) {
      const cased = parses.filter((p) => p.case);
      const shown = cased.filter((p) => !(p.case === 'voc' && cased.some((q) => q.case === 'nom' && q.number === p.number)));
      const parts = shown.map((p) => {
        const num = p.number === 'pl' ? 'pl' : 'sg';
        const g = p.gender && p.gender !== 'c' ? p.gender : null;
        const words = g ? [table[num][g]] : [table[num].m];
        return uniq(words.map((w) => pronounCase(p.case, w))).join(' / ');
      });
      return uniq(parts).join(' · ');
    }
    return first;
  }
  if (pos === 'ADJ' || pos === 'NUM') {
    const head = first;
    const degs = uniq(parses.map((p) => p.degree || 'pos'));
    const short = headWord(first);
    const parts = degs.map((d) => {
      if (d === 'comp') return `more ${short} (comparative)`;
      if (d === 'super') return `most ${short} / very ${short} (superlative)`;
      return head;
    });
    return parts.join(' · ');
  }
  if (pos === 'V' || pos === 'VPAR') {
    const V = verbForms(verbBase(entry));
    const deponent = entry.kind === 'dep' || entry.kind === 'semidep';
    const impersonal = entry.kind === 'impers';
    // "Sequiminī!" / "sequere mē!": a sentence-initial or exclaimed form reads as the command first
    const imperFirst = ctx.initial || ctx.exclaim;
    const ordered = imperFirst
      ? [...parses].sort((a, b) => ((a.mood === 'imper') === (b.mood === 'imper') ? 0 : a.mood === 'imper' ? -1 : 1))
      : parses;
    const parts = ordered.map((p) => {
      if (p.mood === 'ptc' || p.mood === 'gerund' || p.mood === 'gerundive' || p.mood === 'supine') return participleMeaning(p, V, deponent);
      return finiteMeaning(p, V, deponent, impersonal);
    });
    return uniq(parts).join(' · ') || first;
  }
  if (pos === 'PREP') {
    const fw = FUNCTION_WORDS[entry.h];
    const gov = parses[0]?.governs || entry.kind;
    if (fw?.cases?.[gov]) return fw.cases[gov];
    return first;
  }
  if (pos === 'ADV') {
    const degs = uniq(parses.map((p) => p.degree).filter(Boolean));
    if (degs.includes('comp')) return `more ${headWord(first)} (comparative)`;
    if (degs.includes('super')) return `most ${headWord(first)} (superlative)`;
    return first;
  }
  return first;
}

// ---------------------------------------------------------------------------
// parse line

const CASE_NAME = { nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', abl: 'ablative', voc: 'vocative', loc: 'locative' };
const CASE_ABBR = { nom: 'nom.', gen: 'gen.', dat: 'dat.', acc: 'acc.', abl: 'abl.', voc: 'voc.', loc: 'loc.' };
const NUM_NAME = { sg: 'singular', pl: 'plural' };
const NUM_ABBR = { sg: 'sg.', pl: 'pl.' };
const GEN_NAME = { m: 'masculine', f: 'feminine', n: 'neuter', c: 'masculine or feminine' };
const GEN_ABBR = { m: 'm.', f: 'f.', n: 'n.', c: 'm./f.' };
const TENSE_NAME = { pres: 'present', impf: 'imperfect', fut: 'future', perf: 'perfect', plupf: 'pluperfect', futperf: 'future perfect' };
const TENSE_ABBR = { pres: 'pres.', impf: 'impf.', fut: 'fut.', perf: 'perf.', plupf: 'plupf.', futperf: 'fut. perf.' };
const MOOD_NAME = { ind: 'indicative', subj: 'subjunctive', imper: 'imperative', inf: 'infinitive' };
const MOOD_ABBR = { ind: 'ind.', subj: 'subj.', imper: 'imper.', inf: 'inf.' };
const PERSON_NAME = { 1: '1st', 2: '2nd', 3: '3rd' };
const DEGREE_NAME = { comp: 'comparative', super: 'superlative' };

function nominalPhrase(group, compact, showGender) {
  const cases = group.cases.map((c) => (compact ? CASE_ABBR[c] : CASE_NAME[c]));
  const caseStr = compact ? cases.join('/') : cases.join(' or ');
  const num = group.number ? (compact ? NUM_ABBR[group.number] : NUM_NAME[group.number]) : '';
  const gen = showGender && group.gender ? (compact ? GEN_ABBR[group.gender] : GEN_NAME[group.gender]) : '';
  return [caseStr, num, gen].filter(Boolean).join(' ');
}

function groupNominal(parses) {
  const groups = [];
  for (const p of parses) {
    if (!p.case) continue;
    const key = `${p.number || ''}|${p.gender || ''}|${p.degree || ''}|${p.mood || ''}|${p.tense || ''}|${p.voice || ''}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, cases: [], number: p.number, gender: p.gender, degree: p.degree, mood: p.mood, tense: p.tense, voice: p.voice };
      groups.push(g);
    }
    if (!g.cases.includes(p.case)) g.cases.push(p.case);
  }
  return groups;
}

export function parseLine(entry, opts = {}) {
  const compact = !!opts.compact;
  const parses = entry.parses || [];
  const pos = entry.pos;
  const dep = entry.kind === 'dep';
  const tail = [];
  if (dep) tail.push(compact ? 'dep.' : 'deponent');
  if (entry.kind === 'semidep') tail.push('semi-deponent');
  if (entry.kind === 'impers') tail.push('impersonal');
  if (entry.enc) tail.push(compact ? `+ -${entry.enc}` : `+ -${entry.enc}${entry.enc === 'que' ? ' (and)' : entry.enc === 'ne' ? ' (question)' : ' (or)'}`);
  const suffix = tail.length ? ` (${tail.join(', ')})` : '';

  if (pos === 'N' || pos === 'ADJ' || pos === 'PRON' || pos === 'NUM') {
    const groups = groupNominal(parses);
    if (!groups.length) {
      const degs = uniq(parses.map((p) => p.degree).filter(Boolean));
      if (degs.length) return degs.map((d) => DEGREE_NAME[d]).join(' or ') + suffix;
      return (pos === 'N' ? (compact ? 'indecl.' : 'indeclinable') : '') + suffix;
    }
    const parts = groups.map((g) => {
      // ego / tū / sē have no gender worth naming; is, hic, quī keep theirs
      const showGender = pos !== 'N' && !(pos === 'PRON' && ['ego', 'tu', 'nos', 'vos', 'se'].includes(entry.h));
      const base = nominalPhrase(g, compact, showGender);
      return g.degree ? `${compact ? DEGREE_NAME[g.degree].slice(0, 4) + '.' : DEGREE_NAME[g.degree]}, ${base}` : base;
    });
    return uniq(parts).join(compact ? '; ' : ' · ') + suffix;
  }
  if (pos === 'V' || pos === 'VPAR') {
    const nominal = parses.filter((p) => ['ptc', 'gerundive', 'gerund', 'supine'].includes(p.mood));
    const finite = parses.filter((p) => !['ptc', 'gerundive', 'gerund', 'supine'].includes(p.mood));
    const parts = [];
    // group finite by tense/voice/person/number so "indicative or imperative" merges
    const fgroups = [];
    for (const p of finite) {
      const key = `${p.tense}|${p.voice}|${p.person || ''}|${p.number || ''}`;
      let g = fgroups.find((x) => x.key === key);
      if (!g) { g = { key, p, moods: [] }; fgroups.push(g); }
      if (!g.moods.includes(p.mood)) g.moods.push(p.mood);
    }
    for (const g of fgroups) {
      const p = g.p;
      const voice = p.voice === 'pass' && !dep ? (compact ? 'pass.' : 'passive') : (p.voice === 'act' && p.mood === 'inf' ? (compact ? 'act.' : 'active') : '');
      const moods = g.moods.map((m) => (compact ? MOOD_ABBR[m] : MOOD_NAME[m])).join(' or ');
      const tense = compact ? TENSE_ABBR[p.tense] : TENSE_NAME[p.tense];
      let s = [tense, voice, moods].filter(Boolean).join(' ');
      if (p.person && p.number) {
        s += compact ? ` ${PERSON_NAME[p.person]} ${NUM_ABBR[p.number]}` : `, ${PERSON_NAME[p.person]} person ${NUM_NAME[p.number]}`;
      } else if (p.number && p.mood === 'imper') {
        s += compact ? ` ${NUM_ABBR[p.number]}` : `, ${NUM_NAME[p.number]}`;
      }
      parts.push(s);
    }
    let lastLabel = null;
    for (const g of groupNominal(nominal)) {
      let label;
      if (g.mood === 'ptc') label = `${compact ? TENSE_ABBR[g.tense] : TENSE_NAME[g.tense]} ${g.voice === 'pass' && !dep ? (compact ? 'pass.' : 'passive') : (compact ? 'act.' : 'active')} ${compact ? 'ptc.' : 'participle'}`;
      else label = g.mood;
      const phrase = nominalPhrase(g, compact, g.mood === 'ptc' || g.mood === 'gerundive');
      parts.push(label === lastLabel ? phrase : `${label}, ${phrase}`);
      lastLabel = label;
    }
    for (const p of nominal.filter((p) => !p.case)) parts.push(p.mood);
    return uniq(parts).join(compact ? '; ' : ' · ') + suffix;
  }
  if (pos === 'PREP') {
    const gov = parses[0]?.governs || entry.kind;
    return (gov ? `preposition + ${compact ? CASE_ABBR[gov] : CASE_NAME[gov]}` : 'preposition') + suffix;
  }
  if (pos === 'ADV') {
    const degs = uniq(parses.map((p) => p.degree).filter(Boolean));
    return (degs.length ? `${degs.map((d) => DEGREE_NAME[d]).join(' or ')} adverb` : 'adverb') + suffix;
  }
  if (pos === 'CONJ') return 'conjunction' + suffix;
  if (pos === 'INTERJ') return 'interjection' + suffix;
  return suffix.trim();
}

// ---------------------------------------------------------------------------
// category, glosses, usage

const PRON_KIND = { pers: 'personal', reflex: 'reflexive', demons: 'demonstrative', indef: 'indefinite', interr: 'interrogative', rel: 'relative', adject: 'adjectival' };

export function categoryLine(entry) {
  switch (entry.pos) {
    case 'N': return declensionName(entry) || 'noun';
    case 'ADJ': return adjectiveName(entry);
    case 'V':
    case 'VPAR': return conjugationName(entry) || 'verb';
    case 'PRON': return entry.kind && PRON_KIND[entry.kind] ? `${PRON_KIND[entry.kind]} pronoun` : 'pronoun';
    case 'NUM': return 'numeral';
    case 'PREP': { const gov = entry.parses?.[0]?.governs || entry.kind; return gov ? `preposition + ${CASE_NAME[gov]}` : 'preposition'; }
    case 'ADV': return 'adverb';
    case 'CONJ': return 'conjunction';
    case 'INTERJ': return 'interjection';
    default: return entry.pos?.toLowerCase() || '';
  }
}

function collectGlosses(...texts) {
  const hay = texts.filter(Boolean).join(' | ').toLowerCase();
  const out = [];
  const taken = new Set();
  for (const term of GLOSS_TERMS) {
    const t = term.toLowerCase();
    if (!hay.includes(t)) continue;
    // skip a term fully inside a longer matched term (e.g. "perfect" inside "future perfect")
    if ([...taken].some((longer) => longer.includes(t) && longer !== t && hay.includes(longer))) {
      // still include if it also appears on its own
      const re = new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      const stripped = [...taken].reduce((h, longer) => h.split(longer).join(' '), hay);
      if (!re.test(stripped)) continue;
    }
    taken.add(t);
    out.push({ term, gloss: GLOSSES[term] });
  }
  return out;
}

function usageFor(entry) {
  const h = entry.h;
  const parts = [];
  let fw = FUNCTION_WORDS[h];
  if (entry.pos === 'ADV' && FUNCTION_WORDS[`${h}_adv`]) fw = FUNCTION_WORDS[`${h}_adv`];
  if (entry.pos === 'CONJ' && h === 'ne' && FUNCTION_WORDS.ne) fw = FUNCTION_WORDS.ne;
  if (fw?.usage && (!fw.pos || fw.pos === entry.pos || entry.pos === 'VPAR' || ['PRON', 'ADJ', 'N', 'V'].includes(entry.pos))) parts.push(fw.usage);
  else if (fw?.usage && ['PREP', 'CONJ', 'ADV', 'INTERJ'].includes(entry.pos) && ['PREP', 'CONJ', 'ADV', 'INTERJ'].includes(fw.pos)) parts.push(fw.usage);
  if (entry.pos === 'N' && !isProper(entry) && FUNCTION_WORDS._articles) parts.push(FUNCTION_WORDS._articles);
  if (entry.enc && FUNCTION_WORDS._enclitics?.[entry.enc]) parts.push(FUNCTION_WORDS._enclitics[entry.enc]);
  return parts.length ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// describe

export function describe(entry, opts = {}) {
  if (!entry) return null;
  const parse = parseLine(entry, opts);
  const category = categoryLine(entry);
  const meaning = meaningLine(entry, opts);
  const kindTerms = [];
  if (entry.kind === 'dep') kindTerms.push('deponent');
  if (entry.kind === 'semidep') kindTerms.push('semi-deponent');
  if (entry.kind === 'impers') kindTerms.push('impersonal');
  if (entry.enc) kindTerms.push('enclitic');
  const glosses = collectGlosses(parseLine(entry, { compact: false }), category, kindTerms.join(' '));
  let table = null;
  try {
    table = paradigm(entry, entry.parses || []);
  } catch (err) {
    console.error('paradigm error', err);
  }
  return {
    meaning,
    parse,
    lemma: entry.lemma,
    category,
    senses: entry.senses || [],
    glosses,
    usage: usageFor(entry),
    paradigm: table,
  };
}

export const _internal = { thirdSg, pastTense, pastParticiple, ingForm, pluralNoun, headWord, finiteMeaning, verbForms };
