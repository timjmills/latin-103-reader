# -*- coding: utf-8 -*-
"""Validate the teaching sentences and the Learn micro-steps for one or more skills.

    set PYTHONIOENCODING=utf-8
    python pipeline/validate_teaching.py nominative-subject noun-gender ...
    python pipeline/validate_teaching.py --all

Checks, per skill (contract docs/GRAMMAR-CONTRACT.md "Teaching rebuild", sections 1-2):

  JSON            both files parse; the sentence file names its skill and chapter.
  VOCAB           every printed word resolves to a lemma in a vocabulary deck at or
                  before the skill's chapter, or to a proper name of the book's cast
                  (the decks hold no proper names at all), or is the construction's
                  own function word. Resolution uses app/data/glossary.json first and
                  a regular-paradigm generator built from app/js/paradigms.js second,
                  because the glossary only holds forms attested in the course texts.
  WORDS           5-8 printed words, or a `note` giving the reason.
  FOCUS           `focus` occurs verbatim in `la`, and the focus word carries a parse
                  matching the skill's parse_filter.
  IDS             sentence ids unique; `kinds` inside the skill's own kinds; the gloss
                  has one entry per printed word, in order.
  TEACH           4-6 steps, numbered from 1; every step has one `show` and one
                  `check`; every sentence id a step names exists in the sentence file;
                  step 1 words the term exactly as the skill's `plain` string.
  PARADIGM        every paradigm key is in skills.json's paradigm_keys map and in the
                  skill's own `paradigms` list; every cell key names a real cell of
                  that table and stays inside the skill's `paradigm_focus`.
"""
import json, os, re, sys, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(ROOT, "app", "data", "grammar")

# pipeline/latin_forms.py is the cell-for-cell port of app/js/paradigms.js, so it
# reaches every cell the crude tables below do not: the whole subjunctive, the
# perfect stem, the passive, the participles. Used as the second pass in
# deck_forms and parse_matches; if it will not import, the crude tables stand
# alone and the checker only gets stricter, never looser.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import latin_forms as LATIN_FORMS
except Exception:                                        # pragma: no cover
    LATIN_FORMS = None

# --------------------------------------------------------------------------- text

PUNCT = ".,;:?!'‘’“”\"()"


def strip_macrons(s):
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


def printed_words(la):
    return [w.strip(PUNCT) for w in la.split() if w.strip(PUNCT)]


# ------------------------------------------------------------------ proper names
#
# Ørberg's cast and the places cap. I-III names. The vocabulary decks contain no
# proper names at all (evidence, contract 7.2), so contract 1 admits them by rule.

NAMES = {
    # household
    "iulius", "iulia", "aemilia", "marcus", "quintus", "syra", "davus", "medus",
    "lydia", "delia", "syrus", "cornelius", "iulii", "aemilius", "sextus",
    # places of cap. I
    "roma", "italia", "graecia", "europa", "africa", "asia", "aegyptus",
    "hispania", "gallia", "germania", "britannia", "arabia", "syria",
    "sicilia", "sardinia", "corsica", "creta", "rhodus", "nilus", "rhenus",
    "danuvius", "tiberis", "brundisium", "tusculum",
}

# The construction's own function words, by skill.
FUNCTION_WORDS = {
    "enclitics": {"que", "ne", "ve"},
}

# Second spellings of a deck lemma that the generators below never reach. The
# decks list `ab` and `ex`; before a consonant Latin prints ā and ē (ā Mārcō,
# ā Syrā, ē vīllā), and glossary.json files that pair under the separate
# headword `a` / `e` ("ā / ab", "ē / ex"). Same chapter-5 word, not an exception.
LEMMA_SPELLINGS = {"ab": ["ā"], "ex": ["ē"]}

ENCLITICS = ("que", "ne", "ve")

# --------------------------------------------------------- regular form generator
#
# Mirrors app/js/paradigms.js (NOUN_ENDINGS, ADJ_12, CONJ) closely enough to decide
# whether a printed form belongs to a deck lemma. Macron-blind: everything is
# compared with macrons stripped, so a wrong macron is caught by eye, not here.

