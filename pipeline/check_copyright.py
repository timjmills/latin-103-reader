"""The copyright gate: nothing under app/ may carry a run of the private text.

The book (Ørberg, Miraglia) and the user's own English translations live only
in data/build/ (gitignored) and in Supabase behind auth. Public files under
app/ may hold our own prose, unit ids, span references, Whitaker-derived
glosses and our own written or generated sentences — never the book's words
(CLAUDE.md, docs/GRAMMAR-CONTRACT.md §1, README "Privacy model").

This script indexes the private text and scans the public tree for it:

* every **5-word window** of every Latin string in data/build/*.json that is
  the book's own — units' `la` (weeks, the review shelf, the colloquia), the
  scanned lines, the margin glosses, the pensa (blanks, questions and their
  answers), the picture captions, the highlighted phrases;
* every **8-word window** of the user's English `en` / `en_raw` translations
  in data/build/week-*.json.

Our own prose that also sits in data/build — summaries, focus blurbs, notes,
highlight explanations, the English side of the margin glosses — and the
Whitaker dictionary are not indexed; they are ours (or freely licensed) to
reuse. Matching is over normalised words: lower-cased, macrons stripped,
v→u, j→i, punctuation dropped.

Every file under app/ is scanned: JSON files value by value (a hit names the
JSON path), other text files (.js, .md, .html, .css, …) by their text (a hit
names the line). Exit status 1 on any hit. Ancient verse Ørberg reprints
(Martial, Catullus, Ovid — the lines listed in latin_text.CLASSICAL) is public
domain and is left out of the index, so the lessons may quote it; a dictionary
line that coincides with a margin gloss is allow-listed by exact file and JSON
path in ALLOW below, with a comment.

    PYTHONIOENCODING=utf-8 python pipeline/check_copyright.py
    python pipeline/check_copyright.py --build "D:/elsewhere/data/build"

The build directory is data/build next to the repo, or $LATIN103_BUILD when
set. A checkout without the library (CI) has nothing to index: the script
exits 2 and says so, and pipeline/test_check_copyright.py is SKIPPED there.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from latin_text import CLASSICAL  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
DEFAULT_BUILD = ROOT / "data" / "build"
ENV_BUILD = "LATIN103_BUILD"
NUL = chr(0)  # git ls-files -z separator

LATIN_WINDOW = 5
ENGLISH_WINDOW = 8

# What in data/build is the book's (Latin) or the user's (English), by file
# family (the name before the first "-" with digits removed) and leaf key. A
# string counts when its own key, or the key of the list it sits in, is
# listed. Anything not here is our own prose or the Whitaker dictionary.
LATIN_FIELDS = {
    "week": {"la"},               # units[].la, units[].margin[].la, units[].tags[].la
    "review": {"la"},             # the review shelf: units and their margin glosses
    "collo": {"la"},              # the colloquia
    "lines": {"text"},            # the scanned lines, one per book line
    "margin": {"la", "anchor"},   # margin glosses as extracted
    "pensa": {"text", "q", "answers", "stem"},   # Pensa A/B blanks, Pensum C questions + answers
    "pictures": {"caption"},      # the book's picture captions
    "highlights": {"text"},       # highlighted phrases of the book
}
# The user's translations: `en` / `en_raw` of a unit — not the English side
# of a margin gloss (units[].margin[].en), which is our own.
ENGLISH_PATHS = {
    "week": re.compile(r"^units/\d+/en(?:_raw)?$"),
}

# Exact (file under app/, JSON path) pairs that may carry a window of the
# index, each with the reason. Keep this list short and every entry explained:
# what is allowed here is dictionary boilerplate — a declension line, a Roman
# date formula, a comparative paradigm — that a margin gloss happens to share,
# never a sentence of the book.
_UNUS = "the dictionary line 'ūnus -a -um (gen. -īus)' is the same declension note as the cap. XIX margin gloss"
_KAL_MAI = "'a. d. VII kal. Māi.' is the Roman date formula, shared with the cap. XXXIII margin gloss"
ALLOW: dict[tuple[str, str], str] = {
    ("data/glossary.json", "unae/0/lemma"): _UNUS,
    ("data/glossary.json", "unas/0/lemma"): _UNUS,
    ("data/glossary.json", "unos/0/lemma"): _UNUS,
    ("data/grammar/vocab/33.json", "words/66/dict"): _UNUS,
    ("data/glossary.json", "mai/0/senses/0"): _KAL_MAI,
    ("data/glossary.json", "vii/0/parses/0/note"): _KAL_MAI,
    ("data/grammar/vocab/33.json", "words/57/sense_full"): _KAL_MAI,
    ("data/glossary.json", "pigrior/0/senses/0"):
        "the comparative paradigm 'prae cēterīs piger = cēterīs pigrior' is the grammar the cap. XXVIII margin gloss teaches, not its prose",
    ("data/grammar/vocab/32.json", "words/16/dict"):
        "the dictionary line 'vīs f. (acc. vim, abl. vī …)' is the same declension note as the cap. XXXII margin gloss",
}

TEXT_SUFFIXES = {".js", ".mjs", ".md", ".html", ".css", ".txt", ".webmanifest", ".svg"}

_WORD_RE = re.compile(r"[a-z0-9]+")


def normalise(text: str) -> list[str]:
    """The matching words of `text`: lower-case ASCII, v→u, j→i, no punctuation."""
    t = unicodedata.normalize("NFD", str(text or ""))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace("æ", "ae").replace("œ", "oe")
    t = t.replace("v", "u").replace("j", "i")
    return _WORD_RE.findall(t)


def windows(words: list[str], n: int):
    for i in range(len(words) - n + 1):
        yield tuple(words[i:i + n])


_CLASSICAL_WORDS = [normalise(line) for line in CLASSICAL]


def classical(window: tuple) -> bool:
    """Is this window a run of one of the public-domain verse lines?"""
    n = len(window)
    want = list(window)
    for line in _CLASSICAL_WORDS:
        for i in range(len(line) - n + 1):
            if line[i:i + n] == want:
                return True
    return False


def trivial(window: tuple) -> bool:
    """
    Is this window content-free? A run of single letters is an enumeration — a
    list of the vowels, `['a', 'b', 'c', 'd', 'e']` in a test — and carries none
    of the book's expression, so it is not a hit however often it coincides.
    """
    return all(len(w) <= 1 for w in window)


def family(path: Path) -> str:
    stem = path.name.split("-")[0]
    return "".join(c for c in stem if not c.isdigit()).lower()


def _walk(node, key, path, out):
    """Yield (key, json_path, string) for every string; `key` is the nearest
    dict key above the string (a list inherits the key it hangs from)."""
    if isinstance(node, dict):
        for k, v in node.items():
            _walk(v, k, f"{path}/{k}" if path else k, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk(v, key, f"{path}/{i}", out)
    elif isinstance(node, str):
        out.append((key, path, node))


def strings_of(doc):
    out = []
    _walk(doc, None, "", out)
    return out


class Index:
    """The private text's windows: word tuple → where it came from (first seen)."""

    def __init__(self):
        self.latin: dict[tuple, str] = {}
        self.english: dict[tuple, str] = {}
        self.files = 0

    def add(self, table, text, n, where):
        for w in windows(normalise(text), n):
            if trivial(w):
                continue
            if table is self.latin and classical(w):
                continue
            table.setdefault(w, where)

    @property
    def size(self):
        return len(self.latin) + len(self.english)


