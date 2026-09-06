"""Import/regression tests for the audio scripts (no Whisper, no network)."""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def test_modules_import():
    for m in ("align_audio", "tts_audio"):
        importlib.import_module(m)


def test_interpolation_spreads_by_word_count():
    from align_audio import align
    units = [
        {"id": "u1", "la": "a b c d e f g h i j"},   # 10 words, heard at 0 s
        {"id": "u2", "la": "k l"},                    # 2 words, not heard
        {"id": "u3", "la": "m n o p q r s t"},        # 8 words, not heard
        {"id": "u4", "la": "u v"},                    # 2 words, heard at 20 s
    ]
    words = [{"w": "abcd", "n": "abcd", "start": 0.0, "end": 0.5},
             {"w": "uuuu", "n": "uuuu", "start": 20.0, "end": 20.5}]
    # make the ends match distinctive tokens
    units[0]["la"] = "abcd b c d e f g h i j"
    units[3]["la"] = "uuuu v"
    out = align(units, words)
    assert out["u1"]["start"] == 0.0 and out["u4"]["start"] == 20.0
    # The 19 words nobody heard share the audio between the two that were heard
    # — 0.5 s (where "abcd" ends) to 20.0 s — by letter count, and a sentence
    # begins where its own first word does. u2 opens on the 10th of those 19.
    assert out["u2"]["start"] == 9.737         # after u1's 9 remaining words
    assert out["u3"]["start"] == 11.789        # after u1's 9 + u2's 2
    assert out["u1"]["start"] < out["u2"]["start"] < out["u3"]["start"] < out["u4"]["start"]
    assert out["u2"]["source"] == "interpolated"


def test_lone_short_token_is_not_a_match():
    from align_audio import align
    units = [{"id": "u1", "la": "et"}, {"id": "u2", "la": "labyrinthus magnus est"}]
    words = [{"w": "et", "n": "et", "start": 5.0, "end": 5.2},
             {"w": "noise", "n": "noise", "start": 7.0, "end": 7.3},      # breaks the run, so "et" stands alone
             {"w": "labyrinthus", "n": "labyrinthus", "start": 9.0, "end": 9.6}]
    out = align(units, words)
    assert out["u2"]["matched"] and out["u2"]["start"] == 9.0
    assert out["u1"]["source"] == "interpolated"


def test_token_times_cover_every_word_and_anchor_on_heard_ones():
    from align_audio import token_times
    heard = [{"n": "syra", "start": 1.0, "end": 1.4},
             {"n": "fabulam", "start": 2.0, "end": 2.6},        # "fābulam" mis-heard slightly is still an anchor
             {"n": "narrat", "start": 3.0, "end": 3.5}]
    out = token_times("Syra puerō fābulam longam nārrat.", heard, 0.8, 3.8)
    assert [w["text"] for w in out] == ["Syra", "puerō", "fābulam", "longam", "nārrat"]
    assert out[0]["start"] == 1.0 and out[2]["start"] == 2.0 and out[4]["start"] == 3.0
    assert out[1].get("i") is True and 1.4 <= out[1]["start"] < out[2]["start"]
    assert out[3].get("i") is True and 2.6 <= out[3]["start"] < 3.0
    assert all(out[k]["start"] <= out[k + 1]["start"] for k in range(len(out) - 1))


def test_last_unit_ends_at_its_last_heard_word():
    from align_audio import align
    units = [{"id": "u1", "la": "labyrinthus magnus"}, {"id": "u2", "la": "minotaurus habitat"}]
    words = [{"w": "labyrinthus", "n": "labyrinthus", "start": 1.0, "end": 1.5},
             {"w": "magnus", "n": "magnus", "start": 1.6, "end": 2.0},
             {"w": "minotaurus", "n": "minotaurus", "start": 5.0, "end": 5.6},
             {"w": "habitat", "n": "habitat", "start": 5.7, "end": 6.1},
             {"w": "aliud", "n": "aliud", "start": 60.0, "end": 60.4}]   # the next week's text
    out = align(units, words)
    assert out["u2"]["start"] == 5.0 and out["u2"]["end"] == 6.7           # not 60.4


def test_leading_words_get_time_of_their_own():
    """A sentence whose first heard word is not its first word still lights up
    its opening words: respace() backs the start off into the audio before the
    anchor, so no entry shares an instant with the one after it."""
    from align_audio import align
    units = [{"id": "u1", "la": "labyrinthus magnus est"},
             {"id": "u2", "la": "Theseus filius regis Minotaurum necat"}]
    words = [{"w": "labyrinthus", "n": "labyrinthus", "start": 1.0, "end": 1.8},
             {"w": "magnus", "n": "magnus", "start": 1.9, "end": 2.4},
             {"w": "est", "n": "est", "start": 2.4, "end": 2.7},
             # "Theseus filius regis" was not heard; the anchor is "minotaurum"
             {"w": "minotaurum", "n": "minotaurum", "start": 5.0, "end": 5.7},
             {"w": "necat", "n": "necat", "start": 5.8, "end": 6.2}]
    out = align(units, words)
    w2 = out["u2"]["words"]
    assert [x["text"] for x in w2] == ["Theseus", "filius", "regis", "Minotaurum", "necat"]
    assert all(x["end"] > x["start"] for x in w2)
    assert all(w2[k]["start"] < w2[k + 1]["start"] for k in range(len(w2) - 1))
    # backed off by ~0.3 s a word, and never across the previous sentence's last
    # heard word (2.7 s), which is where u1 now ends
    assert 4.0 <= out["u2"]["start"] <= 4.2 and out["u2"]["start"] == w2[0]["start"]
    assert out["u1"]["end"] == out["u2"]["start"] > 2.7


