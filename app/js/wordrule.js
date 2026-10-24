// What kind of word a table is of, and the rule that makes its forms (the learner, 2026-10-20: "I want to know for
// any word what conjugation/word type it is and the rule used for getting the forms — maybe this should come at the
// beginning of each form table that is practiced").
//
// wordRule(entry, table) → { kind, type, parts, steps: [{ head, text, eg }] } | null. The rule is said once per
// type (a conjugation, a declension, a kind of adjective), with this word's own stems in it; every example (`eg`)
// is read off the word's own table, so what the card shows is always what the table asks. ruleCard(rule) draws it.

import { conjugationName, declensionName, adjectiveName } from './paradigms.js';

const cap = (t) => String(t ?? '').replace(/^./, (c) => c.toUpperCase());
const strip = (s) => String(s ?? '').normalize('NFD').replace(/\p{Mn}/gu, '');
const cut = (word, tail) => (strip(word).endsWith(strip(tail)) ? word.slice(0, word.length - tail.length) : null);
const first = (t) => String(t ?? '').split(' / ')[0];
// A lemma without the enclitic it was read with: "dō, dare, dedī, datum + -ue" (dāve) → "dō, dare, dedī, datum".
const bare = (lemma) => String(lemma ?? '').replace(/\s*\+\s*-\p{L}+$/u, '');

/** The forms down one column of a section: the section by its title, the column by its header (or the first). */
function column(table, title, header = null, n = 6) {
  const s = (table?.sections ?? []).find((x) => x.title === title);
  if (!s) return [];
  const ci = header ? Math.max(0, (s.headers ?? []).indexOf(header)) : 0;
  return (s.rows ?? []).map((r) => r.cells[ci]).filter((c) => c && !c.empty && c.text).slice(0, n).map((c) => first(c.text));
}
/** One cell: section title, row label, column header. */
function cellOf(table, title, rowLabel, header = null) {
  const s = (table?.sections ?? []).find((x) => x.title === title);
  if (!s) return null;
  const r = (s.rows ?? []).find((x) => x.label === rowLabel);
  const ci = header ? (s.headers ?? []).indexOf(header) : 0;
  const c = r?.cells[ci < 0 ? 0 : ci];
  return c && !c.empty ? c : null;
}

/* ------------------------------------------------------------------ verbs */
// The present system, said once per conjugation; {s} is this verb's present stem.
const PRESENT = {
  1: { stem: (inf) => cut(inf, 're'), drop: '-re',
    pres: 'Add -ō, -s, -t, -mus, -tis, -nt (the ā drops before -ō).', impf: 'Stem + -bam, -bās, -bat …', fut: 'Stem + -bō, -bis, -bit …', subj: 'The ā becomes e: -em, -ēs, -et …' },
  2: { stem: (inf) => cut(inf, 're'), drop: '-re',
    pres: 'Add -ō, -s, -t, -mus, -tis, -nt.', impf: 'Stem + -bam, -bās, -bat …', fut: 'Stem + -bō, -bis, -bit …', subj: 'Stem + -am, -ās, -at …, the ē shortened (moneam).' },
  3: { stem: (inf) => cut(inf, 'ere'), drop: '-ere',
    pres: 'Add -ō, -is, -it, -imus, -itis, -unt.', impf: 'Stem + -ēbam, -ēbās, -ēbat …', fut: 'Stem + -am, -ēs, -et, -ēmus …', subj: 'Stem + -am, -ās, -at …' },
  '3io': { stem: (inf) => cut(inf, 'ere'), drop: '-ere', note: 'an i comes in before most vowels',
    pres: 'Add -iō, -is, -it, -imus, -itis, -iunt.', impf: 'Stem + -iēbam, -iēbās …', fut: 'Stem + -iam, -iēs, -iet …', subj: 'Stem + -iam, -iās, -iat …' },
  4: { stem: (inf) => cut(inf, 're'), drop: '-re',
    pres: 'Add -ō, -s, -t, -mus, -tis, -unt (audiō, audiunt).', impf: 'Stem + -ēbam, -ēbās …, the ī shortened (audiēbam).', fut: 'Stem + -am, -ēs, -et …, the ī shortened.', subj: 'Stem + -am, -ās, -at …, the ī shortened.' },
};
// A deponent's infinitive is passive (-ārī, -ērī, -ī, -īrī), and its every present-system form is passive.
const DEP = {
  1: { inf: 'rī', drop: '-rī', pres: '-or, -āris, -ātur, -āmur, -āminī, -antur (the ā drops before -or).', impf: 'Stem + -bar, -bāris, -bātur …', fut: 'Stem + -bor, -beris, -bitur …', subj: 'The ā becomes e: -er, -ēris, -ētur …', isubj: 'Stem + -rer, -rēris, -rētur …' },
  2: { inf: 'rī', drop: '-rī', pres: '-or, -ris, -tur, -mur, -minī, -ntur.', impf: 'Stem + -bar, -bāris, -bātur …', fut: 'Stem + -bor, -beris, -bitur …', subj: 'Stem + -ar, -āris, -ātur …, the ē shortened (verear).', isubj: 'Stem + -rer, -rēris, -rētur …' },
  3: { inf: 'ī', drop: '-ī', pres: '-or, -eris, -itur, -imur, -iminī, -untur.', impf: 'Stem + -ēbar, -ēbāris …', fut: 'Stem + -ar, -ēris, -ētur …', subj: 'Stem + -ar, -āris, -ātur …', isubj: 'Stem + -erer, -erēris …' },
  '3io': { inf: 'ī', drop: '-ī', note: 'an i comes in before most vowels', pres: '-ior, -eris, -itur, -imur, -iminī, -iuntur.', impf: 'Stem + -iēbar, -iēbāris …', fut: 'Stem + -iar, -iēris …', subj: 'Stem + -iar, -iāris …', isubj: 'Stem + -erer, -erēris …' },
  4: { inf: 'rī', drop: '-rī', pres: '-or, -ris, -tur, -mur, -minī, -untur (partior, partiuntur).', impf: 'Stem + -ēbar, -ēbāris …', fut: 'Stem + -ar, -ēris …', subj: 'Stem + -ar, -āris …', isubj: 'Stem + -rer, -rēris …' },
};

function conjKeyOf(name) {
  const m = /(1st|2nd|3rd|4th) conjugation( \(-iō\))?/.exec(name ?? '');
  if (!m) return null;
  return m[1] === '3rd' ? (m[2] ? '3io' : 3) : Number(m[1][0]);
}

