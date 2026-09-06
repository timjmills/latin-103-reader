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


def week_json(n: int) -> Path:
    """The text for week n. Course weeks 1–14 are data/build/week-NN.json; the
    Familia Romana review shelf (weeks 101–124 = chapters I–XXIV) is
    data/build/review-NN.json, built by review_shelf.py."""
    return BUILD / (f"review-{n - 100:02d}.json" if n >= 101 else f"week-{n:02d}.json")


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
    # WHISPER_CPU_THREADS caps the threads per process so several weeks can be
    # transcribed in parallel without fighting over the cores (0 = all cores).
    model = WhisperModel(model_name, device="cpu", compute_type="int8",
                         cpu_threads=int(os.environ.get("WHISPER_CPU_THREADS", "0")))
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

def paced_blocks(blocks, ref: list[str], words: list[dict]) -> list:
    """Keep only the matching blocks that agree with each other about the pace.

    Ørberg's chapters repeat whole phrases — cap. XXIII says "in viā pugnātūrum
    nec in lūdō dormītūrum esse" twice, once as narrative and once in the
    indirect-speech recap — and difflib, which places its longest block first,
    can match a sentence to the wrong occurrence. Everything between the two
    then has nowhere left to match and is crammed into a fraction of a second
    (before this filter, cap. XXIII stranded 19 sentences inside four seconds
    at 648 s whose speech is really at 519–650 s).

    The reader's pace is near enough constant, so a block is only believable if
    the audio between it and the previous kept block is roughly what its word
    count needs: no faster than a third of the chapter's pace, no slower than
    twice it plus a pause. Keep the chain of blocks carrying the most matched
    tokens under that rule; the sentences left without a block are fuzzy-rescued
    and interpolated like any other unmatched sentence.
    """
    bl = [b for b in blocks if b.size]
    if len(bl) < 2 or not words:
        return bl
    pace = (words[-1]["end"] - words[0]["start"]) / max(1, len(ref))   # seconds per reference token

    def plausible(p, q) -> bool:
        exp = (q.a - p.a) * pace
        dt = words[q.b]["start"] - words[p.b]["start"]
        return exp * 0.3 - 6 <= dt <= exp * 2.0 + 15

    best = [b.size for b in bl]           # most matched tokens in a chain ending here
    prev = [-1] * len(bl)
    for k in range(len(bl)):
        for j in range(k):
            if best[j] + bl[k].size > best[k] and plausible(bl[j], bl[k]):
                best[k], prev[k] = best[j] + bl[k].size, j
    k = max(range(len(bl)), key=lambda i: best[i])
    chain = []
    while k >= 0:
        chain.append(bl[k])
        k = prev[k]
    return chain[::-1]


LOOK = 40           # letters of a sentence's opening weighed against the transcript
SEEK_FLOOR = 0.58   # below this the transcript is no evidence of where the sentence is
SEEK_SLACK = 0.03   # …and the earliest place this close to the best one wins
HEAD = 12           # the opening letters, which count for more: it is a start we are placing
HEAD_W = 0.35


def letter_stream(hyp: list[str]) -> tuple[str, list[int]]:
    """The transcript as one stream of letters, with each word's offset in it."""
    off = [0]
    for h in hyp:
        off.append(off[-1] + len(h))
    return "".join(hyp), off


