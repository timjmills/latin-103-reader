# -*- coding: utf-8 -*-
"""Build app/data/grammar/skills.json (the grammar skill map) and validate it.

Run:  python pipeline/build_skills.py            (writes the file, then validates)
      python pipeline/build_skills.py --check    (validate the existing file only)

The map is authored here as Python data so that the cross-references
(prereqs, confusable_with, order) can be checked mechanically. See
app/data/grammar/README.md for the meaning of every field.
"""
import json, re, sys, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "data", "grammar", "skills.json")

# ---------------------------------------------------------------------------
# plain-words glosses (the wording used in the reader's plain notes)
NOM = "the nominative (the plain naming form)"
GEN = "the genitive (the 'of' form)"
DAT = "the dative (the 'to/for' form)"
ACC = "the accusative (the object form)"
VOC = "the vocative (the calling form)"
IMPF = "the imperfect (the 'was doing' tense)"
PERF = "the perfect (the 'did / has done' tense)"
PLUPF = "the pluperfect (the 'had done' tense)"
FUT = "the future (the 'will do' tense)"
FUTPERF = "the future perfect (the 'will have done' tense)"
INF = "the infinitive (the 'to' form)"

# notes week -> (course, week in course)
def course_week(notes_week, syllabus_week=None):
    if notes_week <= 14:
        return "101", notes_week
    if notes_week <= 24:
        return "102", notes_week - 14
    return "103", syllabus_week

S = []  # skills in book order

def skill(id, title, plain, latin, cat, ch, nw, pages, prereqs, confus, paradigms, focus, patterns, pf, kinds, summary, syl=None):
    course, week = course_week(nw, syl)
    S.append({
        "id": id, "title": title, "plain": plain, "latin_label": latin, "category": cat,
        "chapter": ch, "course": course, "week": week, "notes_week": nw, "notes_pages": pages,
        "prereqs": prereqs, "confusable_with": confus,
        "paradigms": paradigms, "paradigm_focus": focus, "patterns": patterns,
        "parse_filter": pf, "kinds": kinds, "summary": summary,
    })

NOUN12 = ["decl1", "decl2m", "decl2n", "decl2r"]
NOUN_ALL = ["decl1", "decl2m", "decl2n", "decl2r", "decl3", "decl3n", "decl3i", "decl3in", "decl4", "decl5"]
CONJ_ALL = ["conj1", "conj2", "conj3", "conj3io", "conj4"]
IRREG = ["sum", "possum", "eo", "fero", "volo", "nolo", "malo"]

# ---------------------------------------------------------------------------
# Familia Romana I–VIII · Latin 101 weeks 1–8

skill("nominative-subject", "Nominative: the subject", NOM, "casus nominativus", "noun-case", 1, 1, [1, 2],
      [], ["accusative-object", "vocative"],
      NOUN12, {"case": "nom"},
      [r"(?i)\b\w+(a|ae|us|i|um|er|ir)\b"],
      {"case": "nom", "pos": "N"},
      ["recognise", "chart", "parse", "blank"],
      "The naming form: the subject of the sentence, or a word that renames it after est; singular -a / -us / -um, plural -ae / -i / -a.")

skill("noun-gender", "Grammatical gender", "gender (masculine, feminine or neuter, fixed for each noun)", "genus", "noun-case", 1, 1, [3],
      ["nominative-subject"], ["adjective-agreement"],
      NOUN12, None,
      [r"(?i)\b\w+(a|us|um|er|ir|is|or|io|as|es|u)\b"],
      {"pos": "N"},
      ["recognise", "parse"],
      "Every noun has a fixed gender: a-nouns are usually feminine, us-nouns masculine, um-nouns neuter; 3rd-declension genders must be learned.")

skill("adjective-agreement", "Adjective agreement", "an adjective agreeing with its noun (same gender, number and case)", "adiectivum cum substantivo congruens", "adjective", 1, 1, [4, 12],
      ["nominative-subject", "noun-gender"], ["noun-gender", "accusative-object"],
      ["adj12"], None,
      [r"(?i)\b\w+(us|a|um|i|ae|os|as|am)\b\s+\w+(us|a|um|i|ae|os|as|am)\b"],
      {"pos": "ADJ"},
      ["recognise", "chart", "parse", "blank"],
      "An adjective takes the gender, number and case of its noun (malus, mala, malum); the endings need not rhyme with the noun's.")

skill("enclitics", "Enclitics -que and -ne", "the tacked-on words -que ('and') and -ne (turns a sentence into a question)", "encliticae -que, -ne", "syntax", 1, 18, [62],
      ["nominative-subject"], ["subjunctive-wish-command"],   # -ne on a verb (venitne?) against ne + subjunctive (ne veniat): the builder adds the reverse link
      [], None,
      [r"(?i)\b\w{3,}(que|ne|ve)\b"],
      [{"enc": "que"}, {"enc": "ne"}],
      ["recognise", "parse"],
      "-que glued to a word means 'and' before it; -ne on the first word marks a yes/no question; -ve means 'or'.")

skill("genitive-possession", "Genitive: possession", GEN, "genitivus possessivus", "noun-case", 2, 2, [5],
      ["nominative-subject"], ["dative-indirect-object", "genitive-of"],
      NOUN12, {"case": "gen"},
      [r"(?i)\b\w+(ae|i|arum|orum)\b"],
      {"case": "gen", "pos": "N"},
      ["recognise", "chart", "parse", "blank"],
      "The 'whose?' form: -ae / -i singular, -arum / -orum plural; it can stand before or after the noun it belongs to.")

skill("genitive-of", "Genitive: 'of' (description, part, with adjectives)", GEN, "genitivus descriptivus et partitivus", "noun-case", 2, 2, [6, 7],
      ["genitive-possession"], ["genitive-possession", "ablative-means"],
      NOUN12, {"case": "gen"},
      [r"(?i)\b(plenus|plena|plenum|pleni|plenae|numerus|multitudo|pars|copia|cupidus|studiosus)\s+\w+(ae|i|arum|orum|is|um|ium)\b",
       r"(?i)\b\w+(ae|i|arum|orum|is|um|ium)\s+(plenus|plena|plenum)\b"],
      {"case": "gen"},
      ["recognise", "parse", "blank"],
      "The genitive also does the work of English 'of': a cup of wine, a number of sons, full of apples (plenus + genitive).")

skill("accusative-object", "Accusative: the object", ACC, "casus accusativus", "noun-case", 3, 3, [10, 11],
      ["nominative-subject"], ["nominative-subject", "accusative-destination", "ablative-place"],
      NOUN12, {"case": "acc"},
      [r"(?i)\b\w+(am|um|em|as|os|es)\b"],
      {"case": "acc", "pos": "N"},
      ["recognise", "chart", "parse", "blank"],
      "The object form: who or what the verb acts on, and the object of most prepositions; -m singular, -s plural; neuters keep the nominative shape.")

skill("present-indicative-3rd", "Present tense: he / they (-t, -nt)", "the present tense, 3rd person (-t 'he does', -nt 'they do')", "praesens indicativi, tertia persona", "verb-form", 3, 3, [8, 9],
      ["nominative-subject"], ["passive-voice", "imperative"],
      CONJ_ALL + ["sum", "eo"], {"tense": "pres", "mood": "ind", "voice": "act", "person": 3},
      [r"(?i)\b\w+(at|et|it|ant|ent|unt|iunt)\b", r"(?i)\b(est|sunt|it|eunt|abest|absunt|adest|adsunt)\b"],
      {"tense": "pres", "mood": "ind", "voice": "act", "person": 3},
      ["recognise", "chart", "parse", "blank"],
      "A verb is stem + ending: -t for one doer, -nt for several (pulsat, pulsant); the vowel before the ending tells you the conjugation.")

skill("imperative", "Imperative: commands", "the imperative (the command form)", "modus imperativus", "verb-form", 4, 4, [13],
      ["present-indicative-3rd"], ["present-indicative-3rd", "vocative", "infinitive"],
      CONJ_ALL, {"mood": "imper", "voice": "act", "tense": "pres"},
      [r"(?i)\b\w+(a|e|i|ate|ete|ite)\b(?=[^.!?]*!)", r"(?i)\b(dic|duc|fac|fer|es|este|i|ite|veni|venite|tace|tacete)\b"],
      {"mood": "imper", "voice": "act", "tense": "pres"},
      ["recognise", "chart", "parse", "blank"],
      "Orders: the bare stem for one person (tace!, veni!, pone!), stem + -te for several (tacete!); dic, duc, fac drop their final -e.")

skill("vocative", "Vocative: calling someone", VOC, "casus vocativus", "noun-case", 4, 4, [14],
      ["nominative-subject", "imperative"], ["nominative-subject", "imperative"],
      ["decl2m"], {"case": "voc"},
      [r"(?i)\b[A-Z]\w+(e|i)\b\s*[,!]", r"(?i)\b(o|mi)\s+\w+\b"],
      {"case": "voc"},
      ["recognise", "chart", "parse", "blank"],
      "The form for addressing someone: the same as the nominative except -us nouns become -e (Marce!) and -ius nouns become -i (Iuli!, mi fili!).")

skill("ablative-place", "Ablative: place where (in, sub, cum + ablative)", "the ablative (the 'in/on/with' form)", "ablativus loci", "noun-case", 5, 5, [15, 16],
      ["accusative-object"], ["accusative-destination", "ablative-origin", "ablative-means"],
      NOUN12, {"case": "abl"},
      [r"(?i)\b(in|sub|cum|pro|prae|coram|sine)\s+\w+(a|o|is|e|i|ibus|u|ebus)\b"],
      {"case": "abl", "pos": "N"},
      ["recognise", "chart", "parse", "blank"],
      "Where something is: in, sub, cum, pro take the ablative (-a / -o singular, -is plural); most other prepositions take the accusative.")

skill("ablative-origin", "Ablative: from (ab, ex, de + ablative)", "the ablative (the 'from' form)", "ablativus separativus", "noun-case", 5, 5, [17],
      ["ablative-place"], ["ablative-place", "ablative-agent", "accusative-destination"],
      NOUN12, {"case": "abl"},
      [r"(?i)\b(a|ab|e|ex|de|sine|absque)\s+\w+(a|o|is|e|i|ibus|u|ebus)\b"],
      {"case": "abl", "pos": "N"},
      ["recognise", "parse", "blank"],
      "Where something comes from or is separated from: ab, ex, de, sine always take the ablative, whatever their sense (de Deo = about God).")

skill("accusative-destination", "Accusative: motion towards (ad, in + accusative)", "the accusative (the 'to/into' form after ad, in)", "accusativus directionis", "noun-case", 6, 5, [18],
      ["accusative-object", "ablative-place"], ["ablative-place", "ablative-origin", "accusative-object"],
      NOUN12, {"case": "acc"},
      [r"(?i)\b(ad|in|sub|per|contra|super|ante|post|apud|inter|circum|prope|trans)\s+\w+(am|um|em|as|os|es)\b", r"(?i)\b(domum|romam|tusculum)\b"],
      {"case": "acc", "pos": "N"},
      ["recognise", "parse", "blank"],
      "Where something is going: ad, in, sub + accusative (in hortum = into the garden); city names and domum stand alone in the accusative.")

skill("ablative-means", "Ablative: means (by / with a thing)", "the ablative (the 'by/with' form)", "ablativus instrumenti", "noun-case", 6, 5, [19],
      ["ablative-place"], ["ablative-agent", "ablative-place", "dative-indirect-object"],
      NOUN12, {"case": "abl"},
      [r"(?i)\b\w+(a|o|is|e|ibus|u)\s+(\w+\s+){0,2}(pulsat|pulsant|percutit|videt|vident|vehitur|vehuntur|scribit|verberat|tangit|ferit|implet|ornat|tegit|claudit|aperit|necat|occidit|vulnerat|delectat|delectatur|laudat|pascit|ligat|pugnat|pugnant)\b",
       r"(?i)\b(gladio|baculo|oculis|auribus|pedibus|manibus|manu|pila|calamo|stilo|lapide|sagitta|sagittis|hasta|verbis|voce|virga|flagello|clavibus|equo|nave|navibus|curru|plaustro|pecunia|nummis|aqua|vino|cibo|igni|ferro|auro|argento|lacrimis|lecto)\b"],
      {"case": "abl", "pos": "N"},
      ["recognise", "parse", "blank"],
      "The thing used to do something goes in the ablative with no preposition (gladio percutit = strikes with a sword); cum is only for company.")

skill("passive-voice", "Passive voice: -tur, -ntur", "the passive (the 'is done' form)", "genus passivum", "verb-form", 6, 6, [20],
      ["present-indicative-3rd"], ["present-indicative-3rd", "deponent-verbs"],
      CONJ_ALL, {"tense": "pres", "mood": "ind", "voice": "pass", "person": 3},
      [r"(?i)\b\w+(atur|etur|itur|antur|entur|untur|iuntur)\b"],
      {"tense": "pres", "mood": "ind", "voice": "pass", "person": 3, "pos": "V"},
      ["recognise", "chart", "parse", "blank"],
      "The subject has something done to it: -tur (is …-ed) and -ntur (are …-ed) replace -t and -nt; only verbs that take an object can be passive.")

skill("ablative-agent", "Ablative of agent: by a person (a/ab + ablative)", "the ablative (the 'by' form after a/ab)", "ablativus auctoris", "noun-case", 6, 6, [22],
      ["passive-voice", "ablative-origin"], ["ablative-means", "ablative-origin"],
      NOUN12, {"case": "abl"},
      [r"(?i)\b(a|ab)\s+\w+(a|o|is|e|ibus|u)\b"],
      {"case": "abl"},
      ["recognise", "parse", "blank"],
      "With a passive verb the person who does it takes a/ab + ablative (a puero ducitur); a thing used takes the plain ablative of means.")

