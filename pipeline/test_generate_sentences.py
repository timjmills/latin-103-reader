"""The sentence generator (contract §11). Run: python -m pytest pipeline/test_generate_sentences.py

Pins every cause the pilot's five hostile reads found, so a regression is a
failing test and not a shipped sentence: the reliability gate on the
glossary's uneven macrons, the verb and adjective frames that were too
broad, the nouns the book never pluralises, the English and gloss slips, and
the §11 checks themselves.  The last tests generate every pilot skill at two
seeds and hold the shipped set to the invariants a learner would see.
"""

import re

import pytest

import generate_sentences as g


@pytest.fixture(scope="module")
def lex():
    return g.Lexicon()


def word(lex, lemma, pos="N"):
    w = lex.word(lemma, pos)
    assert w is not None, f"{lemma} ({pos}) is not a deck word"
    return w


# ------------------------------------------------------------ reliability gate

@pytest.mark.parametrize("lemma,pos,scope", [
    ("adveniō", "V", "all"),      # present roots adveni / advēn: advēniente was shipped in pass 1
    ("custodiō", "V", "all"),     # cūstōdiat
    ("edō", "V", "all"),          # Whitaker's edāre homograph: edāre, edat
    ("līber", "N", "all"),        # liber, līberī in the glossary: līberōs for the book
    ("irascor", "V", "all"),      # deck spelling without macrons
    ("plōrō", "V", "perf"),       # ploravērunt: the present system is sound
    ("portō", "V", "perf"),       # portavērunt
    ("dēlectō", "V", "perf"),     # delectavī
    ("cōnsīdō", "V", "perf"),     # consedērunt: the perfect drops the present's macron
    ("mīlitō", "V", "perf"),      # militavit reached the page through a `same` slot
])
def test_the_gate_keeps_the_glossary_gaps_off_the_page(lex, lemma, pos, scope):
    assert word(lex, lemma, pos).unreliable_scope == scope


@pytest.mark.parametrize("lemma,pos", [
    ("videō", "V"), ("veniō", "V"), ("capiō", "V"), ("legō", "V"),   # a lengthened perfect is Latin, not a gap
    ("dō", "V"), ("stō", "V"),                                        # a short supine vowel is Latin too
    ("puer", "N"), ("magnus", "ADJ"), ("vocō", "V"),
])
def test_the_gate_leaves_sound_words_alone(lex, lemma, pos):
    assert word(lex, lemma, pos).unreliable_scope is None


def test_a_perfect_only_word_is_drawn_in_the_present_but_not_the_perfect(lex):
    w = word(lex, "portō", "V")
    assert w in lex.pool("V", 6)
    assert g.uses_perfect_system({"tense": "perf", "mood": "ind"})
    assert not g.uses_perfect_system({"tense": "pres", "mood": "ind"})


# ------------------------------------------------------------ frames

@pytest.mark.parametrize("verb,role,noun", [
    ("portō", "obj", "titulus"),      # titles carried to the garden
    ("dō", "obj", "fenestra"),        # a window given
    ("dō", "obj", "capitulum"),
    ("sinō", "obj", "deus"),          # sinō is complement-only
    ("vehō", "obj", "mūrus"),         # Marcus carries the wall
    ("nōminō", "obj", "vestīgium"),
    ("mergō", "obj", "puella"),
    ("iungō", "obj", "mēnsa"),
    ("dūcō", "obj", "apis"),
    ("tergeō", "obj", "baculum"),
    ("agō", "obj", "leō"),
    ("relinquō", "obj", "līnea"),
    ("amō", "obj", "arcūs"),
    ("augeō", "obj", "iānua"),
    ("efficiō", "obj", "sēstertius"),
    ("mīlitō", "subj", "Lȳdia"),     # a woman serving as a soldier
    ("cōnsīdō", "subj", "piscis"),
    ("errō", "subj", "piscis"),
    ("ambulō", "subj", "piscis"),
    ("currō", "subj", "piscis"),
    ("mordeō", "subj", "amīcus"),
    ("lūdō", "subj", "piscis"),
    ("pariō", "subj", "puer"),
    ("lātrō", "subj", "puer"),
])
def test_a_frame_refuses_the_combination_the_review_rejected(lex, verb, role, noun):
    v = word(lex, verb, "V")
    n = lex.word(noun, "N") or lex.word(noun, "NAME")
    assert n is not None
    assert not g._arg_ok(v.sem, role, n)


