#!/usr/bin/env python
"""
build_week.py — source/week-NN.md  →  data/build/week-NN.json (+ .report.md)

    python pipeline/build_week.py 1          # one week
    python pipeline/build_week.py 1 4 7      # several
    python pipeline/build_week.py all        # every week whose source file exists
    python pipeline/build_week.py 7 --source path/to/other.md   # build from another file

Output shape: CONTRACT.md → `data/build/week-NN.json`. Also refreshes
`data/build/weeks.json`, the index of every week object whose build exists.

Document format (see parse_week_reference.py for the original notes)
---------------------------------------------------------------------
A week document is Markdown. Every *part* is a Latin subsection followed by an
English subsection:

    ## Pars I (Lines 1–41)              <- any heading; "(Lines …)" is optional
    ### Textus Latīnus                  <- heading containing "Textus" or "Latin"
    [1] Latin block …                   <- [n] = line number where the block starts
    [4] Latin block …
    ### Literal English Translation     <- heading containing "English" or "Translation"
    [1] English block …
    [4] English block …

Sections without that pair (Grammatica, Pēnsa, front matter) are ignored.

Four kinds of block are recognised, in this order of precedence:

  (a) [n]-marked blocks   → sentences; ids  w01:1.1, w01:1.2 …; line_no = n
  (b) unmarked paragraphs → Latin and English paragraphs paired in order;
                            ids w07:b3.2 (b = block index in the week). line_no is
                            null, except that the first block of a part whose
                            heading gives "(Lines a–b)" gets a (the part starts
                            there); later blocks stay null until recover_lines.py.
  (d) verse               → a block whose physical lines all end in a Markdown
                            hard break "\" (docx_to_md.py writes verse that way),
                            or whose ≥ 2 lines each start with a capital, is a
                            poem: one unit per line, unit_type "verse", never
                            sentence-split
  (c) speaker turns       → an *unmarked* paragraph beginning "Dāvus: …" in a
                            Fabellae Latīnae part is dialogue: one unit per turn,
                            unit_type "turn", `speaker` filled, the "Name:" prefix
                            removed. Familia Romana / Fabulae Syrae paragraphs
                            with a label ("Iūlius: …") stay sentences with the
                            label in the text, like Week 1's [n] blocks (whose
                            notes are keyed that way). OVERRIDES in merges.py
                            forces either.

Sentence splitting (Latin) splits after . ! ? … (optionally followed by a
closing quote) when the next token starts with a capital or an opening quote /
bracket, and before a lowercase "an" after "?" (second half of a double
question). Quotations with `inquit` inside them are therefore one sentence, as
the Latin intends. Text is verbatim apart from whitespace normalisation.

English bracket tags "[…]" are stripped from `en` (kept in `en_raw`) and
extracted to `tags`:
  - "[imperfect subjunctive: mitterent]" → construction, label lower-cased,
    la = the Latin after the colon
  - "[Ablative Absolute]"                → construction, la null
  - "[He]", "[Why]", "[echoed]", "[With Quintus being silent]" → gloss

Alignment is never guessed. When a block's Latin and English sentence counts
differ, units are still emitted (zipping what aligns, leftover Latin gets
en: null) and the block is written to the report with both lists side by side.
Fix it in pipeline/merges.py and rebuild.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
import unicodedata
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from weeks import BY_N, WEEKS, week_object  # noqa: E402
from merges import merges_for  # noqa: E402

try:  # optional per-week overrides (verse/prose/dialogue forcing); see merges.py
    from merges import OVERRIDES  # type: ignore
except ImportError:  # pragma: no cover
    OVERRIDES = {}

# --------------------------------------------------------------------------- text utils

CAP = "A-ZĀĒĪŌŪȲÆŒ"
OPEN_Q = "\"'“‘«(\\["
CLOSE_Q = "\"'”’»)"


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def strip_macrons(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def fold(s: str) -> str:
    """Lower-case, macron-free, single-spaced — for matching, never for display."""
    return norm_ws(strip_macrons(s)).lower()


def slugify(s: str, limit: int = 24) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", strip_macrons(s).lower()).strip("-")
    return s[:limit].rstrip("-")


# --------------------------------------------------------------------------- sentence splitting

# Split on whitespace that follows a terminal mark (. ! ? …), optionally plus a
# closing quote/bracket, when the next token opens with a capital, a quote or a
# bracket. The whitespace alone is consumed, so quotes stay on the sentences.
_TERM = "[.!?…]"
_AFTER_TERM = rf"(?:(?<={_TERM})|(?<={_TERM}[{CLOSE_Q}]))"
_LA_SPLIT = re.compile(
    rf"{_AFTER_TERM}\s+(?=[{OPEN_Q}{CAP}])"
    rf"|(?:(?<=\?)|(?<=\?[{CLOSE_Q}]))\s+(?=an\s)"
)
_EN_SPLIT = re.compile(rf"{_AFTER_TERM}\s+(?=[{OPEN_Q}{CAP}])")


_TAG_ONLY = re.compile(r"^(?:\s*\[[^\[\]]*\]\s*[.,;:!?]*\s*)+$")


def split_sentences(text: str, latin: bool = False) -> list[str]:
    text = norm_ws(text)
    pat = _LA_SPLIT if latin else _EN_SPLIT
    out = [s.strip() for s in pat.split(text) if s and s.strip()]
    if not latin:
        # "…with me! [optative subjunctive: essem]." — a bracket tag on its own is
        # not a sentence; it belongs to the sentence before it.
        glued: list[str] = []
        for piece in out:
            if glued and _TAG_ONLY.match(piece):
                glued[-1] = glued[-1] + " " + piece
            else:
                glued.append(piece)
        out = glued
    return out


# --------------------------------------------------------------------------- bracket tags

_BRACKET = re.compile(r"\s*\[([^\[\]]*)\]")

# A tag without a colon is a construction when it names a grammatical term.
# Only unambiguous terms are listed on their own; everyday words that double as
# grammar labels ("present", "means", "result", "agent" …) count only inside a
# recognisable phrase, so that a rendering like "[at present]" stays a gloss.
_GRAMMAR_TERMS = [
    "ablative", "accusative", "genitive", "dative", "nominative", "vocative", "locative",
    "gerund", "gerundive", "supine", "subjunctive", "indicative", "imperative", "infinitive",
    "participle", "periphrastic", "deponent", "pluperfect", "optative", "utinam", "dummodo",
    "hortatory", "jussive", "deliberative", "elision", "scansion", "hexameter", "pentameter",
    "hendecasyllable", "elegiac", "enclitic", "apposition", "partitive", "vocative",
    "ablative absolute", "abl\\. abs\\.", "acc\\. \\+ inf\\.", "accusative and infinitive",
    "accusative \\+ infinitive", "indirect statement", "indirect command", "indirect question",
    "purpose clause", "result clause", "cum clause", "cum-clause", "ut clause", "n[eē] clause",
    "ut/n[eē]", "relative clause", "connecting relative", "dative of agent", "dative of possession",
    "ablative of (?:means|agent|respect|separation|time|place|manner|degree|comparison|price)",
    "genitive of (?:possession|quality|value|the whole)", "accusative of (?:duration|extent|respect)",
    "(?:present|imperfect|future|perfect|pluperfect|future perfect) (?:subjunctive|indicative|tense|infinitive|participle|imperative)",
    "(?:present|perfect|future) passive", "passive periphrastic", "contrary[- ]to[- ]fact",
    "conditional", "prohibition", "double question", "sequence of tenses",
]
_CONSTRUCTION_RE = re.compile(r"\b(?:" + "|".join(_GRAMMAR_TERMS) + r")\b", re.I)


def classify_tag(inner: str) -> dict:
    inner = norm_ws(inner)
    if ":" in inner:
        label, _, la = inner.partition(":")
        return {"label": norm_ws(label).lower(), "la": norm_ws(la) or None, "kind": "construction"}
    if _CONSTRUCTION_RE.search(inner):
        return {"label": inner.lower(), "la": None, "kind": "construction"}
    return {"label": inner, "la": None, "kind": "gloss"}


def _tag_pieces(inner: str) -> list[str]:
    """"[Martial 7.3; negative purpose: nē mittās]" carries two tags."""
    pieces = [p for p in inner.split(";") if p.strip()]
    return pieces if len(pieces) > 1 else [inner]


def extract_tags(en_raw: str | None) -> tuple[str | None, list[dict]]:
    """→ (clean English, tags). Collapses the double spaces the brackets leave."""
    if en_raw is None:
        return None, []
    tags = [classify_tag(piece) for m in _BRACKET.finditer(en_raw) if m.group(1).strip()
            for piece in _tag_pieces(m.group(1))]
    clean = _BRACKET.sub("", en_raw)
    clean = re.sub(r"\s+([,.;:!?])", r"\1", clean)
    clean = re.sub(r"([.!?…])([\"'”’]?)\.(?=\s|$)", r"\1\2", clean)
    return norm_ws(clean), tags


# --------------------------------------------------------------------------- verse / dialogue detection

_MD_BREAK = re.compile(r"(?:\s{2,}|\\)$")
_LINE_START_CAP = re.compile(rf"^[{OPEN_Q}—–\-\s]*[{CAP}]")


def physical_lines(text: str) -> list[str]:
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    out = []
    for raw in text.split("\n"):
        line = _MD_BREAK.sub("", raw.strip())
        line = re.sub(r"^>\s?", "", line).strip()
        if line:
            out.append(line)
    return out


def has_hard_breaks(text: str) -> bool:
    """Every non-empty line ends in a Markdown backslash hard break — the explicit
    verse form docx_to_md.py writes (a one-line poem is possible)."""
    raw = [l.rstrip() for l in re.sub(r"<br\s*/?>", "\n", text, flags=re.I).split("\n") if l.strip()]
    return bool(raw) and all(l.endswith("\\") for l in raw)


def looks_like_verse(text: str) -> bool:
    """Explicit: every line ends in "\\". Implicit: ≥ 2 physical lines, every one
    starting with a capital (after an optional quote/dash) — prose paragraphs in
    these documents are single physical lines."""
    if has_hard_breaks(text):
        return True
    lines = physical_lines(text)
    return len(lines) >= 2 and all(_LINE_START_CAP.match(l) for l in lines)


_SPEAKER = rf"(?P<name>[{CAP}][^\s:]{{0,24}}(?:\s[{CAP}][^\s:]{{0,24}})?)"
_TURN_START = re.compile(rf"^{_SPEAKER}:\s+")
_TURN_RE = re.compile(
    rf"(?:^|(?<={_TERM})\s+|(?<={_TERM}[{CLOSE_Q}])\s+){_SPEAKER}:\s+"
)


def is_dialogue(text: str) -> bool:
    return bool(_TURN_START.match(norm_ws(text)))


def split_turns(text: str) -> list[tuple[str | None, str]]:
    """'Dāvus: Salvē! Mēdus: Salvē tū.' → [('Dāvus', 'Salvē!'), ('Mēdus', 'Salvē tū.')].
    Text before the first label (if any) becomes a turn with speaker None."""
    text = norm_ws(text)
    ms = list(_TURN_RE.finditer(text))
    if not ms:
        return [(None, text)]
    turns: list[tuple[str | None, str]] = []
    if ms[0].start() > 0:
        turns.append((None, text[: ms[0].start()].strip()))
    for k, m in enumerate(ms):
        end = ms[k + 1].start() if k + 1 < len(ms) else len(text)
        body = text[m.end():end].strip()
        turns.append((m.group("name"), body))
    return turns


# --------------------------------------------------------------------------- document parsing

_HEADING = re.compile(r"^(#{1,4})[ \t]+(.+?)[ \t]*#*[ \t]*$", re.M)
_LINES_SUFFIX = re.compile(r"\s*\((?:lines?|ll?\.|vv?\.|versūs|versus)\s*([^)]*)\)\s*$", re.I)
_MARK = re.compile(r"\[(\d+)\]")
_MARK_BLOCK = re.compile(r"\[(\d+)\]\s*(.*?)(?=\n\s*\[\d+\]|\Z)", re.S)


def _is_latin_heading(h: str) -> bool:
    """The Latin subsection: 'Textus Latīnus', 'Textus', 'Latin', 'Latin text'.
    A part heading such as 'Fabellae Latīnae 66' is not one."""
    h = h.strip()
    return bool(re.search(r"\btextus\b", h, re.I) or re.fullmatch(r"lat[iī]n(?:\s+text)?", h, re.I))


def _is_english_heading(h: str) -> bool:
    return bool(re.search(r"english|translation|anglic", h, re.I)) and not _is_latin_heading(h)


def _clean_heading(h: str) -> str:
    return norm_ws(re.sub(r"[*_`]", "", h))


class Block:
    __slots__ = ("key", "line_no", "text", "index")

    def __init__(self, key, line_no, text, index):
        self.key, self.line_no, self.text, self.index = key, line_no, text, index

    def __repr__(self):  # pragma: no cover
        return f"Block({self.key!r}, {self.line_no}, {self.text[:30]!r})"


def _split_blocks(body: str) -> tuple[bool, list[tuple[int | None, str]], str]:
    """→ (marked?, [(line_no, text)], leading unmarked text)."""
    body = "\n".join(l for l in body.split("\n") if l.strip() != "---")
    if _MARK.search(body):
        first = _MARK.search(body).start()
        leading = body[:first].strip()
        blocks = [(int(n), t.strip()) for n, t in _MARK_BLOCK.findall(body[first:]) if t.strip()]
        return True, blocks, leading
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    return False, [(None, p) for p in paras], ""


def parse_document(md: str) -> list[dict]:
    """→ [{name, lines, heading, la_body, en_body}] — one per Latin/English pair."""
    md = md.replace("\r\n", "\n").replace("﻿", "")
    heads = [(m.start(), m.end(), len(m.group(1)), _clean_heading(m.group(2))) for m in _HEADING.finditer(md)]
    parts = []
    i = 0
    while i < len(heads):
        s, e, lvl, text = heads[i]
        if _is_latin_heading(text) and i + 1 < len(heads) and _is_english_heading(heads[i + 1][3]):
            la_body = md[e: heads[i + 1][0]]
            en_end = heads[i + 2][0] if i + 2 < len(heads) else len(md)
            en_body = md[heads[i + 1][1]: en_end]
            # part heading = nearest preceding heading of a higher rank
            heading = None
            for j in range(i - 1, -1, -1):
                if heads[j][2] < lvl and not (_is_latin_heading(heads[j][3]) or _is_english_heading(heads[j][3])):
                    heading = heads[j][3]
                    break
            if heading is None:
                heading = f"Pars {len(parts) + 1}"
            m = _LINES_SUFFIX.search(heading)
            lines = norm_ws(m.group(1)) if m else None
            name = _LINES_SUFFIX.sub("", heading).strip() or heading
            parts.append({"name": name, "lines": lines, "heading": heading, "la_body": la_body, "en_body": en_body})
            i += 2
            continue
        i += 1
    return parts


# --------------------------------------------------------------------------- source / slug per part

def part_source(heading: str, week: dict, k: int) -> str:
    """FS / FL / FR for one part of the document."""
    if re.search(r"fabulae\s+syrae|\bFS\b", heading, re.I):
        return "FS"
    if re.search(r"fabellae|\bFL\b", heading, re.I):
        return "FL"
    if re.search(r"familia\s+r[oō]m[aā]na|\bFR\b", heading, re.I):
        return "FR"
    texts = week.get("texts", [])
    if week.get("multi_text") and k < len(texts):
        return texts[k]["source"]
    return week["source"].split("+")[0]


def part_slug(heading: str, source: str, k: int) -> str:
    h = _LINES_SUFFIX.sub("", heading)
    h = re.sub(r"fabulae\s+syrae|fabellae\s+lat[iī]nae|familia\s+r[oō]m[aā]na", "", h, flags=re.I)
    nums = re.findall(r"\d+", h.split(":", 1)[0] if ":" in h else h)
    if source == "FL" and nums:
        return "fl-" + "-".join(nums)
    if ":" in h:
        h = h.rsplit(":", 1)[1]
    return slugify(h) or f"p{k + 1}"


# --------------------------------------------------------------------------- merges

def apply_merges(sents: list[str], merges: list[tuple[int, int]], where: str, report: dict, key) -> list[str]:
    for a, b in merges:
        if not (0 <= a <= b < len(sents)):
            report["warnings"].append(
                f"merge {where} block {key!r} ({a},{b}) out of range for {len(sents)} sentences — ignored")
            continue
        sents = sents[:a] + [" ".join(sents[a: b + 1])] + sents[b + 1:]
        report["merges_applied"].append(f"{where} block {key!r}: joined {a}..{b}")
    return sents


# --------------------------------------------------------------------------- building

def _merge_key(block: Block, slug: str | None):
    """Key the user writes in merges.py for this block: the line number for [n]
    blocks, "bN" for unmarked ones (even when a line number is known for it)."""
    return f"{slug}:{block.key}" if slug else block.key


def _lookup_merges(table: dict, key) -> list:
    if key in table:
        return table[key]
    if isinstance(key, int) and str(key) in table:
        return table[str(key)]
    if isinstance(key, str) and key.isdigit() and int(key) in table:
        return table[int(key)]
    return []


def _overridden(week_n: int, kind: str, mkey) -> bool:
    keys = OVERRIDES.get(week_n, {}).get(kind, [])
    return mkey in keys or str(mkey) in map(str, keys)


def _mode_for(block: Block, marked: bool, week_n: int, mkey, source: str = "FR") -> str:
    if _overridden(week_n, "prose", mkey):
        return "sentence"
    if _overridden(week_n, "verse", mkey):
        return "verse"
    if _overridden(week_n, "dialogue", mkey):
        return "turn"
    if looks_like_verse(block.text):
        return "verse"
    if not marked and source == "FL" and is_dialogue(block.text):
        return "turn"
    return "sentence"


def _pieces(block_text: str | None, mode: str, latin: bool) -> list[tuple[str | None, str]]:
    """Cut one block into (speaker, text) pieces according to mode."""
    if block_text is None:
        return []
    if mode == "verse":
        return [(None, l) for l in physical_lines(block_text)]
    if mode == "turn":
        return split_turns(block_text)
    return [(None, s) for s in split_sentences(block_text, latin=latin)]


def _range_start(lines: str | None) -> int | None:
    """'60–126' → 60; None when there is no range."""
    m = re.match(r"\s*(\d+)", lines or "")
    return int(m.group(1)) if m else None


def _trim_blocks(la_blocks, en_blocks, marked, trim: dict, report: dict):
    """Week 13/14 overlap rule. Returns the (possibly shortened) block lists."""
    if not trim:
        return la_blocks, en_blocks
    phrase = fold(trim.get("end_before") or trim.get("start_at"))
    idx = next((i for i, (_, t) in enumerate(la_blocks) if phrase in fold(t)), None)
    if idx is None:
        return la_blocks, en_blocks          # not in this part; reported after the last part
    if not fold(la_blocks[idx][1]).startswith(phrase):
        report["warnings"].append(
            f"trim phrase {phrase!r} is inside block #{idx + 1}, not at its start — nothing trimmed; split the block in the source")
        return la_blocks, en_blocks
    if "end_before" in trim:
        keep_la, drop_la = la_blocks[:idx], la_blocks[idx:]
    else:
        keep_la, drop_la = la_blocks[idx:], la_blocks[:idx]
    if marked:
        keep_keys = {n for n, _ in keep_la}
        keep_en = [(n, t) for n, t in en_blocks if n in keep_keys]
    else:
        keep_en = en_blocks[:idx] if "end_before" in trim else en_blocks[idx:]
    report["trimmed"].extend(f"[{n}] {t[:60]}…" if n is not None else t[:60] + "…" for n, t in drop_la)
    return keep_la, keep_en


def build_from_text(n: int, md: str, notes: dict | None = None, merges: dict | None = None,
                    source_name: str = "") -> tuple[dict, dict]:
    """Build week n from Markdown text. → (data, report)."""
    week = BY_N[n]
    wid = week["id"]
    merges = merges if merges is not None else merges_for(n)
    notes = notes or {}
    report = {
        "week": n, "id": wid, "source_file": source_name,
        "built_at": _dt.datetime.now().isoformat(timespec="seconds"),
        "parts": [], "mismatches": [], "warnings": [], "info": [], "merges_applied": [], "trimmed": [], "skipped": [],
        "units": 0, "blocks": 0, "by_type": {"sentence": 0, "verse": 0, "turn": 0},
        "notes_matched": 0, "notes_missing": [], "notes_orphans": [],
        "tags": {"construction": {}, "gloss": 0},
        "en_missing": 0,
    }

    parts = parse_document(md)
    if not parts:
        report["warnings"].append("no Latin/English section pair found — check the headings "
                                  "(need a 'Textus Latīnus' heading followed by a 'Literal English Translation' heading)")

    wobj = week_object(n)
    units: list[dict] = []
    block_counter = 0
    trim = week.get("trim")
    trim_done = False

    for k, part in enumerate(parts):
        source = part_source(part["heading"], week, k)
        slug = part_slug(part["heading"], source, k) if week.get("multi_text") else None
        la_marked, la_blocks, la_leading = _split_blocks(part["la_body"])
        en_marked, en_blocks, en_leading = _split_blocks(part["en_body"])
        if la_leading:
            report["warnings"].append(f"part {part['name']!r}: Latin text before the first [n] marker was ignored: {la_leading[:80]!r}")
        if en_leading:
            report["warnings"].append(f"part {part['name']!r}: English text before the first [n] marker was ignored: {en_leading[:80]!r}")
        if la_marked != en_marked:
            report["warnings"].append(
                f"part {part['name']!r}: Latin is {'marked' if la_marked else 'unmarked'} but English is "
                f"{'marked' if en_marked else 'unmarked'} — pairing by order")
        marked = la_marked and en_marked
        if trim and not trim_done:
            before = len(la_blocks)
            la_blocks, en_blocks = _trim_blocks(la_blocks, en_blocks, marked, trim, report)
            trim_done = len(la_blocks) != before or bool(report["trimmed"])

        # pair blocks
        pairs: list[tuple[Block, str | None]] = []
        if marked:
            en_by_key = {ln: t for ln, t in en_blocks}
            la_keys = {ln for ln, _ in la_blocks}
            for ln, t in la_blocks:
                block_counter += 1
                pairs.append((Block(ln, ln, t, block_counter), en_by_key.get(ln)))
                if ln not in en_by_key:
                    report["warnings"].append(f"part {part['name']!r}: Latin block [{ln}] has no English block")
            for ln, t in en_blocks:
                if ln not in la_keys:
                    report["warnings"].append(f"part {part['name']!r}: English block [{ln}] has no Latin block — ignored: {t[:80]!r}")
        else:
            for i, (_, t) in enumerate(la_blocks):
                block_counter += 1
                en_t = en_blocks[i][1] if i < len(en_blocks) else None
                pairs.append((Block(f"b{block_counter}", None, t, block_counter), en_t))
            # the part heading says where the part starts: "(Lines 60–126)" → first block is line 60
            start = _range_start(part["lines"])
            if k == 0 and report["trimmed"] and "start_at" in (trim or {}):
                start = _range_start(week.get("lines"))
            if pairs and start is not None:
                pairs[0][0].line_no = start
            if len(en_blocks) > len(la_blocks):
                extra = [t[:80] for _, t in en_blocks[len(la_blocks):]]
                report["warnings"].append(
                    f"part {part['name']!r}: {len(en_blocks)} English paragraphs vs {len(la_blocks)} Latin — extra English ignored: {extra!r}")

        part_stats = {"name": part["name"], "lines": part["lines"], "source": source, "slug": slug,
                      "marked": marked, "blocks": len(pairs), "modes": {"sentence": 0, "verse": 0, "turn": 0}}
        pentry = {"part": part["name"], "lines": part["lines"], "source": source}
        if slug:
            pentry["slug"] = slug
        wobj["parts"].append(pentry)

        for block, en_text in pairs:
            mkey = _merge_key(block, slug)
            if _overridden(n, "skip", mkey):
                report["skipped"].append(f"block {mkey!r}: {block.text[:60]}…")
                continue
            latin_only = _overridden(n, "latin_only", mkey)
            if latin_only and en_text is not None:
                report["warnings"].append(f"block {mkey!r} is listed as latin_only but has English text — the English is kept")
                latin_only = False
            mode = _mode_for(block, marked, n, mkey, source)
            part_stats["modes"][mode] += 1
            la_pieces = _pieces(block.text, mode, latin=True)
            en_pieces = _pieces(en_text, mode, latin=False)
            if mode == "sentence":
                la_s = apply_merges([t for _, t in la_pieces], _lookup_merges(merges.get("la", {}), mkey), "la", report, mkey)
                en_s = apply_merges([t for _, t in en_pieces], _lookup_merges(merges.get("en", {}), mkey), "en", report, mkey)
                la_pieces = [(None, s) for s in la_s]
                en_pieces = [(None, s) for s in en_s]
            if len(la_pieces) != len(en_pieces) and not latin_only:
                report["mismatches"].append({
                    "part": part["name"], "key": mkey, "mode": mode, "line_no": block.line_no,
                    "la": [t for _, t in la_pieces], "en": [t for _, t in en_pieces],
                })
            id_base = f"{wid}:{slug + ':' if slug else ''}{block.key}"
            for i, (spk, la) in enumerate(la_pieces):
                en_raw = en_pieces[i][1] if i < len(en_pieces) else None
                if mode == "turn" and en_raw is not None and en_pieces[i][0] is None and spk is not None:
                    pass  # English turn had no label; keep its text as is
                en_clean, tags = extract_tags(en_raw)
                if en_raw is None:
                    report["en_missing"] += 1
                unit = {
                    "id": f"{id_base}.{i + 1}",
                    "order": len(units),
                    "part": part["name"],
                    "source": source,
                    "line_no": block.line_no,
                    "block_start": i == 0,
                    "unit_type": mode,
                    "speaker": spk if mode == "turn" else None,
                    "la": la,
                    "en": en_clean,
                    "en_raw": en_raw,
                    "note": None,
                    "tags": tags,
                }
                units.append(unit)
                report["by_type"][mode] += 1
                for t in tags:
                    if t["kind"] == "construction":
                        report["tags"]["construction"][t["label"]] = report["tags"]["construction"].get(t["label"], 0) + 1
                    else:
                        report["tags"]["gloss"] += 1
        report["parts"].append(part_stats)
        report["blocks"] += len(pairs)

    if trim and not report["trimmed"] and parts:
        phrase = trim.get("end_before") or trim.get("start_at")
        if "end_before" in trim:
            report["info"].append(f"overlap rule: {phrase!r} is not in this document — it already ends before it, nothing to trim")
        else:
            report["warnings"].append(f"trim phrase {phrase!r} not found in any Latin block — nothing trimmed")

    # notes: keys "line.sentence" | "w01:line.sentence" | "slug:line.sentence"
    if notes:
        by_suffix = {}
        for key, text in notes.items():
            k = key[len(wid) + 1:] if key.startswith(wid + ":") else key
            by_suffix[k] = text
        seen = set()
        for u in units:
            suffix = u["id"][len(wid) + 1:]
            if suffix in by_suffix:
                u["note"] = by_suffix[suffix]
                report["notes_matched"] += 1
                seen.add(suffix)
            else:
                report["notes_missing"].append(u["id"])
        report["notes_orphans"] = sorted(k for k in by_suffix if k not in seen)

    report["units"] = len(units)
    data = {"week": wobj, "units": units}
    return data, report


# --------------------------------------------------------------------------- report rendering

def render_report(r: dict) -> str:
    ok = not r["mismatches"] and not r["warnings"]
    status = "OK" if ok else ("NEEDS REVIEW" if r["mismatches"] else "OK WITH WARNINGS")
    L = []
    L.append(f"# Week {r['week']:02d} build report — {status}\n")
    L.append(f"- source: `{r['source_file']}`  ")
    L.append(f"- built: {r['built_at']}  ")
    L.append(f"- units: **{r['units']}** in {r['blocks']} blocks "
             f"(sentence {r['by_type']['sentence']}, verse {r['by_type']['verse']}, turn {r['by_type']['turn']})  ")
    L.append(f"- mismatched blocks: **{len(r['mismatches'])}**  ")
    L.append(f"- units without English: {r['en_missing']}  ")
    L.append(f"- notes matched: {r['notes_matched']} · units without a note: {len(r['notes_missing'])} · "
             f"note keys with no unit: {len(r['notes_orphans'])}  ")
    L.append(f"- tags: {sum(r['tags']['construction'].values())} construction, {r['tags']['gloss']} gloss\n")

    L.append("## Parts\n")
    L.append("| part | lines | source | slug | markers | blocks | sentence / verse / turn |")
    L.append("| --- | --- | --- | --- | --- | --- | --- |")
    for p in r["parts"]:
        m = p["modes"]
        L.append(f"| {p['name']} | {p['lines'] or '—'} | {p['source']} | {p['slug'] or '—'} | "
                 f"{'[n]' if p['marked'] else 'none'} | {p['blocks']} | {m['sentence']} / {m['verse']} / {m['turn']} |")
    L.append("")

    if r["merges_applied"]:
        L.append("## Merges applied (pipeline/merges.py)\n")
        L += [f"- {m}" for m in r["merges_applied"]]
        L.append("")
    if r["trimmed"]:
        L.append("## Blocks dropped by the week 13/14 overlap rule\n")
        L += [f"- {t}" for t in r["trimmed"]]
        L.append("")
    if r["skipped"]:
        L.append("## Blocks skipped (OVERRIDES \"skip\" in pipeline/merges.py)\n")
        L += [f"- {t}" for t in r["skipped"]]
        L.append("")
    if r["warnings"]:
        L.append("## Warnings\n")
        L += [f"- {w}" for w in r["warnings"]]
        L.append("")
    if r.get("info"):
        L.append("## Notes\n")
        L += [f"- {w}" for w in r["info"]]
        L.append("")

    L.append("## Mismatches\n")
    if not r["mismatches"]:
        L.append("None — every block's Latin and English counts agree.\n")
    for mm in r["mismatches"]:
        what = {"sentence": "sentences", "verse": "verse lines", "turn": "speaker turns"}[mm["mode"]]
        L.append(f"### Block `{mm['key']}` ({mm['part']}, {mm['mode']}): {len(mm['la'])} Latin vs {len(mm['en'])} English {what}\n")
        if mm["mode"] == "sentence":
            L.append(f"Fix in `pipeline/merges.py` under week {r['week']} with block key `{mm['key']!r}`: "
                     f"`\"en\"` merges join two English sentences, `\"la\"` merges join two Latin ones. Indices below.\n")
        elif mm["mode"] == "verse":
            L.append("Verse blocks pair line by line: make the English block have one line per Latin line "
                     "(or force prose with OVERRIDES in merges.py).\n")
        else:
            L.append("Dialogue blocks pair turn by turn: check the speaker labels on both sides "
                     "(one capitalised word, or two, followed by a colon).\n")
        L.append("| # | Latin | # | English |")
        L.append("| --- | --- | --- | --- |")
        for i in range(max(len(mm["la"]), len(mm["en"]))):
            la = mm["la"][i].replace("|", "\\|") if i < len(mm["la"]) else ""
            en = mm["en"][i].replace("|", "\\|") if i < len(mm["en"]) else ""
            L.append(f"| {i if i < len(mm['la']) else ''} | {la} | {i if i < len(mm['en']) else ''} | {en} |")
        L.append("")

    if r["tags"]["construction"]:
        L.append("## Construction tags found (seed list for highlights)\n")
        for label, c in sorted(r["tags"]["construction"].items(), key=lambda x: (-x[1], x[0])):
            L.append(f"- {label} × {c}")
        L.append("")
    if r["notes_orphans"]:
        L.append("## Note keys with no matching unit\n")
        L += [f"- {k}" for k in r["notes_orphans"]]
        L.append("")
    if r["notes_missing"] and r["notes_matched"]:
        L.append("## Units without a note\n")
        L += [f"- {k}" for k in r["notes_missing"]]
        L.append("")
    return "\n".join(L) + "\n"


# --------------------------------------------------------------------------- files

def source_path(n: int, root: Path = ROOT) -> Path:
    return root / "source" / f"week-{n:02d}.md"


def notes_path(n: int, root: Path = ROOT) -> Path | None:
    for cand in (root / "data" / f"grammar-notes-week{n:02d}.json",
                 root / "data" / f"grammar-notes-week-{n:02d}.json"):
        if cand.exists():
            return cand
    return None


def build_dir(root: Path = ROOT) -> Path:
    d = root / "data" / "build"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_weeks_index(root: Path = ROOT) -> Path:
    """data/build/weeks.json — every week object whose build file exists."""
    out = []
    for w in WEEKS:
        p = build_dir(root) / f"week-{w['n']:02d}.json"
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
            entry = dict(data["week"])
            entry["unit_count"] = len(data["units"])
            out.append(entry)
    idx = build_dir(root) / "weeks.json"
    idx.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return idx


def build_week_file(n: int, root: Path = ROOT, source: Path | None = None, quiet: bool = False) -> dict:
    src = source or source_path(n, root)
    if not src.exists():
        raise FileNotFoundError(f"no source document for week {n}: {src}")
    md = src.read_text(encoding="utf-8")
    np_ = notes_path(n, root)
    notes = json.loads(np_.read_text(encoding="utf-8")) if np_ else {}
    data, report = build_from_text(n, md, notes=notes, source_name=str(src.relative_to(root) if src.is_relative_to(root) else src))
    # Section summaries (data/summaries-week-NN.json: {slug-or-part-name: {"en": …, "la": …}})
    # ride on week.parts as summary_en / summary_la when present.
    sp = root / "data" / f"summaries-week-{n:02d}.json"
    if sp.exists():
        summ = json.loads(sp.read_text(encoding="utf-8"))
        for pentry in data["week"]["parts"]:
            hit = summ.get(pentry.get("slug") or "") or summ.get(pentry["part"]) or summ.get(pentry["part"].split(":")[0].strip())
            if hit:
                pentry["summary_en"] = hit.get("en")
                pentry["summary_la"] = hit.get("la")
    # Plain-words explanations (data/grammar-notes-simple-week-NN.json: {unit_id: text}).
    simp = root / "data" / f"grammar-notes-simple-week-{n:02d}.json"
    if simp.exists():
        simple = json.loads(simp.read_text(encoding="utf-8"))
        for u in data["units"]:
            u["note_simple"] = simple.get(u["id"])
    out = build_dir(root) / f"week-{n:02d}.json"
    rep = build_dir(root) / f"week-{n:02d}.report.md"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    rep.write_text(render_report(report), encoding="utf-8")
    if not quiet:
        status = "OK" if not report["mismatches"] else f"{len(report['mismatches'])} MISMATCH(ES)"
        print(f"week {n:02d}: {report['units']} units, {report['blocks']} blocks, {status}"
              + (f", {len(report['warnings'])} warning(s)" if report["warnings"] else "")
              + f" -> {out.relative_to(root)}")
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weeks", nargs="+", help="week numbers (1–14) or 'all'")
    ap.add_argument("--source", type=Path, help="build from this Markdown file instead of source/week-NN.md (single week only)")
    ap.add_argument("--root", type=Path, default=ROOT, help="repo root (default: parent of pipeline/)")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    root = a.root.resolve()

    if a.weeks == ["all"]:
        nums = [w["n"] for w in WEEKS if source_path(w["n"], root).exists()]
        if not nums:
            print("no source/week-NN.md files found", file=sys.stderr)
            return 1
    else:
        try:
            nums = [int(x) for x in a.weeks]
        except ValueError:
            ap.error("weeks must be integers 1–14 or 'all'")
        bad = [x for x in nums if x not in BY_N]
        if bad:
            ap.error(f"unknown week(s): {bad}")
    if a.source and len(nums) != 1:
        ap.error("--source applies to a single week")

    rc = 0
    for n in nums:
        try:
            build_week_file(n, root, source=a.source, quiet=a.quiet)
        except FileNotFoundError as e:
            print(str(e), file=sys.stderr)
            rc = 1
            continue
        # A rebuild starts from the source document, so re-attach the
        # scan-derived line numbers and marginal glosses when they exist
        # (CONTRACT.md "Margin notes"); otherwise the week would silently
        # lose them.
        if (build_dir(root) / f"margin-week-{n:02d}.json").exists() or (build_dir(root) / f"lines-week-{n:02d}.json").exists():
            try:
                from attach_margins import process_week as _attach
                _attach(n, root)
                if not a.quiet:
                    print(f"week {n:02d}: margins re-attached")
            except Exception as e:  # never lose the build over the attach step
                print(f"week {n:02d}: margin attach failed: {e}", file=sys.stderr)
                rc = 1
    idx = write_weeks_index(root)
    if not a.quiet:
        print(f"index -> {idx.relative_to(root)}")
    return rc


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):  # Windows consoles default to cp1252
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