skill("dative-indirect-object", "Dative: the indirect object", DAT, "casus dativus", "noun-case", 7, 7, [23],
      ["nominative-subject", "accusative-object"], ["ablative-means", "genitive-possession", "ablative-place"],
      NOUN12 + ["decl3"], {"case": "dat"},
      [r"(?i)\b(mihi|tibi|ei|nobis|vobis|eis|iis|cui|quibus|illi|huic|\w+(ae|o|i|is|ibus))\b(?=[^.!?]*\b(da|dat|dant|dabat|dabant|dabit|dabunt|dare|det|dent|daret|darent|dedit|dederunt|dederat|dono|donat|donavit|ostendit|ostendunt|ostendebat|ostende|dicit|dicunt|dicebat|dixit|dixerunt|dic|dicere|monstrat|monstravit|monstra|tradit|tradidit|reddit|reddidit|redde|respondet|respondit|scribit|scripsit|scribe|mittit|mittunt|misit|miserunt|mitte|narrat|narravit|narra|affert|attulit|portat|portavit|promittit|promisit|nuntiat|nuntiavit)\b)",
       r"(?i)\b(da|dat|dant|dabat|dabant|dabit|dedit|dederunt|donat|ostendit|dicit|dixit|monstrat|tradit|reddit|respondet|respondit|scribit|scripsit|mittit|misit|narrat|narravit|affert|attulit|portat|promittit|promisit)\b[^.!?]*\b(mihi|tibi|ei|nobis|vobis|eis|iis|cui|quibus|illi|huic|\w+(ae|o|i|is|ibus))\b"],
      {"case": "dat"},
      ["recognise", "chart", "parse", "blank"],
      "The person something is given, said or shown to: -ae / -o / -i singular, -is / -ibus plural; never marked by word order or a preposition.")

skill("demonstratives", "Demonstratives: hic, ille, is", "the pointing words hic ('this'), ille ('that'), is ('that / the one we mean')", "pronomina demonstrativa", "pronoun", 8, 8, [21, 24, 25],
      ["adjective-agreement", "dative-indirect-object"], ["demonstrative-pronouns", "relative-pronoun", "personal-pronouns"],
      ["hic", "ille", "is", "iste", "ipse"], None,
      [r"(?i)\b(hic|haec|hoc|huius|huic|hunc|hanc|hi|hae|horum|harum|his|hos|has|ille|illa|illud|illius|illi|illum|illam|illo|illae|illorum|illarum|illis|illos|illas|is|ea|id|eius|ei|eum|eam|eo|ii|eae|eorum|earum|eis|iis|eos|eas)\b"],
      {"pos": "PRON", "h": ["hic", "ille", "is", "iste", "ipse"]},
      ["recognise", "chart", "parse", "blank"],
      "hic = this (near), ille = that (far), is = the one already mentioned; they decline like -us -a -um adjectives except genitive -ius and dative -i.")

skill("demonstrative-pronouns", "Demonstratives standing alone (he, she, it)", "a demonstrative used as a pronoun (is = he, ea = she, id = it)", "pronomina demonstrativa substantiva", "pronoun", 8, 8, [26],
      ["demonstratives"], ["demonstratives", "personal-pronouns"],
      ["is", "hic", "ille"], None,
      [r"(?i)\b(is|ea|id|eius|ei|eum|eam|eo|ii|eae|eorum|earum|eis|iis|eos|eas|hic|haec|hoc|ille|illa|illud)\s+(est|sunt|\w+t|\w+nt)\b"],
      {"pos": "PRON", "h": ["is", "hic", "ille"]},
      ["recognise", "parse", "blank"],
      "Without a noun, hic / ille / is mean he, she, it, they; the gender follows the noun they stand for (ecce caseus! is malus est).")

skill("relative-pronoun", "Relative pronoun: qui, quae, quod", "the relative pronoun qui, quae, quod ('who, which, that')", "pronomen relativum", "pronoun", 8, 8, [27, 28],
      ["demonstratives", "accusative-object"], ["demonstratives", "indirect-question"],
      ["qui", "quis"], None,
      [r"(?i)\b(qui|quae|quod|cuius|cui|quem|quam|quo|qua|quorum|quarum|quibus|quos|quas)\b"],
      {"pos": "PRON", "h": ["qui"]},
      ["recognise", "chart", "parse", "blank"],
      "qui / quae / quod opens a clause about a noun: gender and number come from that noun, the case from the pronoun's own job in its clause.")

# ---------------------------------------------------------------------------
# Familia Romana IX–XIV · Latin 101 weeks 9–14

skill("third-declension", "3rd declension nouns (masculine and feminine)", "a 3rd-declension noun (the -is / -es pattern: pastor, pastoris)", "declinatio tertia", "noun-case", 9, 9, [29],
      ["nominative-subject", "accusative-object", "genitive-possession", "dative-indirect-object", "ablative-place"], ["third-declension-neuter", "fourth-declension", "fifth-declension"],
      ["decl3", "decl3i"], None,
      [r"(?i)\b\w+(is|em|es|i|e|um|ium|ibus)\b"],
      {"pos": "N", "gender": ["m", "f", "c"], "decl": 3},
      ["recognise", "chart", "parse", "blank"],
      "Nouns whose genitive ends in -is: the stem may change (rex, reg-is); endings -em, -is, -i, -e; plural -es, -um / -ium, -ibus.")

skill("infinitive", "Infinitive: -re and -ri", INF, "modus infinitivus", "verb-form", 10, 10, [30, 31],
      ["present-indicative-3rd", "passive-voice"], ["imperative", "accusative-infinitive", "imperfect-subjunctive"],
      CONJ_ALL + IRREG, {"mood": "inf", "tense": "pres"},
      [r"(?i)\b\w+(are|ere|ire|ari|eri|iri|i)\b", r"(?i)\b(esse|posse|velle|nolle|malle|ferre|ferri|ire)\b"],
      {"mood": "inf", "tense": "pres"},
      ["recognise", "chart", "parse", "blank"],
      "The 'to' form: active -re (ambulare, videre, ponere, audire), passive -ri / -i (videri, poni); used after vult, potest, audet, debet and the like.")

skill("accusative-infinitive", "Accusative + infinitive (indirect statement)", "the accusative + infinitive (the 'that …' clause after says / sees / thinks)", "accusativus cum infinitivo", "syntax", 10, 10, [32, 33, 36, 37],
      ["infinitive", "accusative-object"], ["infinitive", "indirect-command", "indirect-question"],
      [], None,
      [r"(?i)\b(videt|audit|dicit|putat|scit|intellegit|sentit|credit|narrat|respondet|negat|vident|dicunt|putant|sciunt|dixit|putavit|vidit|audivit|scivit)\b[^.!?]*\b\w+(are|ere|ire|ari|eri|iri|isse|urum esse|uram esse|um esse|am esse|os esse)\b"],
      {"mood": "inf"},
      ["recognise", "parse", "blank"],
      "After verbs of saying, seeing and thinking the reported subject goes into the accusative and its verb into the infinitive: videt eum aedificare = sees that he is building.")

skill("third-declension-neuter", "3rd declension neuter nouns", "a 3rd-declension neuter noun (corpus, mare: nominative = accusative, plural in -a / -ia)", "declinatio tertia, genus neutrum", "noun-case", 11, 11, [34, 35],
      ["third-declension", "noun-gender"], ["third-declension", "accusative-object"],
      ["decl3n", "decl3in"], None,
      [r"(?i)\b\w+(us|men|ur|al|ar|e|a|ia|is|i|ibus|um|ium)\b"],
      {"pos": "N", "gender": "n", "decl": 3},
      ["recognise", "chart", "parse", "blank"],
      "Neuter 3rd-declension nouns have identical nominative and accusative (caput, corpus), plural -a; nouns in -e / -al / -ar take -ia, -ium and ablative -i (mari).")

skill("fourth-declension", "4th declension nouns (-us, -us)", "a 4th-declension noun (the u-pattern: manus, manus)", "declinatio quarta", "noun-case", 12, 12, [38],
      ["third-declension"], ["third-declension", "fifth-declension", "nominative-subject"],
      ["decl4", "decl4n", "domus"], None,
      [r"(?i)\b\w+(us|um|ui|u|uum|ibus)\b"],
      {"pos": "N", "decl": 4},
      ["recognise", "chart", "parse", "blank"],
      "The u-nouns: -us, -us, -ui, -um, -u; plural -us, -uum, -ibus; mostly masculine (manus is feminine, cornu neuter); domus mixes 4th and 2nd.")

skill("dative-possession", "Dative of possession (mihi est = I have)", "the dative of possession (the 'to me there is' way of saying 'I have')", "dativus possessivus", "noun-case", 12, 12, [39],
      ["dative-indirect-object"], ["dative-indirect-object", "genitive-possession", "dative-of-agent"],
      NOUN_ALL, {"case": "dat"},
      [r"(?i)\b(mihi|tibi|ei|nobis|vobis|eis|cui|quibus|\w+(ae|o|i|is|ibus))\s+(est|sunt|erat|erant|erit|erunt|nomen)\b", r"(?i)\b(est|sunt|erat|erant|erit|erunt|nomen)\s+(mihi|tibi|ei|nobis|vobis|eis|cui|\w+(ae|o|i|is|ibus))\b"],
      {"case": "dat"},
      ["recognise", "parse", "blank"],
      "A dative with est says who has something: viro est gladius = the man has a sword; common with names (ei nomen est Marcus) and in relative clauses (cui).")

skill("comparative", "Comparative adjectives: -ior, -ius; quam", "the comparative (the '-er / more' form)", "gradus comparativus", "adjective", 12, 12, [40, 41],
      ["adjective-agreement", "third-declension"], ["superlative", "ablative-comparison", "irregular-comparison"],
      ["adjcomp"], {"degree": "comp"},
      [r"(?i)\b\w+(ior|ius|iorem|ioris|iori|iore|iores|iora|iorum|ioribus)\b", r"(?i)\b\w+(ior|ius|iorem|iores|iora)\b\s+(\w+\s+){0,3}quam\b"],
      {"pos": "ADJ", "degree": "comp"},
      ["recognise", "chart", "parse", "blank"],
      "Add -ior (neuter -ius) to the stem and decline as a 3rd-declension adjective; the thing compared follows quam (fortior quam ille).")

skill("fifth-declension", "5th declension nouns (-es, -ei)", "a 5th-declension noun (the e-pattern: dies, diei; res, rei)", "declinatio quinta", "noun-case", 13, 13, [42],
      ["third-declension", "fourth-declension"], ["third-declension", "fourth-declension"],
      ["decl5"], None,
      [r"(?i)\b(di|r|f|sp|faci|meridi|aci|speci|effigi|glaci)(es|em|ei|e|erum|ebus)\b"],
      {"pos": "N", "decl": 5},
      ["recognise", "chart", "parse", "blank"],
      "The e-nouns: -es, -ei, -ei, -em, -e; plural -es, -erum, -ebus; dies is masculine (feminine for a set date), res feminine.")

skill("ablative-time", "Ablative of time when", "the ablative (the 'at / in (a time)' form)", "ablativus temporis", "noun-case", 13, 13, [43],
      ["ablative-place"], ["ablative-place", "accusative-destination"],
      NOUN_ALL, {"case": "abl"},
      [r"(?i)\b(nocte|die|hora|anno|mense|aestate|hieme|vere|autumno|tempore|mane|vespere|meridie)\b", r"(?i)\b(illo|eo|hoc|primo|proximo|eodem|tertia|quarta|prima|secunda)\s+(die|anno|tempore|mense|vere|hora|nocte)\b"],
      {"case": "abl", "pos": "N"},
      ["recognise", "parse", "blank"],
      "When something happens takes the plain ablative: nocte at night, tertia hora at the third hour, eo tempore at that time; no preposition in Classical Latin.")

skill("superlative", "Superlative adjectives: -issimus", "the superlative (the '-est / most' form)", "gradus superlativus", "adjective", 13, 13, [44],
      ["comparative"], ["comparative", "irregular-comparison"],
      ["adj12"], {"degree": "super"},
      [r"(?i)\b\w+(issim|errim|illim)(us|a|um|i|ae|o|os|as|is|orum|arum|e)\b"],
      {"pos": "ADJ", "degree": "super"},
      ["recognise", "chart", "parse", "blank"],
      "-issimus -a -um on the stem (fortissimus); -er adjectives double the r (pulcherrimus); the group compared is genitive or ex + ablative (omnium fortissimus).")

skill("present-participle", "Present participle: -ns, -ntis", "the present participle (the '-ing' word that describes a noun)", "participium praesentis", "verb-form", 14, 14, [45, 46],
      ["present-indicative-3rd", "third-declension"], ["gerund", "perfect-passive-participle", "adjective-agreement"],
      CONJ_ALL + ["adj3"], {"mood": "ptc", "tense": "pres"},
      [r"(?i)\b\w+(ans|ens|iens|antem|entem|ientem|antis|entis|ientis|anti|enti|ante|ente|antes|entes|ientes|antia|entia|antium|entium|antibus|entibus|ientibus)\b"],
      {"mood": "ptc", "tense": "pres", "voice": "act"},
      ["recognise", "chart", "parse", "blank"],
      "Stem + -ns (genitive -ntis): an adjective made from a verb, agreeing with its noun and declined like a 3rd-declension adjective (puer dormiens, pueri dormientis).")

# ---------------------------------------------------------------------------
# Familia Romana XV–XXIV · Latin 102 weeks 1–10 (notes weeks 15–24)

skill("personal-pronouns", "Personal pronouns: ego, tu, nos, vos, se", "the personal pronouns (I, you, we, you all) and the reflexive se ('-self')", "pronomina personalia et reflexivum", "pronoun", 15, 15, [47, 48, 49],
      ["demonstrative-pronouns", "dative-indirect-object"], ["demonstrative-pronouns", "demonstratives"],
      ["ego", "tu", "se"], None,
      [r"(?i)\b(ego|mei|mihi|me|tu|tui|tibi|te|nos|nostrum|nostri|nobis|vos|vestrum|vestri|vobis|sui|sibi|se|sese|mecum|tecum|secum|nobiscum|vobiscum)\b",
       r"(?i)\b(meus|mea|meum|tuus|tua|tuum|suus|sua|suum|noster|nostra|nostrum|vester|vestra|vestrum)\w*\b"],
      {"pos": "PRON", "h": ["ego", "tu", "se", "nos", "vos"]},
      ["recognise", "chart", "parse", "blank"],
      "ego / tu / nos / vos decline in five cases (me, mihi; te, tibi); se points back to the subject and has no nominative; possession uses meus, tuus, suus, noster, vester.")