def build_index(build_dir: Path) -> Index:
    idx = Index()
    for f in sorted(build_dir.glob("*.json")):
        fam = family(f)
        la_keys = LATIN_FIELDS.get(fam)
        en_path = ENGLISH_PATHS.get(fam)
        if not la_keys and not en_path:
            continue
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError):
            continue
        idx.files += 1
        for key, path, s in strings_of(doc):
            where = f"{f.name} {path}"
            if la_keys and key in la_keys:
                idx.add(idx.latin, s, LATIN_WINDOW, where)
            if en_path and en_path.match(path):
                idx.add(idx.english, s, ENGLISH_WINDOW, where)
    return idx


class Hit:
    __slots__ = ("file", "path", "text", "window", "source", "kind")

    def __init__(self, file, path, text, window, source, kind):
        self.file, self.path, self.text = file, path, text
        self.window, self.source, self.kind = window, source, kind

    def __repr__(self):
        return f"{self.file} {self.path} {self.text!r}"


def _match(words, idx):
    """The first indexed window in `words`, as (kind, window, source), or None."""
    for w in windows(words, LATIN_WINDOW):
        src = idx.latin.get(w)
        if src:
            return "latin", w, src
    for w in windows(words, ENGLISH_WINDOW):
        src = idx.english.get(w)
        if src:
            return "english", w, src
    return None


def scan_json(rel: str, doc, idx: Index, allow) -> list[Hit]:
    hits = []
    for _key, path, s in strings_of(doc):
        m = _match(normalise(s), idx)
        if m and (rel, path) not in allow:
            hits.append(Hit(rel, path, s, m[1], m[2], m[0]))
    return hits


