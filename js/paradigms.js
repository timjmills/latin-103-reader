// Paradigm-table generator.
//
// paradigm(entry, parse) → Paradigm | null
//   entry  a glossary entry ({pos, cat, roots, gender, kind, lemma, h, …})
//   parse  one parse object or an array of them; every matching cell gets hit:true
//
// Paradigm = { kind: 'noun'|'adjective'|'verb'|'pronoun', title, note?,
//   sections: [{ title, headers: [...], rows: [{ label, cells: [{ stem, ending, text, hit, key }] }] }] }
//
// Stems come from entry.roots (already spelled with macrons/v by the build);
// endings carry their textbook macrons here. Tables follow Ørberg's learner
// order: nom gen dat acc abl voc; verbs tense by tense, indicative then
// subjunctive, active then passive, then imperative, infinitives, participles.

const CASES = ['nom', 'gen', 'dat', 'acc', 'abl', 'voc'];
const CASE_LABEL = { nom: 'nominative', gen: 'genitive', dat: 'dative', acc: 'accusative', abl: 'ablative', voc: 'vocative', loc: 'locative' };
const PERSONS = [['1', 'sg'], ['2', 'sg'], ['3', 'sg'], ['1', 'pl'], ['2', 'pl'], ['3', 'pl']];
const PERSON_LABEL = { '1sg': 'I', '2sg': 'you (sg.)', '3sg': 'he / she / it', '1pl': 'we', '2pl': 'you (pl.)', '3pl': 'they' };

// ---------------------------------------------------------------------------
// helpers

function asList(parse) {
  if (!parse) return [];
  return Array.isArray(parse) ? parse : [parse];
}

function cell(stem, ending, key) {
  const s = stem ?? '';
  const e = ending ?? '';
  return { stem: s, ending: e, text: s + e, hit: false, key };
}

/** 'ill|e' → cell('ill','e'); 'ego' → cell('','ego') */
function splitCell(str, key) {
  if (str == null || str === '—' || str === '-') return { stem: '', ending: '', text: '—', hit: false, key, empty: true };
  const i = str.indexOf('|');
  return i < 0 ? cell('', str, key) : cell(str.slice(0, i), str.slice(i + 1), key);
}

function root(entry, i, fallback = '') {
  const r = entry.roots?.[i];
  return r && r !== '-' ? r : fallback;
}

function genderOk(cellGender, parseGender) {
  if (!parseGender) return true;          // unknown gender: match any
  if (parseGender === 'c') return cellGender === 'm' || cellGender === 'f' || cellGender === 'c';
  return cellGender === parseGender || cellGender === 'c';
}

function markHits(paradigm, parses) {
  const list = asList(parses);
  if (!list.length) return paradigm;
  for (const sec of paradigm.sections) {
    for (const row of sec.rows) {
      for (const c of row.cells) {
        if (!c.key || c.empty) continue;
        if (list.some((p) => keyMatches(c.key, p))) c.hit = true;
      }
    }
  }
  return paradigm;
}

function keyMatches(k, p) {
  if (k.kind === 'nominal') {
    if (p.mood && p.mood !== 'ptc' && p.mood !== 'gerundive') return false;
    if (p.case && p.case !== k.case) return false;
    if (!p.case) return false;
    if (p.number && k.number && p.number !== k.number) return false;
    if (k.gender && !genderOk(k.gender, p.gender)) return false;
    if (k.degree && (p.degree || 'pos') !== k.degree) return false;
    if (!k.degree && p.degree && p.degree !== 'pos') return false;
    if (k.mood && p.mood !== k.mood) return false;
    if (!k.mood && p.mood) return false;
    if (k.tense && p.tense && p.tense !== k.tense) return false;
    return true;
  }
  if (k.kind === 'finite') {
    return p.tense === k.tense && p.mood === k.mood && p.voice === k.voice
      && String(p.person) === k.person && p.number === k.number;
  }
  if (k.kind === 'imper') {
    return p.mood === 'imper' && p.voice === k.voice && p.number === k.number
      && (p.tense || 'pres') === k.tense && (!k.person || String(p.person) === k.person);
  }
  if (k.kind === 'inf') {
    return p.mood === 'inf' && p.tense === k.tense && p.voice === k.voice;
  }
  if (k.kind === 'ptc') {
    return p.mood === 'ptc' && p.tense === k.tense && p.voice === k.voice;
  }
  if (k.kind === 'gerundive') return p.mood === 'gerundive';
  if (k.kind === 'gerund') return p.mood === 'gerund' && p.case === k.case;
  if (k.kind === 'supine') return p.mood === 'supine' && p.case === k.case;
  return false;
}

const nk = (c, n, g, extra = {}) => ({ kind: 'nominal', case: c, number: n, gender: g, ...extra });

// ---------------------------------------------------------------------------
// nouns

const NOUN_ENDINGS = {
  // [nom, gen, dat, acc, abl, voc] singular, then plural
  '1': { sg: ['a', 'ae', 'ae', 'am', 'ā', 'a'], pl: ['ae', 'ārum', 'īs', 'ās', 'īs', 'ae'] },
  '1g6': { sg: ['ē', 'ēs', 'ae', 'ēn', 'ē', 'ē'], pl: ['ae', 'ārum', 'īs', 'ās', 'īs', 'ae'] },
  '1g7': { sg: ['ēs', 'ae', 'ae', 'ēn', 'ē', 'ē'], pl: ['ae', 'ārum', 'īs', 'ās', 'īs', 'ae'] },
  '1g8': { sg: ['ās', 'ae', 'ae', 'ān', 'ā', 'ā'], pl: ['ae', 'ārum', 'īs', 'ās', 'īs', 'ae'] },
  '2m': { sg: ['us', 'ī', 'ō', 'um', 'ō', 'e'], pl: ['ī', 'ōrum', 'īs', 'ōs', 'īs', 'ī'] },
  '2n': { sg: ['um', 'ī', 'ō', 'um', 'ō', 'um'], pl: ['a', 'ōrum', 'īs', 'a', 'īs', 'a'] },
  '2r': { sg: ['', 'ī', 'ō', 'um', 'ō', ''], pl: ['ī', 'ōrum', 'īs', 'ōs', 'īs', 'ī'] },
  '2nus': { sg: ['us', 'ī', 'ō', 'us', 'ō', 'us'], pl: null },
  '2g6': { sg: ['os', 'ī', 'ō', 'on', 'ō', 'e'], pl: ['ī', 'ōrum', 'īs', 'ōs', 'īs', 'ī'] },
  '2g8': { sg: ['on', 'ī', 'ō', 'on', 'ō', 'on'], pl: ['a', 'ōrum', 'īs', 'a', 'īs', 'a'] },
  '3': { sg: ['', 'is', 'ī', 'em', 'e', ''], pl: ['ēs', 'um', 'ibus', 'ēs', 'ibus', 'ēs'] },
  '3n': { sg: ['', 'is', 'ī', '', 'e', ''], pl: ['a', 'um', 'ibus', 'a', 'ibus', 'a'] },
  '3i': { sg: ['', 'is', 'ī', 'em', 'e', ''], pl: ['ēs', 'ium', 'ibus', 'ēs', 'ibus', 'ēs'] },
  '3in': { sg: ['', 'is', 'ī', '', 'ī', ''], pl: ['ia', 'ium', 'ibus', 'ia', 'ibus', 'ia'] },
  '4': { sg: ['us', 'ūs', 'uī', 'um', 'ū', 'us'], pl: ['ūs', 'uum', 'ibus', 'ūs', 'ibus', 'ūs'] },
  '4n': { sg: ['ū', 'ūs', 'ū', 'ū', 'ū', 'ū'], pl: ['ua', 'uum', 'ibus', 'ua', 'ibus', 'ua'] },
  '5': { sg: ['ēs', 'eī', 'eī', 'em', 'ē', 'ēs'], pl: ['ēs', 'ērum', 'ēbus', 'ēs', 'ēbus', 'ēs'] },
};

const IRREGULAR_NOUNS = {
  vis: { title: 'vīs (irregular 3rd declension)', note: 'Singular from vī-, plural from vīr-; genitive and dative singular are rare.',
    sg: ['vī|s', '—', '—', 'v|im', 'v|ī', 'vī|s'], pl: ['vīr|ēs', 'vīr|ium', 'vīr|ibus', 'vīr|ēs', 'vīr|ibus', 'vīr|ēs'], gender: 'f' },
  deus: { title: 'deus (2nd declension, irregular plural)', note: 'Vocative singular deus; plural dī / deī, dīs / deīs.',
    sg: ['de|us', 'de|ī', 'de|ō', 'de|um', 'de|ō', 'de|us'], pl: ['d|ī', 'de|ōrum', 'd|īs', 'de|ōs', 'd|īs', 'd|ī'], gender: 'm' },
  domus: { title: 'domus (4th declension with 2nd-declension forms)', note: 'domī = at home (locative), domum = home(wards), domō = from home.',
    sg: ['dom|us', 'dom|ūs', 'dom|uī', 'dom|um', 'dom|ō', 'dom|us'], pl: ['dom|ūs', 'dom|uum', 'dom|ibus', 'dom|ōs', 'dom|ibus', 'dom|ūs'], gender: 'f' },
  iuppiter: { title: 'Iuppiter (irregular)', note: 'Oblique cases from Iov-.',
    sg: ['Iuppiter', 'Iov|is', 'Iov|ī', 'Iov|em', 'Iov|e', 'Iuppiter'], pl: null, gender: 'm' },
};

// Third-declension consonant stems that Whitaker (or the learner) might take for
// i-stems: genitive plural -um, ablative singular -e, neuter plural -a.
// Allen & Greenough §121–122: canis, iuvenis, pānis, sēdēs, vātēs, volucris,
// mēnsis, apis (nouns); vetus, pauper, dīves, senex, prīnceps, sōspes,
// superstes, compos, particeps, caelebs (adjectives); plus the family words
// pater, māter, frāter, parēns, which Whitaker already codes as [3,1].
const NON_I_STEM = new Set([
  'canis', 'iuvenis', 'panis', 'sedes', 'vates', 'volucris', 'mensis', 'apis',
  'vetus', 'pauper', 'dives', 'senex', 'princeps', 'sospes', 'superstes', 'compos', 'particeps', 'caelebs',
  'pater', 'mater', 'frater', 'parens',
]);

