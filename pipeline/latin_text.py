"""The Latin tokeniser and the copyright line, shared by the pipeline checks.

This is the Python twin of ``app/js/tokenize.js``: same word regex, same
macron map, so a word index computed here is the word index the device
resolves. Everything that decides what may ship in a public file lives here,
in one place, because the answer must be the same in the transformer
(``span_questions.py``), in the validator (``check_questions.py``) and in the
engine.

THE LINE (copyright — see PROMPT.md §5, CONTRACT.md):

1. **No public file may reproduce five or more consecutive words of the
   book.** Four is the most a public file may quote in a row.

2. **In a question set, the Latin the item answers with — every accepted
   answer, every choice, every tap target — carries no run of two or more
   words of its own referenced sentence as text.** Such a run ships as an
   index reference (``{"span": [i, j]}``, or ``{"parts": [...]}`` when our
   own wording weaves runs together), resolved on the device from the
   private text. A single word is never a quotation and stays as text.
   What is left literal there is our own wording, and is capped at eight
   words — a backstop, set one word above the longest answer we wrote, so
   that nothing sentence-shaped can hide as "our own".

3. **A question (`q`) is ours, and stays text.** A comprehension question
   must repeat the phrase it asks about, so clause 1 cannot bind it; what
   binds it instead is that it may never *be* a run of its sentence (a
   question is an interrogative we wrote, not a clause of the text lifted
   whole), and it is capped at twelve words. `en`, `hint` and `title` are
   English or our own labels.

   Exempt from clause 1: the ancient poets Ørberg reprints (Catullus,
   Martial, Ovid) — their text is public domain, ours to quote, and the
   metre lessons cannot teach scansion without it. ``CLASSICAL`` lists them.
"""
import re
import unicodedata

# app/js/tokenize.js: WORD_RE and MACRON_MAP, character for character.
WORD_RE = re.compile("[A-Za-zāēīōūȳ"
                     "ĀĒĪŌŪȲ"
                     "æÆœŒ̄]+")
_MACRON = {
    "ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u", "ȳ": "y",
    "Ā": "A", "Ē": "E", "Ī": "I", "Ō": "O", "Ū": "U", "Ȳ": "Y",
    "̄": "", "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe",
}

# The maximum number of consecutive book words a public file may reproduce.
MAX_BOOK_RUN = 4
# The longest literal Latin answer or choice a question file may carry (words).
MAX_LITERAL_WORDS = 8
# The longest question a question file may carry (words).
MAX_QUESTION_WORDS = 12
# The shortest run of an item's own sentence that must become a span reference.
MIN_SPAN_WORDS = 2

#: Ancient verse Ørberg reprints. Public domain, and named in the lesson that
#: quotes it; the run rule does not apply to it.
CLASSICAL = {
    "non amo te sabidi nec possum dicere quare",          # Martial 1.32
    "hoc tantum possum dicere non amo te",                 # Martial 1.32
    "vivamus mea lesbia atque amemus",                     # Catullus 5
    "passer mortuus est meae puellae",                     # Catullus 3
    "non ego nobilium sedeo studiosus equorum",            # Ovid, Amores 3.2
    "cui tamen ipsa faves vincat ut ille precor",          # Ovid, Amores 3.2
    "saepe meae tandem dixi discede puellae",              # Ovid, Amores 3.11
    "in gremio sedit protinus illa meo",                   # Ovid, Amores 3.11
    "cenabis bene mi fabulle apud me",                     # Catullus 13
    "vellem si magis esset anus",                          # Martial 1.100 (cap. XXXIV)
    "quidquid vis esto dummodo nil recites",               # Martial 1.110 (cap. XXXIV)
}


def strip_macrons(s):
    return "".join(_MACRON.get(c, c) for c in str(s or ""))


def tokens(la):
    """[(text, start, end)] for every word of `la`, in order (word tokens only)."""
    return [(m.group(0), m.start(), m.end()) for m in WORD_RE.finditer(str(la or ""))]


def forms(la):
    """The word forms of `la`: macrons stripped, lower-cased — the matching key."""
    return [strip_macrons(t[0]).lower() for t in tokens(la)]


def normalise_answer(s):
    """app/js/grammar/items.js normaliseAnswer: the grading key."""
    t = strip_macrons(str(s or "")).lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def find_run(hay, needle):
    """The first index where `needle` (a form list) occurs in `hay`, or None."""
    n = len(needle)
    if not n or n > len(hay):
        return None
    for i in range(len(hay) - n + 1):
        if hay[i:i + n] == needle:
            return i
    return None


def slice_span(la, i, j):
    """The text of words i..j of `la` (inclusive), or None when out of range."""
    tk = tokens(la)
    if not isinstance(i, int) or not isinstance(j, int) or i < 0 or j < i or j >= len(tk):
        return None
    return str(la)[tk[i][1]:tk[j][2]]


def join_parts(parts):
    """The engine's join: one space between parts, no space before punctuation."""
    out = " ".join(p for p in parts if p)
    out = re.sub(r"\s+([,.;:!?])", r"\1", out)
    return re.sub(r"\s+", " ", out).strip()


def resolve_ref(la, ref):
    """A stored answer/choice → its text, or None when it cannot be resolved."""
    if isinstance(ref, str):
        return ref
    if not isinstance(ref, dict):
        return None
    if isinstance(ref.get("span"), list) and len(ref["span"]) == 2:
        return slice_span(la, *ref["span"])
    if isinstance(ref.get("parts"), list) and ref["parts"]:
        out = []
        for p in ref["parts"]:
            t = resolve_ref(la, p)
            if t is None:
                return None
            out.append(t)
        return join_parts(out)
    return None


class Corpus:
    """The private text: unit id → unit, and the book's n-grams for the run rule."""

    def __init__(self, build_dir):
        import json
        self.units = {}
        self.weeks = {}
        for f in sorted(build_dir.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(d, dict) or "week" not in d or "units" not in d:
                continue
            wid = d["week"].get("id")
            if wid in self.weeks:
                continue
            self.weeks[wid] = d["week"]
            for order, u in enumerate(d["units"]):
                self.units.setdefault(u["id"], (wid, u.get("order", order), u))
        self._sentences = [forms(u.get("la")) for _, _, u in self.units.values()]
        self._grams = set()
        k = MAX_BOOK_RUN + 1
        for w in self._sentences:
            for i in range(len(w) - k + 1):
                self._grams.add(tuple(w[i:i + k]))

    def unit(self, uid):
        entry = self.units.get(uid)
        return entry[2] if entry else None

    def book_run(self, s):
        """The first run of > MAX_BOOK_RUN consecutive book words in `s`, or None."""
        w = forms(s)
        k = MAX_BOOK_RUN + 1
        for i in range(len(w) - k + 1):
            gram = tuple(w[i:i + k])
            if gram not in self._grams:
                continue
            # grow it, so the report names the whole quotation
            j = i + k
            while j < len(w):
                nxt = tuple(w[i:j + 1])
                if not self._is_run(nxt):
                    break
                j += 1
            run = " ".join(w[i:j])
            if any(run in c or c in run for c in CLASSICAL):
                continue
            return run
        return None

    def _is_run(self, gram):
        want = list(gram)
        return any(find_run(w, want) is not None for w in self._sentences)