function verbRule(entry, table) {
  const name = conjugationName(entry);
  // The principal parts, whole: a short-form entry ("vorō -āre -āvī -ātum") has its stems in `roots`, so its
  // infinitive is the present stem + -āre and its perfect the perfect stem + -āvī (2026-10-21: vorō had no stem step).
  // A word read with an enclitic (dāve = dā + -ve) carries "+ -ue" after its parts; a part may carry a note in
  // brackets — "placēre (impersonal)", "ēsse (edere)" — which is set aside, its word kept as the other spelling.
  const lemma = bare(entry.lemma);
  const alt = [];
  const raw = lemma.split(/,\s*|\s+(?=-)/).map((x, i) => {
    const m = /^(.*?)\s*\(([^)]*)\)$/.exec(x);
    if (!m) return x;
    if (/^\p{L}+$/u.test(m[2])) alt[i] = m[2];
    return m[1];
  });
  const roots = entry.roots ?? [];
  const whole = (part, i) => {
    if (!part || !part.startsWith('-')) return part;
    const tail = part.slice(1);
    if (i === 1) return `${roots[1] ?? roots[0] ?? ''}${tail}`;
    if (i === 2) return roots[2] ? `${roots[2]}${tail.replace(/^(āv|ēv|īv|u|s|x)?/, '').replace(/^.*?(ī)$/, '$1')}` : part;
    if (i === 3) return roots[3] ? `${roots[3]}${tail.replace(/^.*?(um|us)$/, '$1')}` : part;
    return part;
  };
  const parts = raw.map(whole);
  const type = name ? `${name} verb`.replace(/ verb verb$/, ' verb') : 'verb';
  const steps = [];
  const k = conjKeyOf(name);
  const dep = entry.kind === 'dep' || entry.kind === 'semidep';
  const P = PRESENT[k];
  if (!P) {
    steps.push({ head: 'Irregular', text: 'Its forms follow no single pattern: learn them as a set. The person endings are the usual ones: -ō / -m, -s, -t, -mus, -tis, -nt.', eg: column(table, 'present indicative') });
    const pf = parts[2] ? cut(parts[2], 'ī') : null;
    if (pf) steps.push({ head: 'Perfect', stem: pf, text: `The perfect is regular: take the 3rd principal part, ${parts[2]}, and drop -ī → ${pf}-. Then ${pf}- + -ī, -istī, -it, -imus, -istis, -ērunt.`, eg: column(table, 'perfect indicative', null, 3) });
    return { kind: 'Verb', type, parts: lemma, steps };
  }
  const D = dep ? DEP[k] : null;
  const stemOf = (x) => (dep ? cut(x, D.inf) : P.stem(x));
  // edō, ēsse (edere): the stem comes from the regular infinitive when the first one is not.
  const inf = !stemOf(parts[1] ?? '') && alt[1] && stemOf(alt[1]) ? alt[1] : parts[1] ?? '';
  const s = stemOf(inf);
  const voice = dep ? 'passive' : 'active';
  const low = (t) => t.replace(/^Stem/, 'stem').replace(/^The/, 'the');
  // Each step says where its stem comes from (2026-10-23: "make sure it is saying for this conjugation, take the
  // 2nd principal part … add …"): which principal part, what comes off, what goes on.
  const conj = name ? name.replace(/^deponent,\s*/, '') : 'this conjugation';
  const st = (t) => (s ? t.replace(/\bStem\b/g, `${s}-`).replace(/\bstem\b/g, `${s}-`) : t);
  if (dep) steps.push({ head: 'Deponent', text: `Passive forms, active meaning. Three principal parts: the present (${parts[0] ?? ''}), the infinitive (${parts[1] ?? ''}) and the perfect (${parts[2] ?? ''}).` });
  const note = (dep ? D.note : P.note);
  if (s) steps.push({ head: 'Present stem', stem: s, text: `${cap(conj)}: take the 2nd principal part, ${inf}, and drop ${dep ? D.drop : P.drop} → ${s}-${note ? ` (${note})` : ''}.` });
  // dō and its compounds: the stem's a is short (da-), so the 1st conjugation's "ā" is this verb's "a".
  const shortA = k === 1 && !dep && /a$/.test(s ?? '');
  const say = (t) => (shortA ? t.replace(/ā|(?<=The |the )ā/g, 'a') : t);
  if (shortA) { const d = s.slice(0, -1); steps.push({ head: 'Short a', text: `Its a is short — ${s}mus, ${s}bam, ${inf} — except in ${d}ās, ${d}ā and ${d}āns.` }); }
  const plus = (t) => (s ? `${s}- + ${t.replace(/^Add /, '')}` : t);
  steps.push({ head: 'Present', text: dep ? plus(D.pres) : plus(say(P.pres)), eg: column(table, 'present indicative', voice) });
  steps.push({ head: 'Imperfect', text: st(dep ? D.impf : P.impf), eg: column(table, 'imperfect indicative', voice, 3) });
  steps.push({ head: 'Future', text: st(dep ? D.fut : P.fut), eg: column(table, 'future indicative', voice, 3) });
  // The 1st conjugation's present subjunctive drops the stem's ā for e: say what is left (portā- → port- + -em).
  const ae = (t) => (k === 1 && s && /ā$|a$/.test(s) ? t.replace(/becomes e: -e/, `becomes e: ${s.slice(0, -1)}- + -e`) : t);
  steps.push({ head: 'Subjunctive', text: dep ? ae(`Present: ${st(low(D.subj))} Imperfect: ${st(low(D.isubj))}`) : ae(`Present: ${st(say(low(P.subj)))} Imperfect: the 2nd principal part, ${inf}, + -m, -s, -t …`), eg: [...column(table, 'present subjunctive', voice, 2), ...column(table, 'imperfect subjunctive', voice, 1)] });
  if (!dep) {
    const pf = parts[2] ? cut(parts[2], 'ī') : null;
    if (pf) steps.push({ head: 'Perfect stem', stem: pf, text: `Take the 3rd principal part, ${parts[2]}, and drop -ī → ${pf}-. Perfect: ${pf}- + -ī, -istī, -it, -imus, -istis, -ērunt; pluperfect ${pf}- + -eram …; future perfect ${pf}- + -erō …`, eg: [...column(table, 'perfect indicative', 'active', 2), ...column(table, 'pluperfect indicative', 'active', 1)] });
    steps.push({ head: 'Passive', text: 'Present, imperfect and future: the same stem and tense sign, with the passive endings -r, -ris, -tur, -mur, -minī, -ntur.', eg: column(table, 'present indicative', 'passive', 3) });
    const sup = parts[3] ? (cut(parts[3], 'um') ?? cut(parts[3], 'us')) : null;
    if (sup) steps.push({ head: 'Perfect passive', part: `${sup}us, -a, -um`, text: `Take the 4th principal part, ${parts[3]}, and change -um to -us, -a, -um → ${sup}us; then + sum, es, est … (${sup}us sum). The tense is sum’s: perfect + sum …, pluperfect + eram …, future perfect + erō, eris, erit … — never the active’s -v- endings.`, eg: column(table, 'perfect indicative', 'passive', 2) });
  } else {
    const pp = parts[2] ? parts[2].split(' ')[0] : null;
    if (pp) steps.push({ head: 'Perfect', part: `${pp}, -a, -um`, text: `Take the 3rd principal part, ${parts[2]}: ${pp}, -a, -um + sum, es, est … The tense is sum’s: perfect + sum …, pluperfect + eram …, future perfect + erō, eris, erit ….`, eg: column(table, 'perfect indicative', voice, 2) });
  }
  return { kind: 'Verb', type, parts: lemma, steps };
}

