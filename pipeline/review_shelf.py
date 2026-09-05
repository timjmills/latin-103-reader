#!/usr/bin/env python
"""
review_shelf.py — Familia Romana chapters I–XXIV from the scan's text layer
→ data/build/review-NN.json (+ seed SQL), the "Review shelf" of
docs/GRAMMAR-CONTRACT.md.

    python pipeline/review_shelf.py                 # chapters 1–24
    python pipeline/review_shelf.py 1 7 15 24       # selected chapters
    python pipeline/review_shelf.py --sql           # also write data/build/sql/rNN-*.sql
    python pipeline/review_shelf.py 1 --dump        # print every numbered row (debug)
    python pipeline/review_shelf.py 1 --render DIR  # render the chapter's pages to PNG (spot check)

Nothing here touches app/ or supabase/, and nothing is uploaded.

How the text is rebuilt
  Pages: the k-th page whose running head reads CAPITVLVM is the start of
  chapter k; a chapter's reading runs from there to the page carrying its
  GRAMMATICA LATINA heading (rows below that heading are cut, exactly as
  extract_margins.extract_week does), so Grammatica and Pēnsa are excluded.
  Rows: extract_margins.classify_page splits every page into main-text rows,
  gloss rows and margin numbers; extract_margins.number_rows gives each main
  row its printed line number from the every-5th-line numbers.
  Paragraphs (= blocks): Ørberg indents the first line of every paragraph by
  about 11 pt.  A row whose left edge is 5–30 pt right of the page's main
  column edge starts a paragraph; so does a row that follows a vertical gap of
  more than 1.6 line pitches (set-off matter such as inscriptions).  The
  report says how many blocks each rule produced.
  Words: rows are joined (soft hyphens and end-of-row hyphenation glued; the
  scan's quotation marks — w / M for ”, u for “ — restored).  Each token is
  cleaned against extract_margins' lexicon (the macronised spellings attested
  by the week sources and the FR/FL text layers), supplemented with the
  capital-I words that lexicon filters out (Iūlius, Italia) and with the clean
  week sources as a trusted tier:
    - a printed spelling that is the attested one is kept — unless it has the
      shape of the scan's ī → l slip (an l between consonants or a final l:
      Qulntus, paucl), which no Latin word has;
    - the scan's systematic slips (ī → l / fl / I, rn → m, ii/vi → u, n → u,
      Q → ū) are repaired to an attested word — for a rare printed form any
      macronised sighting of the repair will do, for a frequent one the
      repair must be clearly more frequent still (vīlla never becomes ūlla);
    - a lost ī (pueri → puerī) is restored whenever the macronised spelling is
      at least as common — this scan loses ī constantly (65 pueri : 70 puerī)
      and the other macrons almost never (2 mater : 128 māter), so those are
      restored only for a rare printed spelling of a common word; a form the
      clean sources know, or a real minimal pair (hic / hīc, liber / līber),
      is always kept as printed;
    - two words the OCR ran together (fluviīin, laetīsunt, fīliōsuō) are
      split when both halves are real words and the print's macrons agree;
    - a junk-bearing token (digits, |, !) goes to extract_margins.macronise_token;
      a clean but unattested word is kept as printed and listed.
  A token that stays unreadable (junk characters, un-Latin letter clusters)
  or a printed line the layout step lost (a numbering gap) drops the sentence
  it interrupts, listed in the report; a gap between two complete sentences
  (a lost "Scaena secunda" heading) costs nothing.
  Sentences: build_week.split_sentences (the same rules as every other week).
  Ids: rNN:<line>.<k> — the printed line the sentence starts on, k-th sentence
  starting on that line.  `lines` = where each printed line begins inside the
  sentence (a word broken across lines stays with the line it begins on).
  Glosses: extract_margins.assemble_glosses + clean_glosses, tied to the
  nearest main row's line, then attached to the unit printed on that line with
  attach_margins' headword-stem preference.

Outputs (data/build/)
  review-NN.json      CONTRACT week shape; week.n = 100 + chapter, id rNN
  review-REPORT.md    per chapter: pages, units, blocks, lines mapped, glosses,
                      dropped sentences, unverified tokens, layout notes
  sql/rNN-*.sql       with --sql (seed_sql.week_sql on the review file)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import extract_margins as em  # noqa: E402  (page geometry, numbering, glosses, lexicon)
from attach_margins import blocks_of, check_lines, gloss_stem, unit_has_stem  # noqa: E402
from build_week import norm_ws, split_sentences  # noqa: E402
import seed_sql  # noqa: E402

BUILD = ROOT / "data" / "build"
SCAN = ROOT / "scans" / "familia-romana.pdf"

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI",
         "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV"]

# Chapter titles as printed (checked against the scan's capitals in `check_title`).
TITLES = {
    1: "Imperium Rōmānum", 2: "Familia Rōmāna", 3: "Puer Improbus", 4: "Dominus et Servī",
    5: "Vīlla et Hortus", 6: "Via Latīna", 7: "Puella et Rosa", 8: "Taberna Rōmāna",
    9: "Pāstor et Ovēs", 10: "Bēstiae et Hominēs", 11: "Corpus Hūmānum", 12: "Mīles Rōmānus",
    13: "Annus et Mēnsēs", 14: "Novus Diēs", 15: "Magister et Discipulī", 16: "Tempestās",
    17: "Numerī Difficilēs", 18: "Litterae Latīnae", 19: "Marītus et Uxor", 20: "Parentēs",
    21: "Pugna Discipulōrum", 22: "Cavē Canem", 23: "Epistula Magistrī", 24: "Puer Aegrōtus",
}

# The main grammar topic of each chapter = the heading of the learner's notes
# for that week (Latin Grammar Topics.pdf, weeks 1–24; page numbers in `pages`).
FOCUS = {
    1: ("nominative", "Nominative case: singular and plural, gender, adjective agreement", [1, 3, 4]),
    2: ("genitive", "Genitive case", [5, 6, 7]),
    3: ("accusative", "Accusative case; indicative verbs", [8, 10, 12]),
    4: ("imperative", "Imperative mood; vocative case", [13, 14]),
    5: ("ablative", "Ablative case: location, origin, means; accusative of destination", [15, 17, 18, 19]),
    6: ("passive", "Passive voice; ablative of agent", [20, 22]),
    7: ("dative", "Dative case: indirect objects", [23]),
    8: ("demonstratives", "Demonstratives, pronouns and the relative pronoun", [21, 24, 26, 27]),
    9: ("decl3", "3rd declension nouns", [29]),
    10: ("infinitive", "Infinitive mood; accusative + infinitive", [30, 32]),
    11: ("decl3-neuter", "3rd declension neuter nouns", [34]),
    12: ("decl4-comparative", "4th declension; dative of possession; comparative adjectives", [38, 39, 40]),
    13: ("decl5-superlative", "5th declension; ablative of time; superlative", [42, 43, 44]),
    14: ("participles", "Present participles", [45]),
    15: ("personal-endings", "Personal pronouns; active personal endings", [47, 50, 52]),
    16: ("deponent-abl-abs", "Deponent verbs; ablative absolute; ablative of degree", [54, 55, 56]),
    17: ("passive-endings", "Passive and deponent personal endings", [57]),
    18: ("adverbs", "Adverbs; enclitics", [59, 62]),
    19: ("imperfect", "Imperfect indicative; irregular adjectives", [64, 66, 67, 68]),
    20: ("future", "Future indicative; nōlī + infinitive", [69, 71, 73, 74]),
    21: ("perfect", "Principal parts; perfect indicative and perfect passive participle", [75, 78, 80, 82, 83]),
    22: ("supine-perf-deponent", "Supine; perfect ablative absolute; perfect deponents", [84, 85, 86, 87]),
    23: ("future-participle", "Future active participle; future infinitive", [88, 89]),
    24: ("pluperfect", "Pluperfect indicative; ablative of comparison", [90, 92]),
}

SOFT_HYPHEN = em.SOFT_HYPHEN
LETTERS = em.LETTERS
GAP = "\x00"  # stands in the token stream for a printed line the layout step lost

# ------------------------------------------------------------------ pages

def chapter_pages(pdf, max_chapter: int = 24) -> dict[int, list[int]]:
    """chapter → 1-based pages from its CAPITVLVM head up to the next chapter's head."""
    starts: list[int] = []
    for i, page in enumerate(pdf.pages):
        words = page.extract_words(x_tolerance=1.0, extra_attrs=["size"])
        head = " ".join(w["text"] for w in words if w["top"] < 45).replace(" ", "")
        if "CAPITVLVM" in head or "CAPITULUM" in head:
            starts.append(i + 1)
        if len(starts) > max_chapter:
            break
    out: dict[int, list[int]] = {}
    for k, p in enumerate(starts[:max_chapter], start=1):
        end = starts[k] - 1 if k < len(starts) else len(pdf.pages)
        out[k] = list(range(p, end + 1))
    return out


