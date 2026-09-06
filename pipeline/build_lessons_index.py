"""Alias of build_grammar_index.py (kept for the older docs and scripts).

    python pipeline/build_lessons_index.py            (write the lessons, questions and vocab manifests)
    python pipeline/build_lessons_index.py --check    (fail if any is out of date)
"""
from build_grammar_index import main

if __name__ == "__main__":
    main()