/* ------------------------------------------------------------------ nouns */
const CASES = ['nominative', 'genitive', 'dative', 'accusative', 'ablative', 'vocative'];
const SHORT = { nominative: 'nom', genitive: 'gen', dative: 'dat', accusative: 'acc', ablative: 'abl', vocative: 'voc' };
const GENDER = { m: 'masculine', f: 'feminine', n: 'neuter', c: 'masculine or feminine' };

// A case made as stem + ending shows its ending; one that is not (rēx, nōmen) shows the whole form.
function endings(table, title, header, stem) {
  return CASES.map((cs) => { const c = cellOf(table, title, cs, header); if (!c) return null; return c.ending && c.stem === stem ? `${SHORT[cs]} -${c.ending}` : `${SHORT[cs]} ${first(c.text)}`; }).filter(Boolean).join(', ');
}

function nounRule(entry, table) {
  const name = declensionName(entry);
  if (!name) return null;
  // A noun used in one number only (castra, dīvitiae; Rōma) has that one column: its card says so and takes the
  // stem from it, rather than reading the one column as both.
  const heads = (table?.sections ?? []).find((x) => x.title === 'cases')?.headers ?? ['singular', 'plural'];
  const sg = heads.includes('singular');
  const pl = heads.includes('plural');
  const num = sg ? 'singular' : 'plural';
  const gen = cellOf(table, 'cases', 'genitive', num);
  const nom = cellOf(table, 'cases', 'nominative', num);
  const steps = [];
  const decl = name.replace(/, neuter$/, '');
  if (gen?.stem) steps.push({ head: 'Stem', stem: gen.stem, text: `${cap(decl)}: take the genitive ${num}, ${first(gen.text)} (the 2nd part of the dictionary entry), and drop -${gen.ending} → ${gen.stem}-.` });
  if (sg && nom && gen && nom.stem !== gen.stem) steps.push({ head: 'Nominative', text: `The nominative singular is the dictionary form, ${first(nom.text)}; every other case is built on the stem ${gen.stem}-.` });
  if (!sg && pl) steps.push({ head: 'Plural only', text: `Used only in the plural (${[nom, gen].filter(Boolean).map((c) => first(c.text)).join(', ')}).` });
  if (sg && !pl) steps.push({ head: 'Singular only', text: 'Used only in the singular.' });
  const base = gen?.stem ? `${gen.stem}-` : 'Stem';
  if (sg) steps.push({ head: 'Singular', text: `${base} + ${endings(table, 'cases', 'singular', gen?.stem)}.`, eg: column(table, 'cases', 'singular') });
  if (pl) steps.push({ head: 'Plural', text: `${base} + ${endings(table, 'cases', 'plural', gen?.stem)}.`, eg: column(table, 'cases', 'plural') });
  if (entry.gender === 'n') steps.push({ head: 'Neuter', text: 'The accusative is the same as the nominative, and in the plural both end in -a.' });
  if (/i-stem/.test(name)) steps.push({ head: 'i-stem', text: 'Genitive plural -ium (and, if neuter, ablative singular -ī and plural -ia).' });
  const g = GENDER[entry.gender];
  return { kind: 'Noun', type: `${name.replace(/, neuter$/, '')} noun${g ? `, ${g}` : ''}`, parts: bare(entry.lemma), steps };
}