skill("active-personal-endings", "Person endings: -o, -s, -t, -mus, -tis, -nt", "the person endings (I / you / he / we / you all / they on the verb)", "desinentiae personales activae", "verb-form", 15, 15, [50, 51],
      ["present-indicative-3rd", "personal-pronouns"], ["passive-personal-endings", "present-indicative-3rd"],
      CONJ_ALL, {"tense": "pres", "mood": "ind", "voice": "act"},
      [r"(?i)\b\w+(o|as|es|is|amus|emus|imus|atis|etis|itis|ant|ent|unt|iunt)\b"],
      {"tense": "pres", "mood": "ind", "voice": "act", "pos": "V"},
      ["recognise", "chart", "parse", "blank"],
      "The ending says who acts: -o I, -s you, -t he/she, -mus we, -tis you all, -nt they; so ego, tu are used only for emphasis.")

skill("irregular-verbs-present", "Irregular verbs: sum, possum, eo, volo, nolo, malo, fero", "the irregular verbs (be, can, go, want, not want, prefer, carry) in the present", "verba anomala", "verb-form", 15, 15, [52, 53],
      ["active-personal-endings"], ["active-personal-endings", "imperfect-irregular"],
      IRREG, {"tense": "pres", "mood": "ind"},
      [r"(?i)\b(sum|es|est|sumus|estis|sunt|possum|potes|potest|possumus|potestis|possunt|eo|is|it|imus|itis|eunt|volo|vis|vult|volumus|vultis|volunt|nolo|non vis|non vult|nolumus|non vultis|nolunt|malo|mavis|mavult|malumus|mavultis|malunt|fero|fers|fert|ferimus|fertis|ferunt)\b"],
      {"tense": "pres", "mood": "ind", "voice": "act", "h": IRREG},
      ["recognise", "chart", "parse", "blank"],
      "A few common verbs change stem (sum / es, eo / i, vol / vul / vel) or drop the linking vowel (fers, fert, vult); learn them as tables.")

skill("deponent-verbs", "Deponent verbs: passive form, active meaning", "a deponent verb (passive-looking endings, active meaning: loquitur = he speaks)", "verba deponentia", "verb-form", 16, 16, [54],
      ["passive-voice", "infinitive"], ["passive-voice", "deponent-imperatives", "perfect-deponent"],
      CONJ_ALL, {"voice": "pass", "mood": "ind", "tense": "pres"},
      [r"(?i)\b(laet|intu|sequ|profic|opper|revert|obliv|pollic|loqu|arbitr|hort|mor|pat|ut|fru|fung|ver|nasc|ori|egred|ingred|regred|progred|complect|precor|quer|imit|comit|admir|mir|solat|tuor|vereor|conor|consol|confit|oper|labor|lab)\w*(or|eor|ior|aris|eris|iris|atur|etur|itur|amur|emur|imur|amini|emini|imini|antur|entur|untur|iuntur|i|ri)\b"],
      {"deponent": True, "mood": "ind"},
      ["recognise", "chart", "parse", "blank"],
      "Verbs like loquor, sequor, proficiscor have only passive-shaped forms but mean the doing, not the being done; their infinitive ends in -i / -ri.")

skill("ablative-absolute", "Ablative absolute (noun + participle)", "the ablative absolute (a noun + participle set apart in the ablative: 'with X doing')", "ablativus absolutus", "syntax", 16, 16, [55],
      ["present-participle", "ablative-place"], ["ablative-absolute-perfect", "ablative-means", "ablative-time"],
      [], None,
      [r"(?i)\b\w+(a|o|e|i|ibus|is|u)\s+\w+(ante|ente|iente|antibus|entibus|ientibus)\b", r"(?i)\b\w+(ante|ente|iente|antibus|entibus|ientibus)\s+\w+(a|o|e|i|ibus|is|u)\b"],
      {"case": "abl", "mood": "ptc", "tense": "pres"},
      ["recognise", "parse", "blank"],
      "A noun and a participle both in the ablative give the circumstances of the sentence: sole oriente = as the sun rises; nemine vidente = with nobody watching.")

skill("ablative-degree", "Ablative of degree of difference (multo, paulo)", "the ablative of degree (the 'by how much' form: multo maior = bigger by much)", "ablativus mensurae", "noun-case", 16, 16, [56],
      ["comparative", "ablative-means"], ["ablative-comparison", "ablative-means"],
      [], None,
      [r"(?i)\b(multo|paulo|tanto|quanto|nihilo|aliquanto|\w+\s+pedibus|\w+\s+annis|\w+\s+passibus)\s+(\w+\s+){0,2}\w+(ior|ius|iorem|iores|iora|iore|ante|post|minus|magis|plus|melius|peius|maior|minor)\b"],
      {"case": "abl"},
      ["recognise", "parse", "blank"],
      "How much bigger or smaller: multo fortior = braver by much, decem pedibus altior = ten feet higher; the measure sits in the ablative next to the comparative.")

skill("passive-personal-endings", "Passive person endings: -or, -ris, -tur, -mur, -mini, -ntur", "the passive person endings (I am …-ed, you are …-ed …)", "desinentiae personales passivae", "verb-form", 17, 17, [57, 58],
      ["active-personal-endings", "passive-voice", "deponent-verbs"], ["active-personal-endings", "passive-voice"],
      CONJ_ALL, {"tense": "pres", "mood": "ind", "voice": "pass"},
      [r"(?i)\b\w+(or|aris|eris|iris|atur|etur|itur|amur|emur|imur|amini|emini|imini|antur|entur|untur|iuntur)\b"],
      {"tense": "pres", "mood": "ind", "voice": "pass", "pos": "V"},
      ["recognise", "chart", "parse", "blank"],
      "-or, -ris, -tur, -mur, -mini, -ntur match -o, -s, -t, -mus, -tis, -nt; the same set serves deponent verbs (sequor, sequeris, sequitur).")

skill("adverbs", "Adverbs: -e, -iter, and their comparison", "an adverb (the '-ly' word: how something is done) and its -ius / -issime forms", "adverbia", "adjective", 18, 18, [59, 60],
      ["adjective-agreement", "comparative", "superlative"], ["adjective-agreement", "comparative"],
      [], None,
      [r"(?i)\b\w+(e|iter|ius|issime|errime|enter|anter)\b"],
      {"pos": "ADV"},
      ["recognise", "parse", "blank"],
      "-us -a -um adjectives make adverbs in -e (pulchre), 3rd-declension ones in -iter (fortiter); comparative -ius (fortius), superlative -issime (fortissime).")

skill("imperfect-active", "Imperfect active: -bam, -bas, -bat", IMPF, "imperfectum indicativi activi", "verb-form", 19, 19, [64, 65],
      ["active-personal-endings"], ["perfect-active", "future-active", "pluperfect"],
      CONJ_ALL, {"tense": "impf", "mood": "ind", "voice": "act"},
      [r"(?i)\b\w+(abam|abas|abat|abamus|abatis|abant|ebam|ebas|ebat|ebamus|ebatis|ebant|iebam|iebas|iebat|iebamus|iebatis|iebant)\b"],
      {"tense": "impf", "mood": "ind", "voice": "act"},
      ["recognise", "chart", "parse", "blank"],
      "Ongoing or repeated past action, and the setting of a story: stem + -ba- + person endings (ambulabat = was walking, used to walk); 3rd conj. adds -e- (ponebat).")

skill("imperfect-passive", "Imperfect passive and deponent: -batur, -bantur", "the imperfect passive (the 'was being done' form)", "imperfectum indicativi passivi", "verb-form", 19, 19, [66],
      ["imperfect-active", "passive-personal-endings"], ["imperfect-active", "perfect-passive", "pluperfect"],
      CONJ_ALL, {"tense": "impf", "mood": "ind", "voice": "pass"},
      [r"(?i)\b\w+(abar|abaris|abatur|abamur|abamini|abantur|ebar|ebaris|ebatur|ebamur|ebamini|ebantur|iebar|iebatur|iebantur)\b"],
      {"tense": "impf", "mood": "ind", "voice": "pass"},
      ["recognise", "chart", "parse", "blank"],
      "Same -ba- marker with the passive endings: pulsabatur = was being hit; for deponents the meaning is active (sequebatur = was following).")

skill("imperfect-irregular", "Imperfect of sum, possum, eo: eram, poteram, ibam", "the imperfect of the irregular verbs (eram = I was, poteram = I could, ibam = I was going)", "imperfectum verborum anomalorum", "verb-form", 19, 19, [67],
      ["imperfect-active", "irregular-verbs-present"], ["irregular-verbs-present", "future-irregular", "pluperfect"],
      IRREG, {"tense": "impf", "mood": "ind"},
      [r"(?i)\b(eram|eras|erat|eramus|eratis|erant|poteram|poteras|poterat|poteramus|poteratis|poterant|ibam|ibas|ibat|ibamus|ibatis|ibant|volebam|volebat|volebant|nolebat|malebat|ferebat|ferebant|aberat|aberant|aderat|aderant)\b"],
      {"tense": "impf", "mood": "ind", "h": IRREG},
      ["recognise", "chart", "parse", "blank"],
      "sum uses the stem era- (eram, eras, erat …), possum adds pot- (poteram), eo uses i- + -ba- (ibam); volo, fero and the rest are regular (volebat, ferebat).")

skill("irregular-comparison", "Irregular comparison: bonus, melior, optimus", "the irregular comparatives and superlatives (better / best, worse / worst, bigger / biggest)", "comparatio anomala", "adjective", 19, 19, [68],
      ["comparative", "superlative"], ["comparative", "superlative"],
      ["adjcomp", "adj12"], {"degree": ["comp", "super"]},
      [r"(?i)\b(melior|melius|optim|peior|peius|pessim|maior|maius|maxim|minor|minus|minim|plus|plur|plurim|prior|prim|superior|suprem|summ|inferior|infim)\w*\b"],
      {"pos": "ADJ", "degree": ["comp", "super"], "h": ["bonus", "malus", "magnus", "parvus", "multus", "superus", "inferus"]},
      ["recognise", "chart", "parse", "blank"],
      "bonus / melior / optimus, malus / peior / pessimus, magnus / maior / maximus, parvus / minor / minimus, multi / plures / plurimi: new stems, regular endings.")

skill("future-active", "Future active: -bo / -am, -es, -et", FUT, "futurum indicativi activi", "verb-form", 20, 20, [69, 70],
      ["active-personal-endings", "imperfect-active"], ["present-subjunctive", "imperfect-active", "future-perfect"],
      CONJ_ALL, {"tense": "fut", "mood": "ind", "voice": "act"},
      [r"(?i)\b\w+(abo|abis|abit|abimus|abitis|abunt|ebo|ebis|ebit|ebimus|ebitis|ebunt)\b", r"(?i)\b\w+(am|es|et|emus|etis|ent|iam|ies|iet|iemus|ietis|ient)\b"],
      {"tense": "fut", "mood": "ind", "voice": "act"},
      ["recognise", "chart", "parse", "blank"],
      "1st and 2nd conjugations add -b- (ambulabo, ambulabis, ambulabit); 3rd and 4th use -a- in the 'I' form and -e- elsewhere (ponam, pones, ponet).")

skill("future-passive", "Future passive and deponent: -bitur, -etur", "the future passive (the 'will be done' form)", "futurum indicativi passivi", "verb-form", 20, 20, [71, 72],
      ["future-active", "passive-personal-endings"], ["future-active", "present-subjunctive", "imperfect-passive"],
      CONJ_ALL, {"tense": "fut", "mood": "ind", "voice": "pass"},
      [r"(?i)\b\w+(abor|aberis|abitur|abimur|abimini|abuntur|ebor|eberis|ebitur|ebimur|ebimini|ebuntur)\b", r"(?i)\b\w+(ar|eris|etur|emur|emini|entur|iar|ieris|ietur|iemur|iemini|ientur)\b"],
      {"tense": "fut", "mood": "ind", "voice": "pass"},
      ["recognise", "chart", "parse", "blank"],
      "The same future markers with passive endings: pulsabitur = will be hit, ponetur = will be put; deponents mean actively (sequetur = will follow).")

skill("noli-infinitive", "Negative commands: noli / nolite + infinitive", "noli / nolite + infinitive (the polite 'don't …')", "prohibitio: noli cum infinitivo", "verb-use", 20, 20, [73],
      ["imperative", "infinitive", "irregular-verbs-present"], ["imperative", "perfect-subjunctive"],
      ["nolo"], {"mood": "imper"},
      [r"(?i)\b(noli|nolite)\s+(\w+\s+){0,3}\w+(are|ere|ire|ari|eri|iri|i|esse|ferre|ire)\b"],
      {"mood": "imper", "h": ["nolo"]},
      ["recognise", "parse", "blank"],
      "'Do not …' is noli (to one person) or nolite (to several) plus the infinitive: noli venire!, nolite timere!; ne + imperative is rare.")

skill("future-irregular", "Future of sum, possum, eo: ero, potero, ibo", "the future of the irregular verbs (ero = I will be, potero = I will be able, ibo = I will go)", "futurum verborum anomalorum", "verb-form", 20, 20, [74],
      ["future-active", "irregular-verbs-present"], ["imperfect-irregular", "future-perfect", "present-subjunctive"],
      IRREG, {"tense": "fut", "mood": "ind"},
      [r"(?i)\b(ero|eris|erit|erimus|eritis|erunt|potero|poteris|poterit|poterimus|poteritis|poterunt|ibo|ibis|ibit|ibimus|ibitis|ibunt|volam|voles|volet|volent|nolet|malet|feram|feres|feret|ferent|aberit|aderit|aberunt|aderunt)\b"],
      {"tense": "fut", "mood": "ind", "h": IRREG},
      ["recognise", "chart", "parse", "blank"],
      "sum uses er- (ero, eris, erit, erunt), possum adds pot- (potero), eo takes -b- (ibo, ibis, ibit); volo and fero go like 3rd-conjugation verbs (volet, feret).")