function nounTableKey(entry) {
  const [d, v] = entry.cat || [0, 0];
  const g = entry.gender;
  if (d === 3 && NON_I_STEM.has(entry.h)) return g === 'n' ? '3n' : '3';
  if (d === 1) return v === 6 ? '1g6' : v === 7 ? '1g7' : v === 8 ? '1g8' : '1';
  if (d === 2) {
    if (v === 2) return '2n';
    if (v === 3) return '2r';
    if (v === 4) return '2nus';
    if (v === 6 || v === 7 || v === 9) return '2g6';
    if (v === 8) return '2g8';
    return g === 'n' ? '2n' : '2m';
  }
  if (d === 3) {
    if (v === 4) return '3in';
    if (v === 3) return g === 'n' ? '3in' : '3i';
    if (v === 2) return '3n';
    if (g === 'n' && v !== 1) return '3n';
    return '3';
  }
  if (d === 4) return v === 2 || g === 'n' ? '4n' : '4';
  if (d === 5) return '5';
  return null;
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th'];

export function declensionName(entry) {
  const [d, v] = entry.cat || [0, 0];
  if (entry.pos === 'N') {
    if (d === 9) return 'indeclinable noun';
    if (!d) return null;
    let s = `${ORDINAL[d]} declension`;
    if (d === 3 && (v === 3 || v === 4) && !NON_I_STEM.has(entry.h)) s += ' (i-stem)';
    if ((d === 1 && v >= 6) || (d === 2 && v >= 6) || (d === 3 && v >= 6)) s += ' (Greek)';
    if (d === 2 && v === 3) s += ' (-er / -ir)';
    if (entry.gender === 'n') s += ', neuter';
    return s;
  }
  return null;
}

function nounStems(entry, key) {
  // stem 0 for nominative/vocative singular (and neuter accusative), stem 1 elsewhere.
  const r0 = root(entry, 0);
  const r1 = root(entry, 1, r0);
  const nomEnding = NOUN_ENDINGS[key]?.sg[0] ?? '';
  let nomStem = r0;
  let nomEnd = nomEnding;
  if (key === '3' || key === '3n' || key === '3i' || key === '3in' || key === '2r') {
    // Whitaker's first root is the whole nominative; split off a visible ending when it is stem + is/es/s/e
    nomStem = r0;
    nomEnd = '';
    if (r0 !== r1 && r0.startsWith(r1) && ['is', 'es', 's', 'e', 'x'].includes(r0.slice(r1.length))) {
      nomStem = r1;
      nomEnd = r0.slice(r1.length);
    }
  }
  return { r0, r1, nomStem, nomEnd };
}

function nounParadigm(entry, parses) {
  const h = entry.h;
  if (IRREGULAR_NOUNS[h]) return irregularNoun(entry, IRREGULAR_NOUNS[h], parses);
  const key = nounTableKey(entry);
  if (!key) return null;
  const tbl = NOUN_ENDINGS[key];
  const { r1, nomStem, nomEnd } = nounStems(entry, key);
  const g = entry.gender || 'c';
  const neuter = g === 'n';
  const rows = [];
  const hasLoc = asList(parses).some((p) => p.case === 'loc');
  const build = (num) => {
    const ends = tbl[num];
    if (!ends) return null;
    return CASES.map((c, i) => {
      let stem = r1;
      let end = ends[i];
      if (num === 'sg' && (c === 'nom' || c === 'voc' || (neuter && c === 'acc'))) {
        if (key.startsWith('3') || key === '2r') { stem = nomStem; end = nomEnd; }
        if (key === '2m' && c === 'voc' && (entry.cat?.[1] === 5)) { stem = r1.replace(/i$/, ''); end = 'ī'; }
      }
      if (key === '5' && (c === 'gen' || c === 'dat') && num === 'sg' && /[aeiouāēīōū]$/.test(r1)) end = 'ēī';
      return cell(stem, end, nk(c, num, g));
    });
  };
  const sg = build('sg');
  const pl = build('pl');
  const headers = pl ? ['singular', 'plural'] : ['singular'];
  for (let i = 0; i < CASES.length; i++) {
    const cells = [sg[i]];
    if (pl) cells.push(pl[i]);
    rows.push({ label: CASE_LABEL[CASES[i]], cells });
  }
  if (hasLoc) {
    const locEnd = key.startsWith('1') ? 'ae' : key.startsWith('2') ? 'ī' : key.startsWith('3') ? 'ī' : null;
    if (locEnd) {
      const cells = [cell(r1, locEnd, nk('loc', 'sg', g))];
      if (pl) cells.push(cell(r1, tbl.pl[4], nk('loc', 'pl', g)));
      rows.push({ label: CASE_LABEL.loc, cells });
    }
  }
  const p = {
    kind: 'noun',
    title: `${entry.lemma} · ${declensionName(entry) || 'noun'}`,
    sections: [{ title: 'cases', headers, rows }],
  };
  if (key === '3i') p.note = 'i-stem: genitive plural -ium. A few i-stems (turris, puppis, vīs, sitis) also take accusative -im and ablative -ī.';
  if (key === '3in') p.note = 'Neuter i-stem: ablative singular -ī, plural -ia, -ium.';
  if (key === '3' && entry.cat?.[0] === 3 && NON_I_STEM.has(h)) p.note = 'Consonant stem (not an i-stem): genitive plural -um, ablative singular -e.';
  if (key === '2nus') p.note = 'Neuter in -us: nominative, accusative and vocative are identical; no plural.';
  return markHits(p, parses);
}

function irregularNoun(entry, t, parses) {
  const rows = CASES.map((c, i) => {
    const cells = [{ ...splitCell(t.sg[i], nk(c, 'sg', t.gender)) }];
    if (t.pl) cells.push({ ...splitCell(t.pl[i], nk(c, 'pl', t.gender)) });
    return { label: CASE_LABEL[c], cells };
  });
  const p = { kind: 'noun', title: t.title, note: t.note, sections: [{ title: 'cases', headers: t.pl ? ['singular', 'plural'] : ['singular'], rows }] };
  return markHits(p, parses);
}

// ---------------------------------------------------------------------------
// adjectives

// three-gender tables: [m, f, n] × 6 cases
const ADJ_12 = {
  sg: [['us', 'a', 'um'], ['ī', 'ae', 'ī'], ['ō', 'ae', 'ō'], ['um', 'am', 'um'], ['ō', 'ā', 'ō'], ['e', 'a', 'um']],
  pl: [['ī', 'ae', 'a'], ['ōrum', 'ārum', 'ōrum'], ['īs', 'īs', 'īs'], ['ōs', 'ās', 'a'], ['īs', 'īs', 'īs'], ['ī', 'ae', 'a']],
};
const ADJ_3 = {
  sg: [['', '', ''], ['is', 'is', 'is'], ['ī', 'ī', 'ī'], ['em', 'em', ''], ['ī', 'ī', 'ī'], ['', '', '']],
  pl: [['ēs', 'ēs', 'ia'], ['ium', 'ium', 'ium'], ['ibus', 'ibus', 'ibus'], ['ēs', 'ēs', 'ia'], ['ibus', 'ibus', 'ibus'], ['ēs', 'ēs', 'ia']],
};
// consonant-stem 3rd-declension adjectives (vetus, pauper, senex…): abl. sg. -e, gen. pl. -um, n. pl. -a
const ADJ_3_CONS = {
  sg: [['', '', ''], ['is', 'is', 'is'], ['ī', 'ī', 'ī'], ['em', 'em', ''], ['e', 'e', 'e'], ['', '', '']],
  pl: [['ēs', 'ēs', 'a'], ['um', 'um', 'um'], ['ibus', 'ibus', 'ibus'], ['ēs', 'ēs', 'a'], ['ibus', 'ibus', 'ibus'], ['ēs', 'ēs', 'a']],
};
const ADJ_COMP = {
  sg: [['or', 'or', 'us'], ['ōris', 'ōris', 'ōris'], ['ōrī', 'ōrī', 'ōrī'], ['ōrem', 'ōrem', 'us'], ['ōre', 'ōre', 'ōre'], ['or', 'or', 'us']],
  pl: [['ōrēs', 'ōrēs', 'ōra'], ['ōrum', 'ōrum', 'ōrum'], ['ōribus', 'ōribus', 'ōribus'], ['ōrēs', 'ōrēs', 'ōra'], ['ōribus', 'ōribus', 'ōribus'], ['ōrēs', 'ōrēs', 'ōra']],
};
const GENDERS = ['m', 'f', 'n'];

function adjSection(title, stemFor, table, degree, extraKey = {}) {
  const rows = [];
  for (const num of ['sg', 'pl']) {
    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i];
      const cells = GENDERS.map((g, gi) => {
        const { stem, ending } = stemFor(c, num, g, table[num][i][gi]);
        return cell(stem, ending, nk(c, num, g, { degree, ...extraKey }));
      });
      rows.push({ label: `${CASE_LABEL[c]} ${num === 'sg' ? 'sg.' : 'pl.'}`, cells });
    }
  }
  return { title, headers: ['masculine', 'feminine', 'neuter'], rows };
}

export function adjectiveName(entry) {
  const [d, v] = entry.cat || [0, 0];
  if (entry.kind === 'comp' || d === 0) return 'comparative adjective';
  if (d === 1) return v === 2 ? '1st/2nd declension adjective (-er)' : (v === 3 || v === 4 || v === 5) ? '1st/2nd declension adjective (genitive -īus)' : '1st/2nd declension adjective';
  if (d === 3) return v === 1 ? '3rd declension adjective (one ending)' : v === 2 ? '3rd declension adjective (two endings)' : v === 3 ? '3rd declension adjective (three endings)' : '3rd declension adjective';
  if (d === 9) return 'indeclinable adjective';
  return 'adjective';
}

