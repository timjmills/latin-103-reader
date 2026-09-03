// Latin tokeniser — shared by every module that needs to split a `la` string.
//
// tokenize(la) → [{ text, form, start, end, isWord }]
//   text   the exact slice of the original string
//   form   lookup key: lowercase, macrons stripped, '' for non-words
//   start  offset of the slice in the original string (end is exclusive)
//   isWord true for Latin words; false for punctuation, quotes, spaces, "…"
//
// Every character of the input lands in exactly one token, so the UI can
// rebuild the sentence by concatenating token.text in order.
//
// Words: runs of Latin letters, including macron vowels (āēīōūȳ and capitals)
// and the combining macron (U+0304) in case a source is NFD. Apostrophes,
// hyphens, digits, quotes and "…" are never part of a word.

const MACRON_MAP = {
  'ā': 'a', 'ē': 'e', 'ī': 'i', 'ō': 'o', 'ū': 'u', 'ȳ': 'y',
  'Ā': 'A', 'Ē': 'E', 'Ī': 'I', 'Ō': 'O', 'Ū': 'U', 'Ȳ': 'Y',
  '̄': '',            // combining macron
  'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'Œ': 'Oe',
};
const MACRON_RE = /[āēīōūȳĀĒĪŌŪȲ̄æÆœŒ]/g;
const WORD_RE = /[A-Za-zāēīōūȳĀĒĪŌŪȲæÆœŒ̄]+/g;

/** ā→a etc. Keeps case. */
export function stripMacrons(s) {
  return String(s).replace(MACRON_RE, (c) => MACRON_MAP[c] ?? c);
}

/** Lookup key for a word: lowercase + macrons stripped. */
export function normalizeForm(word) {
  return stripMacrons(word).toLowerCase();
}

export function tokenize(la) {
  const s = String(la ?? '');
  const out = [];
  let pos = 0;
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(s)) !== null) {
    if (m.index > pos) {
      out.push({ text: s.slice(pos, m.index), form: '', start: pos, end: m.index, isWord: false });
    }
    out.push({ text: m[0], form: normalizeForm(m[0]), start: m.index, end: m.index + m[0].length, isWord: true });
    pos = m.index + m[0].length;
  }
  if (pos < s.length) {
    out.push({ text: s.slice(pos), form: '', start: pos, end: s.length, isWord: false });
  }
  return out;
}

/** Convenience: only the word tokens. */
export function words(la) {
  return tokenize(la).filter((t) => t.isWord);
}