def seek(unit: dict, hyp: list[str], lo: int, hi: int,
         cache: tuple[str, list[int]] | None = None) -> int | None:
    """Where in hyp[lo:hi] the sentence begins, or None.

    Every position is scored by how well the sentence's opening letters agree
    with the transcript's letters read from there — letters, not words, because
    this reader's ecclesiastical Latin reaches Whisper with the word boundaries
    in the wrong places: *posthāc Mārcum* comes back as "post tāc Marquīn",
    *sūmit ac surgit* as "sumitac surgit". Scoring one word at a time is what
    left cap. XXIII nine sentences late — the old pass took the first word that
    fuzzily matched the sentence's *first* distinctive word anywhere in the
    window, so `r23:107.1` ("Posthāc Mārcum sine comite …", spoken at 592 s)
    was pinned to the "Marcus" of the next paragraph at 610 s, and the eight
    sentences after it were crammed into what was left.

    The earliest position within SEEK_SLACK of the best one wins. Ørberg says
    everything twice — narrative, then indirect speech — so the two copies score
    alike; scanning forward from the previous sentence's last heard word, the
    first copy is the one this sentence wants. A best score under SEEK_FLOOR is
    not evidence at all and the sentence is left to be interpolated: measured
    over ten weeks, a sentence's true opening scores 0.84 at the median and 0.73
    at the 5th percentile, while a decoy 25 words away tops out at 0.59.
    """
    ref = "".join(t for w in words_of(unit["la"]) if (t := norm(w)))[:LOOK]
    lo, hi = max(0, lo), min(hi, len(hyp))
    if len(ref) < 8 or lo >= hi:
        return None
    joined, off = cache if cache is not None else letter_stream(hyp)
    sm = difflib.SequenceMatcher(autojunk=False)
    sm.set_seq2(ref)
    head = difflib.SequenceMatcher(autojunk=False)
    head.set_seq2(ref[:HEAD])
    end = off[hi]
    best_r, scores = 0.0, []
    for k in range(lo, hi):
        got = joined[off[k]:min(end, off[k] + len(ref) + 8)]
        sm.set_seq1(got)
        # the composite can be no more than (1-HEAD_W)*this + HEAD_W
        if (1 - HEAD_W) * sm.real_quick_ratio() + HEAD_W < best_r - SEEK_SLACK:
            scores.append(0.0)
            continue
        head.set_seq1(got[:HEAD + 4])
        r = (1 - HEAD_W) * sm.ratio() + HEAD_W * head.ratio()
        scores.append(r)
        best_r = max(best_r, r)
    if best_r < SEEK_FLOOR:
        return None
    for k, r in zip(range(lo, hi), scores):
        if r >= best_r - SEEK_SLACK:
            return k
    return None


