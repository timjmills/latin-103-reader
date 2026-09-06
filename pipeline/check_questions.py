"""Validate app/data/grammar/questions/NN.json against the built text.

Chapters 1-24 are checked against data/build/review-NN.json; chapters 25-34
against the week named by the file's ``week_id`` (data/build/week-NN.json).
Units are resolved through an index built over every data/build/*.json, so a
chapter may also cite the supplementary week that carries its extra stories
(e.g. ch 27 cites w04 and then w03:minos:*).

Checks: JSON parses; required fields; ids unique, sequential and of the form
qNN-KK; unit ids exist; items in text order (contiguous per source week, and
by unit order inside each week); tap answers occur as a word of the referenced
sentence; choice items have 4 distinct choices containing answers[0]; answers
non-empty; `en` and `hint` present and non-empty; `q` ends with "?"; no two
items share a `q`; >= 24 items; >= 8 distinct question words; for 25-34 the
week_id names a week whose `chapter` is the Roman numeral of the chapter.

**And the copyright line** (pipeline/latin_text.py, PROMPT.md §5): every
`{"span": [i, j]}` / `{"parts": [...]}` reference resolves against the private
text; no literal answer or choice reproduces two consecutive words of its own
sentence (that must be a reference) or runs past eight words; no `q` is a
clause of its sentence lifted whole; and nothing in a public grammar file —
the question sets, the lessons, the vocabulary decks, skills.json — reproduces
five or more consecutive words of the book.

Prints a per-chapter summary: item count, question words, input split.

    python pipeline/check_questions.py            # all chapters present
    python pipeline/check_questions.py 3 7        # chapters 3 and 7 (skips the
                                                  # public-file sweep)
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from latin_text import (CLASSICAL, MAX_BOOK_RUN, MAX_LITERAL_WORDS,  # noqa: E402
                        MAX_QUESTION_WORDS, MIN_SPAN_WORDS, Corpus, find_run,
                        forms, resolve_ref)

ROOT = Path(__file__).resolve().parent.parent
QDIR = ROOT / "app" / "data" / "grammar" / "questions"
GRAMMAR = ROOT / "app" / "data" / "grammar"
BUILD = ROOT / "data" / "build"

# the fourteen canonical question words plus the case-forms of quis/quī the
# contract allows ("quem/cui/cuius/quae/quod forms of quis where natural")
QWORDS = {"quis", "quid", "cūr", "ubi", "quō", "unde", "quandō", "quōmodo", "quot",
          "quālis", "uter", "num", "nōnne", "-ne",
          "quem", "cui", "cuius", "quae", "quod", "quī", "quibus"}
INPUTS = {"tap", "choice", "type"}
FIELDS = {"id", "qword", "q", "en", "unit_id", "answers", "input", "hint"}

ROMAN = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"),
         (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"),
         (5, "V"), (4, "IV"), (1, "I")]


def roman(n):
    out = []
    for v, s in ROMAN:
        while n >= v:
            out.append(s)
            n -= v
    return "".join(out)


def safe_print(*parts):
    """Print without dying on a cp1252 console."""
    line = " ".join(str(p) for p in parts)
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        sys.stdout.write(line + "\n")
    except UnicodeEncodeError:
        sys.stdout.write(line.encode(enc, "replace").decode(enc) + "\n")


def load_index():
    """Map unit id -> (week_id, order) and week_id -> week dict, over data/build."""
    units, weeks = {}, {}
    for f in sorted(BUILD.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        if not isinstance(d, dict) or "week" not in d or "units" not in d:
            continue
        wid = d["week"].get("id")
        if wid in weeks:          # e.g. a stray duplicate build file
            continue
        weeks[wid] = d["week"]
        for u in d["units"]:
            units[u["id"]] = (wid, u.get("order", 0), u)
    return units, weeks


def words(la):
    return [w.strip("\"'“”‘’.,;:!?()[]") for w in la.split()]


def latin_strings(node):
    """Every string in a public grammar file that could carry Latin."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from latin_strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from latin_strings(v)
    elif isinstance(node, str):
        yield node


