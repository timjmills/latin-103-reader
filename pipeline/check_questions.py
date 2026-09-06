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

Prints a per-chapter summary: item count, question words, input split.

    python pipeline/check_questions.py            # all chapters present
    python pipeline/check_questions.py 3 7        # chapters 3 and 7
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QDIR = ROOT / "app" / "data" / "grammar" / "questions"
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


def check(n, index, weeks):
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
        if not it["answers"] or not all(isinstance(a, str) and a.strip()
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

        if it["input"] == "tap":
            if it["answers"] and it["answers"][0] not in words(u["la"]):
                errs.append(f"{pid}: tap answer {it['answers'][0]!r} "
                            f"not a word of {u['la']!r}")
        if it["input"] == "choice":
            ch = it.get("choices") or []
            if len(ch) != 4 or len(set(ch)) != 4:
                errs.append(f"{pid}: needs 4 distinct choices")
            if it["answers"] and it["answers"][0] not in ch:
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


def main():
    chapters = [int(a) for a in sys.argv[1:]] or sorted(
        int(p.stem) for p in QDIR.glob("[0-9][0-9].json"))
    index, weeks = load_index()
    bad = 0
    for n in chapters:
        errs, summary = check(n, index, weeks)
        safe_print(summary)
        for e in errs:
            safe_print("   ERROR", e)
        bad += len(errs)
    safe_print("OK" if not bad else f"{bad} error(s)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
