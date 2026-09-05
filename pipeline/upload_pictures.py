#!/usr/bin/env python
"""
upload_pictures.py — load a week's pictures into the single user's Supabase library.

    python pipeline/upload_pictures.py 1 3 10 --user-id <auth user uuid>   # SQL + PNG upload
    python pipeline/upload_pictures.py all --sql-only                       # just write the SQL files

For each week it
  1. writes data/build/sql/pictures-wNN.sql — delete + insert of the rows of
     public.pictures (migration 0008) for the first (only) auth user, the same
     USER pattern as seed_sql.py; `path` is "week-NN/<file>" inside the private
     bucket `pictures`, under the user's folder;
  2. runs that SQL with `supabase db query --linked -f …`;
  3. uploads every PNG with
        supabase storage cp <file> ss:///pictures/<user-id>/week-NN/<file> --linked --experimental
     after `supabase storage rm` of the same object (cp refuses to overwrite).

Input: data/build/pictures-week-NN.json (from extract_pictures.py) and the PNGs it names.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# The Supabase CLI: on Windows the launcher is supabase.cmd, which subprocess only finds by full path.
SUPABASE = shutil.which("supabase") or "supabase"

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "data" / "build"
SQL_DIR = BUILD / "sql"
USER_SQL = "(select id from auth.users order by created_at limit 1)"


def q(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def load_week(n: int) -> list[dict]:
    p = BUILD / f"pictures-week-{n:02d}.json"
    if not p.exists():
        raise FileNotFoundError(f"{p} not found — run pipeline/extract_pictures.py {n} first")
    return json.loads(p.read_text(encoding="utf-8"))


def write_sql(n: int, pics: list[dict]) -> Path:
    SQL_DIR.mkdir(parents=True, exist_ok=True)
    lines = [f"delete from public.pictures where week_n = {n} and user_id = {USER_SQL};",
             # Clients refresh a week's pictures only when the week itself looks changed.
             f"update public.weeks set updated_at = now() where n = {n} and user_id = {USER_SQL};"]
    if pics:
        rows = []
        for p in pics:
            path = f"week-{n:02d}/{Path(p['file']).name}"
            rows.append(f"({USER_SQL}, {q(p['id'])}, {n}, {q(p['unit_id'])}, {q(path)}, {q(p.get('caption'))}, "
                        f"{q(p.get('caption_en'))}, {q(p.get('page'))}, {q(p.get('width'))}, {q(p.get('height'))}, {q(p.get('sort', 0))})")
        lines.append("insert into public.pictures (user_id, id, week_n, unit_id, path, caption, caption_en, page, width, height, sort) values\n"
                     + ",\n".join(rows) + ";")
    out = SQL_DIR / f"pictures-w{n:02d}.sql"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out


def run(cmd: list[str], input_text: str | None = None) -> str:
    r = subprocess.run(cmd, input=input_text, capture_output=True, text=True, errors="replace", cwd=ROOT)
    out = r.stdout + r.stderr
    if r.returncode != 0 or re.search(r"\berror\b", out, re.I):
        raise RuntimeError(f"{' '.join(cmd[:3])}…: {out.strip()[-800:]}")
    return out


def upload(n: int, pics: list[dict], sql_path: Path, user_id: str, quiet: bool) -> None:
    run([SUPABASE, "db", "query", "--linked", "-f", str(sql_path), "-o", "json"])
    if not quiet:
        print(f"  rows loaded ({sql_path.name}: {len(pics)} pictures)")
    for p in pics:
        src = ROOT / p["file"]
        if not src.exists():
            raise FileNotFoundError(f"{src} missing — re-run extract_pictures.py {n}")
        dest = f"ss:///pictures/{user_id}/week-{n:02d}/{src.name}"
        # cp refuses to overwrite: drop any previous object first (ignore "not found")
        subprocess.run([SUPABASE, "storage", "rm", dest, "--linked", "--experimental"], input="y\n",
                       capture_output=True, text=True, cwd=ROOT)
        run([SUPABASE, "storage", "cp", str(src), dest, "--linked", "--experimental"])
        if not quiet:
            print(f"  uploaded pictures/{user_id}/week-{n:02d}/{src.name}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="+", help="week numbers or 'all'")
    ap.add_argument("--user-id", default=os.environ.get("LATIN_USER_ID"), help="auth user uuid (bucket folder); or env LATIN_USER_ID")
    ap.add_argument("--sql-only", action="store_true", help="write the SQL files, upload nothing")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    if a.weeks == ["all"]:
        nums = sorted(int(p.stem.split("-")[2]) for p in BUILD.glob("pictures-week-??.json"))
    else:
        nums = [int(x) for x in a.weeks]
    if not a.sql_only and not a.user_id:
        ap.error("--user-id <auth user uuid> is needed to upload (or --sql-only)")
    rc = 0
    for n in nums:
        try:
            pics = load_week(n)
            sql_path = write_sql(n, pics)
            if not a.quiet:
                print(f"week {n:02d}: {len(pics)} pictures → {sql_path.relative_to(ROOT)}")
            if not a.sql_only:
                upload(n, pics, sql_path, a.user_id, a.quiet)
        except Exception as e:  # keep going through the other weeks, report at the end
            print(f"week {n:02d}: FAILED — {e}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
