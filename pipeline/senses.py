"""
Learner rewrite of Whitaker's Words sense strings. Deterministic rules only.

Whitaker packs a lot into a line: ``w/GEN``, ``(pl.)``, ``=>`` idioms in
square brackets, uppercase grammar codes, ``/``-joined alternatives and
``;``-separated sense groups. ``rewrite_senses`` turns one lexeme's raw sense
list into at most four readable English senses, most common first (Whitaker
already orders by commonness; idioms and cross-references go last or away).
"""

from __future__ import annotations

import re

MAX_SENSES = 4

# Ordered token replacements. Word-boundary anchored where the token is a word.
_ABBREV: list[tuple[str, str]] = [
    (r"\(w/-dem ONLY, ", "(only with -dem: "),
    (r"\bw/GEN\b", "with the genitive"),
    (r"\bw/DAT\b", "with the dative"),
    (r"\bw/ABL\b", "with the ablative"),
    (r"\bw/ACC\b", "with the accusative"),
    (r"\bw/INF\b", "with an infinitive"),
    (r"\bw/SUBJ\b", "with the subjunctive"),
    (r"\bw/NUM\b", "with a number"),
    (r"\bw/o\b", "without"),
    (r"\bw/", "with "),
    (r"\(pl\.\)", "(in the plural)"),
    (r"\(sg\.\)", "(in the singular)"),
    (r"\bpl\.", "plural"),
    (r"\bsg\.", "singular"),
    (r"\besp\.", "especially"),
    (r"\busu\.", "usually"),
    (r"\blit\.", "literally"),
    (r"\bfig\.", "figuratively"),
    (r"\babb\.", "abbreviation"),
    (r"\bpostpos\.", "placed after its word"),
    (r"\(postpositive\)", "(placed after its word)"),
    (r"\bpostpositive\b", "placed after its word"),
    (r"\binterog\b", "interrogative"),
    (r"\bintro\b", "introducing"),
    (r"\bNOM PERF PPL\b", "a perfect participle"),
    (r"\bPERF PPL\b", "perfect participle"),
    (r"\bPPL\b", "participle"),
    (r"\bDEMONST\b", "demonstrative"),
    (r"\bPERS\b", "personal"),
    (r"\bREFLEX\b", "reflexive"),
    (r"\bINTERR\b", "interrogative"),
    (r"\bINDEF\b", "indefinite"),
    (r"\bREL\b", "relative"),
    (r"\bADJ\b", "adjective"),
    (r"\bADV\b", "adverb"),
    (r"\bSUBJ\b", "subjunctive"),
    (r"\bIMP\b", "imperative"),
    (r"\bINF\b", "infinitive"),
    (r"\bPERF\b", "perfect"),
    (r"\bPRES\b", "present"),
    (r"\bFUT\b", "future"),
    (r"\bNOM\b", "nominative"),
    (r"\bGEN\b", "genitive"),
    (r"\bDAT\b", "dative"),
    (r"\bACC\b", "accusative"),
    (r"\bABL\b", "ablative"),
    (r"\bVOC\b", "vocative"),
    (r"\bGENDER\b", "gender"),
    (r"\bNUMBER\b", "number"),
    (r"\bNUM\b", "number"),
    (r"\bPACKON\b|\bTACKON\b", "enclitic"),
    (r"\bONLY\b", "only"),
    (r"\bIMPERS\b", "impersonal"),
    (r"\bDEP\b", "deponent"),
]
_ABBREV_RE = [(re.compile(p), r) for p, r in _ABBREV]

# Dictionary cross-references Whitaker appends in parentheses.
_XREF_RE = re.compile(
    r"\s*\((?:cf\.?|see |L\+S|Cas\.?|OLD|Souter|Bee|Ecc\.?|DeF|Sex|Def\.|Latham|Nelson|"
    r"G&L|G\+L|Collatinus|Lewis|Plater|Vulgate|Douay|Ecc)[^)]*\)?",
    re.I,
)
_TRAILING_XREF_RE = re.compile(r"[,;]?\s*\b(?:cf\.|see also|see)\s+[^;]*$", re.I)

