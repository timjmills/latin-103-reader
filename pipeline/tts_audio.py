"""
tts_audio.py — free text-to-speech for the readings that have no recording,
with exact sentence timings (no Whisper needed: every sentence is synthesised
on its own, so its start time is known when the pieces are joined).

    python pipeline/tts_audio.py 10                       # whole week (Arachnē + Fabellae 69–74)
    python pipeline/tts_audio.py 3 5 --fill-missing       # after align_audio.py: synthesise the stories the recording lacks,
                                                          # laid out in reading order around the real recording
    python pipeline/tts_audio.py 10 --engine google       # Google's Latin voice instead of Edge Italian
    python pipeline/tts_audio.py 3 5 10 --upload --user-id <uuid>

Engines (all free, no key):
  edge     Microsoft Edge neural voices via `edge-tts` (default voice it-IT-DiegoNeural,
           church-style Latin pronunciation, very natural). --voice to pick another.
  google   Google's Latin voice via `gTTS` (lang "la"; classical-leaning, older tech).

Output, identical in shape to align_audio.py so the app treats it the same:
  audio/tts/week-NN/<unit>.mp3         one clip per sentence (kept for re-joins)
  audio/week-NN.mp3                    the joined recording; with --fill-missing/--slugs the real
                                       recording (kept as week-NN.real.mp3) sits in reading order
                                       between the synthesised stories
  data/build/audio/week-NN.alignment.json   passage_view / sentence_view / app_rows
  data/build/sql/audio-wNN.sql              audio_alignments rows for the user

Macrons are stripped before synthesis (the engines do not know them) and the
text is otherwise sent verbatim. Speaker turns are read as plain text.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from align_audio import (AUDIO_DIR, BUILD, OUT_DIR, build_views, duration_s, ffmpeg_exe,  # noqa: E402
                         upload, write_sql)

ROOT = Path(__file__).resolve().parent.parent
MACRON = str.maketrans("āēīōūȳĀĒĪŌŪȲ", "aeiouyAEIOUY")
GAP_S = 0.55          # silence between sentences
BLOCK_GAP_S = 1.1     # a little more at a block/paragraph boundary
JOIN_GAP_S = 2.0      # pause between a real recording and the synthesised part


def speakable(la: str) -> str:
    t = la.translate(MACRON)
    t = t.replace("…", ".").replace("—", ", ").replace("–", ", ")
    t = re.sub(r"[\"“”„«»]", "", t)          # quotation marks are read aloud otherwise
    t = re.sub(r"\s+", " ", t).strip()
    return t or "."


# ----------------------------------------------------------------- engines

def synth_edge(text: str, out: Path, voice: str, rate: str) -> list[dict]:
    """Synthesise with edge-tts; also return word boundaries [{text, start, end}] in seconds."""
    import edge_tts

    words: list[dict] = []

    async def go():
        comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary")
        with open(out, "wb") as fh:
            async for chunk in comm.stream():
                if chunk["type"] == "audio":
                    fh.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":      # offsets are in 100-ns ticks
                    words.append({"text": chunk["text"], "start": round(chunk["offset"] / 1e7, 3),
                                  "end": round((chunk["offset"] + chunk["duration"]) / 1e7, 3)})
    asyncio.run(go())
    return words


def synth_google(text: str, out: Path) -> None:
    from gtts import gTTS
    gTTS(text, lang="la", slow=False).save(str(out))


def synth(text: str, out: Path, engine: str, voice: str, rate: str, retries: int = 4) -> list[dict]:
    """Synthesise one sentence; returns word timings (empty for engines without them)."""
    for attempt in range(retries):
        try:
            words: list[dict] = []
            if engine == "google":
                synth_google(text, out)
            else:
                words = synth_edge(text, out, voice, rate)
            if out.exists() and out.stat().st_size > 500:
                out.with_suffix(".words.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
                return words
        except Exception as e:  # network hiccups are the usual cause
            if attempt == retries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"empty output for {out.name}")


# ----------------------------------------------------------------- joining

def to_wav(src: Path, dst: Path) -> None:
    subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-i", str(src), "-ar", "24000", "-ac", "1", str(dst)], check=True)


# ----------------------------------------------------------------- main

def slug_of(unit_id: str) -> str:
    """'w05:fl-66:b15.1' → 'fl-66'; 'w04:12.3' → '' (single-text week)."""
    parts = unit_id.split(":")
    return parts[1] if len(parts) == 3 else ""


def choose_missing(units: list[dict], real: dict[str, dict], threshold: float = 0.3) -> list[dict]:
    """Parts (story slugs) where fewer than `threshold` of the units were heard in
    the real recording have no audio: synthesise every unit of those parts."""
    by_slug: dict[str, list[dict]] = {}
    for u in units:
        by_slug.setdefault(slug_of(u["id"]), []).append(u)
    out: list[dict] = []
    for slug, us in by_slug.items():
        heard = sum(1 for u in us if real.get(u["id"], {}).get("source") == "whisper")
        if heard / max(1, len(us)) < threshold:
            out.extend(us)
    return out


def process(n: int, engine: str, voice: str, rate: str, only_source: str | None, slugs: list[str] | None,
            fill_missing: bool, do_upload: bool, user_id: str | None, quiet: bool) -> Path:
    data = json.loads((BUILD / f"week-{n:02d}.json").read_text(encoding="utf-8"))
    week, units = data["week"], data["units"]
    dest = AUDIO_DIR / f"week-{n:02d}.mp3"
    real_path = AUDIO_DIR / f"week-{n:02d}.real.mp3"
    prev = OUT_DIR / f"week-{n:02d}.alignment.json"

    # The real recording's alignment (align_audio.py output), if there is one.
    real_alignment: dict[str, dict] = {}
    if (slugs or fill_missing) and prev.exists():
        pj = json.loads(prev.read_text(encoding="utf-8"))
        if not pj.get("audio", {}).get("synthesised_units"):      # a pure real-audio alignment
            real_alignment = {s["unit_id"]: s for s in pj["sentence_view"]}
            if not real_path.exists():
                shutil.copy2(dest, real_path)                       # keep the untouched recording
        elif real_path.exists() and pj.get("audio", {}).get("real_alignment"):
            real_alignment = {s["unit_id"]: s for s in pj["audio"]["real_alignment"]}
    use_real = bool(real_alignment) and real_path.exists()

    if slugs:
        tts_units = [u for u in units if slug_of(u["id"]) in slugs]
    elif fill_missing:
        if not use_real:
            raise SystemExit(f"week {n:02d}: --fill-missing needs a real alignment first (align_audio.py {n})")
        tts_units = choose_missing(units, real_alignment)
    elif only_source:
        tts_units = [u for u in units if u.get("source") == only_source]
    else:
        tts_units = list(units)
    if not tts_units:
        raise SystemExit(f"week {n:02d}: nothing to synthesise")
    tts_ids = {u["id"] for u in tts_units}
    real_units = [u for u in units if u["id"] not in tts_ids] if use_real else []

    clip_dir = AUDIO_DIR / "tts" / f"week-{n:02d}"
    clip_dir.mkdir(parents=True, exist_ok=True)
    if not quiet:
        print(f"week {n:02d}: synthesising {len(tts_units)} of {len(units)} sentences with {engine}"
              f"{' ' + voice if engine == 'edge' else ''}" + (f"; {len(real_units)} from the recording" if real_units else ""))

    if not use_real and len(tts_ids) != len(units):
        raise SystemExit(f"week {n:02d}: only {len(tts_ids)} of {len(units)} sentences selected but there is no aligned real "
                         "recording for the rest — run align_audio.py first, or synthesise the whole week")

    unit_words: dict[str, list[dict]] = {}
    clip_of: dict[str, Path] = {}
    for i, u in enumerate(tts_units):
        out = clip_dir / (u["id"].replace(":", "_") + ".mp3")
        if not out.exists():
            synth(speakable(u["la"]), out, engine, voice, rate)
        wj = out.with_suffix(".words.json")
        unit_words[u["id"]] = json.loads(wj.read_text(encoding="utf-8")) if wj.exists() else []
        clip_of[u["id"]] = out
        if not quiet:
            print(f"\r  {i + 1}/{len(tts_units)} {u['id']}", end="", flush=True)
    if not quiet:
        print()

    # Lay the segments out in reading order: runs of synthesised sentences and
    # (at most once) the real recording, which is one continuous file.
    runs: list[tuple[str, list[dict]]] = []
    for u in units:
        kind = "tts" if u["id"] in tts_ids else "real"
        if runs and runs[-1][0] == kind:
            runs[-1][1].append(u)
        else:
            runs.append((kind, [u]))
    if sum(1 for k, _ in runs if k == "real") > 1:
        # The recording would have to be split; keep it whole and put every
        # synthesised run after it instead.
        real_run = [u for k, us in runs for u in us if k == "real"]
        tts_run = [u for k, us in runs for u in us if k == "tts"]
        runs = [("real", real_run), ("tts", tts_run)]

    work = AUDIO_DIR / "_join"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    parts: list[str] = []
    t = 0.0
    al: dict[str, dict] = {}

    def silence(name: str, secs: float) -> None:
        f = work / name
        subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(secs), str(f)], check=True)
        parts.append(f.name)

    seg = 0
    for kind, us in runs:
        if kind == "real":
            w = work / f"{seg:04d}-real.wav"
            to_wav(real_path, w)
            parts.append(w.name)
            offset = t
            for u in us:
                s = real_alignment[u["id"]]
                al[u["id"]] = {"start": round(s["start"] + offset, 3), "end": round(s["end"] + offset, 3),
                               "matched": s["matched"], "source": s["source"],
                               "words": [{"text": x["text"], "start": round(x["start"] + offset, 3), "end": round(x["end"] + offset, 3)} for x in s["words"]]}
            t += duration_s(w) or 0.0
            silence(f"{seg:04d}-gap.wav", JOIN_GAP_S)
            t += JOIN_GAP_S
            seg += 1
            continue
        for i, u in enumerate(us):
            w = work / f"{seg:04d}.wav"
            to_wav(clip_of[u["id"]], w)
            parts.append(w.name)
            start = round(t, 3)
            d = duration_s(w) or 0.0
            al[u["id"]] = {"start": start, "end": round(start + d, 3), "matched": True, "source": f"tts:{engine}",
                           "words": [{"text": x["text"], "start": round(start + x["start"], 3), "end": round(start + x["end"], 3)} for x in unit_words.get(u["id"], [])]}
            t += d
            nxt = us[i + 1] if i + 1 < len(us) else None
            gap = BLOCK_GAP_S if (nxt and nxt.get("block_start")) else GAP_S
            silence(f"{seg:04d}-gap.wav", gap)
            t += gap
            seg += 1
    lst = work / "list.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
    subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:a", "libmp3lame", "-b:a", "96k", str(dest)], check=True, cwd=work)
    shutil.rmtree(work, ignore_errors=True)

    # Each sentence ends where the next begins (so per-sentence playback runs on into the gap).
    ordered = [u["id"] for u in units]
    for i, uid in enumerate(ordered):
        if i + 1 < len(ordered):
            al[uid]["end"] = max(al[uid]["end"], al[ordered[i + 1]]["start"]) if al[uid]["source"].startswith("tts") else al[uid]["end"]

    passage_view, sentence_view = build_views(week, units, al)
    app_rows = [{"unit_id": s["unit_id"], "start_ms": int(round(s["start"] * 1000)), "end_ms": int(round(s["end"] * 1000)),
                 "synth": s["unit_id"] in tts_ids,
                 "words": [{"t": w["text"], "s": int(round(w["start"] * 1000)), "e": int(round(w["end"] * 1000)), **({"i": True} if w.get("i") else {})}
                           for w in s["words"]]}
                for s in sentence_view]
    result = {
        "week": {"n": n, "id": week["id"], "title": week["title"]},
        "audio": {
            "local_file": str(dest.relative_to(ROOT)).replace("\\", "/"),
            "private_path": f"audio/{user_id or '{user_id}'}/week-{n:02d}.mp3",
            "served_via": "Supabase Storage signed URL (store.getAudioUrl) — never a public URL",
            "duration_s": duration_s(dest),
            "synthesised_units": [u["id"] for u in tts_units],
            "engine": engine, "voice": voice if engine == "edge" else "google:la",
            "real_alignment": list(real_alignment.values()) if use_real else [],
            "layout": [{"kind": k, "units": len(us)} for k, us in runs],
        },
        "alignment": {"sentences": len(units), "matched": sum(1 for s in sentence_view if s["matched"]),
                      "synthesised": len(tts_units), "from_recording": len(real_units)},
        "passage_view": passage_view,
        "sentence_view": sentence_view,
        "app_rows": app_rows,
    }
    out = OUT_DIR / f"week-{n:02d}.alignment.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    sql_path = write_sql(n, app_rows)
    if not quiet:
        lay = " + ".join(f"{k}×{len(us)}" for k, us in runs)
        print(f"  layout {lay} → {dest.relative_to(ROOT)} ({duration_s(dest)} s), {out.relative_to(ROOT)}")
    if do_upload:
        if not user_id:
            raise SystemExit("--upload needs --user-id")
        upload(n, dest, sql_path, user_id, quiet)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="+", type=int)
    ap.add_argument("--engine", choices=["edge", "google"], default="edge")
    ap.add_argument("--voice", default="it-IT-DiegoNeural", help="edge-tts voice (edge engine only)")
    ap.add_argument("--rate", default="-8%", help="edge-tts speaking rate, e.g. -10%%")
    ap.add_argument("--only-source", choices=["FR", "FS", "FL"], help="synthesise only units from this source")
    ap.add_argument("--slugs", help="comma-separated story slugs to synthesise (e.g. coriolanus,fl-66); the rest come from the real recording")
    ap.add_argument("--fill-missing", action="store_true", help="synthesise every story the real recording does not contain (needs align_audio.py first)")
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--user-id", default=os.environ.get("LATIN_USER_ID"))
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    rc = 0
    for n in a.weeks:
        try:
            process(n, a.engine, a.voice, a.rate, a.only_source, a.slugs.split(",") if a.slugs else None, a.fill_missing, a.upload, a.user_id, a.quiet)
        except Exception as e:
            print(f"week {n:02d}: FAILED — {e}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8")
    sys.exit(main())
