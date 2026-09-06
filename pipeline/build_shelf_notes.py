"""Merge the shelf teaching layer (data/shelf-notes-NN.json) into the library.

    python pipeline/build_shelf_notes.py --check        # validate all 24, write nothing
    python pipeline/build_shelf_notes.py all            # validate + write data/build/sql/nNN-*.sql
    python pipeline/build_shelf_notes.py 7 12           # just those chapters
    for f in data/build/sql/n07-*.sql; do supabase db query --linked -f "$f"; done

Inputs (both read-only):
  data/shelf-notes-NN.json   the content agents' file, GRAMMAR-CONTRACT.md
                             "Wave 3 — shelf notes, plain explanations and summaries"
  data/build/review-NN.json  the built shelf week (week n = 100 + chapter, id rNN)

**data/build/review-NN.json is never rewritten** — other agents read it while
this runs — so the merge exists only as SQL against the live library:

  units      note / note_simple for the noted units, and `part` set to the
             lēctiō the unit falls in (the reader groups units by matching
             `unit.part` to `week.parts[].part`; renaming the parts without
             this would render an empty passage)
  highlights replaced for the week (delete then insert), the columns seed_sql
             uses
  weeks      parts rebuilt as {part, lines, source, summary_en, summary_la}
             (CONTRACT.md "Section summaries") and updated_at bumped, which is
             what makes a client refetch the week (app/js/store.js)

Validation is a gate, not a warning: a chapter that fails writes no SQL.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BUILD = DATA / "build"
OUT = BUILD / "sql"
USER = "(select id from auth.users order by created_at limit 1)"
CHUNK = 25
SHELF_BASE = 100
CHAPTERS = range(1, 25)

NOTE_KEYS = {"unit_id", "note", "note_simple"}
HL_KEYS = {"unit_id", "text", "occurrence", "label", "note", "simple"}
PART_KEYS = {"part", "units", "summary_en", "summary_la"}


def q(v):
    """Literal in seed_sql.py's style."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def _text(v):
    return isinstance(v, str) and v.strip() != ""


def _lines_label(units) -> str | None:
    """"1–41" over a run of units: the printed lines they occupy."""
    nums = []
    for u in units:
        if u.get("line_no") is not None:
            nums.append(u["line_no"])
        for ln in u.get("lines") or []:
            if isinstance(ln, dict) and ln.get("line") is not None:
                nums.append(ln["line"])
    if not nums:
        return None
    lo, hi = min(nums), max(nums)
    return str(lo) if lo == hi else f"{lo}–{hi}"


def load(chapter: int, root: Path = ROOT):
    src = root / "data" / f"shelf-notes-{chapter:02d}.json"
    rev = root / "data" / "build" / f"review-{chapter:02d}.json"
    if not src.exists():
        raise FileNotFoundError(f"missing {src}")
    if not rev.exists():
        raise FileNotFoundError(f"missing {rev}")
    return json.loads(src.read_text(encoding="utf-8")), json.loads(rev.read_text(encoding="utf-8"))


