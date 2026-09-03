"""
pytest for pipeline/build_week.py and pipeline/recover_lines.py.

    python -m pytest pipeline -q

The Week-1 tests read source/week-01.md (copyrighted, gitignored) and skip
when it is absent. The synthetic fixtures below are original text.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_week as bw  # noqa: E402
import recover_lines as rl  # noqa: E402
from weeks import WEEKS  # noqa: E402

ROOT = bw.ROOT
SRC1 = ROOT / "source" / "week-01.md"
NOTES1 = ROOT / "data" / "grammar-notes-week01.json"
REF1 = ROOT / "data" / "week01-aligned-sentences.json"

UNIT_KEYS = {"id", "order", "part", "source", "line_no", "block_start", "unit_type",
             "speaker", "la", "en", "en_raw", "note", "tags"}


# ----------------------------------------------------------------------------- Week 1 (real data)

@pytest.fixture(scope="module")
def week1():
    if not SRC1.exists():
        pytest.skip("source/week-01.md not present")
    md = SRC1.read_text(encoding="utf-8")
    notes = json.loads(NOTES1.read_text(encoding="utf-8")) if NOTES1.exists() else {}
    return bw.build_from_text(1, md, notes=notes, source_name="source/week-01.md")


def test_week1_builds_93_units(week1):
    data, report = week1
    assert len(data["units"]) == 93
    assert report["units"] == 93
    assert report["blocks"] == 28


def test_week1_zero_mismatches(week1):
    data, report = week1
    assert report["mismatches"] == []
    assert report["warnings"] == []
    text = bw.render_report(report)
    assert text.startswith("# Week 01 build report — OK")
    assert "mismatched blocks: **0**" in text


def test_week1_merges_applied(week1):
    _, report = week1
    assert len(report["merges_applied"]) == 2
    assert any("block 91" in m for m in report["merges_applied"])
    assert any("block 101" in m for m in report["merges_applied"])


def test_week1_every_unit_has_note(week1):
    data, report = week1
    if not NOTES1.exists():
        pytest.skip("grammar-notes-week01.json not present")
    assert all(u["note"] for u in data["units"])
    assert report["notes_matched"] == 93
    assert report["notes_orphans"] == []


def test_week1_en_has_no_brackets(week1):
    data, _ = week1
    assert all("[" not in u["en"] and "]" not in u["en"] for u in data["units"])
    assert sum("[" in u["en_raw"] for u in data["units"]) == 11


def test_week1_first_unit(week1):
    data, _ = week1
    u = data["units"][0]
    assert u["id"] == "w01:1.1"
    assert u["order"] == 0
    assert u["line_no"] == 1
    assert u["block_start"] is True
    assert u["part"] == "Pars I"
    assert u["la"].split()[0] == "Syra," and len(u["la"]) > 40


def test_week1_unit_shape_and_order(week1):
    data, _ = week1
    for i, u in enumerate(data["units"]):
        assert set(u) == UNIT_KEYS, u["id"]
        assert u["order"] == i
        assert u["unit_type"] == "sentence"
        assert u["speaker"] is None
        assert u["source"] == "FR"
        assert isinstance(u["line_no"], int)


def test_week1_block_start_marks_first_unit_of_each_block(week1):
    data, _ = week1
    prev_line = None
    starts = 0
    for u in data["units"]:
        is_new = u["line_no"] != prev_line
        assert u["block_start"] is is_new, u["id"]
        starts += is_new
        prev_line = u["line_no"]
    assert starts == 28
    assert [u["line_no"] for u in data["units"] if u["block_start"]] == [
        1, 4, 8, 14, 20, 21, 23, 25, 28, 29, 36, 42, 44, 51, 60, 63, 81, 88, 89,
        91, 101, 116, 117, 126, 128, 132, 141, 144]


def test_week1_tags(week1):
    data, report = week1
    by_id = {u["id"]: u for u in data["units"]}
    assert by_id["w01:8.1"]["tags"] == [{"label": "With Quintus being silent", "la": None, "kind": "gloss"}]
    assert "[" not in by_id["w01:8.1"]["en"] and by_id["w01:8.1"]["en"].startswith("Quintus remaining silent, Syra")
    assert by_id["w01:29.4"]["tags"] == [{"label": "He", "la": None, "kind": "gloss"}]
    assert by_id["w01:29.4"]["en"].startswith("Who, already before")
    assert by_id["w01:42.1"]["tags"][0]["label"] == "Why"
    assert by_id["w01:101.5"]["tags"] == [{"label": "echoed", "la": None, "kind": "gloss"}]
    assert by_id["w01:101.5"]["en"].endswith("which the hard rocks returned.")
    assert by_id["w01:81.2"]["tags"][0]["kind"] == "gloss"        # [With the Minotaur killed]
    assert by_id["w01:91.8"]["tags"][0]["label"] == "set sail"
    assert report["tags"]["gloss"] == 11
    assert report["tags"]["construction"] == {}


def test_week1_keeps_quotes_verbatim(week1):
    data, _ = week1
    by_id = {u["id"]: u for u in data["units"]}
    assert by_id["w01:63.1"]["la"].endswith("ferre nōn possum...'")
    assert by_id["w01:63.2"]["la"].startswith("'Deī' inquit Thēseus")
    assert by_id["w01:63.2"]["en"].startswith("'The gods,' said Theseus,")
    assert by_id["w01:91.4"]["la"] == "Ibi nāvis mea parāta est ad nāvigandum.'"
    # inquit inside a quotation does not split; "an" double question does
    assert by_id["w01:1.1"]["la"].endswith('"Nōlī" inquit "mē relinquere!')
    assert by_id["w01:4.3"]["la"].startswith("an fābulam dē puerō")
    assert by_id["w01:101.5"]["la"].startswith("Revertere ad mē!' neque")


def test_week1_matches_reference_alignment(week1):
    """Same ids and the same text as data/week01-aligned-sentences.json, ignoring
    the quote characters the reference splitter dropped."""
    if not REF1.exists():
        pytest.skip("reference alignment not present")
    data, _ = week1
    ref = [(f"w01:{s['id']}", s["la"], s["en"]) for b in json.loads(REF1.read_text(encoding="utf-8")) for s in b["sents"]]
    assert len(ref) == len(data["units"])
    q = lambda s: re.sub(r"[\"'\s]", "", s or "")
    for u, (rid, rla, ren) in zip(data["units"], ref):
        assert u["id"] == rid
        assert q(u["la"]) == q(rla), u["id"]
        assert q(u["en_raw"]) == q(ren), u["id"]


def test_week1_week_object(week1):
    data, _ = week1
    w = data["week"]
    assert w["n"] == 1 and w["id"] == "w01"
    assert w["title"] == "Thēseus et Mīnōtaurus"
    assert w["source"] == "FR" and w["chapter"] == "XXV" and w["has_line_numbers"] is True
    assert w["focus"]["key"] == "deponent" and w["focus"]["label"] and w["focus"]["blurb"]
    assert [(p["part"], p["lines"]) for p in w["parts"]] == [("Pars I", "1–41"), ("Pars II", "42–90"), ("Pars III", "91–144")]


# ----------------------------------------------------------------------------- weeks table

def test_weeks_table():
    assert [w["n"] for w in WEEKS] == list(range(1, 15))
    assert [w["id"] for w in WEEKS] == [f"w{n:02d}" for n in range(1, 15)]
    for w in WEEKS:
        assert set(w["focus"]) == {"key", "label", "blurb"} and all(w["focus"].values())
        assert w["source"] in {"FR", "FS", "FL", "FS+FL"}
        assert w["multi_text"] is (w["source"] == "FS+FL")
        assert w["has_line_numbers"] is (w["source"] != "FL")
    assert {w["n"] for w in WEEKS if w["source"] == "FS+FL"} == {3, 5, 10}
    assert WEEKS[12]["trim"] == {"end_before": "Hīs versibus recitātīs"}
    assert WEEKS[13]["trim"] == {"start_at": "Hīs versibus recitātīs"}


# ----------------------------------------------------------------------------- splitter / tags (synthetic)

def test_latin_splitter_respects_inquit_an_and_ellipsis():
    s = bw.split_sentences
    assert s('Pater "Venī" inquit "hūc, fīlī! Nōlī tardāre." Estne domī? an in hortō ambulat?', latin=True) == [
        'Pater "Venī" inquit "hūc, fīlī!', 'Nōlī tardāre."', 'Estne domī?', 'an in hortō ambulat?']
    assert s("Mārcus dormit... Iūlia cantat.", latin=True) == ["Mārcus dormit...", "Iūlia cantat."]
    assert s("Mārcus dormit… Iūlia cantat.", latin=True) == ["Mārcus dormit…", "Iūlia cantat."]
    assert s("Mārcus dormit... et Iūlia cantat.", latin=True) == ["Mārcus dormit... et Iūlia cantat."]
    assert s("'Tacē!' inquit pater. Puer tacet.", latin=True) == ["'Tacē!' inquit pater.", "Puer tacet."]
    assert s("Quid  agis?\nan   dormīs?", latin=True) == ["Quid agis?", "an dormīs?"]
    # English never splits before "an"
    assert s("Is he here? an old man is here.") == ["Is he here? an old man is here."]
    assert s("He said: 'Go! Now.' Then he left.") == ["He said: 'Go!", "Now.'", "Then he left."]


def test_classify_tag():
    c = bw.classify_tag
    assert c("imperfect subjunctive: mitterent") == {"label": "imperfect subjunctive", "la": "mitterent", "kind": "construction"}
    assert c("gerund: ad nāvigandum") == {"label": "gerund", "la": "ad nāvigandum", "kind": "construction"}
    assert c("Ablative Absolute") == {"label": "ablative absolute", "la": None, "kind": "construction"}
    assert c("dative of agent") == {"label": "dative of agent", "la": None, "kind": "construction"}
    assert c("Present Subjunctive") == {"label": "present subjunctive", "la": None, "kind": "construction"}
    for gloss in ("He", "Why", "echoed", "With Quintus being silent", "set sail", "at present", "by all means", "as a result"):
        assert c(gloss) == {"label": gloss, "la": None, "kind": "gloss"}, gloss


def test_extract_tags_collapses_spaces():
    en, tags = bw.extract_tags("Who [He], already before [gerund: ad legendum] he came [Ablative Absolute].")
    assert en == "Who, already before he came."
    assert [t["kind"] for t in tags] == ["gloss", "construction", "construction"]
    assert tags[1] == {"label": "gerund", "la": "ad legendum", "kind": "construction"}
    assert bw.extract_tags(None) == (None, [])


# ----------------------------------------------------------------------------- no-marker path

NO_MARKER_MD = """# Week 7 — fixture