function adjectiveParadigm(entry, parses) {
  const [d, v] = entry.cat || [0, 0];
  const r0 = root(entry, 0);
  const r1 = root(entry, 1, r0);
  const r2 = root(entry, 2);
  const r3 = root(entry, 3);
  const sections = [];
  const list = asList(parses);
  const degrees = new Set(list.map((p) => p.degree || 'pos'));
  const compOnly = entry.lemma?.endsWith('or -us') && !d;

  if (!compOnly && (d === 1 || d === 3)) {
    let stemFor;
    if (d === 1) {
      const iusType = v === 3 || v === 4 || v === 5;
      stemFor = (c, num, g, end) => {
        if (num === 'sg') {
          if (iusType && c === 'gen') return { stem: r1, ending: 'īus' };
          if (iusType && c === 'dat') return { stem: r1, ending: 'ī' };
          if (v === 5 && g === 'n' && (c === 'nom' || c === 'acc' || c === 'voc')) return { stem: r1, ending: 'ud' };
          if ((v === 2 || v === 4) && g === 'm' && (c === 'nom' || c === 'voc')) return { stem: r0, ending: '' };
        }
        return { stem: r1, ending: end };
      };
    } else {
      stemFor = (c, num, g, end) => {
        if (num === 'sg' && (c === 'nom' || c === 'voc' || (g === 'n' && c === 'acc'))) {
          if (v === 1) return { stem: r0, ending: '' };
          if (v === 2) return { stem: r1, ending: g === 'n' ? 'e' : 'is' };
          if (v === 3) return g === 'm' ? { stem: r0, ending: '' } : { stem: r1, ending: g === 'n' ? 'e' : 'is' };
          return { stem: r0, ending: '' };
        }
        return { stem: r1, ending: end };
      };
    }
    const consStem = d === 3 && NON_I_STEM.has(entry.h);
    sections.push(adjSection('positive', stemFor, d === 1 ? ADJ_12 : consStem ? ADJ_3_CONS : ADJ_3, 'pos'));
  }
  if (r2 || compOnly) {
    const cs = compOnly ? r0 : r2;
    sections.push(adjSection(compOnly ? 'comparative' : `comparative (${cs}or, ${cs}us)`, (c, num, g, end) => ({ stem: cs, ending: end }), ADJ_COMP, compOnly ? 'pos' : 'comp'));
  }
  if (r3) {
    sections.push(adjSection(`superlative (${r3}mus -a -um)`, (c, num, g, end) => ({ stem: r3, ending: 'm' + end }), ADJ_12, 'super'));
  }
  if (!sections.length) return null;
  const p = { kind: 'adjective', title: `${entry.lemma} · ${adjectiveName(entry)}`, sections };
  if (d === 3 && v === 1) p.note = 'One ending for all genders in the nominative singular; the neuter differs only in accusative singular and nominative/accusative plural.';
  if (d === 3 && NON_I_STEM.has(entry.h)) p.note = 'Consonant stem (not an i-stem): ablative singular -e, genitive plural -um, neuter plural -a.';
  if (d === 1 && (v === 3 || v === 4 || v === 5)) p.note = 'Like ūnus, sōlus, tōtus, alius: genitive singular -īus, dative singular -ī for all genders.';
  return markHits(p, parses);
}

// ---------------------------------------------------------------------------
// pronouns (hand tables; 'stem|ending', '—' for missing)

const PRON_TABLES = {
  is: { title: 'is, ea, id · he, she, it; that', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['i|s', 'e|a', 'i|d'], ['e|ius', 'e|ius', 'e|ius'], ['e|ī', 'e|ī', 'e|ī'], ['e|um', 'e|am', 'i|d'], ['e|ō', 'e|ā', 'e|ō']],
    pl: [['e|ī / i|ī', 'e|ae', 'e|a'], ['e|ōrum', 'e|ārum', 'e|ōrum'], ['e|īs / i|īs', 'e|īs / i|īs', 'e|īs / i|īs'], ['e|ōs', 'e|ās', 'e|a'], ['e|īs / i|īs', 'e|īs / i|īs', 'e|īs / i|īs']] },
  hic: { title: 'hic, haec, hoc · this', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['h|ic', 'h|aec', 'h|oc'], ['h|uius', 'h|uius', 'h|uius'], ['h|uic', 'h|uic', 'h|uic'], ['h|unc', 'h|anc', 'h|oc'], ['h|ōc', 'h|āc', 'h|ōc']],
    pl: [['h|ī', 'h|ae', 'h|aec'], ['h|ōrum', 'h|ārum', 'h|ōrum'], ['h|īs', 'h|īs', 'h|īs'], ['h|ōs', 'h|ās', 'h|aec'], ['h|īs', 'h|īs', 'h|īs']] },
  ille: { title: 'ille, illa, illud · that', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['ill|e', 'ill|a', 'ill|ud'], ['ill|īus', 'ill|īus', 'ill|īus'], ['ill|ī', 'ill|ī', 'ill|ī'], ['ill|um', 'ill|am', 'ill|ud'], ['ill|ō', 'ill|ā', 'ill|ō']],
    pl: [['ill|ī', 'ill|ae', 'ill|a'], ['ill|ōrum', 'ill|ārum', 'ill|ōrum'], ['ill|īs', 'ill|īs', 'ill|īs'], ['ill|ōs', 'ill|ās', 'ill|a'], ['ill|īs', 'ill|īs', 'ill|īs']] },
  iste: { title: 'iste, ista, istud · that (of yours)', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['ist|e', 'ist|a', 'ist|ud'], ['ist|īus', 'ist|īus', 'ist|īus'], ['ist|ī', 'ist|ī', 'ist|ī'], ['ist|um', 'ist|am', 'ist|ud'], ['ist|ō', 'ist|ā', 'ist|ō']],
    pl: [['ist|ī', 'ist|ae', 'ist|a'], ['ist|ōrum', 'ist|ārum', 'ist|ōrum'], ['ist|īs', 'ist|īs', 'ist|īs'], ['ist|ōs', 'ist|ās', 'ist|a'], ['ist|īs', 'ist|īs', 'ist|īs']] },
  ipse: { title: 'ipse, ipsa, ipsum · -self', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['ips|e', 'ips|a', 'ips|um'], ['ips|īus', 'ips|īus', 'ips|īus'], ['ips|ī', 'ips|ī', 'ips|ī'], ['ips|um', 'ips|am', 'ips|um'], ['ips|ō', 'ips|ā', 'ips|ō']],
    pl: [['ips|ī', 'ips|ae', 'ips|a'], ['ips|ōrum', 'ips|ārum', 'ips|ōrum'], ['ips|īs', 'ips|īs', 'ips|īs'], ['ips|ōs', 'ips|ās', 'ips|a'], ['ips|īs', 'ips|īs', 'ips|īs']] },
  idem: { title: 'īdem, eadem, idem · the same', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['ī|dem', 'ea|dem', 'i|dem'], ['eius|dem', 'eius|dem', 'eius|dem'], ['eī|dem', 'eī|dem', 'eī|dem'], ['eun|dem', 'ean|dem', 'i|dem'], ['eō|dem', 'eā|dem', 'eō|dem']],
    pl: [['eī|dem / iī|dem', 'eae|dem', 'ea|dem'], ['eōrun|dem', 'eārun|dem', 'eōrun|dem'], ['eīs|dem / iīs|dem', 'eīs|dem', 'eīs|dem'], ['eōs|dem', 'eās|dem', 'ea|dem'], ['eīs|dem / iīs|dem', 'eīs|dem', 'eīs|dem']] },
  qui: { title: 'quī, quae, quod · who, which, that', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['qu|ī', 'qu|ae', 'qu|od'], ['c|uius', 'c|uius', 'c|uius'], ['c|ui', 'c|ui', 'c|ui'], ['qu|em', 'qu|am', 'qu|od'], ['qu|ō', 'qu|ā', 'qu|ō']],
    pl: [['qu|ī', 'qu|ae', 'qu|ae'], ['qu|ōrum', 'qu|ārum', 'qu|ōrum'], ['qu|ibus', 'qu|ibus', 'qu|ibus'], ['qu|ōs', 'qu|ās', 'qu|ae'], ['qu|ibus', 'qu|ibus', 'qu|ibus']] },
  quis: { title: 'quis, quid · who? what?', headers: ['masculine / feminine', 'neuter'],
    sg: [['qu|is', 'qu|id'], ['c|uius', 'c|uius'], ['c|ui', 'c|ui'], ['qu|em', 'qu|id'], ['qu|ō', 'qu|ō']],
    pl: [['qu|ī', 'qu|ae'], ['qu|ōrum', 'qu|ōrum'], ['qu|ibus', 'qu|ibus'], ['qu|ōs', 'qu|ae'], ['qu|ibus', 'qu|ibus']], genders: ['c', 'n'] },
  ego: { title: 'ego · I', headers: ['singular (I)', 'plural (we)'], sg: [['ego', 'n|ōs'], ['me|ī', 'nostr|um / nostr|ī'], ['m|ihi', 'n|ōbīs'], ['m|ē', 'n|ōs'], ['m|ē', 'n|ōbīs']], personal: true },
  tu: { title: 'tū · you', headers: ['singular (you)', 'plural (you all)'], sg: [['t|ū', 'v|ōs'], ['tu|ī', 'vestr|um / vestr|ī'], ['t|ibi', 'v|ōbīs'], ['t|ē', 'v|ōs'], ['t|ē', 'v|ōbīs']], personal: true },
  se: { title: 'sē · himself, herself, itself, themselves', headers: ['singular and plural'], sg: [['—'], ['su|ī'], ['s|ibi'], ['s|ē / s|ēsē'], ['s|ē / s|ēsē']], personal: true, note: 'No nominative: the reflexive always refers back to the subject.' },
};
PRON_TABLES.nos = PRON_TABLES.ego;
PRON_TABLES.vos = PRON_TABLES.tu;

// qu- compounds: prefix + quī/quis table + suffix
const QU_COMPOUNDS = {
  aliquis: { base: 'quis', prefix: 'ali', suffix: '', title: 'aliquis, aliquid · someone, something', note: 'Declines like quis with ali- in front; feminine aliqua, neuter plural aliqua.' },
  aliqui: { base: 'qui', prefix: 'ali', suffix: '', title: 'aliquī, aliqua, aliquod · some' },
  quisque: { base: 'quis', prefix: '', suffix: 'que', title: 'quisque, quaeque, quidque · each' },
  quisquam: { base: 'quis', prefix: '', suffix: 'quam', title: 'quisquam, quidquam · anyone, anything' },
  quidam: { base: 'qui', prefix: '', suffix: 'dam', title: 'quīdam, quaedam, quoddam · a certain', note: 'Before -dam an m becomes n: quendam, quandam, quōrundam.' },
  quicumque: { base: 'qui', prefix: '', suffix: 'cumque', title: 'quīcumque, quaecumque, quodcumque · whoever, whatever' },
  quilibet: { base: 'qui', prefix: '', suffix: 'libet', title: 'quīlibet · anyone you like' },
  quivis: { base: 'qui', prefix: '', suffix: 'vīs', title: 'quīvīs · anyone you please' },
};

