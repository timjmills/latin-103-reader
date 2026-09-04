#!/usr/bin/env python
"""
extract_margins.py — pull the printed line numbers and the marginal glosses of
each week's reading out of the textbook scans, using page layout (pdfplumber
word coordinates), not text guessing.

    python pipeline/extract_margins.py              # all weeks 1–14
    python pipeline/extract_margins.py 1 3          # selected weeks
    python pipeline/extract_margins.py 1 --dump     # also print every page's rows (debug)

Inputs
  scans/familia-romana.pdf     Ørberg, Familia Romana (FR)  — cap. XXV–XXXIV
  scans/fabulae-syrae.pdf      Miraglia, Fabulae Syrae (FS) — cap. XXVII, XXVIII, XXXII
  scans/fabellae-latinae.pdf   Ørberg, Fabellae Latinae (FL) — stories 63–74
  source/week-NN.md            the week's Latin text (used to give every printed
                               line its clean, macronised wording and to build
                               the macron lexicon that repairs the FS text layer)
  pipeline/weeks.py            which chapter / stories each week reads

Outputs (data/build/)
  lines-week-NN.json    [{line, text, page, part}]  one entry per printed line of
                        the reading (FR/FS; FL has no line numbers) — `text` is
                        the whole printed line, taken from the source markdown
                        where the scan aligns with it, otherwise the raw OCR.
  margin-week-NN.json   [{line, la}] in reading order; FL entries carry
                        line: null and "anchor": first words of the main-text
                        line the gloss belongs to.
  margins-REPORT.md     per week: pages used, counts, everything uncertain.

Layout model (see the docstring of `classify_page`)
  FR / FS print the text in one main column; every 5th line carries its number
  in the outer margin and the glosses stand in the outer margin on the other
  side.  Recto pages: numbers left, glosses right; verso: glosses left, numbers
  right.  The side is read off the page from where the line numbers are.
  Gloss rows start flush with the margin column; wrapped continuation rows are
  indented a few points — that indent is what joins a multi-row gloss.
  FL (this edition) has no marginal glosses at all; the only apparatus is an
  occasional bracketed note printed under a story, which is kept with a text
  anchor instead of a line number.

Cleaning
  Ørberg's conventions are kept ("=", ":", "↔", "-ōrum n pl", "<").  The text
  layer of the FS scan has lost most macrons and garbles letters (ī→I/l, ū→ii,
  ō→6, m→rn, Ō→G/"0); every gloss token is looked up, through a small set of
  OCR-confusion rules, in a lexicon of macronised forms built from the source
  markdown of all weeks, the FR text layer (clean) and the FL text layer.  A
  token that cannot be matched is kept as printed and listed in the report —
  nothing is invented.
"""
from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import weeks as weeks_mod  # noqa: E402

SCANS = {"FR": "familia-romana.pdf", "FS": "fabulae-syrae.pdf", "FL": "fabellae-latinae.pdf"}

# --------------------------------------------------------------------------- text utils

SOFT_HYPHEN = "­"
LETTERS = "A-Za-zÀ-ɏ"
_LET_RE = re.compile(f"[{LETTERS}]")