skill("principal-parts", "Principal parts and the three verb stems", "the principal parts (the four dictionary forms that give a verb's present, perfect and participle stems)", "partes principales verbi", "vocabulary", 21, 21, [75, 76, 77],
      ["active-personal-endings", "infinitive"], ["perfect-active", "perfect-passive-participle"],
      CONJ_ALL, None,
      [r"(?i)\b\w+(avi|avit|averunt|ui|uit|uerunt|ivi|ivit|iverunt|si|sit|serunt|xi|xit|xerunt|atum|itum|tum|sum)\b"],
      {"pos": "V"},
      ["recognise", "blank"],
      "ago, agere, egi, actum: the infinitive gives the present stem, the third part the perfect stem (eg-), the fourth the participle stem (act-); 1st, 2nd and 4th conjugations are predictable.")

skill("perfect-active", "Perfect active: -i, -isti, -it, -erunt", PERF, "perfectum indicativi activi", "verb-form", 21, 21, [78, 79],
      ["principal-parts", "imperfect-active"], ["imperfect-active", "pluperfect", "future-perfect", "perfect-subjunctive"],
      CONJ_ALL + ["sum", "eo", "fero"], {"tense": "perf", "mood": "ind", "voice": "act"},
      [r"(?i)\b\w+(avi|avisti|avit|avimus|avistis|averunt|ivi|ivit|iverunt|ui|uisti|uit|uimus|uistis|uerunt|si|sisti|sit|simus|sistis|serunt|xi|xisti|xit|ximus|xistis|xerunt|isti|istis|erunt|ere)\b", r"(?i)\b(fui|fuit|fuerunt|ii|iit|ierunt|tuli|tulit|tulerunt|dedit|dederunt|venit|venerunt|fecit|fecerunt|dixit|dixerunt|vidit|viderunt)\b"],
      {"tense": "perf", "mood": "ind", "voice": "act"},
      ["recognise", "chart", "parse", "blank"],
      "Completed action or plain past ('did', 'has done'): the perfect stem + -i, -isti, -it, -imus, -istis, -erunt (venit = he came / has come; venerunt = they came).")

skill("perfect-passive-participle", "Perfect passive participle: -tus, -sus", "the perfect participle (the 'having been done' word: laudatus = praised)", "participium perfecti passivi", "verb-form", 21, 21, [80, 81],
      ["principal-parts", "present-participle", "adjective-agreement"], ["present-participle", "perfect-passive", "future-participle", "gerundive"],
      ["adj12"], None,
      [r"(?i)\b\w+(atus|ata|atum|ati|atae|atos|atas|ato|atis|itus|ita|itum|iti|itae|itos|ito|itis|tus|ta|tum|ti|tae|tos|tas|to|tis|sus|sa|sum|si|sae|sos|sas|so|sis)\b"],
      {"mood": "ptc", "tense": "perf", "voice": "pass"},
      ["recognise", "chart", "parse", "blank"],
      "The fourth principal part as an -us -a -um adjective: puer laudatus = the boy (having been) praised; it agrees with its noun like any adjective.")

skill("perfect-passive", "Perfect passive: laudatus est", "the perfect passive (the 'was done / has been done' form: laudatus est)", "perfectum indicativi passivi", "verb-form", 21, 21, [82],
      ["perfect-passive-participle", "perfect-active"], ["perfect-active", "pluperfect", "perfect-deponent", "passive-periphrastic"],
      CONJ_ALL, {"tense": "perf", "mood": "ind", "voice": "pass"},
      [r"(?i)\b\w+(tus|ta|tum|ti|tae|ta|sus|sa|sum|si|sae|sa)\s+(sum|es|est|sumus|estis|sunt)\b", r"(?i)\b(sum|es|est|sumus|estis|sunt)\s+\w+(tus|ta|tum|ti|tae|sus|sa|sum|si|sae)\b"],
      {"mood": "ptc", "tense": "perf", "voice": "pass"},
      ["recognise", "chart", "parse", "blank"],
      "Perfect participle + present of sum: visus est = he was seen / has been seen; the participle agrees with the subject (visi sunt), and est translates as 'was'.")

skill("perfect-infinitive", "Perfect infinitive: -isse, -um esse", "the perfect infinitive (the 'to have done' form)", "infinitivus perfecti", "verb-form", 21, 21, [83],
      ["perfect-active", "accusative-infinitive"], ["infinitive", "future-infinitive", "pluperfect-subjunctive"],
      CONJ_ALL, {"mood": "inf", "tense": "perf"},
      [r"(?i)\b\w+isse\b", r"(?i)\b\w+(tum|tam|tos|tas|sum|sam|sos|sas|tus|sus)\s+esse\b"],
      {"mood": "inf", "tense": "perf"},
      ["recognise", "chart", "parse", "blank"],
      "Active: perfect stem + -isse (fecisse = to have done); passive: participle + esse (factum esse); used in indirect statement for an earlier action (scit eum venisse).")

skill("supine", "Supine: -um after motion, -u with adjectives", "the supine (the special purpose form after a verb of going: dormitum it = goes to sleep)", "supinum", "verb-form", 22, 22, [84],
      ["principal-parts", "accusative-destination"], ["perfect-passive-participle", "gerund", "purpose-clause"],
      CONJ_ALL, {"mood": "supine"},
      [r"(?i)\b(it|eunt|eo|ibat|ibant|ire|ivit|iit|ierunt|venit|veniunt|venerunt|venire|mittit|misit|abit|exit|redit|ducit|proficiscitur|profectus|currit|cucurrit)\s+(\w+\s+){0,2}\w+(tum|sum)\b",
       r"(?i)\b\w+(tum|sum)\s+(it|eunt|ire|venit|veniunt|venerunt|ibat|ibant|abiit|exiit)\b",
       r"(?i)\b(facile|difficile|mirabile|incredibile|horribile|iucundum|optimum|turpe|dignum|utile|fas|nefas)\s+\w+(tu|su)\b"],
      {"mood": "supine"},
      ["recognise", "chart", "parse", "blank"],
      "The participle stem + -um after a verb of motion says why one goes (venatum eo = I go to hunt); the -u form completes an adjective (facile dictu = easy to say).")

skill("ablative-absolute-perfect", "Ablative absolute with a perfect participle", "the ablative absolute with a perfect participle ('with X done', 'after X was done')", "ablativus absolutus cum participio perfecti", "syntax", 22, 22, [85],
      ["ablative-absolute", "perfect-passive-participle"], ["ablative-absolute", "perfect-passive", "cum-narrative"],
      [], None,
      [r"(?i)\b\w+(a|o|is|ibus|e|i|u)\s+\w+(ato|ata|atis|ito|ita|itis|to|ta|tis|so|sa|sis)\b", r"(?i)\b\w+(ato|ata|atis|ito|ita|itis|to|ta|tis|so|sa|sis)\s+\w+(a|o|is|ibus|e|i|u)\b", r"(?i)\b(hoc|quo|his|quibus)\s+(dicto|facto|dictis|factis|audito|viso|auditis|visis)\b"],
      {"case": "abl", "mood": "ptc", "tense": "perf"},
      ["recognise", "parse", "blank"],
      "Noun + perfect participle in the ablative for something already done when the main action happens: hoc dicto = this said; cibo parato = the food prepared.")

skill("perfect-deponent-participle", "Perfect participle of deponents: 'having done'", "the perfect participle of a deponent verb (active meaning: locutus = having spoken)", "participium perfecti verbi deponentis", "verb-form", 22, 22, [86],
      ["deponent-verbs", "perfect-passive-participle"], ["perfect-passive-participle", "present-participle"],
      ["adj12"], None,
      [r"(?i)\b(locut|secut|profect|arbitrat|hortat|mortu|pass|nat|ort|egress|ingress|regress|progress|laps|complex|precat|quest|imitat|comitat|admirat|mirat|consolat|verit|conat|operat|laetat|intuit|revers|oblit|pollicit|opert|adept|expert)(us|a|um|i|ae|os|as|o|is|orum|arum)\b"],
      {"mood": "ptc", "tense": "perf", "deponent": True},
      ["recognise", "parse", "blank"],
      "Deponents form the perfect participle like other verbs but it means 'having done', not 'having been done': puer lapsus = the boy having slipped; femina profecta = the woman having set out.")

skill("perfect-deponent", "Perfect of deponents: locutus est", "the perfect of a deponent verb (locutus est = he spoke)", "perfectum verbi deponentis", "verb-form", 22, 22, [87],
      ["perfect-deponent-participle", "perfect-passive"], ["perfect-passive", "deponent-verbs", "pluperfect"],
      CONJ_ALL, {"tense": "perf", "mood": "ind", "voice": "pass"},
      [r"(?i)\b(locut|secut|profect|arbitrat|hortat|mortu|pass|nat|ort|egress|ingress|regress|progress|laps|complex|precat|quest|imitat|comitat|admirat|mirat|consolat|verit|conat|operat|laetat|intuit|revers|oblit|pollicit|opert|adept|expert)(us|a|um|i|ae|a)\s+(sum|es|est|sumus|estis|sunt)\b"],
      {"mood": "ptc", "tense": "perf", "deponent": True},
      ["recognise", "chart", "parse", "blank"],
      "Participle + sum, translated actively: secutus est = he followed, profecti sunt = they set out; it looks like a perfect passive and never is.")

skill("future-participle", "Future participle: -urus, 'about to'", "the future participle (the 'about to' word: venturus = about to come)", "participium futuri activi", "verb-form", 23, 23, [88],
      ["perfect-passive-participle", "principal-parts"], ["perfect-passive-participle", "gerundive", "future-infinitive"],
      ["adj12"], {"mood": "ptc", "tense": "fut"},
      [r"(?i)\b\w+ur(us|a|um|i|ae|os|as|o|is|orum|arum)\b"],
      {"mood": "ptc", "tense": "fut", "voice": "act"},
      ["recognise", "chart", "parse", "blank"],
      "Participle stem + -ur- + -us -a -um: puer ambulaturus = a boy about to walk, milites morituri = soldiers about to die; futurus = about to be.")

skill("future-infinitive", "Future infinitive: -urum esse", "the future infinitive (the 'going to' form: venturum esse)", "infinitivus futuri", "verb-form", 23, 23, [89],
      ["future-participle", "accusative-infinitive"], ["perfect-infinitive", "infinitive", "future-participle"],
      CONJ_ALL, {"mood": "inf", "tense": "fut"},
      [r"(?i)\b\w+ur(um|am|os|as|a)\s+esse\b", r"(?i)\b(fore|futurum esse|futuram esse|futuros esse)\b", r"(?i)\b\w+(tum|sum)\s+iri\b"],
      {"mood": "inf", "tense": "fut"},
      ["recognise", "chart", "parse", "blank"],
      "Future participle + esse (often left out) in indirect statement for what will happen: dicit se venturum esse = says that he will come; sum has fore or futurum esse.")

skill("pluperfect", "Pluperfect: -eram, -erat; -us erat", PLUPF, "plusquamperfectum indicativi", "verb-form", 24, 24, [90, 91],
      ["perfect-active", "perfect-passive", "imperfect-irregular"], ["perfect-active", "imperfect-active", "future-perfect", "pluperfect-subjunctive"],
      CONJ_ALL + ["sum", "eo", "fero"], {"tense": "plupf", "mood": "ind"},
      [r"(?i)\b\w+(eram|eras|erat|eramus|eratis|erant)\b", r"(?i)\b\w+(tus|ta|tum|ti|tae|sus|sa|sum|si|sae)\s+(eram|eras|erat|eramus|eratis|erant)\b"],
      {"tense": "plupf", "mood": "ind"},
      ["recognise", "chart", "parse", "blank"],
      "Something finished before another past event: perfect stem + -era- + endings (venerat = he had come); passive and deponent use the participle + erat (captus erat, profecti erant).")

skill("ablative-comparison", "Ablative of comparison (than, without quam)", "the ablative of comparison (the 'than' form: illo fortior = braver than he)", "ablativus comparationis", "noun-case", 24, 24, [92],
      ["comparative", "ablative-means"], ["ablative-degree", "ablative-means", "comparative"],
      NOUN_ALL, {"case": "abl"},
      [r"(?i)\b\w+(a|o|e|i|u|is|ibus)\s+(\w+\s+){0,2}\w+(ior|ius|iorem|iores|iora|iore|melior|melius|peior|peius|maior|maius|minor|minus|plus)\b", r"(?i)\b(nihil|nemo|quid)\s+(hoc|eo|illo|te|me)\s+\w+(ius|ior)\b"],
      {"case": "abl"},
      ["recognise", "parse", "blank"],
      "Instead of quam + the same case, the thing compared can stand alone in the ablative: hic illo fortior est = this one is braver than that one; nihil hoc peius = nothing worse than this.")

# ---------------------------------------------------------------------------
# Familia Romana XXV–XXXIV · Latin 103 weeks 1–14

skill("deponent-imperatives", "Deponent imperatives: -re, -mini", "the deponent command forms (sequere! = follow!, sequimini! = follow, all of you!)", "imperativus verborum deponentium", "verb-form", 25, 25, [93],
      ["deponent-verbs", "imperative", "infinitive"], ["imperative", "infinitive", "deponent-verbs"],
      CONJ_ALL, {"mood": "imper", "voice": "pass"},
      [r"(?i)\b\w+mini\b", r"(?i)\b(sequere|opperire|revertere|obliviscere|proficiscere|loquere|intuere|laetare|conare|consolare|confitere|verere|patere|utere|hortare|mirare|complectere|egredere|ingredere|morere|nascere|arbitrare|precare|imitare|partire|operare)\b"],
      {"mood": "imper", "voice": "pass", "deponent": True},
      ["recognise", "chart", "parse", "blank"],
      "To one person the deponent imperative looks like an active infinitive (sequere!, intuere!); to several it ends in -mini (sequimini!, laetamini!).", syl=1)