_CUT_WORD = re.compile(r"^(GRAMMAT[A-Z1l]+|PENS[VU]M[A-Z]*)$")


def reading_cut(page) -> float | None:
    """y of the GRAMMATICA LATINA / PENSVM heading on this page, or None."""
    cut = None
    for w in page.extract_words(x_tolerance=1.0, extra_attrs=["size"]):
        if w["top"] > 45 and w["size"] > 9 and _CUT_WORD.match(w["text"]):
            cut = w["top"] if cut is None else min(cut, w["top"])
    return cut


def classify_chapter(pdf, pages: list[int], notes: list[str]) -> tuple[list[dict], bool]:
    """classify_page for every page of the reading, cut at Grammatica. → (pages, cut found?)"""
    classified = []
    found = False
    for p in pages:
        pg = em.classify_page(pdf.pages[p - 1], p, "FR")
        cut = reading_cut(pdf.pages[p - 1])
        if cut is not None:
            pg["main"] = [r for r in pg["main"] if r.top < cut - 2]
            pg["margin"] = [r for r in pg["margin"] if r.top < cut - 2]
            pg["nums"] = [t for t in pg["nums"] if t[0] < cut - 2]
            found = True
        classified.append(pg)
        if found:
            break
    em.number_rows(classified, notes)
    return classified, found


def check_title(pdf, page_no: int, chapter: int, notes: list[str]) -> None:
    words = pdf.pages[page_no - 1].extract_words(x_tolerance=1.0, extra_attrs=["size"])
    caps = " ".join(w["text"] for w in words if w["size"] > 11 and w["text"].isupper() and w["top"] > 45)
    want = em.strip_macrons(TITLES[chapter]).upper().replace("U", "V")
    if want not in caps.replace("  ", " "):
        notes.append(f"p{page_no}: printed title {caps[:40]!r} does not contain {want!r} — check TITLES")


# ------------------------------------------------------------------ paragraphs