function pronounParadigm(entry, parses) {
  let h = entry.h;
  let t = PRON_TABLES[h];
  let prefix = '', suffix = '';
  if (!t && QU_COMPOUNDS[h]) {
    const c = QU_COMPOUNDS[h];
    t = { ...PRON_TABLES[c.base], title: c.title, note: c.note };
    prefix = c.prefix; suffix = c.suffix;
  }
  if (!t) return null;
  const genders = t.genders || (t.personal ? [null] : GENDERS);
  const rows = [];
  const caseList = ['nom', 'gen', 'dat', 'acc', 'abl'];
  const mk = (str, key) => {
    if (str.includes(' / ')) {
      const [a, b] = str.split(' / ');
      const ca = splitCell(a, key), cb = splitCell(b, key);
      const c = cell(ca.stem, ca.ending, key);
      c.text = `${ca.text} / ${cb.text}`;
      c.alt = cb.text;
      return c;
    }
    const c = splitCell(str, key);
    if (c.empty) return c;
    if (prefix || suffix) {
      let m = suffix === 'dam' && c.text.endsWith('m') ? { stem: c.stem, ending: c.ending.replace(/m$/, 'n') } : c;
      const out = cell(prefix + m.stem, m.ending + suffix, key);
      return out;
    }
    return c;
  };
  if (t.personal) {
    // headers are number columns
    for (let i = 0; i < caseList.length; i++) {
      const cells = t.sg[i].map((s, col) => {
        const num = t.headers.length === 2 ? (col === 0 ? 'sg' : 'pl') : null;
        return mk(s, nk(caseList[i], num, null));
      });
      rows.push({ label: CASE_LABEL[caseList[i]], cells });
    }
    const p = { kind: 'pronoun', title: t.title, note: t.note, sections: [{ title: 'cases', headers: t.headers, rows }] };
    return markHits(p, parses);
  }
  for (const num of ['sg', 'pl']) {
    for (let i = 0; i < caseList.length; i++) {
      const cells = t[num][i].map((s, gi) => mk(s, nk(caseList[i], num, genders[gi])));
      rows.push({ label: `${CASE_LABEL[caseList[i]]} ${num === 'sg' ? 'sg.' : 'pl.'}`, cells });
    }
  }
  const p = { kind: 'pronoun', title: t.title, note: t.note, sections: [{ title: 'cases', headers: t.headers, rows }] };
  return markHits(p, parses);
}

// ---------------------------------------------------------------------------
// verbs

const TENSES = ['pres', 'impf', 'fut', 'perf', 'plupf', 'futperf'];
const TENSE_LABEL = { pres: 'present', impf: 'imperfect', fut: 'future', perf: 'perfect', plupf: 'pluperfect', futperf: 'future perfect' };

// Endings per conjugation. Present-system endings attach to roots[1] (the present stem);
// perfect active endings to roots[2]; participle-based forms to roots[3].
const CONJ = {
  1: {
    pres: { act: ['ō', 'ās', 'at', 'āmus', 'ātis', 'ant'], pass: ['or', 'āris', 'ātur', 'āmur', 'āminī', 'antur'] },
    impf: { act: ['ābam', 'ābās', 'ābat', 'ābāmus', 'ābātis', 'ābant'], pass: ['ābar', 'ābāris', 'ābātur', 'ābāmur', 'ābāminī', 'ābantur'] },
    fut: { act: ['ābō', 'ābis', 'ābit', 'ābimus', 'ābitis', 'ābunt'], pass: ['ābor', 'āberis', 'ābitur', 'ābimur', 'ābiminī', 'ābuntur'] },
    presSubj: { act: ['em', 'ēs', 'et', 'ēmus', 'ētis', 'ent'], pass: ['er', 'ēris', 'ētur', 'ēmur', 'ēminī', 'entur'] },
    impfSubj: { act: ['ārem', 'ārēs', 'āret', 'ārēmus', 'ārētis', 'ārent'], pass: ['ārer', 'ārēris', 'ārētur', 'ārēmur', 'ārēminī', 'ārentur'] },
    imper: { act: ['ā', 'āte'], pass: ['āre', 'āminī'], futAct: ['ātō', 'ātōte'], fut3: ['ātō', 'antō'] },
    inf: { act: 'āre', pass: 'ārī' }, presPtc: 'āns', gerund: 'and', presPtcGen: 'antis',
  },
  2: {
    pres: { act: ['eō', 'ēs', 'et', 'ēmus', 'ētis', 'ent'], pass: ['eor', 'ēris', 'ētur', 'ēmur', 'ēminī', 'entur'] },
    impf: { act: ['ēbam', 'ēbās', 'ēbat', 'ēbāmus', 'ēbātis', 'ēbant'], pass: ['ēbar', 'ēbāris', 'ēbātur', 'ēbāmur', 'ēbāminī', 'ēbantur'] },
    fut: { act: ['ēbō', 'ēbis', 'ēbit', 'ēbimus', 'ēbitis', 'ēbunt'], pass: ['ēbor', 'ēberis', 'ēbitur', 'ēbimur', 'ēbiminī', 'ēbuntur'] },
    presSubj: { act: ['eam', 'eās', 'eat', 'eāmus', 'eātis', 'eant'], pass: ['ear', 'eāris', 'eātur', 'eāmur', 'eāminī', 'eantur'] },
    impfSubj: { act: ['ērem', 'ērēs', 'ēret', 'ērēmus', 'ērētis', 'ērent'], pass: ['ērer', 'ērēris', 'ērētur', 'ērēmur', 'ērēminī', 'ērentur'] },
    imper: { act: ['ē', 'ēte'], pass: ['ēre', 'ēminī'], futAct: ['ētō', 'ētōte'], fut3: ['ētō', 'entō'] },
    inf: { act: 'ēre', pass: 'ērī' }, presPtc: 'ēns', gerund: 'end', presPtcGen: 'entis',
  },
  3: {
    pres: { act: ['ō', 'is', 'it', 'imus', 'itis', 'unt'], pass: ['or', 'eris', 'itur', 'imur', 'iminī', 'untur'] },
    impf: { act: ['ēbam', 'ēbās', 'ēbat', 'ēbāmus', 'ēbātis', 'ēbant'], pass: ['ēbar', 'ēbāris', 'ēbātur', 'ēbāmur', 'ēbāminī', 'ēbantur'] },
    fut: { act: ['am', 'ēs', 'et', 'ēmus', 'ētis', 'ent'], pass: ['ar', 'ēris', 'ētur', 'ēmur', 'ēminī', 'entur'] },
    presSubj: { act: ['am', 'ās', 'at', 'āmus', 'ātis', 'ant'], pass: ['ar', 'āris', 'ātur', 'āmur', 'āminī', 'antur'] },
    impfSubj: { act: ['erem', 'erēs', 'eret', 'erēmus', 'erētis', 'erent'], pass: ['erer', 'erēris', 'erētur', 'erēmur', 'erēminī', 'erentur'] },
    imper: { act: ['e', 'ite'], pass: ['ere', 'iminī'], futAct: ['itō', 'itōte'], fut3: ['itō', 'untō'] },
    inf: { act: 'ere', pass: 'ī' }, presPtc: 'ēns', gerund: 'end', presPtcGen: 'entis',
  },
  '3io': {
    pres: { act: ['iō', 'is', 'it', 'imus', 'itis', 'iunt'], pass: ['ior', 'eris', 'itur', 'imur', 'iminī', 'iuntur'] },
    impf: { act: ['iēbam', 'iēbās', 'iēbat', 'iēbāmus', 'iēbātis', 'iēbant'], pass: ['iēbar', 'iēbāris', 'iēbātur', 'iēbāmur', 'iēbāminī', 'iēbantur'] },
    fut: { act: ['iam', 'iēs', 'iet', 'iēmus', 'iētis', 'ient'], pass: ['iar', 'iēris', 'iētur', 'iēmur', 'iēminī', 'ientur'] },
    presSubj: { act: ['iam', 'iās', 'iat', 'iāmus', 'iātis', 'iant'], pass: ['iar', 'iāris', 'iātur', 'iāmur', 'iāminī', 'iantur'] },
    impfSubj: { act: ['erem', 'erēs', 'eret', 'erēmus', 'erētis', 'erent'], pass: ['erer', 'erēris', 'erētur', 'erēmur', 'erēminī', 'erentur'] },
    imper: { act: ['e', 'ite'], pass: ['ere', 'iminī'], futAct: ['itō', 'itōte'], fut3: ['itō', 'iuntō'] },
    inf: { act: 'ere', pass: 'ī' }, presPtc: 'iēns', gerund: 'iend', presPtcGen: 'ientis',
  },
  4: {
    pres: { act: ['iō', 'īs', 'it', 'īmus', 'ītis', 'iunt'], pass: ['ior', 'īris', 'ītur', 'īmur', 'īminī', 'iuntur'] },
    impf: { act: ['iēbam', 'iēbās', 'iēbat', 'iēbāmus', 'iēbātis', 'iēbant'], pass: ['iēbar', 'iēbāris', 'iēbātur', 'iēbāmur', 'iēbāminī', 'iēbantur'] },
    fut: { act: ['iam', 'iēs', 'iet', 'iēmus', 'iētis', 'ient'], pass: ['iar', 'iēris', 'iētur', 'iēmur', 'iēminī', 'ientur'] },
    presSubj: { act: ['iam', 'iās', 'iat', 'iāmus', 'iātis', 'iant'], pass: ['iar', 'iāris', 'iātur', 'iāmur', 'iāminī', 'iantur'] },
    impfSubj: { act: ['īrem', 'īrēs', 'īret', 'īrēmus', 'īrētis', 'īrent'], pass: ['īrer', 'īrēris', 'īrētur', 'īrēmur', 'īrēminī', 'īrentur'] },
    imper: { act: ['ī', 'īte'], pass: ['īre', 'īminī'], futAct: ['ītō', 'ītōte'], fut3: ['ītō', 'iuntō'] },
    inf: { act: 'īre', pass: 'īrī' }, presPtc: 'iēns', gerund: 'iend', presPtcGen: 'ientis',
  },
};
const PERF = {
  perf: ['ī', 'istī', 'it', 'imus', 'istis', 'ērunt'],
  plupf: ['eram', 'erās', 'erat', 'erāmus', 'erātis', 'erant'],
  futperf: ['erō', 'eris', 'erit', 'erimus', 'eritis', 'erint'],
  perfSubj: ['erim', 'erīs', 'erit', 'erīmus', 'erītis', 'erint'],
  plupfSubj: ['issem', 'issēs', 'isset', 'issēmus', 'issētis', 'issent'],
};
const SUM_FORMS = {
  perf: ['sum', 'es', 'est', 'sumus', 'estis', 'sunt'],
  plupf: ['eram', 'erās', 'erat', 'erāmus', 'erātis', 'erant'],
  futperf: ['erō', 'eris', 'erit', 'erimus', 'eritis', 'erunt'],
  perfSubj: ['sim', 'sīs', 'sit', 'sīmus', 'sītis', 'sint'],
  plupfSubj: ['essem', 'essēs', 'esset', 'essēmus', 'essētis', 'essent'],
};