## Pars I

### Textus Latīnus

Mārcus in hortō ambulat. Iūlia rosās carpit et cantat.

Pater "Venīte" inquit "ad vīllam, līberī! Cēna parāta est."

Līberī ad vīllam currunt.

### Literal English Translation

Marcus walks in the garden. Julia picks roses and sings.

Father says: "Come to the villa, children! Dinner is ready [has been prepared]."

The children run to the villa.

## Grammatica

Ignored section.
"""


def test_no_marker_path_pairs_paragraphs_in_order():
    data, report = bw.build_from_text(7, NO_MARKER_MD, notes={"b1.2": "note A", "w07:b3.1": "note B"})
    ids = [u["id"] for u in data["units"]]
    assert ids == ["w07:b1.1", "w07:b1.2", "w07:b2.1", "w07:b2.2", "w07:b3.1"]
    assert report["mismatches"] == [] and report["warnings"] == []
    assert all(u["line_no"] is None for u in data["units"])
    assert [u["block_start"] for u in data["units"]] == [True, False, True, False, True]
    assert all(u["unit_type"] == "sentence" for u in data["units"])
    u = data["units"][2]
    assert u["la"] == 'Pater "Venīte" inquit "ad vīllam, līberī!'
    assert u["en"] == 'Father says: "Come to the villa, children!'
    assert data["units"][3]["en"] == 'Dinner is ready."'
    assert data["units"][3]["tags"] == [{"label": "has been prepared", "la": None, "kind": "gloss"}]
    # notes accept both "b1.2" and "w07:b1.2" spellings
    assert data["units"][1]["note"] == "note A" and data["units"][4]["note"] == "note B"
    assert report["notes_matched"] == 2 and len(report["notes_missing"]) == 3
    assert data["week"]["parts"] == [{"part": "Pars I", "lines": None, "source": "FR"}]
    assert report["parts"][0]["marked"] is False


MISMATCH_MD = """## Pars I
### Textus Latīnus
Mārcus dormit. Iūlia cantat.
### Literal English Translation
Marcus sleeps while Julia sings.
"""


def test_mismatch_is_reported_not_guessed_and_fixed_by_merge():
    data, report = bw.build_from_text(7, MISMATCH_MD)
    assert [u["id"] for u in data["units"]] == ["w07:b1.1", "w07:b1.2"]
    assert data["units"][0]["en"] == "Marcus sleeps while Julia sings."
    assert data["units"][1]["en"] is None and data["units"][1]["en_raw"] is None
    assert len(report["mismatches"]) == 1
    mm = report["mismatches"][0]
    assert mm["key"] == "b1" and mm["la"] == ["Mārcus dormit.", "Iūlia cantat."] and mm["en"] == ["Marcus sleeps while Julia sings."]
    text = bw.render_report(report)
    assert "NEEDS REVIEW" in text and "2 Latin vs 1 English sentences" in text
    assert "| 0 | Mārcus dormit. | 0 | Marcus sleeps while Julia sings. |" in text
    assert "| 1 | Iūlia cantat. |  |  |" in text
    # the documented fix: merge the two Latin sentences in merges.py
    data2, report2 = bw.build_from_text(7, MISMATCH_MD, merges={"la": {"b1": [(0, 1)]}, "en": {}})
    assert report2["mismatches"] == []
    assert [u["la"] for u in data2["units"]] == ["Mārcus dormit. Iūlia cantat."]
    assert report2["merges_applied"] == ["la block 'b1': joined 0..1"]


# ----------------------------------------------------------------------------- speaker turns

TURN_MD = """## Fabellae Latīnae 66: Dāvus et Mēdus