def validate(chapter: int, notes: dict, review: dict) -> tuple[list[str], dict]:
    """Errors (empty = clean) and, when clean, the merge plan for this chapter."""
    err: list[str] = []
    units = review.get("units") or []
    by_id = {u["id"]: u for u in units}
    order_of = {u["id"]: i for i, u in enumerate(units)}
    week_n = SHELF_BASE + chapter

    if notes.get("chapter") != chapter:
        err.append(f"chapter is {notes.get('chapter')!r}, expected {chapter}")
    if review.get("week", {}).get("n") != week_n:
        err.append(f"review week n is {review.get('week', {}).get('n')!r}, expected {week_n}")
    for key in ("parts", "notes", "highlights"):
        if not isinstance(notes.get(key), list):
            err.append(f"{key}: missing or not a list")
    if err:
        return err, {}

    # --- parts: shape, contiguity, full cover -------------------------------
    plan_parts, ranges = [], []
    for i, p in enumerate(notes["parts"]):
        where = f"parts[{i}]"
        if not isinstance(p, dict):
            err.append(f"{where}: not an object")
            continue
        extra = set(p) - PART_KEYS
        if extra:
            err.append(f"{where}: unexpected keys {sorted(extra)}")
        for k in ("part", "summary_en", "summary_la"):
            if not _text(p.get(k)):
                err.append(f"{where}: {k} missing or empty")
        rng = p.get("units")
        if not (isinstance(rng, list) and len(rng) == 2 and all(isinstance(x, str) for x in rng)):
            err.append(f"{where}: units must be [first_id, last_id]")
            continue
        first, last = rng
        for uid in rng:
            if uid not in by_id:
                err.append(f"{where}: unit id {uid!r} is not in review-{chapter:02d}.json")
        if first in order_of and last in order_of:
            a, b = order_of[first], order_of[last]
            if a > b:
                err.append(f"{where}: {first!r} comes after {last!r}")
            else:
                ranges.append((a, b, p))
    names = [p.get("part") for p in notes["parts"] if isinstance(p, dict)]
    if len(set(names)) != len(names):
        err.append("parts: two sections share a name (the reader keys summaries by name)")

    if len(ranges) == len(notes["parts"]):
        prev_end = -1
        for k, (a, b, p) in enumerate(ranges):
            if a != prev_end + 1:
                if a <= prev_end:
                    err.append(f"parts[{k}] ({p.get('part')!r}) overlaps the previous section")
                else:
                    gap = [units[j]["id"] for j in range(prev_end + 1, a)]
                    err.append(f"parts[{k}] ({p.get('part')!r}) leaves {len(gap)} unit(s) uncovered: {gap[:4]}")
            prev_end = b
        if ranges and prev_end != len(units) - 1:
            tail = [u["id"] for u in units[prev_end + 1:]]
            err.append(f"parts: the last section ends at {units[prev_end]['id']!r}, "
                       f"leaving {len(tail)} unit(s) uncovered: {tail[:4]}")
        for a, b, p in ranges:
            plan_parts.append({
                "part": p["part"],
                "lines": _lines_label(units[a:b + 1]),
                "source": review["week"].get("source") or units[a].get("source") or "FR",
                "summary_en": p["summary_en"],
                "summary_la": p["summary_la"],
                "_range": (a, b),
            })

    # --- notes --------------------------------------------------------------
    seen = set()
    plan_notes = []
    for i, nd in enumerate(notes["notes"]):
        where = f"notes[{i}]"
        if not isinstance(nd, dict):
            err.append(f"{where}: not an object")
            continue
        extra = set(nd) - NOTE_KEYS
        if extra:
            err.append(f"{where}: unexpected keys {sorted(extra)}")
        uid = nd.get("unit_id")
        if uid not in by_id:
            err.append(f"{where}: unit id {uid!r} is not in review-{chapter:02d}.json")
        elif uid in seen:
            err.append(f"{where}: unit {uid} is noted twice")
        else:
            seen.add(uid)
        for k in ("note", "note_simple"):
            if not _text(nd.get(k)):
                err.append(f"{where} ({uid}): {k} missing or empty")
        if uid in by_id and _text(nd.get("note")) and _text(nd.get("note_simple")):
            plan_notes.append({"unit_id": uid, "note": nd["note"].strip(),
                               "note_simple": nd["note_simple"].strip()})

    # --- highlights ---------------------------------------------------------
    plan_hl, hl_seen = [], set()
    for i, hd in enumerate(notes["highlights"]):
        where = f"highlights[{i}]"
        if not isinstance(hd, dict):
            err.append(f"{where}: not an object")
            continue
        extra = set(hd) - HL_KEYS
        if extra:
            err.append(f"{where}: unexpected keys {sorted(extra)}")
        uid, text = hd.get("unit_id"), hd.get("text")
        occ = hd.get("occurrence", 1)
        ok = True
        if uid not in by_id:
            err.append(f"{where}: unit id {uid!r} is not in review-{chapter:02d}.json")
            ok = False
        if not _text(text):
            err.append(f"{where}: text missing or empty")
            ok = False
        if not _text(hd.get("label")):
            err.append(f"{where} ({uid}): label missing or empty")
            ok = False
        if not _text(hd.get("note")):
            err.append(f"{where} ({uid}): note missing or empty")
            ok = False
        if "simple" in hd and hd["simple"] is not None and not _text(hd["simple"]):
            err.append(f"{where} ({uid}): simple is present but empty")
            ok = False
        if not (isinstance(occ, int) and not isinstance(occ, bool) and occ >= 1):
            err.append(f"{where} ({uid}): occurrence {occ!r} must be an integer >= 1")
            ok = False
        if ok:
            la = by_id[uid]["la"]
            found = la.count(text)
            if found < occ:
                err.append(f"{where} ({uid}): {text!r} occurs {found}× in the sentence, "
                           f"needs occurrence {occ} — la={la!r}")
                ok = False
        if ok:
            key = (uid, text, occ)
            if key in hl_seen:
                err.append(f"{where}: {uid} {text!r} occurrence {occ} is highlighted twice")
                ok = False
            else:
                hl_seen.add(key)
        if ok:
            plan_hl.append({"unit_id": uid, "text": text, "occurrence": occ,
                            "label": hd["label"].strip(), "note": hd["note"].strip(),
                            "simple": (hd.get("simple") or "").strip() or None})

    if err:
        return err, {}
    return [], {"chapter": chapter, "week_n": week_n, "units": units,
                "parts": plan_parts, "notes": plan_notes, "highlights": plan_hl}