NOUN_ENDINGS = {
    "1":  {"sg": ["a", "ae", "ae", "am", "a", "a"], "pl": ["ae", "arum", "is", "as", "is", "ae"]},
    "2m": {"sg": ["us", "i", "o", "um", "o", "e"], "pl": ["i", "orum", "is", "os", "is", "i"]},
    "2n": {"sg": ["um", "i", "o", "um", "o", "um"], "pl": ["a", "orum", "is", "a", "is", "a"]},
    "2r": {"sg": ["", "i", "o", "um", "o", ""], "pl": ["i", "orum", "is", "os", "is", "i"]},
    "3":  {"sg": ["", "is", "i", "em", "e", ""], "pl": ["es", "um", "ibus", "es", "ibus", "es"]},
    "3n": {"sg": ["", "is", "i", "", "e", ""], "pl": ["a", "um", "ibus", "a", "ibus", "a"]},
    "4":  {"sg": ["us", "us", "ui", "um", "u", "us"], "pl": ["us", "uum", "ibus", "us", "ibus", "us"]},
    "5":  {"sg": ["es", "ei", "ei", "em", "e", "es"], "pl": ["es", "erum", "ebus", "es", "ebus", "es"]},
}
ADJ_12 = {
    "sg": [["us", "a", "um"], ["i", "ae", "i"], ["o", "ae", "o"], ["um", "am", "um"],
           ["o", "a", "o"], ["e", "a", "um"]],
    "pl": [["i", "ae", "a"], ["orum", "arum", "orum"], ["is", "is", "is"],
           ["os", "as", "a"], ["is", "is", "is"], ["i", "ae", "a"]],
}
CONJ_PRES_ACT = {
    "1": ["o", "as", "at", "amus", "atis", "ant"],
    "2": ["eo", "es", "et", "emus", "etis", "ent"],
    "3": ["o", "is", "it", "imus", "itis", "unt"],
    "3io": ["io", "is", "it", "imus", "itis", "iunt"],
    "4": ["io", "is", "it", "imus", "itis", "iunt"],
}
CONJ_INF = {"1": "are", "2": "ere", "3": "ere", "3io": "ere", "4": "ire"}
SUM_PRES_ACT = ["sum", "es", "est", "sumus", "estis", "sunt"]
EO_PRES_ACT = ["eo", "is", "it", "imus", "itis", "eunt"]


def noun_forms(word):
    """Every regular form of a deck noun, from its `dict` string."""
    dct = strip_macrons(word.get("dict") or word["lemma"])
    lemma = strip_macrons(word["lemma"])
    parts = [p.strip() for p in dct.split(",")]
    nom = parts[0].split()[0] if parts else lemma
    gen = parts[1].split()[0] if len(parts) > 1 else ""
    decl = word.get("decl")
    gender = word.get("gender")
    if gen.startswith("-"):
        gen = None
    out = set()
    if nom.endswith("a") and (decl == 1 or gen in (None, nom[:-1] + "ae")):
        key, stem = "1", nom[:-1]
    elif nom.endswith("um"):
        key, stem = "2n", nom[:-2]
    elif nom.endswith("ius") or nom.endswith("us"):
        if decl == 4:
            key, stem = "4", nom[:-2]
        else:
            key, stem = "2m", nom[:-2]
    elif nom.endswith("er") or nom.endswith("ir") or nom.endswith("r"):
        key = "2r"
        stem = gen[:-1] if gen and gen.endswith("i") else nom
        out.add(nom)
    elif nom.endswith("i") and decl == 2:                 # liberi, plural only
        key, stem = "2m", nom[:-1]
    elif gen and gen.endswith("is"):
        key = "3n" if gender == "n" else "3"
        stem = gen[:-2]
        out.add(nom)
    else:
        out.add(nom)
        return out
    tbl = NOUN_ENDINGS[key]
    for num in ("sg", "pl"):
        for end in tbl[num]:
            out.add(stem + end)
    out.add(nom)
    return out