const SHORT_IMPERATIVES = { dic: 'dīc', duc: 'dūc', fac: 'fac' };

export function conjugationName(entry) {
  const [d, v] = entry.cat || [0, 0];
  const kind = entry.kind;
  const r0 = root(entry, 0);
  let name = null;
  if (d === 1) name = '1st conjugation';
  else if (d === 2) name = '2nd conjugation';
  else if (d === 3 && v === 1) name = /i$/.test(r0) ? '3rd conjugation (-iō)' : '3rd conjugation';
  else if (d === 3 && v === 4) name = '4th conjugation';
  else if (d === 5 || d === 6 || d === 7 || (d === 3 && (v === 2 || v === 3))) name = 'irregular verb';
  if (kind === 'dep') return name ? `deponent, ${name}` : 'deponent verb';
  if (kind === 'semidep') return name ? `semi-deponent, ${name}` : 'semi-deponent verb';
  if (kind === 'impers') return name ? `impersonal, ${name}` : 'impersonal verb';
  if (kind === 'perfdef') return 'defective verb (perfect forms only)';
  return name;
}

function conjKey(entry) {
  const [d, v] = entry.cat || [0, 0];
  const r0 = root(entry, 0);
  if (d === 1) return 1;
  if (d === 2) return 2;
  if (d === 3 && v === 4) return 4;
  if (d === 3 && v === 1) return /i$/.test(r0) ? '3io' : 3;
  return null;
}

const fk = (tense, mood, voice, i) => ({ kind: 'finite', tense, mood, voice, person: PERSONS[i][0], number: PERSONS[i][1] });

function periphrastic(stem, ptcEnd, aux, key) {
  // "miss|us sum" — the participle ending plus the auxiliary
  return cell(stem, `${ptcEnd} ${aux}`, key);
}

function personRows(cols) {
  // cols: [{cells: 6 cells}] → 6 rows with one cell per column
  return PERSONS.map(([p, n], i) => ({
    label: PERSON_LABEL[p + n],
    cells: cols.map((col) => col[i]),
  }));
}

function verbParadigm(entry, parses) {
  const h = entry.h;
  if (IRREGULAR_VERBS[h]) return irregularVerb(entry, IRREGULAR_VERBS[h], parses);
  // compounds of sum / eō / ferō
  const [d, v] = entry.cat || [0, 0];
  if (d === 5 && v === 1 && h !== 'sum') return compoundOf(entry, 'sum', parses);
  if (d === 5 && v === 2 && h !== 'possum') return null;
  if (d === 6 && v === 1 && h !== 'eo') return compoundOf(entry, 'eo', parses);
  if (d === 3 && v === 2 && h !== 'fero') return compoundOf(entry, 'fero', parses);
  const ck = conjKey(entry);
  if (!ck) return null;
  const C = CONJ[ck];
  const r0 = root(entry, 0);
  const r1 = root(entry, 1, r0);
  const r2 = root(entry, 2);
  const r3 = root(entry, 3);
  const kind = entry.kind;
  const dep = kind === 'dep';
  const semi = kind === 'semidep';
  const impers = kind === 'impers';
  const sections = [];

  const voicesPresent = dep ? ['pass'] : ['act', 'pass'];
  // short headers keep the table inside a 318 px panel; the note under the table explains deponents
  const headerFor = (vc) => (dep ? 'deponent' : vc === 'act' ? 'active' : 'passive');

  const presentSystem = (tense, table, mood) => {
    const cols = [];
    const heads = [];
    for (const vc of voicesPresent) {
      if (semi && vc === 'pass') continue;
      const ends = table[vc];
      cols.push(ends.map((e, i) => cell(r1, e, fk(tense, mood, vc, i))));
      heads.push(headerFor(vc));
    }
    return { title: `${TENSE_LABEL[tense]} ${mood === 'subj' ? 'subjunctive' : 'indicative'}`, headers: heads, rows: personRows(cols) };
  };
  const perfectSystem = (tense, mood) => {
    const cols = [];
    const heads = [];
    const activeEnds = mood === 'subj' ? (tense === 'perf' ? PERF.perfSubj : PERF.plupfSubj) : PERF[tense];
    const auxKey = mood === 'subj' ? (tense === 'perf' ? 'perfSubj' : 'plupfSubj') : tense;
    const aux = SUM_FORMS[auxKey];
    if (!dep && !semi) {
      if (r2) cols.push(activeEnds.map((e, i) => cell(r2, e, fk(tense, mood, 'act', i))));
      else cols.push(activeEnds.map((e, i) => ({ ...cell('', '—', fk(tense, mood, 'act', i)), empty: true })));
      heads.push('active');
    }
    if (r3) {
      cols.push(aux.map((a, i) => periphrastic(r3, i < 3 ? 'us' : 'ī', a, fk(tense, mood, 'pass', i))));
      heads.push(dep || semi ? 'deponent' : 'passive');
    }
    return { title: `${TENSE_LABEL[tense]} ${mood === 'subj' ? 'subjunctive' : 'indicative'}`, headers: heads, rows: personRows(cols) };
  };

  sections.push(presentSystem('pres', C.pres, 'ind'));
  sections.push(presentSystem('impf', C.impf, 'ind'));
  sections.push(presentSystem('fut', C.fut, 'ind'));
  sections.push(perfectSystem('perf', 'ind'));
  sections.push(perfectSystem('plupf', 'ind'));
  sections.push(perfectSystem('futperf', 'ind'));
  sections.push(presentSystem('pres', C.presSubj, 'subj'));
  sections.push(presentSystem('impf', C.impfSubj, 'subj'));
  sections.push(perfectSystem('perf', 'subj'));
  sections.push(perfectSystem('plupf', 'subj'));

  // imperative
  {
    const cols = [];
    const heads = [];
    const rowsSpec = [['2', 'sg', 'you (sg.)'], ['2', 'pl', 'you (pl.)']];
    if (!dep) {
      let sg = C.imper.act[0];
      let sgStem = r1;
      if (SHORT_IMPERATIVES[r1.normalize('NFD').replace(/[̀-ͯ]/g, '')]) { sg = ''; sgStem = SHORT_IMPERATIVES[r1.normalize('NFD').replace(/[̀-ͯ]/g, '')]; }
      cols.push([cell(sgStem, sg, { kind: 'imper', tense: 'pres', voice: 'act', number: 'sg' }), cell(r1, C.imper.act[1], { kind: 'imper', tense: 'pres', voice: 'act', number: 'pl' })]);
      heads.push('active');
    }
    if (!semi) {
      cols.push([cell(r1, C.imper.pass[0], { kind: 'imper', tense: 'pres', voice: 'pass', number: 'sg' }), cell(r1, C.imper.pass[1], { kind: 'imper', tense: 'pres', voice: 'pass', number: 'pl' })]);
      heads.push(dep ? 'deponent' : 'passive');
    }
    const rows = rowsSpec.map((r, i) => ({ label: r[2], cells: cols.map((c) => c[i]) }));
    // future imperative (active) as extra rows
    if (!dep) {
      rows.push({ label: 'future, you (sg.) / he', cells: cols.map((c, ci) => (ci === 0 ? cell(r1, C.imper.futAct[0], { kind: 'imper', tense: 'fut', voice: 'act', number: 'sg' }) : { ...cell('', '—'), empty: true })) });
      rows.push({ label: 'future, you (pl.)', cells: cols.map((c, ci) => (ci === 0 ? cell(r1, C.imper.futAct[1], { kind: 'imper', tense: 'fut', voice: 'act', number: 'pl', person: '2' }) : { ...cell('', '—'), empty: true })) });
      rows.push({ label: 'future, they', cells: cols.map((c, ci) => (ci === 0 ? cell(r1, C.imper.fut3[1], { kind: 'imper', tense: 'fut', voice: 'act', number: 'pl', person: '3' }) : { ...cell('', '—'), empty: true })) });
    }
    sections.push({ title: 'imperative', headers: heads, rows });
  }
  // infinitives
  {
    const heads = dep ? ['deponent'] : ['active', 'passive'];
    const rows = [];
    const presAct = cell(r1, C.inf.act, { kind: 'inf', tense: 'pres', voice: 'act' });
    const presPass = cell(r1, C.inf.pass, { kind: 'inf', tense: 'pres', voice: 'pass' });
    const perfAct = r2 ? cell(r2, 'isse', { kind: 'inf', tense: 'perf', voice: 'act' }) : { ...cell('', '—'), empty: true };
    const perfPass = r3 ? cell(r3, 'us esse', { kind: 'inf', tense: 'perf', voice: 'pass' }) : { ...cell('', '—'), empty: true };
    const futAct = r3 ? cell(r3, 'ūrus esse', { kind: 'inf', tense: 'fut', voice: 'act' }) : { ...cell('', '—'), empty: true };
    const futPass = r3 ? cell(r3, 'um īrī', { kind: 'inf', tense: 'fut', voice: 'pass' }) : { ...cell('', '—'), empty: true };
    if (dep) {
      rows.push({ label: 'present', cells: [presPass] });
      rows.push({ label: 'perfect', cells: [perfPass] });
      rows.push({ label: 'future', cells: [futAct] });
    } else {
      rows.push({ label: 'present', cells: [presAct, semi ? { ...cell('', '—'), empty: true } : presPass] });
      rows.push({ label: 'perfect', cells: [semi ? { ...cell('', '—'), empty: true } : perfAct, perfPass] });
      rows.push({ label: 'future', cells: [futAct, semi ? { ...cell('', '—'), empty: true } : futPass] });
    }
    sections.push({ title: 'infinitives', headers: heads, rows });
  }
  // participles, gerund, gerundive, supine
  {
    const rows = [];
    rows.push({ label: 'present active', cells: [cell(r1, C.presPtc, { kind: 'ptc', tense: 'pres', voice: 'act' })], note: `genitive ${r1}${C.presPtcGen}` });
    if (r3) rows.push({ label: dep ? 'perfect (active meaning)' : 'perfect passive', cells: [cell(r3, 'us -a -um', { kind: 'ptc', tense: 'perf', voice: 'pass' })] });
    if (r3) rows.push({ label: 'future active', cells: [cell(r3, 'ūrus -a -um', { kind: 'ptc', tense: 'fut', voice: 'act' })] });
    rows.push({ label: 'gerundive (future passive)', cells: [cell(r1, C.gerund + 'us -a -um', { kind: 'gerundive' })] });
    sections.push({ title: 'participles', headers: ['form'], rows });
    const g = C.gerund;
    sections.push({
      title: 'gerund',
      headers: ['form'],
      rows: [
        { label: 'genitive', cells: [cell(r1, g + 'ī', { kind: 'gerund', case: 'gen' })] },
        { label: 'dative', cells: [cell(r1, g + 'ō', { kind: 'gerund', case: 'dat' })] },
        { label: 'accusative', cells: [cell(r1, g + 'um', { kind: 'gerund', case: 'acc' })] },
        { label: 'ablative', cells: [cell(r1, g + 'ō', { kind: 'gerund', case: 'abl' })] },
      ],
    });
    if (r3) {
      sections.push({
        title: 'supine',
        headers: ['form'],
        rows: [
          { label: 'accusative (-um)', cells: [cell(r3, 'um', { kind: 'supine', case: 'acc' })] },
          { label: 'ablative (-ū)', cells: [cell(r3, 'ū', { kind: 'supine', case: 'abl' })] },
        ],
      });
    }
  }
  if (impers) {
    // keep only 3rd singular rows
    for (const s of sections) s.rows = s.rows.filter((r) => !/^(I|you|we|they)/.test(r.label));
  }
  const p = { kind: 'verb', title: `${entry.lemma} · ${conjugationName(entry) || 'verb'}`, sections };
  if (dep) p.note = 'Deponent: only the passive-looking forms exist, and they have active meanings (sequitur = he follows). The present and future participles and the gerund are active in form.';
  if (semi) p.note = 'Semi-deponent: active forms in the present, imperfect and future; passive-looking forms with active meaning in the perfect system.';
  if (impers) p.note = 'Impersonal: used only in the 3rd person singular ("it …").';
  return markHits(p, parses);
}