/* ------------------------------------------------------------------ adjectives */
function adjectiveRule(entry, table) {
  const name = adjectiveName(entry);
  if (!name) return null;
  const pos = (table?.sections ?? []).find((s) => /^positive/.test(s.title ?? '')) ?? table?.sections?.[0];
  const t = pos?.title;
  const steps = [];
  const nomRow = pos?.rows?.find((r) => /nominative/.test(r.label));
  const genRow = pos?.rows?.find((r) => /genitive/.test(r.label));
  const nomEg = (nomRow?.cells ?? []).filter((c) => !c.empty).map((c) => first(c.text));
  if (/^1st\/2nd/.test(name)) {
    const f = nomRow?.cells?.[1];
    if (f?.stem) steps.push({ head: 'Stem', stem: f.stem, text: `1st/2nd declension: take the feminine, ${first(f.text)} (the 2nd dictionary form), and drop -${f.ending} → ${f.stem}-.` });
    steps.push({ head: 'Endings', text: `${f?.stem ? `${f.stem}- + ` : ''}the endings of a 2nd-declension noun for the masculine (servus), of the 1st for the feminine (puella), of the 2nd neuter for the neuter (dōnum).`, eg: nomEg });
    if (/-er/.test(name)) steps.push({ head: 'Masculine -er', text: 'The masculine nominative singular ends in -er; the other forms are built on the stem.' });
    if (/-īus/.test(name)) steps.push({ head: 'Genitive -īus', text: 'Genitive singular -īus and dative -ī, in all three genders.', eg: (genRow?.cells ?? []).filter((c) => !c.empty).map((c) => first(c.text)) });
  } else if (/no positive/.test(name)) {
    steps.push({ head: 'No positive', text: 'There is no plain form: only the comparative and the superlative, each on its own stem.' });
  } else if (/^3rd/.test(name)) {
    const g = genRow?.cells?.[0];
    if (g?.stem) steps.push({ head: 'Stem', stem: g.stem, text: `3rd declension: take the genitive, ${first(g.text)}, and drop -${g.ending} → ${g.stem}-.` });
    steps.push({ head: 'Endings', text: `${g?.stem ? `${g.stem}- + ` : ''}3rd-declension i-stem endings: ablative singular -ī, genitive plural -ium, neuter plural -ia.`, eg: nomEg });
  } else {
    steps.push({ head: 'Endings', text: 'Learn its forms from the table.', eg: nomEg });
  }
  const more = (table?.sections ?? []).filter((s) => /^(comparative|superlative)/.test(s.title ?? '')).map((s) => s.title);
  const aStem = steps.find((x) => x.head === 'Stem')?.stem;
  const sb = aStem ? `${aStem}-` : 'stem';
  // The superlative's base: the masculine itself after -er (pulcher → pulcherrimus), the stem otherwise.
  const masc = nomRow?.cells?.find((c) => !c.empty) ? first(nomRow.cells.find((c) => !c.empty).text) : '';
  const sup = /er$/.test(strip(masc)) ? `the masculine ${masc} + -rimus, -a, -um (after -er)` : /lis$/.test(strip(masc)) && ['facilis', 'difficilis', 'similis', 'dissimilis', 'gracilis', 'humilis'].includes(strip(masc)) ? `${sb} + -limus, -a, -um (one of the six in -lis)` : `${sb} + -issimus, -a, -um`;
  // A comparative not made as stem + -ior (bonus → melior) is named as irregular.
  const compEg = more.find((m) => /^comparative/.test(m))?.replace(/^comparative \((.*)\)$/, '$1') ?? '';
  const irregular = !!(aStem && compEg && !strip(compEg).startsWith(strip(`${aStem}ior`)));
  if (more.length) steps.push({ head: 'Comparison', text: `Comparative: ${sb} + -ior (m/f), -ius (n), a 3rd-declension adjective. Superlative: ${sup}; a few are irregular. ${irregular ? 'This one is irregular — this word’s:' : 'This word’s:'}`, eg: more.map((m) => m.replace(/^(comparative|superlative) \((.*)\)$/, '$2')) });
  return { kind: 'Adjective', type: name, parts: bare(entry.lemma), steps };
}

/** The type of the word a table is of, and the rule for its forms; null where there is none to give. */
export function wordRule(entry, table) {
  if (!entry || !table) return null;
  try {
    if (entry.pos === 'V' || entry.pos === 'VPAR') return verbRule(entry, table);
    if (entry.pos === 'N') return nounRule(entry, table);
    if (entry.pos === 'ADJ') return adjectiveRule(entry, table);
  } catch { /* a word the rules do not cover: no card */ }
  return null;
}

/** The card: the type, the dictionary form, the steps with this word's own forms as examples. */
export function ruleCard(rule, { open = true, heading = 'How it’s made' } = {}) {
  if (!rule) return null;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const card = el('details', 'wr');
  card.open = open;
  const sum = el('summary', 'wr__sum');
  const type = el('span', 'wr__type', rule.type);
  const parts = el('span', 'wr__parts', rule.parts ?? '');
  parts.lang = 'la';
  sum.append(el('span', 'wr__head', heading), type, parts);
  const list = el('ol', 'wr__steps');
  for (const st of rule.steps) {
    const li = el('li', 'wr__step');
    li.append(el('span', 'wr__stephead', st.head), el('span', 'wr__text', st.text));
    if (st.eg?.length) { const eg = el('span', 'wr__eg', st.eg.join(', ')); eg.lang = 'la'; li.append(eg); }
    list.append(li);
  }
  card.append(sum, list);
  return card;
}

/**
 * The rule for one skill (2026-10-21: "explain how a form is made — it might change between the types: 1st, 2nd,
 * 3rd conjugation … a word with an a or an e"): of a word's steps, the ones that make the skill's forms, with the
 * stem they start from — the imperfect's step for an imperfect skill (amō keeps its ā and adds -bam; regō adds
 * -ēbam), the subjunctive's for a subjunctive (amō's ā becomes e; moneō adds -am). A table of one skill on Sheets
 * or a skill's whole table shows this, open, so the words side by side show how their types differ. The whole rule
 * when the skill names nothing the steps divide by (an infinitive, a participle, a declension's every case). Pure.
 */
