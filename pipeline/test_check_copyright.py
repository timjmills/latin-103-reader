"""The copyright gate (pipeline/check_copyright.py).

The synthetic tests always run: a fake library and a fake public tree prove
the indexing, the normalisation and the allow-list. The real gate — the
whole of app/ against data/build — runs only where the library is on disk
(data/build next to the repo, or $LATIN103_BUILD) and is SKIPPED elsewhere,
so CI without the private text still passes while the local pre-deploy run
is the one that counts.

    python -m pytest pipeline/test_check_copyright.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import check_copyright as cc  # noqa: E402


def _write(path: Path, doc) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def library(tmp_path: Path) -> Path:
    build = tmp_path / "build"
    _write(build / "week-01.json", {
        "week": {"id": "w01", "parts": [{"summary_la": "Nostra ipsōrum summa fābulae hīc stat."}]},
        "units": [{
            "id": "w01:1.1",
            "la": "Syra, postquam facta Mārcī nārrāvit, abīre vult.",
            "en": "Syra, after she narrated the deeds of Marcus, wants to depart.",
            "note": "Our own note about postquam with the perfect tense here.",
            "margin": [{"la": "fābula -ae f (< fārī)", "en": "fābula: story (from fārī, to speak) — ours"}],
        }],
    })
    _write(build / "pensa-01.json", {"C": [{"q": "Quot servī sunt in familiā?", "answers": ["Centum servī in familiā sunt."]}]})
    _write(build / "collo-01.json", {"week": {"id": "c01"}, "units": [{"id": "c01:b1.1", "la": "Nōn amō tē, Sabidī, nec possum dīcere quārē."}]})
    _write(build / "vocab-whitaker.json", {"syra": [{"senses": ["Syra postquam facta Marci narravit abire"]}]})
    return build


def test_normalise_strips_macrons_case_v_and_j_and_punctuation():
    assert cc.normalise("Iūlius, VIR Rōmānus; jam!") == ["iulius", "uir", "romanus", "iam"]


def test_index_takes_the_book_and_the_translation_but_not_our_prose(library: Path):
    idx = cc.build_index(library)
    assert ("syra", "postquam", "facta", "marci", "narrauit") in idx.latin
    assert ("quot", "serui", "sunt", "in", "familia") in idx.latin
    assert ("centum", "serui", "in", "familia", "sunt") in idx.latin
    assert ("syra", "after", "she", "narrated", "the", "deeds", "of", "marcus") in idx.english
    # our own prose in the same files never indexes
    assert ("nostra", "ipsorum", "summa", "fabulae", "hic") not in idx.latin
    assert ("our", "own", "note", "about", "postquam", "with", "the", "perfect") not in idx.english
    assert ("fabula", "story", "from", "fari", "to", "speak", "ours", "x") not in idx.english
    # nor the Whitaker dictionary
    assert idx.files == 3
    # public-domain verse Ørberg reprints (latin_text.CLASSICAL) is left out
    assert ("non", "amo", "te", "sabidi", "nec") not in idx.latin


def test_scan_reports_json_path_and_text_line_and_honours_the_allow_list(library: Path, tmp_path: Path):
    idx = cc.build_index(library)
    app = tmp_path / "app"
    _write(app / "data" / "q.json", {"items": [
        {"q": "Quot servī sunt in familiā Iūliī?", "en": "How many slaves are there?"},   # a pensum question, verbatim
        {"q": "Quot servōs familia habet?", "en": "Syra, after she narrated the deeds of Marcus, left."},   # 8 words of the translation
        {"q": "Facta Mārcī nārrāvit Syra.", "en": "fine"},                                   # four book words: allowed
    ]})
    (app / "js").mkdir()
    (app / "js" / "a.js").write_text(
        "// nothing here\n// example: syra postquam facta marci narravit\nconst x = 1;\n", encoding="utf-8")
    hits = cc.scan(app, idx, allow={})
    got = sorted((h.file, h.path, h.kind) for h in hits)
    assert got == [
        ("data/q.json", "items/0/q", "latin"),
        ("data/q.json", "items/1/en", "english"),
        ("js/a.js", "line 2", "latin"),
    ]
    allowed = cc.scan(app, idx, allow={("data/q.json", "items/0/q"): "test", ("js/a.js", "line 2"): "test"})
    assert [(h.file, h.path) for h in allowed] == [("data/q.json", "items/1/en")]


def test_every_allow_list_entry_is_explained():
    for key, why in cc.ALLOW.items():
        assert isinstance(key, tuple) and len(key) == 2, key
        assert isinstance(why, str) and len(why) > 20, key


def test_the_public_tree_carries_no_run_of_the_private_text():
    build = cc.find_build(None)
    if build is None:
        pytest.skip("data/build (the private library) is not on this machine; the gate runs locally before deploy")
    idx = cc.build_index(build)
    hits = cc.scan(cc.APP, idx)
    assert not hits, "\n".join(f"{h.file} {h.path}: {h.text[:80]!r} <- {' '.join(h.window)}" for h in hits)