// ---------------------------------------------------------------------------
// irregular verbs — hand tables ('stem|ending'; six persons per tense)

const IRREGULAR_VERBS = {
  sum: {
    title: 'sum, esse, fuī, futūrum · be', note: 'No passive. futūrus = about to be.',
    ind: {
      pres: ['s|um', 'e|s', 'es|t', 's|umus', 'es|tis', 's|unt'],
      impf: ['er|am', 'er|ās', 'er|at', 'er|āmus', 'er|ātis', 'er|ant'],
      fut: ['er|ō', 'er|is', 'er|it', 'er|imus', 'er|itis', 'er|unt'],
      perf: ['fu|ī', 'fu|istī', 'fu|it', 'fu|imus', 'fu|istis', 'fu|ērunt'],
      plupf: ['fu|eram', 'fu|erās', 'fu|erat', 'fu|erāmus', 'fu|erātis', 'fu|erant'],
      futperf: ['fu|erō', 'fu|eris', 'fu|erit', 'fu|erimus', 'fu|eritis', 'fu|erint'],
    },
    subj: {
      pres: ['s|im', 's|īs', 's|it', 's|īmus', 's|ītis', 's|int'],
      impf: ['es|sem', 'es|sēs', 'es|set', 'es|sēmus', 'es|sētis', 'es|sent'],
      perf: ['fu|erim', 'fu|erīs', 'fu|erit', 'fu|erīmus', 'fu|erītis', 'fu|erint'],
      plupf: ['fu|issem', 'fu|issēs', 'fu|isset', 'fu|issēmus', 'fu|issētis', 'fu|issent'],
    },
    imper: { sg: 'es', pl: 'es|te', futSg: 'es|tō', futPl: 'es|tōte' },
    inf: { pres: 'es|se', perf: 'fu|isse', fut: 'fut|ūrus esse' },
    ptc: { fut: 'fut|ūrus -a -um' },
  },
  possum: {
    title: 'possum, posse, potuī · be able, can', note: 'pot- + sum; pos- before s. No passive, no imperative.',
    ind: {
      pres: ['pos|sum', 'pot|es', 'pot|est', 'pos|sumus', 'pot|estis', 'pos|sunt'],
      impf: ['pot|eram', 'pot|erās', 'pot|erat', 'pot|erāmus', 'pot|erātis', 'pot|erant'],
      fut: ['pot|erō', 'pot|eris', 'pot|erit', 'pot|erimus', 'pot|eritis', 'pot|erunt'],
      perf: ['potu|ī', 'potu|istī', 'potu|it', 'potu|imus', 'potu|istis', 'potu|ērunt'],
      plupf: ['potu|eram', 'potu|erās', 'potu|erat', 'potu|erāmus', 'potu|erātis', 'potu|erant'],
      futperf: ['potu|erō', 'potu|eris', 'potu|erit', 'potu|erimus', 'potu|eritis', 'potu|erint'],
    },
    subj: {
      pres: ['pos|sim', 'pos|sīs', 'pos|sit', 'pos|sīmus', 'pos|sītis', 'pos|sint'],
      impf: ['pos|sem', 'pos|sēs', 'pos|set', 'pos|sēmus', 'pos|sētis', 'pos|sent'],
      perf: ['potu|erim', 'potu|erīs', 'potu|erit', 'potu|erīmus', 'potu|erītis', 'potu|erint'],
      plupf: ['potu|issem', 'potu|issēs', 'potu|isset', 'potu|issēmus', 'potu|issētis', 'potu|issent'],
    },
    inf: { pres: 'pos|se', perf: 'potu|isse' },
    ptc: { pres: 'pot|ēns' },
  },
  eo: {
    title: 'eō, īre, iī, itum · go', note: 'Present participle iēns, genitive euntis. Gerund eundī. Passive only in compounds (trānsītur).',
    ind: {
      pres: ['e|ō', 'ī|s', 'i|t', 'ī|mus', 'ī|tis', 'e|unt'],
      impf: ['ī|bam', 'ī|bās', 'ī|bat', 'ī|bāmus', 'ī|bātis', 'ī|bant'],
      fut: ['ī|bō', 'ī|bis', 'ī|bit', 'ī|bimus', 'ī|bitis', 'ī|bunt'],
      perf: ['i|ī', 'ī|stī', 'i|it', 'i|imus', 'ī|stis', 'i|ērunt'],
      plupf: ['i|eram', 'i|erās', 'i|erat', 'i|erāmus', 'i|erātis', 'i|erant'],
      futperf: ['i|erō', 'i|eris', 'i|erit', 'i|erimus', 'i|eritis', 'i|erint'],
    },
    subj: {
      pres: ['e|am', 'e|ās', 'e|at', 'e|āmus', 'e|ātis', 'e|ant'],
      impf: ['ī|rem', 'ī|rēs', 'ī|ret', 'ī|rēmus', 'ī|rētis', 'ī|rent'],
      perf: ['i|erim', 'i|erīs', 'i|erit', 'i|erīmus', 'i|erītis', 'i|erint'],
      plupf: ['ī|ssem', 'ī|ssēs', 'ī|sset', 'ī|ssēmus', 'ī|ssētis', 'ī|ssent'],
    },
    imper: { sg: 'ī', pl: 'ī|te', futSg: 'ī|tō', futPl: 'ī|tōte' },
    inf: { pres: 'ī|re', perf: 'ī|sse', fut: 'it|ūrus esse' },
    ptc: { pres: 'i|ēns (euntis)', fut: 'it|ūrus -a -um', gerundive: 'e|undus -a -um' },
    gerund: 'e|und', supine: 'it',
  },
  fero: {
    title: 'ferō, ferre, tulī, lātum · carry, bring, bear', note: 'Present system drops the vowel before r, s, t: fers, fert, ferre.',
    ind: {
      pres: ['fer|ō', 'fer|s', 'fer|t', 'fer|imus', 'fer|tis', 'fer|unt'],
      impf: ['fer|ēbam', 'fer|ēbās', 'fer|ēbat', 'fer|ēbāmus', 'fer|ēbātis', 'fer|ēbant'],
      fut: ['fer|am', 'fer|ēs', 'fer|et', 'fer|ēmus', 'fer|ētis', 'fer|ent'],
      perf: ['tul|ī', 'tul|istī', 'tul|it', 'tul|imus', 'tul|istis', 'tul|ērunt'],
      plupf: ['tul|eram', 'tul|erās', 'tul|erat', 'tul|erāmus', 'tul|erātis', 'tul|erant'],
      futperf: ['tul|erō', 'tul|eris', 'tul|erit', 'tul|erimus', 'tul|eritis', 'tul|erint'],
    },
    indPass: {
      pres: ['fer|or', 'fer|ris', 'fer|tur', 'fer|imur', 'fer|iminī', 'fer|untur'],
      impf: ['fer|ēbar', 'fer|ēbāris', 'fer|ēbātur', 'fer|ēbāmur', 'fer|ēbāminī', 'fer|ēbantur'],
      fut: ['fer|ar', 'fer|ēris', 'fer|ētur', 'fer|ēmur', 'fer|ēminī', 'fer|entur'],
      perf: ['lāt|us sum', 'lāt|us es', 'lāt|us est', 'lāt|ī sumus', 'lāt|ī estis', 'lāt|ī sunt'],
      plupf: ['lāt|us eram', 'lāt|us erās', 'lāt|us erat', 'lāt|ī erāmus', 'lāt|ī erātis', 'lāt|ī erant'],
      futperf: ['lāt|us erō', 'lāt|us eris', 'lāt|us erit', 'lāt|ī erimus', 'lāt|ī eritis', 'lāt|ī erunt'],
    },
    subj: {
      pres: ['fer|am', 'fer|ās', 'fer|at', 'fer|āmus', 'fer|ātis', 'fer|ant'],
      impf: ['fer|rem', 'fer|rēs', 'fer|ret', 'fer|rēmus', 'fer|rētis', 'fer|rent'],
      perf: ['tul|erim', 'tul|erīs', 'tul|erit', 'tul|erīmus', 'tul|erītis', 'tul|erint'],
      plupf: ['tul|issem', 'tul|issēs', 'tul|isset', 'tul|issēmus', 'tul|issētis', 'tul|issent'],
    },
    subjPass: {
      pres: ['fer|ar', 'fer|āris', 'fer|ātur', 'fer|āmur', 'fer|āminī', 'fer|antur'],
      impf: ['fer|rer', 'fer|rēris', 'fer|rētur', 'fer|rēmur', 'fer|rēminī', 'fer|rentur'],
      perf: ['lāt|us sim', 'lāt|us sīs', 'lāt|us sit', 'lāt|ī sīmus', 'lāt|ī sītis', 'lāt|ī sint'],
      plupf: ['lāt|us essem', 'lāt|us essēs', 'lāt|us esset', 'lāt|ī essēmus', 'lāt|ī essētis', 'lāt|ī essent'],
    },
    imper: { sg: 'fer', pl: 'fer|te', futSg: 'fer|tō', futPl: 'fer|tōte', passSg: 'fer|re', passPl: 'fer|iminī' },
    inf: { pres: 'fer|re', perf: 'tul|isse', fut: 'lāt|ūrus esse', presPass: 'fer|rī', perfPass: 'lāt|us esse', futPass: 'lāt|um īrī' },
    ptc: { pres: 'fer|ēns', perf: 'lāt|us -a -um', fut: 'lāt|ūrus -a -um', gerundive: 'fer|endus -a -um' },
    gerund: 'fer|end', supine: 'lāt',
  },
  volo: {
    title: 'volō, velle, voluī · want, be willing', note: 'No passive, no imperative. vīs = you want (not the noun vīs).',
    ind: {
      pres: ['vol|ō', 'vī|s', 'vul|t', 'vol|umus', 'vul|tis', 'vol|unt'],
      impf: ['vol|ēbam', 'vol|ēbās', 'vol|ēbat', 'vol|ēbāmus', 'vol|ēbātis', 'vol|ēbant'],
      fut: ['vol|am', 'vol|ēs', 'vol|et', 'vol|ēmus', 'vol|ētis', 'vol|ent'],
      perf: ['volu|ī', 'volu|istī', 'volu|it', 'volu|imus', 'volu|istis', 'volu|ērunt'],
      plupf: ['volu|eram', 'volu|erās', 'volu|erat', 'volu|erāmus', 'volu|erātis', 'volu|erant'],
      futperf: ['volu|erō', 'volu|eris', 'volu|erit', 'volu|erimus', 'volu|eritis', 'volu|erint'],
    },
    subj: {
      pres: ['vel|im', 'vel|īs', 'vel|it', 'vel|īmus', 'vel|ītis', 'vel|int'],
      impf: ['vel|lem', 'vel|lēs', 'vel|let', 'vel|lēmus', 'vel|lētis', 'vel|lent'],
      perf: ['volu|erim', 'volu|erīs', 'volu|erit', 'volu|erīmus', 'volu|erītis', 'volu|erint'],
      plupf: ['volu|issem', 'volu|issēs', 'volu|isset', 'volu|issēmus', 'volu|issētis', 'volu|issent'],
    },
    inf: { pres: 'vel|le', perf: 'volu|isse' },
    ptc: { pres: 'vol|ēns' },
  },
  nolo: {
    title: 'nōlō, nōlle, nōluī · not want, be unwilling', note: 'nōn + volō. Its imperative nōlī / nōlīte + infinitive is the usual way to say "don\'t".',
    ind: {
      pres: ['nōl|ō', 'nōn vīs', 'nōn vult', 'nōl|umus', 'nōn vultis', 'nōl|unt'],
      impf: ['nōl|ēbam', 'nōl|ēbās', 'nōl|ēbat', 'nōl|ēbāmus', 'nōl|ēbātis', 'nōl|ēbant'],
      fut: ['nōl|am', 'nōl|ēs', 'nōl|et', 'nōl|ēmus', 'nōl|ētis', 'nōl|ent'],
      perf: ['nōlu|ī', 'nōlu|istī', 'nōlu|it', 'nōlu|imus', 'nōlu|istis', 'nōlu|ērunt'],
      plupf: ['nōlu|eram', 'nōlu|erās', 'nōlu|erat', 'nōlu|erāmus', 'nōlu|erātis', 'nōlu|erant'],
      futperf: ['nōlu|erō', 'nōlu|eris', 'nōlu|erit', 'nōlu|erimus', 'nōlu|eritis', 'nōlu|erint'],
    },
    subj: {
      pres: ['nōl|im', 'nōl|īs', 'nōl|it', 'nōl|īmus', 'nōl|ītis', 'nōl|int'],
      impf: ['nōl|lem', 'nōl|lēs', 'nōl|let', 'nōl|lēmus', 'nōl|lētis', 'nōl|lent'],
      perf: ['nōlu|erim', 'nōlu|erīs', 'nōlu|erit', 'nōlu|erīmus', 'nōlu|erītis', 'nōlu|erint'],
      plupf: ['nōlu|issem', 'nōlu|issēs', 'nōlu|isset', 'nōlu|issēmus', 'nōlu|issētis', 'nōlu|issent'],
    },
    imper: { sg: 'nōl|ī', pl: 'nōl|īte', futSg: 'nōl|ītō', futPl: 'nōl|ītōte' },
    inf: { pres: 'nōl|le', perf: 'nōlu|isse' },
    ptc: { pres: 'nōl|ēns' },
  },
  malo: {
    title: 'mālō, mālle, māluī · prefer', note: 'magis + volō. No passive, no imperative.',
    ind: {
      pres: ['māl|ō', 'māvīs', 'māvult', 'māl|umus', 'māvultis', 'māl|unt'],
      impf: ['māl|ēbam', 'māl|ēbās', 'māl|ēbat', 'māl|ēbāmus', 'māl|ēbātis', 'māl|ēbant'],
      fut: ['māl|am', 'māl|ēs', 'māl|et', 'māl|ēmus', 'māl|ētis', 'māl|ent'],
      perf: ['mālu|ī', 'mālu|istī', 'mālu|it', 'mālu|imus', 'mālu|istis', 'mālu|ērunt'],
      plupf: ['mālu|eram', 'mālu|erās', 'mālu|erat', 'mālu|erāmus', 'mālu|erātis', 'mālu|erant'],
      futperf: ['mālu|erō', 'mālu|eris', 'mālu|erit', 'mālu|erimus', 'mālu|eritis', 'mālu|erint'],
    },
    subj: {
      pres: ['māl|im', 'māl|īs', 'māl|it', 'māl|īmus', 'māl|ītis', 'māl|int'],
      impf: ['māl|lem', 'māl|lēs', 'māl|let', 'māl|lēmus', 'māl|lētis', 'māl|lent'],
      perf: ['mālu|erim', 'mālu|erīs', 'mālu|erit', 'mālu|erīmus', 'mālu|erītis', 'mālu|erint'],
      plupf: ['mālu|issem', 'mālu|issēs', 'mālu|isset', 'mālu|issēmus', 'mālu|issētis', 'mālu|issent'],
    },
    inf: { pres: 'māl|le', perf: 'mālu|isse' },
  },
  fio: {
    title: 'fīō, fierī, factus sum · become, be made, happen', note: 'Serves as the passive of faciō. Active-looking present system, passive perfect system.',
    ind: {
      pres: ['fī|ō', 'fī|s', 'fi|t', 'fī|mus', 'fī|tis', 'fī|unt'],
      impf: ['fī|ēbam', 'fī|ēbās', 'fī|ēbat', 'fī|ēbāmus', 'fī|ēbātis', 'fī|ēbant'],
      fut: ['fī|am', 'fī|ēs', 'fī|et', 'fī|ēmus', 'fī|ētis', 'fī|ent'],
      perf: ['fact|us sum', 'fact|us es', 'fact|us est', 'fact|ī sumus', 'fact|ī estis', 'fact|ī sunt'],
      plupf: ['fact|us eram', 'fact|us erās', 'fact|us erat', 'fact|ī erāmus', 'fact|ī erātis', 'fact|ī erant'],
      futperf: ['fact|us erō', 'fact|us eris', 'fact|us erit', 'fact|ī erimus', 'fact|ī eritis', 'fact|ī erunt'],
    },
    subj: {
      pres: ['fī|am', 'fī|ās', 'fī|at', 'fī|āmus', 'fī|ātis', 'fī|ant'],
      impf: ['fi|erem', 'fi|erēs', 'fi|eret', 'fi|erēmus', 'fi|erētis', 'fi|erent'],
      perf: ['fact|us sim', 'fact|us sīs', 'fact|us sit', 'fact|ī sīmus', 'fact|ī sītis', 'fact|ī sint'],
      plupf: ['fact|us essem', 'fact|us essēs', 'fact|us esset', 'fact|ī essēmus', 'fact|ī essētis', 'fact|ī essent'],
    },
    imper: { sg: 'fī', pl: 'fī|te' },
    inf: { pres: 'fi|erī', perf: 'fact|us esse', fut: 'fact|um īrī' },
    ptc: { perf: 'fact|us -a -um', gerundive: 'faci|endus -a -um' },
    perfIsPassive: true,
  },
};