def chapter_sql(plan: dict) -> list[str]:
    """SQL for one chapter, chunked like seed_sql.py."""
    n = plan["week_n"]
    units = plan["units"]
    parts_json = [{k: v for k, v in p.items() if not k.startswith("_")} for p in plan["parts"]]
    where_week = f"user_id = {USER} and week_n = {n}"

    head = [
        f"-- shelf notes: chapter {plan['chapter']:02d} (week {n}); "
        f"{len(plan['notes'])} notes, {len(plan['highlights'])} highlights, {len(parts_json)} parts\n"
        f"update public.weeks set parts = {q(parts_json)}, updated_at = now()\n"
        f"  where user_id = {USER} and n = {n};\n"
        f"delete from public.highlights where {where_week};\n"
        f"update public.units set note = null, note_simple = null, updated_at = now()\n"
        f"  where {where_week} and (note is not null or note_simple is not null);\n"
    ]
    # The lēctiō a unit belongs to, by its 0-based order in the week.
    for p in plan["parts"]:
        a, b = p["_range"]
        head.append(
            f"update public.units set part = {q(p['part'])}, updated_at = now()\n"
            f"  where {where_week} and \"order\" between {units[a]['order']} and {units[b]['order']};\n")
    out = ["".join(head)]

    stmts = [
        f"update public.units set note = {q(nd['note'])}, note_simple = {q(nd['note_simple'])}, "
        f"updated_at = now() where {where_week} and id = {q(nd['unit_id'])};"
        for nd in plan["notes"]
    ]
    for i in range(0, len(stmts), CHUNK):
        out.append("\n".join(stmts[i:i + CHUNK]) + "\n")

    hrows = [
        f"({USER}, {n}, {q(h['unit_id'])}, {q(h['text'])}, {h['occurrence']}, "
        f"{q(h['label'])}, {q(h['note'])}, {q(h['simple'])})"
        for h in plan["highlights"]
    ]
    for i in range(0, len(hrows), CHUNK):
        out.append("insert into public.highlights (user_id, week_n, unit_id, text, occurrence, label, note, simple) values\n"
                   + ",\n".join(hrows[i:i + CHUNK]) + ";\n")
    return out


def run(chapters, check: bool, root: Path = ROOT) -> int:
    rows, failed = [], 0
    for c in chapters:
        try:
            notes, review = load(c, root)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"chapter {c:02d}: FAIL  {e}")
            failed += 1
            continue
        err, plan = validate(c, notes, review)
        if err:
            failed += 1
            print(f"chapter {c:02d}: FAIL  {len(err)} problem(s)")
            for m in err[:20]:
                print(f"    - {m}")
            if len(err) > 20:
                print(f"    … {len(err) - 20} more")
            continue
        files = 0
        if not check:
            out = root / "data" / "build" / "sql"
            out.mkdir(parents=True, exist_ok=True)
            for old in out.glob(f"n{c:02d}-*.sql"):
                old.unlink()
            for i, sql in enumerate(chapter_sql(plan)):
                (out / f"n{c:02d}-{i:02d}.sql").write_text(sql, encoding="utf-8")
                files += 1
        rows.append((c, plan["week_n"], len(plan["units"]), len(plan["notes"]),
                     len(plan["highlights"]), len(plan["parts"]), files))
        pct = round(100 * len(plan["notes"]) / max(1, len(plan["units"])))
        print(f"chapter {c:02d}: ok  week {plan['week_n']}  {len(plan['units'])} units  "
              f"{len(plan['notes'])} notes ({pct}%)  {len(plan['highlights'])} highlights  "
              f"{len(plan['parts'])} parts" + (f"  -> {files} sql" if files else ""))
    if rows:
        print("\n ch | week | units | notes | %  | highl | parts")
        print("----+------+-------+-------+----+-------+------")
        for c, w, u, nn, hh, pp, _ in rows:
            print(f" {c:02d} | {w:4d} | {u:5d} | {nn:5d} | {round(100*nn/max(1,u)):2d} | {hh:5d} | {pp:5d}")
        tu, tn, th = (sum(r[i] for r in rows) for i in (2, 3, 4))
        print(f"tot | ---- | {tu:5d} | {tn:5d} | {round(100*tn/max(1,tu)):2d} | {th:5d} |")
    print(f"\n{len(rows)} chapter(s) ok, {failed} failed" + ("  (check only, nothing written)" if check else ""))
    return 1 if failed else 0


def main(argv):
    check = "--check" in argv
    args = [a for a in argv if not a.startswith("--")]
    if not args or args == ["all"]:
        chapters = list(CHAPTERS)
    else:
        chapters = [int(a) for a in args]
    return run(chapters, check)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
