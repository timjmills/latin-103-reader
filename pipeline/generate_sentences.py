#!/usr/bin/env python
"""
generate_sentences.py — unlimited practice sentences for a construction skill
(docs/GRAMMAR-CONTRACT.md §11), filled from hand-written templates.

    python pipeline/generate_sentences.py dative-indirect-object            # 40 sentences, seed 1
    python pipeline/generate_sentences.py ablative-means --n 20 --seed 7
    python pipeline/generate_sentences.py --all --counts                    # productive count per template
    python pipeline/generate_sentences.py --all --n 40 --json out.json      # the review batch
    python pipeline/generate_sentences.py --check                           # validate every template file

Inputs
  app/data/grammar/templates/<skill>.json     the patterns, written by a Latinist
  app/data/grammar/vocab/NN.json              the decks, each word with `sem`
  app/data/glossary.json + latin_forms.py     every inflected form, the tables
                                              app/js/paradigms.js draws
  app/data/grammar/skills.json                the skill's chapter

How a sentence is made
  1. Noun slots are filled from the CUMULATIVE vocabulary at the skill's
     chapter by semantic class (`sem`), plus the book's cast for `person`
     slots (NAMES, each from the chapter it first appears in); a slot may
     narrow the pool with `only` / `not`.
  2. Adjective slots are filled by an adjective whose `sem.of` admits the
     class of the noun it agrees with; the form is that noun's case, number
     and gender, positive degree.
  3. Verb slots are filled by a verb whose `sem` admits the classes (or the
     exact words) of its subject, object and dative; the finite form takes
     its person and number from the subject slot(s); a deponent is drawn in
     its passive-shaped form; a participle agrees with its noun.
  4. Pronoun slots (is / quī) agree in gender and number with their
     antecedent slot and take the case the pattern names.
  5. English is rendered from the template's own `en` with the same slot
     names, and the word-by-word gloss from the decks (nouns) and EN_VERBS
     (verbs), so the sentence ships with its translation and gloss.
  6. Every filled sentence goes through `check_sentence` before it is
     returned: 5–8 printed words, no lemma twice, every printed word one of
     the engine's own forms for a word inside the cumulative vocabulary (or a
     cast name, or the construction's own function word), every slot form
     re-parsed and found to carry the intended parse, verb/argument classes
     compatible, and not on the skill's exclusion list.  A failed fill is
     redrawn; a template that cannot be filled is reported, never shipped.

Deterministic for a given (skill, seed); `count_template` enumerates the
distinct sentences a template can produce at its chapter.

Nothing here touches app/js, lessons/, sentences/, skills.json or the decks.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import random
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))

import latin_forms  # noqa: E402

GRAM = ROOT / "app" / "data" / "grammar"
GLOSSARY_PATH = ROOT / "app" / "data" / "glossary.json"
TEMPLATES_DIR = GRAM / "templates"
VOCAB_DIR = GRAM / "vocab"

MIN_WORDS, MAX_WORDS = 5, 8

SEM_CLASSES = {"person", "animal", "thing", "place", "time", "abstract", "body",
               "food", "group", "nature", "other"}

# The book's cast, admitted to `person` slots (contract §1 admits the cast by
# rule).  chapter = where the name first occurs in the library.
NAMES = [
    # lemma, gender, chapter, English
    ("Iūlius", "m", 2, "Julius"), ("Aemilia", "f", 2, "Aemilia"),
    ("Mārcus", "m", 2, "Marcus"), ("Quīntus", "m", 2, "Quintus"),
    ("Iūlia", "f", 2, "Julia"), ("Syra", "f", 2, "Syra"),
    ("Dāvus", "m", 2, "Davus"), ("Mēdus", "m", 2, "Medus"),
    ("Dēlia", "f", 2, "Delia"), ("Cornēlius", "m", 6, "Cornelius"),
    ("Lȳdia", "f", 6, "Lydia"), ("Ursus", "m", 6, "Ursus"),
    ("Albīnus", "m", 8, "Albinus"), ("Sextus", "m", 15, "Sextus"),
]

# A fixed word a pattern prints: its gloss, and (when it is not a deck word)
# why it is admitted.  Everything else fixed is looked up in the decks.
FIXED_GLOSS = {
    "nōn": "not", "et": "and", "sed": "but", "cūr": "why", "ut": "so that",
    "nē": "so that … not", "ā": "by", "ab": "by", "ad": "to", "in": "in",
    "cum": "with", "hodiē": "today", "iam": "already", "statim": "at once",
    "omnēs": "all", "nihil": "nothing", "mihi": "to me", "postquam": "after",
    "ego": "I", "nōs": "we", "vōs": "you", "dat": "gives", "dant": "give",
    "vehitur": "rides", "vehuntur": "ride", "umerīs": "on the shoulders",
    "dēlectātur": "is delighted", "dēlectantur": "are delighted",
    "pecūniam": "money", "quī": "who", "quae": "who", "nēmine": "nobody",
    "vidente": "seeing", "prīmus": "first", "prīma": "first", "eum": "him",
    "eam": "her", "ōstium": "the door", "verbīs": "with words", "sē": "himself",
    "tum": "then", "tandem": "at last", "celeriter": "quickly",
    "fortiter": "bravely", "bene": "well", "diū": "for a long time",
    "semper": "always", "cotīdiē": "every day", "herī": "yesterday",
    "subitō": "suddenly", "mox": "soon", "nunc": "now", "etiam": "also",
    "quoque": "also", "ad": "to",
}
# Construction words (contract §1) that belong to no deck at the chapter
# where the construction is taught, each with its reason.
FUNCTION_WORDS = {
    "ut": "construction word: purpose clause",
    "nē": "construction word: negative purpose",
    "ā": "the deck's ab in its pre-consonant spelling",
}

# English forms of the verbs a template may draw.  base → (past, past participle)
# is looked up in EN_IRREGULAR; everything else is regular.  A verb absent
# here cannot be rendered and is never drawn.
EN_VERBS = {
    "videō": "see", "veniō": "come", "audiō": "hear", "dormiō": "sleep",
    "respondeō": "answer", "pulsō": "hit", "interrogō": "question", "vocō": "call",
    "verberō": "beat", "rīdeō": "laugh", "plōrō": "cry", "cantō": "sing",
    "habeō": "have", "dō": "give", "salūtō": "greet", "discēdō": "go away",
    "sūmō": "take", "taceō": "be silent", "numerō": "count", "accūsō": "accuse",
    "amō": "love", "habitō": "live", "dēlectō": "delight", "ambulō": "walk",
    "eō": "go", "intrō": "enter", "portō": "carry", "timeō": "fear",
    "aperiō": "open", "teneō": "hold", "claudō": "shut", "exeō": "go out",
    "currō": "run", "exspectō": "wait for", "parō": "prepare", "adveniō": "arrive",
    "lacrimō": "weep", "aspiciō": "look at", "clāmō": "shout", "emō": "buy",
    "abeō": "go away", "accipiō": "receive", "ostendō": "show", "ōrnō": "adorn",
    "vēndō": "sell", "mōnstrō": "show", "relinquō": "leave", "dūcō": "lead",
    "bibō": "drink", "iaceō": "lie", "quaerō": "look for", "lūceō": "shine",
    "reperiō": "find", "edō": "eat", "errō": "wander", "accurrō": "run up",
    "lātrō": "bark", "bālō": "bleat", "ululō": "howl", "legō": "read",
    "vīvō": "live", "lūdō": "play", "capiō": "take", "moveō": "move",
    "canō": "sing", "cadō": "fall", "ascendō": "climb", "perterreō": "terrify",
    "natō": "swim", "spīrō": "breathe", "occultō": "hide", "spectō": "watch",
    "doleō": "be in pain", "sedeō": "sit", "stō": "stand", "gaudeō": "rejoice",
    "quiēscō": "rest", "aegrōtō": "be ill", "sānō": "heal", "arcessō": "send for",
    "fluō": "flow", "tangō": "touch", "reveniō": "come back", "ferō": "carry",
    "pugnō": "fight", "fugiō": "flee", "iaciō": "throw", "dēfendō": "defend",
    "armō": "arm", "oppugnō": "attack", "metuō": "fear", "expugnō": "storm",
    "equitō": "ride", "mīlitō": "serve as a soldier", "surgō": "get up",
    "lavō": "wash", "valeō": "be well", "excitō": "wake", "cubō": "lie down",
    "vigilō": "stay awake", "induō": "put on", "poscō": "demand", "recitō": "read aloud",
    "redeō": "go back", "reddō": "give back", "cōnsīdō": "sit down", "pūniō": "punish",
    "exclāmō": "exclaim", "gubernō": "steer", "proficīscor": "set out", "ōrō": "beg",
    "loquor": "speak", "nāvigō": "sail", "occidō": "kill", "laetor": "be glad",
    "sequor": "follow", "servō": "save", "cōnsōlor": "comfort", "orior": "rise",
    "intueor": "gaze at", "complector": "embrace", "cōnscendō": "board",
    "lābor": "slip", "ēgredior": "go out", "impleō": "fill", "laudō": "praise",
    "doceō": "teach", "cōgitō": "think", "reprehendō": "blame", "tollō": "lift",
    "dēmōnstrō": "point out", "scrībō": "write", "intellegō": "understand",
    "premō": "press", "dēleō": "erase", "corrigō": "correct", "mittō": "send",
    "possideō": "own", "ōsculor": "kiss", "tegō": "cover", "cūrō": "look after",
    "maneō": "stay", "pergō": "go on", "postulō": "demand", "alō": "feed",
    "vāgiō": "wail", "colloquor": "talk", "dīligō": "love", "sileō": "be silent",
    "praetereō": "pass by", "nārrō": "tell", "crēdō": "believe", "mūtō": "change",
    "cognōscō": "get to know", "mentior": "lie", "dubitō": "hesitate", "vincō": "defeat",
    "conspiciō": "catch sight of", "fallō": "deceive", "excūsō": "excuse",
    "solvō": "untie", "moneō": "warn", "terreō": "frighten", "accēdō": "approach",
    "prehendō": "seize", "pellō": "drive", "rumpō": "break", "cēdō": "withdraw",
    "scindō": "tear", "tremō": "tremble", "dērīdeō": "mock", "mordeō": "bite",
    "vinciō": "tie up", "admittō": "let in", "custodiō": "guard", "retineō": "hold back",
    "prōcēdō": "advance", "recēdō": "go back", "fremō": "roar", "inclūdō": "shut in",
    "prōmittō": "promise", "trādō": "hand over", "perdō": "lose", "dīmittō": "send away",
    "comitor": "accompany", "pareō": "obey", "amputō": "cut off", "mīror": "wonder at",
    "cupiō": "want", "frangō": "break", "fleō": "weep", "percutiō": "strike",
    "recumbō": "lie down", "necō": "kill", "dēserō": "abandon", "interficiō": "kill",
    "dēscendō": "go down", "maereō": "grieve", "regō": "rule", "trahō": "drag",
    "aedificō": "build", "polliceor": "promise", "vorō": "devour", "inveniō": "find",
    "iuvō": "help", "persequor": "pursue", "effugiō": "escape", "cōnsequor": "catch up with",
    "caveō": "beware of", "dēspiciō": "look down on", "imitor": "imitate",
    "perficiō": "finish", "cōnsūmō": "use up", "levō": "lift", "revocō": "call back",
    "suspiciō": "look up at", "ēvolō": "fly away", "ūrō": "burn", "labōrō": "work",
    "līberō": "free", "neglegō": "neglect", "vītō": "avoid", "arō": "plough",
    "metō": "reap", "rapiō": "snatch", "spargō": "scatter", "crēscō": "grow",
    "faveō": "favour", "noceō": "harm", "pāscō": "pasture", "rigō": "water",
    "pereō": "perish", "perveniō": "arrive", "adōrō": "worship", "persuādeō": "persuade",
    "rogō": "ask", "serviō": "serve", "precor": "pray to", "eiciō": "throw out",
    "morior": "die", "adiuvō": "help", "admīror": "admire", "oboediō": "obey",
    "apprehendō": "seize", "rēgnō": "reign", "cessō": "stop", "nāscor": "be born",
}
EN_IRREGULAR = {
    "be": ("was", "been"), "come": ("came", "come"), "see": ("saw", "seen"),
    "give": ("gave", "given"), "go": ("went", "gone"), "run": ("ran", "run"),
    "sleep": ("slept", "slept"), "read": ("read", "read"), "write": ("wrote", "written"),
    "take": ("took", "taken"), "hold": ("held", "held"), "sit": ("sat", "sat"),
    "stand": ("stood", "stood"), "lie": ("lay", "lain"), "eat": ("ate", "eaten"),
    "drink": ("drank", "drunk"), "fall": ("fell", "fallen"), "leave": ("left", "left"),
    "lead": ("led", "led"), "find": ("found", "found"), "sing": ("sang", "sung"),
    "fly": ("flew", "flown"), "swim": ("swam", "swum"), "rise": ("rose", "risen"),
    "fight": ("fought", "fought"), "flee": ("fled", "fled"), "throw": ("threw", "thrown"),
    "bring": ("brought", "brought"), "hear": ("heard", "heard"), "say": ("said", "said"),
    "speak": ("spoke", "spoken"), "think": ("thought", "thought"), "send": ("sent", "sent"),
    "keep": ("kept", "kept"), "put": ("put", "put"), "shut": ("shut", "shut"),
    "get": ("got", "got"), "buy": ("bought", "bought"), "sell": ("sold", "sold"),
    "catch": ("caught", "caught"), "wake": ("woke", "woken"), "grow": ("grew", "grown"),
    "ride": ("rode", "ridden"), "bite": ("bit", "bitten"), "break": ("broke", "broken"),
    "tear": ("tore", "torn"), "drive": ("drove", "driven"), "beat": ("beat", "beaten"),
    "hit": ("hit", "hit"), "feed": ("fed", "fed"), "weep": ("wept", "wept"),
    "know": ("knew", "known"), "understand": ("understood", "understood"),
    "tell": ("told", "told"), "win": ("won", "won"), "make": ("made", "made"),
    "do": ("did", "done"), "begin": ("began", "begun"), "build": ("built", "built"),
    "teach": ("taught", "taught"), "pay": ("paid", "paid"), "meet": ("met", "met"),
    "shine": ("shone", "shone"), "blow": ("blew", "blown"), "draw": ("drew", "drawn"),
    "wear": ("wore", "worn"), "lose": ("lost", "lost"), "choose": ("chose", "chosen"),
    "steal": ("stole", "stolen"), "hide": ("hid", "hidden"), "set": ("set", "set"),
    "cut": ("cut", "cut"), "shake": ("shook", "shaken"), "burn": ("burnt", "burnt"),
    "let": ("let", "let"), "spread": ("spread", "spread"), "feel": ("felt", "felt"),
    "seek": ("sought", "sought"), "light": ("lit", "lit"), "forget": ("forgot", "forgotten"),
    "become": ("became", "become"), "swing": ("swung", "swung"), "sink": ("sank", "sunk"),
    "strike": ("struck", "struck"), "dig": ("dug", "dug"), "have": ("had", "had"),
}
EN_PLURALS = {
    "man": "men", "woman": "women", "foot": "feet", "tooth": "teeth", "sheep": "sheep",
    "fish": "fish", "ox": "oxen", "wolf": "wolves", "leaf": "leaves", "knife": "knives",
    "wife": "wives", "child": "children", "mouse": "mice", "goose": "geese",
    "person": "people", "mummy": "mummies",
}
# nouns the English says without an article in the singular
EN_MASS = {"water", "money", "bread", "wine", "milk", "meat", "food", "grain", "gold",
           "silver", "iron", "wax", "paper", "wool", "salt", "snow", "ice", "rain",
           "honey", "blood", "grass", "juice", "fodder", "dinner", "cattle", "clothing",
           "hair", "help", "fear", "silence", "sleep", "praise", "shame", "pain",
           "glory", "delay", "hope", "joy", "sadness", "hunger", "thirst", "peace",
           "courage", "wealth", "darkness", "light", "heat", "cold", "air", "power",
           "freedom", "nature", "leisure", "patience", "envy", "pride", "anger",
           "riches", "arms", "goods", "nonsense", "rubble", "thunder", "lightning"}


def _plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def key_of(s: str) -> str:
    return _plain(s).lower().replace("v", "u").replace("j", "i")


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------- the lexicon

class Word:
    """A deck word (or a cast name) with its glossary entry and form index."""
    __slots__ = ("lemma", "pos", "gender", "sem", "meaning", "chapter", "entry",
                 "index", "is_name", "en", "plural_only", "deponent")

    def __init__(self, lemma, pos, gender, sem, meaning, chapter, entry, is_name=False, en=None):
        self.lemma, self.pos, self.gender = lemma, pos, gender
        self.sem, self.meaning, self.chapter = sem, meaning, chapter
        self.entry, self.is_name = entry, is_name
        self.index = latin_forms.form_index(entry) if entry else {}
        self.en = en
        self.deponent = bool(entry and entry.get("kind") == "dep")
        self.plural_only = pos == "N" and bool(self.index) and not any(
            p.get("case") == "nom" and p.get("number") == "sg" for ps in self.index.values() for p in ps)

    def __repr__(self):
        return f"Word({self.lemma})"

    @property
    def classes(self) -> set[str]:
        if self.is_name:
            return {"person"}
        return {self.sem} if isinstance(self.sem, str) else set()


class Lexicon:
    def __init__(self):
        self.glossary = load_json(GLOSSARY_PATH)
        self.words: list[Word] = []
        self.by_lemma: dict[tuple[str, str], Word] = {}
        for ch in range(1, 35):
            path = VOCAB_DIR / f"{ch:02d}.json"
            if not path.exists():
                continue
            for w in load_json(path)["words"]:
                entry = self._entry_for(w["lemma"], w["pos"])
                word = Word(w["lemma"], w["pos"], w.get("gender"), w.get("sem"),
                            w.get("meaning") or "", ch, entry)
                self.words.append(word)
                self.by_lemma[(key_of(w["lemma"]), w["pos"])] = word
        for lemma, gender, ch, en in NAMES:
            entry = self._entry_for(lemma, "N")
            if entry is None:
                raise SystemExit(f"cast name {lemma} has no glossary entry")
            word = Word(lemma, "N", gender, "person", en, ch, entry, is_name=True, en=en)
            self.words.append(word)
            self.by_lemma[(key_of(lemma), "NAME")] = word
        self._forms_at: dict[int, dict[str, set[str]]] = {}

    def _entry_for(self, lemma: str, pos: str):
        k = _plain(lemma).lower()
        pos_glossary = {"V": ("V", "VPAR")}.get(pos, (pos,))
        cands = []
        for e in self.glossary.get(k, []):
            if e.get("pos") not in pos_glossary:
                continue
            head = _plain(re.split(r"[ ,]", e["lemma"].strip())[0]).lower()
            if e.get("h") == k or head == k:
                cands.append(e)
        if cands:
            return cands[0]
        # filed elsewhere (castra under castrum): the deck word is one of the entry's forms
        for e in self.glossary.get(k, []):
            if e.get("pos") not in pos_glossary:
                continue
            try:
                if any(_plain(f).lower() == k for f, _ in latin_forms.forms(e)):
                    return e
            except Exception:
                continue
        return None

    def word(self, lemma: str, pos: str) -> Word | None:
        return self.by_lemma.get((key_of(lemma), pos))

    def pool(self, pos: str, chapter: int) -> list[Word]:
        return [w for w in self.words if w.pos == pos and w.chapter <= chapter and not w.is_name]

    def names(self, chapter: int) -> list[Word]:
        return [w for w in self.words if w.is_name and w.chapter <= chapter]

    def forms_at(self, chapter: int) -> dict[str, set[str]]:
        """normalised form → {printed spellings} for every word at or before `chapter`."""
        if chapter not in self._forms_at:
            out: dict[str, set[str]] = defaultdict(set)
            for w in self.words:
                if w.chapter > chapter:
                    continue
                for f in w.index:
                    for piece in f.split():
                        out[key_of(piece)].add(piece)
                if w.pos in ("ADV", "CONJ", "PREP", "INTERJ") or not w.index:
                    out[key_of(w.lemma)].add(w.lemma)
            self._forms_at[chapter] = out
        return self._forms_at[chapter]


# --------------------------------------------------------------- inflection

def _dō_fix(lemma: str, form: str) -> str:
    """dō is generated as a plain first conjugation (dāre, dābat, dātur); its a
    is short everywhere but dā, dās, dāns.  Repair the generated spelling."""
    if key_of(lemma) != "do" or form in ("dā", "dās", "dāns"):
        return form
    return form.replace("dā", "da", 1) if form.startswith("dā") else form


def inflect(word: Word, parse: dict) -> str | None:
    """The engine's form for `word` that carries every feature of `parse`;
    None when the table has no such cell.  Positive degree unless asked."""
    want = dict(parse)
    gender = want.pop("gender", None)
    hits = []
    for form, parses in word.index.items():
        if " " in form:
            continue
        for p in parses:
            if any(str(p.get(k)) != str(v) for k, v in want.items()):
                continue
            if "degree" not in want and p.get("degree"):
                continue
            if gender and p.get("gender") and p.get("gender") != gender and not (
                    p.get("gender") == "c" or gender == "c"):
                continue
            if word.pos == "N" and gender and not p.get("gender") and word.gender not in (gender, "c", None):
                continue
            hits.append(form)
    if not hits:
        return None
    # the present participle's ablative singular: -e when used as a verb
    if want.get("mood") == "ptc" and want.get("case") == "abl" and want.get("number") == "sg":
        e = [h for h in hits if h.endswith("e")]
        hits = e or hits
    # the glossary's alternative spellings (eī / iī): keep the first the table lists
    seen, uniq = set(), []
    for h in hits:
        if h not in seen:
            seen.add(h)
            uniq.append(h)
    return _dō_fix(word.lemma, uniq[0])


def has_parse(word: Word, form: str, parse: dict) -> bool:
    """Does the engine give `form` the parse `parse`?  (re-check after filling)"""
    forms = [form]
    if key_of(word.lemma) == "do":
        forms.append(form.replace("da", "dā", 1))
    for f in forms:
        for p in word.index.get(f, []):
            if all(str(p.get(k)) == str(v) for k, v in parse.items()
                   if k != "gender" or (p.get("gender") and p.get("gender") != "c" and v != "c")):
                if "degree" in parse or not p.get("degree"):
                    return True
    return False


# --------------------------------------------------------------- English

def en_verb(base: str, shape: str, number: str = "sg", person: int = 3) -> str:
    """English forms of a base phrase: the first word inflects."""
    head, _, rest = base.partition(" ")
    tail = (" " + rest) if rest else ""
    past, pp = EN_IRREGULAR.get(head, (None, None))
    if head == "be":
        forms = {"3sg": "is", "pl": "are", "1sg": "am", "past": "was" if number == "sg" and person != 2 else "were",
                 "pp": "been", "ing": "being", "base": "be"}
        return forms[shape] + tail
    if shape == "base":
        return base
    if shape == "3sg":
        if person != 3 or number == "pl":
            return base
        if re.search(r"(s|sh|ch|x|z|o)$", head):
            return head + "es" + tail
        if re.search(r"[^aeiou]y$", head):
            return head[:-1] + "ies" + tail
        return head + "s" + tail
    if shape == "past":
        if past:
            return past + tail
        if head.endswith("e"):
            return head + "d" + tail
        if re.search(r"[^aeiou]y$", head):
            return head[:-1] + "ied" + tail
        if re.search(r"[^aeiou][aeiou][^aeiouwxy]$", head) and len(head) <= 4:
            return head + head[-1] + "ed" + tail
        return head + "ed" + tail
    if shape == "pp":
        if pp:
            return pp + tail
        return en_verb(base, "past")
    if shape == "ing":
        if head.endswith("ie"):
            return head[:-2] + "ying" + tail
        if head.endswith("e") and head not in ("be", "see", "flee"):
            return head[:-1] + "ing" + tail
        if re.search(r"[^aeiou][aeiou][^aeiouwxy]$", head) and len(head) <= 4:
            return head + head[-1] + "ing" + tail
        return head + "ing" + tail
    raise ValueError(shape)


def en_noun(word: Word, number: str, art: str | None = None, adj: str | None = None) -> str:
    if word.is_name:
        return word.en
    base = word.meaning.split(",")[0].strip()
    base = re.sub(r"\s*\(.*?\)", "", base).strip()
    if word.plural_only or number == "pl":
        if not word.plural_only:
            head_words = base.split()
            last = head_words[-1]
            last = EN_PLURALS.get(last) or (last[:-1] + "ies" if re.search(r"[^aeiou]y$", last)
                                            else last + "es" if re.search(r"(s|sh|ch|x)$", last)
                                            else last + "s")
            base = " ".join(head_words[:-1] + [last])
        phrase = f"{adj} {base}" if adj else base
        return f"the {phrase}" if art in (None, "the") else phrase
    phrase = f"{adj} {base}" if adj else base
    if art == "":
        return phrase
    if art == "a":
        if base in EN_MASS and not adj:
            return phrase
        return ("an " if phrase[:1] in "aeiou" else "a ") + phrase
    if base in EN_MASS and art is None:
        return phrase
    return "the " + phrase


def en_adj(word: Word) -> str:
    return re.sub(r"\s*\(.*?\)", "", word.meaning.split(",")[0]).strip()


# --------------------------------------------------------------- templates

SLOT_RE = re.compile(r"\{(\w+)(?::([\w.]+))?\}")


class TemplateError(Exception):
    pass


def load_skill_chapter(skill: str) -> int:
    sk = load_json(GRAM / "skills.json")
    for s in sk["skills"]:
        if s["id"] == skill:
            return s["chapter"]
    raise TemplateError(f"{skill}: not in skills.json")


def load_templates(skill: str) -> dict:
    path = TEMPLATES_DIR / f"{skill}.json"
    data = load_json(path)
    if data.get("skill") != skill:
        raise TemplateError(f"{path.name}: skill is {data.get('skill')!r}")
    if data.get("chapter") != load_skill_chapter(skill):
        raise TemplateError(f"{path.name}: chapter {data.get('chapter')} is not the skill's")
    ids = [t["id"] for t in data["templates"]]
    if len(ids) != len(set(ids)):
        raise TemplateError(f"{path.name}: duplicate template id")
    if not 5 <= len(ids) <= 10:
        raise TemplateError(f"{path.name}: {len(ids)} templates; five to ten wanted")
    for t in data["templates"]:
        validate_template(t)
    data.setdefault("exclude", [])
    return data


def validate_template(t: dict) -> None:
    for key in ("id", "la", "en", "slots", "focus"):
        if key not in t:
            raise TemplateError(f"{t.get('id')}: missing {key}")
    used = {m.group(1) for m in SLOT_RE.finditer(t["la"])} - {"ab"}
    for name in used:
        if name not in t["slots"]:
            raise TemplateError(f"{t['id']}: slot {{{name}}} not declared")
    for name, spec in t["slots"].items():
        if name not in used:
            raise TemplateError(f"{t['id']}: slot {name} declared but not printed")
        pos = spec.get("pos", "N")
        if pos == "N":
            if not spec.get("sem") and not spec.get("only"):
                raise TemplateError(f"{t['id']}: noun slot {name} needs sem or only")
            if set(spec.get("sem") or []) - SEM_CLASSES:
                raise TemplateError(f"{t['id']}: slot {name} names an unknown class")
        elif pos == "ADJ":
            if spec.get("agree") not in t["slots"]:
                raise TemplateError(f"{t['id']}: adjective {name} must agree with a slot")
        elif pos == "V":
            if "form" not in spec:
                raise TemplateError(f"{t['id']}: verb {name} needs form")
            subj = spec.get("subj")
            if isinstance(subj, str) and subj not in t["slots"] and subj not in ("ego", "nōs", "vōs", "tū"):
                raise TemplateError(f"{t['id']}: verb {name} subj {subj} unknown")
        elif pos == "PRON":
            if spec.get("agree") not in t["slots"] or not spec.get("lemma"):
                raise TemplateError(f"{t['id']}: pronoun {name} needs lemma and agree")
        else:
            raise TemplateError(f"{t['id']}: slot {name} pos {pos}")
    if t["focus"] not in t["slots"] and t["focus"] not in t["la"]:
        raise TemplateError(f"{t['id']}: focus {t['focus']} is neither a slot nor a printed word")
    for m in SLOT_RE.finditer(t["en"]):
        if m.group(1) not in t["slots"]:
            raise TemplateError(f"{t['id']}: en names slot {m.group(1)} the pattern lacks")


# --------------------------------------------------------------- filling

class Fill:
    """One filled template: slot → (Word, parse, printed form)."""

    def __init__(self, template: dict):
        self.t = template
        self.words: dict[str, Word] = {}
        self.parses: dict[str, dict] = {}
        self.forms: dict[str, str] = {}
        self.numbers: dict[str, str] = {}


def _slot_case(t: dict, name: str) -> str | None:
    m = re.search(r"\{%s:([\w.]+)\}" % re.escape(name), t["la"])
    return m.group(1) if m else None


def noun_candidates(lex: Lexicon, chapter: int, spec: dict) -> list[Word]:
    pool: list[Word] = []
    if spec.get("only"):
        only = {key_of(x) for x in spec["only"]}
        pool = [w for w in lex.words if w.pos == "N" and w.chapter <= chapter and key_of(w.lemma) in only]
    else:
        classes = set(spec["sem"])
        pool = [w for w in lex.pool("N", chapter) if w.classes & classes]
        if "person" in classes and spec.get("names", True):
            pool += lex.names(chapter)
    if spec.get("not"):
        drop = {key_of(x) for x in spec["not"]}
        pool = [w for w in pool if key_of(w.lemma) not in drop]
    number = spec.get("number", "sg")
    if number == "sg":
        pool = [w for w in pool if not w.plural_only]
    if number == "pl":
        pool = [w for w in pool if not w.is_name and not _singular_only(w)]
    return pool


def _singular_only(w: Word) -> bool:
    return not any(p.get("case") == "nom" and p.get("number") == "pl" for ps in w.index.values() for p in ps)


def noun_gender(w: Word) -> str:
    return w.gender if w.gender in ("m", "f", "n") else "m"


def adj_candidates(lex: Lexicon, chapter: int, noun: Word, spec: dict, number: str) -> list[Word]:
    out = []
    for a in lex.pool("ADJ", chapter):
        sem = a.sem if isinstance(a.sem, dict) else None
        if not sem or not (set(sem.get("of") or []) & noun.classes):
            continue
        if sem.get("number") and sem["number"] != number:
            continue
        if spec.get("only") and key_of(a.lemma) not in {key_of(x) for x in spec["only"]}:
            continue
        if spec.get("not") and key_of(a.lemma) in {key_of(x) for x in spec["not"]}:
            continue
        out.append(a)
    return out


def _arg_ok(verb_sem: dict, role: str, word: Word | None) -> bool:
    """Does the verb admit `word` in `role` (subj / obj / dat)?"""
    if word is None:
        return True
    only = verb_sem.get(f"{role}_only")
    if only:
        return key_of(word.lemma) in {key_of(x) for x in only}
    also = verb_sem.get(f"{role}_also") or []
    if key_of(word.lemma) in {key_of(x) for x in also}:
        return True
    return bool(set(verb_sem.get(role) or []) & word.classes)


def verb_candidates(lex: Lexicon, chapter: int, spec: dict, fill: Fill) -> list[Word]:
    out = []
    subj_slots = spec.get("subj")
    subj_words = []
    if isinstance(subj_slots, list):
        subj_words = [fill.words[s] for s in subj_slots]
    elif isinstance(subj_slots, str) and subj_slots in fill.words:
        subj_words = [fill.words[subj_slots]]
    obj = fill.words.get(spec["obj"]) if spec.get("obj") else None
    dat = fill.words.get(spec["dat"]) if spec.get("dat") else None
    lemmas = {key_of(x) for x in spec.get("lemmas", [])}
    for v in lex.pool("V", chapter):
        sem = v.sem if isinstance(v.sem, dict) else None
        if not sem or v.lemma not in EN_VERBS:
            continue
        if lemmas and key_of(v.lemma) not in lemmas:
            continue
        if spec.get("not") and key_of(v.lemma) in {key_of(x) for x in spec["not"]}:
            continue
        if not all(_arg_ok(sem, "subj", s) for s in subj_words):
            continue
        if spec.get("obj"):
            if not sem.get("obj") and not sem.get("obj_only") and not sem.get("obj_also"):
                continue
            if not _arg_ok(sem, "obj", obj):
                continue
        elif not spec.get("absolute"):
            if sem.get("obj") or sem.get("obj_only") or sem.get("obj_also"):
                continue          # a transitive verb is not used without its object
        if spec.get("dat"):
            if not sem.get("dat") or not (set(sem["dat"]) & dat.classes):
                continue
        elif sem.get("dat") and not spec.get("absolute"):
            continue              # a verb of giving is not used without its receiver
        if spec.get("voice") == "pass" or "pass" in spec["form"]:
            if v.deponent:
                continue          # a deponent has no passive meaning
        out.append(v)
    return out


def verb_parse(spec: dict, fill: Fill, verb: Word) -> dict:
    parts = spec["form"].split(".")
    parse: dict = {}
    if parts[0] == "ptc":
        agree = fill.words[spec["agree"]]
        parse = {"mood": "ptc", "tense": parts[1] if len(parts) > 1 else "pres",
                 "case": _slot_case(fill.t, spec["agree"]) or "abl",
                 "number": fill.numbers[spec["agree"]], "gender": noun_gender(agree)}
        parse["voice"] = "act"
        return parse
    if parts[0] == "inf":
        parse = {"mood": "inf", "tense": parts[1] if len(parts) > 1 else "pres",
                 "voice": "pass" if verb.deponent else (parts[2] if len(parts) > 2 else "act")}
        return parse
    tense, mood, voice = parts[0], parts[1], parts[2] if len(parts) > 2 else "act"
    if verb.deponent:
        voice = "pass"
    person, number = 3, "sg"
    subj = spec.get("subj")
    if isinstance(subj, list):
        number = "pl"
    elif subj in ("ego",):
        person, number = 1, "sg"
    elif subj in ("tū",):
        person, number = 2, "sg"
    elif subj in ("nōs",):
        person, number = 1, "pl"
    elif subj in ("vōs",):
        person, number = 2, "pl"
    elif subj:
        number = fill.numbers[subj]
    if len(parts) > 3:
        person, number = int(parts[3][0]), parts[3][1:]
    return {"tense": tense, "mood": mood, "voice": voice, "person": person, "number": number}


def _resolve_ab(la: str) -> str:
    def rep(m):
        nxt = la[m.end():].lstrip()[:1]
        return "ab" if _plain(nxt).lower() in "aeiouh" and nxt else "ā"
    return re.sub(r"\{ab\}", rep, la)


def fill_template(lex: Lexicon, chapter: int, t: dict, rng: random.Random) -> Fill | None:
    fill = Fill(t)
    slots = t["slots"]
    order = sorted(slots, key=lambda n: {"N": 0, "ADJ": 1, "PRON": 1, "V": 2}[slots[n].get("pos", "N")])
    used_lemmas: set[str] = set()
    for name in order:
        spec = slots[name]
        pos = spec.get("pos", "N")
        if pos == "N":
            cands = [w for w in noun_candidates(lex, chapter, spec) if key_of(w.lemma) not in used_lemmas]
            if spec.get("same"):
                cands = [fill.words[spec["same"]]]
            if not cands:
                return None
            w = rng.choice(cands)
            number = spec.get("number", "sg")
            if number == "any":
                number = rng.choice(["sg", "pl"]) if not w.is_name else "sg"
            if w.plural_only:
                number = "pl"
            case = _slot_case(t, name)
            parse = {"case": case, "number": number, "gender": noun_gender(w)}
            form = inflect(w, parse)
            if form is None:
                return None
            fill.words[name], fill.parses[name], fill.forms[name], fill.numbers[name] = w, parse, form, number
            if not spec.get("same"):
                used_lemmas.add(key_of(w.lemma))
        elif pos == "ADJ":
            noun = fill.words[spec["agree"]]
            number = fill.numbers[spec["agree"]]
            cands = [a for a in adj_candidates(lex, chapter, noun, spec, number) if key_of(a.lemma) not in used_lemmas]
            if not cands:
                return None
            a = rng.choice(cands)
            parse = {"case": _slot_case(t, name) or fill.parses[spec["agree"]]["case"],
                     "number": number, "gender": noun_gender(noun)}
            form = inflect(a, parse)
            if form is None:
                return None
            fill.words[name], fill.parses[name], fill.forms[name], fill.numbers[name] = a, parse, form, number
            used_lemmas.add(key_of(a.lemma))
        elif pos == "PRON":
            ante = fill.words[spec["agree"]]
            p = lex.word(spec["lemma"], "PRON")
            if p is None:
                return None
            parse = {"case": _slot_case(t, name), "number": fill.numbers[spec["agree"]], "gender": noun_gender(ante)}
            form = inflect(p, parse)
            if form is None:
                return None
            fill.words[name], fill.parses[name], fill.forms[name], fill.numbers[name] = p, parse, form, parse["number"]
        else:  # V
            if spec.get("same"):
                cands = [fill.words[spec["same"]]]
            else:
                cands = [v for v in verb_candidates(lex, chapter, spec, fill) if key_of(v.lemma) not in used_lemmas]
            if not cands:
                return None
            v = rng.choice(cands)
            parse = verb_parse(spec, fill, v)
            form = inflect(v, parse)
            if form is None:
                return None
            fill.words[name], fill.parses[name], fill.forms[name] = v, parse, form
            fill.numbers[name] = parse.get("number", "sg")
            if not spec.get("same"):
                used_lemmas.add(key_of(v.lemma))
    return fill


# --------------------------------------------------------------- rendering

def render_la(fill: Fill) -> str:
    def rep(m):
        name = m.group(1)
        if name == "ab":
            return "{ab}"
        return fill.forms[name]
    la = SLOT_RE.sub(rep, fill.t["la"])
    la = _resolve_ab(la)
    la = la[:1].upper() + la[1:]
    return la


def _en_np(fill: Fill, name: str) -> str:
    w = fill.words[name]
    spec = fill.t["slots"][name]
    adj = next((en_adj(fill.words[n]) for n, s in fill.t["slots"].items()
                if s.get("pos") == "ADJ" and s.get("agree") == name and n in fill.words), None)
    if w.pos == "PRON":
        case = fill.parses[name]["case"]
        g, n = fill.parses[name]["gender"], fill.parses[name]["number"]
        if key_of(w.lemma) == "is":
            return {"m": "him", "f": "her", "n": "it"}[g] if n == "sg" else "them"
        if key_of(w.lemma) == "qui":
            return "who"
    return en_noun(w, fill.numbers[name], spec.get("art"), adj)


def render_en(fill: Fill) -> str:
    def rep(m):
        name, mod = m.group(1), m.group(2)
        w = fill.words[name]
        spec = fill.t["slots"][name]
        if spec.get("pos") == "V":
            base = EN_VERBS[w.lemma]
            parse = fill.parses[name]
            number = parse.get("number", "sg")
            person = parse.get("person", 3)
            if mod:
                if mod == "prog":
                    be = "is" if number == "sg" else "are"
                    return f"{be} {en_verb(base, 'ing')}"
                if mod == "3sg":
                    return en_verb(base, "3sg", number, person)
                return en_verb(base, mod, number, person)
            if parse.get("mood") == "ptc":
                return en_verb(base, "ing")
            if parse.get("mood") == "inf":
                return "to " + base
            if parse.get("tense") == "perf":
                return en_verb(base, "past", number, person)
            if parse.get("tense") == "impf":
                be = "was" if number == "sg" and person != 2 else "were"
                return f"{be} {en_verb(base, 'ing')}"
            if parse.get("voice") == "pass" and not w.deponent:
                be = "is" if number == "sg" else "are"
                return f"{be} {en_verb(base, 'pp')}"
            if parse.get("mood") == "subj":
                return base
            return en_verb(base, "3sg", number, person)
        if spec.get("pos") == "ADJ":
            return en_adj(w)
        return _en_np(fill, name)
    en = SLOT_RE.sub(rep, fill.t["en"])
    return en[:1].upper() + en[1:]


CASE_GLOSS = {"nom": "", "acc": "", "gen": "of ", "dat": "to ", "abl": "by ", "voc": ""}


def render_gloss(fill: Fill, la: str, lex: Lexicon) -> list[dict]:
    """One entry per printed word, in order."""
    tokens = [tok for tok in re.findall(r"[^\s]+", la)]
    # map printed forms back to slots (first unused match)
    slot_of_form: dict[str, list[str]] = defaultdict(list)
    for name, form in fill.forms.items():
        slot_of_form[form].append(name)
    used_slots: set[str] = set()
    out = []
    for i, tok in enumerate(tokens):
        bare = re.sub(r"^[\"'“‘(\[]+|[\"'”’)\].,;:!?]+$", "", tok)
        names = [n for n in slot_of_form.get(bare, []) if n not in used_slots]
        if not names and i == 0:
            names = [n for n in slot_of_form.get(bare[:1].lower() + bare[1:], []) if n not in used_slots]
        if names:
            name = names[0]
            used_slots.add(name)
            out.append({"w": bare, "m": gloss_slot(fill, name)})
            continue
        out.append({"w": bare, "m": gloss_fixed(bare, lex, fill)})
    return out


def gloss_slot(fill: Fill, name: str) -> str:
    w, spec, parse = fill.words[name], fill.t["slots"][name], fill.parses[name]
    pos = spec.get("pos", "N")
    if pos == "V":
        base = EN_VERBS[w.lemma]
        number, person = parse.get("number", "sg"), parse.get("person", 3)
        if parse.get("mood") == "ptc":
            return en_verb(base, "ing")
        if parse.get("mood") == "inf":
            return "to " + base
        if parse.get("mood") == "subj":
            return ("may " if number == "sg" else "may ") + base
        if parse.get("tense") == "perf":
            return en_verb(base, "past", number, person)
        if parse.get("tense") == "impf":
            return ("was " if number == "sg" and person != 2 else "were ") + en_verb(base, "ing")
        if parse.get("voice") == "pass" and not w.deponent:
            return ("is " if number == "sg" else "are ") + en_verb(base, "pp")
        if person == 1:
            return ("I " if number == "sg" else "we ") + base
        if person == 2:
            return "you " + base
        return en_verb(base, "3sg", number, person)
    if pos == "ADJ":
        return en_adj(w)
    if pos == "PRON":
        return _en_np(fill, name)
    prefix = spec.get("g", CASE_GLOSS.get(parse["case"], ""))
    if prefix and not prefix.endswith(" "):
        prefix += " "
    np = en_noun(w, fill.numbers[name], spec.get("art"))
    if parse["case"] == "voc":
        return np
    return prefix + np


def gloss_fixed(bare: str, lex: Lexicon, fill: Fill) -> str:
    if bare in FIXED_GLOSS:
        return FIXED_GLOSS[bare]
    low = bare[:1].lower() + bare[1:]
    if low in FIXED_GLOSS:
        return FIXED_GLOSS[low]
    for w in lex.words:
        if key_of(w.lemma) == key_of(bare) and not w.is_name:
            return w.meaning.split(",")[0].strip()
    return fill.t.get("fixed_gloss", {}).get(bare, "?")


# --------------------------------------------------------------- checks

def check_sentence(lex: Lexicon, chapter: int, t: dict, fill: Fill, la: str, exclude: list) -> list[str]:
    """Every §11 check; [] when the sentence may ship."""
    problems: list[str] = []
    tokens = re.findall(r"[^\s]+", la)
    n = len(tokens)
    if not MIN_WORDS <= n <= MAX_WORDS:
        problems.append(f"length {n}")
    # no lemma twice (a `same` slot is the deliberate exception)
    seen: Counter = Counter()
    for name, w in fill.words.items():
        if t["slots"][name].get("same"):
            continue
        seen[key_of(w.lemma)] += 1
    for lemma, c in seen.items():
        if c > 1:
            problems.append(f"lemma twice: {lemma}")
    # printed forms all inside the cumulative vocabulary, spelled as the engine spells them
    forms = lex.forms_at(chapter)
    name_forms = {key_of(f): f for w in lex.names(chapter) for f in w.index}
    for tok in tokens:
        bare = re.sub(r"^[\"'“‘(\[]+|[\"'”’)\].,;:!?]+$", "", tok)
        k = key_of(bare)
        low = bare[:1].lower() + bare[1:]
        if k in name_forms or bare in FUNCTION_WORDS or low in FUNCTION_WORDS:
            continue
        spell = forms.get(k)
        if not spell:
            problems.append(f"outside vocabulary at chapter {chapter}: {bare}")
        elif bare not in spell and low not in spell and not (
                key_of(bare) == "da" or _dō_fix("dō", bare) in spell or bare.replace("da", "dā", 1) in spell):
            problems.append(f"spelling {bare} not among {sorted(spell)}")
    # each slot form carries the intended parse
    for name, w in fill.words.items():
        if not has_parse(w, fill.forms[name], fill.parses[name]):
            problems.append(f"{name}: {fill.forms[name]} does not parse as {fill.parses[name]}")
    # verb / argument classes
    for name, spec in t["slots"].items():
        if spec.get("pos") != "V" or spec.get("same"):
            continue
        v = fill.words[name]
        sem = v.sem
        subj = spec.get("subj")
        subj_words = [fill.words[s] for s in (subj if isinstance(subj, list) else [subj]) if s in fill.words]
        for s in subj_words:
            if not _arg_ok(sem, "subj", s):
                problems.append(f"{name}: {v.lemma} does not take {s.lemma} as subject")
        if spec.get("obj") and not _arg_ok(sem, "obj", fill.words[spec["obj"]]):
            problems.append(f"{name}: {v.lemma} does not take {fill.words[spec['obj']].lemma} as object")
        if spec.get("dat") and not (set(sem.get("dat") or []) & fill.words[spec["dat"]].classes):
            problems.append(f"{name}: {v.lemma} does not take {fill.words[spec['dat']].lemma} in the dative")
    # exclusion list: a whole sentence, or a template + slot combination
    for ex in exclude:
        if isinstance(ex, str):
            if ex == la:
                problems.append("excluded sentence")
        elif ex.get("template", t["id"]) == t["id"] and all(
                key_of(fill.words[k].lemma) == key_of(v) for k, v in ex.get("fill", {}).items() if k in fill.words):
            problems.append(f"excluded combination {ex.get('fill')}")
    return problems


# --------------------------------------------------------------- generation

def generate(skill: str, n: int = 40, seed: int = 1, lex: Lexicon | None = None,
             template_ids: list[str] | None = None, max_tries: int = 400) -> dict:
    lex = lex or Lexicon()
    data = load_templates(skill)
    chapter = data["chapter"]
    rng = random.Random(f"{skill}:{seed}")
    templates = [t for t in data["templates"] if not template_ids or t["id"] in template_ids]
    out: list[dict] = []
    seen_la: set[str] = set()
    rejected: list[dict] = []
    per_template = Counter()
    i = 0
    tries = 0
    while len(out) < n and tries < max_tries * n:
        tries += 1
        t = templates[i % len(templates)]
        i += 1
        fill = fill_template(lex, chapter, t, rng)
        if fill is None:
            continue
        la = render_la(fill)
        problems = check_sentence(lex, chapter, t, fill, la, data["exclude"])
        if problems:
            rejected.append({"template": t["id"], "la": la, "problems": problems})
            continue
        if la in seen_la:
            continue
        seen_la.add(la)
        per_template[t["id"]] += 1
        focus_slot = t["focus"]
        focus = fill.forms.get(focus_slot, focus_slot)
        gloss = render_gloss(fill, la, lex)
        out.append({
            "id": f"{t['id']}-{hashlib.sha1(la.encode('utf-8')).hexdigest()[:6]}",
            "la": la,
            "en": render_en(fill),
            "words": len(la.split()),
            "focus": focus,
            "gloss": gloss,
            "generated": True,
            "template": t["id"],
            "fill": {k: w.lemma for k, w in fill.words.items()},
        })
    return {"skill": skill, "chapter": chapter, "seed": seed, "sentences": out,
            "rejected_by_check": rejected, "per_template": dict(per_template)}


def count_template(lex: Lexicon, chapter: int, t: dict, exclude: list | None = None,
                   cap: int = 3_000_000) -> int | str:
    """The distinct sentences a template can produce at `chapter`, by exact
    enumeration of the slot assignments the checks would pass (a `same` slot
    adds nothing; `number: any` doubles a slot).  Returns '>cap' if the
    enumeration would exceed `cap` assignments."""
    slots = t["slots"]
    noun_names = [n for n, s in slots.items() if s.get("pos", "N") == "N" and not s.get("same")]
    adj_names = [n for n, s in slots.items() if s.get("pos") == "ADJ"]
    verb_names = [n for n, s in slots.items() if s.get("pos") == "V" and not s.get("same")]
    pools = {n: noun_candidates(lex, chapter, slots[n]) for n in noun_names}
    numbers = {n: slots[n].get("number", "sg") for n in noun_names}
    est = 1
    for n in noun_names:
        est *= max(1, len(pools[n])) * (2 if numbers[n] == "any" else 1)
    if est > cap:
        return f">{cap:,}"

    @lru_cache(maxsize=None)
    def adj_count(name: str, noun_lemma: str, number: str) -> int:
        noun = next(w for w in lex.words if w.lemma == noun_lemma)
        return len(adj_candidates(lex, chapter, noun, slots[name], number))

    total = 0
    number_choices = [[numbers[n]] if numbers[n] != "any" else ["sg", "pl"] for n in noun_names]
    for combo in itertools.product(*(pools[n] for n in noun_names)):
        lemmas = [key_of(w.lemma) for w in combo]
        if len(set(lemmas)) != len(lemmas):
            continue
        for nums in itertools.product(*number_choices):
            fill = Fill(t)
            ok = True
            for name, w, num in zip(noun_names, combo, nums):
                if num == "pl" and (w.is_name or _singular_only(w)):
                    ok = False
                    break
                if num == "sg" and w.plural_only:
                    ok = False
                    break
                fill.words[name] = w
                fill.numbers[name] = "pl" if w.plural_only else num
            if not ok:
                continue
            excluded = False
            for ex in exclude or []:
                if isinstance(ex, dict) and ex.get("template", t["id"]) == t["id"] and all(
                        k in fill.words and key_of(fill.words[k].lemma) == key_of(v) for k, v in ex.get("fill", {}).items()):
                    excluded = True
            if excluded:
                continue
            product = 1
            for a in adj_names:
                product *= adj_count(a, fill.words[slots[a]["agree"]].lemma, fill.numbers[slots[a]["agree"]])
            for v in verb_names:
                product *= len(verb_candidates(lex, chapter, slots[v], fill))
            total += product
    return total


def check_all() -> list[str]:
    errs = []
    for path in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            load_templates(path.stem)
        except (TemplateError, KeyError, ValueError) as e:
            errs.append(f"{path.name}: {e}")
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("skills", nargs="*", help="skill ids (default: --all)")
    ap.add_argument("--all", action="store_true", help="every skill with a template file")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--counts", action="store_true", help="productive count per template")
    ap.add_argument("--json", help="write the generated batch here")
    ap.add_argument("--check", action="store_true", help="validate the template files only")
    ap.add_argument("--template", help="only this template id")
    a = ap.parse_args(argv)
    if a.check:
        errs = check_all()
        for e in errs:
            print("ERROR", e)
        print("templates: OK" if not errs else f"templates: {len(errs)} problem(s)")
        return 1 if errs else 0
    skills = a.skills or ([p.stem for p in sorted(TEMPLATES_DIR.glob("*.json"))] if a.all or not a.skills else [])
    lex = Lexicon()
    batch = []
    for skill in skills:
        data = load_templates(skill)
        if a.counts:
            print(f"## {skill} (chapter {data['chapter']})")
            for t in data["templates"]:
                c = count_template(lex, data["chapter"], t, data["exclude"])
                print(f"  {t['id']:8} {c:>12}  {t['la']}")
            continue
        res = generate(skill, a.n, a.seed, lex, [a.template] if a.template else None)
        batch.append(res)
        print(f"## {skill} (chapter {res['chapter']}), {len(res['sentences'])} sentences, "
              f"{len(res['rejected_by_check'])} fills rejected by the checks")
        for s in res["sentences"]:
            print(f"  [{s['template']}] {s['la']}  |  {s['en']}")
        for r in res["rejected_by_check"][:10]:
            print(f"  rejected [{r['template']}] {r['la']}  --  {'; '.join(r['problems'])}")
    if a.json and batch:
        Path(a.json).write_text(json.dumps(batch, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        if hasattr(_s, "reconfigure"):
            _s.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