skill("gerund", "Gerund: the verb as a noun (-ndum, -ndi, -ndo)", "the gerund (the '-ing' noun form: ad bibendum = for drinking)", "gerundium", "verb-form", 26, 26, [94, 95],
      ["infinitive", "accusative-destination", "ablative-means", "genitive-of"], ["gerundive", "present-participle", "supine", "purpose-clause"],
      CONJ_ALL, {"mood": "gerund"},
      [r"(?i)\bad\s+\w+ndum\b", r"(?i)\b\w+nd(i|o)\b", r"(?i)\b\w+ndi\s+(causa|gratia)\b", r"(?i)\b(in|de|ab|ex|a|e|cum|pro)\s+\w+ndo\b",
       r"(?i)\b(ars|artem|artis|arte|cupidus|cupida|studiosus|tempus|locus|facultas|occasio|finis|modus|spes|causa|consilium)\s+\w+ndi\b"],
      {"mood": "gerund"},
      ["recognise", "chart", "parse", "blank"],
      "Stem + -nd- with neuter endings: ad + -ndum for purpose (ad nandum), -ndi after a noun or with causa (ars scribendi), -ndo for means or after in / de (in ambulando).", syl=2)

skill("present-subjunctive", "Present subjunctive: forms (-em, -am; sim, possim, velim)", "the present subjunctive (the 'may / let' form: veniat = let him come, may he come)", "coniunctivus praesentis", "verb-form", 27, 27, [96, 99, 100],
      ["active-personal-endings", "passive-personal-endings", "irregular-verbs-present", "future-active"], ["future-active", "future-passive", "imperfect-subjunctive", "active-personal-endings"],
      CONJ_ALL + IRREG + ["fio"], {"tense": "pres", "mood": "subj"},
      [r"(?i)\b\w+(em|es|et|emus|etis|ent|er|eris|etur|emur|emini|entur)\b", r"(?i)\b\w+(am|as|at|amus|atis|ant|ar|aris|atur|amur|amini|antur|iam|ias|iat|iamus|iatis|iant|iar|iatur|iantur)\b",
       r"(?i)\b(sim|sis|sit|simus|sitis|sint|possim|possis|possit|possimus|possitis|possint|velim|velis|velit|velimus|velitis|velint|nolim|nolis|nolit|nolint|malim|malis|malit|malint|eam|eas|eat|eamus|eatis|eant|feram|feras|ferat|feramus|feratis|ferant|fiam|fias|fiat|fiant)\b"],
      {"tense": "pres", "mood": "subj"},
      ["recognise", "chart", "parse", "blank"],
      "Change the stem vowel: 1st conjugation a → e (ambulet), the others add -a- (videat, ponat, audiat); sum, possum, volo take -i- (sit, possit, velit), eo has eat.", syl=3)

skill("subjunctive-wish-command", "Subjunctive on its own: wishes, 'let us', 'let him'", "the subjunctive as a wish or gentle command (eamus = let's go; veniat = let him come)", "coniunctivus optativus, hortativus, iussivus", "verb-use", 27, 27, [96, 97],
      ["present-subjunctive"], ["imperative", "potential-subjunctive", "wishes-utinam", "indirect-command"],
      CONJ_ALL + IRREG, {"tense": "pres", "mood": "subj"},
      [r"(?i)^(?:(?!\b(ut|ne|cum|si|quod|quia|quin|quo)\b)[^.!?])*\b\w+(em|es|et|emus|etis|ent|am|as|at|amus|atis|ant|iam|iat|iant|etur|entur|atur|antur|sim|sit|sint|simus|possim|possit|velim|velit|eam|eamus|eat|eant)\b[^.!?]*!", r"(?i)\b(ne)\s+(\w+\s+){0,2}\w+(et|at|ent|ant|iat|iant|emus|amus)\b"],
      {"tense": "pres", "mood": "subj"},
      ["recognise", "parse", "blank"],
      "In a main clause the present subjunctive expresses what the speaker wants: a wish (dei te servent), a suggestion (discedamus, let us leave), an order to a third person (veniant); negative ne.", syl=3)

skill("potential-subjunctive", "Potential subjunctive: 'could', 'would'", "the potential subjunctive (the 'could / would / may' form: velim = I would like)", "coniunctivus potentialis", "verb-use", 27, 27, [98, 100],
      ["present-subjunctive"], ["subjunctive-wish-command", "future-active", "conditions-contrary-to-fact"],
      ["volo", "nolo", "malo", "possum"], {"tense": "pres", "mood": "subj"},
      [r"(?i)\b(velim|velis|velit|nolim|nolit|malim|malit|possim|possis|possit|dicat|dixerit|fortasse|fortassis|forsitan)\b", r"(?i)\b(aliquis|quis|nemo)\s+(\w+\s+){0,2}\w+(et|at|iat|erit)\b"],
      {"tense": "pres", "mood": "subj", "h": ["volo", "nolo", "malo", "possum", "dico", "credo", "puto"]},
      ["recognise", "parse", "blank"],
      "The subjunctive can soften a statement to a possibility: te adiuvem = I could help you; aliquis dicat = someone might say; velim, nolim, malim = I would like / rather not / prefer.", syl=4)

skill("indirect-command", "Indirect command: ut / ne + subjunctive", "ut / ne + subjunctive (the form for what someone asks or orders someone to do)", "coniunctivus substantivus: ut, ne", "syntax", 27, 27, [101, 102],
      ["present-subjunctive", "accusative-infinitive"], ["purpose-clause", "result-clause", "accusative-infinitive", "indirect-question"],
      [], None,
      [r"(?i)\b(imper|ora|rog|mone|hort|persuade|cur|cav|pet|postul|iube|licet|oportet|necesse|vol|nol|mal|praecip|fac|effic|accid|fit|mos est|opta|cupi|precor)\w*\b[^.!?]*\b(ut|ne)\b[^.!?]*\b\w+(em|es|et|emus|etis|ent|am|as|at|amus|atis|ant|iat|iant|etur|entur|atur|antur|ret|rent|retur|rentur|sit|sint|esset|essent|possit|velit)\b"],
      {"mood": "subj", "tense": ["pres", "impf"]},
      ["recognise", "parse", "blank"],
      "After verbs of ordering, asking, persuading and wishing (imperat, orat, rogat, monet, vult) the thing wanted goes in ut / ne + subjunctive: imperat ut veniant; orat ne discedat. iubeo instead takes the infinitive.", syl=4)

skill("purpose-clause", "Purpose clause: ut / ne + subjunctive ('in order to')", "ut / ne + subjunctive (the 'in order to' clause: venit ut videat = comes to see)", "coniunctivus finalis", "syntax", 28, 28, [103],
      ["present-subjunctive", "indirect-command"], ["indirect-command", "result-clause", "gerund", "supine", "relative-pronoun"],
      [], None,
      [r"(?i)\b(ut|ne|quo)\b[^.!?]*\b\w+(em|es|et|emus|etis|ent|am|as|at|amus|atis|ant|iat|iant|etur|entur|atur|antur|ret|rent|retur|rentur|sit|sint|esset|essent|possit|posset)\b",
       r"(?i)\b(qui|quae|quod|quo|qua|quibus|quem|cui)\s+(\w+\s+){0,3}\w+(et|at|iat|ent|ant|iant|ret|rent|retur|rentur|etur|atur|antur|entur)\b"],
      {"mood": "subj", "tense": ["pres", "impf"]},
      ["recognise", "parse", "blank"],
      "ut + subjunctive says why something is done (veniunt ut cenent = they come in order to dine), ne for a negative aim; a relative qui + subjunctive can do the same job (mittit qui dicat).", syl=5)

skill("result-clause", "Result clause: tam / ita … ut ('so … that')", "ut + subjunctive after tam / ita / tantus (the 'so … that' clause)", "coniunctivus consecutivus", "syntax", 28, 28, [104],
      ["present-subjunctive", "purpose-clause"], ["purpose-clause", "indirect-command"],
      [], None,
      [r"(?i)\b(tam|tantus|tanta|tantum|tanti|tantae|tantos|tantas|ita|sic|adeo|tot|talis|tale|tales|talem|tantopere|eo|usque)\b[^.!?]*\b(ut|ut non)\b[^.!?]*\b\w+(em|es|et|emus|etis|ent|am|as|at|amus|atis|ant|iat|iant|etur|entur|atur|antur|ret|rent|retur|rentur|sit|sint|esset|essent|possit|posset)\b",
       r"(?i)\but\s+non\b"],
      {"mood": "subj", "tense": ["pres", "impf"]},
      ["recognise", "parse", "blank"],
      "A signal word (tam so, tantus so big, talis of such a kind, ita in such a way, tot so many) is answered by ut + subjunctive telling what follows; the negative is ut non, never ne.", syl=5)

skill("imperfect-subjunctive", "Imperfect subjunctive: forms (infinitive + endings)", "the imperfect subjunctive (the past-time 'might / would' form: veniret; built on the infinitive)", "coniunctivus imperfecti", "verb-form", 28, 28, [105, 107],
      ["present-subjunctive", "infinitive", "imperfect-active"], ["present-subjunctive", "infinitive", "pluperfect-subjunctive", "imperfect-active"],
      CONJ_ALL + IRREG + ["fio"], {"tense": "impf", "mood": "subj"},
      [r"(?i)\b\w+(arem|ares|aret|aremus|aretis|arent|erem|eres|eret|eremus|eretis|erent|irem|ires|iret|iremus|iretis|irent)\b", r"(?i)\b\w+(arer|areris|aretur|aremur|aremini|arentur|erer|ereris|eretur|eremur|eremini|erentur|irer|iretur|irentur)\b",
       r"(?i)\b(essem|esses|esset|essemus|essetis|essent|possem|posses|posset|possemus|possetis|possent|vellem|velles|vellet|vellemus|vellent|nollem|nollet|nollent|mallem|mallet|irem|ires|iret|iremus|irent|ferrem|ferres|ferret|ferrent|fierem|fieret|fierent)\b"],
      {"tense": "impf", "mood": "subj"},
      ["recognise", "chart", "parse", "blank"],
      "The present active infinitive plus person endings: ambulare-t, videre-t, ponere-t, audire-t; passive ponere-tur; irregulars the same way (esse-t, posse-t, velle-t, ferre-t).", syl=5)

skill("sequence-of-tenses", "Sequence of tenses: present vs imperfect subjunctive", "the sequence of tenses (a present main verb takes the present subjunctive, a past one the imperfect)", "consecutio temporum", "verb-use", 28, 28, [105, 106],
      ["imperfect-subjunctive", "indirect-command", "purpose-clause", "result-clause"], ["present-subjunctive", "imperfect-subjunctive", "perfect-subjunctive"],
      CONJ_ALL, {"mood": "subj", "tense": ["pres", "impf"]},
      [r"(?i)\b(\w+(avit|uit|ivit|it|erunt|abat|ebat|iebat|abant|ebant|erat|erant|us est|a est|i sunt))\b[^.!?]*\b(ut|ne|cum|quid|quis|cur|ubi|quo|quomodo|num)\b[^.!?]*\b\w+(ret|rent|retur|rentur|rem|res|remus|retis|esset|essent|posset|possent|vellet)\b",
       r"(?i)\b(\w+(at|et|it|ant|ent|unt|iunt|abit|ebit|abunt|ebunt))\b[^.!?]*\b(ut|ne|cum|quid|quis|cur|ubi|quo|quomodo|num)\b[^.!?]*\b\w+(et|at|iat|ent|ant|iant|etur|atur|entur|antur|sit|sint|possit)\b"],
      {"mood": "subj", "tense": ["pres", "impf"]},
      ["recognise", "parse", "blank"],
      "Look at the main verb: present or future → present subjunctive (imperat ut venias); any past tense → imperfect subjunctive (imperavit ut venires). The same holds for purpose, result, cum and indirect questions.", syl=6)

skill("cum-narrative", "cum + subjunctive: 'when / while' in a story", "cum + subjunctive (the 'when / while' clause that sets the scene in a past story)", "cum historicum", "syntax", 28, 28, [108],
      ["imperfect-subjunctive", "ablative-absolute"], ["cum-causal", "ablative-place", "ablative-absolute-perfect", "future-perfect"],
      [], None,
      [r"(?i)\bcum\b[^.!?]*\b\w+(ret|rent|retur|rentur|isset|issent|esset|essent|posset|possent|vellet|ferret|iret|irent)\b"],
      {"mood": "subj", "tense": ["impf", "plupf"]},
      ["recognise", "parse", "blank"],
      "In past narrative cum + imperfect subjunctive = 'while / as' (cum ambularet, latrones vidit), cum + pluperfect = 'after / when he had' (cum dixisset, abiit); cum + ablative is 'with', cum + indicative a plain date.", syl=6)

skill("cum-causal", "cum + subjunctive: 'since', 'although'", "cum + subjunctive meaning 'since' (or, with tamen, 'although')", "cum causale et concessivum", "syntax", 29, 29, [109],
      ["cum-narrative", "present-subjunctive"], ["cum-narrative", "ablative-place", "result-clause"],
      [], None,
      [r"(?i)\bcum\b[^.!?]*\b\w+(et|at|iat|ent|ant|iant|sit|sint|possit|ret|rent|retur|rentur|erit|erint|isset|issent|esset|essent)\b", r"(?i)\b(quippe|utpote)\s+(qui|quae|quod|cui|quem|quibus)\b", r"(?i)\bcum\b[^.!?]*\btamen\b"],
      {"mood": "subj"},
      ["recognise", "parse", "blank"],
      "cum + subjunctive can give the reason (ploro cum mortua sit = I weep since she is dead) or, with tamen in the main clause, a concession (cum dives sit, tamen …); quippe qui + subjunctive = 'as one who'.", syl=7)

