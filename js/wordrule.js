// What kind of word a table is of, and the rule that makes its forms (the learner, 2026-10-20: "I want to know for
// any word what conjugation/word type it is and the rule used for getting the forms — maybe this should come at the
// beginning of each form table that is practiced").
//
// wordRule(entry, table) → { kind, type, parts, steps: [{ head, text, eg }] } | null. The rule is said once per
// type (a conjugation, a declension, a kind of adjective), with this word's own stems in it; every example (`eg`)
// is read off the word's own table, so what the card shows is always what the table asks. ruleCard(rule) draws it.

import { conjugationName, declensionName, adjectiveName } from './paradigms.js';

const strip = (s) => String(s ?? '').normalize('NFD').replace(/\p{Mn}/gu, '');
const cut = (word, tail) => (strip(word).endsWith(strip(tail)) ? word.slice(0, word.length - tail.length) : null);
const first = (t) => String(t ?? '').split(' / ')[0];

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
  1: { stem: (inf) => cut(inf, 're'), from: 'the infinitive without -re',
    pres: 'Add -ō, -s, -t, -mus, -tis, -nt (the ā drops before -ō).', impf: 'Stem + -bam, -bās, -bat …', fut: 'Stem + -bō, -bis, -bit …', subj: 'The ā becomes e: -em, -ēs, -et …' },
  2: { stem: (inf) => cut(inf, 're'), from: 'the infinitive without -re',
    pres: 'Add -ō, -s, -t, -mus, -tis, -nt.', impf: 'Stem + -bam, -bās, -bat …', fut: 'Stem + -bō, -bis, -bit …', subj: 'Stem + -am, -ās, -at …, the ē shortened (moneam).' },
  3: { stem: (inf) => cut(inf, 'ere'), from: 'the infinitive without -ere',
    pres: 'Add -ō, -is, -it, -imus, -itis, -unt.', impf: 'Stem + -ēbam, -ēbās, -ēbat …', fut: 'Stem + -am, -ēs, -et, -ēmus …', subj: 'Stem + -am, -ās, -at …' },
  '3io': { stem: (inf) => cut(inf, 'ere'), from: 'the infinitive without -ere — an i comes in before most vowels',
    pres: 'Add -iō, -is, -it, -imus, -itis, -iunt.', impf: 'Stem + -iēbam, -iēbās …', fut: 'Stem + -iam, -iēs, -iet …', subj: 'Stem + -iam, -iās, -iat …' },
  4: { stem: (inf) => cut(inf, 're'), from: 'the infinitive without -re',
    pres: 'Add -ō, -s, -t, -mus, -tis, -unt (audiō, audiunt).', impf: 'Stem + -ēbam, -ēbās …, the ī shortened (audiēbam).', fut: 'Stem + -am, -ēs, -et …, the ī shortened.', subj: 'Stem + -am, -ās, -at …, the ī shortened.' },
};
// A deponent's infinitive is passive (-ārī, -ērī, -ī, -īrī), and its every present-system form is passive.
const DEP = {
  1: { inf: 'rī', from: 'the infinitive without -rī', pres: '-or, -āris, -ātur, -āmur, -āminī, -antur (the ā drops before -or).', impf: 'Stem + -bar, -bāris, -bātur …', fut: 'Stem + -bor, -beris, -bitur …', subj: 'The ā becomes e: -er, -ēris, -ētur …', isubj: 'Stem + -rer, -rēris, -rētur …' },
  2: { inf: 'rī', from: 'the infinitive without -rī', pres: '-or, -ris, -tur, -mur, -minī, -ntur.', impf: 'Stem + -bar, -bāris, -bātur …', fut: 'Stem + -bor, -beris, -bitur …', subj: 'Stem + -ar, -āris, -ātur …, the ē shortened (verear).', isubj: 'Stem + -rer, -rēris, -rētur …' },
  3: { inf: 'ī', from: 'the infinitive without -ī', pres: '-or, -eris, -itur, -imur, -iminī, -untur.', impf: 'Stem + -ēbar, -ēbāris …', fut: 'Stem + -ar, -ēris, -ētur …', subj: 'Stem + -ar, -āris, -ātur …', isubj: 'Stem + -erer, -erēris …' },
  '3io': { inf: 'ī', from: 'the infinitive without -ī', pres: '-ior, -eris, -itur, -imur, -iminī, -iuntur.', impf: 'Stem + -iēbar, -iēbāris …', fut: 'Stem + -iar, -iēris …', subj: 'Stem + -iar, -iāris …', isubj: 'Stem + -erer, -erēris …' },
  4: { inf: 'rī', from: 'the infinitive without -rī', pres: '-or, -ris, -tur, -mur, -minī, -untur (partior, partiuntur).', impf: 'Stem + -ēbar, -ēbāris …', fut: 'Stem + -ar, -ēris …', subj: 'Stem + -ar, -āris …', isubj: 'Stem + -rer, -rēris …' },
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
  const raw = String(entry.lemma ?? '').split(/,\s*|\s+(?=-)/);
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
    if (pf) steps.push({ head: 'Perfect', text: `The perfect is regular: stem ${pf}- (${parts[2]} without -ī) + -ī, -istī, -it, -imus, -istis, -ērunt.`, eg: column(table, 'perfect indicative', null, 3) });
    return { kind: 'Verb', type, parts: entry.lemma, steps };
  }
  const inf = parts[1] ?? '';
  const D = dep ? DEP[k] : null;
  const s = dep ? cut(inf, D.inf) : P.stem(inf);
  const voice = dep ? 'passive' : 'active';
  const low = (t) => t.replace(/^Stem/, 'stem').replace(/^The/, 'the');
  if (dep) steps.push({ head: 'Deponent', text: 'Passive forms, active meaning. Three parts: the present, the infinitive and the perfect.' });
  if (s) steps.push({ head: 'Present stem', text: `${s}- (${inf}, ${dep ? D.from : P.from}).` });
  steps.push({ head: 'Present', text: dep ? `Add ${D.pres}` : P.pres, eg: column(table, 'present indicative', voice) });
  steps.push({ head: 'Imperfect', text: dep ? D.impf : P.impf, eg: column(table, 'imperfect indicative', voice, 3) });
  steps.push({ head: 'Future', text: dep ? D.fut : P.fut, eg: column(table, 'future indicative', voice, 3) });
  steps.push({ head: 'Subjunctive', text: dep ? `Present: ${low(D.subj)} Imperfect: ${low(D.isubj)}` : `Present: ${low(P.subj)} Imperfect: the infinitive ${inf} + -m, -s, -t …`, eg: [...column(table, 'present subjunctive', voice, 2), ...column(table, 'imperfect subjunctive', voice, 1)] });
  if (!dep) {
    const pf = parts[2] ? cut(parts[2], 'ī') : null;
    if (pf) steps.push({ head: 'Perfect stem', text: `${pf}- (${parts[2]} without -ī). Perfect -ī, -istī, -it, -imus, -istis, -ērunt; pluperfect -eram …; future perfect -erō …`, eg: [...column(table, 'perfect indicative', 'active', 2), ...column(table, 'pluperfect indicative', 'active', 1)] });
    steps.push({ head: 'Passive', text: 'Present, imperfect and future: the endings -r, -ris, -tur, -mur, -minī, -ntur.', eg: column(table, 'present indicative', 'passive', 3) });
    const sup = parts[3] ? (cut(parts[3], 'um') ?? cut(parts[3], 'us')) : null;
    if (sup) steps.push({ head: 'Perfect passive', text: `${sup}us, -a, -um (from ${parts[3]}) + sum, es, est …`, eg: column(table, 'perfect indicative', 'passive', 2) });
  } else {
    const pp = parts[2] ? parts[2].split(' ')[0] : null;
    if (pp) steps.push({ head: 'Perfect', text: `${pp}, -a, -um + sum, es, est …`, eg: column(table, 'perfect indicative', voice, 2) });
  }
  return { kind: 'Verb', type, parts: entry.lemma, steps };
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
  const gen = cellOf(table, 'cases', 'genitive', 'singular');
  const nom = cellOf(table, 'cases', 'nominative', 'singular');
  const steps = [];
  if (gen?.stem) steps.push({ head: 'Stem', text: `${gen.stem}- (the genitive singular ${first(gen.text)} without -${gen.ending}).` });
  if (nom && gen && nom.stem !== gen.stem) steps.push({ head: 'Nominative', text: `The nominative singular is the dictionary form, ${first(nom.text)}; every other case is built on the stem ${gen.stem}-.` });
  steps.push({ head: 'Singular', text: `Stem + ${endings(table, 'cases', 'singular', gen?.stem)}.`, eg: column(table, 'cases', 'singular') });
  steps.push({ head: 'Plural', text: `Stem + ${endings(table, 'cases', 'plural', gen?.stem)}.`, eg: column(table, 'cases', 'plural') });
  if (entry.gender === 'n') steps.push({ head: 'Neuter', text: 'The accusative is the same as the nominative, and in the plural both end in -a.' });
  if (/i-stem/.test(name)) steps.push({ head: 'i-stem', text: 'Genitive plural -ium (and, if neuter, ablative singular -ī and plural -ia).' });
  const g = GENDER[entry.gender];
  return { kind: 'Noun', type: `${name.replace(/, neuter$/, '')} noun${g ? `, ${g}` : ''}`, parts: entry.lemma, steps };
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
    if (f?.stem) steps.push({ head: 'Stem', text: `${f.stem}- (the feminine ${first(f.text)} without -${f.ending}).` });
    steps.push({ head: 'Endings', text: 'Masculine like a 2nd-declension noun (servus), feminine like 1st (puella), neuter like 2nd neuter (dōnum).', eg: nomEg });
    if (/-er/.test(name)) steps.push({ head: 'Masculine -er', text: 'The masculine nominative singular ends in -er; the other forms are built on the stem.' });
    if (/-īus/.test(name)) steps.push({ head: 'Genitive -īus', text: 'Genitive singular -īus and dative -ī, in all three genders.', eg: (genRow?.cells ?? []).filter((c) => !c.empty).map((c) => first(c.text)) });
  } else if (/^3rd/.test(name)) {
    const g = genRow?.cells?.[0];
    if (g?.stem) steps.push({ head: 'Stem', text: `${g.stem}- (the genitive ${first(g.text)} without -${g.ending}).` });
    steps.push({ head: 'Endings', text: '3rd-declension i-stem: ablative singular -ī, genitive plural -ium, neuter plural -ia.', eg: nomEg });
  } else {
    steps.push({ head: 'Endings', text: 'Learn its forms from the table.', eg: nomEg });
  }
  const more = (table?.sections ?? []).filter((s) => /^(comparative|superlative)/.test(s.title ?? '')).map((s) => s.title);
  if (more.length) steps.push({ head: 'Comparison', text: 'Comparative: stem + -ior (m/f), -ius (n), a 3rd-declension adjective. Superlative: stem + -issimus, -a, -um (-rimus after -er; a few are irregular). This word’s:', eg: more.map((m) => m.replace(/^(comparative|superlative) \((.*)\)$/, '$2')) });
  return { kind: 'Adjective', type: name, parts: entry.lemma, steps };
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
  const want = new Set(['Deponent', 'Irregular']);
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
  const pf = stepActive?.text.match(/^(?:The perfect is regular: stem )?(\S+?)- \(/)?.[1] ?? null;
  const partStep = dep ? find('Perfect') : find('Perfect passive');
  const part = partStep?.text.split(' + ')[0] ?? null;
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
