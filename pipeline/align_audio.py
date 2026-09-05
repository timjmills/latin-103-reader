"""
align_audio.py — local, free, CPU-only audio alignment for the Latin 103 Reader.

    python pipeline/align_audio.py 1              # audio/week-01.mp3 → data/build/audio/week-01.alignment.json
    python pipeline/align_audio.py all            # every audio/week-NN.mp3 that exists
    python pipeline/align_audio.py 3 --audio "C:/some/file.mp3"   # copy that file in as audio/week-03.mp3 first
    python pipeline/align_audio.py all --upload   # also push start times to Supabase (audio_alignments)
                                                  # and the MP3 to the private bucket

What it does
  1. Transcribes the recording with faster-whisper (CPU, int8), language Latin,
     word_timestamps=True — every recognised word gets a start/end.
  2. Aligns that word stream to the week's known sentences (data/build/week-NN.json):
     tokens are normalised (macrons off, v→u, j→i, lowercase, punctuation off)
     and matched with difflib; each sentence takes the time of its first matched
     word. Sentences with no confident match are interpolated between their
     neighbours and flagged, never silently guessed.
  3. Writes one JSON with the two views the front end wants:
       passage_view  — one entry per block (Ørberg paragraph / [n] block): text,
                       start, end, and the timed words inside it
       sentence_view — flat list of sentences: unit_id, text, start, end, words,
                       matched (true/false), source (whisper|interpolated)
     plus app_rows ([{unit_id, start_ms}], the app's audio_alignments shape) and
     the audio descriptor. The MP3 is copied to audio/week-NN.mp3 (gitignored)
     and, with --upload, to the private Storage bucket at audio/{user}/week-NN.mp3
     — recordings are never published in the app folder.

Requirements: pip install faster-whisper imageio-ffmpeg   (both free; ffmpeg is
bundled by imageio-ffmpeg, no system install needed).
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

# The Supabase CLI: on Windows the launcher is supabase.cmd, which subprocess only finds by full path.
SUPABASE = shutil.which("supabase") or "supabase"

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
BUILD = ROOT / "data" / "build"
OUT_DIR = BUILD / "audio"
SQL_DIR = BUILD / "sql"
USER_SQL = "(select id from auth.users order by created_at limit 1)"

# ----------------------------------------------------------------- text utils

MACRON = str.maketrans("āēīōūȳĀĒĪŌŪȲ", "aeiouyAEIOUY")


def norm(tok: str) -> str:
    t = unicodedata.normalize("NFC", tok).translate(MACRON).lower()
    t = t.replace("v", "u").replace("j", "i").replace("æ", "ae").replace("œ", "oe")
    t = re.sub(r"[^a-z]", "", t)
    return t


def words_of(text: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-zĀ-ȳāēīōūȳ]+", text)]


# ----------------------------------------------------------------- transcribe

def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return shutil.which("ffmpeg") or "ffmpeg"


def duration_s(path: Path) -> float | None:
    try:
        out = subprocess.run([ffmpeg_exe(), "-i", str(path)], capture_output=True, text=True, errors="replace").stderr
        m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out)
        return round(int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]), 3) if m else None
    except OSError:
        return None


def transcribe(path: Path, model_name: str, quiet: bool) -> tuple[list[dict], dict]:
    """Return ([{w, start, end, p}], info) using faster-whisper on CPU."""
    from faster_whisper import WhisperModel

    # faster-whisper decodes through PyAV; point it at the bundled ffmpeg too
    # so the Windows box needs no system install.
    os.environ.setdefault("IMAGEIO_FFMPEG_EXE", ffmpeg_exe())
    t0 = time.time()
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(path), language="la", beam_size=5, word_timestamps=True,
        vad_filter=True, vad_parameters={"min_silence_duration_ms": 300},
        condition_on_previous_text=False,
    )
    words: list[dict] = []
    for seg in segments:               # generator: transcription happens here
        for w in seg.words or []:
            tok = norm(w.word)
            if tok:
                words.append({"w": w.word.strip(), "n": tok, "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
        if not quiet:
            print(f"\r  transcribed to {seg.end:7.1f}s  ({len(words)} words)", end="", flush=True)
    if not quiet:
        print(f"\n  whisper {model_name}: {len(words)} words in {time.time() - t0:.0f}s")
    return words, {"model": model_name, "language": info.language, "language_probability": round(info.language_probability, 3), "seconds": round(time.time() - t0, 1)}


# ----------------------------------------------------------------- alignment

def align(units: list[dict], words: list[dict]) -> dict:
    """Map every unit to a start time. Returns {unit_id: {start, end, matched, source, words}}."""
    # Flatten the unit text into tokens with back-references.
    ref: list[str] = []
    owner: list[int] = []
    for i, u in enumerate(units):
        for w in words_of(u["la"]):
            n = norm(w)
            if n:
                ref.append(n)
                owner.append(i)
    hyp = [w["n"] for w in words]

    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    first_hit: dict[int, int] = {}     # unit index → whisper word index of first matched token
    last_hit: dict[int, int] = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            ui = owner[a + k]
            # A lone short word (et, est, in …) is not evidence; ask for a run of two
            # matching tokens or one distinctive token of four letters or more.
            if size < 2 and len(ref[a + k]) < 4:
                continue
            first_hit.setdefault(ui, b + k)
            last_hit[ui] = b + k

    # Second pass: fuzzy-rescue units with no exact hit, searching the whisper
    # words between the previous and next confident hits.
    order = sorted(first_hit)
    for i, u in enumerate(units):
        if i in first_hit:
            continue
        prev = max((j for j in order if j < i), default=None)
        nxt = min((j for j in order if j > i), default=None)
        lo = (last_hit[prev] + 1) if prev is not None else 0
        hi = first_hit[nxt] if nxt is not None else len(hyp)
        toks = [norm(w) for w in words_of(u["la"])]
        toks = [t for t in toks if len(t) >= 4][:6]
        best = None
        for t in toks:
            for k in range(lo, hi):
                r = difflib.SequenceMatcher(a=t, b=hyp[k]).ratio()
                if r >= 0.8 and (best is None or k < best):
                    best = k
                    break
            if best is not None:
                break
        if best is not None:
            first_hit[i] = best
            last_hit[i] = best

    out: dict[str, dict] = {}
    n = len(units)
    starts: list[float | None] = [words[first_hit[i]]["start"] if i in first_hit else None for i in range(n)]
    # Interpolate the gaps by token count between confident neighbours.
    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        j = i
        while j < n and starts[j] is None:
            j += 1
        left_t = starts[i - 1] if i > 0 else 0.0
        right_t = starts[j] if j < n else (words[-1]["end"] if words else left_t)
        lo = i - 1 if i > 0 else i                      # the run whose span we divide up
        weight = {k: max(1, len(words_of(units[k]["la"]))) for k in range(lo, j)}
        total = sum(weight.values()) or 1
        for k in range(i, j):
            before = sum(weight[m] for m in range(lo, k))   # units spoken before unit k in this span
            starts[k] = round(left_t + (right_t - left_t) * before / total, 3)
        i = j
    # Monotonic guard.
    for k in range(1, n):
        if starts[k] < starts[k - 1]:
            starts[k] = starts[k - 1]

    for i, u in enumerate(units):
        start = starts[i]
        if i + 1 < n:
            end = starts[i + 1]
        elif i in last_hit:
            # The recording may run on (week 14 follows week 13 in the same file):
            # the last sentence ends where its last matched word ends.
            end = words[last_hit[i]]["end"] + 0.6
        else:
            end = words[-1]["end"] if words else start
        inside = [w for w in words if start <= w["start"] < end]
        out[u["id"]] = {
            "start": start, "end": round(end, 3),
            "matched": i in first_hit,
            "source": "whisper" if i in first_hit else "interpolated",
            "words": token_times(u["la"], inside, start, round(end, 3)),
        }
    return out


def token_times(la: str, heard: list[dict], start: float, end: float) -> list[dict]:
    """One timed entry per word of the sentence. Words Whisper recognised (fuzzy
    match, in order) take their heard times; the rest are interpolated between
    the nearest anchors by letter count and flagged with "i": true, so the
    reader's cursor never goes blank but nothing pretends to be heard."""
    toks = words_of(la)
    if not toks:
        return []
    ntoks = [norm(t) for t in toks]
    # Fuzzy in-order matching (tokens × heard words), greedy with a similarity floor.
    anchors: dict[int, dict] = {}
    j = 0
    for i, t in enumerate(ntoks):
        if not t:
            continue
        best_k, best_r = None, 0.0
        for k in range(j, min(j + 6, len(heard))):
            r = difflib.SequenceMatcher(a=t, b=heard[k]["n"]).ratio()
            if r > best_r:
                best_k, best_r = k, r
        floor = 0.75 if len(t) >= 4 else 0.9
        if best_k is not None and best_r >= floor:
            anchors[i] = heard[best_k]
            j = best_k + 1
    out: list[dict] = []
    m = len(toks)
    i = 0
    while i < m:
        if i in anchors:
            out.append({"text": toks[i], "start": anchors[i]["start"], "end": anchors[i]["end"]})
            i += 1
            continue
        k = i
        while k < m and k not in anchors:
            k += 1
        left = anchors[i - 1]["end"] if i > 0 and (i - 1) in anchors else (out[-1]["end"] if out else start)
        right = anchors[k]["start"] if k < m else end
        if right < left:
            right = left
        weight = [max(1, len(ntoks[x])) for x in range(i, k)]
        total = sum(weight) or 1
        t = left
        for x, w in zip(range(i, k), weight):
            span = (right - left) * w / total
            out.append({"text": toks[x], "start": round(t, 3), "end": round(t + span, 3), "i": True})
            t += span
        i = k
    return out


