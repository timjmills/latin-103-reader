"""SENSE_OVERRIDES must not hand one sense list to two different words.

    python -m pytest pipeline/test_sense_overrides.py -q

The override table is keyed on (part of speech, headword), and that is one
discriminator short wherever two lexemes share both.  volō, velle "want" and
volō, volāre "fly" are both ("V", "volo"), so velle's senses were stamped on
the fly-verb and the reader's dictionary said *volat* = "he/she/it wants".

`SENSE_OVERRIDE_CAT` gates an override by Whitaker category.  What is held here
is that the gate exists wherever it is needed, and that the shipped glossary
actually shows the two verbs apart — so the fault cannot return either by
someone dropping the gate or by someone hand-editing glossary.json back.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))

import build_glossary as bg  # noqa: E402

GLOSSARY = ROOT / "app" / "data" / "glossary.json"


@pytest.fixture(scope="module")
def glossary() -> dict:
    if not GLOSSARY.exists():
        pytest.skip("glossary.json not built")
    return json.loads(GLOSSARY.read_text(encoding="utf-8"))


def test_the_two_volos_are_gated_apart():
    """The gate that fixes the reported fault, stated directly."""
    assert ("V", "volo") in bg.SENSE_OVERRIDES
    assert bg.SENSE_OVERRIDE_CAT[("V", "volo")] == {(6, 2)}
    # velle is (6,2) and takes the override; volāre is (1,1) and must not.
    assert (6, 2) in bg.SENSE_OVERRIDE_CAT[("V", "volo")]
    assert (1, 1) not in bg.SENSE_OVERRIDE_CAT[("V", "volo")]


def test_every_gate_names_a_real_override():
    """A gate on a key with no override silently does nothing."""
    for key in bg.SENSE_OVERRIDE_CAT:
        assert key in bg.SENSE_OVERRIDES, f"{key} is gated but has no override"


def _lexeme(lemma: str) -> str:
    """One word's identity, ignoring the two things that split a dictionary form
    without making it a different word: a capital (Deus / deus) and a folded
    enclitic (tū, tuī / tū, tuī (+ -cum: with))."""
    base = re.split(r"\s*\(\+\s*-|\s*\+\s*-", lemma or "")[0]
    return base.strip().lower()


def test_no_override_covers_two_words_ungated(glossary):
    """The general rule, and the one this fault needed: gate an override the
    moment its (pos, headword) covers two different *words* with different
    paradigms.

    Not merely two category codes — eō, fīō, quī and quis each have one
    dictionary form filed under several of Whitaker's codes, and their override
    is meant for all of them.  What must never happen is one sense list landing
    on two different dictionary forms, which is exactly volō velle / volō
    volāre."""
    # (pos, headword) → lexeme → the categories the glossary has for it
    seen: dict[tuple[str, str], dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for entries in glossary.values():
        for e in entries:
            pos = "V" if e.get("pos") == "VPAR" else e.get("pos")
            if not pos or not e.get("h"):
                continue
            seen[(pos, e["h"])][_lexeme(e.get("lemma"))].add(tuple(e.get("cat") or (0, 0)))

    ungated = []
    for key in bg.SENSE_OVERRIDES:
        if key in bg.SENSE_OVERRIDE_CAT:
            continue
        words = seen.get(key, {})
        if len(words) < 2:
            continue
        paradigms = {c for cats in words.values() for c in cats}
        if len(paradigms) > 1:
            ungated.append(f"{key} covers {sorted(words)} over {sorted(paradigms)}")
    assert ungated == [], (
        "these overrides stamp one sense list on two different words; gate them "
        "in SENSE_OVERRIDE_CAT:\n" + "\n".join(ungated)
    )


def test_the_rule_would_have_caught_the_reported_fault(glossary):
    """The guard above is only worth having if it fires on the real fault, so
    check it does — with volō's gate removed."""
    gate = dict(bg.SENSE_OVERRIDE_CAT)
    gate.pop(("V", "volo"))
    seen: dict[tuple[str, str], dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for entries in glossary.values():
        for e in entries:
            pos = "V" if e.get("pos") == "VPAR" else e.get("pos")
            if pos == "V" and e.get("h") == "volo":
                seen[(pos, "volo")][_lexeme(e.get("lemma"))].add(tuple(e.get("cat") or (0, 0)))
    words = seen[("V", "volo")]
    assert ("V", "volo") not in gate
    assert len(words) == 2, f"expected velle and volāre, got {sorted(words)}"
    assert len({c for cats in words.values() for c in cats}) == 2


def test_the_shipped_glossary_tells_the_two_volos_apart(glossary):
    """Belt and braces: the artifact itself, not just the builder."""
    fly = [e for es in glossary.values() for e in es
           if e.get("h") == "volo" and tuple(e.get("cat") or ()) == (1, 1)]
    want = [e for es in glossary.values() for e in es
            if e.get("h") == "volo" and tuple(e.get("cat") or ()) == (6, 2)]
    assert fly, "no volō volāre readings in the glossary"
    assert want, "no volō velle readings in the glossary"
    for e in fly:
        assert e["senses"] == ["fly"], f"{e['lemma']} says {e['senses']}"
        assert "volāre" in e["lemma"]
    for e in want:
        assert e["senses"] == ["want, wish, be willing"]
        assert "velle" in e["lemma"]


def test_volat_is_flying(glossary):
    """The learner's own example."""
    entries = glossary["volat"]
    volo = [e for e in entries if e.get("h") == "volo"]
    assert volo, "volat has no volō reading"
    assert volo[0]["senses"] == ["fly"]
    assert volo[0]["lemma"] == "volō, volāre, volāvī, volātum"


def test_ludum_keeps_every_sense(glossary):
    """The other half of the report: the senses were always there."""
    ludus = [e for e in glossary["ludum"] if e.get("h") == "ludus"]
    assert ludus, "ludum has no lūdus reading"
    assert ludus[0]["senses"] == [
        "game, play, sport, pastime, entertainment, fun",
        "school, elementary school",
    ]


def test_velle_does_not_claim_volares_gerund_or_participle(glossary):
    """The other half of the volō collision, and the reason it could only be
    fixed once the two verbs were told apart.

    Whitaker matches stems, so `vol-` + 1st-conjugation endings hands volandī,
    volandō, volandum and volantēs to velle.  velle has no gerund, and its
    participle stem is volent-, not volant-.  Until volāre existed separately
    in the glossary the duplicate-merge had deleted it, so these forms had
    nowhere else to go; now they are volāre's alone."""
    for form in ("volandi", "volando", "volandum", "volantes"):
        readings = [e for e in glossary.get(form, []) if e.get("h") == "volo"]
        assert readings, f"{form} lost its volō reading entirely"
        for e in readings:
            assert "volāre" in e["lemma"], f"{form} is filed under {e['lemma']}"
            assert e["senses"] == ["fly"]


def test_hand_table_denies_only_touches_hand_tabled_irregulars():
    """The filter must never second-guess an ordinary verb."""
    import latin_forms

    ordinary = {"h": "amo", "pos": "VPAR", "cat": [1, 1], "roots": ["am", "am", "amāv", "amāt"]}
    assert latin_forms.irregular_table(ordinary) is None
    assert bg.hand_table_denies(ordinary, "amandi") is False
    # …and a finite reading is never touched, only a participle one.
    finite = {"h": "volo", "pos": "V", "cat": [6, 2], "roots": ["vol", "vel", "volu", "-"]}
    assert bg.hand_table_denies(finite, "volandi") is False


def test_the_filter_drops_the_readings_it_was_written_for():
    velle_ppl = {"h": "volo", "pos": "VPAR", "cat": [6, 2], "roots": ["vol", "vel", "volu", "-"]}
    assert bg.hand_table_denies(velle_ppl, "volandi") is True
    assert bg.hand_table_denies(velle_ppl, "volantes") is True
    # a form velle really does have is kept
    assert bg.hand_table_denies(velle_ppl, "volentes") is False


def test_senses_never_exceed_the_builders_own_ceiling(glossary):
    """The popup prints the whole list, so the list is the bound. senses.py
    caps at MAX_SENSES; nothing downstream may exceed it."""
    import senses

    worst = max((len(e.get("senses") or []) for es in glossary.values() for e in es), default=0)
    assert worst <= senses.MAX_SENSES, f"a reading carries {worst} senses"