def test_a_lead_never_crosses_the_previous_sentence():
    from align_audio import align
    units = [{"id": "u1", "la": "labyrinthus"},
             {"id": "u2", "la": "Theseus filius regis Minotaurum necat"}]
    words = [{"w": "labyrinthus", "n": "labyrinthus", "start": 1.0, "end": 4.9},
             {"w": "minotaurum", "n": "minotaurum", "start": 5.0, "end": 5.7},
             {"w": "necat", "n": "necat", "start": 5.8, "end": 6.2}]
    out = align(units, words)
    assert out["u2"]["start"] >= 4.9            # not into u1's own speech
    assert out["u1"]["end"] == out["u2"]["start"]


def test_a_joined_week_comes_out_respaced_run_by_run():
    """tts_audio.py lays a real recording and synthesised blocks end to end, and
    respaces each run on its own: the opening words of a sentence the recogniser
    only half heard get an instant apiece, no word of the reading is given time
    out of the synthesised block after it, and the synthesised rows — every word
    of which carries an exact Edge boundary — come through untouched."""
    from tts_audio import respace_runs

    units = [{"id": "u1", "la": "Theseus filius regis Minotaurum necat"},
             {"id": "u2", "la": "labyrinthus magnus est"},
             {"id": "u3", "la": "Arachne texit"},
             {"id": "u4", "la": "aranea est"}]

    def w(t, a, b, i=False):
        return {"text": t, "start": a, "end": b, **({"i": True} if i else {})}

    al = {
        # the reading: "Theseus filius regis" was never heard, so the three of
        # them are stacked on the anchor, and "est" was swallowed by "magnus"
        "u1": {"start": 5.0, "end": 6.5, "matched": True, "source": "whisper",
               "words": [w("Theseus", 5.0, 5.0, True), w("filius", 5.0, 5.0, True), w("regis", 5.0, 5.0, True),
                         w("Minotaurum", 5.0, 5.7), w("necat", 5.8, 6.2)]},
        "u2": {"start": 6.5, "end": 8.0, "matched": True, "source": "whisper",
               "words": [w("labyrinthus", 6.5, 7.0), w("magnus", 7.1, 7.5), w("est", 7.5, 7.5, True)]},
        # the synthesised block, 2 s of silence after the recording
        "u3": {"start": 10.0, "end": 12.0, "matched": True, "source": "tts:edge",
               "words": [w("Arachne", 10.0, 10.6), w("texit", 10.7, 11.2)]},
        "u4": {"start": 12.0, "end": 13.0, "matched": True, "source": "tts:edge",
               "words": [w("aranea", 12.0, 12.4), w("est", 12.5, 12.9)]},
    }
    runs = [("real", units[:2]), ("tts", units[2:])]
    before = respace_runs(units, runs, al)
    assert before == (4, 1)                     # 4 zero-length entries, 1 sentence opening on a stack

    u1 = al["u1"]["words"]
    assert all(x["end"] > x["start"] for x in u1)
    assert all(u1[k]["start"] < u1[k + 1]["start"] for k in range(len(u1) - 1))
    assert u1[0]["start"] < 5.0 and al["u1"]["start"] == u1[0]["start"]   # the row moved back with them

    # the run ends with the recording: "est" is not given the 2 s pause, nor any
    # part of the synthesised block that follows it
    est = al["u2"]["words"][-1]
    assert est["end"] <= 8.0 and est["start"] > al["u2"]["words"][-2]["start"]

    # nothing of the synthesised block moved: an Edge word boundary is exact
    assert [(x["start"], x["end"]) for x in al["u3"]["words"]] == [(10.0, 10.6), (10.7, 11.2)]
    assert [(x["start"], x["end"]) for x in al["u4"]["words"]] == [(12.0, 12.4), (12.5, 12.9)]
    assert al["u3"]["start"] == 10.0 and al["u4"]["start"] == 12.0
    # a row still ends no later than the row after it starts, and never before its own start
    ids = [u["id"] for u in units]
    assert all(al[a]["end"] <= al[b]["start"] for a, b in zip(ids, ids[1:]))
    assert all(al[i]["end"] >= al[i]["start"] for i in ids)
    # running it again changes nothing (the one entry still without an instant is
    # the last word of the reading, which has no heard word after it to borrow from)
    was = {k: [dict(x) for x in v["words"]] for k, v in al.items()}
    respace_runs(units, runs, al)
    assert {k: v["words"] for k, v in al.items()} == was