export function focusRule(rule, skill) {
  if (!rule || !skill) return rule;
  if (Array.isArray(skill)) {
    // Several skills (a chapter's Word Work): every step any of them needs, in the rule's order; the whole rule
    // as soon as one of them asks for it.
    // A skill about another kind of word (an adjective's comparison beside a verb's tenses) says nothing here.
    const fits = (sk) => {
      const f = [].concat(sk?.parse_filter ?? []).find((x) => x && (x.tense || x.mood || x.case || x.degree || x.voice)) ?? null;
      if (!f) return false;
      const verbal = !!(f.tense || f.mood || f.voice) && !f.degree && !(f.case && !f.mood);
      const pos = [].concat(f.pos ?? []);
      if (pos.length && !pos.some((x) => (x === 'V' && rule.kind === 'Verb') || (x === 'N' && rule.kind === 'Noun') || (x === 'ADJ' && rule.kind === 'Adjective'))) return false;
      return rule.kind === 'Verb' ? verbal : !verbal;
    };
    const parts = skill.filter(fits).map((sk) => focusRule(rule, sk));
    if (!parts.length || parts.some((r) => r === rule)) return rule;
    const heads = new Set(parts.flatMap((r) => r.steps.map((s) => s.head)));
    const byHead = new Map(parts.flatMap((r) => r.steps.map((s) => [s.head, s])));
    return { ...rule, steps: rule.steps.map((s) => byHead.get(s.head) ?? s).filter((s) => heads.has(s.head)).concat([...byHead.values()].filter((s) => !rule.steps.some((t) => t.head === s.head))), focus: skill.map((sk) => sk.title).join(' · ') };
  }
  const f = [].concat(skill.parse_filter ?? []).find((x) => x && (x.tense || x.mood || x.case || x.degree || x.voice)) ?? null;
  if (!f) return rule;
  const has = (k, v) => [].concat(f[k] ?? []).map(String).includes(v);
  const want = new Set(['Deponent', 'Irregular', 'Short a']);   // said on every card of the word
  if (rule.kind === 'Verb') {
    const perfectish = ['perf', 'plupf', 'futperf'].some((t) => has('tense', t));
    const passive = has('voice', 'pass');
    const dep = rule.steps.some((s) => s.head === 'Deponent');
    if (has('mood', 'subj') && perfectish) return perfectSubjunctive(rule, has, dep, skill.title);
    if (has('mood', 'subj')) { want.add('Subjunctive'); if (dep || !has('tense', 'impf') || has('tense', 'pres')) want.add('Present stem'); }
    else if (perfectish) { if (passive) want.add('Perfect passive'); else want.add('Perfect stem'); want.add('Perfect'); }
    else if (!f.mood || has('mood', 'ind')) {
      // A passive skill on an ordinary verb is the passive step (its tense steps are the active's); a deponent's
      // tense steps are already passive, so they stand.
      want.add('Present stem');
      if (passive && !dep) {
        // …with the tense's own step where the tense has a sign that differs by type (-ba-, -ēba-, -bi-, -ē-).
        want.add('Passive');
        if (has('tense', 'impf')) want.add('Imperfect');
        if (has('tense', 'fut')) want.add('Future');
      } else {
        if (has('tense', 'pres') || !f.tense) want.add('Present');
        if (has('tense', 'impf')) want.add('Imperfect');
        if (has('tense', 'fut')) want.add('Future');
      }
    } else return rule;   // a command, an infinitive, a participle: the whole rule
  } else if (rule.kind === 'Adjective' && (has('degree', 'comp') || has('degree', 'super'))) {
    want.add('Stem'); want.add('Comparison');
  } else return rule;     // a noun's or an adjective's cases: its every step is about them
  let steps = rule.steps.filter((s) => want.has(s.head));
  // The subjunctive step says the present and the imperfect together; a skill of one of them keeps its own half.
  const onlyPres = has('tense', 'pres') && !has('tense', 'impf');
  const onlyImpf = has('tense', 'impf') && !has('tense', 'pres');
  if (rule.kind === 'Verb' && has('mood', 'subj') && (onlyPres || onlyImpf)) {
    steps = steps.map((s) => {
      if (s.head !== 'Subjunctive' || !/ Imperfect: /.test(s.text)) return s;
      const [pres, impf] = s.text.split(/ Imperfect: /);
      const eg = s.eg ?? [];
      return onlyPres
        ? { ...s, head: 'Present subjunctive', text: pres.replace(/^Present: /, '').replace(/^the /, 'The ').replace(/^stem/, 'Stem'), eg: eg.slice(0, Math.max(1, eg.length - 1)) }
        : { ...s, head: 'Imperfect subjunctive', text: impf.replace(/^the /, 'The ').replace(/^stem/, 'Stem'), eg: eg.slice(-1) };
    });
  }
  return steps.length ? { ...rule, steps, focus: skill.title } : rule;
}

// The perfect and pluperfect subjunctive: the active from the perfect stem (amāv- + -erim; amāvisse + -m), the
// passive and a deponent's from the participle (amātus, hortātus + sim / essem). The rule's own perfect steps say
// the indicative, so these are built from the stem and the participle they name.
function perfectSubjunctive(rule, has, dep, title) {
  const perf = has('tense', 'perf');
  const plupf = has('tense', 'plupf');
  const both = perf === plupf;
  const find = (head) => rule.steps.find((s) => s.head === head);
  const steps = rule.steps.filter((s) => s.head === 'Deponent' || s.head === 'Irregular');
  const stepActive = find('Perfect stem') ?? (!dep ? find('Perfect') : null);
  const pf = stepActive?.stem ?? null;
  const partStep = dep ? find('Perfect') : find('Perfect passive');
  const part = partStep?.part ?? null;
  const active = !dep && (has('voice', 'act') || !has('voice', 'pass'));
  const passive = dep || has('voice', 'pass') || !has('voice', 'act');
  const name = both ? 'Perfect and pluperfect subjunctive' : perf ? 'Perfect subjunctive' : 'Pluperfect subjunctive';
  if (active && pf) {
    const pe = `the perfect stem ${pf}- + -erim, -eris, -erit, -erimus, -eritis, -erint`;
    const pl = `the perfect infinitive ${pf}isse + -m, -s, -t, -mus, -tis, -nt`;
    const text = both ? `Perfect: ${pe}. Pluperfect: ${pl}.` : `${(perf ? pe : pl).replace(/^the/, 'The')}.`;
    steps.push({ head: name, text, eg: [perf ? `${pf}erim` : null, plupf ? `${pf}issem` : null].filter(Boolean) });
  }
  if (passive && part) {
    const ends = [perf ? 'sim, sīs, sit …' : null, plupf ? 'essem, essēs, esset …' : null].filter(Boolean);
    steps.push({ head: dep ? name : `${name}, passive`, text: `${part} + ${ends.join(' (perfect); ')}${both ? ' (pluperfect)' : ''}.` });
  }
  return steps.length ? { ...rule, steps, focus: title } : rule;
}

/**
 * How one form is made (2026-10-21: "a question mark for each to pop up how it's made for that particular word,
 * before the Show button"): of the word's steps, those that make this cell — a verb's by its tense, mood and voice
 * (focusRule), a noun's by its number, an adjective's comparative or superlative by its degree. The examples are
 * left out: they are the answers (`examples` keeps them, for the card a game opens on). `key` is the paradigm cell's
 * key (paradigms.js). Pure.
 */
// The forms outside the person tables, said once: [kind, tense, voice] → how, and the step it builds on.
const NONFINITE = [
  ['inf', 'pres', 'act', 'The present infinitive: the 2nd principal part.', 'Present stem'],
  ['inf', 'pres', 'pass', 'The present passive infinitive: the active’s -re becomes -rī (3rd conjugation: -ere becomes -ī).', 'Present stem'],
  ['inf', 'perf', 'act', 'The perfect infinitive: perfect stem + -isse.', 'Perfect stem'],
  ['inf', 'perf', 'pass', 'The perfect passive infinitive: the perfect participle + esse.', 'Perfect passive'],
  ['inf', 'fut', 'act', 'The future infinitive: the future participle (-ūrus) + esse.', 'Perfect passive'],
  ['inf', 'fut', 'pass', 'The future passive infinitive: the supine (-um) + īrī.', 'Perfect passive'],
  ['imper', 'pres', 'act', 'The command: the present stem alone to one person (3rd conjugation + -e), + -te to more than one.', 'Present stem'],
  ['imper', 'pres', 'pass', 'The passive (and deponent) command: stem + -re to one person, + -minī to more than one.', 'Present stem'],
  ['imper', 'fut', 'act', 'The future command: stem + -tō (you / he), -tōte (you all), -ntō (they).', 'Present stem'],
  ['ptc', 'pres', 'act', 'The present participle: stem + -ns (genitive -ntis), a 3rd-declension adjective.', 'Present stem'],
  ['ptc', 'perf', 'pass', 'The perfect participle: from the 4th principal part, -us, -a, -um.', 'Perfect passive'],
  ['ptc', 'fut', 'act', 'The future participle: the perfect participle’s stem + -ūrus, -a, -um.', 'Perfect passive'],
  ['gerund', null, null, 'The gerund (the verb as a noun, “-ing”): stem + -nd- + -ī, -ō, -um.', 'Present stem'],
  ['gerundive', null, null, 'The gerundive (“to be …-ed”): stem + -ndus, -a, -um.', 'Present stem'],
  ['supine', null, null, 'The supine: the 4th principal part, -um (and -ū).', 'Perfect passive'],
];

