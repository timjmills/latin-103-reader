#!/usr/bin/env python
"""
extract_pensa.py — Ørberg's PENSVM A / B / C for chapters I–XXXIV from the
Familia Romana scan → data/build/pensa-NN.json + data/build/sql/pNN.sql
(wave 2, P; shape: docs/GRAMMAR-CONTRACT.md "Pensa").

    python pipeline/extract_pensa.py                 # chapters 1–34 (+ SQL, report)
    python pipeline/extract_pensa.py 1 8 20 30       # selected chapters
    python pipeline/extract_pensa.py --check         # validate every pensa-NN.json + pNN.sql
    python pipeline/extract_pensa.py 1 --dump        # print the rows and tokens of each pensum
    python pipeline/extract_pensa.py 1 --render DIR  # render the pensa pages to PNG (spot check, PyMuPDF)

Nothing here touches app/js or supabase/, and nothing is uploaded: the SQL
is written for `supabase db query --linked -f data/build/sql/pNN.sql`.

Pages and rows
  Chapter k begins on the k-th page whose running head reads CAPITVLVM
  (review_shelf.chapter_pages); its pensa lie between the PENSVM A heading
  and the next chapter.  A pensum runs from its heading to the next PENSVM
  heading (or the chapter's last page).  Rows are the main-column words
  (extract_margins.GEOM, the page side decided as classify_page does) —
  unlike classify_page every dash and full stop is kept, because the printed
  blanks are dashes: Pensum A prints a stem and a short dash ("vīll-"),
  Pensum B a long dash for a whole word ("—"), Pensum C is questions.  The
  margin column beside the pensa carries the chapter's "Vocābula:" list — the
  printed word bank of Pensum B.
Text
  Rows are joined (a word broken at a row end is glued when the joined
  spelling is attested, split into two attested words when the OCR ran the
  next word on, and treated as a blank when only its stem is a word), the
  scan's quotation marks restored (review_shelf.quote_fix), tokens cleaned
  with review_shelf's Cleaner (the lexicon of macronised spellings, the
  scan's systematic slips), stems cleaned against the roots of the glossary
  and of the library's Whitaker analyses.  A blank whose dash the text layer
  lost is still found: a token that is a known stem but not a word, printed
  with a gap before the next mark.  Sentences: build_week.split_sentences.
Answers  (precision first: a wrong answer taught to a learner is worse than a
  hidden one, so a blank resolves only on evidence, never on a preference)
  A blank resolves in exactly two ways.
  (a) The chapter's own words.  The pensa re-tell the chapter, so a pensum
      sentence that IS a chapter sentence word for word — same length, every
      printed word in its place, Ørberg's bracketed glosses dropped — hands the
      blanks the words the chapter prints there.  Nothing looser counts: a
      partial alignment slides the blanks along the sentence.
  (b) One survivor of the whole candidate pool.  The pool is every attested form
      beginning with the stem (Pensum A) or in the word bank (Pensum B) TOGETHER
      with every regular form latin_forms can make of the chapter's lemmas — an
      answer is only unique if it has met the rivals it should have met.  The
      pool is filtered by agreement: the case a preposition governs, the
      nominative a copula's predicate takes, adjective ↔ noun agreement, verb ↔
      subject person and number.  No filter is ever dropped, so contradictory
      filters leave nothing; and a candidate must FIT, not merely fail to
      contradict — a reading with no parse (an adverb, a particle, an
      indeclinable) satisfies every filter vacuously and never survives, and a
      reading whose case or person rests on no filter is not evidence either.
      Where the sentence pins nothing (no subject for a finite verb, no case for
      a noun) the blank resolves to nothing at all rather than to whichever
      reading happens to be left.
  Everything else is `unverified`, as is every blank of a sentence with an
  unreadable token (the principal parts excepted: they read the verb printed
  beside them and nothing else).  Frequency never decides anything.
  C  see below.
  C  the chapter sentence sharing most of the question's content lemmas is
     the answering unit; a short Latin answer is derived by question word
     (ubi → the "in …" phrase, quid est X → the predicate, num/-ne/nōnne →
     Ita / Nōn by whether the sentence affirms the question, quis → the
     subject name, quot → the numeral, cūr → the quia/quod clause); the full
     sentence is always accepted; a weak match is `unverified`.

Outputs (data/build/)
  pensa-NN.json   {chapter, A: [...], B: [...], C: [...], bank: [...], report}
  sql/pNN.sql     three upserts into public.pensa for the first auth user
  pensa-REPORT.md per chapter: items per pensum, resolved / unverified,
                  text-layer damage (unreadable tokens, lost blanks)
"""
from __future__ import annotations

import argparse
import bisect
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import extract_margins as em  # noqa: E402
import review_shelf as rs  # noqa: E402
import build_vocab as bv  # noqa: E402
from build_week import split_sentences  # noqa: E402
from macrons import canonical, strip_macrons  # noqa: E402
import latin_forms as lfm  # noqa: E402
import seed_sql  # noqa: E402

BUILD = ROOT / "data" / "build"
SQL_DIR = BUILD / "sql"
SCAN = ROOT / "scans" / "familia-romana.pdf"
VOCAB_DIR = ROOT / "app" / "data" / "grammar" / "vocab"
REPORT = BUILD / "pensa-REPORT.md"

CHAPTERS = range(1, 35)
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI",
         "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX",
         "XXX", "XXXI", "XXXII", "XXXIII", "XXXIV"]
SOFT_HYPHEN = em.SOFT_HYPHEN
LETTERS = em.LETTERS
_HEADING = re.compile(r"^PENS[VU]M([ABC])?$")
_HEADING_LOOSE = re.compile(r"^[A-Z]{6}([ABC])?$")   # the scan garbles a letter: "PKNSVM"
_PUNCT_ONLY = re.compile(r"^[^A-Za-zÀ-ɏ0-9]+$")
_WORD = re.compile(f"[{LETTERS}]+")
DASHES = "—–‑‒―-"   # hyphen last: used inside character classes
A_MARK = "░"   # stands for an ending blank in the sentence text before splitting
B_MARK = "▒"   # a whole-word blank

PREP_CASE = {
    "in": {"abl", "acc"}, "sub": {"abl", "acc"}, "super": {"acc", "abl"},
    "ad": {"acc"}, "per": {"acc"}, "ante": {"acc"}, "post": {"acc"}, "apud": {"acc"}, "inter": {"acc"},
    "prope": {"acc"}, "trans": {"acc"}, "circum": {"acc"}, "contra": {"acc"}, "ob": {"acc"}, "propter": {"acc"},
    "secundum": {"acc"}, "supra": {"acc"}, "infra": {"acc"}, "extra": {"acc"}, "intra": {"acc"}, "adversus": {"acc"},
    "a": {"abl"}, "ab": {"abl"}, "abs": {"abl"}, "e": {"abl"}, "ex": {"abl"}, "de": {"abl"}, "cum": {"abl"},
    "sine": {"abl"}, "pro": {"abl"}, "prae": {"abl"}, "coram": {"abl"},
}
QUESTION_WORDS = {"quis", "quid", "cur", "ubi", "quo", "unde", "quando", "quomodo", "quot", "qualis", "uter", "num",
                  "nonne", "quem", "quam", "quae", "qui", "quod", "cuius", "cui", "quos", "quas", "quibus", "quibuscum",
                  "quanti", "quantum", "quotus", "quota", "quoties", "quotiens", "quamdiu", "quantus"}
FUNCTION = {"est", "sunt", "et", "in", "non", "sed", "ne", "ut", "aut", "que", "esse", "erat", "erant", "a", "ab",
            "ad", "cum", "de", "ex", "e", "per", "si", "an", "atque", "ac", "nec", "neque", "iam", "nunc", "tum",
            "ita", "etiam", "quoque", "enim", "autem", "igitur", "ergo", "nam", "vero", "tam", "quam", "num",
            "estne", "suntne", "suus", "sua", "suum", "suo", "suam", "suos", "suas", "suis", "sui", "eius", "eum",
            "eam", "id", "is", "ea", "ei", "eos", "eas", "eis", "iis", "se", "sibi", "ipse", "ipsa", "ipsum", "hic",
            "haec", "hoc", "ille", "illa", "illud", "quia", "quod", "ubi", "fit", "fiunt", "potest", "possunt",
            "vult", "volunt", "habet", "habent", "facit", "faciunt", "dicit", "dicunt", "inquit", "solet", "solent"}
NEG = {"non", "neque", "nec", "nullus", "nulla", "nullum", "numquam", "nemo", "nihil", "minime"}
ORD = {1: "1st", 2: "2nd", 3: "3rd"}


# ------------------------------------------------------------------ pages

def chapter_pages(pdf) -> dict[int, list[int]]:
    return rs.chapter_pages(pdf, max_chapter=34)


def headings(pdf, pages: list[int]) -> list[tuple[int, float, str]]:
    """(page, top, kind) of every PENSVM A/B/C heading on the chapter's pages."""
    out = []
    for p in pages:
        words = pdf.pages[p - 1].extract_words(x_tolerance=1.0, extra_attrs=["size"])
        words = [w for w in words if w["top"] > 45]
        for i, w in enumerate(words):
            m = _HEADING.match(w["text"]) or _HEADING_LOOSE.match(w["text"])
            if not m or w["size"] < 9:
                continue
            head = w["text"][:6]
            if head not in ("PENSVM", "PENSUM") and sum(a != b for a, b in zip(head, "PENSVM")) > 1:
                continue   # a six-letter capital that is not the scan's PENSVM
            kind = m.group(1)
            if kind is None and i + 1 < len(words) and words[i + 1]["text"] in ("A", "B", "C") \
                    and abs(words[i + 1]["top"] - w["top"]) < 3:
                kind = words[i + 1]["text"]
            if kind:
                out.append((p, w["top"], kind))
    return out


def page_side(page, page_no: int) -> str:
    return em.classify_page(page, page_no, "FR")["side"]


def main_rows(page, page_no: int, side: str) -> list[em.Row]:
    """Rows of the main column keeping dashes and stops (classify_page drops them)."""
    g = em.GEOM["FR"]
    W, H = page.width, page.height
    lo, hi = g[side]["main"]
    lo_m, hi_m = g["main_size"]
    words = page.extract_words(x_tolerance=1.0, y_tolerance=2, extra_attrs=["size"])
    keep = []
    for w in words:
        if not (g["head_y"] < w["top"] < H - g["foot_y"]) or not (lo - 4 <= w["x0"] < hi):
            continue
        t = w["text"]
        if em.has_letters(t):
            if lo_m <= w["size"] <= hi_m + 0.5:
                keep.append(w)
        elif _PUNCT_ONLY.match(t) and w["size"] <= hi_m + 2:
            keep.append(w)
        elif re.match(r"^[ivxlcdmIVXLCDM]+[.,;:!?)]*$|^\(?[0-9ivxlcIVXLC]+\)?[.,;:]?$|^HS[CIVXL]*\.?$", t):
            keep.append(w)  # numerals quoted in the exercise (i et II, (xc), HSC)
    rows = em.group_rows(page_no, keep, g["row_tol"])
    out = []
    for r in rows:
        letters = re.sub(f"[^{LETTERS}]", "", r.text)
        if letters.isupper() and len(r.words) <= 3 and letters:
            continue  # heading / running head
        if not letters and len(r.words) <= 1:
            continue  # a stray mark
        out.append(r)
    return out


def margin_vocab(page, page_no: int, start_top: float | None) -> list[str]:
    """Words of the margin's Vocābula list on this page (from `start_top` down)."""
    pg = em.classify_page(page, page_no, "FR")
    out = []
    for r in pg["margin"]:
        if start_top is not None and r.top < start_top - 2:
            continue
        for w in r.words:
            t = w["text"].strip(".,;:!?()[]\"'")
            if not em.has_letters(t) or t.startswith("-") or t.endswith("-"):
                continue
            out.append(t)
    return out


# ------------------------------------------------------------------ tokens