### Textus Latīnus

Dāvus: Salvē, Mēde! Quid agis?

Mēdus: Bene est. Et tū? Dāvus: Ego quoque valeō.

### Literal English Translation

Davus: Hello, Medus! How are you?

Medus: It is well. And you? Davus: I too am well.
"""


def test_speaker_turns_one_unit_per_turn():
    data, report = bw.build_from_text(5, TURN_MD)
    us = data["units"]
    assert report["mismatches"] == [] and report["warnings"] == []
    assert [u["id"] for u in us] == ["w05:fl-66:b1.1", "w05:fl-66:b2.1", "w05:fl-66:b2.2"]
    assert [u["unit_type"] for u in us] == ["turn"] * 3
    assert [u["speaker"] for u in us] == ["Dāvus", "Mēdus", "Dāvus"]
    assert [u["la"] for u in us] == ["Salvē, Mēde! Quid agis?", "Bene est. Et tū?", "Ego quoque valeō."]
    assert [u["en"] for u in us] == ["Hello, Medus! How are you?", "It is well. And you?", "I too am well."]
    assert [u["block_start"] for u in us] == [True, True, False]
    assert all(u["source"] == "FL" and u["line_no"] is None for u in us)
    assert data["week"]["parts"] == [{"part": "Fabellae Latīnae 66: Dāvus et Mēdus", "lines": None, "source": "FL", "slug": "fl-66"}]


def test_marked_block_with_label_stays_sentences():
    md = "## Pars I (Lines 1–3)\n### Textus Latīnus\n[1] Syra: \"Quid agis? Dormīsne?\"\n### Literal English Translation\n[1] Syra: \"What are you doing? Are you sleeping?\"\n"
    data, report = bw.build_from_text(1, md, merges={"en": {}, "la": {}})
    assert [u["id"] for u in data["units"]] == ["w01:1.1", "w01:1.2"]
    assert data["units"][0]["la"] == 'Syra: "Quid agis?' and data["units"][0]["speaker"] is None
    assert data["units"][0]["unit_type"] == "sentence"


# ----------------------------------------------------------------------------- verse

VERSE_MD = """## Pars I (Lines 1–4)