def strip_macrons(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def skeleton(tok: str) -> str:
    """Matching key: macron-free, lower-case, letters only (hyphen kept inside)."""
    t = strip_macrons(tok).lower()
    t = re.sub(r"[^a-z\-]", "", t)
    return t.strip("-")


def has_letters(s: str) -> bool:
    return bool(_LET_RE.search(s))


ROMAN = {"XXV": 25, "XXVI": 26, "XXVII": 27, "XXVIII": 28, "XXIX": 29, "XXX": 30, "XXXI": 31,
         "XXXII": 32, "XXXIII": 33, "XXXIV": 34, "XXXV": 35}


# --------------------------------------------------------------------------- page geometry

# x-ranges (points) of the three columns for each source and page side.
GEOM = {
    "FR": {
        "recto": {"num": (0, 52), "main": (52, 316), "margin": (318, 9999)},
        "verso": {"margin": (0, 132), "main": (132, 394), "num": (394, 9999)},
        "head_y": 45, "foot_y": 50, "main_size": (9.3, 14.0), "margin_size": (7.0, 9.3),
        "row_tol": 3.5, "cont_indent": 2.6, "cont_max": 12,
    },
    "FS": {
        "recto": {"num": (0, 42), "main": (42, 366), "margin": (368, 9999)},
        "verso": {"margin": (0, 198), "main": (198, 526), "num": (526, 9999)},
        "head_y": 40, "foot_y": 60, "main_size": (7.9, 12.0), "margin_size": (6.5, 8.2),
        "row_tol": 3.5, "cont_indent": 3.0, "cont_max": 12,
    },
    "FL": {
        "recto": {"num": (0, 0), "main": (60, 540), "margin": (9999, 9999)},
        "verso": {"num": (0, 0), "main": (60, 540), "margin": (9999, 9999)},
        "head_y": 40, "foot_y": 60, "main_size": (10.0, 14.0), "margin_size": (0, 0),
        "row_tol": 3.5, "cont_indent": 3.0, "cont_max": 12,
    },
}


class Row:
    __slots__ = ("top", "bottom", "x0", "x1", "words", "line_no", "anchor", "page", "conf")

    def __init__(self, page, words):
        ws = sorted(words, key=lambda w: w["x0"])
        self.page = page
        self.words = ws
        self.top = min(w["top"] for w in ws)
        self.bottom = max(w["bottom"] for w in ws)
        self.x0 = ws[0]["x0"]
        self.x1 = ws[-1]["x1"]
        self.line_no: int | None = None
        self.anchor: int | None = None
        self.conf = "none"

    @property
    def text(self) -> str:
        return " ".join(w["text"] for w in self.words)

    @property
    def mid(self) -> float:
        return (self.top + self.bottom) / 2

    def __repr__(self):
        return f"Row(p{self.page} y{self.top:.0f} x{self.x0:.0f} {self.text[:50]!r})"


def group_rows(page_no: int, words: list[dict], tol: float) -> list[Row]:
    rows: list[Row] = []
    cur: list[dict] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if cur and w["top"] - cur[0]["top"] > tol:
            rows.append(Row(page_no, cur))
            cur = []
        cur.append(w)
    if cur:
        rows.append(Row(page_no, cur))
    return rows


def _merge_digit_words(words: list[dict]) -> list[dict]:
    """OCR sometimes splits '35' into '3' '5'; glue digit-only neighbours."""
    out: list[dict] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if out and w["text"].isdigit() and out[-1]["text"].isdigit() and abs(w["top"] - out[-1]["top"]) < 3 \
                and 0 <= w["x0"] - out[-1]["x1"] < 4:
            p = out[-1]
            out[-1] = {**p, "text": p["text"] + w["text"], "x1": w["x1"]}
        else:
            out.append(w)
    return out


def classify_page(page, page_no: int, src: str) -> dict:
    """Split one page's words into main-text rows, gloss rows and line numbers.

    Line-number candidates are digit-only words in the outer 55pt of the page;
    the side they sit on decides recto/verso and therefore where the main
    column and the gloss column are.  Header / footer zones are dropped, so are
    running heads, all-caps titles, drop caps (their letter is glued back onto
    the first row) and picture noise (tokens without letters).
    """
    g = GEOM[src]
    W, H = page.width, page.height
    words = page.extract_words(x_tolerance=1.0, y_tolerance=2, extra_attrs=["size"])
    words = _merge_digit_words(words)
    body = [w for w in words if g["head_y"] < w["top"] < H - g["foot_y"]]
    nums_left = [w for w in body if w["text"].isdigit() and w["x1"] < 55 and int(w["text"]) % 5 == 0]
    nums_right = [w for w in body if w["text"].isdigit() and w["x0"] > W - 55 and int(w["text"]) % 5 == 0]
    if src == "FL":
        side = "recto"
    elif len(nums_left) > len(nums_right):
        side = "recto"
    elif nums_right:
        side = "verso"
    else:
        # no line numbers on this page: guess from where the small words are
        small = [w for w in body if g["margin_size"][0] <= w["size"] < g["margin_size"][1]]
        med = sorted(w["x0"] for w in small)[len(small) // 2] if small else W
        side = "recto" if med > W / 2 else "verso"
    col = g[side]

    def in_col(w, name):
        a, b = col[name]
        return a <= w["x0"] < b

    main_w, margin_w, num_w, dropcaps, brackets = [], [], [], [], []
    for w in body:
        t = w["text"]
        if in_col(w, "num") and t.isdigit():
            num_w.append(w)
        elif in_col(w, "main"):
            if w["size"] > 18 and len(t) == 1:
                dropcaps.append(w)
            elif src == "FL" and w["size"] < g["main_size"][0]:
                brackets.append(w)
            elif g["main_size"][0] <= w["size"] <= g["main_size"][1] and (has_letters(t) or (src == "FL" and t in ("=", "↔"))):
                main_w.append(w)
            elif src == "FS" and has_letters(t) and w["size"] < g["main_size"][1]:
                main_w.append(w)  # FS main and gloss sizes are close; the column decides
            elif has_letters(t) and w["size"] < g["main_size"][0] and src == "FR":
                margin_w.append(w)  # small print inside the text column (picture labels)
        elif in_col(w, "margin"):
            if w["size"] < g["main_size"][0] + 0.4 and (has_letters(t) or all(c in "=+<>↔:;/()-►—" for c in t)) and "�" not in t:
                margin_w.append(w)
    main_rows = group_rows(page_no, main_w, g["row_tol"])
    if src == "FL":
        # a bracketed note under a story ("[dē-mittere; im-pendēre = suprā stāre]") is apparatus, not text
        note_rows, keep = [], []
        open_note = False
        for r in main_rows:
            if r.text.startswith("[") or open_note:
                note_rows.append(r)
                open_note = "]" not in r.text
            else:
                keep.append(r)
        main_rows = keep
        for r in note_rows:
            brackets += r.words
    # drop all-caps titles / running heads / stray fragments
    keep = []
    for r in main_rows:
        letters = re.sub(f"[^{LETTERS}]", "", r.text)
        if len(letters) < 2:
            continue
        if letters.isupper() and len(r.words) <= 3:
            continue  # chapter title (inscriptions quoted in the text are longer)
        keep.append(r)
    main_rows = keep
    for d in dropcaps:
        # glue the drop cap onto the first main row that starts at its right and overlaps it vertically
        cands = [r for r in main_rows if r.x0 > d["x0"] + 8 and abs(r.top - d["top"]) < 40]
        if cands:
            r = min(cands, key=lambda r: r.top)
            r.words[0] = {**r.words[0], "text": d["text"] + r.words[0]["text"]}
    keep = []
    col_left = min((r.x0 for r in main_rows), default=0)
    for r in main_rows:
        junk = sum(1 for c in r.text if not (c.isalpha() or c.isspace() or c in ".,;:!?\"'()-" + SOFT_HYPHEN))
        if junk > 0.2 * max(1, len(r.text)):
            continue  # picture caption / OCR noise
        if len(r.words) <= 2 and r.x0 > col_left + 40:
            continue  # a one/two-word label floating inside the column: picture caption
        keep.append(r)
    main_rows = keep
    # a short row isolated vertically from every other row (a map or picture label)
    if len(main_rows) >= 3:
        pitches = sorted(b.top - a.top for a, b in zip(main_rows, main_rows[1:]))
        pitch = pitches[len(pitches) // 2]
        keep = []
        for k, r in enumerate(main_rows):
            gap_prev = r.top - main_rows[k - 1].top if k > 0 else 9999
            gap_next = main_rows[k + 1].top - r.top if k + 1 < len(main_rows) else 9999
            if len(r.words) <= 2 and gap_prev > 1.8 * pitch and gap_next > 1.8 * pitch:
                continue
            keep.append(r)
        main_rows = keep
    margin_rows = group_rows(page_no, margin_w, g["row_tol"])
    # an arrow (↔) is often placed on its own row by the OCR: put it back into the
    # gloss row it belongs to, at its x position
    lettered = [r for r in margin_rows if has_letters(r.text)]
    for r in margin_rows:
        if has_letters(r.text) or not lettered:
            continue
        near = min(lettered, key=lambda q: abs(q.top - r.top))
        if abs(near.top - r.top) <= 9:
            for w in r.words:
                if not any(abs(q["x0"] - w["x0"]) < 3 for q in near.words):
                    near.words.append(w)
            near.words.sort(key=lambda w: w["x0"])
    margin_rows = lettered
    bracket_rows = group_rows(page_no, brackets, g["row_tol"])
    nums = []
    for w in num_w:
        n = int(w["text"])
        if n % 5 == 0 and 0 < n < 400:
            nums.append((w["top"], w["bottom"], n))
    return {"page": page_no, "side": side, "main": main_rows, "margin": margin_rows,
            "nums": nums, "brackets": bracket_rows, "width": W, "height": H}


# --------------------------------------------------------------------------- line numbering

def number_rows(pages: list[dict], notes: list[str]) -> None:
    """Assign textbook line numbers to every main row from the margin numbers.

    Each printed number is tied to the main row nearest to it vertically; rows
    between anchors count up from the previous anchor.  Pages without any
    anchor continue from the previous page ("low" confidence).  Spacing checks
    (5 printed lines between numbers 5 apart) are reported as notes.
    """
    prev_last: int | None = None
    last_anchor = 0
    for pg in pages:
        rows = pg["main"]
        for r in rows:
            r.anchor = None
        for top, bottom, n in sorted(pg["nums"]):
            mid = (top + bottom) / 2
            if not rows:
                break
            r = min(rows, key=lambda r: abs(r.mid - mid))
            if abs(r.mid - mid) > 9:
                notes.append(f"p{pg['page']}: margin number {n} has no text row within 9pt (nearest {abs(r.mid - mid):.0f}pt) — ignored")
                continue
            if not (last_anchor < n <= last_anchor + 60):
                notes.append(f"p{pg['page']}: number {n} out of sequence after {last_anchor} — ignored")
                continue
            if r.anchor is not None:
                notes.append(f"p{pg['page']}: two numbers ({r.anchor}, {n}) on one row {r.text[:30]!r}")
                continue
            r.anchor = n
            last_anchor = n
        anchors = [(k, r.anchor) for k, r in enumerate(rows) if r.anchor is not None]
        if anchors:
            for (k1, n1), (k2, n2) in zip(anchors, anchors[1:]):
                if (k2 - k1) != (n2 - n1):
                    notes.append(f"p{pg['page']}: {k2 - k1} text rows between numbers {n1} and {n2} (expected {n2 - n1}) — "
                                 f"rows there are approximate")
            if prev_last is not None:
                k0, n0 = anchors[0]
                if prev_last + 1 + k0 != n0:
                    notes.append(f"p{pg['page']}: continuation from previous page predicted {prev_last + 1 + k0} at number {n0}; "
                                 f"re-anchored (off by {n0 - (prev_last + 1 + k0)})")
            for k, r in enumerate(rows):
                before = [(ka, na) for ka, na in anchors if ka <= k]
                ka, na = before[-1] if before else anchors[0]
                r.line_no = na + (k - ka)
                r.conf = "high" if abs(k - ka) <= 5 else "medium"
        elif rows:
            if len(rows) < 5:
                notes.append(f"p{pg['page']}: no margin numbers and only {len(rows)} text row(s) — treated as an illustration page, skipped")
                pg["main"] = []
                continue
            if prev_last is None:
                notes.append(f"p{pg['page']}: no margin numbers and nothing before it — rows unnumbered")
                continue
            for k, r in enumerate(rows):
                r.line_no = prev_last + 1 + k
                r.conf = "low"
        if rows and rows[-1].line_no is not None:
            prev_last = rows[-1].line_no


# --------------------------------------------------------------------------- glosses

def assemble_glosses(pg: dict, src: str, notes: list[str]) -> list[dict]:
    """Join margin rows into glosses using the continuation indent. → [{rows, top, raw}]"""
    g = GEOM[src]
    rows = [r for r in pg["margin"] if has_letters(r.text)]
    if not rows:
        return []
    # The gloss column's left edge is the most common x0; scans are slightly
    # skewed, so each row is judged against the previous start row rather than
    # against one fixed edge.  A row indented by more than cont_indent (and less
    # than cont_max) continues the gloss above it; anything further right is a
    # picture caption.
    left = float(Counter(round(r.x0) for r in rows).most_common(1)[0][0])
    out: list[dict] = []
    ref = left
    for r in sorted(rows, key=lambda r: r.top):
        d = r.x0 - ref
        if -8 < d < -3:
            notes.append(f"p{pg['page']}: margin row left of the gloss column (x={r.x0:.0f}, column {ref:.0f}) kept as a gloss: {r.text[:40]!r}")
            d = 0
        if abs(r.x0 - left) > g["cont_max"] + 4:
            notes.append(f"p{pg['page']}: dropped margin text at x={r.x0:.0f} (picture caption?): {r.text[:40]!r}")
            continue
        if d <= g["cont_indent"]:
            out.append({"rows": [r], "top": r.top, "page": pg["page"]})
            ref = r.x0
        elif d <= g["cont_max"] and out:
            out[-1]["rows"].append(r)
        else:
            notes.append(f"p{pg['page']}: dropped margin text at x={r.x0:.0f} (picture caption?): {r.text[:40]!r}")
    for gl in out:
        gl["raw"] = join_rows(gl["rows"])
    return out


def join_rows(rows: list[Row]) -> str:
    text = ""
    for r in rows:
        t = r.text.strip()
        if not text:
            text = t
        elif text.endswith(SOFT_HYPHEN):
            text = text[:-1] + t
        elif text.endswith("-") and t[:1].islower():
            text = text + t  # Ørberg's compound hyphen at a row end: keep it, no space
        else:
            text = text + " " + t
    return text.replace(SOFT_HYPHEN, "")


# ---- token-level cleaning

ABBREV = {"m", "f", "n", "pl", "sg", "dat", "abl", "acc", "gen", "nom", "voc", "adv", "prp", "coni",
          "indēcl", "indecl", "sup", "comp", "perf", "fut", "inf", "pass", "dēp", "dep", "part", "gerund",
          "adi", "num", "interi", "cf", "v", "vōc", "loc", "sing", "plūr", "plur", "i", "ii", "iii", "iv",
          "sīve", "sive", "vel", "aut", "et", "ut", "nē", "ne", "ab", "ad", "ex", "in", "cum", "dē", "de",
          "ā", "a", "ē", "e", "ō", "o", "sē", "se", "tē", "te", "mē", "me", "quī", "quae", "quod", "id", "is", "ea",
          "sub", "per", "prō", "pro", "trāns", "trans", "ob", "inter", "post", "ante", "sine", "circum"}

TOKEN_FIXES = [
    (re.compile(r"^-I([mnf])$"), lambda m: "-ī " + m.group(1)),      # -Im → -ī m
    (re.compile(r"^-i([mnf])$"), lambda m: "-ī " + m.group(1)),
    (re.compile(r"^-ī([mnf])$"), lambda m: "-ī " + m.group(1)),
    (re.compile(r"^-I$"), lambda m: "-ī"),
    (re.compile(r"^([mnf])pl$"), lambda m: m.group(1) + " pl"),      # npl → n pl
    (re.compile(r"^(<-+►|<-+>|<—>|<→|\+-+>|<-\+|\+-->|«-»|↔)$"), lambda m: "↔"),
]

# OCR confusions: (pattern in the OCR skeleton, replacement). Applied one or two at a time.
# OCR confusions (pattern in the skeleton → replacement).  SAFE ones are the
# scan's systematic macron/letter failures and may be tried on any token; RISKY
# ones only on tokens that carry visible junk (digits, stray symbols, ii, rn…).
SAFE_CONFUSIONS = [("ii", "u"), ("6", "o"), ("0", "o"), ("rn", "m"), ("l", "i"), ("1", "i"), ("!", "i"),
                   ("g", "o"), ("w", "u"), ("y", "s"), ("j", "i"), ("nn", "m")]
LETTER_CONFUSIONS = [("m", "rn"), ("i", "l"), ("f", "t"), ("t", "f"), ("r", "f"), ("c", "e"), ("e", "c"),
                     ("u", "n"), ("n", "u"), ("h", "b"), ("b", "h"), ("s", "f"), ("t", "i"), ("i", "t"),
                     ("t", "l"), ("l", "t")]
RISKY_CONFUSIONS = LETTER_CONFUSIONS + [("o", "a"), ("a", "o"), ("e", "o"), ("o", "e")]
PREFIXES = {"a", "ab", "abs", "ac", "ad", "af", "ag", "al", "ap", "ar", "as", "at", "circum", "com", "con", "cōn",
            "co", "col", "cor", "de", "dē", "di", "dis", "dif", "e", "ē", "ex", "ef", "in", "im", "il", "ir", "inter",
            "intro", "ob", "oc", "of", "op", "per", "prae", "pro", "prō", "prod", "prōd", "re", "red", "sub", "suc",
            "suf", "sup", "sur", "sus", "trans", "trāns", "quot", "bene", "male", "ante", "post", "super", "sē", "se",
            "satis", "ne", "nē", "non", "nōn", "semi", "prope", "praeter", "contra", "contrā", "extra", "extrā",
            "intra", "intrā", "ultra", "ultrā", "ne", "quī", "qui", "quae", "quod", "quam", "tam", "ali", "quis"}


def _variants(skel: str, depth: int, rules) -> set[str]:
    out = {skel}
    frontier = {skel}
    for _ in range(depth):
        nxt = set()
        for s in frontier:
            for a, b in rules:
                start = 0
                while True:
                    i = s.find(a, start)
                    if i < 0:
                        break
                    nxt.add(s[:i] + b + s[i + len(a):])
                    start = i + 1
        nxt -= out
        out |= nxt
        frontier = nxt
    return out


class Lexicon:
    """skeleton → Counter of macronised spellings seen in trusted text."""

    def __init__(self):
        self.forms: dict[str, Counter] = defaultdict(Counter)

    def add_text(self, text: str, weight: int = 1):
        for tok in re.findall(f"-?[{LETTERS}][{LETTERS}\\-]*", text):
            if len(tok) < 2 and not tok.startswith("-"):
                continue
            if SUSPICIOUS.search(tok) or SUSPICIOUS.search(strip_macrons(tok)):
                continue  # OCR-garbled spellings must not become "attested"
            key = skeleton(tok)
            if key:
                self.forms[key][tok.lower()] += weight

    def best(self, key: str) -> tuple[str | None, bool]:
        """→ (most frequent spelling, unambiguous?)"""
        c = self.forms.get(key)
        if not c:
            return None, False
        top = [(f, k) for f, k in c.most_common(3) if k >= 2]  # a single sighting proves nothing
        if not top:
            return None, False
        if len(top) == 1:
            return top[0][0], True
        (a, na), (b, nb) = top[0], top[1]
        return a, na >= 3 * nb or strip_macrons(a) != strip_macrons(b)

    def to_json(self):
        return {k: dict(v) for k, v in self.forms.items()}

    @classmethod
    def from_json(cls, d):
        lx = cls()
        for k, v in d.items():
            lx.forms[k] = Counter(v)
        return lx


SUSPICIOUS = re.compile(r"[0-9�^~*'!|]|[a-zāēīōū]I|^I[a-z]|-I$|[a-z]y$|w")
ENDINGS = "ae|ārum|ōrum|ōnis|oris|ōris|inis|is|ī|ūs|ium|ia|um|a|e|ēs|ei|eī|iō|ī m|ī n|ī f"


def fix_tokens(raw: str) -> list[str]:
    toks = raw.split()
    out: list[str] = []
    for t in toks:
        for rx, fn in TOKEN_FIXES:
            m = rx.match(t)
            if m:
                t = fn(m)
                break
        out.extend(t.split(" "))
    # "-ae /" → "-ae f": a lone slash after an ending is the italic f of the gender marker
    for i, t in enumerate(out):
        if t == "/" and i > 0 and re.match(r"^-[a-zāēīōū]+$", out[i - 1]):
            out[i] = "f"
        elif t.endswith("/") and re.match(r"^-[a-zāēīōū]+/$", t):
            out[i] = t[:-1]
            out.insert(i + 1, "f")
    return out


def macronise_token(tok: str, lex: Lexicon, src: str) -> tuple[str, str | None]:
    """→ (cleaned token, problem or None). Case and surrounding punctuation are preserved.

    FR / FL layers are mostly right: a printed spelling that the lexicon knows is
    kept; an unattested one is replaced by the attested spelling of the same
    skeleton (this restores lost macrons such as "fabula" → "fābula").  FS has
    lost nearly all macrons, so its tokens take the lexicon's most frequent
    spelling unless the printed one is itself common.  Tokens with visible OCR
    junk are repaired only through the confusion rules and otherwise left as
    printed and reported.
    """
    m = re.match(f"^([^{LETTERS}\\-]*)(-?[{LETTERS}][{LETTERS}0-9!\\-]*)([^{LETTERS}]*)$", tok)
    if not m:
        return tok, None
    pre, core, post = m.groups()
    low = core.lower()
    key = skeleton(core)
    # the key used for OCR-confusion variants keeps digits and '!' (they stand for letters)
    vkey = re.sub(r"[^a-z0-9!\-]", "", strip_macrons(core).lower()).strip("-")
    if not key:
        return tok, None
    suspicious = bool(SUSPICIOUS.search(core) or SUSPICIOUS.search(strip_macrons(core)))
    if low.strip("-") in ABBREV and not suspicious:
        return tok, None
    macroned = core != strip_macrons(core)

    def keep_case(new: str) -> str:
        if core.startswith("-") and not new.startswith("-"):
            new = "-" + new
        elif not core.startswith("-") and new.startswith("-"):
            new = new.lstrip("-")
        if core.lstrip("-")[:1].isupper():
            i = 1 if new.startswith("-") else 0
            new = new[:i] + new[i:i + 1].upper() + new[i + 1:]
        return new

    def attested(form_key: str, spelling: str) -> int:
        return lex.forms.get(form_key, {}).get(spelling, 0)

    if not suspicious:
        best, ok = lex.best(key)
        if best is not None:
            mine = attested(key, low)
            top = lex.forms[key][best]
            rivals = []
            weak = sum(lex.forms[key].values()) < 10
            for v in _variants(vkey, 1, SAFE_CONFUSIONS + (LETTER_CONFUSIONS if weak else [])):
                if v != key:
                    bv, _ = lex.best(v)
                    if bv is not None:
                        rivals.append((sum(lex.forms[v].values()), bv))
            if rivals:
                rivals.sort(reverse=True)
                if rivals[0][0] >= 10 * sum(lex.forms[key].values()):
                    return pre + keep_case(rivals[0][1]) + post, None
            if src in ("FR", "FL") and mine and mine < 3 and macroned is False:
                pass  # weakly attested printed spelling: fall through to the frequency rule below
            elif src in ("FR", "FL"):
                if mine or macroned:
                    return tok, None
                return pre + keep_case(best) + post, None
            # FS (and weakly attested FR/FL spellings)
            if mine * 4 >= top or (macroned and mine):
                return tok, None
            if ok or macroned:
                return pre + keep_case(best) + post, None
            return pre + keep_case(best) + post, f"ambiguous macrons for {core!r} → {best!r}"
        if src == "FL":
            return tok, None
        # "proficīscī-fectum": a full word glued to its principal-part ending
        if "-" in key and key.count("-") == 1:
            left_, right_ = key.split("-")
            if left_ not in PREFIXES and len(left_) >= 6 and lex.best(left_)[0] and sum(lex.forms[left_].values()) >= 6:
                bl = lex.best(left_)[0]
                br = lex.best(right_)[0] or right_
                return pre + keep_case(bl) + " -" + br.strip("-") + post, None
        # hyphenated compound: macronise the parts
        if "-" in key:
            outp, prob = [], None
            for part in key.split("-"):
                bp, _ = lex.best(part)
                if bp is None:
                    prob = f"unverified {core!r}"
                    outp.append(part)
                else:
                    outp.append(bp.strip("-"))
            return pre + keep_case("-".join(outp)) + post, prob
        # safe OCR confusions (macron vowels read as other glyphs)
        for depth in (1, 2):
            cands = []
            for v in _variants(vkey, depth, SAFE_CONFUSIONS):
                if v == key:
                    continue
                bv, _ = lex.best(v)
                if bv is not None:
                    cands.append((sum(lex.forms[v].values()), v, bv))
            if cands:
                cands.sort(reverse=True)
                if len(cands) > 1 and cands[0][0] < 2 * cands[1][0] and cands[0][2] != cands[1][2]:
                    return tok, f"OCR-garbled {core!r}: candidates {cands[0][2]!r} / {cands[1][2]!r} — left as printed"
                return pre + keep_case(cands[0][2]) + post, None
        # two words glued together ("magnalaus", "quamduo", "adfugiendum")
        if len(key) >= 6 and "-" not in key and not re.search(r"[/^~!|]", post):
            splits = []
            for i in range(2, len(key) - 1):
                a, b = key[:i], key[i:]
                fa, fb = lex.best(a)[0], lex.best(b)[0]
                if fa and fb:
                    na, nb = sum(lex.forms[a].values()), sum(lex.forms[b].values())
                    ok_pair = min(na, nb) >= 6 and (len(a) >= 4 or na >= 30) and (len(b) >= 4 or nb >= 30)
                    if a in PREFIXES and len(b) >= 5 and nb >= 3:
                        ok_pair = True  # "adnāvigandum" = ad nāvigandum
                    if macroned and src != "FS" and not (min(na, nb) >= 30 or a in PREFIXES):
                        ok_pair = False  # the print carries macrons: split only on very common words
                    if ok_pair and re.search(r"[aeiouy]", a) and re.search(r"[aeiouy]", b):
                        splits.append((min(na, nb), fa, fb))
            if splits:
                splits.sort(reverse=True)
                _, fa, fb = splits[0]
                return pre + keep_case(fa) + " " + fb.strip("-") + post, None
        # letter confusions (c/e, t/f, …): accepted only when they point at one word
        for depth in (1, 2):
            cands = []
            for v in _variants(vkey, depth, SAFE_CONFUSIONS + LETTER_CONFUSIONS):
                if v == key:
                    continue
                bv, _ = lex.best(v)
                if bv is not None:
                    cands.append((sum(lex.forms[v].values()), v, bv))
            if cands:
                cands.sort(reverse=True)
                if len(cands) == 1 or cands[0][0] >= 3 * cands[1][0]:
                    return pre + keep_case(cands[0][2]) + post, None
                return tok, f"OCR-garbled {core!r}: candidates {cands[0][2]!r} / {cands[1][2]!r} — left as printed"
        if macroned and src != "FS":
            return tok, f"unverified {core!r} (printed with macrons, not in lexicon)"
        return tok, f"unverified {core!r} (not in lexicon)"

    # suspicious: exact key (I → i etc.) and both rule sets
    cands = []
    seen = set()
    for depth, rules in ((0, []), (1, SAFE_CONFUSIONS), (2, SAFE_CONFUSIONS), (1, SAFE_CONFUSIONS + RISKY_CONFUSIONS)):
        for v in _variants(vkey, depth, rules) | ({key} if depth == 0 else set()):
            if v in seen:
                continue
            seen.add(v)
            bv, _ = lex.best(v)
            if bv is not None and lex.forms[v][bv] >= 2:
                cands.append((sum(lex.forms[v].values()), v, bv))
        if cands:
            break
    if cands:
        cands.sort(reverse=True)
        if len(cands) > 1 and cands[0][0] < 2 * cands[1][0] and cands[0][2] != cands[1][2]:
            return tok, f"OCR-garbled {core!r}: candidates {cands[0][2]!r} / {cands[1][2]!r} — left as printed"
        return pre + keep_case(cands[0][2]) + post, None
    return tok, f"OCR-garbled {core!r} — no lexicon match, left as printed"


def clean_glosses(raw: str, lex: Lexicon, src: str) -> list[tuple[str, list[str]]]:
    """Split a margin row on the '|' that Miraglia uses between two glosses, then clean each."""
    parts = re.split(r"\s(?:\||I|l)\s(?=[A-Za-zĀ-ū(-])", raw)
    return [clean_gloss(x, lex, src) for x in parts if x.strip()]


def clean_gloss(raw: str, lex: Lexicon, src: str) -> tuple[str, list[str]]:
    problems: list[str] = []
    raw = raw.replace("�", "").replace("’", "'").replace("‘", "'")
    raw = re.sub(r"[«<]-*[»►*>]|<-+►|<—>|\+-+>|<-\+|<->", " ↔ ", raw)
    # "Thēseus-Im", "glōria-ae/" : an ending glued to its headword by a hyphen
    raw = re.sub(rf"([{LETTERS}]{{3,}})-(I|ī|i)([mnf])(?![{LETTERS}])", r"\1 -ī \3", raw)
    raw = re.sub(rf"([{LETTERS}]{{3,}})-({ENDINGS})(?=[\s/,;:.)]|$)", r"\1 -\2", raw)
    raw = re.sub(rf"(^|\s)(-[{LETTERS}]{{3,}})-(?=[{LETTERS}])", r"\1\2 -", raw)
    # a stray slash after an ending is the italic gender marker: "-ae/" = "-ae f", "m//" = "m/f"
    raw = re.sub(r"\s*=\s*", " = ", raw)
    raw = re.sub(rf"([{LETTERS}])J([{LETTERS}])", r"\1/\2", raw)
    raw = re.sub(rf"(?<![{LETTERS}])m//(?=\s|$|[,;])", "m/f", raw)
    raw = re.sub(rf"([{LETTERS}]+)//(?=\s|$|[,;])", r"\1 m/f", raw)
    raw = re.sub(rf"(-[{LETTERS}]+|[{LETTERS}]{{3,}}is|[{LETTERS}]{{3,}}ae)/(?![{LETTERS}])", r"\1 f", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    toks = fix_tokens(raw)
    # a word broken by a stray space ("l ocus"): rejoin when the join is a known word
    joined = []
    i = 0
    while i < len(toks):
        t = toks[i]
        nxt = toks[i + 1] if i + 1 < len(toks) else None
        if nxt and t.isalpha() and nxt.isalpha() and t.lower() not in ABBREV and nxt.lower() not in ABBREV \
                and (len(t) == 1 or (not lex.best(skeleton(t))[0] and not lex.best(skeleton(nxt))[0])) \
                and lex.best(skeleton(t + nxt))[0] and sum(lex.forms[skeleton(t + nxt)].values()) >= 3:
            joined.append(t + nxt)
            i += 2
        else:
            joined.append(t)
            i += 1
    toks = joined
    out = []
    for t in toks:
        if t in ("=", "+", "↔", ":", ";", "(", ")", "<", ">", "/", "…", "..."):
            out.append(t)
            continue
        if t.isdigit():
            out.append(t)
            continue
        if "/" in t.strip("/") and not t.startswith("-"):
            parts, prob_all = [], []
            for piece in t.split("/"):
                if piece:
                    np_, pr = macronise_token(piece, lex, src)
                    parts.append(np_)
                    if pr:
                        prob_all.append(pr)
                else:
                    parts.append(piece)
            problems += prob_all
            out.append("/".join(parts))
            continue
        new, prob = macronise_token(t, lex, src)
        if prob:
            problems.append(prob)
        out.append(new)
    s = " ".join(out)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)
    s = re.sub(r"\s+([,;:.!?])", r"\1", s)
    s = re.sub(r"\s*=\s*", " = ", s).strip()
    s = re.sub(r"\s{2,}", " ", s)
    if re.search(r"[\^~|�]|//|/[>,]|[a-zāēīōū][A-Z]", s):
        problems.append(f"stray OCR symbols in {s!r}")
    return s, problems


# --------------------------------------------------------------------------- source markdown

def source_parts(n: int, root: Path) -> list[dict]:
    """Latin text of each '## …' part of source/week-NN.md → [{title, lines, text}]."""
    p = root / "source" / f"week-{n:02d}.md"
    if not p.exists():
        return []
    parts: list[dict] = []
    cur = None
    in_latin = False
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            m = re.search(r"\(Lines?\s+(\d+)\s*[–-]\s*(\d+)\)", title)
            cur = {"title": re.sub(r"\s*\(Lines?[^)]*\)\s*$", "", title), "lines": (int(m.group(1)), int(m.group(2))) if m else None,
                   "text": []}
            parts.append(cur)
            in_latin = False
        elif line.startswith("### "):
            in_latin = "latin" in strip_macrons(line).lower() or "latīnus" in line.lower() or "textus" in line.lower()
        elif in_latin and cur is not None and line.strip():
            cur["text"].append(re.sub(r"\[\d+\]\s*", "", line.strip()))
    for c in parts:
        c["text"] = " ".join(c["text"])
    return [c for c in parts if c["text"]]


def week_texts(n: int, root: Path) -> list[dict]:
    """The readings of week n with their source parts. → [{source, chapter, stories|numbers, parts:[src parts]}]"""
    w = weeks_mod.week_meta(n)
    sparts = source_parts(n, root)
    fs_parts = [p for p in sparts if not p["title"].lower().startswith("fabellae")]
    fl_parts = [p for p in sparts if p["title"].lower().startswith("fabellae")]
    out = []
    if w["source"] == "FR":
        rng = None
        if "lines" in w:
            a, b = re.split(r"[–-]", w["lines"])
            rng = (int(a), int(b))
        out.append({"source": "FR", "chapter": ROMAN[w["chapter"]], "range": rng, "parts": sparts, "slug": None})
    else:
        m = re.match(r"([IVX]+)", w["chapter"])
        chap = ROMAN[m.group(1)]
        for p in fs_parts:
            out.append({"source": "FS", "chapter": chap, "range": p["lines"], "parts": [p],
                        "slug": part_slug(p["title"])})
        m2 = re.search(r"FL\s+(\d+)\s*[–-]\s*(\d+)", w["chapter"])
        if m2:
            a, b = int(m2.group(1)), int(m2.group(2))
            for k, no in enumerate(range(a, b + 1)):
                p = next((q for q in fl_parts if re.search(rf"\b{no}\b", q["title"])), None)
                out.append({"source": "FL", "story": no, "parts": [p] if p else [], "slug": f"fl-{no}"})
    return out


def part_slug(title: str) -> str:
    t = strip_macrons(title).lower()
    t = re.sub(r"^fabulae syrae\s*\d*\s*:\s*", "", t)
    t = re.sub(r"\(.*?\)", "", t)
    return re.sub(r"[^a-z0-9]+", "", t.split()[0]) if t.split() else "fs"


# --------------------------------------------------------------------------- locating pages

def fr_chapter_pages(pdf, chapter: int) -> list[int]:
    """1-based pages of FR chapter `chapter`, from the running heads (CAP. XXV …)."""
    want = [k for k, v in ROMAN.items() if v == chapter][0]
    pages = []
    started = False
    for i, page in enumerate(pdf.pages):
        if i < 150:
            continue
        words = page.extract_words(x_tolerance=1.0, extra_attrs=["size"])
        head = " ".join(w["text"] for w in words if w["top"] < 45)
        m = re.search(r"CA[PR]\.?\s*([IVXL]+)\b", head, re.I)
        if m:
            m = re.match(r"([IVXL]+)", m.group(1).upper())
        cap = m.group(1) if m else None
        is_chapter_start = "CAPITVLVM" in head.replace(" ", "")
        if is_chapter_start:
            if cap == want:
                started = True
                pages.append(i + 1)
                continue
            if started:
                break
        elif started:
            if cap is None or cap == want:
                pages.append(i + 1)
            else:
                break
    return pages


def fs_chapter_pages(pdf) -> dict[int, list[int]]:
    """FS: chapter number → 1-based pages, from 'AD CAPITVLVM …' title pages."""
    starts = []
    for i, page in enumerate(pdf.pages):
        words = page.extract_words(x_tolerance=1.0, extra_attrs=["size"])
        big = " ".join(w["text"] for w in words if w["size"] > 14)
        m = re.search(r"AD\s*CAPIT[A-Z0-9lV ]*\s+([IVXL]+)", big)
        if m and m.group(1) in ROMAN:
            starts.append((ROMAN[m.group(1)], i + 1))
    out = {}
    for k, (chap, p) in enumerate(starts):
        end = starts[k + 1][1] - 1 if k + 1 < len(starts) else len(pdf.pages)
        out[chap] = list(range(p, end + 1))
    return out


def fl_story_spans(pdf) -> dict[int, list[tuple[int, float, float]]]:
    """FL: story number → [(page, top, bottom)] regions, from the '63.-' headings."""
    heads = []
    for i, page in enumerate(pdf.pages):
        words = page.extract_words(x_tolerance=1.0, extra_attrs=["size"])
        for w in words:
            m = re.match(r"^(\d{1,3})\.-$", w["text"])
            if m and w["size"] > 12.5:
                heads.append((int(m.group(1)), i + 1, w["top"]))
    out: dict[int, list[tuple[int, float, float]]] = {}
    for k, (no, p, top) in enumerate(heads):
        if k + 1 < len(heads):
            np_, ntop = heads[k + 1][1], heads[k + 1][2]
        else:
            np_, ntop = len(pdf.pages), 9999
        spans = []
        for pg in range(p, np_ + 1):
            a = top if pg == p else 0
            b = ntop if pg == np_ else 9999
            spans.append((pg, a, b))
        out[no] = spans
    return out


# --------------------------------------------------------------------------- alignment with the source text

def src_tokens(text: str) -> list[str]:
    return text.split()


def align_rows_to_source(rows: list[Row], text: str) -> dict[int, str]:
    """Map row index → clean line text taken from the source. Rows the scan
    cannot align keep their OCR text (caller decides)."""
    if not text:
        return {}
    st = src_tokens(text)
    sk_src = [skeleton(t) for t in st]
    vocab = set(sk_src)
    ocr: list[tuple[int, str]] = []  # (row idx, skeleton)
    row_ends_hyphen = {}
    for i, r in enumerate(rows):
        toks = r.text.split()
        row_ends_hyphen[i] = bool(toks) and (toks[-1].endswith(SOFT_HYPHEN) or toks[-1].endswith("-"))
        for t in toks:
            k = skeleton(t.replace(SOFT_HYPHEN, ""))
            if not k:
                continue
            if k not in vocab and len(k) >= 5:
                # two words glued by the OCR ("Amīcīnostrī"): split where both halves are in the text
                for j in range(2, len(k) - 1):
                    if k[:j] in vocab and k[j:] in vocab:
                        ocr.append((i, k[:j]))
                        k = k[j:]
                        break
            ocr.append((i, k))
    sm = difflib.SequenceMatcher(None, [k for _, k in ocr], sk_src, autojunk=False)
    first: dict[int, int] = {}
    last: dict[int, int] = {}
    for a, b, size in sm.get_matching_blocks():
        for j in range(size):
            ri = ocr[a + j][0]
            si = b + j
            first.setdefault(ri, si)
            last[ri] = si
    # Unmatched source tokens between two matched rows: the word split at a
    # hyphenated row end belongs to the row where it starts; the rest goes to
    # the unmatched rows in between (if any), otherwise to the later row.
    out: dict[int, str] = {}
    n_rows = len(rows)
    prev_matched = None
    prev_end = -1
    i = 0
    while i < n_rows:
        if i not in first:
            i += 1
            continue
        s0, s1 = first[i], last[i]
        gap_a, gap_b = prev_end + 1, s0 - 1
        if gap_b >= gap_a:
            if prev_matched is not None and row_ends_hyphen.get(prev_matched):
                out[prev_matched] = " ".join(st[first[prev_matched]:gap_a + 1])
                gap_a += 1
            between = [k for k in range(prev_matched + 1 if prev_matched is not None else 0, i) if k not in first]
            if between and gap_b >= gap_a:
                # spread the gap over the unmatched rows in proportion to their OCR word counts
                counts = [max(1, len(rows[k].text.split())) for k in between]
                total = sum(counts)
                pos = gap_a
                for k, c in zip(between, counts):
                    take = round((gap_b - gap_a + 1) * c / total) if k != between[-1] else gap_b - pos + 1
                    take = max(0, min(take, gap_b - pos + 1))
                    if take:
                        out[k] = " ".join(st[pos:pos + take])
                        pos += take
            elif gap_b >= gap_a:
                s0 = gap_a
        out[i] = " ".join(st[s0:s1 + 1])
        prev_end = s1
        prev_matched = i
        i += 1
    return out


# --------------------------------------------------------------------------- lexicon

def build_lexicon(root: Path, pdfs: dict, cache: Path, quiet=False) -> Lexicon:
    if cache.exists():
        try:
            return Lexicon.from_json(json.loads(cache.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    lx = Lexicon()
    for n in range(1, 15):
        for p in source_parts(n, root):
            lx.add_text(p["text"], weight=3)
    for src in ("FR", "FL"):
        pdf = pdfs.get(src)
        if pdf is None:
            continue
        if not quiet:
            print(f"  building lexicon from {SCANS[src]} ({len(pdf.pages)} pages)…", file=sys.stderr)
        for page in pdf.pages:
            try:
                t = page.extract_text(x_tolerance=1.0) or ""
            except Exception:
                continue
            lx.add_text(t.replace(SOFT_HYPHEN, ""), weight=1)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(lx.to_json(), ensure_ascii=False), encoding="utf-8")
    return lx


# --------------------------------------------------------------------------- per-week driver

def extract_week(n: int, root: Path, pdfs: dict, lex: Lexicon, dump=False) -> dict:
    texts = week_texts(n, root)
    lines_out: list[dict] = []
    margins_out: list[dict] = []
    rep: dict = {"week": n, "texts": [], "notes": [], "problems": [], "dropped": []}
    chapters: dict = {}
    glossed: set = set()  # (page, top) of glosses already emitted (chapters shared by several texts)
    for tx in texts:
        src = tx["source"]
        pdf = pdfs[src]
        notes: list[str] = []
        tinfo = {"source": src, "slug": tx.get("slug"), "pages": [], "lines": 0, "glosses": 0, "range": tx.get("range")}
        if src == "FL":
            spans = fl_story_spans(pdf).get(tx["story"], [])
            tinfo["pages"] = sorted({p for p, _, _ in spans})
            main_rows: list[Row] = []
            bracket_rows: list[Row] = []
            for p, a, b in spans:
                pg = classify_page(pdf.pages[p - 1], p, "FL")
                main_rows += [r for r in pg["main"] if a - 2 < r.top < b]
                bracket_rows += [r for r in pg["brackets"] if a - 2 < r.top < b]
            text = tx["parts"][0]["text"] if tx["parts"] else ""
            clean = align_rows_to_source(main_rows, text)
            aligned = sum(1 for i in range(len(main_rows)) if i in clean)
            tinfo["lines"] = len(main_rows)
            tinfo["aligned"] = aligned
            # bracketed notes under the story
            if bracket_rows:
                raw = join_rows(bracket_rows)
                inner = raw.strip()
                if inner.startswith("["):
                    inner = inner[1:]
                if inner.endswith("]"):
                    inner = inner[:-1]
                for piece in [x.strip() for x in inner.split(";") if x.strip()]:
                    la, probs = clean_gloss(piece, lex, "FL")
                    head = skeleton(la.split()[0]).replace("-", "")
                    anchor_row = None
                    for i, r in enumerate(main_rows):
                        if any(skeleton(t).replace("-", "").startswith(head[:6]) for t in r.text.split()):
                            anchor_row = i
                            break
                    if anchor_row is None:
                        anchor_row = len(main_rows) - 1
                        notes.append(f"story {tx['story']}: headword of {la!r} not found in the text — anchored to the last line")
                    anchor_text = clean.get(anchor_row, main_rows[anchor_row].text)
                    anchor = " ".join(anchor_text.split()[:4])
                    margins_out.append({"line": None, "la": la, "anchor": anchor, "_page": bracket_rows[0].page, "_part": tx["slug"]})
                    rep["problems"] += [f"FL {tx['story']}: {p}" for p in probs]
                    tinfo["glosses"] += 1
            rep["texts"].append(tinfo)
            rep["notes"] += notes
            continue

        # FR / FS: pages of the chapter (classified and numbered once per chapter)
        ck = (src, tx["chapter"])
        if ck not in chapters:
            if src == "FR":
                pages = fr_chapter_pages(pdf, tx["chapter"])
            else:
                pages = fs_chapter_pages(pdf).get(tx["chapter"], [])
            classified = []
            stop = False
            for p in pages:
                pg = classify_page(pdf.pages[p - 1], p, src)
                if src == "FR":
                    # the reading ends where GRAMMATICA LATINA / PENSVM begins
                    cut = None
                    for w in pdf.pages[p - 1].extract_words(x_tolerance=1.0, extra_attrs=["size"]):
                        if w["top"] > 45 and w["text"] in ("GRAMMATICA", "PENSVM", "PENSVMA") and w["size"] > 9:
                            cut = w["top"] if cut is None else min(cut, w["top"])
                    if cut is not None:
                        pg["main"] = [r for r in pg["main"] if r.top < cut - 2]
                        pg["margin"] = [r for r in pg["margin"] if r.top < cut - 2]
                        pg["nums"] = [t for t in pg["nums"] if t[0] < cut - 2]
                        stop = True
                classified.append(pg)
                if stop:
                    break
            cnotes: list[str] = []
            number_rows(classified, cnotes)
            chapters[ck] = (classified, cnotes)
            notes += cnotes
        classified = chapters[ck][0]
        rng = tx.get("range")
        rows_all = [r for pg in classified for r in pg["main"]]
        rows = [r for r in rows_all if r.line_no is not None and (rng is None or rng[0] <= r.line_no <= rng[1])]
        text = " ".join(p["text"] for p in tx["parts"])
        clean = align_rows_to_source(rows, text)
        tinfo["pages"] = sorted({r.page for r in rows})
        tinfo["lines"] = len(rows)
        tinfo["aligned"] = sum(1 for i in range(len(rows)) if i in clean)
        tinfo["line_range"] = (rows[0].line_no, rows[-1].line_no) if rows else None
        seen_lines = set()
        for i, r in enumerate(rows):
            if r.line_no in seen_lines:
                notes.append(f"p{r.page}: line {r.line_no} occurs twice ({r.text[:30]!r})")
            seen_lines.add(r.line_no)
            entry = {"line": r.line_no, "text": clean.get(i, r.text.replace(SOFT_HYPHEN, "-")), "page": r.page}
            if i not in clean:
                entry["ocr"] = True
            if tx.get("slug"):
                entry["part"] = tx["slug"]
            if r.conf == "low":
                entry["conf"] = "low"
            lines_out.append(entry)
        # glosses
        for pg in classified:
            main_rows = [r for r in pg["main"] if r.line_no is not None]
            for gl in assemble_glosses(pg, src, notes):
                if (pg["page"], round(gl["top"])) in glossed:
                    continue
                if not main_rows:
                    notes.append(f"p{pg['page']}: gloss {gl['raw'][:30]!r} on a page without numbered text — dropped")
                    continue
                r = min(main_rows, key=lambda r: abs(r.top - gl["top"]))
                if abs(r.top - gl["top"]) > 14:
                    # a gloss beside a story title (or a picture): it belongs to the first line below it
                    below = [q for q in main_rows if q.top > gl["top"]]
                    if below:
                        r = below[0]
                if abs(r.top - gl["top"]) > 14 and not re.search(r"[=:<↔]|-[a-zāēīōū]", gl["raw"]):
                    notes.append(f"p{pg['page']}: dropped margin text {gl['raw'][:30]!r} — {abs(r.top - gl['top']):.0f}pt from any text line, no gloss syntax (picture label)")
                    continue
                if abs(r.top - gl["top"]) > 12:
                    notes.append(f"p{pg['page']}: gloss {gl['raw'][:30]!r} is {abs(r.top - gl['top']):.0f}pt from the nearest text line (line {r.line_no})")
                line = r.line_no
                if rng is not None and not (rng[0] <= line <= rng[1]):
                    continue
                glossed.add((pg["page"], round(gl["top"])))
                for la, probs in clean_glosses(gl["raw"], lex, src):
                    margins_out.append({"line": line, "la": la, "_page": pg["page"], "_raw": gl["raw"], "_part": tx.get("slug")})
                    for pr in probs:
                        rep["problems"].append(f"p{pg['page']} line {line}: {pr}  [{la}]")
                    tinfo["glosses"] += 1
        rep["texts"].append(tinfo)
        rep["notes"] += notes
        if dump:
            for pg in classified:
                print(f"--- page {pg['page']} ({pg['side']})")
                for r in pg["main"]:
                    print(f"  {r.line_no!s:>4} {'*' if r.anchor else ' '} {r.text}")
                for r in pg["margin"]:
                    print(f"       margin x{r.x0:.0f} y{r.top:.0f}: {r.text}")
    return {"lines": lines_out, "margins": margins_out, "report": rep}


def write_week(n: int, root: Path, res: dict) -> None:
    build = root / "data" / "build"
    build.mkdir(parents=True, exist_ok=True)
    (build / f"lines-week-{n:02d}.json").write_text(
        json.dumps(res["lines"], ensure_ascii=False, indent=1), encoding="utf-8")
    slim = []
    for m in res["margins"]:
        e = {"line": m["line"], "la": m["la"]}
        if m.get("anchor"):
            e["anchor"] = m["anchor"]
        slim.append(e)
    (build / f"margin-week-{n:02d}.json").write_text(json.dumps(slim, ensure_ascii=False, indent=1), encoding="utf-8")


def report_section(n: int, res: dict) -> str:
    rep = res["report"]
    L = [f"## Week {n:02d} — extraction\n"]
    for t in rep["texts"]:
        rng = f", lines {t['range'][0]}–{t['range'][1]}" if t.get("range") else ""
        got = f", numbered rows {t['line_range'][0]}–{t['line_range'][1]}" if t.get("line_range") else ""
        L.append(f"- **{t['source']}{' ' + t['slug'] if t.get('slug') else ''}**: pages {t['pages']}{rng}{got}; "
                 f"printed lines: {t['lines']} (aligned with source: {t.get('aligned', 0)}); glosses: {t['glosses']}")
    L.append("")
    L.append(f"Totals: {len(res['lines'])} lines, {len(res['margins'])} glosses.\n")
    if rep["notes"]:
        L.append("Numbering / layout notes:\n")
        L += [f"- {x}" for x in dict.fromkeys(rep["notes"])]
        L.append("")
    if rep["problems"]:
        L.append("Glosses not cleaned with confidence (kept as printed, check by eye):\n")
        L += [f"- {x}" for x in rep["problems"]]
        L.append("")
    return "\n".join(L) + "\n"


def update_report(root: Path, key: str, section: str) -> None:
    """Replace (or append) the block between <!-- key --> markers in margins-REPORT.md."""
    path = root / "data" / "build" / "margins-REPORT.md"
    start, end = f"<!-- {key} -->", f"<!-- /{key} -->"
    body = path.read_text(encoding="utf-8") if path.exists() else "# Margin notes — extraction & attachment report\n\n"
    block = f"{start}\n{section}{end}\n"
    if start in body and end in body:
        body = body[:body.index(start)] + block + body[body.index(end) + len(end):].lstrip("\n")
    else:
        body = body.rstrip("\n") + "\n\n" + block
    path.write_text(body, encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="*", type=int, help="week numbers (default all)")
    ap.add_argument("--root", type=Path, default=ROOT)
    ap.add_argument("--dump", action="store_true", help="print every classified row (debug)")
    ap.add_argument("--rebuild-lexicon", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    import pdfplumber
    root = a.root.resolve()
    pdfs = {}
    for src, name in SCANS.items():
        p = root / "scans" / name
        if p.exists():
            pdfs[src] = pdfplumber.open(str(p))
        else:
            print(f"missing scan {p}", file=sys.stderr)
    cache = root / "data" / "build" / "margins-lexicon.json"
    if a.rebuild_lexicon and cache.exists():
        cache.unlink()
    lex = build_lexicon(root, pdfs, cache, quiet=a.quiet)
    weeks = a.weeks or list(range(1, 15))
    for n in weeks:
        res = extract_week(n, root, pdfs, lex, dump=a.dump)
        write_week(n, root, res)
        update_report(root, f"extract:w{n:02d}", report_section(n, res))
        if not a.quiet:
            rep = res["report"]
            print(f"week {n:02d}: {len(res['lines'])} lines, {len(res['margins'])} glosses, "
                  f"{len(rep['problems'])} uncertain, {len(rep['notes'])} notes  "
                  + "; ".join(f"{t['source']}{('/' + t['slug']) if t.get('slug') else ''} p{t['pages'][0] if t['pages'] else '?'}–{t['pages'][-1] if t['pages'] else '?'}" for t in rep["texts"]))
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
