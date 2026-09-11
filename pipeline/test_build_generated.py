# -*- coding: utf-8 -*-
"""The generated banks are what their templates would produce today
(GRAMMAR-CONTRACT.md §11b, §15 item 1).

A bank is a build artefact committed to the repo, so it can silently fall out
of step with the templates it came from: edit a template, forget to re-run the
builder, and the coverage check still passes while the learner practises
sentences the templates no longer describe. Each bank therefore records a
fingerprint of what built it, and these tests hold it.
"""
from __future__ import annotations

import json

import build_generated as BG
import generate_sentences as GS


def test_every_committed_bank_matches_its_templates_and_the_generator():
    assert BG.check_banks() == []


def test_every_bank_records_the_fingerprint_of_what_built_it():
    for path in sorted(BG.OUT_DIR.glob("*.json")):
        if path.stem == "index":
            continue
        bank = json.loads(path.read_text(encoding="utf-8"))
        assert bank.get("source") == BG.source_of(path.stem), path.stem


def test_a_template_edited_without_a_rebuild_is_caught(tmp_path, monkeypatch):
    skill = "purpose-clause"
    out = tmp_path / "generated"
    out.mkdir()
    bank = json.loads((BG.OUT_DIR / f"{skill}.json").read_text(encoding="utf-8"))
    bank["source"] = {**bank["source"], "templates": "0" * 64}
    (out / f"{skill}.json").write_text(json.dumps(bank, ensure_ascii=False), encoding="utf-8")
    problems = BG.check_banks([skill], out_dir=out)
    assert problems and "templates" in problems[0]


def test_a_bank_with_no_fingerprint_is_caught(tmp_path):
    skill = "purpose-clause"
    out = tmp_path / "generated"
    out.mkdir()
    bank = json.loads((BG.OUT_DIR / f"{skill}.json").read_text(encoding="utf-8"))
    bank.pop("source", None)
    (out / f"{skill}.json").write_text(json.dumps(bank, ensure_ascii=False), encoding="utf-8")
    assert BG.check_banks([skill], out_dir=out) == [
        f"{skill}: the bank records no source — re-run build_generated.py"]


def test_a_rebuild_reproduces_the_committed_bank(tmp_path):
    """Generation is deterministic per (skill, seed): the deep check is the one
    that proves the committed sentences are the builder's own."""
    assert BG.check_banks(["enclitics"], deep=True) == []


def test_the_generator_declares_a_version_the_banks_can_record():
    assert isinstance(GS.VERSION, str) and GS.VERSION