def adj_forms(word):
    lemma = strip_macrons(word["lemma"])
    stem = lemma[:-2] if lemma.endswith("us") else (lemma[:-1] if lemma.endswith("a") else lemma)
    out = {lemma}
    for num in ("sg", "pl"):
        for row in ADJ_12[num]:
            for end in row:
                out.add(stem + end)
    return out


def verb_forms(word):
    parts = [p.strip() for p in strip_macrons(word.get("parts") or word["dict"]).split(",")]
    lemma = strip_macrons(word["lemma"])
    out = {lemma}
    if lemma == "sum":
        return out | set(SUM_PRES_ACT)
    if lemma in ("eo", "abeo", "adeo", "exeo"):
        return out | set(EO_PRES_ACT)
    inf = parts[1] if len(parts) > 1 else ""
    if inf.endswith("are"):
        key, stem = "1", inf[:-3]
    elif inf.endswith("ire"):
        key, stem = "4", inf[:-3]
    elif inf.endswith("ere"):
        key = "3io" if parts[0].endswith("io") else ("2" if parts[0].endswith("eo") else "3")
        stem = inf[:-3]
        if key == "2":
            stem = inf[:-3]
    else:
        return out
    for end in CONJ_PRES_ACT[key]:
        out.add(stem + end)
    out.add(stem + CONJ_INF[key])
    return out


_BY_H = {}
_GEN_CACHE = {}


def glossary_by_headword(glossary):
    """headword key -> the distinct glossary entries that carry it."""
    if _BY_H:
        return _BY_H
    for entries in glossary.values():
        for e in entries:
            h = e.get("h")
            if not h:
                continue
            slot = _BY_H.setdefault(h, [])
            sig = (e.get("pos"), tuple(e.get("roots") or ()), e.get("kind"))
            if sig not in {(x.get("pos"), tuple(x.get("roots") or ()), x.get("kind"))
                           for x in slot}:
                slot.append(e)
    return _BY_H


def generated_forms(lemma, glossary):
    """[(macron-stripped form, parse)] for one deck lemma, from latin_forms."""
    if LATIN_FORMS is None:
        return []
    h = strip_macrons(lemma)
    if h in _GEN_CACHE:
        return _GEN_CACHE[h]
    out = []
    for entry in glossary_by_headword(glossary).get(h, ()):
        try:
            out += [(strip_macrons(f), p) for f, p in LATIN_FORMS.forms(entry)]
        except Exception:
            pass
    _GEN_CACHE[h] = out
    return out


def deck_forms(words, glossary=None):
    """form -> {deck lemma}, and (as a second return) form -> [parse].

    The tables above are a rough first pass; latin_forms supplies every cell they
    miss, which is most of the verb.
    """
    out, parses = {}, {}
    for w in words:
        pos = w.get("pos")
        try:
            if pos == "N":
                fs = noun_forms(w)
            elif pos == "ADJ":
                fs = adj_forms(w)
            elif pos == "V":
                fs = verb_forms(w)
            else:
                fs = {strip_macrons(w["lemma"])}
        except Exception:
            fs = {strip_macrons(w["lemma"])}
        if glossary is not None:
            h = strip_macrons(w["lemma"])
            for f, p in generated_forms(w["lemma"], glossary):
                fs.add(f)
                parses.setdefault(f, []).append((h, p))
        for alt in LEMMA_SPELLINGS.get(strip_macrons(w["lemma"]), ()):
            fs.add(strip_macrons(alt))
        for f in fs:
            out.setdefault(f, set()).add(w["lemma"])
    return out, parses


# ------------------------------------------------------------------- paradigm cells

CASES = ["nom", "gen", "dat", "acc", "abl", "voc"]
NUMBERS = ["sg", "pl"]
GENDERS = ["m", "f", "n"]
TENSES = ["pres", "impf", "fut", "perf", "plupf", "futperf"]
MOODS = ["ind", "subj"]
VOICES = ["act", "pass"]