skill("indirect-question", "Indirect question: quis / cur / ubi + subjunctive", "an indirect question (a question folded into a sentence: nescio quid faciat = I don't know what he is doing)", "interrogatio obliqua", "syntax", 29, 29, [110],
      ["present-subjunctive", "imperfect-subjunctive", "relative-pronoun"], ["relative-pronoun", "indirect-command", "accusative-infinitive", "deliberative-subjunctive"],
      ["quis"], None,
      [r"(?i)\b(nesci|sci|rog|quaer|interrog|dubit|mir|dic|narr|audi|vide|cogit|intelleg|responde|ostend)\w*\b[^.!?]*\b(quis|quid|cur|quomodo|quare|ubi|unde|quo|quando|num|utrum|an|quot|quam|quantus|quanta|quantum|qualis|quale|uter|quin|quotus)\b[^.!?]*\b\w+(et|at|iat|ent|ant|iant|sit|sint|possit|ret|rent|retur|rentur|erit|erint|erim|eris|isset|issent|esset|essent|atur|etur|antur|entur)\b"],
      {"mood": "subj"},
      ["recognise", "parse", "blank"],
      "After ask, know, tell, wonder, a question word (quis, quid, cur, ubi, quomodo, num, utrum … an) introduces a clause whose verb is subjunctive: sciunt ubi sis; nesciebam quid videret.", syl=7)

skill("deliberative-subjunctive", "Deliberative subjunctive: 'what am I to do?'", "the deliberative subjunctive (the 'what am I to do?' question: quid faciam?)", "coniunctivus deliberativus", "verb-use", 29, 29, [111],
      ["present-subjunctive", "subjunctive-wish-command"], ["subjunctive-wish-command", "indirect-question", "future-active"],
      CONJ_ALL, {"mood": "subj", "tense": ["pres", "impf"], "person": 1},
      [r"(?i)\b(quid|quo|quomodo|quem|quam|cur|ubi|unde|utrum|num|quis)\b\s+(\w+\s+){0,3}\w+(am|em|iam|amus|emus|iamus|ar|er|amur|emur|rem|remus|rer|remur)\b\s*\?"],
      {"mood": "subj", "tense": ["pres", "impf"], "person": 1},
      ["recognise", "parse", "blank"],
      "A doubtful or despairing question in the subjunctive, usually first person: quid faciam? what am I to do?; quo eamus? where are we to go?; past time uses the imperfect (quid facerem?).", syl=7)

skill("future-perfect", "Future perfect: -ero, -erit ('will have done')", FUTPERF, "futurum exactum", "verb-form", 30, 30, [112, 113],
      ["perfect-active", "future-active", "future-irregular"], ["perfect-subjunctive", "perfect-active", "future-active", "pluperfect", "cum-narrative"],
      CONJ_ALL + ["sum", "eo", "fero"], {"tense": "futperf", "mood": "ind"},
      [r"(?i)\b\w+(ero|eris|erit|erimus|eritis|erint)\b", r"(?i)\b\w+(tus|ta|tum|ti|tae|sus|sa|sum|si|sae)\s+(ero|eris|erit|erimus|eritis|erunt)\b",
       r"(?i)\b(si|nisi|sin|cum|antequam|priusquam|ubi|postquam|simulatque|simul|dum|quando|quotiens)\b[^.!?]*\b\w+(ero|eris|erit|erimus|eritis|erint)\b"],
      {"tense": "futperf", "mood": "ind"},
      ["recognise", "chart", "parse", "blank"],
      "Perfect stem + -ero, -eris, -erit, -erimus, -eritis, -erint for an action finished before a future one: cum venero, gaudebo = when I have come, I'll be glad; passive: captus erit.", syl=8)

skill("gerundive", "Gerundive: the -ndus adjective", "the gerundive (the '-nd-' adjective: 'to be done'; aqua bibenda = water to be drunk)", "gerundivum (participium futuri passivi)", "verb-form", 31, 31, [114, 120],
      ["gerund", "perfect-passive-participle", "adjective-agreement"], ["gerund", "future-participle", "perfect-passive-participle", "present-participle"],
      CONJ_ALL + ["adj12"], {"mood": "gerundive"},
      [r"(?i)\b\w+nd(us|a|um|i|ae|o|os|as|is|orum|arum)\b", r"(?i)\bad\s+\w+\s+\w+nd(um|am|os|as)\b", r"(?i)\b\w+nd(i|orum|arum)\s+(causa|gratia)\b"],
      {"mood": "gerundive"},
      ["recognise", "chart", "parse", "blank"],
      "Stem + -nd- + -us -a -um, agreeing with a noun: what should be done to it (liber legendus); after ad or with causa it replaces gerund + object (ad litteras scribendas = for writing letters).", syl=9)

skill("passive-periphrastic", "Gerundive + sum: 'must be done'", "the gerundive with sum (the 'must be done' pattern: liber legendus est = the book must be read)", "coniugatio periphrastica passiva", "verb-use", 31, 31, [114],
      ["gerundive", "perfect-passive"], ["perfect-passive", "gerundive", "dative-of-agent"],
      CONJ_ALL, {"mood": "gerundive"},
      [r"(?i)\b\w+nd(us|a|um|i|ae|a)\b\s*,?\s*(sum|es|est|sumus|estis|sunt|eram|eras|erat|erant|ero|eris|erit|erunt|esse|sit|sint|esset|essent|fuit|fuerat)\b",
       r"(?i)\b(sum|es|est|sumus|estis|sunt|erat|erant|erit|erunt|esse|sit|sint|esset)\s+\w+nd(us|a|um|i|ae|a)\b"],
      {"mood": "gerundive", "case": "nom"},
      ["recognise", "parse", "blank"],
      "Gerundive + a form of sum says what needs doing: cibus comedendus est = the food must be eaten; with no subject it is impersonal (dormiendum est = one must sleep); in indirect statement -ndum esse.", syl=9)

skill("dative-of-agent", "Dative of agent with the gerundive (mihi = by me)", "the dative of agent (the person who must do it: mihi legendum est = I must read)", "dativus auctoris", "noun-case", 31, 31, [114],
      ["passive-periphrastic", "dative-indirect-object", "ablative-agent"], ["ablative-agent", "dative-indirect-object", "dative-possession"],
      NOUN_ALL + ["ego", "tu", "se"], {"case": "dat"},
      [r"(?i)\b(mihi|tibi|sibi|nobis|vobis|ei|eis|iis|cui|cuique|omnibus|nemini|\w+(ae|o|i|is|ibus))\b[^.!?]*\b\w+nd(us|a|um|i|ae|a)\s*(est|sunt|erat|erant|erit|erunt|esse|sit|sint)\b",
       r"(?i)\b\w+nd(us|a|um|i|ae|a)\s*(est|sunt|erat|erant|erit|erunt|esse)\b[^.!?]*\b(mihi|tibi|sibi|nobis|vobis|ei|eis|cui|omnibus|nemini)\b"],
      {"case": "dat"},
      ["recognise", "parse", "blank"],
      "With the gerundive + sum the doer goes in the dative, not a/ab + ablative: liber mihi legendus est = the book must be read by me, I have to read the book; servis laborandum est.", syl=9)

skill("perfect-subjunctive", "Perfect subjunctive: -erim, -eris, -erit", "the perfect subjunctive (the 'have done' form: nescio quid fecerit; ne timueris = don't be afraid)", "coniunctivus perfecti", "verb-form", 32, 32, [115],
      ["present-subjunctive", "perfect-active", "future-perfect", "indirect-question"], ["future-perfect", "perfect-active", "pluperfect-subjunctive", "present-subjunctive", "noli-infinitive"],
      CONJ_ALL + ["sum", "possum", "eo", "fero", "volo"], {"tense": "perf", "mood": "subj"},
      [r"(?i)\b\w+(erim|eris|erit|erimus|eritis|erint)\b", r"(?i)\b\w+(tus|ta|tum|ti|tae|sus|sa|sum|si|sae)\s+(sim|sis|sit|simus|sitis|sint)\b", r"(?i)\bne\s+(\w+\s+){0,2}\w+(eris|eritis)\b",
       r"(?i)\b(fuerim|fueris|fuerit|fuerimus|fueritis|fuerint|potuerim|potuerit|potuerint|voluerit|ierit|ierint)\b"],
      {"tense": "perf", "mood": "subj"},
      ["recognise", "chart", "parse", "blank"],
      "Perfect stem + -eri- + endings (fecerim, feceris, fecerit …; passive factus sim) for a completed action after a present main verb: nescio quis venerit; cum clauserit; and ne + 2nd person for 'don't' (ne timueris). -eris / -erit / -erint also spell the future perfect.", syl=10)

skill("wishes-utinam", "Wishes: utinam + subjunctive", "utinam + subjunctive (the 'if only …' wish; the tense says whether it can still come true)", "coniunctivus optativus cum utinam", "verb-use", 32, 33, [118],
      ["subjunctive-wish-command", "imperfect-subjunctive"], ["subjunctive-wish-command", "conditions-contrary-to-fact", "potential-subjunctive"],
      CONJ_ALL + IRREG, {"mood": "subj"},
      [r"(?i)\butinam\b(\s+ne)?[^.!?]*\b\w+(et|at|iat|ent|ant|iant|sit|sint|ret|rent|retur|rentur|isset|issent|esset|essent|possem|posset|vellem|vellet|em|am|im)\b",
       r"(?i)\b(di|dii|dei|deus|iuppiter|fortuna)\s+(\w+\s+){0,2}\w+(ent|ant|et|at|int)\b", r"(?i)\b(valeas|valeat|valeant|vivas|vivat|vivant|servent|servet)\b"],
      {"mood": "subj"},
      ["recognise", "parse", "blank"],
      "utinam (negative utinam ne) + present subjunctive = a wish that may still happen (utinam veniat); + imperfect = a present wish that cannot (utinam venirent, if only they were coming); + pluperfect = a past one (utinam venisset).", syl=11)

skill("pluperfect-subjunctive", "Pluperfect subjunctive: -issem, -isset", "the pluperfect subjunctive (the 'had / would have' form: cum venisset = when he had come)", "coniunctivus plusquamperfecti", "verb-form", 33, 33, [116, 117],
      ["imperfect-subjunctive", "pluperfect", "perfect-infinitive", "perfect-subjunctive"], ["imperfect-subjunctive", "perfect-subjunctive", "pluperfect", "perfect-infinitive"],
      CONJ_ALL + ["sum", "possum", "eo", "fero", "volo"], {"tense": "plupf", "mood": "subj"},
      [r"(?i)\b\w+(issem|isses|isset|issemus|issetis|issent)\b", r"(?i)\b\w+(tus|ta|tum|ti|tae|sus|sa|sum|si|sae)\s+(essem|esses|esset|essemus|essetis|essent)\b",
       r"(?i)\b(fuissem|fuisses|fuisset|fuissent|potuissem|potuisset|potuissent|voluisset|noluisset|ivisset|iisset)\b"],
      {"tense": "plupf", "mood": "subj"},
      ["recognise", "chart", "parse", "blank"],
      "The perfect infinitive + endings (fecisse-m, fecisse-t; passive factus essem) for an action completed before a past main verb: cum advenissent, cibum sumpserunt; nesciebam quis advenisset.", syl=12)

skill("conditions-contrary-to-fact", "Unreal conditions: si + imperfect / pluperfect subjunctive", "the contrary-to-fact condition (si + subjunctive: 'if I were …, I would …'; 'if I had …, I would have …')", "condicio irrealis", "syntax", 33, 33, [119],
      ["imperfect-subjunctive", "pluperfect-subjunctive"], ["wishes-utinam", "potential-subjunctive", "future-perfect", "cum-narrative"],
      [], None,
      [r"(?i)\b(si|nisi|sin|quasi|tamquam|velut|potius quam)\b[^.!?]*\b\w+(rem|res|ret|remus|retis|rent|rer|retur|rentur|issem|isses|isset|issemus|issetis|issent|essem|esset|essent|possem|posset|possent|vellem|vellet)\b",
       r"(?i)\b\w+(rem|ret|rent|issem|isset|issent|esset|essent|posset|vellet)\b[^.!?]*\b(si|nisi)\b"],
      {"mood": "subj", "tense": ["impf", "plupf", "pres"]},
      ["recognise", "parse", "blank"],
      "Imperfect subjunctive in both halves for an unreal present (si thunnus essem, in mari habitarem = if I were a tuna I would live in the sea); pluperfect for an unreal past (si bibisset, non mortuus esset); tamquam takes the same tenses.", syl=12)

skill("future-imperative", "Future imperative: esto, memento, -to", "the future imperative (the 'you shall …' order for later or for rules: esto! memento!)", "imperativus futuri", "verb-form", 33, 33, [],
      ["imperative", "irregular-verbs-present"], ["imperative", "ablative-absolute-perfect", "supine"],
      CONJ_ALL + ["sum"], {"mood": "imper", "tense": "fut"},
      [r"(?i)\b(esto|estote|sunto|memento|mementote|scito|scitote|habeto|habetote|facito|dato|datote|dicito|ferto)\b", r"(?i)\b\w+(ato|atote|eto|etote|ito|itote|unto|anto|ento)\b"],
      {"mood": "imper", "tense": "fut"},
      ["recognise", "chart", "parse", "blank"],
      "Stem + -to (plural -tote, 3rd person -nto) gives an order for the future or a standing rule: esto = be (from now on), memento = remember, scito = know that; common in laws and maxims.", syl=12)

skill("dative-verbs", "Verbs that take the dative (pareo, placeo, noceo, credo)", DAT, "verba cum dativo", "noun-case", 34, 34, [],
      ["dative-indirect-object", "dative-possession"], ["dative-indirect-object", "accusative-object", "dative-of-agent"],
      NOUN_ALL + ["ego", "tu", "se"], {"case": "dat"},
      [r"(?i)\b(pare|paru|place|placu|displice|noce|nocu|persuade|persuas|imper|servi|stude|studu|fave|fav|cred|ignosc|ignov|invide|invid|resist|restit|obedi|succurr|subveni|parc|peperc|indulge|nub|nups|confid|diffid|adsum|ades|adest|adsunt|desum|dees|deest|desunt|prosum|prodes|prodest|prosunt|obsum|obest|intersum|interest|licet|libet|placet)\w*\b",
       r"(?i)\b(mihi|tibi|sibi|nobis|vobis|ei|eis|iis|cui|quibus|illi|illis|huic|his)\s+(\w+\s+){0,2}(pare|place|noce|persuade|imper|servi|stude|fave|cred|ignosc|invide|resist|parc|licet|libet|placet)\w*\b"],
      {"case": "dat"},
      ["recognise", "parse", "blank"],
      "Some verbs put their object in the dative where English has a direct object: pareo obey, placeo please, noceo harm, credo believe, persuadeo persuade, ignosco forgive, and compounds of sum (adsum, prosum): servi domino parent.", syl=13)