def mark_paragraphs(pages: list[dict], stats: dict) -> list[tuple[em.Row, bool]]:
    """→ [(row, starts a paragraph?)] over the chapter's numbered rows.
    Indent (5–30 pt right of the page's column edge) or a vertical gap > 1.6
    pitches starts a paragraph; the chapter's first row always does."""
    out: list[tuple[em.Row, bool]] = []
    # the column's left edge per page side: the 10th percentile of row starts over the
    # chapter (a dialogue page may have more indented rows than flush ones)
    edge: dict[str, float] = {}
    for side in ("recto", "verso"):
        xs = sorted(r.x0 for pg in pages if pg["side"] == side for r in pg["main"] if r.line_no is not None)
        if xs:
            edge[side] = xs[len(xs) // 10]
    for pg in pages:
        rows = [r for r in pg["main"] if r.line_no is not None]
        if not rows:
            continue
        page_min = min(r.x0 for r in rows)
        col_left = page_min if abs(page_min - edge.get(pg["side"], page_min)) < 6 else edge[pg["side"]]
        pitches = sorted(b.top - a.top for a, b in zip(rows, rows[1:]))
        pitch = pitches[len(pitches) // 2] if pitches else 12.0
        for k, r in enumerate(rows):
            indent = 5 < r.x0 - col_left < 30
            gap = k > 0 and (r.top - rows[k - 1].top) > 1.6 * pitch
            start = indent or gap or not out
            if start:
                stats["para_indent" if indent else ("para_gap" if gap else "para_first")] += 1
            out.append((r, start))
    return out


# ------------------------------------------------------------------ token cleaning

# a word: letters, with digits / ! / | allowed inside it (they stand for letters: "m!lle", "v1lla")
_TOKEN_RE = re.compile(f"^([^{LETTERS}]*)([{LETTERS}](?:[{LETTERS}\\-]|[0-9!|](?=[{LETTERS}0-9!|]))*)([^{LETTERS}]*)$")
# the scan's systematic slips in the main text: ī → l / fl / I / i, rn → m, ū → Q / ii, ō → 6/0
GARBLES = [("fl", "il"), ("l", "i"), ("rn", "m"), ("ii", "u"), ("6", "o"), ("0", "o"), ("1", "i"), ("!", "i"), ("|", "i"),
           ("q", "u"), ("vi", "u"), ("n", "u"), ("b", "o")]
_JUNK = re.compile(r"[0-9!|�^~*w]|[a-z]y$")
_UNLATIN = re.compile(r"[jkwz]|q(?!u)|[^aeiouy]{5}|x[^aeiouytcps]|[^a-z]")
_ROMAN_NUM = re.compile(r"^[IVXLCDM]+$")
# function words the OCR runs into their neighbours ("fluviīin", "Vocābulumquoque");
# no prefixes (ab, ex, de, sub …) and no enclitics (que, ne, ve) — those are real word parts
_COMMON = {"in", "et", "est", "sunt", "non", "sed", "quoque", "ubi", "quid", "quis", "iam", "nunc", "hic", "haec",
           "hoc", "qui", "quae", "quod", "nam", "atque", "aut", "neque", "nec", "etiam", "tam", "quam", "ut", "si",
           "enim", "autem", "igitur", "ergo", "esse", "erat", "erant", "inquit", "tum"}
_ENCLITICS = ("que", "ne", "ve")
# a printed form whose skeleton is shaped like the scan's ī → l slip: an l between two
# consonants (Latlnum, Qulntus, audltō) or a final l (paucl, servl, fluvil, qul)
_GARBLE_SHAPE = re.compile(r"[^aeiouyāēīōū]l[^aeiouyāēīōūl]|l$")
_VERB_TAILS = {"eram", "erās", "erat", "erāmus", "erātis", "erant", "vēram", "vērās", "vērat", "vērāmus", "vērātis",
               "vērant", "erō", "eris", "erit", "erimus", "eritis", "erint", "erunt", "isse", "istī", "istis", "imus"}
_REAL_L = {"mel", "vel", "sol", "sal", "fel", "nihil", "simul", "semel", "procul", "consul", "animal", "vigil",
           "pugil", "exul", "nil", "hannibal", "tribunal"}
# real words that differ only by an ī from a commoner one: never "repaired"
_PAIRS_I = {"hic", "his", "is", "quis", "sis", "liber", "libera", "liberi", "liberum", "liberae", "liberos", "liberis",
            "liberorum", "liberas", "pila", "vim"}
_WORD_END = set("aeiouyāēīōūsmtrnlxcdb")  # letters a Latin word can end in (a hyphenation fragment cannot)
# short words that may be the half of a run-together pair ("fīliōsuō", "eīnōn"); other
# 2–3-letter "halves" are hyphenation fragments of the text layer (tur, mus, us)
_SHORT_OK = {"suo", "sua", "sui", "eum", "eam", "eos", "eas", "eis", "iis", "ei", "id", "ea", "eo", "hoc", "hic", "hac",
             "haec", "non", "est", "sed", "nam", "cum", "iam", "nec", "aut", "vel", "per", "ego", "tu", "me", "te", "se",
             "nos", "vos", "mea", "tua", "qui", "quae", "quo", "qua", "ubi", "ita", "sic", "tot", "tam", "dum", "dat",
             "sum", "es", "et", "in", "ut", "ne", "si", "tum", "quam", "rem", "res", "vir",
             "dei", "deo", "dea", "ire", "ora", "os", "vis", "mel", "pes", "ius", "ait", "it", "eat"}


def quote_fix(text: str) -> str:
    """The scan's quotation marks: a closing ” comes out as w or M, an opening
    “ as u or M.  Latin has no w, so those are safe to restore."""
    text = text.replace("^", " ").replace("—", " — ")
    text = re.sub(rf"(?<=[{LETTERS}])\|(?=[{LETTERS}])", "l", text)                  # il|īc
    text = re.sub(rf"(?<=[.!?,;:{LETTERS}])w(?=\s|$)", '"', text)            # audī!w  aquaw
    text = re.sub(rf"(?<=[.!?])M(?=\s|$|[{LETTERS}])", '" ', text)             # audit.M  sum!MTitus
    text = re.sub(rf"(?<!\S)w(?=[{LETTERS}])", '"', text)                     # winfaciē
    text = re.sub(rf"(?<!\S)[uM](?=[A-ZĀĒĪŌŪ][{LETTERS}])", '"', text)         # uQuia  MCertē
    return re.sub(r"\s+", " ", text).strip()


_I_WORD = re.compile(r"\bI[a-zāēīōū]+")


def capital_i_forms(pdf) -> dict[str, Counter]:
    """skeleton → spellings for words beginning with a capital I (Iūlius, Italia,
    In): extract_margins' lexicon filters every such word out as suspicious."""
    out: dict[str, Counter] = {}
    for page in pdf.pages:
        try:
            t = page.extract_text(x_tolerance=1.0) or ""
        except Exception:  # noqa: BLE001
            continue
        for tok in _I_WORD.findall(t.replace(SOFT_HYPHEN, "")):
            if _JUNK.search(tok):
                continue
            out.setdefault(em.skeleton(tok), Counter())[tok.lower()] += 1
    return out


def trusted_forms(root: Path) -> set[str]:
    """Spellings attested by the clean, macronised week sources (source/week-NN.md):
    a printed form found here is a real form, whatever the text layer says."""
    out: set[str] = set()
    for n in range(1, 15):
        for p in em.source_parts(n, root):
            for tok in re.findall(f"[{LETTERS}]+", p["text"]):
                out.add(tok.lower())
    return out


class Cleaner:
    def __init__(self, lex: em.Lexicon, extra: dict[str, Counter] | None = None, trusted: set[str] | None = None):
        self.lex = em.Lexicon()
        for k, v in lex.forms.items():
            self.lex.forms[k] = Counter(v)
        for k, v in (extra or {}).items():
            self.lex.forms[k].update(v)
        self.trusted = trusted or set()
        self.unverified: Counter = Counter()
        self.repaired: Counter = Counter()

    def _count(self, key: str) -> int:
        return sum(self.lex.forms.get(key, {}).values())

    def _best(self, key: str, loose: bool = False) -> str | None:
        """The attested spelling of `key`: the most frequent one seen at least
        twice (Lexicon.best's rule), never a gloss ending such as "-iēs".  With
        `loose`, a spelling seen once is enough when it carries a macron (the
        scan never invents macrons): the target of an ī → l repair."""
        c = self.lex.forms.get(key)
        if not c:
            return None
        for sp, n in c.most_common():
            if sp.startswith("-") or sp.endswith("-"):
                continue
            if n >= 2 or (loose and sp != em.strip_macrons(sp)):
                return sp
            if not loose:
                return None
        return None

    def _best_loose(self, key: str) -> str | None:
        return self._best(key, loose=True)

    def _split_glued(self, key: str, low: str) -> tuple[str, str] | None:
        """'fluviīin' → ('fluviī', 'in'): two attested words the OCR ran together.
        Accepted when the halves' macrons agree with the print and one half is a
        common function word or both are well attested."""
        if len(key) < 5 or "-" in key:
            return None
        best = None
        for i in range(2, len(key) - 1):
            a, b = key[:i], key[i:]
            if b in _ENCLITICS or a in _ENCLITICS or em.strip_macrons(b) in {em.strip_macrons(t) for t in _VERB_TAILS}:
                continue  # -que / -ne stay; a verb tail ("scrīps-erās", "recitā-veram") is one word
            fa, fb = self._best(a), self._best(b)
            if not fa or not fb or fa[-1] not in _WORD_END or fb[-1] not in _WORD_END:
                continue  # a hyphenation fragment of the text layer ("pulsāv-") is not a word
            na, nb = self._count(a), self._count(b)
            joined = fa + fb
            if em.strip_macrons(joined) != key or len(joined) != len(low):
                continue
            # the print never invents a macron: every macron it shows must be in the halves too
            if any(x != y and x != em.strip_macrons(x) for x, y in zip(low, joined)):
                continue
            # each half must be a word in its own right: known to the clean sources, a
            # common word, or long and well attested (never a hyphenation fragment)
            def is_word(x: str, fx: str, nx: int) -> bool:
                return fx in self.trusted or x in _COMMON or x in _SHORT_OK or (len(x) >= 5 and nx >= 8)
            if not (is_word(a, fa, na) and is_word(b, fb, nb)):
                continue
            ok = min(na, nb) >= 3 and len(a) + len(b) >= 5
            if ok and (best is None or min(na, nb) > best[0]):
                best = (min(na, nb), fa, fb)
        return (best[1], best[2]) if best else None

    def word(self, tok: str, initial: bool = False) -> tuple[str, bool]:
        """→ (cleaned token, readable?).  `initial`: the token opens a sentence
        (a capital there is the print's, not a misread ī)."""
        tok = tok.replace(SOFT_HYPHEN, "")
        m = _TOKEN_RE.match(tok)
        if not m:  # letters and punctuation interleaved ("(i)>Blittera"): readable only when it is all ordinary marks
            return tok, not re.search(r"[^\w\s\-—–'\"“”‘’(),.;:!?…]", tok)
        pre, core, post = m.groups()
        if _ROMAN_NUM.match(core) or (len(core) == 1 and core.isalpha()):
            return tok, True  # numerals and letters named in the text (cap. I, XVII)
        if "-" in core and all(0 < len(p) <= 3 for p in core.split("-")):
            return tok, True  # a word spelled or stretched out: "l-e-s", "Mam-ma!", "Da-ā-ve"
        low = core.lower()
        key = em.skeleton(core)
        vkey = re.sub(r"[^a-z0-9!|\-]", "", em.strip_macrons(core).lower()).strip("-")
        if not key:
            return tok, True

        def keep_case(new: str) -> str:
            if core[:1].isupper() and not (core[:1] == "I" and new[:1] == "ī" and not initial):
                return new[:1].upper() + new[1:]
            return new

        def done(new: str) -> tuple[str, bool]:
            new = keep_case(new)
            self.repaired[f"{core} → {new}"] += 1
            return pre + new + post, True

        mine = self.lex.forms.get(key, {}).get(low, 0)
        total = self._count(key)
        top = self._best(key)
        junk = bool(_JUNK.search(core))
        garble_shaped = bool(_GARBLE_SHAPE.search(key)) and key not in _REAL_L
        # 1. the printed spelling is the attested one (a slip the scan repeats is not attestation)
        if not junk and top is not None and low == top and not garble_shaped:
            return tok, True
        # 2. a systematic slip whose repair is attested: for a rare printed form any
        #    macronised sighting of the repair will do, a frequent one needs the repair
        #    to be clearly more frequent still (vīlla must not become ūlla)
        best_alt = None
        if key not in _REAL_L:
            for depth in (1, 2):
                for v in em._variants(vkey, depth, GARBLES):
                    if v == key or "-" in v:
                        continue
                    bv = self._best_loose(v)
                    if bv is None:
                        continue
                    cv = self._count(v)
                    if (cv >= 1 if total < 5 or garble_shaped else cv > 2 * total) and (best_alt is None or cv > best_alt[0]):
                        best_alt = (cv, bv)
                if best_alt:
                    break
        if best_alt:
            return done(best_alt[1])
        if garble_shaped and not junk:
            # no attested repair, but the shape admits one reading only: Latin has no l
            # between consonants and no final l after a consonant — it is an ī
            def to_i(m: re.Match) -> str:  # the l is the middle char of a 3-char match, or the final one
                g = m.group()
                return g[0] + "ī" + g[2] if len(g) == 3 else "ī"
            fixed = _GARBLE_SHAPE.sub(to_i, low)
            while _GARBLE_SHAPE.search(fixed) and fixed not in _REAL_L:
                fixed = _GARBLE_SHAPE.sub(to_i, fixed)
            if fixed != low:
                return done(fixed)
        if junk:
            new, prob = em.macronise_token(tok, self.lex, "FR")
            if prob is None and new != tok:
                self.repaired[f"{core} → {new}"] += 1
                return new, True
            self.unverified[core] += 1
            return tok, False
        # 3. attested but not the top spelling.  Measured on this scan: an ī is
        #    lost in the text layer constantly (pueri 65 × vs puerī 70 ×), the other
        #    macrons almost never (mater 2 × vs māter 128 ×).
        if top is None and not junk:
            loose = self._best_loose(key)  # one macronised sighting (comitārī) beats a bare printed form
            top = loose if loose != low else None
        if top is not None and top != low:
            macroned = core != em.strip_macrons(core)
            n_top = self.lex.forms[key][top]
            if macroned or low in self.trusted or key in _PAIRS_I:
                return tok, True  # the print's macrons are trusted; a form the clean sources know is real
            if re.sub("ī", "i", top) == low and mine <= n_top:
                return done(top)  # a lost ī (servi → servī, pueri → puerī, Insula → īnsula)
            if mine <= max(2, n_top // 50):
                return done(top)  # a rare macron-less spelling of a common macronised word (mater → māter)
            return tok, True  # a real alternative (puella / puellā, Graecia / Graeciā, malum / mālum)
        if top is not None:
            return tok, True
        # 4. unattested and clean: two words run together, else kept as printed
        #    (extract_margins' letter-confusion and glue rules are tuned for short
        #    glosses; on running text they turn vidēbās into vidēbat)
        glued = self._split_glued(key, low)
        if glued:
            return done(glued[0] + " " + glued[1])
        plausible = not _UNLATIN.search(em.strip_macrons(low).replace("-", "")) or core[:1].isupper()
        self.unverified[core] += 1
        return tok, plausible  # a rare word or a name the lexicon never saw is kept as printed


# ------------------------------------------------------------------ text assembly

def assemble(rows: list[tuple[em.Row, bool]], cleaner: Cleaner) -> list[dict]:
    """→ paragraphs [{start_line, tokens:[(text, line, readable)], line_starts:{line: token index}}]."""
    paras: list[dict] = []
    prev_line = None
    carry: str | None = None  # a word broken at the end of the previous row (its first part)
    carry_line = None
    for r, start in rows:
        if start or not paras:
            if carry:  # a broken word never continued: keep what we have
                paras[-1]["tokens"].append((carry, carry_line, True))
                carry = None
            paras.append({"start_line": r.line_no, "tokens": [], "line_starts": {}})
        para = paras[-1]
        if prev_line is not None and r.line_no > prev_line + 1:
            for missing in range(prev_line + 1, r.line_no):
                para["tokens"].append((GAP, missing, False))
        prev_line = r.line_no
        # "Fīliī,quī" — a comma / colon the scan glued to the next word
        raw_toks = re.sub(rf"([{LETTERS}][,;:])(?=[{LETTERS}\"])", r"\1 ", quote_fix(r.text)).split()
        line_started = False
        for i, t in enumerate(raw_toks):
            broken = i == len(raw_toks) - 1 and (t.endswith(SOFT_HYPHEN) or (t.endswith("-") and len(t) > 2))
            t = t.replace(SOFT_HYPHEN, "")
            if carry is not None:
                t = carry + (t[:-1] if broken else t)
                line_at = carry_line
                carry = None
            else:
                line_at = r.line_no
            if broken:
                carry, carry_line = (t[:-1] if t.endswith("-") else t), line_at
                continue
            prev = para["tokens"][-1][0] if para["tokens"] else None
            initial = prev is None or bool(re.search(r"[.!?…:][\"'”’»)]*$", prev))
            text, ok = cleaner.word(t, initial=initial)
            if not line_started and line_at == r.line_no:
                para["line_starts"][r.line_no] = len(para["tokens"])
                line_started = True
            para["tokens"].append((text, line_at, ok))
        if not line_started:
            # the row is only the tail of a word begun above (or only a carried fragment):
            # the line begins at the next token that will be appended
            para["line_starts"][r.line_no] = len(para["tokens"]) + (1 if carry else 0)
    if carry:
        paras[-1]["tokens"].append((carry, carry_line, True))
    return paras


def build_units(paras: list[dict], wid: int, part: str, rep: dict) -> list[dict]:
    units: list[dict] = []
    per_line: Counter = Counter()
    for para in paras:
        toks = para["tokens"]
        if not toks:
            continue
        # char offset of every token in the paragraph text
        text_parts, offsets = [], []
        pos = 0
        for t, _, _ in toks:
            offsets.append(pos)
            text_parts.append(t)
            pos += len(t) + 1
        text = " ".join(text_parts)
        tok_at: dict[int, int] = {off: k for k, off in enumerate(offsets)}
        line_at_off = {offsets[k]: ln for ln, k in para["line_starts"].items() if k < len(offsets)}
        first = True
        # A lost printed line (GAP) cuts the paragraph into segments.  A sentence
        # that runs into the gap (no final stop before it) or out of it (starts
        # in lower case after it) is incomplete and left out; a gap that falls
        # between two complete sentences (a lost heading such as "Scaena
        # secunda") costs nothing.
        segments: list[tuple[int, str, bool, bool]] = []  # (offset, text, gap before, gap after)
        pos0 = 0
        gap_before = False
        for k, (t, _, _) in enumerate(toks + [(GAP, None, False)]):
            if t == GAP:
                seg = text[pos0:offsets[k] if k < len(offsets) else len(text)].strip()
                if seg:
                    segments.append((text.find(seg, pos0), seg, gap_before, k < len(toks)))
                pos0 = offsets[k] + 1 if k < len(offsets) else len(text)
                gap_before = True
        for seg_off, seg, gap_before, gap_after in segments:
            sents = split_sentences(seg, latin=True)
            cursor = 0
            for si, s in enumerate(sents):
                start = seg_off + seg.find(s, cursor)
                end = start + len(s)
                cursor = end - seg_off
                k0 = tok_at.get(start)
                if k0 is None:
                    k0 = max((k for k, off in enumerate(offsets) if off <= start), default=0)
                line0 = toks[k0][1]
                covered = [k for k, off in enumerate(offsets) if start <= off < end]
                bad = [toks[k] for k in covered if not toks[k][2]]
                why = None
                if bad:
                    why = "unreadable: " + ", ".join(t for t, _, _ in bad[:4])
                elif si == 0 and gap_before and s[:1].islower():
                    why = f"continues a printed line lost by the layout step (before line {line0})"
                elif si == len(sents) - 1 and gap_after and not re.search(r"[.!?…][\"'”’»)]*$", s):
                    why = "runs into a printed line lost by the layout step"
                if why:
                    rep["dropped"].append((line0, s[:90], why))
                    continue  # `first` stays: the block starts with the next readable sentence
                per_line[line0] += 1
                lines = [{"line": line0, "start": 0}]
                for off, ln in sorted(line_at_off.items()):
                    if start < off < end and ln > lines[-1]["line"]:
                        lines.append({"line": ln, "start": off - start})
                units.append({
                    "id": f"r{wid:02d}:{line0}.{per_line[line0]}",
                    "order": len(units),
                    "part": part,
                    "source": "FR",
                    "line_no": para["start_line"],
                    "block_start": first,
                    "unit_type": "sentence",
                    "speaker": None,
                    "la": s,
                    "en": "",
                    "en_raw": None,
                    "note": None,
                    "tags": [],
                    "margin": [],
                    "lines": lines,
                })
                first = False
    return units


# ------------------------------------------------------------------ glosses

def chapter_glosses(pages: list[dict], lex: em.Lexicon, notes: list[str], rep: dict) -> list[dict]:
    """[{line, la}] for the chapter, the way extract_week collects them."""
    out: list[dict] = []
    for pg in pages:
        main_rows = [r for r in pg["main"] if r.line_no is not None]
        for gl in em.assemble_glosses(pg, "FR", notes):
            if not main_rows:
                notes.append(f"p{pg['page']}: gloss {gl['raw'][:30]!r} on a page without numbered text — dropped")
                continue
            r = min(main_rows, key=lambda r: abs(r.top - gl["top"]))
            if abs(r.top - gl["top"]) > 14:
                below = [q for q in main_rows if q.top > gl["top"]]
                if below:
                    r = below[0]
            if abs(r.top - gl["top"]) > 14 and not re.search(r"[=:<↔]|-[a-zāēīōū]", gl["raw"]):
                notes.append(f"p{pg['page']}: dropped margin text {gl['raw'][:30]!r} — {abs(r.top - gl['top']):.0f}pt from any text line, no gloss syntax")
                continue
            # "-a-ā:" / "-us-ī:" — two endings the OCR glued: split them so each keeps its macron
            raw = re.sub(r"(?<![\w-])(-[a-zāēīōū]{1,3})-(?=[a-zāēīōū]{1,3}(?![\w-]))", r"\1 -", gl["raw"])
            for la, probs in em.clean_glosses(raw, lex, "FR"):
                out.append({"line": r.line_no, "la": la, "page": pg["page"]})
                for pr in probs:
                    rep["gloss_problems"].append(f"p{pg['page']} line {r.line_no}: {pr}  [{la}]")
    return out


def attach_glosses(units: list[dict], glosses: list[dict], rep: dict) -> None:
    blocks = blocks_of(units)
    starts = [(b[0]["line_no"], b) for b in blocks]
    for g in glosses:
        L = g["line"]
        before = [(s, b) for s, b in starts if s <= L]
        if not before:
            rep["unattached"].append(f"line {L}: before the first block — {g['la']}")
            continue
        block = before[-1][1]
        # the unit printed on that line: of the units whose printed lines cover L, the
        # one with the most text on it (exact here, unlike attach_margins' fuzzy
        # "last unit starting at or before L")
        def on_line(u: dict) -> int:
            for k, e in enumerate(u["lines"]):
                if e["line"] == L:
                    nxt = u["lines"][k + 1]["start"] if k + 1 < len(u["lines"]) else len(u["la"])
                    return nxt - e["start"]
            return 0
        spans = [(on_line(u), -i) for i, u in enumerate(block)]
        ti = -max(spans)[1] if max(spans)[0] > 0 else max((i for i, u in enumerate(block) if u["lines"][0]["line"] <= L), default=0)
        target = block[ti]
        stem = gloss_stem(g["la"])
        if stem:
            for k in (ti, ti - 1, ti - 2, ti + 1):
                if 0 <= k < len(block) and unit_has_stem(block[k], stem):
                    target = block[k]
                    break
        target["margin"].append({"line": L, "la": g["la"]})
        rep["attached"] += 1


# ------------------------------------------------------------------ per chapter

def build_chapter(c: int, pdf, pages: list[int], lex: em.Lexicon, extra: dict | None = None,
                  trusted: set[str] | None = None, dump: bool = False) -> tuple[dict, dict]:
    notes: list[str] = []
    rep = {"chapter": c, "pages": [], "cut": True, "rows": 0, "units": 0, "blocks": 0, "lines": 0, "lines_mapped": 0,
           "lines_unmapped": [], "glosses": 0, "attached": 0, "unattached": [], "dropped": [], "gloss_problems": [],
           "notes": notes, "para_indent": 0, "para_gap": 0, "para_first": 0, "unverified": {}, "repaired": {},
           "lines_bad": [], "range": None}
    check_title(pdf, pages[0], c, notes)
    classified, found = classify_chapter(pdf, pages, notes)
    rep["cut"] = found
    if not found:
        notes.append("no GRAMMATICA LATINA / PENSVM heading found in the text layer — the whole chapter's pages were used")
    rows = [r for pg in classified for r in pg["main"] if r.line_no is not None]
    rep["pages"] = sorted({r.page for r in rows})
    rep["rows"] = len(rows)
    rep["range"] = (rows[0].line_no, rows[-1].line_no) if rows else None
    if dump:
        for pg in classified:
            print(f"--- page {pg['page']} ({pg['side']})")
            for r in pg["main"]:
                print(f"  {r.line_no!s:>4} {'*' if r.anchor else ' '} x{r.x0:.0f} {r.text}")
            for r in pg["margin"]:
                print(f"       margin x{r.x0:.0f} y{r.top:.0f}: {r.text}")
    cleaner = Cleaner(lex, extra, trusted)
    marked = mark_paragraphs(classified, rep)
    paras = assemble(marked, cleaner)
    part = f"Capitulum {c}"
    units = build_units(paras, c, part, rep)
    rep["units"] = len(units)
    rep["blocks"] = sum(1 for u in units if u["block_start"])
    rep["unverified"] = dict(cleaner.unverified.most_common())
    rep["repaired"] = dict(cleaner.repaired.most_common())
    for b in blocks_of(units):
        rep["lines_bad"] += check_lines(b)
    mapped = {e["line"] for u in units for e in u["lines"]}
    printed = {r.line_no for r in rows}
    rep["lines"] = len(printed)
    rep["lines_mapped"] = len(mapped & printed)
    rep["lines_unmapped"] = sorted(printed - mapped)
    glosses = chapter_glosses(classified, lex, notes, rep)
    rep["glosses"] = len(glosses)
    attach_glosses(units, glosses, rep)
    key, label, pp = FOCUS[c]
    week = {
        "n": 100 + c, "id": f"r{c:02d}", "title": TITLES[c], "source": "FR", "chapter": ROMAN[c - 1],
        "has_line_numbers": True,
        "focus": {"key": key, "label": label,
                  "blurb": f"The main topic of week {c} in the learner's notes (Latin Grammar Topics, p. {', '.join(map(str, pp))})."},
        "parts": [{"part": part, "lines": f"{rep['range'][0]}–{rep['range'][1]}" if rep["range"] else None, "source": "FR"}],
    }
    return {"week": week, "units": units}, rep


# ------------------------------------------------------------------ validation (seed_sql-style)

def validate(data: dict, path: Path) -> list[str]:
    errs: list[str] = []
    wk, units = data["week"], data["units"]
    if not (101 <= wk["n"] <= 124) or wk["id"] != f"r{wk['n'] - 100:02d}":
        errs.append(f"week n/id mismatch: {wk['n']} {wk['id']}")
    for k in ("title", "source", "chapter", "has_line_numbers", "focus", "parts"):
        if k not in wk:
            errs.append(f"week.{k} missing")
    seen = set()
    for i, u in enumerate(units):
        if u["order"] != i:
            errs.append(f"{u['id']}: order {u['order']} != {i}")
        if u["id"] in seen:
            errs.append(f"{u['id']}: duplicate id")
        seen.add(u["id"])
        if not u["la"].strip() or GAP in u["la"]:
            errs.append(f"{u['id']}: empty or gapped la")
        if u["en"] != "" or u["note"] is not None or u["tags"] != []:
            errs.append(f"{u['id']}: en/note/tags must be empty for the review shelf")
        if not isinstance(u["line_no"], int) or not u["lines"] or u["lines"][0]["start"] != 0:
            errs.append(f"{u['id']}: line_no / lines shape")
        if not re.fullmatch(rf"{wk['id']}:\d+\.\d+", u["id"]) or int(u["id"].split(":")[1].split(".")[0]) != u["lines"][0]["line"]:
            errs.append(f"{u['id']}: id does not name the start line {u['lines'][0]['line']}")
        for g in u["margin"]:
            if set(g) != {"line", "la"} or not isinstance(g["line"], int):
                errs.append(f"{u['id']}: margin entry shape {g}")
    if units and not units[0]["block_start"]:
        errs.append("first unit is not a block start")
    for b in blocks_of(units):
        errs += check_lines(b)
        if any(u["line_no"] != b[0]["line_no"] for u in b):
            errs.append(f"{b[0]['id']}: line_no differs inside the block")
    # the SQL writer must accept the file as it is
    try:
        stmts = seed_sql.week_sql(wk["n"], path)
        rows = sum(s.count(f"\n({seed_sql.USER}, '{wk['id']}:") for s in stmts)
        if rows != len(units):
            errs.append(f"seed SQL would insert {rows} unit rows for {len(units)} units")
        if not all(s.rstrip().endswith(";") for s in stmts):
            errs.append("a seed SQL chunk does not end in ';'")
    except Exception as e:  # noqa: BLE001
        errs.append(f"seed_sql.week_sql failed: {e}")
    return errs


def write_sql(c: int, path: Path) -> int:
    out = seed_sql.OUT
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob(f"r{c:02d}-*.sql"):
        old.unlink()
    parts = seed_sql.week_sql(100 + c, path)
    for i, sql in enumerate(parts):
        (out / f"r{c:02d}-{i:02d}.sql").write_text(sql, encoding="utf-8")
    return len(parts)


# ------------------------------------------------------------------ report

def report_section(rep: dict, errs: list[str]) -> str:
    c = rep["chapter"]
    L = [f"## Chapter {ROMAN[c - 1]} (r{c:02d}, week {100 + c}) — {TITLES[c]}\n"]
    rng = f"lines {rep['range'][0]}–{rep['range'][1]}" if rep["range"] else "no lines"
    L.append(f"- pages {rep['pages']}, {rng}; numbered rows: {rep['rows']}; reading cut at Grammatica: {'yes' if rep['cut'] else 'NO'}")
    L.append(f"- units: {rep['units']}; blocks: {rep['blocks']} "
             f"(paragraphs recovered by indent: {rep['para_indent']}, by vertical gap: {rep['para_gap']}, chapter start: {rep['para_first']})")
    L.append(f"- printed lines mapped into units: {rep['lines_mapped']}/{rep['lines']}"
             + (f"; unmapped: {rep['lines_unmapped']}" if rep["lines_unmapped"] else ""))
    L.append(f"- glosses: {rep['glosses']} extracted, {rep['attached']} attached"
             + (f", {len(rep['unattached'])} unattached" if rep["unattached"] else ""))
    L.append(f"- sentences dropped: {len(rep['dropped'])}; tokens repaired: {sum(rep['repaired'].values())}; "
             f"tokens kept unverified: {sum(rep['unverified'].values())}")
    if errs:
        L.append(f"- VALIDATION: {len(errs)} problem(s)")
        L += [f"  - {e}" for e in errs]
    if rep["dropped"]:
        L.append("\nSentences left out:\n")
        L += [f"- line {ln}: {s} — {why}" for ln, s, why in rep["dropped"]]
    if rep["lines_bad"]:
        L.append("\nLine offsets failing the sanity check:\n")
        L += [f"- {x}" for x in rep["lines_bad"]]
    if rep["unattached"]:
        L.append("\nGlosses not attached:\n")
        L += [f"- {x}" for x in rep["unattached"]]
    if rep["unverified"]:
        L.append("\nTokens kept as printed, not in the lexicon (check by eye):\n")
        L.append("- " + ", ".join(f"{t}×{n}" if n > 1 else t for t, n in list(rep["unverified"].items())[:80]))
    if rep["repaired"]:
        L.append("\nOCR repairs made (printed → cleaned):\n")
        L.append("- " + "; ".join(f"{t}" + (f" ×{n}" if n > 1 else "") for t, n in list(rep["repaired"].items())[:120]))
    if rep["gloss_problems"]:
        L.append("\nGlosses not cleaned with confidence:\n")
        L += [f"- {x}" for x in rep["gloss_problems"]]
    if rep["notes"]:
        L.append("\nLayout notes:\n")
        L += [f"- {x}" for x in dict.fromkeys(rep["notes"])]
    L.append("")
    return "\n".join(L) + "\n"


def update_report(key: str, section: str) -> None:
    path = BUILD / "review-REPORT.md"
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    body = path.read_text(encoding="utf-8") if path.exists() else "# Review shelf — Familia Romana I–XXIV build report\n\n"
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    path.write_text(body, encoding="utf-8")


def render_pages(pdf_path: Path, pages: list[int], out_dir: Path, dpi: int = 110) -> list[Path]:
    import fitz  # PyMuPDF
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf_path))
    files = []
    for p in pages:
        pix = doc[p - 1].get_pixmap(dpi=dpi)
        f = out_dir / f"p{p:03d}.png"
        pix.save(str(f))
        files.append(f)
    return files


# ------------------------------------------------------------------ main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chapters", nargs="*", type=int, help="chapter numbers 1–24 (default all)")
    ap.add_argument("--sql", action="store_true", help="also write data/build/sql/rNN-*.sql")
    ap.add_argument("--dump", action="store_true", help="print every classified row")
    ap.add_argument("--render", type=Path, help="render the chapters' reading pages to PNG in this directory")
    a = ap.parse_args(argv)
    import pdfplumber
    chapters = a.chapters or list(range(1, 25))
    bad = [c for c in chapters if not 1 <= c <= 24]
    if bad:
        ap.error(f"chapters must be 1–24: {bad}")
    pdf = pdfplumber.open(str(SCAN))
    pdfs = {"FR": pdf}
    for src in ("FL",):
        p = ROOT / "scans" / em.SCANS[src]
        if p.exists():
            pdfs[src] = pdfplumber.open(str(p))
    lex = em.build_lexicon(ROOT, pdfs, BUILD / "margins-lexicon.json", quiet=True)
    pages = chapter_pages(pdf)
    extra = capital_i_forms(pdf)
    trusted = trusted_forms(ROOT)
    rc = 0
    for c in chapters:
        data, rep = build_chapter(c, pdf, pages[c], lex, extra, trusted, dump=a.dump)
        path = BUILD / f"review-{c:02d}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        errs = validate(data, path)
        n_sql = write_sql(c, path) if a.sql else 0
        update_report(f"review:r{c:02d}", report_section(rep, errs))
        if errs:
            rc = 1
        print(f"cap. {ROMAN[c - 1]:>5} (r{c:02d}): pages {rep['pages'][0]}–{rep['pages'][-1]}, lines {rep['range']}, "
              f"{rep['units']} units / {rep['blocks']} blocks, lines mapped {rep['lines_mapped']}/{rep['lines']}, "
              f"glosses {rep['attached']}/{rep['glosses']}, dropped {len(rep['dropped'])}, unverified {sum(rep['unverified'].values())}"
              + (f", {n_sql} sql files" if a.sql else "") + (f", {len(errs)} VALIDATION ERRORS" if errs else ""))
        if a.render:
            files = render_pages(SCAN, rep["pages"], a.render / f"cap-{c:02d}")
            print(f"   rendered {len(files)} pages → {a.render / f'cap-{c:02d}'}")
    return rc


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