def check_line(errs, pid, what, text, sentence_forms, corpus, limit):
    """The copyright line on one literal Latin string (pipeline/latin_text.py)."""
    w = forms(text)
    if len(w) > limit:
        errs.append(f"{pid}: {what} is {len(w)} words of literal Latin "
                    f"(the line is {limit}): {text!r}")
    if sentence_forms is not None:
        for i in range(len(w) - MIN_SPAN_WORDS + 1):
            run = w[i:i + MIN_SPAN_WORDS]
            if find_run(sentence_forms, run) is not None:
                errs.append(f"{pid}: {what} carries the sentence's own words "
                            f"{' '.join(run)!r} as text — that must be a span "
                            f"reference: {text!r}")
                break
    run = corpus.book_run(text)
    if run:
        errs.append(f"{pid}: {what} reproduces {MAX_BOOK_RUN + 1}+ consecutive "
                    f"words of the book ({run!r}): {text!r}")


def literals(ref):
    """The strings a stored answer/choice carries as text (never the book's)."""
    if isinstance(ref, str):
        return [ref]
    if isinstance(ref, dict) and isinstance(ref.get("parts"), list):
        return [p for p in ref["parts"] if isinstance(p, str)]
    return []


def resolve_all(errs, pid, la, refs, what):
    """Every reference of a list resolved; None (and an error) when one cannot be."""
    out = []
    for ref in refs or []:
        text = resolve_ref(la, ref)
        if text is None:
            errs.append(f"{pid}: {what} {json.dumps(ref, ensure_ascii=False)} "
                        f"does not resolve against {la!r}")
            return None
        out.append(text)
    return out


def check(n, index, weeks, corpus):
    errs = []
    qf = QDIR / f"{n:02d}.json"
    d = json.loads(qf.read_text(encoding="utf-8"))
    wid = d.get("week_id")

    if d.get("chapter") != n:
        errs.append(f"chapter field {d.get('chapter')} != {n}")
    if not d.get("title"):
        errs.append("missing title")

    rf = BUILD / f"review-{n:02d}.json"
    if rf.exists():
        home = json.loads(rf.read_text(encoding="utf-8"))["week"]["id"]
        if wid != home:
            errs.append(f"week_id {wid} != {home} (review-{n:02d}.json)")
    else:
        if wid not in weeks:
            return ([f"week_id {wid!r} names no week in data/build"],
                    f"ch {n:02d} {d.get('title','?'):<22} (unchecked)")
        want = roman(n)
        if weeks[wid].get("chapter") != want:
            cands = sorted(w for w, wk in weeks.items() if wk.get("chapter") == want)
            errs.append(f"week_id {wid} has chapter "
                        f"{weeks[wid].get('chapter')!r}, not {want!r} "
                        f"(chapter {n} is {cands or 'no week'})")

    items = d.get("items", [])
    ids = set()
    qs = {}
    qw = set()
    split = {k: 0 for k in INPUTS}
    file_seq = []        # source weeks in the order they first appear
    last_key = (-1, -1)
    for i, it in enumerate(items, 1):
        pid = it.get("id", f"#{i}")
        missing = FIELDS - set(it)
        if missing:
            errs.append(f"{pid}: missing {sorted(missing)}")
            continue
        if it["id"] != f"q{n:02d}-{i:02d}":
            errs.append(f"{pid}: id should be q{n:02d}-{i:02d}")
        if it["id"] in ids:
            errs.append(f"{pid}: duplicate id")
        ids.add(it["id"])
        if it["qword"] not in QWORDS:
            errs.append(f"{pid}: unknown qword {it['qword']}")
        qw.add(it["qword"])
        if it["input"] not in INPUTS:
            errs.append(f"{pid}: bad input {it['input']}")
        else:
            split[it["input"]] += 1
        if not it["q"].endswith("?"):
            errs.append(f"{pid}: q should end with ?")
        key = it["q"].strip()
        if key in qs:
            errs.append(f"{pid}: duplicate q (same as {qs[key]}): {it['q']!r}")
        else:
            qs[key] = pid
        if not isinstance(it["en"], str) or not it["en"].strip():
            errs.append(f"{pid}: empty en")
        if not isinstance(it["hint"], str) or not it["hint"].strip():
            errs.append(f"{pid}: empty hint")
        if not it["answers"] or not all(
                (isinstance(a, str) and a.strip()) or isinstance(a, dict)
                for a in it["answers"]):
            errs.append(f"{pid}: empty answers")

        entry = index.get(it["unit_id"])
        if entry is None:
            errs.append(f"{pid}: unit {it['unit_id']} not in data/build")
            continue
        uwid, uorder, u = entry
        if uwid not in file_seq:
            file_seq.append(uwid)
        key = (file_seq.index(uwid), uorder)
        if key < last_key:
            errs.append(f"{pid}: out of text order ({it['unit_id']})")
        last_key = key

        # The copyright line: the references resolve, and what is left literal
        # is our own wording (pipeline/latin_text.py).
        la = u["la"]
        sf = forms(la)
        # The line first, so a file that puts the book's words back as text
        # fails even when its references are broken too.
        for what, refs in (("answer", it["answers"]), ("choice", it.get("choices"))):
            for ref in refs or []:
                for lit in literals(ref):
                    check_line(errs, pid, what, lit, sf, corpus, MAX_LITERAL_WORDS)
        answers = resolve_all(errs, pid, la, it["answers"], "answer")
        choices = resolve_all(errs, pid, la, it.get("choices"), "choice")
        if answers is None or choices is None:
            continue
        # A question is ours: it repeats the phrase it asks about, but it is
        # never a clause of the sentence lifted whole.
        qw_words = forms(it["q"])
        if len(qw_words) > MAX_QUESTION_WORDS:
            errs.append(f"{pid}: q is {len(qw_words)} words "
                        f"(the line is {MAX_QUESTION_WORDS}): {it['q']!r}")
        if find_run(sf, qw_words) is not None:
            errs.append(f"{pid}: q is a run of its own sentence, word for word "
                        f"— reword it: {it['q']!r}")

        if it["input"] == "tap":
            if answers and answers[0] not in words(la):
                errs.append(f"{pid}: tap answer {answers[0]!r} "
                            f"not a word of {la!r}")
        if it["input"] == "choice":
            if len(choices) != 4 or len(set(choices)) != 4:
                errs.append(f"{pid}: needs 4 distinct choices")
            if answers and answers[0] not in choices:
                errs.append(f"{pid}: answers[0] not among choices")
        elif "choices" in it:
            errs.append(f"{pid}: choices on a non-choice item")

    if len(items) < 24:
        errs.append(f"only {len(items)} items (< 24)")
    if len(qw) < 8:
        errs.append(f"only {len(qw)} question words (< 8): {sorted(qw)}")
    summary = (f"ch {n:02d} {d.get('title','?'):<22} items={len(items):>2}  "
               f"tap={split['tap']:>2} choice={split['choice']:>2} type={split['type']:>2}  "
               f"qwords({len(qw)})={' '.join(sorted(qw))}")
    return errs, summary