# "word/word" → "word or word" (only a single slash, alphabetic, 3+ letters each)
_SLASH_RE = re.compile(r"(?<![A-Za-z/])([a-z]{3,})/([a-z]{3,})(?![A-Za-z/])")
# "make/build/construct/create/cause/do" → "make, build, construct, create":
# a chain of three or more slash-separated words or short phrases becomes a
# comma list, capped at four. Pronoun chains ("he/she/it/they") are left alone.
_SLASH_CHAIN_RE = re.compile(r"(?<![A-Za-z/])([A-Za-z][A-Za-z ]*(?:/[A-Za-z][A-Za-z ]*){2,})(?![A-Za-z/])")
_PRONOUN_WORDS = {"he", "she", "it", "they", "him", "her", "them", "his", "its", "their",
                  "i", "we", "you", "us", "me", "one", "who", "whom", "whose", "this", "that"}
_MAX_CHAIN = 4


def _split_chain(m: re.Match) -> str:
    items = [x.strip() for x in m.group(1).split("/")]
    items = [x for x in items if x]
    if len(items) < 3 or all(x.lower() in _PRONOUN_WORDS for x in items):
        return m.group(0)
    return ", ".join(items[:_MAX_CHAIN])


def _clean_one(s: str) -> str:
    s = s.strip()
    s = _XREF_RE.sub("", s)
    s = _TRAILING_XREF_RE.sub("", s)
    for rx, rep in _ABBREV_RE:
        s = rx.sub(rep, s)
    s = s.replace("=>", "=").replace("_", " ")
    s = _SLASH_CHAIN_RE.sub(_split_chain, s)
    s = _SLASH_RE.sub(r"\1 or \2", s)
    s = re.sub(r"\s+", " ", s)
    s = s.strip(" ;,.")
    # tidy parentheses spacing
    s = s.replace("( ", "(").replace(" )", ")")
    return s


def _split_raw(raw: list[str] | str) -> list[str]:
    """Whitaker's port sometimes hands back a sense as a list of single
    words (the ``uniques`` table); join those, then split on ``;``."""
    if isinstance(raw, str):
        items = [raw]
    else:
        items = list(raw)
        if len(items) > 1 and all(" " not in x and len(x) < 20 for x in items) and any(
            x.endswith(";") for x in items
        ):
            items = [" ".join(items)]
    out: list[str] = []
    for it in items:
        out.extend(part for part in it.split(";"))
    return out


def rewrite_senses(raw: list[str] | str, max_senses: int = MAX_SENSES) -> list[str]:
    """Raw Whitaker sense list → learner senses (≤ max_senses, deduped)."""
    plain: list[str] = []
    idioms: list[str] = []
    for chunk in _split_raw(raw):
        chunk = chunk.strip()
        if not chunk:
            continue
        is_idiom = chunk.lstrip().startswith("[") or "=>" in chunk
        chunk = chunk.replace("[", "").replace("]", "")
        s = _clean_one(chunk)
        if not s:
            continue
        # a bare parenthetical note is not a meaning
        if s.startswith("(") and s.endswith(")") and not plain:
            continue
        (idioms if is_idiom else plain).append(s)
    seen: set[str] = set()
    out: list[str] = []
    for s in plain + idioms:
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_senses:
            break
    return out


def raw_string(raw: list[str] | str) -> str:
    """The untouched Whitaker text, joined the way Whitaker prints it."""
    if isinstance(raw, str):
        return raw.strip()
    items = list(raw)
    if len(items) > 1 and all(" " not in x and len(x) < 20 for x in items) and any(
        x.endswith(";") for x in items
    ):
        return " ".join(items).strip()
    return "; ".join(x.strip().rstrip(";") for x in items if x.strip())


def head_word(sense: str) -> str:
    """The single most useful English word/phrase of a sense: text before the
    first comma, parentheticals removed. Used for the meaning line."""
    s = re.sub(r"\([^)]*\)", "", sense)
    s = s.split(",")[0].split(" or ")[0].split("/")[0]
    return re.sub(r"\s+", " ", s).strip(" ;.")