@pytest.mark.parametrize("verb,role,noun", [
    ("dō", "obj", "nummus"), ("dō", "obj", "pecūnia"), ("portō", "obj", "saccus"),
    ("vehō", "obj", "lectīca"), ("mīlitō", "subj", "Mārcus"), ("mordeō", "subj", "canis"),
    ("verberō", "obj", "servus"), ("lātrō", "subj", "canis"), ("numerō", "obj", "pecūnia"),
])
def test_a_frame_keeps_the_book_s_own_combinations(lex, verb, role, noun):
    v = word(lex, verb, "V")
    n = lex.word(noun, "N") or lex.word(noun, "NAME")
    assert g._arg_ok(v.sem, role, n)


@pytest.mark.parametrize("adj,noun,number", [
    ("maritimus", "Aemilia", "sg"), ("hūmānus", "hasta", "sg"), ("plēnus", "porta", "sg"),
    ("longus", "pecūnia", "sg"), ("Latīnus", "timor", "sg"), ("varius", "lac", "sg"),
    ("difficilis", "campus", "sg"), ("incertus", "tunica", "sg"), ("mīlitāris", "marītus", "sg"),
    ("vacuus", "ōstium", "sg"), ("togātus", "ancilla", "sg"), ("pullus", "canis", "sg"),
    ("contrārius", "mīles", "sg"), ("Graecus", "lacrima", "sg"), ("Rōmānus", "lacrima", "sg"),
])
def test_an_adjective_no_longer_describes_what_the_review_rejected(lex, adj, noun, number):
    a = word(lex, adj, "ADJ")
    n = lex.word(noun, "N") or lex.word(noun, "NAME")
    assert not g.adj_admits(a, n, number)


@pytest.mark.parametrize("adj,noun,number", [
    ("longus", "via", "sg"), ("Latīnus", "lingua", "sg"), ("plēnus", "saccus", "sg"),
    ("Graecus", "nāvis", "sg"), ("Rōmānus", "nummus", "sg"), ("Graecus", "servus", "sg"),
    ("magnus", "saccus", "sg"), ("improbus", "servus", "sg"), ("omnis", "discipulus", "pl"),
])
def test_an_adjective_still_describes_what_it_should(lex, adj, noun, number):
    assert g.adj_admits(word(lex, adj, "ADJ"), word(lex, noun), number)


@pytest.mark.parametrize("lemma", ["prīmus", "secundus", "sōlus", "suus", "meus", "multus", "aliēnus"])
def test_a_determiner_is_never_a_free_descriptor(lex, lemma):
    a = word(lex, lemma, "ADJ")
    assert a.sem.get("det") is True
    n = word(lex, "servus")
    number = a.sem.get("number") or "sg"
    assert a not in g.adj_candidates(lex, 34, n, {"agree": "x"}, number, "nom")
    assert a in g.adj_candidates(lex, 34, n, {"agree": "x", "only": [lemma]}, number, "nom")


@pytest.mark.parametrize("lemma", ["sum", "possum", "putō", "licet", "inquam", "absum", "spīrō"])
def test_a_complement_only_verb_is_never_a_plain_verb(lex, lemma):
    v = word(lex, lemma, "V")
    fill = g.Fill({"slots": {"s": {"sem": ["person"]}, "v": {"pos": "V", "form": "pres.ind", "subj": "s"}},
                   "la": "{s:nom} {v:pres.ind}.", "en": "", "id": "x", "focus": "v"})
    fill.words["s"], fill.numbers["s"] = word(lex, "puer"), "sg"
    assert not g.verb_admits(v, fill.t["slots"]["v"], fill)