skill("dummodo", "dummodo + subjunctive: 'provided that'", "dummodo + subjunctive (the 'provided that / as long as' condition)", "dummodo cum coniunctivo", "syntax", 34, 34, [],
      ["present-subjunctive", "imperfect-subjunctive", "conditions-contrary-to-fact"], ["conditions-contrary-to-fact", "cum-narrative", "result-clause"],
      [], None,
      [r"(?i)\b(dummodo|dum modo|modo|dum)\b[^.!?]*\b\w+(et|at|iat|ent|ant|iant|sit|sint|ret|rent|retur|rentur|esset|essent|possit|posset|velit|vellet)\b", r"(?i)\bdummodo\s+ne\b"],
      {"mood": "subj", "tense": ["pres", "impf"]},
      ["recognise", "parse", "blank"],
      "dummodo (also modo, dum) + subjunctive states a condition that must hold: oderint dum metuant = let them hate, provided they fear; negative dummodo ne.", syl=13)

skill("elegiac-couplet", "Metre: hexameter, pentameter and hendecasyllable", "the metre (the rhythm of a line: the hexameter and pentameter of the elegiac couplet, Catullus's eleven-syllable line)", "versus: hexameter, pentameter, hendecasyllabus", "metre", 34, 34, [],
      ["superlative", "adverbs"], ["prosody-scansion"],
      [], None,
      [r"(?i)\b(versus|versibus|carmen|carmina|poeta|hexameter|pentameter|hendecasyllabus|syllaba|syllabae|pes|pedes|longa|brevis|dactylus|spondeus)\b"],
      None,
      ["recognise"],
      "The dactylic hexameter (six feet, long-short-short or long-long) alternates with the pentameter (two halves of two and a half feet) in the elegiac couplet of Ovid and Martial; Catullus's hendecasyllable has eleven syllables.", syl=13)

skill("prosody-scansion", "Prosody: long and short syllables, elision", "prosody (which syllables count long or short, and when a final vowel is swallowed by the next word)", "prosodia: quantitas syllabarum, elisio", "metre", 34, 34, [],
      ["elegiac-couplet"], ["elegiac-couplet"],
      [], None,
      [r"(?i)\b\w*[aeiouy]m?\s+h?[aeiouy]\w*", r"(?i)\b\w*(ae|au|oe|ei|eu|ui)\w*\b", r"(?i)\b\w*[aeiou][bcdfglmnprstx][bcdfglmnprstx]\w*\b"],
      None,
      ["recognise"],
      "A syllable is long if its vowel is long, a diphthong, or followed by two consonants; a final vowel or -m before a word starting with a vowel or h- is elided (od(i) et amo); the hexameter pauses at a caesura.", syl=14)

# ---------------------------------------------------------------------------
# What each skill's items ask about (GRAMMAR-CONTRACT.md "feature"): the
# dimension a recognise / parse item tests. `construction` = the item asks the
# *function* ("What is this dative doing here?", "What kind of clause is
# this?") with the confusable constructions as the choices; those skills also
# carry `function` (the answer label; the part in brackets is its plain gloss)
# and `highlight_match` (a regex over the reader's grammar-focus labels that
# names the construction, so those sentences become gold drill items).

FEATURES = {"case", "gender", "number", "tense", "mood", "voice", "person", "degree", "construction", "form"}

FEATURE = {
    # case: which case is this form (the plain-case and declension / pronoun skills)
    "nominative-subject": "case", "accusative-object": "case", "vocative": "case",
    "demonstratives": "case", "demonstrative-pronouns": "case", "relative-pronoun": "case", "personal-pronouns": "case",
    "third-declension": "case", "third-declension-neuter": "case", "fourth-declension": "case", "fifth-declension": "case",
    # gender
    "noun-gender": "gender", "adjective-agreement": "gender",
    # construction: the function-named case skills and the syntax / verb-use skills
    "genitive-possession": "construction", "genitive-of": "construction", "ablative-place": "construction", "ablative-origin": "construction",
    "accusative-destination": "construction", "ablative-means": "construction", "ablative-agent": "construction", "dative-indirect-object": "construction",
    "accusative-infinitive": "construction", "dative-possession": "construction", "ablative-time": "construction", "ablative-absolute": "construction",
    "ablative-degree": "construction", "noli-infinitive": "construction", "perfect-passive": "construction", "ablative-absolute-perfect": "construction",
    "perfect-deponent": "construction", "ablative-comparison": "construction", "subjunctive-wish-command": "construction", "potential-subjunctive": "construction",
    "indirect-command": "construction", "purpose-clause": "construction", "result-clause": "construction", "cum-narrative": "construction",
    "cum-causal": "construction", "indirect-question": "construction", "deliberative-subjunctive": "construction", "passive-periphrastic": "construction",
    "dative-of-agent": "construction", "wishes-utinam": "construction", "conditions-contrary-to-fact": "construction", "dative-verbs": "construction", "dummodo": "construction",
    # tense (asked together with the mood: "which tense and mood")
    "present-indicative-3rd": "tense", "irregular-verbs-present": "tense", "imperfect-active": "tense", "imperfect-passive": "tense", "imperfect-irregular": "tense",
    "future-active": "tense", "future-passive": "tense", "future-irregular": "tense", "perfect-active": "tense", "pluperfect": "tense",
    "present-subjunctive": "tense", "imperfect-subjunctive": "tense", "sequence-of-tenses": "tense", "future-perfect": "tense", "perfect-subjunctive": "tense", "pluperfect-subjunctive": "tense",
    # mood (the non-finite forms and the imperatives)
    "imperative": "mood", "infinitive": "mood", "present-participle": "mood", "perfect-passive-participle": "mood", "perfect-infinitive": "mood", "supine": "mood",
    "perfect-deponent-participle": "mood", "future-participle": "mood", "future-infinitive": "mood", "deponent-imperatives": "mood", "gerund": "mood", "gerundive": "mood", "future-imperative": "mood",
    # voice, person, degree, form
    "passive-voice": "voice", "deponent-verbs": "voice",
    "active-personal-endings": "person", "passive-personal-endings": "person",
    "comparative": "degree", "superlative": "degree", "irregular-comparison": "degree", "adverbs": "degree",
    "enclitics": "form", "principal-parts": "form",
    # lesson only
    "elegiac-couplet": None, "prosody-scansion": None,
}

FUNCTION = {
    "genitive-possession": "possession (whose it is)",
    "genitive-of": "'of': part, description or after an adjective (a cup of wine, full of apples)",
    "ablative-place": "place where (in / sub / cum + ablative)",
    "ablative-origin": "from, out of, away from (a / ab / e / ex / de + ablative)",
    "accusative-destination": "motion towards (ad / in + accusative)",
    "ablative-means": "means (with a thing, no preposition)",
    "ablative-agent": "agent (by a person: a / ab + ablative)",
    "dative-indirect-object": "indirect object (the receiver)",
    "accusative-infinitive": "indirect statement (accusative + infinitive)",
    "dative-possession": "possession (mihi est = I have)",
    "ablative-time": "time when",
    "ablative-absolute": "ablative absolute (noun + present participle)",
    "ablative-degree": "degree of difference (by how much)",
    "noli-infinitive": "negative command (noli + infinitive)",
    "perfect-passive": "perfect passive (laudatus est = was praised)",
    "ablative-absolute-perfect": "ablative absolute (noun + perfect participle)",
    "perfect-deponent": "perfect of a deponent (locutus est = he spoke)",
    "ablative-comparison": "comparison (than, without quam)",
    "subjunctive-wish-command": "wish or command in a main clause (let us …, may he …)",
    "potential-subjunctive": "potential (could / would / might)",
    "indirect-command": "indirect command (ordered / asked to …)",
    "purpose-clause": "purpose (in order to)",
    "result-clause": "result (so … that)",
    "cum-narrative": "cum: when / while (past narrative)",
    "cum-causal": "cum: since / although",
    "indirect-question": "indirect question (asks / knows what …)",
    "deliberative-subjunctive": "deliberative question (what am I to do?)",
    "passive-periphrastic": "must be done (gerundive + sum)",
    "dative-of-agent": "agent with the gerundive (by whom it must be done)",
    "wishes-utinam": "wish with utinam (if only …)",
    "conditions-contrary-to-fact": "unreal condition (if I were …, if I had …)",
    "dative-verbs": "object of a dative verb (pareo, placeo, noceo, credo …)",
    "dummodo": "proviso (provided that)",
}
# Extra phrases a typed function answer may use (the head of `function` is always accepted).
FUNCTION_KEYS = {
    "genitive-possession": ["possessive", "possessive genitive", "genitive of possession"],
    "genitive-of": ["partitive", "description", "descriptive", "objective genitive", "of"],
    "ablative-place": ["place", "location", "where"],
    "ablative-origin": ["origin", "separation", "from", "source"],
    "accusative-destination": ["motion", "destination", "towards", "direction", "place to which"],
    "ablative-means": ["means", "instrument", "instrumental"],
    "ablative-agent": ["agent", "personal agent"],
    "dative-indirect-object": ["indirect object", "receiver", "recipient"],
    "accusative-infinitive": ["indirect statement", "indirect speech", "accusative and infinitive", "reported statement"],
    "dative-possession": ["possession", "possessor", "dative of possession"],
    "ablative-time": ["time", "time when", "time at which"],
    "ablative-absolute": ["ablative absolute", "absolute"],
    "ablative-degree": ["degree of difference", "degree", "measure", "by how much"],
    "noli-infinitive": ["negative command", "prohibition", "noli"],
    "perfect-passive": ["perfect passive"],
    "ablative-absolute-perfect": ["ablative absolute", "absolute"],
    "perfect-deponent": ["perfect deponent", "deponent perfect", "deponent"],
    "ablative-comparison": ["comparison", "comparative", "than"],
    "subjunctive-wish-command": ["hortatory", "jussive", "iussive", "wish", "command", "exhortation"],
    "potential-subjunctive": ["potential", "possibility"],
    "indirect-command": ["indirect command", "command", "request", "indirect request"],
    "purpose-clause": ["purpose", "final", "final clause", "in order to"],
    "result-clause": ["result", "consecutive", "consequence"],
    "cum-narrative": ["temporal", "circumstantial", "narrative", "when", "while", "historic"],
    "cum-causal": ["causal", "concessive", "since", "although", "because"],
    "indirect-question": ["indirect question", "question"],
    "deliberative-subjunctive": ["deliberative", "deliberation"],
    "passive-periphrastic": ["passive periphrastic", "periphrastic", "obligation", "necessity", "must"],
    "dative-of-agent": ["agent", "dative of agent"],
    "wishes-utinam": ["wish", "optative", "utinam"],
    "conditions-contrary-to-fact": ["condition", "conditional", "contrary to fact", "unreal", "unfulfilled"],
    "dative-verbs": ["dative verb", "special verb", "verb taking the dative", "object of a verb"],
    "dummodo": ["proviso", "provided", "condition", "as long as"],
}
# Grammar-focus highlight labels (data/build/highlights-week-NN.json) that name the construction: those sentences are gold items.
HIGHLIGHT_MATCH = {
    "purpose-clause": r"purpose clause|relative clause of purpose|clause of purpose",
    "indirect-command": r"indirect command|indirect request",
    "result-clause": r"result clause",
    "cum-narrative": r"cum clause|circumstantial cum|temporal cum|cum historic",
    "cum-causal": r"causal cum|cum causal|concessive cum|cum concessive",
    "indirect-question": r"indirect question",
    "deliberative-subjunctive": r"deliberative",
    "conditions-contrary-to-fact": r"contrary-to-fact|contrary to fact|unreal condition",
    "wishes-utinam": r"utinam|(?<!contrary-to-fact )\bwish\b",
    "dummodo": r"dummodo|proviso",
    "passive-periphrastic": r"passive periphrastic",
    "dative-of-agent": r"dative of agent",
    "dative-verbs": r"verb taking the dative|impersonal verb with the dative|verb with the dative",
    "gerund": r"\bgerund\b(?!ive)",
    "gerundive": r"gerundive(?! \+ sum)",
    "supine": r"supine",
    "ablative-absolute": r"ablative absolute(?!.*perfect)",
    "ablative-absolute-perfect": r"ablative absolute.*perfect",
    "potential-subjunctive": r"potential",
    "subjunctive-wish-command": r"hortatory|jussive|iussive",
    "perfect-deponent": r"deponent perfect(?! participle)",
    "perfect-deponent-participle": r"deponent perfect participle",
    "deponent-imperatives": r"deponent imperative",
    "deponent-verbs": r"deponent present|deponent infinitive|deponent imperfect|deponent future",
    "future-imperative": r"future imperative",
    "future-perfect": r"future perfect",
    "perfect-subjunctive": r"(?<!im)(?<!plu)perfect subjunctive",
    "imperfect-subjunctive": r"imperfect (passive )?subjunctive",
    "present-subjunctive": r"present subjunctive",
    "pluperfect-subjunctive": r"pluperfect subjunctive",
    "noli-infinitive": r"nol[iī] \+ infinitive|negative command with nol|prohibition with nol",
    "accusative-infinitive": r"indirect statement|accusative and infinitive|accusative \+ infinitive",
    "ablative-agent": r"ablative of agent",
    "ablative-means": r"ablative of means|ablative of instrument",
    "ablative-time": r"ablative of time",
    "ablative-degree": r"degree of difference",
    "ablative-comparison": r"ablative of comparison",
    "dative-possession": r"dative of possession",
    "dative-indirect-object": r"indirect object",
    "genitive-of": r"partitive|genitive of description|objective genitive",
    "genitive-possession": r"possessive genitive|genitive of possession",
    "perfect-passive": r"perfect passive(?! participle)(?! subjunctive)(?! infinitive)",
}