def scan_text(rel: str, text: str, idx: Index, allow) -> list[Hit]:
    """Text files: one token stream over the whole file, hits named by line."""
    hits = []
    lines = text.splitlines()
    words, line_of = [], []
    for no, line in enumerate(lines, 1):
        for w in normalise(line):
            words.append(w)
            line_of.append(no)
    seen = set()
    for kind, n, table in (("latin", LATIN_WINDOW, idx.latin),
                           ("english", ENGLISH_WINDOW, idx.english)):
        for i in range(len(words) - n + 1):
            w = tuple(words[i:i + n])
            src = table.get(w)
            if not src:
                continue
            no = line_of[i]
            path = f"line {no}"
            if (rel, path) in allow or (no, kind) in seen:
                continue
            seen.add((no, kind))
            hits.append(Hit(rel, path, lines[no - 1].strip(), w, src, kind))
    return hits


def scan_one(rel: str, f: Path, idx: Index, allow) -> list[Hit]:
    """One file, by suffix. Anything else (an image, a font) cannot carry text."""
    if f.suffix == ".json":
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            return [Hit(rel, "-", f"unreadable JSON ({e})", (), "-", "error")]
        return scan_json(rel, doc, idx, allow)
    if f.suffix in TEXT_SUFFIXES:
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return []
        return scan_text(rel, text, idx, allow)
    return []


def scan(app_dir: Path, idx: Index, allow=None) -> list[Hit]:
    allow = ALLOW if allow is None else allow
    hits = []
    for f in sorted(app_dir.rglob("*")):
        if f.is_file():
            hits.extend(scan_one(f.relative_to(app_dir).as_posix(), f, idx, allow))
    return hits


def tracked(root: Path) -> list[Path]:
    """
    Every file git tracks. This is the honest definition of "public" for this
    repository: GitHub Pages serves `app/`, but the repository itself is public,
    so `pipeline/`, `tests/`, `docs/` and the root documents are published too.
    Reading the list from git means a new tracked file is scanned the day it is
    added, and anything gitignored — `data/build`, `source/`, the audio — is
    never read.
    """
    try:
        done = subprocess.run(["git", "-C", str(root), "ls-files", "-z"],
                              capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError) as e:
        raise SystemExit(
            f"check_copyright: cannot list tracked files in {root} ({e}). The gate's "
            f"idea of 'public' is what git tracks, so it needs a checkout; pass "
            f"--app <dir> to scan one tree without git.") from e
    return [root / rel for rel in done.stdout.split(NUL) if rel]


def scan_repo(root: Path, idx: Index, allow=None) -> list[Hit]:
    """Every tracked file. The allowlist is written app-relative, so lift it."""
    if allow is None:
        allow = {(f"app/{path}", ptr): why for (path, ptr), why in ALLOW.items()}
    hits = []
    for f in tracked(root):
        if f.is_file():
            hits.extend(scan_one(f.relative_to(root).as_posix(), f, idx, allow))
    return hits


def find_build(arg: str | None) -> Path | None:
    for cand in (arg, os.environ.get(ENV_BUILD), DEFAULT_BUILD):
        if cand and Path(cand).is_dir() and any(Path(cand).glob("*.json")):
            return Path(cand)
    return None


def report(hits: list[Hit], out=None) -> None:
    out = out or sys.stdout
    by_file = defaultdict(list)
    for h in hits:
        by_file[h.file].append(h)
    for file in sorted(by_file):
        out.write(f"{file}\n")
        for h in by_file[file]:
            text = h.text if len(h.text) <= 120 else h.text[:117] + "..."
            out.write(f"  {h.path}\n")
            out.write(f"    {text}\n")
            out.write(f"    <- {h.kind} {' '.join(h.window)!r} in {h.source}\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--build", help=f"data/build directory (default: data/build or ${ENV_BUILD})")
    ap.add_argument("--app", help="scan one tree instead of every tracked file (e.g. --app app)")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    build = find_build(args.build)
    if build is None:
        print(f"check_copyright: no data/build with JSON files (looked at --build, "
              f"${ENV_BUILD}, {DEFAULT_BUILD}); nothing to index.")
        return 2
    idx = build_index(build)
    where = args.app or f"{ROOT} (every tracked file)"
    hits = scan(Path(args.app), idx) if args.app else scan_repo(ROOT, idx)
    print(f"check_copyright: indexed {idx.files} files from {build} "
          f"({len(idx.latin)} Latin {LATIN_WINDOW}-word windows, "
          f"{len(idx.english)} English {ENGLISH_WINDOW}-word windows); "
          f"scanned {where}")
    if hits:
        report(hits)
        files = len({h.file for h in hits})
        print(f"FAIL: {len(hits)} hit(s) in {files} file(s)")
        return 1
    print("OK: 0 hits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