def test_deus_and_mamma_are_not_household_actors(lex):
    assert word(lex, "deus").sem == "other"
    assert word(lex, "mamma").sem == "other"
    assert word(lex, "piscis").sem == "food"


# ------------------------------------------------------------ number, forms, checks

@pytest.mark.parametrize("lemma", ["āēr", "pecūnia", "lac", "lūna", "fīlia", "lignum", "pābulum"])
def test_a_noun_the_book_never_pluralises_stays_singular(lex, lemma):
    assert g._singular_only(word(lex, lemma))


@pytest.mark.parametrize("lemma,form,parse,fragment", [
    ("edō", "edāre", {"mood": "inf", "tense": "pres", "voice": "act"}, "infinitive"),
    ("legō", "legat", {"tense": "pres", "mood": "ind", "voice": "act", "person": 3, "number": "sg"}, "3rd-conjugation"),
    ("vocō", "vocit", {"tense": "pres", "mood": "ind", "voice": "act", "person": 3, "number": "sg"}, "1st-conjugation"),
    ("vocō", "vocavit", {"tense": "perf", "mood": "ind", "voice": "act", "person": 3, "number": "sg"}, "perfect"),
])
def test_a_form_that_contradicts_the_dictionary_line_is_refused(lex, lemma, form, parse, fragment):
    bad = g.form_matches_parts(word(lex, lemma, "V"), form, parse)
    assert bad and fragment in bad


@pytest.mark.parametrize("lemma,form,parse", [
    ("vocō", "vocat", {"tense": "pres", "mood": "ind", "voice": "act", "person": 3, "number": "sg"}),
    ("vocō", "vocāvit", {"tense": "perf", "mood": "ind", "voice": "act", "person": 3, "number": "sg"}),
    ("dormiō", "dormiente", {"mood": "ptc", "tense": "pres", "case": "abl", "number": "sg"}),
    ("eō", "iit", {"tense": "perf", "mood": "ind", "voice": "act", "person": 3, "number": "sg"}),
    ("exeō", "exeunt", {"tense": "pres", "mood": "ind", "voice": "act", "person": 3, "number": "pl"}),
])
def test_a_sound_form_passes_the_dictionary_line(lex, lemma, form, parse):
    assert g.form_matches_parts(word(lex, lemma, "V"), form, parse) is None


# ------------------------------------------------------------ English and gloss

@pytest.mark.parametrize("base,shape,number,expected", [
    ("have", "3sg", "sg", "has"), ("be silent", "3sg", "sg", "is silent"), ("go away", "3sg", "sg", "goes away"),
    ("give", "past", "sg", "gave"), ("run", "ing", "sg", "running"), ("be", "3sg", "pl", "are"),
])
def test_english_verb_forms(base, shape, number, expected):
    assert g.en_verb(base, shape, number) == expected


@pytest.mark.parametrize("base,expected", [
    ("helmsman", "helmsmen"), ("goods", "goods"), ("denarius", "denarii"), ("clothes", "clothes"),
    ("slave girl", "slave girls"), ("mummy", "mummies"), ("papyrus", "papyri"),
])
def test_english_plurals(base, expected):
    assert g.en_plural(base) == expected


# ------------------------------------------------------------ the generator end to end

PILOT = ["accusative-object", "ablative-means", "ablative-agent", "dative-indirect-object",
         "accusative-infinitive", "ablative-absolute", "perfect-active", "purpose-clause"]


@pytest.fixture(scope="module")
def batches(lex):
    return {skill: g.generate(skill, 40, 1, lex) for skill in PILOT}


def test_every_template_file_validates():
    assert g.check_all() == []