### Textus Latīnus

[1] Sōl oritur. Cantant avēs in arbore summā,
    Iūlia sōla sedet; Mārcus abesse solet.

[3] Haec verba Mārcus legit. Iūlia rīdet.

### Literal English Translation

[1] The sun rises. The birds sing in the top of the tree,
Julia sits alone; Marcus is accustomed to be absent.

[3] Marcus reads these words. Julia laughs.
"""


def test_verse_block_one_unit_per_line_never_sentence_split():
    data, report = bw.build_from_text(13, VERSE_MD)
    us = data["units"]
    assert report["mismatches"] == []
    assert [u["id"] for u in us] == ["w13:1.1", "w13:1.2", "w13:3.1", "w13:3.2"]
    assert [u["unit_type"] for u in us] == ["verse", "verse", "sentence", "sentence"]
    assert us[0]["la"] == "Sōl oritur. Cantant avēs in arbore summā,"
    assert us[1]["la"] == "Iūlia sōla sedet; Mārcus abesse solet."
    assert us[1]["en"] == "Julia sits alone; Marcus is accustomed to be absent."
    assert [u["line_no"] for u in us] == [1, 1, 3, 3]
    assert [u["block_start"] for u in us] == [True, False, True, False]
    assert report["by_type"] == {"sentence": 2, "verse": 2, "turn": 0}


def test_verse_detection():
    assert bw.looks_like_verse("Arma virumque canō.\nTrōiae quī prīmus ab ōrīs.")
    assert bw.looks_like_verse("Arma virumque canō,  \n   trōiae quī prīmus.") is False   # lowercase line
    assert bw.looks_like_verse("Arma virumque canō. Trōiae quī prīmus ab ōrīs.") is False  # one line


OVERLAP_MD = """## Pars I (Lines 133–140)