class Tok:
    __slots__ = ("text", "blank", "stem", "ok", "raw", "x0", "x1", "row")

    def __init__(self, text: str, raw: str = "", blank: str | None = None, stem: str = "", ok: bool = True,
                 x0: float = 0, x1: float = 0, row: int = 0):
        self.text, self.raw, self.blank, self.stem, self.ok, self.x0, self.x1, self.row = text, raw, blank, stem, ok, x0, x1, row

    def __repr__(self):
        return f"Tok({self.text!r}{', blank ' + self.blank + ' ' + self.stem if self.blank else ''}{'' if self.ok else ', ?'})"


GENERABLE = ("N", "ADJ", "V", "VPAR", "PRON", "NUM", "ADV")


def lemma_id(e: dict) -> tuple:
    return (e.get("h"), e.get("pos") if e.get("pos") != "VPAR" else "V", e.get("lemma"),
            tuple(e.get("cat") or []), tuple(e.get("roots") or []), e.get("gender"), e.get("kind"))


class Lex:
    """Attested forms and stems: the glossary, the library's Whitaker analyses
    (build_vocab's cache), the extract_margins lexicon."""

    def __init__(self, glossary: dict, cache: dict, lexicon: em.Lexicon):
        self.entries: dict[str, list[dict]] = {}
        for src in (glossary, cache):
            for k, v in src.items():
                if v and k not in self.entries:
                    self.entries[k] = v
        self.lexicon = lexicon
        self.stems: dict[str, Counter] = defaultdict(Counter)   # skeleton → macronised spellings
        for ents in self.entries.values():
            for e in ents:
                for i, r in enumerate(e.get("roots") or []):
                    if not r or r == "-" or not re.match(f"^[{LETTERS}]+$", r):
                        continue
                    self.stems[em.skeleton(r)][r] += 1
                    if e["pos"] in ("V", "VPAR") and i == 0 and e.get("cat"):
                        vowel = {1: "ā", 2: "ē", 4: "ī"}.get(e["cat"][0])
                        if vowel:
                            self.stems[em.skeleton(r + vowel)][r + vowel] += 1

        # the generator's index: every lemma, reachable by the skeleton of its roots
        self.by_root: dict[str, list[dict]] = defaultdict(list)
        self.by_lemma: dict[tuple, dict] = {}
        seen: set[tuple] = set()
        for ents in self.entries.values():
            for e in ents:
                if e.get("pos") not in GENERABLE or not e.get("roots"):
                    continue
                lid = lemma_id(e)
                if lid in seen:
                    continue
                seen.add(lid)
                self.by_lemma[lid] = e
                roots = {em.skeleton(r) for r in e["roots"] if r and r != "-"}
                for r in roots:
                    if r:
                        self.by_root[r].append(e)
        self._gen: dict[tuple, dict[str, list[dict]]] = {}
        #: form → [(entry, parse)] for the forms latin_forms generated this run.
        #: only consulted while `gen_active` is on — the generated pass — so that
        #: the attested pass behaves exactly as it did before the generator existed
        self.gen_parses: dict[str, list[tuple[dict, dict]]] = {}
        self.gen_active = False

    def offer(self, e: dict, form: str, parses: list[dict]) -> None:
        """Record a generated form's parses so parses_of can reach them."""
        if form in self.gen_parses:
            return
        self.gen_parses[form] = [(e, p) for p in parses]

    def generated(self, e: dict) -> dict[str, list[dict]]:
        """form → parses, every regular form of the lemma (latin_forms)."""
        lid = lemma_id(e)
        idx = self._gen.get(lid)
        if idx is None:
            gen = dict(e)
            if gen.get("pos") == "VPAR":
                gen = dict(gen, pos="V")
            try:
                idx = lfm.form_index(gen)
            except Exception:
                idx = {}
            self._gen[lid] = idx
        return idx

    def entries_by_root_prefix(self, sk: str, slack: int = 2) -> list[dict]:
        """The lemmas whose root the printed stem begins with (as stem_candidates
        allows: at most `slack` letters of the ending are printed with the stem)."""
        out, seen = [], set()
        for n in range(len(sk), max(0, len(sk) - slack) - 1, -1):
            for e in self.by_root.get(sk[:n], ()):
                lid = lemma_id(e)
                if lid in seen:
                    continue
                seen.add(lid)
                out.append(e)
        return out

    def is_form(self, tok: str) -> bool:
        k = em.skeleton(tok)
        if not k:
            return False
        if k in self.entries or canonical(tok) in self.entries:
            return True
        c = self.lexicon.forms.get(k)
        if not c:
            return False
        # the lexicon also counts the pensa's own printed stems ("fluvi-", and "oppid"
        # where the text layer lost the dash): a key seen with a dash is a stem, not a word
        if any(sp.endswith("-") for sp in c):
            return False
        return any(n >= 2 for sp, n in c.items() if not sp.startswith("-"))

    def entries_of(self, tok: str) -> list[dict]:
        k = em.skeleton(tok)
        return self.entries.get(k) or self.entries.get(canonical(tok)) or []

    def is_stem(self, stem: str) -> bool:
        k = em.skeleton(stem)
        return bool(k) and (k in self.stems or any(k.startswith(s) and 0 < len(k) - len(s) <= 1 for s in self.stems if len(s) >= 2 and len(k) - 1 <= len(s)))

    def spell_stem(self, stem: str) -> str:
        k = em.skeleton(stem)
        if k in self.stems:
            return self.stems[k].most_common(1)[0][0]
        for depth in (1, 2):
            for v in em._variants(k, depth, rs.GARBLES):
                if v in self.stems:
                    return self.stems[v].most_common(1)[0][0]
        return stem


# ------------------------------------------------------------------ chapter text

class Index:
    """n-gram counts over a set of sentences: what stands between which words."""

    def __init__(self, token_lists: list[list[str]]):
        self.tri: dict[tuple, Counter] = defaultdict(Counter)
        self.left: dict[tuple, Counter] = defaultdict(Counter)
        self.right: dict[tuple, Counter] = defaultdict(Counter)
        self.uni: dict[str, Counter] = defaultdict(Counter)
        for toks in token_lists:
            keys = [em.skeleton(t) for t in toks]
            for i, t in enumerate(toks):
                k = keys[i]
                form = t if t[:1].isupper() and t.lower() != t else t.lower()
                self.uni[k][t] += 1
                L = keys[i - 1] if i > 0 else "^"
                R = keys[i + 1] if i + 1 < len(toks) else "$"
                self.tri[(L, k, R)][form] += 1
                self.left[(L, k)][form] += 1
                self.right[(k, R)][form] += 1

    def n_tri(self, L, k, R) -> int:
        return sum(self.tri.get((L, k, R), _EMPTY).values()) if L and R else 0

    def n_bi(self, L, k, R) -> int:
        return (sum(self.left.get((L, k), _EMPTY).values()) if L else 0) +                (sum(self.right.get((k, R), _EMPTY).values()) if R else 0)

    def n_uni(self, k) -> int:
        return sum(self.uni.get(k, _EMPTY).values())


_EMPTY: Counter = Counter()


class ChapterText:
    """The chapter's own sentences (FR units), indexed for context matching."""

    def __init__(self, units: list[dict], lem: bv.Lemmatiser):
        self.units = units
        self.lem = lem
        self.unit_tokens: list[list[str]] = [[m.group() for m in _WORD.finditer(u["la"])] for u in units]
        self.unit_keys: list[set[str]] = [set(em.skeleton(t) for t in toks) for toks in self.unit_tokens]
        self.index = Index(self.unit_tokens)
        self.tri, self.left, self.right, self.uni = (self.index.tri, self.index.left, self.index.right, self.index.uni)
        self.forms: dict[str, str] = {}          # skeleton → the chapter's own spelling
        for k, cnt in self.uni.items():
            form = cnt.most_common(1)[0][0]
            caps = sum(n for x, n in cnt.items() if x[:1].isupper())
            self.forms[k] = form if caps > sum(cnt.values()) / 2 else form.lower()

    def focus(self, keys: set[str]) -> tuple[Index, list[int]] | tuple[None, list]:
        """The chapter sentences that re-tell this pensum sentence (most of its
        words, in the chapter, in one sentence) — the pensa retell the chapter."""
        if len(keys) < 3:
            return None, []
        best: list[tuple[float, int]] = []
        for ui, uk in enumerate(self.unit_keys):
            hit = len(keys & uk)
            if hit >= 3 and hit / len(keys) >= 0.5:
                best.append((hit / len(keys), ui))
        if not best:
            return None, []
        best.sort(reverse=True)
        picks = [ui for _, ui in best[:6]]
        return Index([self.unit_tokens[ui] for ui in picks]), picks

    def forms_of_lemma(self, key: tuple[str, str]) -> Counter:
        out: Counter = Counter()
        for k, c in self.uni.items():
            e = self.lem_entry(k)
            if e is not None and bv.lemma_key(e) == key:
                out.update(c)
        return out

    def lem_entry(self, form: str) -> dict | None:
        ents = [e for e in self.lem.entries(form) if bv.usable(e) or bv.is_proper_entry(e)]
        return ents[0] if ents else None


# ------------------------------------------------------------------ extraction

def block_rows(pdf, pages: list[int], heads: list[tuple[int, float, str]], sides: dict[int, str]) -> dict[str, list[em.Row]]:
    """kind → rows between its heading and the next heading / chapter end."""
    out: dict[str, list[em.Row]] = {}
    heads = sorted(heads)
    for i, (p, top, kind) in enumerate(heads):
        nxt = heads[i + 1] if i + 1 < len(heads) else None
        rows = []
        for q in pages:
            if q < p or (nxt and q > nxt[0]):
                continue
            for r in main_rows(pdf.pages[q - 1], q, sides[q]):
                if q == p and r.top < top + 2:
                    continue
                if nxt and q == nxt[0] and r.top > nxt[1] - 2:
                    continue
                rows.append(r)
        out[kind] = out.get(kind, []) + rows
    return out