@pytest.mark.parametrize("skill", PILOT)
def test_forty_sentences_per_skill_and_nothing_rejected_reaches_the_page(batches, skill):
    res = batches[skill]
    assert len(res["sentences"]) == 40
    shipped = {s["la"] for s in res["sentences"]}
    assert not any(r["la"] in shipped for r in res["rejected_by_check"])


@pytest.mark.parametrize("skill", PILOT)
def test_shipped_sentences_hold_the_learner_facing_invariants(batches, lex, skill):
    for s in batches[skill]["sentences"]:
        n = len(s["la"].split())
        assert 5 <= n <= 8, s["la"]
        assert s["words"] == n
        assert "{" not in s["en"] and "}" not in s["en"], s["en"]
        assert not re.search(r"\b(\w+) \1\b", s["en"].lower()), s["en"]           # "his his"
        assert len(s["gloss"]) == n and all(x["m"] not in ("", "?") for x in s["gloss"]), s["gloss"]
        toks = [x["w"] for x in s["gloss"]]
        for prev, cur in zip(s["gloss"], s["gloss"][1:]):
            if prev["w"].lower() in g.PREPOSITIONS:
                assert not cur["m"].startswith(("by ", "to ", "of ")), (s["la"], cur)   # bare after a preposition
        assert s["focus"].split()[0].lower() in [t.strip(".,;:!?").lower() for t in toks], (s["la"], s["focus"])
        assert s["generated"] is True and s["template"] and s["seed"] == 1
        for lemma in s["fill"].values():
            w = lex.word(lemma, "N") or lex.word(lemma, "V") or lex.word(lemma, "ADJ") or lex.word(lemma, "ADV") \
                or lex.word(lemma, "PRON") or lex.word(lemma, "NAME")
            assert w is not None and w.unreliable_scope != "all", lemma


@pytest.mark.parametrize("skill", PILOT)
def test_generation_is_deterministic_for_a_seed(batches, lex, skill):
    again = g.generate(skill, 40, 1, lex)
    assert [s["la"] for s in again["sentences"]] == [s["la"] for s in batches[skill]["sentences"]]
    other = g.generate(skill, 40, 2, lex)
    assert [s["la"] for s in other["sentences"]] != [s["la"] for s in batches[skill]["sentences"]]


@pytest.mark.parametrize("skill", PILOT)
def test_every_shipped_word_is_inside_the_cumulative_vocabulary(batches, lex, skill):
    chapter = batches[skill]["chapter"]
    forms = lex.forms_at(chapter)
    names = {g.key_of(f) for w in lex.names(chapter) for f in w.index}
    for s in batches[skill]["sentences"]:
        for x in s["gloss"]:
            k = g.key_of(x["w"])
            assert k in forms or k in names or x["w"] in g.FUNCTION_WORDS or x["w"].lower() in g.FUNCTION_WORDS, (s["la"], x["w"])


# ------------------------------------------------------------ the independent subjunctive

SUBJ = ["subjunctive-wish-command", "wishes-utinam", "potential-subjunctive", "deliberative-subjunctive",
        "conditions-contrary-to-fact", "dummodo"]


@pytest.mark.parametrize("lemma,tense,person,number,form", [
    ("vocō", "impf", 3, "sg", "vocāret"), ("habeō", "plupf", 1, "sg", "habuissem"), ("emō", "pres", 1, "pl", "emāmus"),
    ("capiō", "perf", 3, "pl", "cēperint"), ("dormiō", "impf", 2, "sg", "dormīrēs"),
    ("sum", "impf", 1, "sg", "essem"), ("sum", "plupf", 2, "pl", "fuissētis"), ("possum", "pres", 1, "sg", "possim"),
    ("eō", "pres", 1, "pl", "eāmus"), ("eō", "impf", 3, "sg", "īret"), ("volō", "pres", 1, "sg", "velim"),
    ("nōlō", "impf", 3, "sg", "nōllet"), ("adsum", "plupf", 3, "sg", "adfuisset"),
])
def test_every_subjunctive_tense_inflects_through_the_engine(lex, lemma, tense, person, number, form):
    w = word(lex, lemma, "V")
    parse = {"tense": tense, "mood": "subj", "voice": "act", "person": person, "number": number}
    assert g.inflect(w, parse) == form
    assert g.has_parse(w, form, parse)