export function formRule(rule, key, { examples = false } = {}) {
  if (!rule || !key) return null;
  let out = rule;
  const nf = rule.kind === 'Verb' ? NONFINITE.find(([k, t, v]) => k === key.kind && (t == null || t === key.tense) && (v == null || v === key.voice)) : null;
  if (rule.kind === 'Verb' && key.kind === 'finite') {
    out = focusRule(rule, { title: '', parse_filter: [{ tense: key.tense, mood: key.mood, voice: key.voice }] });
    // A passive subjunctive is the active's way with the passive endings: both steps.
    const pass = rule.steps.find((s) => s.head === 'Passive');
    if (key.voice === 'pass' && key.mood === 'subj' && pass && !['perf', 'plupf'].includes(key.tense) && !out.steps.includes(pass)) out = { ...out, steps: [...out.steps, pass] };
  } else if (nf) {
    // A deponent's (and an irregular's) participle or perfect is its step headed Perfect.
    const base = rule.steps.find((s) => s.head === nf[4]) ?? (nf[4] !== 'Present stem' ? rule.steps.find((s) => s.head === 'Perfect') : null);
    out = { ...rule, steps: [...rule.steps.filter((s) => ['Deponent', 'Irregular', 'Short a'].includes(s.head)), ...(base ? [base] : []), { head: 'This form', text: nf[3] }] };
  } else if (rule.kind === 'Noun' && key.number) {
    const keep = new Set(['Stem', 'Plural only', 'Singular only', 'Neuter', 'i-stem', key.number === 'pl' ? 'Plural' : 'Singular']);
    if (key.number === 'sg') keep.add('Nominative');
    out = { ...rule, steps: rule.steps.filter((s) => keep.has(s.head)) };
  } else if (rule.kind === 'Adjective' && (key.degree === 'comp' || key.degree === 'super')) {
    out = focusRule(rule, { title: '', parse_filter: [{ degree: key.degree }] });
  }
  // Without the examples, a step that ended by pointing at them ("This word's:") ends at its rule.
  if (examples) return out;
  return { ...out, steps: out.steps.map(({ eg, ...st }) => ({ ...st, text: st.text.replace(/\s*This word’s:\s*$/, '').replace(/ — this word’s:\s*$/, '.') })) };
}

/* ------------------------------------------------------------ a skill's own rule, for any verb */
/**
 * How to make a skill's forms from the principal parts, for every conjugation, with no one word in it
 * (2026-10-23: "it does not tell here how to form the verb from the principal parts. Have this everywhere …
 * say which principal part to start with and then how to transform it per conjugation"). Shown above a question
 * as well as beside a table, so it names no word the question could be about: the rule, never a form.
 *
 * skillHow(skill) → { kind: 'Verb', type, parts: '', steps: [{ head, text }] } | null (not a verb skill).
 * The per-conjugation lines are the same strings the word cards use (PRESENT, DEP), so the two never disagree;
 * conjugations that make the form alike are said once ("1st, 2nd: …").
 */
const CONJ_NAME = { 1: '1st (-āre)', 2: '2nd (-ēre)', 3: '3rd (-ere)', '3io': '3rd -iō (capiō)', 4: '4th (-īre)' };
const DEP_NAME = { 1: '1st (-ārī)', 2: '2nd (-ērī)', 3: '3rd (-ī)', '3io': '3rd -iō (patior)', 4: '4th (-īrī)' };
const CONJ_KEYS = [1, 2, 3, '3io', 4];
const PERFECT_ENDS = {
  perf: { ind: 'Perfect: + -ī, -istī, -it, -imus, -istis, -ērunt', subj: 'Perfect subjunctive: + -erim, -eris, -erit, -erimus, -eritis, -erint' },
  plupf: { ind: 'Pluperfect: + -eram, -erās, -erat, -erāmus, -erātis, -erant', subj: 'Pluperfect subjunctive: + -issem, -issēs, -isset … (the perfect infinitive + -m, -s, -t)' },
  futperf: { ind: 'Future perfect: + -erō, -eris, -erit, -erimus, -eritis, -erint' },
};
const PASSIVE_AUX = { perf: { ind: 'sum, es, est …', subj: 'sim, sīs, sit …' }, plupf: { ind: 'eram, erās, erat …', subj: 'essem, essēs, esset …' }, futperf: { ind: 'erō, eris, erit …' } };

/**
 * The irregular verbs' own rules (2026-10-23: the irregular verbs' "How to make it" told the regular conjugations
 * only). Each says where its stem comes from and what goes on it, never the whole table: the card can sit above a
 * question. Keyed as skills.json names the tables.
 */
