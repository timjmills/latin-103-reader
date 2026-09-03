"""Real Whitaker sense strings → expected learner rewrites. Run: python -m pytest pipeline/"""

import pytest

from macrons import restore_v
from senses import head_word, raw_string, rewrite_senses

CASES = [
    # (raw Whitaker senses as the port returns them, expected list)
    (
        ["send, throw, hurl, cast", "let out, release, dismiss", "disregard"],
        ["send, throw, hurl, cast", "let out, release, dismiss", "disregard"],
    ),
    (
        ["girl, (female) child/daughter", "maiden", "young woman/wife"],
        ["girl, (female) child or daughter", "maiden", "young woman or wife"],
    ),
    (
        ["story, tale, fable", "play, drama", "[fabulae! => rubbish!, nonsense!]"],
        ["story, tale, fable", "play, drama", "fabulae! = rubbish!, nonsense!"],
    ),
    (
        ["be near, be present, be in attendance, arrive, appear", "aid (w/DAT)"],
        ["be near, be present, be in attendance, arrive, appear", "aid (with the dative)"],
    ),
    (
        ["good/moral/honest/brave man", "man of honor, gentleman", "better/rich people (pl.)"],
        ["good, moral, honest, brave man", "man of honor, gentleman", "better or rich people (in the plural)"],
    ),
    (
        ["he/she/it/they (by GENDER/NUMBER)", "DEMONST: that, he/she/it, they/them"],
        ["he/she/it/they (by gender or number)", "demonstrative: that, he/she/it, they or them"],
    ),
    (
        ["to be, exist", "also used to form verb perfect passive tenses with NOM PERF PPL"],
        ["to be, exist", "also used to form verb perfect passive tenses with a perfect participle"],
    ),
    (
        ["namely (postpos.)", "indeed"],
        ["namely (placed after its word)", "indeed"],
    ),
    (
        ['not? (interog, expects the answer "Yes")'],
        ['not? (interrogative, expects the answer "Yes")'],
    ),
    (
        ["(w/-dem ONLY, idem, eadem, idem) same, the same, the very same, also"],
        ["(only with -dem: idem, eadem, idem) same, the same, the very same, also"],
    ),
    (
        ["to (+ subjunctive), in order that/to", "how, as, when, while"],
        ["to (+ subjunctive), in order that/to", "how, as, when, while"],
    ),
    (
        # unclosed bracket: the port split the idiom on ';'
        ["night [prima nocte => early in the night", "multa nocte => late at night"],
        ["night prima nocte = early in the night", "multa nocte = late at night"],
    ),
    (
        ["by (agent), from (departure, cause, remote origin/time)", "after (reference)"],
        ["by (agent), from (departure, cause, remote origin or time)", "after (reference)"],
    ),
    (
        # more than four senses → capped at four, in Whitaker's order
        ["small table for cruets, credence, shelf/niche near altar for Eucharist", "buffet",
         "counting-board", "side-board", "slab table", "panel"],
        ["small table for cruets, credence, shelf or niche near altar for Eucharist", "buffet",
         "counting-board", "side-board"],
    ),
    (
        # the port's 'uniques' table hands senses back word by word
        ["let", "it", "be", "treated;", "let", "it", "be", "a", "matter", "or", "question", "of;"],
        ["let it be treated", "let it be a matter or question of"],
    ),
    (
        ["more, too much, more than enough", "more than (w/NUM)"],
        ["more, too much, more than enough", "more than (with a number)"],
    ),
    (
        ["remember  (PERF form, PRES force)", "keep in mind, pay heed to"],
        ["remember (perfect form, present force)", "keep in mind, pay heed to"],
    ),
]


@pytest.mark.parametrize("raw,expected", CASES)
def test_rewrite(raw, expected):
    assert rewrite_senses(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("make/build/construct/create/cause/do", "make, build, construct, create"),
    ("be away/absent/distant/missing", "be away, absent, distant, missing"),
    ("copper/bronze/brass, base metal", "copper, bronze, brass, base metal"),
    ("aim at/reach after/strive for/make for/seek", "aim at, reach after, strive for, make for"),
    ("he/she/it/they (by GENDER/NUMBER)", "he/she/it/they (by gender or number)"),
    ("young woman/wife", "young woman or wife"),
])
def test_slash_chains_become_lists(raw, expected):
    assert rewrite_senses([raw]) == [expected]


def test_idiom_moves_last():
    raw = ["[fabulae! => rubbish!]", "story, tale"]
    assert rewrite_senses(raw) == ["story, tale", "fabulae! = rubbish!"]


def test_raw_string_joins_word_lists():
    assert raw_string(["let", "them", "be", "treated;"]) == "let them be treated;"
    assert raw_string(["send, throw", "let go"]) == "send, throw; let go"


def test_head_word():
    assert head_word("send, throw, hurl, cast") == "send"
    assert head_word("girl, (female) child or daughter") == "girl"
    assert head_word("(female) child or daughter") == "child"
    assert head_word("he/she/it/they (by gender/number)") == "he"


# --- macrons.restore_v: consonantal u ---------------------------------------


@pytest.mark.parametrize("stem,pos,index,next_char,expected", [
    # M3 regression: "uu" before a vowel is vowel + consonant (iuvenis, not ivuenis)
    ("iuuenis", "N", 0, "u", "iuvenis"),
    ("iuuen", "N", 1, "i", "iuven"),
    ("iuuen", "ADJ", 0, "i", "iuven"),
    ("iuu", "V", 0, "o", "iuv"),        # iuvō
    ("iuu", "V", 2, "i", "iuv"),        # iūvī (perfect stem)
    ("adiuu", "V", 0, "o", "adiuv"),    # adiuvō
    ("uua", "N", 0, "u", "uva"),        # ūva
    # unchanged behaviour
    ("uiu", "ADJ", 0, "u", "viv"),      # vīvus
    ("ou", "N", 0, "u", "ov"),          # ovum
    ("uult", "V", 0, "", "vult"),
    ("uis", "V", 0, "", "vis"),
    ("nauis", "N", 0, "", "navis"),
    ("seru", "N", 0, "u", "serv"),
    ("uolu", "V", 2, "i", "volu"),      # voluī keeps the perfect-stem u
    ("aqua", "N", 0, "", "aqua"),
    ("equus", "N", 0, "", "equus"),
    ("iuu", "V", 0, "", "iuu"),         # no ending in sight: nothing guessed
])
def test_restore_v(stem, pos, index, next_char, expected):
    assert restore_v(stem, pos, index, next_char=next_char) == expected