def test_a_two_clause_template_fills_both_verbs_from_one_subject(lex):
    t = {"id": "x", "la": "Sī {s:nom} {v1:impf.subj}, {o:acc} {v2:impf.subj}.",
         "en": "If {s} {v1:past}, {s:pron} would {v2:base} {o}.",
         "slots": {"s": {"only": ["Mārcus"]},
                   "v1": {"pos": "V", "form": "impf.subj", "subj": "s", "lemmas": ["labōrō"], "g": "{pron} {past}"},
                   "o": {"only": ["pecūnia"]},
                   "v2": {"pos": "V", "form": "impf.subj", "subj": "s", "obj": "o", "lemmas": ["habeō"], "g": "{pron} would {base}"}},
         "focus": ["v1", "v2"]}
    g.validate_template(t)
    fill = g.fill_template(lex, 33, t, __import__("random").Random(1))
    assert fill is not None
    la = g.render_la(fill)
    assert la == "Sī Mārcus labōrāret, pecūniam habēret."
    assert g.render_en(fill) == "If Marcus worked, he would have money."
    gloss = {x["w"]: x["m"] for x in g.render_gloss(fill, la, lex)}
    assert gloss["labōrāret"] == "he worked" and gloss["habēret"] == "he would have"
    assert g.check_sentence(lex, 33, t, fill, la, [], g.render_en(fill), g.render_gloss(fill, la, lex)) == []


def test_a_verb_gloss_pattern_names_only_known_placeholders():
    t = {"id": "x", "la": "{s:nom} {v:pres.subj}.", "en": "Let {s} {v:base}.", "focus": "v",
         "slots": {"s": {"sem": ["person"]}, "v": {"pos": "V", "form": "pres.subj", "subj": "s", "g": "let {opron} {bogus}"}}}
    with pytest.raises(g.TemplateError):
        g.validate_template(t)


# ------------------------------------------------------------ subordinate clauses (six skills, 2026-09-11)

CLAUSES = ["indirect-command", "result-clause", "sequence-of-tenses", "cum-narrative", "cum-causal",
           "indirect-question"]
SUBJ_TENSES = {"indirect-command": {"pres"}, "result-clause": {"pres", "impf"}, "cum-narrative": {"impf", "plupf"},
               "cum-causal": {"pres", "impf"}, "indirect-question": {"pres", "impf"}}


@pytest.mark.parametrize("lemma,scope", [
    ("piscātor", "all"), ("frīgus", "all"), ("fāma", "all"),   # piscatorēs, frigoris, famae: the oblique root lost its macron
])
def test_the_gate_keeps_a_noun_whose_stem_loses_its_macron_off_the_page(lex, lemma, scope):
    assert word(lex, lemma).unreliable_scope == scope


@pytest.mark.parametrize("lemma", ["dēns", "pēs", "mōns", "coniūnx", "bōs", "adulēscēns", "nox", "servus"])
def test_a_final_syllable_that_shortens_is_latin_not_a_gap(lex, lemma):
    assert word(lex, lemma).unreliable_scope is None


def test_drops_inner_macron_reads_only_the_non_final_syllables():
    assert g._drops_inner_macron("piscātor", "piscator")
    assert g._drops_inner_macron("frīgus", "frigor")
    assert not g._drops_inner_macron("dēns", "dent")
    assert not g._drops_inner_macron("coniūnx", "coniug")
    assert not g._drops_inner_macron("puer", "puer")


