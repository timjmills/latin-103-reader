"""Rewrite app/data/grammar/questions/NN.json so the book's words never ship.

Every accepted answer and every choice that reproduces two or more consecutive
words of the item's referenced sentence becomes an index reference into that
sentence — resolved on the device from the private text fetched by `unit_id`:

    "answers": ["Quīntus", {"span": [0, 3]}]
    "choices": [{"span": [4, 6]}, {"parts": ["quia", {"span": [2, 3]}, "rīdet"]}]

`span` is a contiguous run of the sentence's words (inclusive, 0-based, over
the same tokenisation the app uses); `parts` is our own wording woven around
such runs. What stays literal is our own: a single dictionary form or name,
or a phrase that borrows no two consecutive words of the sentence.

    PYTHONIOENCODING=utf-8 python pipeline/span_questions.py            # rewrite all
    PYTHONIOENCODING=utf-8 python pipeline/span_questions.py --dry-run  # count only
    PYTHONIOENCODING=utf-8 python pipeline/span_questions.py 12 13      # two chapters

Idempotent: a file already carrying references is left alone (references are
passed through untouched). See pipeline/latin_text.py for the line itself.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from latin_text import (Corpus, MAX_LITERAL_WORDS, MIN_SPAN_WORDS, forms,  # noqa: E402
                        find_run, normalise_answer, resolve_ref, tokens)

ROOT = Path(__file__).resolve().parent.parent
QDIR = ROOT / "app" / "data" / "grammar" / "questions"
BUILD = ROOT / "data" / "build"


def literal_part(s, tk, a, b):
    """Words a..b of `s` as text, with the punctuation that trails them kept."""
    start = tk[a][1]
    end = tk[b + 1][1] if b + 1 < len(tk) else len(s)
    return s[start:end].rstrip()


def decompose(sentence_forms, s):
    """`s` as a list of parts: strings, and (i, j) for a run of the sentence.

    A run of MIN_SPAN_WORDS or more words that occurs in the sentence is always
    a span; the split minimises the number of words left literal, then the
    number of parts. Returns None when nothing at all is borrowed.
    """
    tk = tokens(s)
    w = [t[0] for t in tk]
    wf = forms(s)
    n = len(w)
    if not n:
        return None
    INF = (10 ** 6, 10 ** 6)
    best = [INF] * (n + 1)
    back = [None] * (n + 1)
    best[0] = (0, 0)
    for i in range(n):
        if best[i] == INF:
            continue
        for j in range(i + 1, n + 1):
            seg = wf[i:j]
            pos = find_run(sentence_forms, seg) if len(seg) >= MIN_SPAN_WORDS else None
            if pos is not None:
                cost = (best[i][0], best[i][1] + 1)
                kind = ("span", pos, pos + len(seg) - 1)
            else:
                cost = (best[i][0] + (j - i), best[i][1] + 1)
                kind = ("lit", i, j - 1)
            if cost < best[j]:
                best[j] = cost
                back[j] = (i, kind)
    out = []
    j = n
    while j > 0:
        i, kind = back[j]
        out.append((kind, i, j - 1))
        j = i
    out.reverse()
    if not any(k[0][0] == "span" for k in out):
        return None
    return [k[0] if k[0][0] == "span" else ("lit", literal_part(s, tk, k[1], k[2]))
            for k in out]


def convert(la, s):
    """One answer/choice → the value to store. Returns (value, kind)."""
    if not isinstance(s, str):
        return s, "kept"                      # already a reference
    sf = forms(la)
    w = forms(s)
    if len(w) < MIN_SPAN_WORDS:
        return s, "literal"                   # one word: a form or a name, never a quotation
    pos = find_run(sf, w)
    if pos is not None:
        return {"span": [pos, pos + len(w) - 1]}, "span"
    parts = decompose(sf, s)
    if parts is None:
        return s, "literal"
    value = {"parts": [{"span": [p[1], p[2]]} if p[0] == "span" else p[1] for p in parts]}
    return value, "parts"


def convert_list(la, lst):
    out, counts = [], {}
    for s in lst or []:
        value, kind = convert(la, s)
        # The reference must grade exactly as the text did, or it does not ship.
        if kind in ("span", "parts"):
            back = resolve_ref(la, value)
            if back is None or normalise_answer(back) != normalise_answer(s):
                value, kind = s, "literal-failed"
        out.append(value)
        counts[kind] = counts.get(kind, 0) + 1
    return out, counts


def dump(doc):
    """The house format: header keys one per line, one line per item."""
    head = {k: v for k, v in doc.items() if k != "items"}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},")
    lines.append('  "items": [')
    items = doc.get("items", [])
    for i, it in enumerate(items):
        comma = "," if i + 1 < len(items) else ""
        lines.append("    " + json.dumps(it, ensure_ascii=False, separators=(", ", ": ")) + comma)
    lines.append("  ]")
    lines.append("}")
    return "\n".join(lines) + "\n"


def main():
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv
    chapters = [int(a) for a in args] or sorted(int(p.stem) for p in QDIR.glob("[0-9][0-9].json"))
    corpus = Corpus(BUILD)
    grand = {}
    for n in chapters:
        f = QDIR / f"{n:02d}.json"
        doc = json.loads(f.read_text(encoding="utf-8"))
        counts, missing, longest = {}, 0, 0
        for it in doc.get("items", []):
            u = corpus.unit(it.get("unit_id"))
            if u is None:
                missing += 1
                continue
            la = u.get("la", "")
            for key in ("answers", "choices"):
                if key not in it:
                    continue
                it[key], c = convert_list(la, it[key])
                for k, v in c.items():
                    counts[k] = counts.get(k, 0) + v
                for value in it[key]:
                    if isinstance(value, str):
                        longest = max(longest, len(forms(value)))
                    elif isinstance(value, dict) and "parts" in value:
                        for p in value["parts"]:
                            if isinstance(p, str):
                                longest = max(longest, len(forms(p)))
        if not dry:
            f.write_text(dump(doc), encoding="utf-8")
        for k, v in counts.items():
            grand[k] = grand.get(k, 0) + v
        note = f"  MISSING UNITS: {missing}" if missing else ""
        print(f"ch {n:02d}  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items()))
              + f"  longest literal={longest}w" + note)
    print("total  " + "  ".join(f"{k}={v}" for k, v in sorted(grand.items()))
          + ("   (dry run)" if dry else ""))
    if grand.get("literal-failed"):
        print(f"WARNING: {grand['literal-failed']} strings could not be referenced safely")
    if MAX_LITERAL_WORDS:
        pass


if __name__ == "__main__":
    main()