def align(units: list[dict], words: list[dict]) -> dict:
    """Map every unit to a start time. Returns {unit_id: {start, end, matched, source, words}}."""
    # Flatten the unit text into tokens with back-references.
    ref: list[str] = []
    owner: list[int] = []
    tok_start: list[int] = []          # unit index → where its tokens start in ref
    for i, u in enumerate(units):
        tok_start.append(len(ref))
        for w in words_of(u["la"]):
            n = norm(w)
            if n:
                ref.append(n)
                owner.append(i)
    hyp = [w["n"] for w in words]
    cache = letter_stream(hyp)

    sm = difflib.SequenceMatcher(a=ref, b=hyp, autojunk=False)
    first_hit: dict[int, int] = {}     # unit index → whisper word index of first matched token
    last_hit: dict[int, int] = {}
    for a, b, size in paced_blocks(sm.get_matching_blocks(), ref, words):
        for k in range(size):
            ui = owner[a + k]
            # A lone short word (et, est, in …) is not evidence; ask for a run of two
            # matching tokens or one distinctive token of four letters or more.
            if size < 2 and len(ref[a + k]) < 4:
                continue
            first_hit.setdefault(ui, b + k)
            last_hit[ui] = b + k

    pace = ((words[-1]["end"] - words[0]["start"]) / max(1, len(ref))) if words else 0.0

    def rescue() -> None:
        """Fuzzy-find every sentence with no block of its own, between the
        previous and next confident hits. A rescued sentence is itself a
        boundary for the next one, so a long run is walked forward rather than
        every sentence in it searching the same wide window."""
        order = sorted(first_hit)
        for i, u in enumerate(units):
            if i in first_hit:
                continue
            prev = max((j for j in order if j < i), default=None)
            nxt = min((j for j in order if j > i), default=None)
            lo = (last_hit[prev] + 1) if prev is not None else 0
            hi = first_hit[nxt] if nxt is not None else len(hyp)
            best = seek(u, hyp, lo, hi, cache)
            if best is not None:
                first_hit[i] = last_hit[i] = best
                order = sorted(first_hit)

    def unlate() -> bool:
        """Move back sentences anchored too late, and give up the anchor when
        they cannot be found earlier. Every failure of the kind cap. XXIII shows
        is a sentence matched to a *later* repeat of its own words (Ørberg's
        indirect-speech recaps say everything twice), and it shows up two ways:
        the audio before the sentence is far more than its words need, or the
        sentences after it would have to be read three times faster than the
        chapter's pace, which no reader does. Returns True when an anchor was
        given up, so the caller can rescue those sentences afresh."""
        anchored = sorted(first_hit)
        drop: list[int] = []
        for x, i in enumerate(anchored):
            p = next((j for j in reversed(anchored[:x]) if j not in drop), None)
            # Look far enough ahead for the pace to mean something: the sentence
            # right after a misplaced one is usually misplaced with it.
            q = next((j for j in anchored[x + 1:] if tok_start[j] - tok_start[i] >= 20), None)
            late = p is not None and (
                words[first_hit[i]]["start"] - words[first_hit[p]]["start"]
                > (tok_start[i] - tok_start[p]) * pace * 2.0 + 15)
            need = (tok_start[q] - tok_start[i]) * pace if q is not None else 0.0
            room = (words[first_hit[q]]["start"] - words[first_hit[i]]["start"]) if q is not None else 0.0
            crams = need > 5 and room < need * 0.33
            # A sentence sharing its instant with the next one has no time of
            # its own at all. It happens when the only word that matched was a
            # short one at the sentence's end (cap. XIV's "Vflla Iūliī obscūra
            # et quiēta est" — the scan's typo for Vīlla leaves only "est").
            nxt = anchored[x + 1] if x + 1 < len(anchored) else None
            squeezed = (nxt is not None and tok_start[i + 1] - tok_start[i] >= 2
                        and words[first_hit[nxt]]["start"] - words[first_hit[i]]["start"] < 0.15)
            if not (late or crams or squeezed):
                continue
            k = seek(units[i], hyp, (last_hit[p] + 1) if p is not None else 0, first_hit[i], cache)
            if k is not None:
                first_hit[i] = k
                last_hit[i] = max(k, min(last_hit[i], k + len(words_of(units[i]["la"]))))
            elif crams and room < need * 0.15:
                # Nowhere near enough audio for the words that follow and no
                # earlier home for this sentence: the anchor is not evidence.
                # Interpolating it is honest; leaving it is not. (A merely tight
                # fit is left alone — the reader does speed up.)
                drop.append(i)
        for i in drop:
            del first_hit[i], last_hit[i]
        return bool(drop)

    rescue()
    for _ in range(4):
        if not unlate():
            break
        rescue()

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

    ends: list[float] = []
    for i in range(n):
        if i + 1 < n:
            ends.append(starts[i + 1])
        elif i in last_hit:
            # The recording may run on (week 14 follows week 13 in the same file):
            # the last sentence ends where its last matched word ends.
            ends.append(round(words[last_hit[i]]["end"] + 0.6, 3))
        else:
            ends.append(words[-1]["end"] if words else starts[i])

    timed = [token_times(u["la"], [w for w in words if starts[i] <= w["start"] < ends[i]], starts[i], ends[i])
             for i, u in enumerate(units)]
    respace(timed, {i: starts[i] for i in first_hit})

    # A sentence begins where its own first word begins: respace() has moved the
    # words the recogniser never heard back into the audio before the first one
    # it did, so the opening words are no longer stacked on the anchor's instant.
    for i in range(n):
        if not timed[i]:
            continue
        # …but never later than where the sentence itself matched. Ørberg
        # repeats a phrase inside one sentence ("Aegyptus in Eurōpā nōn est,
        # Aegyptus in Āfricā est"), and token_times() can take the second copy
        # for the sentence's first word when the first copy falls a moment
        # before the anchor; that is a wrong word cursor, not a later sentence.
        starts[i] = min(starts[i], timed[i][0]["start"]) if i in first_hit else timed[i][0]["start"]
    for k in range(1, n):
        starts[k] = max(starts[k], starts[k - 1])
    for i in range(n - 1):
        # A sentence wedged between two anchors with no audio between them would
        # otherwise get a zero-length row, and the app plays a row from its start
        # to its end: pressing play on it would play nothing. It keeps MIN_ROW_S,
        # overlapping the sentence after it by that much at worst.
        ends[i] = max(starts[i] + MIN_ROW_S, starts[i + 1])
    if n and timed[n - 1]:
        ends[n - 1] = max(ends[n - 1], timed[n - 1][-1]["end"])

    # Where that clamp pulled a sentence's start back behind the interpolated
    # tail of the sentence before it, that tail is re-spread into the room left.
    for i in range(n):
        ws, b = timed[i], ends[i]
        j = len(ws)
        while j > 0 and ws[j - 1].get("i") and ws[j - 1]["end"] > b + 1e-9:
            j -= 1
        if j == len(ws):
            continue
        a = min(ws[j - 1]["end"] if j > 0 else starts[i], b)
        weight = [max(1, len(norm(w["text"]))) for w in ws[j:]]
        t, total = a, sum(weight) or 1
        for w, wt in zip(ws[j:], weight):
            span = (b - a) * wt / total
            w["start"], w["end"] = round(t, 3), round(t + span, 3)
            t += span

    for i, u in enumerate(units):
        out[u["id"]] = {
            "start": round(starts[i], 3), "end": round(ends[i], 3),
            "matched": i in first_hit,
            "source": "whisper" if i in first_hit else "interpolated",
            "words": timed[i],
        }
    return out