function irregularVerb(entry, t, parses, prefix = '') {
  const sections = [];
  const P = (s) => (prefix && s && s !== '—' ? (s.startsWith('nōn ') ? s : prefix + s) : s);
  const voiceOfTense = (tense) => (t.perfIsPassive && ['perf', 'plupf', 'futperf'].includes(tense) ? 'pass' : 'act');
  const tenseSection = (tense, mood) => {
    const table = mood === 'ind' ? t.ind : t.subj;
    const passTable = mood === 'ind' ? t.indPass : t.subjPass;
    if (!table?.[tense]) return null;
    const cols = [];
    const heads = [];
    const v = voiceOfTense(tense);
    cols.push(table[tense].map((s, i) => splitCell(P(s), fk(tense, mood, v, i))));
    heads.push(v === 'pass' ? 'passive form' : 'active');
    if (passTable?.[tense]) {
      cols.push(passTable[tense].map((s, i) => splitCell(P(s), fk(tense, mood, 'pass', i))));
      heads.push('passive');
    }
    return { title: `${TENSE_LABEL[tense]} ${mood === 'subj' ? 'subjunctive' : 'indicative'}`, headers: heads, rows: personRows(cols) };
  };
  for (const tense of TENSES) { const s = tenseSection(tense, 'ind'); if (s) sections.push(s); }
  for (const tense of ['pres', 'impf', 'perf', 'plupf']) { const s = tenseSection(tense, 'subj'); if (s) sections.push(s); }
  if (t.imper) {
    const rows = [
      { label: 'you (sg.)', cells: [splitCell(P(t.imper.sg), { kind: 'imper', tense: 'pres', voice: 'act', number: 'sg' })] },
      { label: 'you (pl.)', cells: [splitCell(P(t.imper.pl), { kind: 'imper', tense: 'pres', voice: 'act', number: 'pl' })] },
    ];
    if (t.imper.futSg) rows.push({ label: 'future, you (sg.) / he', cells: [splitCell(P(t.imper.futSg), { kind: 'imper', tense: 'fut', voice: 'act', number: 'sg' })] });
    if (t.imper.futPl) rows.push({ label: 'future, you (pl.)', cells: [splitCell(P(t.imper.futPl), { kind: 'imper', tense: 'fut', voice: 'act', number: 'pl', person: '2' })] });
    const heads = ['active'];
    if (t.imper.passSg) {
      rows[0].cells.push(splitCell(P(t.imper.passSg), { kind: 'imper', tense: 'pres', voice: 'pass', number: 'sg' }));
      rows[1].cells.push(splitCell(P(t.imper.passPl), { kind: 'imper', tense: 'pres', voice: 'pass', number: 'pl' }));
      heads.push('passive');
    }
    sections.push({ title: 'imperative', headers: heads, rows });
  }
  if (t.inf) {
    const rows = [];
    const hasPass = !!t.inf.presPass;
    const heads = hasPass ? ['active', 'passive'] : ['form'];
    const row = (label, a, b, tense) => {
      const cells = [a ? splitCell(P(a), { kind: 'inf', tense, voice: t.perfIsPassive && tense !== 'pres' ? 'pass' : 'act' }) : { ...cell('', '—'), empty: true }];
      if (hasPass) cells.push(b ? splitCell(P(b), { kind: 'inf', tense, voice: 'pass' }) : { ...cell('', '—'), empty: true });
      rows.push({ label, cells });
    };
    row('present', t.inf.pres, t.inf.presPass, 'pres');
    row('perfect', t.inf.perf, t.inf.perfPass, 'perf');
    row('future', t.inf.fut, t.inf.futPass, 'fut');
    sections.push({ title: 'infinitives', headers: heads, rows });
  }
  if (t.ptc) {
    const rows = [];
    if (t.ptc.pres) rows.push({ label: 'present active', cells: [splitCell(P(t.ptc.pres), { kind: 'ptc', tense: 'pres', voice: 'act' })] });
    if (t.ptc.perf) rows.push({ label: 'perfect passive', cells: [splitCell(P(t.ptc.perf), { kind: 'ptc', tense: 'perf', voice: 'pass' })] });
    if (t.ptc.fut) rows.push({ label: 'future active', cells: [splitCell(P(t.ptc.fut), { kind: 'ptc', tense: 'fut', voice: 'act' })] });
    if (t.ptc.gerundive) rows.push({ label: 'gerundive (future passive)', cells: [splitCell(P(t.ptc.gerundive), { kind: 'gerundive' })] });
    sections.push({ title: 'participles', headers: ['form'], rows });
  }
  if (t.gerund) {
    const g = splitCell(P(t.gerund));
    sections.push({
      title: 'gerund', headers: ['form'],
      rows: [
        { label: 'genitive', cells: [cell(g.text, 'ī', { kind: 'gerund', case: 'gen' })] },
        { label: 'dative', cells: [cell(g.text, 'ō', { kind: 'gerund', case: 'dat' })] },
        { label: 'accusative', cells: [cell(g.text, 'um', { kind: 'gerund', case: 'acc' })] },
        { label: 'ablative', cells: [cell(g.text, 'ō', { kind: 'gerund', case: 'abl' })] },
      ],
    });
  }
  if (t.supine) {
    sections.push({
      title: 'supine', headers: ['form'],
      rows: [
        { label: 'accusative (-um)', cells: [cell(P(t.supine), 'um', { kind: 'supine', case: 'acc' })] },
        { label: 'ablative (-ū)', cells: [cell(P(t.supine), 'ū', { kind: 'supine', case: 'abl' })] },
      ],
    });
  }
  const title = prefix ? `${entry.lemma} · compound of ${t.title.split(' ·')[0].split(',')[0]} (irregular)` : `${t.title} · irregular verb`;
  const p = { kind: 'verb', title, note: t.note, sections };
  return markHits(p, parses);
}