NOUN_KEY = {"decl1": "1", "decl2m": "2m", "decl2n": "2n", "decl2r": "2r",
            "decl3": "3", "decl3n": "3n", "decl4": "4", "decl5": "5"}
VERB_KEY = {"conj1": "1", "conj2": "2", "conj3": "3", "conj3io": "3io", "conj4": "4"}


_CATALOGUE = {}


def catalogue_cells():
    """table id -> {cell id: the parse the id spells out}, from paradigms.json.

    The catalogue is the contract's authority on cell ids (§4a), and
    pipeline/test_build_paradigm_catalogue.py proves its ids are the ones
    app/js/paradigms.js computes. The hand-written model that stood here
    disagreed with it in both directions — it let `perf.subj.act.1sg` through
    (the real id puts person and number in separate slots, `perf.subj.act.1.sg`)
    and it rejected `dat.sg` on the pronoun tables and `gerundive` on a
    conjugation, both of which are real cells — so read the catalogue.

    A cell's parse comes from `id_scheme.slot_of`, which maps each written value
    to the slot it fills, so an id parses back without knowing the order.
    """
    if _CATALOGUE:
        return _CATALOGUE
    doc = load(os.path.join(G, "paradigms.json"))
    slot_of = doc["id_scheme"]["slot_of"]
    for part in doc["parts"]:
        for table in part["tables"]:
            cells = {}
            for group in table["groups"]:
                for cid in group["cells"]:
                    parse = {}
                    for bit in cid.split("."):
                        slot = slot_of.get(bit)
                        if slot:
                            parse[slot] = bit
                    cells[cid] = parse
            _CATALOGUE[table["id"]] = cells
    return _CATALOGUE


_KEY_TABLES = {}


def key_tables(pkey):
    """The tables a skills.json paradigm key names, and the group inside them.

    `keys` in paradigms.json is that map. Most keys are one table of the same
    name, but `adjcomp` is the `comp` *group* inside six adjective tables
    (contract 4a: no glossary entry renders ADJ_COMP as a table of its own), so
    `comp.nom.sg.m` is a real cell of it and lives in adj12, adj3 and the rest.
    """
    if not _KEY_TABLES:
        doc = load(os.path.join(G, "paradigms.json"))
        _KEY_TABLES.update(doc.get("keys") or {})
    return _KEY_TABLES.get(pkey) or {"tables": [pkey]}


def cell_ok(pkey, cell):
    """Return (ok, parse-dict) for a dotted cell key against the named table."""
    catalogue = catalogue_cells()
    spec = key_tables(pkey)
    group = spec.get("group")
    if group and not cell.startswith(group + "."):
        return False, None
    for tid in spec.get("tables") or []:
        cells = catalogue.get(tid)
        if cells and cell in cells:
            return True, dict(cells[cell])
    return False, None


# ---------------------------------------------------------------------- the checks

def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve(word, allowed_lemmas, forms, glossary, fw):
    """(kind, lemma, enclitic) for a printed word, or None when nothing admits it.

    kind is 'deck' (a vocabulary deck at or before the chapter), 'name' (a proper
    name of the book's cast, which no deck holds) or 'function' (the construction's
    own function word). `enclitic` is the tail that had to be peeled off, if any;
    a tail is only peeled for a skill that owns it.
    """
    bare = strip_macrons(word)

    def look(form, enc):
        # The glossary marks an enclitic itself (estne -> sum + 'ne'), so a whole
        # word can resolve and still be carrying a tail; a word that resolves with
        # no tail at all (quoque, neque) is a plain deck word, not an enclitic.
        entries = glossary.get(form, [])
        for want_enc in (None, "any"):
            for e in entries:
                if want_enc is None and e.get("enc"):
                    continue
                if want_enc == "any" and e.get("enc") and e["enc"] not in fw:
                    continue
                tail = enc or (e.get("enc") if want_enc == "any" else None)
                if e["h"] in allowed_lemmas:
                    return ("deck", e["h"], tail)
                if e["h"] in NAMES:
                    return ("name", e["h"], tail)
        if form in NAMES:
            return ("name", form, enc)
        if form in forms:
            return ("deck", sorted(forms[form])[0], enc)
        return None

    hit = look(bare, None)
    if hit:
        return hit
    for enc in ENCLITICS:
        if enc in fw and bare.endswith(enc) and len(bare) > len(enc) + 2:
            hit = look(bare[: -len(enc)], enc)
            if hit:
                return hit
    if bare in fw:
        return ("function", bare, None)
    return None