LEAD_S = 0.30   # audio a word the recogniser never heard may claim before the next one it did
MIN_S = 0.09    # …and the least any word entry gets of its own, so the cursor can show it
MIN_ROW_S = 0.15  # a sentence squeezed to nothing still gets this much, so "play it" plays something


def respace(rows: list[list[dict]], anchors: dict[int, float] | None = None) -> None:
    """Give every word entry an instant of its own. Modifies `rows` in place.

    `anchors[i]` is where the alignment placed sentence `i` — the heard word it
    matched, which is evidence in its own right and may be earlier than LEAD_S a
    word would reach (Whisper hands back *posthāc* as the two words "post tāc",
    so no single word of cap. XXIII's `r23:107.1` matched at its true start and
    the sentence's own anchor was a word and a half further in).

    `rows` is one list of timed words per sentence, in reading order, as
    token_times() leaves them: a word Whisper heard carries the recogniser's own
    times, a word it never heard is flagged "i" and was interpolated. A sentence
    used to begin at its first *heard* word, which is often not its first word,
    so the words before that anchor had no room at all and were stacked on one
    instant — 2761 of the shelf's 21318 entries had zero length, and `wordAt()`
    in app/js/audio.js shows only the last word at a given instant, so those
    words never lit up as the reading passed them.

    Every maximal run of unheard words is laid out over the audio between the
    heard words on either side of it, by letter count, under two rules:

      * where the run crosses a sentence boundary, the later sentence's share is
        capped at LEAD_S a word, so its start moves back far enough to cover its
        own opening words and no further — a sentence backed off further than
        that would begin in silence, or in the previous sentence's speech, and
        "play this sentence" starts at exactly this time. The share is also
        never more than the run's proportional part of the gap, so a tight gap
        is divided rather than overdrawn, and the boundary therefore never
        crosses the previous sentence's last heard word.
      * where that still leaves a word less than MIN_S of its own — the two
        heard words either side are contiguous in the transcript, so the word
        between them was swallowed by one of them — the run reaches back into
        the tail of the heard word before it, leaving that word MIN_S and never
        moving its start. Whisper's word boundaries are no more precise than
        that, and a word with no instant of its own can never be shown. The
        borrowing stays inside one sentence: a run that *begins* a sentence is
        left stacked rather than moved across the boundary on no evidence.

    Over the library this takes the zero-length entries from 4448 of 40370 to
    243, and the sentences that open on a stack from 1504 of 4306 to 33.
    """
    flat = [(ri, wi) for ri, ws in enumerate(rows) for wi in range(len(ws))]
    if not flat:
        return

    def W(x):
        ri, wi = flat[x]
        return rows[ri][wi]

    n = len(flat)
    x = 0
    while x < n:
        if not W(x).get("i"):
            x += 1
            continue
        y = x
        while y < n and W(y).get("i"):
            y += 1
        lo = W(x - 1)["end"] if x > 0 else 0.0
        hi = W(y)["start"] if y < n else max(W(n - 1)["end"], lo)
        _place(rows, flat, x, y, lo, max(lo, hi), y < n, anchors or {})
        x = y

    # Nothing may share an instant with the word after it.
    for x in range(n - 1, 0, -1):
        cur, prev = W(x), W(x - 1)
        if cur["start"] - prev["start"] >= MIN_S - 1e-9 or not prev.get("i"):
            continue
        z = x - 1
        while z > 0 and W(z - 1).get("i"):
            z -= 1
        held = W(z - 1) if z > 0 else None
        # borrow from the heard word before the run, but only inside one sentence
        floor = (held["start"] + MIN_S
                 if held is not None and flat[z - 1][0] == flat[x - 1][0]
                 else (held["end"] if held is not None else 0.0))
        # never later than the word after it: where the borrowing has no room
        # left the stack simply stands, which is honest, but it must not invert
        want = min(cur["start"], max(0.0, floor, cur["start"] - MIN_S))
        if want < prev["start"]:
            prev["start"] = round(want, 3)
        prev["end"] = round(min(max(prev["end"], prev["start"]), cur["start"]), 3)