function compoundOf(entry, baseKey, parses) {
  const base = IRREGULAR_VERBS[baseKey];
  const r0 = root(entry, 0);
  // prefix = the compound's first root minus the base's first root ('abs' - 's' = 'ab', 'abe' - 'e' = 'ab', 'aufer' - 'fer' = 'au')
  const baseR0 = { sum: 's', eo: 'e', fero: 'fer' }[baseKey];
  let prefix = r0.endsWith(baseR0) ? r0.slice(0, r0.length - baseR0.length) : r0;
  if (baseKey === 'fero') {
    // compounds of ferō have their own perfect/participle stems
    const r2 = root(entry, 2, 'tul');
    const r3 = root(entry, 3, 'lāt');
    const t = JSON.parse(JSON.stringify(base));
    const swap = (arr, from, to) => arr.map((s) => s.replace(new RegExp('^' + from), to));
    for (const k of ['perf', 'plupf', 'futperf']) { t.ind[k] = swap(t.ind[k], 'tul', ' ' + r2); t.indPass[k] = swap(t.indPass[k], 'lāt', ' ' + r3); }
    for (const k of ['perf', 'plupf']) { t.subj[k] = swap(t.subj[k], 'tul', ' ' + r2); t.subjPass[k] = swap(t.subjPass[k], 'lāt', ' ' + r3); }
    t.inf.perf = ' ' + r2 + '|isse'; t.inf.perfPass = ' ' + r3 + '|us esse'; t.inf.fut = ' ' + r3 + '|ūrus esse'; t.inf.futPass = ' ' + r3 + '|um īrī';
    t.ptc.perf = ' ' + r3 + '|us -a -um'; t.ptc.fut = ' ' + r3 + '|ūrus -a -um'; t.supine = ' ' + r3;
    const p = irregularVerb(entry, t, parses, prefix);
    // strip the marker that protected already-prefixed stems
    for (const s of p.sections) for (const r of s.rows) for (const c of r.cells) {
      if (c.text.includes(' ')) { c.text = c.text.replace(prefix + ' ', '').replace(' ', ''); c.stem = c.stem.replace(prefix + ' ', '').replace(' ', ''); }
    }
    return p;
  }
  return irregularVerb(entry, base, parses, prefix);
}

// ---------------------------------------------------------------------------
// numerals

const NUM_TABLES = {
  unus: { title: 'ūnus, ūna, ūnum · one', headers: ['masculine', 'feminine', 'neuter'],
    sg: [['ūn|us', 'ūn|a', 'ūn|um'], ['ūn|īus', 'ūn|īus', 'ūn|īus'], ['ūn|ī', 'ūn|ī', 'ūn|ī'], ['ūn|um', 'ūn|am', 'ūn|um'], ['ūn|ō', 'ūn|ā', 'ūn|ō']] },
  duo: { title: 'duo, duae, duo · two', headers: ['masculine', 'feminine', 'neuter'],
    pl: [['du|o', 'du|ae', 'du|o'], ['du|ōrum', 'du|ārum', 'du|ōrum'], ['du|ōbus', 'du|ābus', 'du|ōbus'], ['du|ōs / du|o', 'du|ās', 'du|o'], ['du|ōbus', 'du|ābus', 'du|ōbus']] },
  tres: { title: 'trēs, tria · three', headers: ['masculine / feminine', 'neuter'], genders: ['c', 'n'],
    pl: [['tr|ēs', 'tr|ia'], ['tr|ium', 'tr|ium'], ['tr|ibus', 'tr|ibus'], ['tr|ēs', 'tr|ia'], ['tr|ibus', 'tr|ibus']] },
};

function numeralParadigm(entry, parses) {
  const t = NUM_TABLES[entry.h];
  if (t) {
    const genders = t.genders || GENDERS;
    const caseList = ['nom', 'gen', 'dat', 'acc', 'abl'];
    const rows = [];
    for (const num of ['sg', 'pl']) {
      if (!t[num]) continue;
      for (let i = 0; i < caseList.length; i++) {
        rows.push({ label: `${CASE_LABEL[caseList[i]]} ${num === 'sg' ? 'sg.' : 'pl.'}`, cells: t[num][i].map((s, gi) => { const c = splitCell(s.split(' / ')[0], nk(caseList[i], num, genders[gi])); if (s.includes(' / ')) c.text = s.replace(/\|/g, ''); return c; }) });
      }
    }
    return markHits({ kind: 'adjective', title: t.title, sections: [{ title: 'cases', headers: t.headers, rows }] }, parses);
  }
  // ordinals and hundreds decline like bonus
  if (/-a -um$/.test(entry.lemma) || /ī -ae -a$/.test(entry.lemma)) {
    const stem = entry.lemma.split(/[\s-]/)[0].replace(/(us|ī)$/, '');
    const fake = { ...entry, pos: 'ADJ', cat: [1, 1], roots: [stem, stem, '-', '-'] };
    return adjectiveParadigm(fake, parses);
  }
  return null;
}

// ---------------------------------------------------------------------------
// entry point

export function paradigm(entry, parse) {
  if (!entry) return null;
  const parses = asList(parse);
  try {
    switch (entry.pos) {
      case 'N': return nounParadigm(entry, parses);
      case 'ADJ': return adjectiveParadigm(entry, parses);
      case 'V':
      case 'VPAR': return verbParadigm(entry, parses);
      case 'PRON': return pronounParadigm(entry, parses);
      case 'NUM': return numeralParadigm(entry, parses);
      default: return null;
    }
  } catch (err) {
    console.error('paradigm failed for', entry?.h, err);
    return null;
  }
}

export { IRREGULAR_VERBS, PRON_TABLES, CONJ, NOUN_ENDINGS };
