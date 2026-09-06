"""Generate the grammar section's loader manifests (GRAMMAR-CONTRACT.md).

    python pipeline/build_grammar_index.py            (write the three manifests)
    python pipeline/build_grammar_index.py --check    (fail if any is out of date)

Manifests (the section reads each once, so a missing file never 404s):

  app/data/grammar/lessons/index.json    { "version": 1, "lessons": ["<skill>", …] }
  app/data/grammar/questions/index.json  { "version": 1, "chapters": [7, 13, …] }   question-word sets NN.json
  app/data/grammar/vocab/index.json      { "version": 1, "chapters": [1, 7, …] }    vocabulary decks NN.json

Validation: every lesson's `skill` matches its file name and is a skill in
skills.json; every question set / vocabulary deck is a JSON object whose
`chapter` matches its file name (NN.json), with the item / word shapes the
contract gives (ids unique, answers non-empty, a choice item with ≥ 2 choices,
a tap item with a unit_id; a word with lemma + meaning).

Re-run after adding or removing a file; app/sw.js must list the new file too
(tests/sw.precache.test.mjs), and CACHE_VERSION bumps. build_lessons_index.py
is kept as an alias of this script.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAMMAR = ROOT / "app" / "data" / "grammar"
LESSONS = GRAMMAR / "lessons"
QUESTIONS = GRAMMAR / "questions"
VOCAB = GRAMMAR / "vocab"
SKILLS = GRAMMAR / "skills.json"
CHAPTER_RE = re.compile(r"^(\d{2})\.json$")
QUESTION_INPUTS = {"type", "choice", "tap"}


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def lesson_ids() -> list[str]:
    return [p.stem for p in sorted(LESSONS.glob("*.json")) if p.name != "index.json" and not p.name.endswith(".sample.json")]


def chapter_files(folder: Path) -> list[int]:
    out = []
    if not folder.exists():
        return out
    for p in sorted(folder.glob("*.json")):
        m = CHAPTER_RE.match(p.name)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def validate_lessons(ids: list[str]) -> list[str]:
    errs = []
    known = {s["id"] for s in _read(SKILLS)["skills"]} if SKILLS.exists() else set()
    for i in ids:
        path = LESSONS / f"{i}.json"
        try:
            doc = _read(path)
        except (OSError, ValueError) as e:
            errs.append(f"{path.name}: unreadable ({e})")
            continue
        if not isinstance(doc, dict) or doc.get("skill") != i:
            errs.append(f"{path.name}: `skill` is {doc.get('skill') if isinstance(doc, dict) else None!r}, expected {i!r}")
        if known and i not in known:
            errs.append(f"{path.name}: no such skill in skills.json")
    return errs


def validate_questions(chapters: list[int]) -> list[str]:
    errs = []
    for c in chapters:
        path = QUESTIONS / f"{c:02d}.json"
        try:
            doc = _read(path)
        except (OSError, ValueError) as e:
            errs.append(f"questions/{path.name}: unreadable ({e})")
            continue
        if not isinstance(doc, dict) or doc.get("chapter") != c:
            errs.append(f"questions/{path.name}: `chapter` is {doc.get('chapter') if isinstance(doc, dict) else None!r}, expected {c}")
            continue
        items = doc.get("items")
        if not isinstance(items, list) or not items:
            errs.append(f"questions/{path.name}: no items")
            continue
        seen = set()
        for n, it in enumerate(items, 1):
            where = f"questions/{path.name} item {n}"
            if not isinstance(it, dict):
                errs.append(f"{where}: not an object"); continue
            iid = it.get("id")
            if not isinstance(iid, str) or not iid:
                errs.append(f"{where}: no id")
            elif iid in seen:
                errs.append(f"{where}: duplicate id {iid}")
            seen.add(iid)
            if not isinstance(it.get("q"), str) or not it["q"].strip():
                errs.append(f"{where}: no q")
            answers = it.get("answers")
            if not isinstance(answers, list) or not answers or not all(isinstance(a, str) and a.strip() for a in answers):
                errs.append(f"{where}: answers must be a non-empty list of strings")
            inp = it.get("input", "type")
            if inp not in QUESTION_INPUTS:
                errs.append(f"{where}: input {inp!r} is not type | choice | tap")
            if inp == "choice" and (not isinstance(it.get("choices"), list) or len(it["choices"]) < 2):
                errs.append(f"{where}: a choice item needs ≥ 2 choices")
            if inp == "tap" and not isinstance(it.get("unit_id"), str):
                errs.append(f"{where}: a tap item needs a unit_id")
    return errs


def validate_vocab(chapters: list[int]) -> list[str]:
    errs = []
    for c in chapters:
        path = VOCAB / f"{c:02d}.json"
        try:
            doc = _read(path)
        except (OSError, ValueError) as e:
            errs.append(f"vocab/{path.name}: unreadable ({e})")
            continue
        if not isinstance(doc, dict) or doc.get("chapter") != c:
            errs.append(f"vocab/{path.name}: `chapter` is {doc.get('chapter') if isinstance(doc, dict) else None!r}, expected {c}")
            continue
        words = doc.get("words")
        if not isinstance(words, list) or not words:
            errs.append(f"vocab/{path.name}: no words")
            continue
        seen = set()
        for n, w in enumerate(words, 1):
            where = f"vocab/{path.name} word {n}"
            if not isinstance(w, dict) or not isinstance(w.get("lemma"), str) or not w["lemma"].strip():
                errs.append(f"{where}: no lemma"); continue
            if not isinstance(w.get("meaning"), str) or not w["meaning"].strip():
                errs.append(f"{where} ({w['lemma']}): no meaning")
            # The same lemma twice with one part of speech (a comparative listed beside its positive) is a pipeline
            # slip the loader tolerates (sets.js keeps the first): a warning, never a failed build.
            key = (w["lemma"], w.get("pos"))
            if key in seen:
                print(f"warning: {where}: duplicate lemma {w['lemma']} ({w.get('pos')})", file=sys.stderr)
            seen.add(key)
    return errs


def build() -> dict[Path, dict]:
    return {
        LESSONS / "index.json": {"version": 1, "lessons": lesson_ids()},
        QUESTIONS / "index.json": {"version": 1, "chapters": chapter_files(QUESTIONS)},
        VOCAB / "index.json": {"version": 1, "chapters": chapter_files(VOCAB)},
    }


def main() -> None:
    docs = build()
    errs = validate_lessons(docs[LESSONS / "index.json"]["lessons"]) + validate_questions(docs[QUESTIONS / "index.json"]["chapters"]) + validate_vocab(docs[VOCAB / "index.json"]["chapters"])
    if errs:
        print("INVALID:")
        for e in errs:
            print("  " + e)
        sys.exit(1)
    if "--check" in sys.argv:
        stale = []
        for out, doc in docs.items():
            current = _read(out) if out.exists() else None
            if current != doc:
                stale.append(out.relative_to(ROOT).as_posix())
        if stale:
            print("out of date: " + ", ".join(stale) + " — run python pipeline/build_grammar_index.py")
            sys.exit(1)
        l, q, v = docs[LESSONS / "index.json"]["lessons"], docs[QUESTIONS / "index.json"]["chapters"], docs[VOCAB / "index.json"]["chapters"]
        print(f"lessons: {len(l)} · question sets: {len(q)} · vocabulary decks: {len(v)} — manifests up to date")
        return
    for out, doc in docs.items():
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        n = len(doc.get("lessons", doc.get("chapters", [])))
        print(f"wrote {out.relative_to(ROOT).as_posix()} ({n})")


if __name__ == "__main__":
    main()