@pytest.mark.parametrize("base,shape,expected", [
    ("not know", "3sg", "does not know"), ("not know", "past", "did not know"), ("not know", "base", "do not know"),
    ("be", "past", "was"),
])
def test_a_negated_base_puts_the_shape_on_do(base, shape, expected):
    assert g.en_verb(base, shape, "sg", 3) == expected


@pytest.mark.parametrize("base,tense,number,expected", [
    ("sleep", "impf", "sg", "was sleeping"), ("be", "impf", "pl", "were"), ("fear", "impf", "sg", "feared"),
    ("not know", "impf", "sg", "did not know"), ("be away", "impf", "sg", "was away"),
    ("come", "plupf", "sg", "had come"), ("come", "perf", "pl", "came"), ("send", "fut", "sg", "will send"),
    ("order", "pres", "sg", "orders"),
])
def test_the_tense_mod_renders_a_subjunctive_as_plain_english(base, tense, number, expected):
    assert g._en_tensed(base, tense, number, 3) == expected


def _verb_fill(lex, main_form, sub_form, seed=0):
    t = {"id": "x", "focus": "v", "en": "",
         "la": "{s:nom} {r:dat} {v1:%s} ut {v:%s}." % (main_form, sub_form),
         "slots": {"s": {"sem": ["person"]}, "r": {"sem": ["person"]},
                   "v1": {"pos": "V", "form": main_form, "subj": "s", "dat": "r", "takes": "ut", "lemmas": ["imperō"]},
                   "v": {"pos": "V", "form": sub_form, "seq": "v1", "subj": "r", "lemmas": ["veniō"]}}}
    return g.fill_template(lex, 28, t, __import__("random").Random(seed))


def test_a_seq_verb_follows_its_governor_s_tense(lex):
    fill = _verb_fill(lex, "pres.ind", "seq.subj")
    assert fill.parses["v"]["tense"] == "pres" and fill.parses["v"]["mood"] == "subj"
    fill = _verb_fill(lex, "perf.ind", "seq.subj")
    assert fill.parses["v"]["tense"] == "impf" and fill.forms["v"] == "venīret"
    fill = _verb_fill(lex, "fut.ind", "seq.subj")
    assert fill.parses["v"]["tense"] == "pres"


def test_tense_alternatives_are_drawn_and_the_subordinate_follows(lex):
    seen = set()
    for seed in range(12):
        fill = _verb_fill(lex, "pres|perf.ind", "seq.subj", seed)
        main, sub = fill.parses["v1"]["tense"], fill.parses["v"]["tense"]
        assert (main, sub) in (("pres", "pres"), ("perf", "impf"))
        seen.add(main)
    assert seen == {"pres", "perf"}


def test_verb_parse_takes_the_first_alternative_when_nothing_has_drawn(lex):
    spec = {"pos": "V", "form": "impf|pres.ind", "subj": "s"}
    fill = g.Fill({"slots": {"s": {"sem": ["person"]}, "v": spec}, "la": "", "en": "", "id": "x", "focus": "v"})
    fill.numbers["s"] = "sg"
    assert g.verb_parse(spec, fill, word(lex, "vocō", "V"))["tense"] == "impf"


@pytest.mark.parametrize("slots", [
    {"v1": {"pos": "V", "form": "pres.ind", "subj": "s"}, "v": {"pos": "V", "form": "seq.subj", "subj": "s"}},           # seq form, no seq
    {"v1": {"pos": "V", "form": "pres.ind", "subj": "s"}, "v": {"pos": "V", "form": "pres.subj", "seq": "v1", "subj": "s"}},  # seq, no seq form
    {"v1": {"pos": "V", "form": "pres.ind", "subj": "s"}, "v": {"pos": "V", "form": "seq.subj", "seq": "s", "subj": "s"}},   # seq names a noun
])
def test_a_seq_verb_must_name_a_verb_slot_and_a_seq_form_together(slots):
    t = {"id": "x", "focus": "v", "en": "", "la": "{s:nom} {v1:pres.ind} ut {v:x}.",
         "slots": {"s": {"sem": ["person"]}, **slots}}
    with pytest.raises(g.TemplateError):
        g.validate_template(t)