# ----------------------------------------------------------------- views

def build_views(week: dict, units: list[dict], al: dict) -> tuple[list[dict], list[dict]]:
    sentence_view = [{
        "unit_id": u["id"], "text": u["la"], "en": u.get("en"),
        "start": al[u["id"]]["start"], "end": al[u["id"]]["end"],
        "matched": al[u["id"]]["matched"], "source": al[u["id"]]["source"],
        "words": al[u["id"]]["words"],
    } for u in units]

    passage_view: list[dict] = []
    cur: dict | None = None
    for u in units:
        s = al[u["id"]]
        if u.get("block_start") or cur is None or u.get("part") != cur["part"]:
            cur = {"part": u.get("part"), "line_no": u.get("line_no"), "unit_ids": [], "text": "", "start": s["start"], "end": s["end"], "words": []}
            passage_view.append(cur)
        cur["unit_ids"].append(u["id"])
        cur["text"] = (cur["text"] + " " + u["la"]).strip()
        cur["end"] = s["end"]
        cur["words"].extend(s["words"])
    return passage_view, sentence_view


# ----------------------------------------------------------------- upload

def write_sql(n: int, rows: list[dict]) -> Path:
    """rows: [{unit_id, start_ms, words?: [{t, s, e}]}] → SQL for audio_alignments."""
    SQL_DIR.mkdir(parents=True, exist_ok=True)

    def jl(v):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    def uid(v):
        return "'" + str(v).replace("'", "''") + "'"

    def end(r):
        return "null" if r.get("end_ms") is None else str(int(r["end_ms"]))
    vals = ",\n".join(f"({USER_SQL}, {n}, {uid(r['unit_id'])}, {int(r['start_ms'])}, {end(r)}, "
                      f"{'true' if r.get('synth') else 'false'}, {jl(r.get('words') or [])})" for r in rows)
    sql = (f"delete from public.audio_alignments where week_n = {n} and user_id = {USER_SQL};\n"
           f"insert into public.audio_alignments (user_id, week_n, unit_id, start_ms, end_ms, synth, words) values\n{vals};\n")
    p = SQL_DIR / f"audio-w{n:02d}.sql"
    p.write_text(sql, encoding="utf-8")
    return p