def filter_hit(parse, f, headword=None):
    """One parse against one parse_filter clause.

    A clause value may be a list (`"tense": ["pres", "impf"]`), which means "any
    of these"; skills.json uses that shape for every two-tense skill. `h` is not
    a field of the parse at all: it names the dictionary headwords the skill
    admits (potential-subjunctive takes volo, nolo, malo, possum, dico ...), so
    it is tested against the word's own headword.
    """
    if "h" in f:
        want = f["h"] if isinstance(f["h"], (list, tuple)) else [f["h"]]
        if headword is None or strip_macrons(headword) not in [strip_macrons(x) for x in want]:
            return False
    for k, v in f.items():
        if k in ("pos", "enc", "h"):
            continue
        got = parse.get(k)
        want = v if isinstance(v, (list, tuple)) else [v]
        if str(got) not in [str(x) for x in want]:
            return False
    return True


def parse_matches(word, skill, glossary, forms, gen_parses=None):
    """Does the printed word carry a parse matching the skill's parse_filter?"""
    pf = skill.get("parse_filter")
    if not pf:
        return True, "no filter"
    filters = pf if isinstance(pf, list) else [pf]
    bare = strip_macrons(word)
    entries = glossary.get(bare, [])
    encs = [e for e in ENCLITICS if bare.endswith(e) and len(bare) > len(e) + 2]
    if not entries and encs:
        entries = glossary.get(bare[: -len(encs[0])], [])
    # The glossary only holds forms the course texts actually print, so a written
    # sentence may use a perfectly regular form it has never seen; latin_forms
    # generated it, and its parses answer the filter just as well.
    generated = (gen_parses or {}).get(bare) or []
    if generated:
        for f in filters:
            if "enc" in f:
                continue
            for h, p in generated:
                if filter_hit(p, f, h):
                    return True, json.dumps(f, sort_keys=True)
    if not entries:
        # A generated parse can admit a form, but it must never condemn one: a
        # filter clause may name an entry-level field (decl, pos) that no parse
        # carries, and a form the glossary has never seen is checked by hand.
        return None, "form not in glossary (checked by hand)"
    for f in filters:
        if "enc" in f:
            if any(bare.endswith(f["enc"]) for _ in [0]):
                return True, "enclitic -" + f["enc"]
            continue
        for e in entries:
            if f.get("pos") and e.get("pos") != f["pos"]:
                continue
            for p in e.get("parses", []):
                if filter_hit(p, f, e.get("h")):
                    return True, json.dumps(f, sort_keys=True)
    return False, json.dumps(filters, sort_keys=True)