def test_the_pronoun_for_a_thing_is_it(lex):
    t = {"id": "x", "la": "{o:acc} tibi dabō, dummodo {pron:acc} {v:pres.subj.act.2sg}.",
         "en": "I will give you {o:a}, provided you {v:base} {pron}.", "focus": "v",
         "slots": {"o": {"only": ["epistula"]}, "pron": {"pos": "PRON", "lemma": "is", "agree": "o"},
                   "v": {"pos": "V", "form": "pres.subj.act.2sg", "subj": "tū", "obj": "pron", "lemmas": ["legō"]}}}
    fill = g.fill_template(lex, 34, t, __import__("random").Random(1))
    assert fill is not None
    assert g.render_en(fill) == "I will give you a letter, provided you read it."


@pytest.fixture(scope="module")
def subj_batches(lex):
    return {skill: g.generate(skill, 40, 1, lex) for skill in SUBJ}


@pytest.mark.parametrize("skill", SUBJ)
def test_the_subjunctive_skills_ship_forty_reviewed_sentences(subj_batches, lex, skill):
    res = subj_batches[skill]
    assert len(res["sentences"]) == 40
    data = g.load_templates(skill)
    assert data["review"]["passes"] and data["review"]["final_rate"] <= 0.05
    chapter = res["chapter"]
    forms = lex.forms_at(chapter)
    names = {g.key_of(f) for w in lex.names(chapter) for f in w.index}
    for s in res["sentences"]:
        n = len(s["la"].split())
        assert 5 <= n <= 8 and s["words"] == n, s["la"]
        assert "{" not in s["en"] and len(s["gloss"]) == n and all(x["m"] not in ("", "?") for x in s["gloss"]), s
        assert not re.search(r"\b(\w+) \1\b", s["en"].lower()), s["en"]
        for x in s["gloss"]:
            k = g.key_of(x["w"])
            assert k in forms or k in names or x["w"] in g.FUNCTION_WORDS or x["w"].lower() in g.FUNCTION_WORDS, (s["la"], x["w"])
        # the focus is a subjunctive verb (or the fixed potential form the lesson teaches)
        assert s["focus"].split()[0].lower() in [t.strip(".,;:!?").lower() for t in s["la"].split()], s


def test_sum_is_drawn_only_into_a_slot_that_asks_for_a_predicate(lex):
    v = word(lex, "sum", "V")
    fill = g.Fill({"slots": {"s": {"sem": ["person"]}, "v": {"pos": "V", "form": "pres.ind", "subj": "s"}},
                   "la": "{s:nom} {v:pres.ind}.", "en": "", "id": "x", "focus": "v"})
    fill.words["s"], fill.numbers["s"] = word(lex, "puer"), "sg"
    assert not g.verb_admits(v, fill.t["slots"]["v"], fill)
    assert g.verb_admits(v, {"pos": "V", "form": "pres.ind", "subj": "s", "takes": "pred"}, fill)


@pytest.fixture(scope="module")
def clause_batches(lex):
    return {skill: g.generate(skill, 40, 1, lex) for skill in CLAUSES}


def _focus_parses(lex, res, s):
    t = next(t for t in g.load_templates(res["skill"])["templates"] if t["id"] == s["template"])
    f = t["focus"] if isinstance(t["focus"], str) else t["focus"][0]
    v = lex.word(s["fill"][f], "V")
    return v, v.index.get(s["focus"], []), t