# The Latin names with their macrons (the lesson lede prints them as given).
LATIN = {
    "nominative-subject": "cāsus nōminātīvus", "noun-gender": "genus", "adjective-agreement": "adiectīvum cum substantīvō congruēns",
    "enclitics": "encliticae -que, -ne", "genitive-possession": "genitīvus possessīvus", "genitive-of": "genitīvus dēscrīptīvus et partitīvus",
    "accusative-object": "cāsus accūsātīvus", "present-indicative-3rd": "praesēns indicātīvī, tertia persōna", "imperative": "modus imperātīvus",
    "vocative": "cāsus vocātīvus", "ablative-place": "ablātīvus locī", "ablative-origin": "ablātīvus sēparātīvus", "accusative-destination": "accūsātīvus dīrēctiōnis",
    "ablative-means": "ablātīvus īnstrūmentī", "passive-voice": "genus passīvum", "ablative-agent": "ablātīvus auctōris", "dative-indirect-object": "cāsus datīvus",
    "demonstratives": "prōnōmina dēmōnstrātīva", "demonstrative-pronouns": "prōnōmina dēmōnstrātīva substantīva", "relative-pronoun": "prōnōmen relātīvum",
    "third-declension": "dēclīnātiō tertia", "infinitive": "modus īnfīnītīvus", "accusative-infinitive": "accūsātīvus cum īnfīnītīvō",
    "third-declension-neuter": "dēclīnātiō tertia, genus neutrum", "fourth-declension": "dēclīnātiō quārta", "dative-possession": "datīvus possessīvus",
    "comparative": "gradus comparātīvus", "fifth-declension": "dēclīnātiō quīnta", "ablative-time": "ablātīvus temporis", "superlative": "gradus superlātīvus",
    "present-participle": "participium praesentis", "personal-pronouns": "prōnōmina persōnālia et reflexīvum", "active-personal-endings": "dēsinentiae persōnālēs āctīvae",
    "irregular-verbs-present": "verba anōmala", "deponent-verbs": "verba dēpōnentia", "ablative-absolute": "ablātīvus absolūtus", "ablative-degree": "ablātīvus mēnsūrae",
    "passive-personal-endings": "dēsinentiae persōnālēs passīvae", "adverbs": "adverbia", "imperfect-active": "imperfectum indicātīvī āctīvī",
    "imperfect-passive": "imperfectum indicātīvī passīvī", "imperfect-irregular": "imperfectum verbōrum anōmalōrum", "irregular-comparison": "comparātiō anōmala",
    "future-active": "futūrum indicātīvī āctīvī", "future-passive": "futūrum indicātīvī passīvī", "noli-infinitive": "prohibitiō: nōlī cum īnfīnītīvō",
    "future-irregular": "futūrum verbōrum anōmalōrum", "principal-parts": "partēs prīncipālēs verbī", "perfect-active": "perfectum indicātīvī āctīvī",
    "perfect-passive-participle": "participium perfectī passīvī", "perfect-passive": "perfectum indicātīvī passīvī", "perfect-infinitive": "īnfīnītīvus perfectī",
    "supine": "supīnum", "ablative-absolute-perfect": "ablātīvus absolūtus cum participiō perfectī", "perfect-deponent-participle": "participium perfectī verbī dēpōnentis",
    "perfect-deponent": "perfectum verbī dēpōnentis", "future-participle": "participium futūrī āctīvī", "future-infinitive": "īnfīnītīvus futūrī",
    "pluperfect": "plūsquamperfectum indicātīvī", "ablative-comparison": "ablātīvus comparātiōnis", "deponent-imperatives": "imperātīvus verbōrum dēpōnentium",
    "gerund": "gerundium", "present-subjunctive": "coniūnctīvus praesentis", "subjunctive-wish-command": "coniūnctīvus optātīvus, hortātīvus, iussīvus",
    "potential-subjunctive": "coniūnctīvus potentiālis", "indirect-command": "coniūnctīvus substantīvus: ut, nē", "purpose-clause": "coniūnctīvus fīnālis",
    "result-clause": "coniūnctīvus cōnsecūtīvus", "imperfect-subjunctive": "coniūnctīvus imperfectī", "sequence-of-tenses": "cōnsecūtiō temporum",
    "cum-narrative": "cum historicum", "cum-causal": "cum causāle et concessīvum", "indirect-question": "interrogātiō oblīqua",
    "deliberative-subjunctive": "coniūnctīvus dēlīberātīvus", "future-perfect": "futūrum exāctum", "gerundive": "gerundīvum (participium futūrī passīvī)",
    "passive-periphrastic": "coniugātiō periphrastica passīva", "dative-of-agent": "datīvus auctōris", "perfect-subjunctive": "coniūnctīvus perfectī",
    "wishes-utinam": "coniūnctīvus optātīvus cum utinam", "pluperfect-subjunctive": "coniūnctīvus plūsquamperfectī", "conditions-contrary-to-fact": "condiciō irreālis",
    "future-imperative": "imperātīvus futūrī", "dative-verbs": "verba cum datīvō", "dummodo": "dummodo cum coniūnctīvō",
    "elegiac-couplet": "versūs: hexameter, pentameter, hendecasyllabus", "prosody-scansion": "prosōdia: quantitās syllabārum, ēlīsiō",
}

# Sentences a skill's loose pattern would catch but that belong to a sibling construction: a result signal word or a
# verb of commanding before the ut-clause is not a purpose clause; those sentences drill the sibling instead.
EXCLUDE = {
    "purpose-clause": [r"(?i)\b(tam|ita|sic|adeo|tot|talis|tale|tales|talem|tantus|tanta|tantum|tanti|tantae|tantos|tantas)\b[^.!?]*\but\b",
                       r"(?i)\b(imper|ora|rog|mone|hort|persuade|cur|cav|pet|postul|iube|licet|oportet|necesse|praecip|effic|accid|fit|opta|cupi|precor)\w*\b[^.!?]*\b(ut|ne)\b"],
    "result-clause": [r"(?i)\b(imper|ora|rog|mone|hort|persuade|postul|praecip|opta|cupi|precor)\w*\b[^.!?]*\but\b"],
    "indirect-command": [r"(?i)\b(tam|ita|sic|adeo|tot|talis|tantus|tanta|tantum)\b[^.!?]*\but\b"],
    "cum-narrative": [r"(?i)\bcum\b[^.!?]*\btamen\b", r"(?i)\b(quippe|utpote)\b"],
    "cum-causal": [r"(?i)\bcum\b\s+(\w+\s+){0,6}\w+(isset|issent)\b"],
    "dative-indirect-object": [r"(?i)\b(mihi|tibi|ei|nobis|vobis|eis|cui|\w+(ae|o|i|is|ibus))\s+(est|sunt|erat|erant|erit|erunt|nomen)\b", r"(?i)\b\w+nd(us|a|um|i|ae|a)\s*(est|sunt|erat|erant|erit|erunt|esse)\b"],
}

def annotate(skills):
    for s in skills:
        i = s["id"]
        s["feature"] = FEATURE.get(i, "?")
        s["exclude_patterns"] = EXCLUDE.get(i, [])
        s["function"] = FUNCTION.get(i)
        s["function_keys"] = FUNCTION_KEYS.get(i, [])
        s["highlight_match"] = HIGHLIGHT_MATCH.get(i)
        if i in LATIN: s["latin_label"] = LATIN[i]

def symmetrise(skills):
    by = {s["id"]: s for s in skills}
    for s in skills:
        for c in s["confusable_with"]:
            if s["id"] not in by[c]["confusable_with"]:
                by[c]["confusable_with"].append(s["id"])

CATS = {"noun-case", "adjective", "pronoun", "verb-form", "verb-use", "syntax", "vocabulary", "questions", "metre"}
KINDS = {"recognise", "chart", "parse", "blank"}
PF_KEYS = {"case", "number", "gender", "tense", "voice", "mood", "person", "pos", "degree", "deponent", "enc", "h", "decl"}

def validate(doc):
    errs = []
    skills = doc["skills"]; order = doc["order"]
    ids = [s["id"] for s in skills]
    if len(ids) != len(set(ids)):
        errs.append("duplicate ids: " + ", ".join(i for i, c in collections.Counter(ids).items() if c > 1))
    idset = set(ids)
    if sorted(order) != sorted(ids) or len(order) != len(set(order)):
        errs.append("order must contain every id exactly once")
    if len(skills) != 87:
        errs.append("expected 87 skills, got %d" % len(skills))
    pos = {i: n for n, i in enumerate(order)}
    by = {s["id"]: s for s in skills}
    last = 0
    for i in order:
        s = by[i]
        if s["chapter"] < last:
            errs.append("%s: chapter %d < previous %d (order must be book order)" % (i, s["chapter"], last))
        last = s["chapter"]
    for s in skills:
        i = s["id"]
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", i): errs.append(i + ": id not kebab-case")
        if s["category"] not in CATS: errs.append(i + ": bad category " + s["category"])
        if s["course"] not in ("101", "102", "103"): errs.append(i + ": bad course")
        if not isinstance(s["week"], int): errs.append(i + ": week missing")
        for p in s["prereqs"]:
            if p not in idset: errs.append("%s: unknown prereq %s" % (i, p))
            elif pos[p] >= pos[i]: errs.append("%s: prereq %s does not come earlier" % (i, p))
        for c in s["confusable_with"]:
            if c not in idset: errs.append("%s: unknown confusable %s" % (i, c))
            elif i not in by[c]["confusable_with"]: errs.append("%s: confusable %s not symmetric" % (i, c))
            if c == i: errs.append(i + ": confusable with itself")
        if not s["kinds"] or not set(s["kinds"]) <= KINDS: errs.append(i + ": bad kinds")
        if "chart" in s["kinds"] and not s["paradigms"]: errs.append(i + ": chart kind without a paradigm")
        for k in s["paradigms"]:
            if k not in doc["paradigm_keys"]: errs.append("%s: unknown paradigm key %s" % (i, k))
        for pat in s["patterns"] + s.get("exclude_patterns", []):
            try: re.compile(pat)
            except re.error as e: errs.append("%s: bad pattern %s (%s)" % (i, pat, e))
        pf = s["parse_filter"]
        for f in (pf if isinstance(pf, list) else [pf]):
            if f is not None and not set(f) <= PF_KEYS: errs.append("%s: unknown parse_filter key %s" % (i, set(f) - PF_KEYS))
        for f in ("title", "plain", "latin_label", "summary"):
            if not s[f]: errs.append(i + ": empty " + f)
        if not all(isinstance(p, int) and 1 <= p <= 120 for p in s["notes_pages"]): errs.append(i + ": bad notes_pages")
        feat = s.get("feature", "?")
        if feat is not None and feat not in FEATURES: errs.append("%s: bad feature %r (every skill needs one of %s or null)" % (i, feat, sorted(FEATURES)))
        if feat is None and pf is not None: errs.append(i + ": feature null but parse_filter set")
        if feat == "construction" and not s.get("function"): errs.append(i + ": construction skill without a function label")
        if feat != "construction" and s.get("function"): errs.append(i + ": function label on a non-construction skill")
        if s.get("highlight_match"):
            try: re.compile(s["highlight_match"])
            except re.error as e: errs.append("%s: bad highlight_match (%s)" % (i, e))
    return errs

PARADIGM_KEYS = {
    "decl1": "NOUN_ENDINGS['1']", "decl2m": "NOUN_ENDINGS['2m']", "decl2n": "NOUN_ENDINGS['2n']", "decl2r": "NOUN_ENDINGS['2r']",
    "decl3": "NOUN_ENDINGS['3']", "decl3n": "NOUN_ENDINGS['3n']", "decl3i": "NOUN_ENDINGS['3i']", "decl3in": "NOUN_ENDINGS['3in']",
    "decl4": "NOUN_ENDINGS['4']", "decl4n": "NOUN_ENDINGS['4n']", "decl5": "NOUN_ENDINGS['5']",
    "adj12": "ADJ_12 (bonus -a -um)", "adj3": "ADJ_3 (fortis -e)", "adj3cons": "ADJ_3_CONS (vetus)", "adjcomp": "ADJ_COMP (-ior -ius)",
    "conj1": "CONJ[1]", "conj2": "CONJ[2]", "conj3": "CONJ[3]", "conj3io": "CONJ['3io']", "conj4": "CONJ[4]",
    "sum": "IRREGULAR_VERBS.sum", "possum": "IRREGULAR_VERBS.possum", "eo": "IRREGULAR_VERBS.eo", "fero": "IRREGULAR_VERBS.fero",
    "volo": "IRREGULAR_VERBS.volo", "nolo": "IRREGULAR_VERBS.nolo", "malo": "IRREGULAR_VERBS.malo", "fio": "IRREGULAR_VERBS.fio",
    "is": "PRON_TABLES.is", "hic": "PRON_TABLES.hic", "ille": "PRON_TABLES.ille", "iste": "PRON_TABLES.iste", "ipse": "PRON_TABLES.ipse",
    "idem": "PRON_TABLES.idem", "qui": "PRON_TABLES.qui", "quis": "PRON_TABLES.quis", "ego": "PRON_TABLES.ego", "tu": "PRON_TABLES.tu", "se": "PRON_TABLES.se",
    "unus": "NUM_TABLES.unus", "duo": "NUM_TABLES.duo", "tres": "NUM_TABLES.tres",
    "vis": "IRREGULAR_NOUNS.vis", "deus": "IRREGULAR_NOUNS.deus", "domus": "IRREGULAR_NOUNS.domus", "iuppiter": "IRREGULAR_NOUNS.iuppiter",
}

def build():
    annotate(S)
    symmetrise(S)
    return {
        "version": 1,
        "paradigm_keys": PARADIGM_KEYS,
        "skills": S,
        "order": [s["id"] for s in S],
    }

def main():
    if "--check" in sys.argv:
        doc = json.load(open(OUT, encoding="utf-8"))
    else:
        doc = build()
    errs = validate(doc)
    if errs:
        print("INVALID:")
        for e in errs: print("  " + e)
        sys.exit(1)
    if "--check" not in sys.argv:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("wrote", OUT)
    print("skills:", len(doc["skills"]))
    for key in ("category", "course"):
        c = collections.Counter(s[key] for s in doc["skills"])
        print(key + ":", dict(sorted(c.items())))
    print("valid")

if __name__ == "__main__":
    main()