const IRREG = {
  sum: { name: 'sum, esse, fuī', pres: 'su- + -m, -mus, -nt; es- alone for you (sg.), es- + -t, -tis — no vowel between.', impf: 'er- + -am, -ās, -at, -āmus, -ātis, -ant.', fut: 'er- + -ō, -is, -it, -imus, -itis, -unt.', subj: 's- + -im, -īs, -it, -īmus, -ītis, -int.', inf: 'esse', perf: 'fu- (fuī)', imper: 'Commands: es, este; the future estō, estōte, suntō.' },
  possum: { name: 'possum, posse, potuī', pres: 'pot- (able) + the forms of sum; pot- becomes pos- before an s.', impf: 'pot- + the imperfect of sum (er- + -am …).', fut: 'pot- + the future of sum (er- + -ō …).', subj: 'pos- + the subjunctive of sum (s- + -im …).', inf: 'posse', perf: 'potu- (potuī)' },
  eo: { name: 'eō, īre, iī', pres: 'the stem ī- (from īre) + -s, -t, -mus, -tis; it becomes e- before a vowel (-ō, -unt).', impf: 'ī- + -bam, -bās, -bat … (like the 1st and 2nd).', fut: 'ī- + -bō, -bis, -bit … -bunt (like the 1st and 2nd).', subj: 'e- + -am, -ās, -at …', inf: 'īre', perf: 'i- (iī; also īv-, īvī)', imper: 'Commands: ī, īte.' },
  fero: { name: 'ferō, ferre, tulī, lātum', pres: 'fer- + the 3rd conjugation’s endings, but no vowel before -s, -t, -tis (and in the passive -ris, -tur).', impf: 'fer- + -ēbam, -ēbās … (like the 3rd).', fut: 'fer- + -am, -ēs, -et … (like the 3rd).', subj: 'fer- + -am, -ās, -at …', inf: 'ferre (passive ferrī)', perf: 'tul- (tulī); the participle lātus', imper: 'Commands: fer, ferte.' },
  volo: { name: 'volō, velle, voluī', pres: 'vol- + -ō, -umus, -unt; you (sg.), he and you (pl.) have their own: vīs, vult, vultis.', impf: 'vol- + -ēbam, -ēbās …', fut: 'vol- + -am, -ēs, -et …', subj: 'vel- + -im, -īs, -it, -īmus, -ītis, -int.', inf: 'velle', perf: 'volu- (voluī)' },
  nolo: { name: 'nōlō, nōlle, nōluī', pres: 'nē + volō: nōl- where volō has vol- (I, we, they); nōn + volō’s own forms for the rest.', impf: 'nōl- + -ēbam, -ēbās …', fut: 'nōl- + -am, -ēs, -et …', subj: 'nōl- + -im, -īs, -it …', inf: 'nōlle', perf: 'nōlu- (nōluī)', imper: 'Commands: nōlī (to one), nōlīte (to more) + an infinitive — “don’t …”.' },
  malo: { name: 'mālō, mālle, māluī', pres: 'magis + volō: māl- where volō has vol- (I, we, they); mā- in front of volō’s own forms for the rest.', impf: 'māl- + -ēbam, -ēbās …', fut: 'māl- + -am, -ēs, -et …', subj: 'māl- + -im, -īs, -it …', inf: 'mālle', perf: 'mālu- (māluī)' },
  fio: { name: 'fīō, fierī, factus sum', pres: 'fī- + -ō, -s, -t, -mus, -tis, -unt: the passive of faciō, with active endings.', impf: 'fī- + -ēbam, -ēbās …', fut: 'fī- + -am, -ēs, -et …', subj: 'fī- + -am, -ās, -at …', inf: 'fierī', isubj: 'fier- + -em, -ēs, -et …', perf: 'none of its own: factus sum, from faciō' },
};
/** The irregular verbs' steps for the tenses and moods a skill asks for. */
function irregularSteps(ids, { tenses, moods, presentSystem, perfectSystem, finite, alone }) {
  const want = (t) => !tenses.length || tenses.includes(t);
  const ind = !moods.length || moods.includes('ind');
  const subj = moods.includes('subj');
  const out = [];
  if (alone) out.push({ head: 'Start', text: `These verbs follow no one conjugation: learn each from its own principal parts (${ids.map((id) => IRREG[id].name.split(',').slice(0, 2).join(',')).join('; ')}). The person endings are the usual ones: -ō or -m, -s, -t, -mus, -tis, -nt.` });
  for (const id of ids) {
    const v = IRREG[id];
    const bits = [];
    if (finite && presentSystem) {
      if (ind && want('pres') && v.pres) bits.push(`Present: ${v.pres}`);
      if (ind && want('impf') && v.impf) bits.push(`Imperfect: ${v.impf}`);
      if (ind && want('fut') && v.fut) bits.push(`Future: ${v.fut}`);
      if (subj && want('pres') && v.subj) bits.push(`Present subjunctive: ${v.subj}`);
      if (subj && want('impf')) bits.push(`Imperfect subjunctive: ${v.isubj ?? `${v.inf.split(' ')[0]} + -m, -s, -t …`}`);
    }
    if (perfectSystem && v.perf) bits.push(`Perfect stem: ${v.perf}${/^none/.test(v.perf) ? '' : ' — then as every verb'}.`);
    if (moods.includes('inf')) bits.push(`Infinitive: ${v.inf}.`);
    if (moods.includes('imper') && v.imper) bits.push(v.imper);
    if (bits.length) out.push({ head: v.name.split(',')[0], text: bits.join(' ') });
  }
  return out;
}