@pytest.mark.parametrize("skill", CLAUSES)
def test_forty_clause_sentences_with_the_learner_facing_invariants(clause_batches, lex, skill):
    res = clause_batches[skill]
    assert len(res["sentences"]) == 40, res["unfillable"]
    assert not any(r["la"] in {s["la"] for s in res["sentences"]} for r in res["rejected_by_check"])
    for s in res["sentences"]:
        n = len(s["la"].split())
        assert 5 <= n <= 8 and s["words"] == n, s["la"]
        assert "{" not in s["en"] and not re.search(r"\b(\w+) \1\b", s["en"].lower()), s["en"]
        assert len(s["gloss"]) == n and all(x["m"] not in ("", "?") for x in s["gloss"]), s["gloss"]
        assert not any(x["m"].startswith("may ") and x["w"] in ("Cum", "cum") for x in s["gloss"])
        v, parses, _ = _focus_parses(lex, res, s)
        assert parses and all(p.get("mood") == "subj" for p in parses), (s["la"], s["focus"])
        if skill in SUBJ_TENSES:
            assert {p.get("tense") for p in parses} <= SUBJ_TENSES[skill], (s["la"], s["focus"])


def test_sequence_of_tenses_pairs_every_subordinate_with_its_main_verb(clause_batches, lex):
    res = clause_batches["sequence-of-tenses"]
    seen = set()
    for s in res["sentences"]:
        v, parses, t = _focus_parses(lex, res, s)
        f = t["focus"]
        main_name = t["slots"][f]["seq"]
        main = lex.word(s["fill"][main_name], "V")
        tokens = [x.strip(".,") for x in s["la"].split()]
        main_forms = [tok for tok in tokens if tok in main.index or tok[:1].lower() + tok[1:] in main.index]
        assert main_forms, s["la"]
        mf = main_forms[0] if main_forms[0] in main.index else main_forms[0][:1].lower() + main_forms[0][1:]
        main_tenses = {p.get("tense") for p in main.index[mf] if p.get("mood") == "ind"}
        sub_tenses = {p.get("tense") for p in parses}
        assert main_tenses, s["la"]
        primary = bool(main_tenses & g.PRIMARY_TENSES)
        assert sub_tenses == ({"pres"} if primary else {"impf"}), (s["la"], main_tenses, sub_tenses)
        seen.add(primary)
    assert seen == {True, False}          # both halves of the rule are practised


@pytest.mark.parametrize("skill", CLAUSES)
def test_clause_generation_is_deterministic_and_inside_the_vocabulary(clause_batches, lex, skill):
    res = clause_batches[skill]
    again = g.generate(skill, 40, 1, lex)
    assert [s["la"] for s in again["sentences"]] == [s["la"] for s in res["sentences"]]
    forms = lex.forms_at(res["chapter"])
    names = {g.key_of(f) for w in lex.names(res["chapter"]) for f in w.index}
    for s in res["sentences"]:
        for x in s["gloss"]:
            k = g.key_of(x["w"])
            assert k in forms or k in names or x["w"] in g.FUNCTION_WORDS or x["w"].lower() in g.FUNCTION_WORDS, (s["la"], x["w"])


def test_every_clause_file_carries_its_review_record():
    for skill in CLAUSES:
        data = g.load_json(g.TEMPLATES_DIR / f"{skill}.json")
        review = data["review"]
        assert review["passes"] and review["final_rate"] is not None and review["final_rate"] <= 0.05, skill
        for p in review["passes"]:
            assert {"pass", "seed", "generated", "rejected", "rate", "causes"} <= set(p), skill


def test_a_count_is_exact_for_a_small_template_and_estimated_for_a_large_one(lex):
    data = g.load_templates("dative-indirect-object")
    small = g.count_template(lex, data["chapter"], data["templates"][0], data["exclude"], cap=10**9)
    assert small["exact"] and small["count"] > 100
    large = g.count_template(lex, data["chapter"], data["templates"][0], data["exclude"], cap=10, sample=50)
    assert not large["exact"] and large["count"] > 0