def check_skill(sid, skills, vocab_by_ch, glossary, problems):
    skill = skills[sid]
    ch = skill["chapter"]
    spath = os.path.join(G, "sentences", sid + ".json")
    lpath = os.path.join(G, "lessons", sid + ".json")
    say = lambda m: problems.append("%s: %s" % (sid, m))

    try:
        sfile = load(spath)
    except Exception as e:
        say("sentence file will not parse: %s" % e)
        return None
    try:
        lesson = load(lpath)
    except Exception as e:
        say("lesson file will not parse: %s" % e)
        return None

    if sfile.get("skill") != sid:
        say("sentence file names skill %r" % sfile.get("skill"))
    if sfile.get("chapter") != ch:
        say("sentence file chapter %r, skills.json says %r" % (sfile.get("chapter"), ch))

    words = []
    for c in range(1, ch + 1):
        words += vocab_by_ch[c]["words"]
    allowed_lemmas = {strip_macrons(w["lemma"]) for w in words}
    forms, gen_parses = deck_forms(words, glossary)
    fw = FUNCTION_WORDS.get(sid, set())

    sentences = sfile.get("sentences", [])
    ids = [s["id"] for s in sentences]
    if len(set(ids)) != len(ids):
        say("duplicate sentence ids: %s" % sorted({i for i in ids if ids.count(i) > 1}))
    if len(sentences) < 12:
        say("only %d sentences (twelve is the floor for a drillable skill)" % len(sentences))

    longest = 0
    exceptions = []
    for s in sentences:
        ws = printed_words(s["la"])
        longest = max(longest, len(ws))
        if s.get("words") != len(ws):
            say("%s: `words` is %r, the line prints %d" % (s["id"], s.get("words"), len(ws)))
        if not (5 <= len(ws) <= 8) and not s.get("note"):
            say("%s: %d words and no note giving the reason" % (s["id"], len(ws)))
        if s["focus"] not in s["la"]:
            say("%s: focus %r not in `la`" % (s["id"], s["focus"]))
        else:
            ok, why = parse_matches(s["focus"], skill, glossary, forms, gen_parses)
            if ok is False:
                say("%s: focus %r carries no parse matching %s" % (s["id"], s["focus"], why))
        allowed_kinds = set(skill.get("kinds") or [])
        extra = set(s.get("kinds") or []) - allowed_kinds
        if extra:
            say("%s: kinds %s outside the skill's own %s" % (s["id"], sorted(extra), sorted(allowed_kinds)))
        # A chart drill builds a whole table on the focus word's lemma, and the
        # catalogue's stock words come from the decks; a proper name has no deck
        # entry, so it must not claim `chart`.
        if "chart" in (s.get("kinds") or []):
            hit = resolve(s["focus"], allowed_lemmas, forms, glossary, fw)
            if hit is None or hit[0] != "deck":
                say("%s: kinds claim `chart`, but focus %r is not a deck word"
                    % (s["id"], s["focus"]))
        gl = [g["w"] for g in s.get("gloss", [])]
        if gl != ws:
            say("%s: gloss does not run word by word over `la`" % s["id"])
        for w in ws:
            hit = resolve(w, allowed_lemmas, forms, glossary, fw)
            if hit is None:
                say("%s: %r is outside the chapter-%d vocabulary" % (s["id"], w, ch))
                continue
            kind, lemma, enc = hit
            if kind != "deck" or enc:
                exceptions.append((s["id"], w, kind, lemma, enc))

    teach = lesson.get("teach")
    if not teach:
        say("no teach block")
        return None
    if not (4 <= len(teach) <= 6):
        say("%d teach steps (four to six)" % len(teach))
    if [t.get("n") for t in teach] != list(range(1, len(teach) + 1)):
        say("teach steps are not numbered 1..n")
    plain = skill.get("plain") or ""
    if plain and plain not in (teach[0].get("say") or ""):
        say("step 1 does not word the term as skills.json does: %r" % plain)
    known = set(ids)
    for t in teach:
        n = t.get("n")
        for field in ("title", "say", "check"):
            if not t.get(field):
                say("step %s has no %s" % (n, field))
        chk = t.get("check") or {}
        if chk.get("kind") not in (skill.get("kinds") or []):
            say("step %s check kind %r outside the skill's kinds" % (n, chk.get("kind")))
        for ref in (t.get("show") or {}, chk):
            if ref.get("kind") == "sentence" and ref.get("id") not in known:
                say("step %s names sentence %r, which does not exist" % (n, ref.get("id")))
            if ref.get("sentence") and ref["sentence"] not in known:
                say("step %s checks sentence %r, which does not exist" % (n, ref["sentence"]))
        for ref in (t.get("show") or {}, chk):
            pkey = ref.get("key")
            if not pkey:
                continue
            if pkey not in PARADIGM_KEYS:
                say("step %s uses paradigm key %r, absent from paradigm_keys" % (n, pkey))
                continue
            if pkey not in (skill.get("paradigms") or []):
                say("step %s uses paradigm %r, not one of the skill's own" % (n, pkey))
            for cell in (ref.get("reveal") or ref.get("cells") or []):
                ok, parse = cell_ok(pkey, cell)
                if not ok:
                    say("step %s: %r is not a cell of %s" % (n, cell, pkey))
                    continue
                focus = skill.get("paradigm_focus") or {}
                for k, v in focus.items():
                    if k not in parse:
                        continue
                    # a focus value may be a list ("tense": ["pres", "impf"]),
                    # which means any of them; comparing the list itself to the
                    # cell's own value condemned every legal cell of a two-tense
                    # skill (deliberative-subjunctive).
                    want = v if isinstance(v, (list, tuple)) else [v]
                    if str(parse[k]) not in [str(x) for x in want]:
                        say("step %s: cell %r of %s is outside paradigm_focus %s"
                            % (n, cell, pkey, json.dumps(focus, sort_keys=True)))
    return {"skill": sid, "sentences": len(sentences), "steps": len(teach),
            "longest": longest, "exceptions": exceptions}