### Textus Latīnus

[133] Ōdī et amō. Quārē id faciam fortasse requīris.
Nesciō, sed fierī sentiō et excrucior.

[139] Hīs versibus recitātīs Iūlia tacet. Mārcus rīdet.

### Literal English Translation

[133] I hate and I love. Why I do this, perhaps you ask.
I do not know, but I feel it happen and I am tormented.

[139] With these verses having been recited [Ablative Absolute], Julia is silent. Marcus laughs.
"""


def test_week13_14_overlap_rule():
    d13, r13 = bw.build_from_text(13, OVERLAP_MD)
    assert [u["id"] for u in d13["units"]] == ["w13:133.1", "w13:133.2"]
    assert len(r13["trimmed"]) == 1 and r13["trimmed"][0].startswith("[139]")
    d14, r14 = bw.build_from_text(14, OVERLAP_MD)
    assert [u["id"] for u in d14["units"]] == ["w14:139.1", "w14:139.2"]
    assert d14["units"][0]["la"].startswith("Hīs versibus recitātīs")
    assert d14["units"][0]["tags"] == [{"label": "ablative absolute", "la": None, "kind": "construction"}]
    assert d14["units"][0]["en"] == "With these verses having been recited, Julia is silent."
    assert len(r14["trimmed"]) == 1
    assert "overlap rule" in bw.render_report(r14)


# ----------------------------------------------------------------------------- CLI end to end

def test_cli_writes_build_files_and_index(tmp_path):
    (tmp_path / "source").mkdir()
    (tmp_path / "source" / "week-07.md").write_text(NO_MARKER_MD, encoding="utf-8")
    assert bw.main(["7", "--root", str(tmp_path), "--quiet"]) == 0
    out = json.loads((tmp_path / "data" / "build" / "week-07.json").read_text(encoding="utf-8"))
    assert out["week"]["id"] == "w07" and len(out["units"]) == 5
    assert (tmp_path / "data" / "build" / "week-07.report.md").exists()
    idx = json.loads((tmp_path / "data" / "build" / "weeks.json").read_text(encoding="utf-8"))
    assert [w["n"] for w in idx] == [7] and idx[0]["unit_count"] == 5
    # a missing week is an error, "all" only builds what exists
    assert bw.main(["8", "--root", str(tmp_path), "--quiet"]) == 1
    assert bw.main(["all", "--root", str(tmp_path), "--quiet"]) == 0


# ----------------------------------------------------------------------------- recover_lines (synthetic PDF)

def test_recover_lines_selftest(tmp_path):
    result = rl.selftest(tmp_path)
    assert result["ok"], result
    assert result["markers"] == [5, 10, 25, 30]          # odd pages only, like the book
    assert result["proposed"] == result["expected"]
    assert result["notes"] == []                          # extrapolation across the even page re-anchored cleanly
    confs = {p["id"]: p["confidence"] for p in result["proposals"]}
    assert confs["w07:b1.1"] == "high" and confs["w07:b3.1"] == "low"   # b3 starts on the unnumbered page


def test_recover_lines_apply(tmp_path):
    result = rl.selftest(tmp_path)
    build = tmp_path / "data" / "build"
    week_json = build / "week-07.json"
    assert week_json.exists()
    data = json.loads(week_json.read_text(encoding="utf-8"))
    assert all(u["line_no"] is None for u in data["units"])
    applied = rl.apply_proposals(week_json, result["proposals"])
    data = json.loads(week_json.read_text(encoding="utf-8"))
    assert applied == len(result["expected"])
    starts = [u["line_no"] for u in data["units"] if u["block_start"]]
    assert starts == list(result["expected"].values())
    # ids are stable: still block-based
    assert data["units"][0]["id"] == "w07:b1.1"
    # non-start units inherit their block's line
    assert all(u["line_no"] is not None for u in data["units"])