def sweep_public(corpus):
    """The other public grammar files: nothing may quote five book words in a row.

    The lessons are our prose with short illustrative phrases; the vocabulary
    decks are dictionary forms and Whitaker-derived glosses; skills.json is
    labels and match patterns. None of them has a sentence to point at, so the
    only rule that binds them is clause 1 of the line. Ancient verse Ørberg
    reprints (latin_text.CLASSICAL) is public domain and exempt.
    """
    errs = []
    files = (sorted((GRAMMAR / "lessons").glob("*.json"))
             + sorted((GRAMMAR / "vocab").glob("*.json"))
             + [GRAMMAR / "skills.json"])
    for f in files:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            errs.append(f"{f.name}: unreadable ({e})")
            continue
        for text in latin_strings(d):
            run = corpus.book_run(text)
            if run:
                errs.append(f"{f.relative_to(GRAMMAR)}: reproduces "
                            f"{MAX_BOOK_RUN + 1}+ consecutive words of the book "
                            f"({run!r}) in {text[:90]!r}")
    return errs, f"public grammar files  scanned={len(files)}"


def main():
    chapters = [int(a) for a in sys.argv[1:]] or sorted(
        int(p.stem) for p in QDIR.glob("[0-9][0-9].json"))
    index, weeks = load_index()
    corpus = Corpus(BUILD)
    bad = 0
    for n in chapters:
        errs, summary = check(n, index, weeks, corpus)
        safe_print(summary)
        for e in errs:
            safe_print("   ERROR", e)
        bad += len(errs)
    if not sys.argv[1:]:
        errs, summary = sweep_public(corpus)
        safe_print(summary)
        for e in errs:
            safe_print("   ERROR", e)
        bad += len(errs)
    safe_print("OK" if not bad else f"{bad} error(s)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