PARADIGM_KEYS = {}


def main(argv):
    global PARADIGM_KEYS
    skills_doc = load(os.path.join(G, "skills.json"))
    PARADIGM_KEYS = skills_doc["paradigm_keys"]
    skills = {s["id"]: s for s in skills_doc["skills"]}
    glossary = load(os.path.join(ROOT, "app", "data", "glossary.json"))
    vocab_by_ch = {}
    for c in range(1, 35):
        vocab_by_ch[c] = load(os.path.join(G, "vocab", "%02d.json" % c))

    wanted = [a for a in argv if not a.startswith("-")]
    if "--all" in argv:
        wanted = sorted(x[:-5] for x in os.listdir(os.path.join(G, "sentences")) if x.endswith(".json"))

    problems = []
    rows = []
    for sid in wanted:
        if sid not in skills:
            problems.append("%s: no such skill in skills.json" % sid)
            continue
        r = check_skill(sid, skills, vocab_by_ch, glossary, problems)
        if r:
            rows.append(r)

    print("teaching-content validator - %d skill(s)" % len(rows))
    print("")
    print("  %-24s %9s %6s %8s %10s" % ("skill", "sentences", "steps", "longest", "exceptions"))
    for r in rows:
        print("  %-24s %9d %6d %8d %10d"
              % (r["skill"], r["sentences"], r["steps"], r["longest"], len(r["exceptions"])))
    print("")
    print("  Exceptions, with the rule that admits each one:")
    for r in rows:
        names = sorted({w for (_, w, k, _l, e) in r["exceptions"] if k == "name" and not e})
        encl = sorted({(w, e) for (_, w, _k, _l, e) in r["exceptions"] if e})
        funcs = sorted({l for (_, _w, k, l, _e) in r["exceptions"] if k == "function"})
        print("    %s:" % r["skill"])
        if names:
            print("      proper names of the book's cast (contract 1; the decks hold none): %s"
                  % ", ".join(names))
        if encl:
            print("      the construction's own function word: %s"
                  % ", ".join("-%s on %s" % (e, w) for (w, e) in encl))
        if funcs:
            print("      the construction's own function word, standing alone: %s"
                  % ", ".join("-" + f for f in funcs))
        if not (names or encl or funcs):
            print("      none - every printed word is in a deck at or before the chapter")
    print("")
    if problems:
        print("PROBLEMS (%d):" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    print("clean: JSON valid - every word inside the cumulative vocabulary, an allowed")
    print("proper name, or the construction's own function word - word counts 5-8 -")
    print("focus verbatim in `la` and parsing as the skill asks - ids unique - every")
    print("sentence a step names exists - every paradigm key and cell valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
