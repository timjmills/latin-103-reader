"""Generate SQL that loads built weeks into the single user's Supabase library.

    python pipeline/seed_sql.py 3 5 10      # or: all
    for f in data/build/sql/w03-*.sql; do supabase db query --linked -f "$f"; done

Rows are owned by the first (only) auth user. Re-running a week deletes and
re-inserts it, so it is idempotent. Output is chunked so each file stays well
under the Management API request limit.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "data" / "build"
OUT = BUILD / "sql"
USER = "(select id from auth.users order by created_at limit 1)"
CHUNK = 25


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def week_sql(n: int) -> list[str]:
    data = json.loads((BUILD / f"week-{n:02d}.json").read_text(encoding="utf-8"))
    wk, units = data["week"], data["units"]
    hl_path = BUILD / f"highlights-week-{n:02d}.json"
    hl = json.loads(hl_path.read_text(encoding="utf-8")) if hl_path.exists() else []
    parts = [f"""delete from public.highlights where week_n = {n} and user_id = {USER};
delete from public.units where week_n = {n} and user_id = {USER};
delete from public.weeks where n = {n} and user_id = {USER};
insert into public.weeks (user_id, n, id, title, source, chapter, has_line_numbers, focus, parts)
values ({USER}, {n}, {q(wk['id'])}, {q(wk['title'])}, {q(wk['source'])}, {q(wk.get('chapter'))},
        {q(wk.get('has_line_numbers', True))}, {q(wk.get('focus'))}, {q(wk.get('parts', []))});
"""]
    head = ('insert into public.units (user_id, id, week_n, "order", part, line_no, block_start, '
            'unit_type, speaker, la, en, en_raw, note, tags, margin) values\n')
    rows = [
        f"({USER}, {q(u['id'])}, {n}, {u['order']}, {q(u.get('part'))}, {q(u.get('line_no'))}, "
        f"{q(bool(u.get('block_start')))}, {q(u.get('unit_type', 'sentence'))}, {q(u.get('speaker'))}, "
        f"{q(u['la'])}, {q(u.get('en') or '')}, {q(u.get('en_raw'))}, {q(u.get('note'))}, {q(u.get('tags', []))}, "
        f"{q(u.get('margin') or [])})"
        for u in units
    ]
    for i in range(0, len(rows), CHUNK):
        parts.append(head + ",\n".join(rows[i:i + CHUNK]) + ";\n")
    if hl:
        hrows = [
            f"({USER}, {n}, {q(h['unit_id'])}, {q(h['text'])}, {h.get('occurrence', 1)}, {q(h['label'])}, {q(h['note'])})"
            for h in hl
        ]
        for i in range(0, len(hrows), CHUNK):
            parts.append("insert into public.highlights (user_id, week_n, unit_id, text, occurrence, label, note) values\n"
                         + ",\n".join(hrows[i:i + CHUNK]) + ";\n")
    return parts


def main(argv):
    OUT.mkdir(parents=True, exist_ok=True)
    if not argv or argv == ["all"]:
        ns = sorted(int(p.stem.split("-")[1]) for p in BUILD.glob("week-??.json"))
    else:
        ns = [int(a) for a in argv]
    for n in ns:
        for old in OUT.glob(f"w{n:02d}-*.sql"):
            old.unlink()
        parts = week_sql(n)
        for i, sql in enumerate(parts):
            (OUT / f"w{n:02d}-{i:02d}.sql").write_text(sql, encoding="utf-8")
        print(f"week {n:02d}: {len(parts)} sql files")


if __name__ == "__main__":
    main(sys.argv[1:])