def row_tokens(rows: list[em.Row], kind: str, lex: Lex, cleaner: rs.Cleaner, dump: bool = False) -> list[Tok]:
    """Rows → cleaned tokens with the blanks marked."""
    toks: list[Tok] = []
    carry: tuple[str, float, float] | None = None   # (fragment, x0, x1) broken at the previous row end

    def is_word(s: str) -> bool:
        return lex.is_form(s) or em.skeleton(s) in rs._COMMON

    def split_any(s: str, min_left: int = 2) -> tuple[str, str] | None:
        """Two attested words the OCR ran together (the Cleaner's rule), or a
        single letter named in the text glued to a function word ("Aet")."""
        m = re.match(f"^([A-Za-z])(et|est|in|sunt|non|nōn|quoque)$", s)
        if m and min_left <= 1:
            return m.group(1), m.group(2)
        sp = cleaner._split_glued(em.skeleton(s), s.lower())
        if sp and len(sp[0]) >= min_left:
            a = s[:len(sp[0])] if s[:1].isupper() else sp[0]
            return a, sp[1]
        return None

    def push(text: str, x0: float, x1: float, row: int, gap_after: bool) -> bool:
        """→ True when the token was read as a stem whose printed hyphen the layer lost."""
        nonlocal toks
        text = text.replace(SOFT_HYPHEN, "")
        if not text:
            return False
        if kind == "A":
            # a stem: "vīll-", "ill—", or a stem the text layer left without its dash before a gap
            m = re.match(f"^([{LETTERS}]+)[{DASHES}]$", text)
            if m:
                toks.append(Tok("", text, "A", m.group(1), True, x0, x1, row))
                return False
            m = re.match(f"^([{LETTERS}]+)[{DASHES}]([.,;:!?\"”»)]+)$", text)
            if m:
                toks.append(Tok("", text, "A", m.group(1), True, x0, x1, row))
                toks.append(Tok(m.group(2), m.group(2), None, "", True, x1, x1, row))
                return False
            m = re.match(f"^[{DASHES}](isse|um|us|a|ī|ae|ō)([.,;:!?)]*)$", text)   # "-isse -um": principal parts
            if m:
                toks.append(Tok("", text, "P", m.group(1), True, x0, x1, row))
                if m.group(2):
                    toks.append(Tok(m.group(2), m.group(2), None, "", True, x1, x1, row))
                return False
            m = re.match(f"^([{LETTERS}]+)([.,;:!?\"”»)]*)$", text)
            if m and gap_after and not is_word(m.group(1)) and lex.is_stem(m.group(1)):
                toks.append(Tok("", text, "A", m.group(1), True, x0, x1, row))
                if m.group(2):
                    toks.append(Tok(m.group(2), m.group(2), None, "", True, x1, x1, row))
                return True
        if kind in ("B", "A"):
            # "Sicilia—" / "—," / "Est—" : a long dash is a whole-word blank (in Pensum A only when it stands alone)
            parts = re.split(r"(—)", text)
            if len(parts) > 1:
                for part in parts:
                    if part == "—":
                        toks.append(Tok("", "—", "B", "", True, x0, x1, row))
                    elif part:
                        push_word(part, x0, x1, row)
                return False
        push_word(text, x0, x1, row)
        return False

    def push_word(text: str, x0: float, x1: float, row: int):
        text = re.sub(r"^u(?=[A-ZĀĒĪŌŪ])", '"', text)          # the scan's opening quote before a capital
        text = re.sub(r"^u(?=▒)", '"', text)
        if _PUNCT_ONLY.match(text):
            toks.append(Tok(text, text, None, "", True, x0, x1, row))
            return
        # "Fīliī,quī" — a mark glued to the next word
        m = re.match(f"^([{LETTERS}]+[,;:.?!])([{LETTERS}\"].*)$", text)
        if m:
            push_word(m.group(1), x0, x1, row)
            push_word(m.group(2), x0, x1, row)
            return
        prev = next((t for t in reversed(toks) if t.text or t.blank), None)
        initial = prev is None or bool(re.search(r"[.!?…:][\"'”’»)]*$", prev.text))
        core = re.match(f"^([^{LETTERS}]*)([{LETTERS}].*?)([^{LETTERS}]*)$", text)
        if not core:
            toks.append(Tok(text, text, None, "", True, x0, x1, row))
            return
        pre, word, post = core.groups()
        cleaned, ok = cleaner.word(word, initial=initial)
        if ok and " " not in cleaned and not is_word(cleaned):
            # not in the lexicon: the OCR may have run two words together ("Latīnaesunt", "Aet")
            sp = split_any(cleaned, min_left=1)
            if sp:
                cleaned = sp[0] + " " + sp[1]
            elif not re.match(r"^[IVXLCDM]+$", cleaned) and len(cleaned) > 1:
                ok = False  # kept as printed but attested nowhere: not to be trusted ("Mulū", "paud")
        if ok and re.search(r"^.+[A-ZĀĒĪŌŪ]", cleaned) and not cleaned.isupper():
            # a capital inside a word is the scan's slip for ī + l ("NŪus" = Nīlus): repair when one
            # attested word results, else the token is unreadable
            hits: list[str] = []
            for rep in ("īl", "il", "ll", "lī", "ī", "l"):
                cand = re.sub(r"(?<=.)[A-ZĀĒĪŌŪ]", rep, cleaned, count=1)
                if is_word(cand) and em.skeleton(cand) not in {em.skeleton(h) for h in hits}:
                    hits.append(cand)
            fixed = hits[0] if len(hits) == 1 else False
            if fixed:
                cleaner.repaired[f"{cleaned} → {fixed}"] += 1
                cleaned = fixed
            else:
                ok = False
        for k, piece in enumerate(cleaned.split(" ")):
            toks.append(Tok((pre if k == 0 else "") + piece + (post if k == len(cleaned.split(" ")) - 1 else ""),
                            text, None, "", ok, x0, x1, row))

    lefts: dict[int, float] = {}
    rights: dict[int, list[float]] = defaultdict(list)
    for ri, r in enumerate(rows):
        if not r.words:
            continue
        lefts[r.page] = min(lefts.get(r.page, 1e9), r.words[0]["x0"])
        rights[r.page].append(r.words[-1]["x1"])
    edges: dict[int, tuple[float, float]] = {}
    for pg, xs in rights.items():
        xs = sorted(xs)
        # the typical row end is the right margin; short rows end paragraphs
        edges[pg] = (lefts[pg], xs[int(len(xs) * 0.75)] if xs else 0.0)
    for ri, r in enumerate(rows):
        ws = r.words
        # median gap between consecutive words on the row: a lost dash leaves a wider one
        gaps = sorted(b["x0"] - a["x1"] for a, b in zip(ws, ws[1:]))
        med = gaps[len(gaps) // 2] if gaps else 3.0
        space = min(max(med, 1.5), 7.0)
        sizes = sorted(w.get("size", 10.0) for w in ws)
        dash_w = sizes[len(sizes) // 2] * 0.98          # an em dash is about one em wide
        hyph_w = dash_w * 0.45
        # a row that is not the last of its paragraph is justified flush right: a short
        # right end means the text layer lost the marks that stood there
        left_edge, right_edge = edges.get(r.page, (0.0, 0.0))
        nxt = rows[ri + 1] if ri + 1 < len(rows) else None
        flush = bool(nxt and nxt.page == r.page and nxt.words and nxt.words[0]["x0"] < left_edge + 2.5)
        for i, w in enumerate(ws):
            text = w["text"]
            if i + 1 < len(ws):
                gap = ws[i + 1]["x0"] - w["x1"]
            elif flush and kind in ("A", "B"):
                gap = right_edge - w["x1"]
            else:
                gap = 0.0
            gap_after = gap > space + 4.5
            last = i == len(ws) - 1
            if carry:
                frag, cx0, _ = carry
                carry = None
                joined = frag + text.replace(SOFT_HYPHEN, "")
                jword = re.match(f"^([{LETTERS}]+)", joined)
                jw = jword.group(1) if jword else ""
                repaired = cleaner.word(jw)[0] if jw else ""
                if jw and (is_word(jw) or (repaired != jw and " " not in repaired and is_word(repaired))):
                    text = joined
                    w = {**w, "x0": cx0}
                elif jw and split_any(jw, min_left=len(frag) + 1):
                    text = joined  # "Del-" + "phīnōn" → Delphī nōn: split inside the continuation
                    w = {**w, "x0": cx0}
                elif kind == "A" and lex.is_stem(frag) and not is_word(frag) and not (frag[:1].isupper() and not frag[:1] == "I"):
                    toks.append(Tok("", frag + "-", "A", frag, True, cx0, cx0, ri))  # "Latīn-" at a row end
                else:
                    text = joined  # keep what we have; the cleaner decides
                    w = {**w, "x0": cx0}
            if last and (text.endswith(SOFT_HYPHEN) or (kind != "A" and text.endswith("-") and len(text) > 2)):
                carry = (text.rstrip(SOFT_HYPHEN + "-"), w["x0"], w["x1"])
                continue
            lost_hyphen = push(text, w["x0"], w["x1"], ri, gap_after)
            # what is left of an over-wide gap once the space (and a lost stem hyphen)
            # are accounted for is one em dash per dash-width: a whole-word blank the
            # text layer dropped ("sed — — est." arrives as "sed" … "est.")
            if kind in ("A", "B"):
                avail = gap - space - (hyph_w if lost_hyphen else 0.0)
                if avail >= (0.9 if last else 0.55) * dash_w:
                    n = min(3, max(1, int(round(avail / (dash_w + space)))))
                    for _ in range(n):
                        toks.append(Tok("", "", "B", "", True, w["x1"], w["x1"], ri))
    if carry:
        push(carry[0], carry[1], carry[2], len(rows), False)
    if dump:
        for t in toks:
            print("   ", t)
    return toks


def sentences_of(toks: list[Tok], kind: str) -> list[list[Tok]]:
    """Group tokens into sentences (split_sentences on a marked-up text)."""
    pieces = []
    for t in toks:
        if t.blank == "A":
            pieces.append(A_MARK)
        elif t.blank == "B":
            pieces.append(B_MARK)
        elif t.blank == "P":
            pieces.append(B_MARK)
        else:
            pieces.append(t.text)
    text = " ".join(pieces)
    text = re.sub(r" ([,.;:!?)\]”»])", r"\1", text)
    text = re.sub(r"([(\[“«]) ", r"\1", text)
    if kind == "C":
        sents = [s.strip() for s in re.split(r"(?<=\?)\s+", text) if s.strip()]
    else:
        sents = split_sentences(text, latin=True)
    # walk the tokens along the sentences
    out: list[list[Tok]] = []
    ti = 0
    for s in sents:
        n_marks = s.count(A_MARK) + s.count(B_MARK)
        n_words = len(_WORD.findall(s.replace(A_MARK, "").replace(B_MARK, "")))
        group: list[Tok] = []
        words = marks = 0
        while ti < len(toks) and (words < n_words or marks < n_marks):
            t = toks[ti]
            group.append(t)
            ti += 1
            if t.blank:
                marks += 1
            else:
                words += len(_WORD.findall(t.text))
        while ti < len(toks) and not toks[ti].blank and not _WORD.search(toks[ti].text):
            group.append(toks[ti])   # trailing punctuation
            ti += 1
        if group:
            out.append(group)
    if ti < len(toks):
        out.append(toks[ti:])
    return out


def render_text(sent: list[Tok]) -> str:
    parts = []
    for t in sent:
        if t.blank == "A":
            parts.append(t.stem + "_")
        elif t.blank in ("B", "P"):
            parts.append("___")
        else:
            parts.append(t.text)
    s = " ".join(parts)
    s = re.sub(r" ([,.;:!?)\]”»])", r"\1", s)
    s = re.sub(r"([(\[“«]) ", r"\1", s)
    s = re.sub(r'(^|\s)"\s+', r'\1"', s)
    s = re.sub(r'\s+"([,.;:!?]|\s|$)', r'"\1', s)
    return s.strip()


# ------------------------------------------------------------------ answers

def parses_of(form: str, lex: Lex) -> list[tuple[dict, dict]]:
    """(entry, parse) pairs for a form.  A form the library never prints has none;
    if it came from latin_forms, its generated parses stand in, so the agreement
    filters judge a generated candidate exactly as they judge an attested one."""
    out = []
    for e in lex.entries_of(form):
        for p in e.get("parses") or [{}]:
            out.append((e, p))
    if out or not lex.gen_active:
        return out
    return lex.gen_parses.get(form, [])


def agree(p: dict, q: dict) -> bool:
    """noun/adjective parses agree in case, number and (when both known) gender."""
    if p.get("case") != q.get("case") or p.get("number") != q.get("number"):
        return False
    g1, g2 = p.get("gender"), q.get("gender")
    return not g1 or not g2 or g1 == g2 or "c" in (g1, g2)


def neighbour(sent: list[Tok], i: int, step: int) -> Tok | None:
    j = i + step
    while 0 <= j < len(sent):
        t = sent[j]
        if t.blank or _WORD.search(t.text):
            return t
        if re.search(r"[.!?;:]", t.text):
            return None
        j += step
    return None


def tok_form(t: Tok, answers: dict[int, str]) -> str | None:
    """The word a token stands for: its text, or a resolved blank's answer."""
    if t.blank:
        return answers.get(id(t))
    m = _WORD.search(t.text)
    return m.group() if m else None


PLURAL_COORD = {"et", "ac", "atque", "que"}
PERSONAL = {"ego": (1, "sg"), "tu": (2, "sg"), "nos": (1, "pl"), "vos": (2, "pl")}


def _nominal_parses(form: str | None, lex: "Lex") -> list[tuple[dict, dict]]:
    """(entry, parse) readings of the word as a noun / adjective / pronoun with a case."""
    if not form:
        return []
    return [(e, p) for e, p in parses_of(form, lex) if e["pos"] in NOMINAL and p.get("case")]


def prep_span(sent: list[Tok], lex: Lex, answers: dict[int, str]) -> set[int]:
    """Token indexes inside a prepositional phrase.  A word a preposition governs is
    never the sentence's subject, however nominative it may look ("in cūnīs Aemiliae"
    — Aemiliae is not the subject of the verb that follows)."""
    out: set[int] = set()
    run = 0        # 0 outside a phrase, else its length so far + 1; a prepositional
                   # phrase is the preposition, its noun and one word qualifying it
    for j, t in enumerate(sent):
        if not t.blank and not _WORD.search(t.text):
            if re.search(r"[,;:.!?]", t.text):
                run = 0
            continue
        f = tok_form(t, answers)
        if f is not None and em.skeleton(f) in PREP_CASE:
            run = 1
            continue
        if not run:
            continue
        if (t.blank or f is None or _nominal_parses(f, lex)) and run <= 2:
            out.add(j)
            run += 1
        else:
            run = 0                  # a verb, a particle, or the phrase's own length
    return out


def clause_start(sent: list[Tok], i: int) -> int:
    """The first token of the blank's own clause: Ørberg's sentences change subject at a
    comma ("Ego excitābor, tū bene dormiēs nec excitāberis")."""
    for j in range(i - 1, -1, -1):
        if not sent[j].blank and re.search(r"[,;:!?]", sent[j].text):
            return j + 1
    return 0


def _strong_break(sent: list[Tok], j: int) -> bool:
    return not sent[j].blank and bool(re.search(r"[;:!?]", sent[j].text))


def subject_info(sent: list[Tok], i: int, lex: Lex, answers: dict[int, str]) -> dict | None:
    """The subject the word at `i` agrees with: the FIRST nominative of its clause.

    Latin puts the subject first and the predicate after it, so the first nominative is
    the subject and a later one is the predicate ("Iūlius dominus … est").  A clause
    with no nominative of its own borrows the one before the comma, which is how a
    compound sentence carries its subject ("tū bene dormiēs nec excitāberis"); a
    semicolon, a colon or a full stop ends that.  `ego / tū / nōs / vōs` count as
    nominatives, a coordinated pair is plural, and a word a preposition governs is never
    the subject.  When the first nominative does not fix its number, nothing is claimed."""
    gov = prep_span(sent, lex, answers)

    def word_at(j: int) -> str | None:
        return tok_form(sent[j], answers)

    def is_nom(j: int, head: bool = False) -> tuple[int, str] | None | bool:
        """(person, number), None when the word is no nominative at all, False when it is
        one but does not fix its number — the caller then claims nothing."""
        if j in gov:
            return None
        f = word_at(j)
        if not f:
            return None
        k = em.skeleton(f)
        if k in PERSONAL:
            return PERSONAL[k]
        nps = _nominal_parses(f, lex)
        # the head of a subject is a noun or a pronoun; a bare adjective beside it is
        # part of some other phrase ("īnfantem tuum ipsa cūrābis" — tuum is not a subject)
        if head:
            nps = [ep for ep in nps if ep[0]["pos"] in ("N", "PRON", "NUM")]
        nums = {p.get("number") for _, p in nps if p.get("case") == "nom"}
        if not nums:
            return None
        if len(nums) != 1 or None in nums:
            return False
        return 3, nums.pop()

    def loose(j: int) -> bool:
        """a word the library does not know — an OCR-damaged or unlisted proper noun"""
        f = word_at(j)
        return bool(f) and not parses_of(f, lex)

    # forward only as far as the blank's own comma segment: what follows a comma is
    # another clause, or an address ("Industriī estōte, servī!" — servī is a vocative)
    end = len(sent)
    for j in range(i, len(sent)):
        if not sent[j].blank and re.search(r"[,;:!?]", sent[j].text):
            end = j
            break
    start = clause_start(sent, i)
    while True:
        for j in range(start, end):
            t = sent[j]
            if t.blank and word_at(j) is None:
                continue
            hit = is_nom(j, head=True)
            if hit is None:
                continue
            if hit is False:
                return None            # a nominative that does not fix its number
            per, num = hit
            span, persons = {j}, {per}
            # "Nīlus et Rhēnus", "Lesbos et Chios et Naxus": a coordinated subject is plural
            k = j
            while True:
                c = k + 1
                while c < end and not (sent[c].blank or _WORD.search(sent[c].text)):
                    c += 1
                d = c + 1
                while d < end and not (sent[d].blank or _WORD.search(sent[d].text)):
                    d += 1
                if d >= end or sent[c].blank                         or em.skeleton(sent[c].text.strip(",.;:\"'")) not in PLURAL_COORD:
                    break
                nxt = is_nom(d)
                if not nxt and not loose(d):
                    break
                span |= {c, d}
                persons.add(nxt[0] if isinstance(nxt, tuple) else 3)
                num, k = "pl", d
            per = 1 if 1 in persons else (2 if 2 in persons else 3)
            if per == 3 and end < len(sent) and re.search(r"!", sent[end].text):
                # an exclamation addresses somebody: "Malī discipulī estis!" has no
                # third-person subject, whatever the nominative beside it looks like
                return None
            return {"person": per, "number": num, "span": span, "coord": len(span) > 1}
        if start == 0 or _strong_break(sent, start - 1):
            return None
        end = start - 1
        start = clause_start(sent, start - 1)


def aligned_answers(sent: list[Tok], text: ChapterText, picks: list[int]) -> dict[int, str]:
    """Blank position in the sentence → the word the chapter prints there.

    Only an EXACT alignment is trusted: the pensum sentence, with Ørberg's bracketed
    glosses ("[= fēmina]") dropped, must appear in a chapter sentence word for word
    with the blanks filled in — same length, every printed word in its place.  A looser
    alignment slides the blanks along the sentence and reads the wrong word into them
    ("Aemilia ōrnāmenta in collō" ← "Aemilia ānulum …"), so nothing less counts."""
    if any(not t.ok for t in sent):
        # an unreadable token is a wildcard: it swallows a word of the chapter sentence
        # and every blank after it reads the word beside its own.  The item is
        # unverified for the same reason, so nothing is lost by refusing to align it.
        return {}
    pat: list[tuple[str, str]] = []
    slot: list[int] = []
    depth = 0
    for i, t in enumerate(sent):
        if t.blank:
            if depth == 0:
                pat.append(("b", ""))
                slot.append(i)
            continue
        opened = t.text.count("[") + t.text.count("(")
        closed = t.text.count("]") + t.text.count(")")
        inside = depth > 0 or opened > 0
        depth = max(0, depth + opened - closed)
        if inside:
            continue                      # an editorial gloss, not part of the sentence
        for m in _WORD.finditer(t.text):
            pat.append(("w", em.skeleton(m.group()) if t.ok else "?"))
            slot.append(-1)
    n_lit = sum(1 for k, _ in pat if k == "w")
    if not any(k == "b" for k, _ in pat) or n_lit < 3:
        return {}
    votes: dict[int, Counter] = defaultdict(Counter)
    for ui in picks:
        toks = text.unit_tokens[ui]
        if len(toks) != len(pat):
            continue                      # the same sentence, word for word, or nothing:
                                          # a blank at the end of a shorter pattern would
                                          # otherwise swallow whatever the chapter has there
        keys = [em.skeleton(t) for t in toks]
        if any(k == "w" and keys[pi] != key for pi, (k, key) in enumerate(pat)):
            continue
        for pi, si in enumerate(slot):
            if si >= 0:
                votes[si][toks[pi]] += 1
    return {si: c.most_common(1)[0][0] for si, c in votes.items()
            if len({em.skeleton(f) for f in c}) == 1}


NOMINAL = ("N", "ADJ", "PRON", "VPAR", "NUM")
COPULA_SG = {"est", "erat", "erit", "fuit", "sit", "esset", "fuerat", "fuerit"}
COPULA_PL = {"sunt", "erant", "erunt", "fuerunt", "sint", "essent", "fuerant", "fuerint"}


def is_nominal(form: str | None, lex: Lex) -> bool:
    return bool(form) and any(e["pos"] in NOMINAL for e in lex.entries_of(form))


def copula_number(sent: list[Tok], answers: dict[int, str]) -> str | None:
    """'sg' / 'pl' when the sentence has exactly one kind of copula: a predicate
    noun or adjective is nominative and agrees with it."""
    nums = set()
    for t in sent:
        f = tok_form(t, answers)
        if not f:
            continue
        k = em.skeleton(f)
        if k in COPULA_SG:
            nums.add("sg")
        elif k in COPULA_PL:
            nums.add("pl")
    return nums.pop() if len(nums) == 1 else None


def _nom_ep(ep) -> bool:
    """The reading inflects for case — a noun, adjective, pronoun, or a participle or
    gerundive.  The parse decides for a verb form, not the entry: the generator reaches
    a verb through whichever of its two glossary entries the index happened to keep, and
    a VPAR entry's *finite* forms are verbs like any other."""
    if ep[1].get("mood"):
        return bool(ep[1].get("case"))
    return ep[0]["pos"] in NOMINAL or bool(ep[1].get("case"))


def _verb_mood(ep) -> str | None:
    return ep[1].get("mood") if ep[0]["pos"] in ("V", "VPAR") else None


ADJECTIVAL = ("ADJ", "NUM", "PRON")


def _adjectival(ep, form: str | None = None, name_is_noun: bool = False) -> bool:
    """A word that can qualify a noun.  A capitalised NEIGHBOUR is read as a name
    whatever the glossary calls it — Whitaker files *Iūlius* and *Aemilius* as
    adjectives too ("of the Iulian gens"), and reading them so made the blank in
    "Iūlius Iūliae … mālum dat" agree with Iūlius."""
    if name_is_noun and form and form[:1].isupper():
        return False
    return ep[0]["pos"] in ADJECTIVAL or ep[1].get("mood") == "ptc"


def _attributive(ep, nb, form: str | None = None, nb_form: str | None = None) -> bool:
    """Two neighbouring words agree only when one of them qualifies the other: a noun
    and an adjective (or a participle, a numeral, a demonstrative).  Two nouns side by
    side do not agree — "pater Mārcī", "dominus servōrum", "Iūlius Aemiliam vidēt" — and
    a filter that made them agree turned every such genitive into a nominative."""
    return _adjectival(ep, form) != _adjectival(nb, nb_form, name_is_noun=True)


def _informative(ep) -> bool:
    """The reading says something the filters can test — a case, or a verb's mood.
    An adverb, a conjunction, a preposition, an interjection and an indeclinable
    numeral say nothing, so they satisfy every filter vacuously and must never be
    counted a survivor."""
    return bool(ep[1].get("case")) or bool(_verb_mood(ep))


def predicate_slot(sent: list[Tok], i: int, lex: Lex, answers: dict[int, str], subj: dict | None) -> bool:
    """Could the blank at `i` be the copula's predicate?  Only while every nominative
    the clause has printed before it belongs to the subject: after a predicate noun of
    its own ("Aemilia domina ___ est") the blank is that noun's complement, and Ørberg
    is drilling the genitive, not the nominative."""
    span = subj["span"] if subj else set()
    if subj and min(subj["span"]) > i and i not in span:
        return False           # the subject comes after the blank: "in pāginā prīmā
                               # capitulī secundī multa vocābula sunt" — the blank is
                               # neither subject nor predicate but a genitive
    gov = prep_span(sent, lex, answers)
    for j in range(i - 1, -1, -1):
        if j in gov:
            continue
        t = sent[j]
        if not t.blank and not _WORD.search(t.text):
            if re.search(r"[;:!?]", t.text):
                break
            continue
        if t.blank or j in span:
            continue
        f = tok_form(t, answers)
        if f and any(p.get("case") == "nom" for _, p in _nominal_parses(f, lex)):
            return False
    first = True
    for j in range(i + 1, len(sent)):
        t = sent[j]
        if not t.blank and not _WORD.search(t.text):
            if re.search(r"[;:!?]", t.text):
                break
            continue
        if first:
            first = False          # the word right after the blank belongs to its own
            continue               # phrase ("fīlius Iūliī", "īnsula magna")
        if t.blank or j in span or j in gov:
            continue
        f = tok_form(t, answers)
        if f and any(p.get("case") == "nom" for _, p in _nominal_parses(f, lex)):
            return False           # a nominative of its own stands further on: that is
                                   # the predicate, and the blank before it is not
                                   # ("Numerus capitulōrum nōn parvus est", "in pāginā
                                   # prīmā capitulī secundī multa vocābula sunt")
    return True


def context_filters(sent: list[Tok], i: int, lex: Lex, answers: dict[int, str]):
    """Ordered `Filt`s the word in the blank must satisfy, with a note naming the
    governing word."""
    fs: list[Filt] = []
    note = ""
    left, right = neighbour(sent, i, -1), neighbour(sent, i, 1)
    lf = tok_form(left, answers) if left else None
    rf = tok_form(right, answers) if right else None
    subj = subject_info(sent, i, lex, answers)

    # a preposition before the blank, or before the noun the blank qualifies
    prep = prep_word = None
    if lf and em.skeleton(lf) in PREP_CASE:
        prep, prep_word = em.skeleton(lf), lf
    elif (left is not None and not left.blank and lf and is_nominal(lf, lex)
          and not is_nominal(rf, lex) and not (right is not None and right.blank)):
        ll = neighbour(sent, sent.index(left), -1)
        llf = tok_form(ll, answers) if ll else None
        if llf and em.skeleton(llf) in PREP_CASE:
            prep, prep_word = em.skeleton(llf), llf
    if prep:
        cases = PREP_CASE[prep]
        # when the preposition stands before the blank it governs the blank itself; when
        # it stands before the noun beside the blank, it speaks only for a word that
        # qualifies that noun ("in vīllā magnā"), never for a noun of the blank's own
        direct = bool(lf and em.skeleton(lf) in PREP_CASE)
        binds = ((lambda ep, form=None: _nom_ep(ep)) if direct
                 else (lambda ep, form=None: _nom_ep(ep) and _adjectival(ep, form)))
        fs.append(Filt("case", lambda ep, form=None: not binds(ep) or ep[1].get("case") in cases, binds))
        note = f"after {prep_word}"
    else:
        # Subject or predicate of a copula: nominative, agreeing in number.  Only while
        # the blank can BE the predicate — once the clause has printed a nominative of
        # its own beside the subject, what follows is that noun's complement and may
        # stand in any case ("Aemilia domina ancillārum est", "pater Mārcī est").
        cn = copula_number(sent, answers) if predicate_slot(sent, i, lex, answers, subj) else None
        if cn:
            fs.append(Filt("case",
                           lambda ep, form=None: not _nom_ep(ep) or (ep[1].get("case") == "nom"
                                                                     and ep[1].get("number") == cn),
                           lambda ep, form=None: _nom_ep(ep)))

    # adjective ↔ noun agreement with a neighbouring word — but not with a noun that
    # belongs to a preposition phrase the blank is outside of ("in Graeciā multae īnsulae")
    gov = prep_span(sent, lex, answers)
    skip_left = left is not None and sent.index(left) in gov and i not in gov
    skip_right = right is not None and sent.index(right) in gov and i not in gov
    if rf and em.skeleton(rf).endswith("que") and lex.is_form(rf[:-3]):
        skip_right = True      # "ā pāstōre cēterīsque ovibus": -que starts a new phrase
    for nb in ((None if skip_left else lf), (None if skip_right else rf)):
        nbp = [(e, q) for e, q in parses_of(nb, lex) if _nom_ep((e, q)) and q.get("case")] if nb else []
        if nbp:
            def binds(ep, form=None, nbp=nbp, nb=nb):
                return _nom_ep(ep) and any(_attributive(ep, q, form, nb) for q in nbp)

            def test(ep, form=None, nbp=nbp, nb=nb, binds=binds):
                if not binds(ep, form):
                    return True
                return bool(ep[1].get("case")) and any(agree(ep[1], q[1]) for q in nbp
                                                       if _attributive(ep, q, form, nb))

            fs.append(Filt("agree", test, binds))

    # a finite verb agrees with its subject; an imperative addresses a second person
    if subj:
        per, num = subj["person"], subj["number"]

        def verb_ok(ep, form=None, per=per, num=num):
            mood = _verb_mood(ep)
            if mood in ("ind", "subj"):
                return ep[1].get("person") == per and ep[1].get("number") == num
            if mood == "imper":
                return per == 2 and ep[1].get("number") == num
            return True

        fs.append(Filt("subject", verb_ok,
                       lambda ep, form=None: _verb_mood(ep) in ("ind", "subj", "imper")))

    return fs, note


def survivors(cands: list[str], sent: list[Tok], i: int, lex: Lex, answers: dict[int, str]) -> list[str]:
    """The candidates that satisfy EVERY filter — no filter is ever dropped, so a
    sentence whose filters contradict one another leaves nothing and the blank stays
    unverified.  A candidate must FIT the slot, not merely fail to contradict it: a
    reading with no parse at all (an adverb, a particle, an indeclinable) satisfies
    every agreement filter vacuously and is therefore never a survivor — only the
    chapter-text alignment can attest such a word."""
    fs, _ = context_filters(sent, i, lex, answers)
    if not fs:
        return []
    out = []
    for c in cands:
        fits = False
        for ep in parses_of(c, lex):
            if not _informative(ep) or not all(f(ep, c) for f in fs):
                continue
            axes = {f.kind for f in fs if f.binds(ep, c)}
            mood = _verb_mood(ep)
            if mood in ("ind", "subj", "imper"):
                if "subject" not in axes:
                    # The sentence names no subject, so every finite form of the stem is
                    # equally possible and none can be told from the others.  A noun of
                    # the same stem must not win by default then ("ipsa cūrābis" is not
                    # "ipsa cūra", "ā parentibus laudābitur" not "ā parentibus laudibus"):
                    # the blank resolves to nothing.
                    return []
            elif mood:
                continue                  # an infinitive, a supine, a participle or a
                                          # gerundive: tense, voice — and for the verbal
                                          # adjectives the whole choice of construction —
                                          # rest on nothing the sentence settles
                                          # ("Patientiam habē—!" is not "habentem")
            if ep[1].get("case") and not ({"case", "agree"} & axes):
                # The sentence pins no case here, so this reading is as possible as any
                # other and the blank cannot be settled: an adjective that merely agrees
                # with the noun beside it must not win over the accusative object nobody
                # can rule out ("Māter Quīntum videt" is not "Māter quīnta videt").
                return []
            if _adjectival(ep, c) and "case" not in axes and sent[i].blank == "A":
                # Only the neighbour's agreement speaks for this adjective, and the stem's
                # own adverb agrees with nothing at all: "Mārcus prāvē respondet" and
                # "Mārcus prāvus respondet" are both Latin, and the pensum means the first.
                return []
            fits = True
        if fits:
            out.append(c)
    return out


def constrain(cands: list[str], sent: list[Tok], i: int, lex: Lex, answers: dict[int, str]) -> tuple[list[str], str]:
    """Filter candidate forms by agreement; → (survivors, note).

    A candidate survives only if ONE of its readings satisfies every filter — a word
    that is a noun under one filter and a verb under another has not been explained.
    Filters are dropped from the end until something survives, so agreement never
    empties the pool."""
    fs, note = context_filters(sent, i, lex, answers)
    for depth in range(len(fs), 0, -1):
        kept = [c for c in cands
                if not parses_of(c, lex) or any(all(f(ep, c) for f in fs[:depth]) for ep in parses_of(c, lex))]
        if kept:
            return kept, note
    return cands, note


def context_parse(form: str, sent: list[Tok], i: int, lex: Lex, answers: dict[int, str]):
    """The (entry, parse) of `form` that fits this place in the sentence."""
    ps = parses_of(form, lex)
    if not ps:
        return None
    fs, _ = context_filters(sent, i, lex, answers)
    for depth in range(len(fs), 0, -1):
        kept = [ep for ep in ps if all(f(ep, form) for f in fs[:depth])]
        if kept:
            return kept[0]
    return ps[0]


def describe(form: str, lex: Lex, sent: list[Tok], i: int, answers: dict[int, str]) -> str:
    """A short name of the form for the note: 'abl. sg.', '3rd pl. fut.'"""
    ep = context_parse(form, sent, i, lex, answers)
    if ep is None:
        return ""
    e, p = ep
    if e["pos"] == "V":
        if p.get("mood") == "inf":
            return f"{p.get('tense', '')} inf.".strip()
        if p.get("mood") == "imper":
            return f"imperative {p.get('number', '')}".strip()
        per = ORD.get(p.get("person"), "")
        return " ".join(x for x in (per, (p.get("number") or "") + ".", p.get("tense", ""),
                                    "pass." if p.get("voice") == "pass" else "",
                                    p.get("mood") if p.get("mood") not in (None, "ind") else "") if x.strip(".")).strip()
    if e["pos"] in NOMINAL and p.get("case"):
        return " ".join(x for x in ((p.get("case") or "") + ".", (p.get("number") or "") + ".",
                                    p.get("gender") or "") if x.strip(".")).strip()
    return e["pos"].lower()


def resolve_blank(sent: list[Tok], i: int, cands: list[str], text: ChapterText, lex: Lex,
                  answers: dict[int, str], focus: Index | None = None) -> tuple[list[str], str, bool]:
    """→ (accepted forms, note, resolved?).

    The pensa re-tell the chapter, so the blank is first matched against the chapter's
    own words: the candidate the chapter prints between the same neighbours wins —
    inside the sentences that re-tell this one (`focus`) before the chapter at large.
    What survives is filtered by agreement."""
    if not cands:
        return [], "", False
    left, right = neighbour(sent, i, -1), neighbour(sent, i, 1)
    lf = tok_form(left, answers) if left else None
    rf = tok_form(right, answers) if right else None
    L = em.skeleton(lf) if lf else ("^" if left is None else None)
    R = em.skeleton(rf) if rf else ("$" if right is None else None)
    if left is not None and left.blank and lf is None:
        L = None
    if right is not None and right.blank and rf is None:
        R = None

    def sides(ix: Index, k: str) -> tuple[int, int]:
        l = sum(ix.left.get((L, k), _EMPTY).values()) if L else 0
        r = sum(ix.right.get((k, R), _EMPTY).values()) if R else 0
        return min(l, r), l + r

    def score(c: str) -> tuple[int, ...]:
        k = em.skeleton(c)
        f_both, f_bi = sides(focus, k) if focus else (0, 0)
        c_both, c_bi = sides(text.index, k)
        return (focus.n_tri(L, k, R) if focus else 0, f_both, f_bi,
                text.index.n_tri(L, k, R), c_both, c_bi,
                focus.n_uni(k) if focus else 0, text.index.n_uni(k))

    cands, note = constrain(cands, sent, i, lex, answers)
    scored = {c: score(c) for c in cands}
    pool = list(cands)
    for tier in range(6):   # focus tri / both sides / either side, then the chapter at large
        best = max(scored[c][tier] for c in pool)
        if best > 0:
            pool = [c for c in pool if scored[c][tier] == best]
            if len(pool) == 1:
                return pool, note, True
            break
    if len(pool) == 1:
        return pool, note, True
    # several survive: prefer the forms the chapter itself uses
    in_ch = [c for c in pool if scored[c][7] > 0]
    if len(in_ch) == 1:
        return in_ch, note, True
    pool = in_ch or pool
    pool.sort(key=lambda c: tuple(-n for n in scored[c]) + (c,))
    return pool[:3], note, False


def stem_candidates(stem: str, lex: Lex, text: ChapterText, library_forms: dict[str, Counter]) -> list[str]:
    """Attested forms beginning with the stem whose lemma has that root."""
    sk = em.skeleton(stem)
    out: dict[str, int] = {}
    pools = [(text.uni, 2), (library_forms, 1)]
    for pool, weight in pools:
        for k, forms in list(pool.items()):
            if not forms or not k.startswith(sk) or k == sk and not lex.entries_of(k):
                continue
            ok = False
            for e in lex.entries_of(k):
                roots = [em.skeleton(r) for r in (e.get("roots") or []) if r and r != "-"]
                if e["pos"] not in ("N", "ADJ", "V", "VPAR", "PRON", "NUM"):
                    # an adverb or a particle: the glossary's "roots" are its own forms
                    # ("fortiter fortius fortissimē"), so the stem is a prefix of them
                    ok = ok or any(r.startswith(sk) for r in roots)
                elif e["pos"] == "PRON" or e["pos"] == "NUM":
                    ok = ok or any(sk.startswith(r) for r in roots) or bool(roots) and len(sk) <= 3
                else:
                    ok = ok or any(sk.startswith(r) and len(sk) - len(r) <= 2 for r in roots) \
                        or (e["pos"] in ("V", "VPAR") and e.get("cat") and any(sk == r + v for r in roots for v in "aei"))
                if ok:
                    break
            if not ok:
                continue
            form = forms.most_common(1)[0][0]
            f = form if form[:1].isupper() and sum(n for x, n in forms.items() if x[:1].isupper()) > sum(forms.values()) / 2 else form.lower()
            out[f] = out.get(f, 0) + weight * sum(forms.values())
    return sorted(out, key=lambda f: -out[f])


def generated_stem_candidates(stem: str, lex: Lex, attested: list[str],
                              lemmas: set[tuple[str, str]] | None = None) -> list[str]:
    """Regular forms of the lemmas whose root the stem names, from latin_forms —
    the forms Ørberg asks for that the library never prints (amābit, dormiēmus).
    Only lemmas the chapter itself uses are offered (the pensa re-tell the
    chapter), and only after the attested forms have failed."""
    sk = em.skeleton(stem)
    if len(sk) < 2:
        return []
    have = {em.skeleton(a) for a in attested}
    out: dict[str, None] = {}
    for e in lex.entries_by_root_prefix(sk):
        if lemmas is not None:
            try:
                if bv.lemma_key(e) not in lemmas:
                    continue
            except Exception:
                continue
        for f, ps in lex.generated(e).items():
            k = em.skeleton(f)
            if k == sk or not k.startswith(sk) or k in have or " " in f:
                continue
            lex.offer(e, f, ps)
            out[f] = None
    return sorted(out, key=lambda f: (len(f), f))


def chapter_form_index(lex: Lex, lemmas: set[tuple[str, str]]) -> list[tuple[str, str, dict]]:
    """(skeleton, form, entry) for every regular form of the chapter's own lemmas, by
    skeleton.  A search over the roots misses the irregular verbs — esse has no root
    "er" — so this index is what lets the stem "er-" offer erō and erat beside erus,
    and a blank only resolves when it has met every rival it should have met."""
    out: list[tuple[str, str, dict]] = []
    for e in lex.by_lemma.values():
        try:
            if bv.lemma_key(e) not in lemmas:
                continue
        except Exception:
            continue
        for f in lex.generated(e):
            if " " not in f:
                out.append((em.skeleton(f), f, e))
    out.sort(key=lambda r: (r[0], r[1]))
    return out


def indexed_stem_candidates(stem: str, lex: Lex, attested: list[str],
                            index: list[tuple[str, str, dict]]) -> list[str]:
    """The chapter's regular forms that begin with the printed stem."""
    sk = em.skeleton(stem)
    if len(sk) < 2 or not index:
        return []
    have = {em.skeleton(a) for a in attested}
    out: dict[str, None] = {}
    for k, f, e in index[bisect.bisect_left(index, (sk,)):]:
        if not k.startswith(sk):
            break
        if k == sk or k in have:
            continue
        lex.offer(e, f, lex.generated(e).get(f) or [])
        out[f] = None
    return sorted(out)


def generated_bank_candidates(bank_lemmas: set[tuple[str, str]], lex: Lex,
                              attested: list[str]) -> list[str]:
    """Every regular form of the word bank's lemmas — Pensum B asks the learner to
    inflect a bank word, and the chapter does not print every case and person."""
    have = {em.skeleton(a) for a in attested}
    out: dict[str, None] = {}
    for e in lex.by_lemma.values():
        try:
            lk = bv.lemma_key(e)
        except Exception:
            continue
        if lk not in bank_lemmas:
            continue
        for f, ps in lex.generated(e).items():
            if " " in f or em.skeleton(f) in have:
                continue
            lex.offer(e, f, ps)
            out[f] = None
    return sorted(out, key=lambda f: (len(f), f))


def ending_of(stem: str, form: str) -> tuple[str, str] | None:
    """(stem as spelt in the form, ending) when the form begins with the stem."""
    n = len(stem)
    if em.skeleton(form[:n]) != em.skeleton(stem) or n >= len(form):
        return None
    return form[:n], form[n:]


#: the glossary's roots drop a few long vowels that Ørberg prints, and one perfect is
#: ambiguous between two verbs (caedere cecīdisse / cadere cecidisse).  A pensum answer
#: is macron-sensitive, so these principal parts are spelt out by verb.
PART_FIX: dict[str, dict[str, str]] = {
    "instruere": {"isse": "īnstrūxisse", "um": "īnstrūctum"},
    "cogere": {"isse": "coēgisse", "um": "coāctum"},
    "eligere": {"isse": "ēlēgisse", "um": "ēlēctum"},
    "confiteri": {"um": "cōnfessum"},
    "auferre": {"isse": "abstulisse", "um": "ablātum"},
    "noscere": {"isse": "nōvisse", "um": "nōtum"},
    "cognoscere": {"isse": "cognōvisse", "um": "cognitum"},
    "caedere": {"isse": "cecīdisse", "um": "caesum"},
    "emere": {"isse": "ēmisse", "um": "ēmptum"},
    "includere": {"isse": "inclūsisse", "um": "inclūsum"},
    "tradere": {"isse": "trādidisse", "um": "trāditum"},
    "fugere": {"isse": "fūgisse"},
    "reprehendere": {"isse": "reprehendisse", "um": "reprehēnsum"},
    "iuvare": {"isse": "iūvisse", "um": "iūtum"},
    "neglegere": {"isse": "neglēxisse", "um": "neglēctum"},
    "desinere": {"isse": "dēsiisse"},
    "eicere": {"isse": "ēiēcisse", "um": "ēiectum"},
    "promere": {"isse": "prōmpsisse", "um": "prōmptum"},
    "intellegere": {"isse": "intellēxisse", "um": "intellēctum"},
}


def principal_part(sent: list[Tok], i: int, lex: Lex) -> list[str]:
    """'-isse' / '-um' after an infinitive: the perfect infinitive / supine from the roots."""
    t = sent[i]
    j = i - 1
    while j >= 0 and (sent[j].blank or not _WORD.search(sent[j].text)):
        j -= 1
    if j < 0:
        return []
    verb = _WORD.search(sent[j].text).group()
    fix = PART_FIX.get(em.skeleton(verb), {}).get(t.stem)
    if fix:
        return [fix]
    for e in lex.entries_of(verb):
        if e["pos"] == "V" and any(p.get("mood") == "inf" for p in e.get("parses", [])) and e.get("roots"):
            dep = e.get("kind") in ("dep", "semidep")
            # latin_forms knows which of the two the verb actually has: a deponent
            # has no active perfect infinitive (Ørberg writes it "sequī -um esse"),
            # but it does have the supine the exercise asks for
            gen = lex.generated(e)
            want = "supine" if t.stem == "um" else "inf"
            for f, ps in gen.items():
                for pr in ps:
                    if t.stem == "um" and pr.get("mood") == "supine" and pr.get("case") == "acc":
                        return [f]
                    if t.stem == "isse" and not dep and pr.get("mood") == "inf"                             and pr.get("tense") == "perf" and pr.get("voice") == "act":
                        return [f]
            del want
    return []


def resolve_sentence(sent: list[Tok], kind: str, text: ChapterText, lex: Lex, library_forms: dict[str, Counter],
                     bank_lemmas: set[tuple[str, str]], bank_forms: dict[str, list[str]],
                     gen_bank: list[str] | None = None,
                     chapter_lemmas: set[tuple[str, str]] | None = None,
                     gen_index: list[tuple[str, str, dict]] | None = None) -> dict:
    """One pensum sentence → an item.  The generator's forms are visible throughout:
    a candidate the chapter never prints is judged by exactly the filters an attested
    one is, and nothing resolves that they do not settle on their own."""
    was, lex.gen_active = lex.gen_active, True
    try:
        return _resolve_sentence(sent, kind, text, lex, library_forms, bank_lemmas,
                                 bank_forms, gen_bank, chapter_lemmas, gen_index)
    finally:
        lex.gen_active = was


def _resolve_sentence(sent: list[Tok], kind: str, text: ChapterText, lex: Lex, library_forms: dict[str, Counter],
                     bank_lemmas: set[tuple[str, str]], bank_forms: dict[str, list[str]],
                     gen_bank: list[str] | None = None,
                     chapter_lemmas: set[tuple[str, str]] | None = None,
                     gen_index: list[tuple[str, str, dict]] | None = None) -> dict:
    answers: dict[int, str] = {}
    blanks = [i for i, t in enumerate(sent) if t.blank]
    # the chapter sentences that re-tell this one
    lit = {em.skeleton(m.group()) for t in sent if not t.blank and t.ok for m in _WORD.finditer(t.text)}
    focus, picks = text.focus(lit)
    attested = aligned_answers(sent, text, picks)
    results: dict[int, dict] = {}
    damaged = any(not t.ok for t in sent)
    pending = list(blanks)
    from_text: set[int] = set()
    # passes: blanks with literal neighbours first, then those beside resolved blanks,
    # then two refinement rounds now that every neighbour has a value (an adjective and
    # its noun are often both blank, and neither can be judged before the other)
    for round_ in range(5):
        nxt = []
        for i in pending:
            t = sent[i]
            if t.blank == "P":
                forms = principal_part(sent, i, lex)
                results[i] = {"forms": forms, "note": "perfect infinitive" if t.stem == "isse" else "supine", "ok": bool(forms)}
                if forms:
                    answers[id(t)] = forms[0]
                continue
            if damaged:
                # an unreadable token stands where a word should: the neighbours a blank
                # is judged by may be the wrong ones, and the item is unverified anyway.
                # Only the principal parts, which read the verb printed beside them and
                # nothing else, still answer.
                results[i] = {"forms": [], "note": "", "ok": False, "generated": False}
                continue
            left, right = neighbour(sent, i, -1), neighbour(sent, i, 1)
            if (left and left.blank and id(left) not in answers or right and right.blank and id(right) not in answers) and round_ < 2:
                nxt.append(i)
                continue
            if i in from_text:
                continue
            if t.blank == "A":
                cands = stem_candidates(t.stem, lex, text, library_forms)
            elif kind == "B":
                cands = list(bank_forms.keys())
            else:
                # a whole-word blank inside Pensum A: the chapter's own words
                cands = list(text.forms.values())
            # (a) the chapter's own wording, when its sentences line up with this one
            hit = attested.get(i)
            if hit and (t.blank != "A" or ending_of(t.stem, hit)):
                _, note = constrain([hit], sent, i, lex, answers)
                results[i] = {"forms": [hit], "note": note, "ok": True, "generated": False}
                answers[id(t)] = hit
                from_text.add(i)
                continue
            # (b) exactly one survivor of the WHOLE pool — every attested form and
            # every regular form latin_forms can make from a matching root — after the
            # full filter stack.  Nothing else resolves: no frequency, no tie-break.
            if t.blank == "A":
                # the generated pool must be at least as wide as the attested one, or a
                # form the library happens to print ("pāruit") looks unique when its own
                # lemma's other forms ("pāruisset") were never offered
                lemmas = set(chapter_lemmas or ())
                for c in cands:
                    for e in lex.entries_of(c):
                        try:
                            lemmas.add(bv.lemma_key(e))
                        except Exception:
                            pass
                extra = generated_stem_candidates(t.stem, lex, cands, lemmas)
                extra += [f for f in indexed_stem_candidates(t.stem, lex, cands, gen_index or [])
                          if f not in extra]
            elif kind == "B":
                extra = [f for f in (gen_bank or []) if f not in cands]
            else:
                extra = []
            pool = cands + extra
            kept = survivors(pool, sent, i, lex, answers)
            if t.blank == "A":
                kept = [c for c in kept if ending_of(t.stem, c)]
            if len(kept) == 1:
                _, note = constrain(kept, sent, i, lex, answers)
                results[i] = {"forms": kept, "note": note, "ok": True,
                              "generated": kept[0] not in cands}
                answers[id(t)] = kept[0]
                continue
            # unresolved: a shortlist for the report only — it never becomes a fact the
            # neighbouring blanks may read, so `answers` is left alone
            forms, note, _ = resolve_blank(sent, i, kept or cands, text, lex, answers, focus)
            results[i] = {"forms": forms[:3], "note": note, "ok": False, "generated": False}
        pending = nxt if round_ < 2 else [i for i in blanks if sent[i].blank != "P" and i not in from_text]
        if not pending:
            break
    unreadable = [t.raw for t in sent if not t.ok]
    item_blanks = []
    unverified = bool(unreadable)
    for bi, i in enumerate(blanks):
        t = sent[i]
        r = results.get(i, {"forms": [], "note": "", "ok": False})
        if t.blank == "A":
            ends, stem_spelt = [], None
            for f in r["forms"]:
                se = ending_of(t.stem, f)
                if se:
                    if stem_spelt is None:
                        stem_spelt = se[0]
                    if se[1] not in ends:
                        ends.append(se[1])
            if stem_spelt is None:
                stem_spelt = lex.spell_stem(t.stem)
            prev = next((sent[j] for j in range(i - 1, -1, -1) if sent[j].blank or _WORD.search(sent[j].text)), None)
            starts = prev is None or bool(re.search(r"[.!?…][\"'”’»)]*$", prev.text))
            cap = starts and t.raw[:1].isupper() and not (t.raw[:1] == "I" and stem_spelt[:1] == "ī")
            t.stem = stem_spelt[:1].upper() + stem_spelt[1:] if cap else stem_spelt
            note = r["note"]
            if r["forms"] and r["ok"]:
                d = describe(r["forms"][0], lex, sent, i, answers)
                note = f"{d} ({note})" if note and d else (d or note)
            b = {"i": bi, "stem": t.stem, "answers": ends, "note": note}
            if not (r["ok"] and ends):
                b["unverified"] = True
                unverified = True
        elif t.blank == "P":
            b = {"i": bi, "stem": "", "answers": r["forms"], "note": r["note"]}
            if not r["ok"]:
                b["unverified"] = True
                unverified = True
        else:
            b = {"i": bi, "answers": r["forms"], "bank": []}
            if kind == "A":
                b = {"i": bi, "stem": "", "answers": r["forms"], "note": r["note"]}
                if r["forms"] and r["ok"]:
                    d = describe(r["forms"][0], lex, sent, i, answers)
                    b["note"] = f"{d} ({r['note']})" if r["note"] and d else (d or r["note"])
            if not (r["ok"] and r["forms"]):
                b["unverified"] = True
                unverified = True
        item_blanks.append(b)
    item = {"text": render_text(sent), "blanks": item_blanks}
    if not item_blanks:
        unverified = True          # nothing to fill in: the app hides it
    if unverified:
        item["unverified"] = True
    if unreadable:
        item["unreadable"] = unreadable
    return item


# ------------------------------------------------------------------ Pensum C

def content_keys(text: str, lem: bv.Lemmatiser) -> list[tuple[str, str] | str]:
    out = []
    for w in _WORD.findall(text):
        k = em.skeleton(w)
        if k in QUESTION_WORDS or k in FUNCTION or len(k) < 2 or k.endswith("ne") and k[:-2] in FUNCTION | QUESTION_WORDS:
            continue
        e = next((x for x in lem.entries(w) if bv.usable(x) or bv.is_proper_entry(x)), None)
        out.append(bv.lemma_key(e) if e else k)
    return out


def unit_keys(units: list[dict], lem: bv.Lemmatiser) -> list[set]:
    return [set(content_keys(u["la"], lem)) for u in units]


def short_answer(q: str, unit: dict, lex: Lex, lem: bv.Lemmatiser, qkeys: list, ukeys: set) -> list[str]:
    la = unit["la"]
    toks = _WORD.findall(la)
    keys = [em.skeleton(t) for t in toks]
    qw = em.skeleton(_WORD.search(q).group()) if _WORD.search(q) else ""
    qtoks = _WORD.findall(q)
    out: list[str] = []
    yes_no = qw in ("num", "nonne") or qw.endswith("ne") or any(em.skeleton(t).endswith("ne") and len(t) > 3 for t in qtoks[:2])
    if yes_no:
        missing = [k for k in qkeys if k not in ukeys]
        negated = any(k in NEG for k in keys)
        q_negated = any(em.skeleton(t) in NEG for t in qtoks)
        yes = not missing and negated == q_negated
        if qw == "nonne":
            yes = not missing and not negated
        out += ["Ita", "Ita est"] if yes else ["Nōn", "Minimē"]
        out.append(la)
        return out
    if qw == "ubi":
        m = re.search(r"\b(in|apud|sub|ad|prope|ante|post|inter)\s+([A-Za-zĀĒĪŌŪāēīōū]+(?:\s+(?:et\s+)?[A-Za-zĀĒĪŌŪāēīōū]+)?)", la)
        if m:
            phrase = m.group(0)
            phrase = re.sub(r"\s+(est|sunt|habitat|habitant|erat|erant)$", "", phrase)
            out.append(phrase)
    elif qw == "quid" and len(qtoks) >= 3 and em.skeleton(qtoks[1]) in ("est", "sunt"):
        subj = " ".join(qtoks[2:])
        pat = re.escape(strip_macrons(subj)).replace(r"\ ", r"\s+")
        s_la = strip_macrons(la)
        m = re.match(rf"^{pat}\s+(.+?)\s+(est|sunt)[.!]?$", s_la, re.I) or re.match(rf"^{pat}\s+(?:est|sunt)\s+(.+?)[.!]?$", s_la, re.I)
        if m:
            start = s_la.index(m.group(1))
            out.append(la[start:start + len(m.group(1))].strip(" ,"))
    elif qw == "quis":
        for t in toks:
            if t[:1].isupper() and t != toks[0] or (t == toks[0] and t[:1].isupper() and lex.entries_of(t) and bv.is_proper_entry(lex.entries_of(t)[0])):
                ents = lex.entries_of(t)
                if ents and any(p.get("case") == "nom" for e in ents for p in e.get("parses", [])):
                    out.append(t)
                    break
    elif qw == "quot":
        for t in toks:
            ents = lex.entries_of(t)
            if ents and ents[0]["pos"] == "NUM" or re.match(r"^[IVXLC]+$", t):
                out.append(t)
                break
    elif qw == "cur":
        m = re.search(r"\b(quia|quod|nam|quoniam)\b.*$", la)
        if m:
            out.append(m.group(0).rstrip(".!"))
    out.append(la)
    return out


# question words for which short_answer knows how to cut a short Latin answer out of
# the sentence: if it cannot, only a very close match is trusted
SHORT_ANSWER_WORDS = {"ubi", "quis", "quot", "cur"}


def build_c(sents: list[list[Tok]], units: list[dict], ukeys: list[set], lex: Lex, lem: bv.Lemmatiser) -> list[dict]:
    items = []
    for sent in sents:
        q = render_text(sent)
        if not _WORD.search(q):
            continue
        qkeys = content_keys(q, lem)
        best, best_score, best_hit = None, 0.0, 0
        for ui, u in enumerate(units):
            if not qkeys:
                break
            if u["la"].rstrip().endswith("?"):
                continue                      # a question cannot answer a question
            hit = sum(1 for k in qkeys if k in ukeys[ui])
            score = hit / len(qkeys) - 0.001 * len(u["la"]) / 100
            if score > best_score:
                best, best_score, best_hit = ui, score, hit
        item = {"q": q, "answers": [], "unit_id": None}
        short = False
        if best is not None:
            u = units[best]
            item["unit_id"] = u["id"]
            item["answers"] = list(dict.fromkeys(short_answer(q, u, lex, lem, qkeys, ukeys[best])))
            short = len(item["answers"]) > 1
        qw = em.skeleton(_WORD.search(q).group()) if _WORD.search(q) else ""
        if (best is None or best_score < 0.5 or best_hit < min(2, len(qkeys)) or any(not t.ok for t in sent)
                or (qw in SHORT_ANSWER_WORDS and not short)):
            item["unverified"] = True
        if any(not t.ok for t in sent):
            item["unreadable"] = [t.raw for t in sent if not t.ok]
        items.append(item)
    return items


# ------------------------------------------------------------------ per chapter

def chapter_units(library: dict[int, list[dict]], c: int) -> list[dict]:
    return [u for u in library.get(c, []) if u.get("source", "FR") == "FR"]


def vocab_lemmas(c: int) -> set[tuple[str, str]]:
    p = VOCAB_DIR / f"{c:02d}.json"
    if not p.exists():
        return set()
    out = set()
    for w in json.loads(p.read_text(encoding="utf-8"))["words"]:
        out.add((canonical(w["dict"] if w["pos"] != "V" else w["parts"]), w["pos"]))
    return out


def bank_of(margin_words: list[str], c: int, text: ChapterText, lex: Lex, lem: bv.Lemmatiser,
            cleaner: rs.Cleaner) -> tuple[set[tuple[str, str]], dict[str, list[str]], list[str]]:
    """→ (bank lemma keys, chapter forms of those lemmas → [lemma], the cleaned margin list)."""
    lemmas = set()
    cleaned = []
    for w in margin_words:
        cw, ok = cleaner.word(w)
        cw = cw.strip("?!.,;:")
        ents = [e for e in lem.entries(cw) if bv.usable(e) or bv.is_proper_entry(e)]
        if not ents:
            for depth in (1, 2):
                found = None
                for v in em._variants(em.skeleton(cw), depth, rs.GARBLES):
                    ents = [e for e in lem.entries(v) if bv.usable(e)]
                    if ents:
                        found = v
                        break
                if found:
                    break
        if ents:
            e = ents[0]
            lemmas.add(bv.lemma_key(e))
            cleaned.append(e["lemma"].split(",")[0].split()[0])
    # the vocab deck's lemma keys are (canonical dict/parts, pos); map through the entries
    deck = vocab_lemmas(c)
    for k, forms in text.uni.items():
        e = text.lem_entry(k)
        if e is None:
            continue
        lk = bv.lemma_key(e)
        if lk in lemmas:
            continue
        d, parts = bv.dict_form(e)
        dk = (canonical(parts if e["pos"] in ("V", "VPAR") else d), "V" if e["pos"] == "VPAR" else e["pos"])
        if dk in deck:
            lemmas.add(lk)
    forms: dict[str, list[str]] = {}
    for k, cnt in text.uni.items():
        e = text.lem_entry(k)
        if e is None or bv.lemma_key(e) not in lemmas:
            continue
        form = cnt.most_common(1)[0][0]
        f = form if form[:1].isupper() and bv.is_proper_entry(e) else form.lower()
        forms[f] = [bv.lemma_key(e)[0]]
    return lemmas, forms, cleaned


def fill_banks(items: list[dict], lex: Lex, c: int) -> None:
    pool = sorted({a for it in items for b in it["blanks"] for a in b["answers"] if not b.get("unverified")})
    rnd = random.Random(c)

    def pos_of(f: str) -> str:
        ents = lex.entries_of(f)
        return ents[0]["pos"] if ents else ""

    for it in items:
        for b in it["blanks"]:
            if not b["answers"]:
                b["bank"] = []
                continue
            ans = b["answers"][0]
            same = [f for f in pool if f not in b["answers"] and pos_of(f) == pos_of(ans)]
            other = [f for f in pool if f not in b["answers"] and f not in same]
            rnd.shuffle(same)
            rnd.shuffle(other)
            b["bank"] = sorted(set([ans] + (same + other)[:7]), key=lambda f: strip_macrons(f).lower())


def build_chapter(c: int, pdf, pages: list[int], lex: Lex, lem: bv.Lemmatiser, cleaner: rs.Cleaner,
                  library: dict[int, list[dict]], library_forms: dict[str, Counter], dump: bool = False) -> dict:
    rep: dict = {"chapter": c, "pages": [], "headings": [], "items": {}, "resolved": {}, "unverified": {},
                 "blanks": {}, "blanks_resolved": {}, "unreadable": Counter(), "lost_dashes": 0, "notes": [], "bank": 0}
    heads = headings(pdf, pages)
    if not heads:
        rep["notes"].append("no PENSVM heading found")
        return {"chapter": c, "A": [], "B": [], "C": [], "bank": [], "report": rep}
    rep["headings"] = [(p, k) for p, _, k in sorted(heads)]
    first_page = min(p for p, _, _ in heads)
    pensa_pages = [p for p in pages if p >= first_page]
    rep["pages"] = pensa_pages
    sides = {p: page_side(pdf.pages[p - 1], p) for p in pensa_pages}
    blocks = block_rows(pdf, pensa_pages, heads, sides)
    units = chapter_units(library, c)
    text = ChapterText(units, lem)
    # the margin's Vocābula list: from the row reading "Vocābula" on, then every later pensa page
    margin: list[str] = []
    started = None
    for p in pensa_pages:
        pg = em.classify_page(pdf.pages[p - 1], p, "FR")
        top = None
        for r in pg["margin"]:
            if re.match(r"^V[oō]c[āa]b", r.text) and started is None:
                started = p
                top = r.top
        if started == p:
            margin += margin_vocab(pdf.pages[p - 1], p, top)[1:]
        elif started is not None and p > started:
            margin += margin_vocab(pdf.pages[p - 1], p, None)
    if started is None:
        rep["notes"].append("no 'Vocābula:' list found in the margin — the bank is the vocab deck alone")
    out = {"chapter": c, "A": [], "B": [], "C": [], "bank": [], "report": rep}
    bank_lemmas, bank_forms, bank_list = bank_of(margin, c, text, lex, lem, cleaner)
    out["bank"] = bank_list
    rep["bank"] = len(bank_lemmas)
    ukeys = unit_keys(units, lem)
    gen_bank = generated_bank_candidates(bank_lemmas, lex, list(bank_forms.keys()))
    chapter_lemmas = set(bank_lemmas)
    for k in text.uni:
        e = text.lem_entry(k)
        if e is not None:
            try:
                chapter_lemmas.add(bv.lemma_key(e))
            except Exception:
                pass
    gen_index = chapter_form_index(lex, chapter_lemmas)
    for kind in ("A", "B", "C"):
        rows = blocks.get(kind, [])
        if dump:
            print(f"--- Pensum {kind}: {len(rows)} rows")
            for r in rows:
                print(f"   p{r.page} y{r.top:.0f} x{r.x0:.0f}: {r.text}")
        toks = row_tokens(rows, kind, lex, cleaner, dump=dump)
        rep["lost_dashes"] += sum(1 for t in toks if t.blank == "A" and not re.search(f"[{DASHES}]", t.raw))
        for t in toks:
            if not t.ok:
                rep["unreadable"][t.raw] += 1
        sents = sentences_of(toks, kind)
        if kind == "C":
            items = build_c(sents, units, ukeys, lex, lem)
        else:
            keep = [sent for sent in sents
                    if any(t.blank for t in sent) or _WORD.search(render_text(sent))]
            items = [resolve_sentence(sent, kind, text, lex, library_forms, bank_lemmas,
                                      bank_forms, gen_bank, chapter_lemmas, gen_index)
                     for sent in keep]
            if kind == "B":
                fill_banks(items, lex, c)
        out[kind] = items
        rep["items"][kind] = len(items)
        rep["unverified"][kind] = sum(1 for it in items if it.get("unverified"))
        rep["resolved"][kind] = len(items) - rep["unverified"][kind]
        if kind != "C":
            rep["blanks"][kind] = sum(len(it["blanks"]) for it in items)
            rep["blanks_resolved"][kind] = sum(1 for it in items for b in it["blanks"] if not b.get("unverified"))
    return out


# ------------------------------------------------------------------ SQL, check, report

def write_sql(c: int, data: dict) -> Path:
    SQL_DIR.mkdir(parents=True, exist_ok=True)
    path = SQL_DIR / f"p{c:02d}.sql"
    stmts = []
    for kind in ("A", "B", "C"):
        items = [{k: v for k, v in it.items() if k != "unreadable"} for it in data[kind]]
        stmts.append(
            f"insert into public.pensa (user_id, chapter, kind, items)\nvalues ({seed_sql.USER}, {c}, {seed_sql.q(kind)}, {seed_sql.q(items)})\n"
            "on conflict (user_id, chapter, kind) do update set items = excluded.items, updated_at = now();\n")
    path.write_text("".join(stmts), encoding="utf-8")
    return path


def check(library: dict[int, list[dict]] | None = None) -> list[str]:
    errs: list[str] = []
    if library is None:
        library = bv.library_units()
    unit_ids = {u["id"] for us in library.values() for u in us}
    for c in CHAPTERS:
        path = BUILD / f"pensa-{c:02d}.json"
        if not path.exists():
            errs.append(f"{path.name}: missing")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            errs.append(f"{path.name}: invalid JSON ({e})")
            continue
        if data.get("chapter") != c:
            errs.append(f"{path.name}: chapter {data.get('chapter')}")
        for kind in ("A", "B", "C"):
            items = data.get(kind)
            if not isinstance(items, list):
                errs.append(f"{path.name}: {kind} missing")
                continue
            if not items:
                errs.append(f"{path.name}: Pensum {kind} has no items")
            for n, it in enumerate(items):
                tag = f"{path.name} {kind}[{n}]"
                if kind == "C":
                    if not it.get("q") or not isinstance(it.get("answers"), list):
                        errs.append(f"{tag}: q / answers")
                    if it.get("unit_id") is not None and it["unit_id"] not in unit_ids:
                        errs.append(f"{tag}: unit_id {it['unit_id']} not in the library")
                    if it.get("unit_id") is None and not it.get("unverified"):
                        errs.append(f"{tag}: no unit and not unverified")
                    continue
                if not it.get("text") or not isinstance(it.get("blanks"), list):
                    errs.append(f"{tag}: text / blanks")
                    continue
                n_marks = len(re.findall(r"___|_", it["text"]))   # a whole word, or an ending after its stem
                if n_marks != len(it["blanks"]):
                    errs.append(f"{tag}: {n_marks} blank marks for {len(it['blanks'])} blanks: {it['text'][:60]}")
                for bi, b in enumerate(it["blanks"]):
                    if b.get("i") != bi or not isinstance(b.get("answers"), list):
                        errs.append(f"{tag}: blank {bi} shape")
                    if kind == "A" and "stem" not in b:
                        errs.append(f"{tag}: blank {bi} lacks stem")
                    if kind == "B" and not isinstance(b.get("bank"), list):
                        errs.append(f"{tag}: blank {bi} lacks bank")
                    if not b["answers"] and not b.get("unverified"):
                        errs.append(f"{tag}: blank {bi} has no answers and is not unverified")
                    if b.get("unverified") and not it.get("unverified"):
                        errs.append(f"{tag}: blank {bi} unverified but the item is not")
        sql = SQL_DIR / f"p{c:02d}.sql"
        if not sql.exists():
            errs.append(f"{sql.name}: missing")
        else:
            s = sql.read_text(encoding="utf-8")
            if s.count("insert into public.pensa") != 3 or s.count("on conflict (user_id, chapter, kind)") != 3:
                errs.append(f"{sql.name}: expected three upserts")
            for kind in ("A", "B", "C"):
                m = re.search(rf"values \({re.escape(seed_sql.USER)}, {c}, '{kind}', '(.*?)'::jsonb\)", s, re.S)
                if not m:
                    errs.append(f"{sql.name}: no row for kind {kind}")
                    continue
                try:
                    items = json.loads(m.group(1).replace("''", "'"))
                except ValueError as e:
                    errs.append(f"{sql.name}: kind {kind} jsonb does not parse ({e})")
                    continue
                if len(items) != len(data[kind]):
                    errs.append(f"{sql.name}: kind {kind} has {len(items)} items, the JSON {len(data[kind])}")
    return errs


def report_section(rep: dict, errs: list[str]) -> str:
    c = rep["chapter"]
    L = [f"## Chapter {ROMAN[c - 1]} (p{c:02d})\n"]
    L.append(f"- pages {rep['pages']}; headings {rep['headings']}; word bank: {rep['bank']} lemmas")
    for k in ("A", "B", "C"):
        n = rep["items"].get(k, 0)
        line = f"- Pensum {k}: {n} items, {rep['resolved'].get(k, 0)} resolved, {rep['unverified'].get(k, 0)} unverified"
        if k in rep["blanks"]:
            line += f"; blanks {rep['blanks_resolved'][k]}/{rep['blanks'][k]} resolved"
        L.append(line)
    L.append(f"- text-layer damage: {sum(rep['unreadable'].values())} unreadable tokens, {rep['lost_dashes']} blank dashes lost by the text layer")
    if rep["unreadable"]:
        L.append("  - unreadable: " + ", ".join(f"{t}×{n}" if n > 1 else t for t, n in rep["unreadable"].most_common(40)))
    for n in rep["notes"]:
        L.append(f"- note: {n}")
    if errs:
        L.append(f"- VALIDATION: {len(errs)} problem(s)")
        L += [f"  - {e}" for e in errs]
    L.append("")
    return "\n".join(L) + "\n"


def update_report(key: str, section: str) -> None:
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    body = REPORT.read_text(encoding="utf-8") if REPORT.exists() else "# Pensa — Familia Romana I–XXXIV extraction report\n\n"
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    REPORT.write_text(body, encoding="utf-8")


def library_form_index(library: dict[int, list[dict]]) -> dict[str, Counter]:
    out: dict[str, Counter] = defaultdict(Counter)
    for units in library.values():
        for u in units:
            for t in _WORD.findall(u["la"]):
                out[em.skeleton(t)][t] += 1
    return out


# ------------------------------------------------------------------ main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chapters", nargs="*", type=int, help="chapter numbers 1–34 (default all)")
    ap.add_argument("--check", action="store_true", help="validate data/build/pensa-NN.json and sql/pNN.sql only")
    ap.add_argument("--dump", action="store_true", help="print rows and tokens")
    ap.add_argument("--render", type=Path, help="render the chapters' pensa pages to PNG in this directory")
    a = ap.parse_args(argv)
    library = bv.library_units()
    if a.check:
        errs = check(library)
        for e in errs:
            print("ERROR", e)
        print("pensa: OK" if not errs else f"pensa: {len(errs)} problem(s)")
        return 1 if errs else 0
    chapters = a.chapters or list(CHAPTERS)
    bad = [c for c in chapters if c not in CHAPTERS]
    if bad:
        ap.error(f"chapters must be 1–34: {bad}")
    import pdfplumber
    pdf = pdfplumber.open(str(SCAN))
    lexicon = em.build_lexicon(ROOT, {"FR": pdf}, BUILD / "margins-lexicon.json", quiet=True)
    glossary = json.loads(bv.GLOSSARY.read_text(encoding="utf-8"))
    lem = bv.Lemmatiser(glossary)
    lex = Lex(glossary, lem.cache, lexicon)
    cap_cache = BUILD / "pensa-capital-i.json"
    if cap_cache.exists():
        extra = {k: Counter(v) for k, v in json.loads(cap_cache.read_text(encoding="utf-8")).items()}
    else:
        extra = rs.capital_i_forms(pdf)
        cap_cache.write_text(json.dumps({k: dict(v) for k, v in extra.items()}, ensure_ascii=False), encoding="utf-8")
    cleaner = rs.Cleaner(lexicon, extra, rs.trusted_forms(ROOT))
    pages = chapter_pages(pdf)
    library_forms = library_form_index(library)
    rc = 0
    for c in chapters:
        data = build_chapter(c, pdf, pages[c], lex, lem, cleaner, library, library_forms, dump=a.dump)
        rep = data.pop("report")
        path = BUILD / f"pensa-{c:02d}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        write_sql(c, data)
        errs = [e for e in check_one(c, data, library)]
        update_report(f"pensa:p{c:02d}", report_section(rep, errs))
        if errs:
            rc = 1
        print(f"cap. {ROMAN[c - 1]:>6} (p{c:02d}): pages {rep['pages'][0] if rep['pages'] else '?'}–{rep['pages'][-1] if rep['pages'] else '?'}; "
              + "; ".join(f"{k} {rep['items'].get(k, 0)} items ({rep['unverified'].get(k, 0)} unverified"
                          + (f", blanks {rep['blanks_resolved'][k]}/{rep['blanks'][k]}" if k in rep["blanks"] else "") + ")"
                          for k in "ABC")
              + f"; unreadable {sum(rep['unreadable'].values())}, lost dashes {rep['lost_dashes']}"
              + (f"; {len(errs)} VALIDATION ERRORS" if errs else ""))
        if a.render and rep["pages"]:
            files = rs.render_pages(SCAN, rep["pages"], a.render / f"cap-{c:02d}")
            print(f"   rendered {len(files)} pages → {a.render / f'cap-{c:02d}'}")
    lem.save()
    return rc


def check_one(c: int, data: dict, library: dict[int, list[dict]]) -> list[str]:
    """The --check rules for one freshly built chapter (JSON + SQL already written)."""
    saved = [x for x in CHAPTERS if x != c]
    errs = []
    for e in check(library):
        if e.startswith(f"pensa-{c:02d}.json") or e.startswith(f"p{c:02d}.sql"):
            errs.append(e)
    del saved
    return errs


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