export function skillHow(skill) {
  if (skill?.id === 'principal-parts') {
    return { kind: 'Verb', type: 'How to make it', parts: '', steps: [{ head: 'The four parts', text: '1st: the present (I …). 2nd: the infinitive (to …) — the present stem comes from it. 3rd: the perfect (I have …, I did) — the perfect stem comes from it. 4th: the supine (-um) — the perfect participle (-us, -a, -um) and the future participle (-ūrus) come from it.' }] };
  }
  const filters = [].concat(skill?.parse_filter ?? []).filter(Boolean);
  const f = filters.find((x) => x.tense || x.mood || x.voice || x.deponent) ?? null;
  const verbish = f && !f.case && !f.degree && ![].concat(f.pos ?? []).some((p) => p === 'N' || p === 'ADJ' || p === 'PRON');
  const conjTables = (skill?.paradigms ?? []).filter((id) => /^conj/.test(id));
  if (!verbish && !(conjTables.length && [].concat(f?.pos ?? []).includes('V'))) return null;
  const list = (v) => [].concat(v ?? []).map(String);
  const tenses = list(f?.tense);
  const moods = list(f?.mood);
  const voices = list(f?.voice);
  const dep = f?.deponent === true;
  const has = (arr, v) => arr.includes(v);
  const steps = [];
  const byConj = (pick) => {
    const groups = new Map();
    for (const k of CONJ_KEYS) {
      const t = pick(k);
      if (!t) continue;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(dep ? DEP_NAME[k] : CONJ_NAME[k]);
    }
    return [...groups].map(([text, names]) => ({ head: names.join(', '), text }));
  };
  const presStart = dep
    ? 'Start from the 2nd principal part (the infinitive) and drop -rī (1st, 2nd, 4th) or -ī (3rd): what is left is the present stem.'
    : 'Start from the 2nd principal part (the infinitive) and drop -re (1st, 2nd, 4th) or -ere (3rd): what is left is the present stem — it ends in ā (1st), ē (2nd), ī (4th), or a consonant (3rd).';
  const perfStart = 'Start from the 3rd principal part (the perfect) and drop -ī: what is left is the perfect stem — made the same way in every conjugation.';
  const supStart = dep
    ? 'Start from the 3rd principal part (…-us sum): its participle in -us, -a, -um.'
    : 'Start from the 4th principal part (the supine, -um) and change -um to -us, -a, -um: the perfect participle.';
  const presentSystem = !tenses.length || tenses.some((t) => ['pres', 'impf', 'fut'].includes(t));
  const perfectSystem = tenses.some((t) => ['perf', 'plupf', 'futperf'].includes(t));
  const passive = dep || has(voices, 'pass');
  const active = !dep && (!voices.length || has(voices, 'act'));
  const finite = !moods.length || moods.some((m) => m === 'ind' || m === 'subj');

  // Forms outside the person tables: each from the part it starts from. A deponent has no active present or perfect
  // infinitive (its forms are passive), and keeps its future one.
  const nonfinite = [];
  if (moods.some((m) => ['imper', 'inf', 'ptc', 'gerund', 'gerundive', 'supine'].includes(m))) {
    const nf = NONFINITE.filter(([kind, t, v]) => moods.includes(kind) && (!tenses.length || t == null || tenses.includes(t))
      && (dep ? (v !== 'act' || t === 'fut' || kind === 'ptc') && !(kind === 'inf' && t === 'fut' && v === 'pass') && !(kind === 'imper' && v === 'act') : (!voices.length || v == null || voices.includes(v))));
    const say = (x) => {
      if (x[0] === 'ptc' && x[1] === 'perf') return dep ? 'With sum, es, est … it makes the deponent’s perfect (…-us est, …-ī sunt), active in meaning.' : 'With sum, es, est … it makes the perfect passive (…-us est, …-ī sunt).';
      if (dep && x[0] === 'inf' && x[1] === 'pres') return 'The present infinitive: the 2nd principal part itself (-ārī, -ērī, -ī, -īrī).';
      return x[3];
    };
    const supineOnly = moods.length === 1 && moods[0] === 'supine';
    const starts = [['Present stem', presStart], ['Perfect stem', perfStart], ['Perfect passive', supineOnly ? 'Start from the 4th principal part (the supine, -um).' : supStart]];
    for (const [base, text] of starts) {
      const these = nf.filter((x) => x[4] === base);
      if (!these.length) continue;
      nonfinite.push({ head: 'Start', text });
      // The perfect participle *is* the start: said once, with what it makes.
      for (const x of these) nonfinite.push({ head: 'Then', text: say(x) });
    }
  }
  if (!finite) {
    const irrNf = (skill?.paradigms ?? []).filter((id) => IRREG[id]);
    const own = irrNf.length ? irregularSteps(irrNf, { tenses, moods, presentSystem: false, perfectSystem: false, finite, alone: false }) : [];
    if (irrNf.length && !conjTables.length && own.length) return { kind: 'Verb', type: 'How to make it', parts: '', steps: own };
    const all = [...nonfinite, ...own];
    return all.length ? { kind: 'Verb', type: 'How to make it', parts: '', steps: all } : null;
  }
  if (presentSystem && (tenses.length ? tenses.some((t) => ['pres', 'impf', 'fut'].includes(t)) : true)) {
    steps.push({ head: 'Start', text: presStart });
    const subj = has(moods, 'subj');
    const ind = !moods.length || has(moods, 'ind');
    const want = (t) => !tenses.length || tenses.includes(t);
    const T = (k) => (passive ? DEP[k] : PRESENT[k]);
    const clean = (t) => String(t ?? '').replace(/^Add /, '+ ').replace(/^Stem \+/, '+').replace(/^-/, '+ -');
    if (ind && want('pres')) { if (!dep && passive && active) steps.push(...byConj((k) => `Present: ${clean(PRESENT[k].pres)}`)); steps.push(...byConj((k) => `Present${passive && !dep ? ' passive' : ''}: ${clean(T(k).pres)}`)); }
    if (ind && want('impf')) steps.push(...byConj((k) => `Imperfect${passive && !dep ? ' passive' : ''}: ${clean(T(k).impf)}`));
    if (ind && want('fut')) steps.push(...byConj((k) => `Future${passive && !dep ? ' passive' : ''}: ${clean(T(k).fut)}`));
    if (subj && want('pres')) steps.push(...byConj((k) => `Present subjunctive: ${clean(T(k).subj).replace(/^The /, 'the ')}`));
    if (subj && want('impf')) steps.push({ head: 'Every conjugation', text: passive ? 'Imperfect subjunctive: the 2nd principal part (the active infinitive, -re) + -r, -ris, -tur, -mur, -minī, -ntur.' : 'Imperfect subjunctive: the 2nd principal part (the infinitive) + -m, -s, -t, -mus, -tis, -nt.' });
    if (passive && !dep && ind) steps.push({ head: 'Passive', text: 'The same stem and tense sign as the active, with the passive endings -r, -ris, -tur, -mur, -minī, -ntur.' });
  }
  if (perfectSystem) {
    const mood = has(moods, 'subj') ? 'subj' : 'ind';
    if (active) {
      steps.push({ head: 'Start', text: perfStart });
      for (const t of ['perf', 'plupf', 'futperf']) if (tenses.includes(t) && PERFECT_ENDS[t][mood]) steps.push({ head: 'Every conjugation', text: PERFECT_ENDS[t][mood] });
    }
    if (passive || !voices.length) {
      steps.push({ head: active ? 'Passive' : 'Start', text: active ? `For the passive: ${supStart[0].toLowerCase()}${supStart.slice(1)}` : supStart });
      for (const t of ['perf', 'plupf', 'futperf']) if (tenses.includes(t) && PASSIVE_AUX[t][mood]) steps.push({ head: 'Every conjugation', text: `The participle + ${PASSIVE_AUX[t][mood]}` });
    }
  }
  steps.push(...nonfinite.filter((x) => !(x.head === 'Start' && steps.some((y) => y.text === x.text))));
  // The irregular verbs a skill lists: their own rules — instead of the conjugations' when it lists only them.
  const irr = (skill?.paradigms ?? []).filter((id) => IRREG[id]);
  if (irr.length) {
    const alone = !conjTables.length;
    const own = irregularSteps(irr, { tenses, moods, presentSystem, perfectSystem, finite, alone });
    if (alone && own.length) return { kind: 'Verb', type: 'How to make it', parts: '', steps: own };
    steps.push(...own);
  }
  return steps.length ? { kind: 'Verb', type: 'How to make it', parts: '', steps } : null;
}