def _spread(rows, flat, ks: list[int], a: float, b: float) -> None:
    """Lay the words flat[k] for k in ks out over [a, b] by letter count."""
    weight = [max(1, len(norm(rows[flat[k][0]][flat[k][1]]["text"]))) for k in ks]
    total = sum(weight) or 1
    t = a
    for k, wt in zip(ks, weight):
        w = rows[flat[k][0]][flat[k][1]]
        span = (b - a) * wt / total
        w["start"], w["end"] = round(t, 3), round(t + span, 3)
        t += span


def _place(rows, flat, x: int, y: int, lo: float, hi: float, anchored_right: bool,
           anchors: dict[int, float]) -> None:
    """Lay the run of unheard words flat[x:y] out over [lo, hi]; see respace().

    Only one part of a run is capped: the words that *open* the sentence whose
    first heard word closes the run. Those are the ones the cursor could not
    show, and LEAD_S apiece is as far back as their sentence's start may move.
    Everything before them — the tail of the sentence before, and any sentence
    in between that was never heard at all — is spread over what is left, by
    letter count, exactly as the interpolation always did: there is no evidence
    of where those words fall, and bunching them at one end would invent some.
    """
    ks = list(range(x, y))
    # the words that open the sentence the run leads into — the sentence that
    # owns the heard word at flat[y], not merely the last sentence in the run
    lead = [k for k in ks if anchored_right and flat[k][0] == flat[y][0]]
    edge = hi
    if lead and flat[lead[0]][1] == 0:
        take = min(LEAD_S * len(lead), (hi - lo) * len(lead) / len(ks))
        want = anchors.get(flat[lead[0]][0])
        if want is not None and lo <= want < hi:
            take = max(take, hi - want)          # the sentence's own anchor wins
        edge = max(lo, hi - take)
        _spread(rows, flat, lead, edge, hi)
        ks = ks[:len(ks) - len(lead)]
    if ks:
        _spread(rows, flat, ks, lo, edge)


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
    # The CLI reads a Windows absolute source ("C:\…") as a URL scheme and refuses
    # the copy, so hand it a path relative to ROOT — which is already the cwd.
    src = audio_path.resolve()
    try:
        src_arg = str(src.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        src_arg = str(src)
    # …and name the type: the bucket only accepts audio/*, while the CLI's guess
    # from the extension sometimes comes back as application/octet-stream.
    run([SUPABASE, "storage", "cp", src_arg, dest, "--linked", "--experimental",
         "--content-type", "audio/mpeg"])
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

    data = json.loads(week_json(n).read_text(encoding="utf-8"))
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
