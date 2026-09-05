"""Generate app/data/grammar/lessons/index.json — the lessons manifest.

    python pipeline/build_lessons_index.py            (write the manifest)
    python pipeline/build_lessons_index.py --check    (fail if it is out of date)

The manifest lists the lesson files present in app/data/grammar/lessons/
(one `<skill>.json` per skill, GRAMMAR-CONTRACT.md "Lesson JSON"), so the
grammar section (app/js/grammar/lessons.js) knows which skills have a lesson
without asking the server for each one: a skill missing from the manifest
renders the "lesson coming" placeholder, never a 404. Every lesson's `skill`
field must match its file name, and every id must be a skill in skills.json.

Re-run after adding or removing a lesson file; app/sw.js must list the new
file too (tests/sw.precache.test.mjs), and CACHE_VERSION bumps.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LESSONS = ROOT / "app" / "data" / "grammar" / "lessons"
SKILLS = ROOT / "app" / "data" / "grammar" / "skills.json"
OUT = LESSONS / "index.json"


def lesson_ids() -> list[str]:
    ids = []
    for path in sorted(LESSONS.glob("*.json")):
        if path.name == OUT.name or path.name.endswith(".sample.json"):
            continue
        ids.append(path.stem)
    return ids


def validate(ids: list[str]) -> list[str]:
    errs = []
    known = set()
    if SKILLS.exists():
        known = {s["id"] for s in json.loads(SKILLS.read_text(encoding="utf-8"))["skills"]}
    for i in ids:
        path = LESSONS / f"{i}.json"
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            errs.append(f"{path.name}: unreadable ({e})")
            continue
        if not isinstance(doc, dict) or doc.get("skill") != i:
            errs.append(f"{path.name}: `skill` is {doc.get('skill') if isinstance(doc, dict) else None!r}, expected {i!r}")
        if known and i not in known:
            errs.append(f"{path.name}: no such skill in skills.json")
    return errs


def build() -> dict:
    return {"version": 1, "lessons": lesson_ids()}


def main() -> None:
    doc = build()
    errs = validate(doc["lessons"])
    if errs:
        print("INVALID:")
        for e in errs:
            print("  " + e)
        sys.exit(1)
    if "--check" in sys.argv:
        current = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
        if current != doc:
            missing = sorted(set(doc["lessons"]) - set((current or {}).get("lessons", [])))
            extra = sorted(set((current or {}).get("lessons", [])) - set(doc["lessons"]))
            print(f"{OUT.relative_to(ROOT)} is out of date: run python pipeline/build_lessons_index.py"
                  + (f" (missing {', '.join(missing)})" if missing else "") + (f" (stale {', '.join(extra)})" if extra else ""))
            sys.exit(1)
        print(f"lessons: {len(doc['lessons'])} - manifest up to date")
        return
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(doc['lessons'])} lessons)")


if __name__ == "__main__":
    main()