def upload(n: int, audio_path: Path, sql_path: Path, user_id: str, quiet: bool) -> None:
    def run(cmd: list[str]) -> str:
        r = subprocess.run(cmd, capture_output=True, text=True, errors="replace", cwd=ROOT)
        out = (r.stdout + r.stderr)
        if r.returncode != 0 or re.search(r"\berror\b", out, re.I):
            raise RuntimeError(out.strip()[-800:])
        return out
    run([SUPABASE, "db", "query", "--linked", "-f", str(sql_path), "-o", "json"])
    if not quiet:
        print(f"  alignments uploaded ({sql_path.name})")
    dest = f"ss:///audio/{user_id}/week-{n:02d}.mp3"
    # cp refuses to overwrite, so drop any previous upload first (ignore "not found").
    subprocess.run([SUPABASE, "storage", "rm", dest, "--linked", "--experimental"], input="y\n", capture_output=True, text=True, cwd=ROOT)
    run([SUPABASE, "storage", "cp", str(audio_path), dest, "--linked", "--experimental"])
    if not quiet:
        print(f"  audio uploaded to private bucket: audio/{user_id}/week-{n:02d}.mp3")


# ----------------------------------------------------------------- main

def process(n: int, model: str, src: Path | None, do_upload: bool, user_id: str | None, quiet: bool, retranscribe: bool = False) -> Path:
    AUDIO_DIR.mkdir(exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = AUDIO_DIR / f"week-{n:02d}.mp3"
    if src is not None and src.resolve() != dest.resolve():
        shutil.copy2(src, dest)
        if not quiet:
            print(f"  copied {src.name} → {dest.relative_to(ROOT)}")
    if not dest.exists():
        raise FileNotFoundError(f"{dest} not found — pass --audio <file> or put the recording there")

    # Once tts_audio.py has joined synthesised parts onto the recording, the
    # untouched original lives at week-NN.real.mp3 — always align against that,
    # never against a file that already contains synthesised speech.
    real = AUDIO_DIR / f"week-{n:02d}.real.mp3"
    source_audio = real if real.exists() else dest

    data = json.loads((BUILD / f"week-{n:02d}.json").read_text(encoding="utf-8"))
    week, units = data["week"], data["units"]
    if not quiet:
        print(f"week {n:02d}: {week['title']} — {len(units)} sentences, {source_audio.name} ({duration_s(source_audio)} s)")

    raw = OUT_DIR / f"week-{n:02d}.transcript.json"
    if raw.exists() and not retranscribe:
        cached = json.loads(raw.read_text(encoding="utf-8"))
        words, info = cached["words"], cached["info"]
        if not quiet:
            print(f"  using cached transcript ({len(words)} words); pass --retranscribe to run Whisper again")
    else:
        words, info = transcribe(source_audio, model, quiet)
        raw.write_text(json.dumps({"words": words, "info": info}, ensure_ascii=False), encoding="utf-8")
    al = align(units, words)
    passage_view, sentence_view = build_views(week, units, al)
    matched = sum(1 for s in sentence_view if s["matched"])
    app_rows = [{"unit_id": s["unit_id"], "start_ms": int(round(s["start"] * 1000)), "end_ms": int(round(s["end"] * 1000)),
                 "synth": False,
                 "words": [{"t": w["text"], "s": int(round(w["start"] * 1000)), "e": int(round(w["end"] * 1000)), **({"i": True} if w.get("i") else {})}
                           for w in s["words"]]}
                for s in sentence_view]

    result = {
        "week": {"n": n, "id": week["id"], "title": week["title"]},
        "audio": {
            "local_file": str(dest.relative_to(ROOT)).replace("\\", "/"),
            "aligned_against": str(source_audio.relative_to(ROOT)).replace("\\", "/"),
            "private_path": f"audio/{user_id or '{user_id}'}/week-{n:02d}.mp3",
            "served_via": "Supabase Storage signed URL (store.getAudioUrl) — never a public URL",
            "duration_s": duration_s(source_audio),
        },
        "transcription": info,
        "alignment": {"sentences": len(units), "matched": matched, "interpolated": len(units) - matched,
                      "match_rate": round(matched / max(1, len(units)), 3)},
        "passage_view": passage_view,
        "sentence_view": sentence_view,
        "app_rows": app_rows,
    }
    out = OUT_DIR / f"week-{n:02d}.alignment.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    sql_path = write_sql(n, app_rows)
    if not quiet:
        low = [s["unit_id"] for s in sentence_view if not s["matched"]]
        print(f"  aligned {matched}/{len(units)} sentences directly; {len(low)} interpolated" + (f": {', '.join(low[:8])}{' …' if len(low) > 8 else ''}" if low else ""))
        print(f"  → {out.relative_to(ROOT)}")
    if do_upload:
        if not user_id:
            raise SystemExit("--upload needs --user-id <auth user uuid> (select id from auth.users)")
        upload(n, dest, sql_path, user_id, quiet)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="+", help="week numbers or 'all'")
    ap.add_argument("--audio", type=Path, help="recording to copy in as audio/week-NN.mp3 (single week)")
    ap.add_argument("--model", default="small", help="faster-whisper model: tiny|base|small|medium (default small)")
    ap.add_argument("--upload", action="store_true", help="push alignments + MP3 to Supabase (needs --user-id)")
    ap.add_argument("--user-id", default=os.environ.get("LATIN_USER_ID"), help="auth user uuid for the bucket path")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--retranscribe", action="store_true", help="ignore the cached transcript and run Whisper again")
    a = ap.parse_args(argv)

    if a.weeks == ["all"]:
        nums = sorted(int(p.stem.split("-")[1]) for p in AUDIO_DIR.glob("week-??.mp3"))
    else:
        nums = [int(x) for x in a.weeks]
    if a.audio and len(nums) != 1:
        ap.error("--audio applies to a single week")
    rc = 0
    for n in nums:
        try:
            process(n, a.model, a.audio, a.upload, a.user_id, a.quiet, a.retranscribe)
        except Exception as e:  # keep going through the other weeks, report at the end
            print(f"week {n:02d}: FAILED — {e}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8")
    sys.exit(main())
