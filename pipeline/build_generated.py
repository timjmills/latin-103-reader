#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pre-generate a bank of sentences per sentence skill for the app
(GRAMMAR-CONTRACT.md §11b).

The browser cannot run generate_sentences.py, so this runs it here, once per
skill that has a templates file, over several seeds, and writes

    app/data/grammar/generated/<skill>.json

in the §11a generated-sentence shape: `{ skill, chapter, seeds, count,
sentences: [...] }`, the sentences de-duplicated by their Latin and capped
at CAP a skill. The bank is our own Latin (the templates and the deck are
ours), so the files are public and precached like the written sentences.

    python pipeline/build_generated.py                 # every skill with templates
    python pipeline/build_generated.py ablative-means  # one or more skills
    python pipeline/build_generated.py --cap 400 --seeds 8 --per-seed 120

Re-run after any change to a templates file, to pipeline/sem.json or to the
generator itself; the coverage check (row 3 and row 5 of §13) reads the bank
and fails a sentence skill whose bank is missing or under MIN_BANK.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import generate_sentences as GS  # noqa: E402

ROOT = HERE.parent
OUT_DIR = ROOT / "app" / "data" / "grammar" / "generated"
CAP = 400          # sentences a skill, at most
SEEDS = 8          # seeds tried, in order 1..SEEDS
PER_SEED = 120     # sentences asked of the generator per seed (before de-duplication)
MIN_BANK = 100     # what the coverage check calls a full bank

#: What the app keeps of a generated sentence (the §11a shape). `seed` and
#: `fill` stay: the first says which run made it, the second lets a Latinist
#: find every sentence a rejected word produced.
KEEP = ("id", "la", "en", "words", "focus", "gloss", "generated", "template", "seed", "fill")


def build_bank(skill: str, lex: "GS.Lexicon", cap: int = CAP, seeds: int = SEEDS,
               per_seed: int = PER_SEED) -> dict:
    """The bank for one skill: several seeds, de-duplicated by `la`, capped."""
    out: list[dict] = []
    seen: set[str] = set()
    used_seeds: list[int] = []
    chapter = None
    rejected = 0
    for seed in range(1, seeds + 1):
        if len(out) >= cap:
            break
        res = GS.generate(skill, per_seed, seed, lex)
        chapter = res["chapter"]
        used_seeds.append(seed)
        rejected += len(res["rejected_by_check"])
        for s in res["sentences"]:
            if s["la"] in seen:
                continue
            seen.add(s["la"])
            out.append({k: s[k] for k in KEEP if k in s})
            if len(out) >= cap:
                break
    return {"skill": skill, "chapter": chapter, "seeds": used_seeds, "count": len(out),
            "rejected_by_check": rejected, "source": source_of(skill), "sentences": out}


def _rel(path: Path) -> str:
    """The path as the repo sees it, or in full when it is outside the repo."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _sha(path: Path) -> str:
    """The sha256 of a file, or "" when it is not there."""
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return ""


def source_of(skill: str) -> dict:
    """What a bank was built from: the templates file, the semantic classes and
    the generator's own version. `build_generated.py --check` recomputes this
    and fails when it has moved, so a template edited without a rebuild cannot
    leave a stale bank passing the coverage check (§13)."""
    return {"templates": _sha(ROOT / "app" / "data" / "grammar" / "templates" / f"{skill}.json"),
            "sem": _sha(HERE / "sem.json"),
            "generator": str(getattr(GS, "VERSION", "0"))}


def check_banks(skills: list[str] | None = None, out_dir: Path = OUT_DIR, deep: bool = False) -> list[str]:
    """Every way a committed bank can be out of date with what would build it
    now. The cheap check is the fingerprint: a templates file, `sem.json` or
    the generator itself that has moved since the bank was written. `deep`
    rebuilds the bank from its own recorded seeds and compares — generation is
    deterministic per (skill, seed), so anything but an identical list of
    sentences is drift. Returns one line per problem, empty when all is well."""
    problems: list[str] = []
    ids = skills or sorted(p.stem for p in out_dir.glob("*.json") if p.stem != "index")
    lex = GS.Lexicon() if deep else None
    for skill in ids:
        path = out_dir / f"{skill}.json"
        if not path.exists():
            problems.append(f"{skill}: no bank")
            continue
        bank = json.loads(path.read_text(encoding="utf-8"))
        want, got = source_of(skill), (bank.get("source") or {})
        if not got:
            problems.append(f"{skill}: the bank records no source — re-run build_generated.py")
            continue
        moved = [k for k, v in want.items() if got.get(k) != v]
        if moved:
            problems.append(f"{skill}: built from a different {', '.join(moved)} — re-run build_generated.py")
            continue
        if deep:
            seeds = bank.get("seeds") or []
            fresh = build_bank(skill, lex, cap=bank.get("count", CAP), seeds=max(seeds or [1]))
            if [s["la"] for s in fresh["sentences"]] != [s["la"] for s in bank.get("sentences", [])]:
                problems.append(f"{skill}: a rebuild does not reproduce the committed bank")
    return problems


def write_bank(bank: dict, out_dir: Path = OUT_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{bank['skill']}.json"
    # Compact: 400 sentences with their glosses run to ~280 KB indented, ~170 KB compact (~26 KB gzipped).
    path.write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return path


def write_index(out_dir: Path = OUT_DIR) -> Path:
    """`generated/index.json`: the skills that have a bank, so the app never asks
    for one that is not there (lessons.js `loadGenerated`)."""
    ids = sorted(p.stem for p in out_dir.glob("*.json") if p.stem != "index")
    path = out_dir / "index.json"
    path.write_text(json.dumps({"generated": ids}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("skills", nargs="*", help="skill ids (default: every skill with a templates file)")
    ap.add_argument("--cap", type=int, default=CAP)
    ap.add_argument("--seeds", type=int, default=SEEDS)
    ap.add_argument("--per-seed", type=int, default=PER_SEED)
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--check", action="store_true", help="do not write: report banks out of date with their templates")
    ap.add_argument("--deep", action="store_true", help="with --check, also rebuild each bank and compare")
    a = ap.parse_args(argv)
    if a.check:
        problems = check_banks(a.skills or None, Path(a.out), deep=a.deep)
        for line in problems:
            print(f"FAIL {line}")
        print("ok: every bank matches its templates, sem.json and generator" if not problems
              else f"{len(problems)} bank(s) out of date")
        return 1 if problems else 0
    skills = a.skills or [p.stem for p in sorted(GS.TEMPLATES_DIR.glob("*.json"))]
    if not skills:
        print("no templates files found", file=sys.stderr)
        return 2
    lex = GS.Lexicon()
    short = []
    for skill in skills:
        try:
            bank = build_bank(skill, lex, a.cap, a.seeds, a.per_seed)
        except (GS.TemplateError, KeyError, ValueError, FileNotFoundError) as e:
            print(f"{skill}: ERROR {e}")
            short.append(skill)
            continue
        path = write_bank(bank, Path(a.out))
        flag = "" if bank["count"] >= MIN_BANK else f"  (under {MIN_BANK})"
        if flag:
            short.append(skill)
        print(f"{skill}: {bank['count']} sentences from seeds {bank['seeds']}, "
              f"{bank['rejected_by_check']} fills rejected -> {_rel(path)}{flag}")
    idx = write_index(Path(a.out))
    print(f"index: {len(json.loads(idx.read_text(encoding='utf-8'))['generated'])} banks -> {_rel(idx)}")
    return 1 if short else 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
