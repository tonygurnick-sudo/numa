"""Tests for the shared Synergy tokenizer. The critical invariant is INDEX/QUERY
PARITY — a word stored from a document must match the same word typed as a query."""

from synergy_tokenize import STOPWORDS, normalize_token, tokenize_for_index


def test_word_like_is_stemmed():
    assert tokenize_for_index("Walls and retaining walls") == {"wall", "retain"}


def test_code_like_kept_verbatim():
    # digits / hyphen / dot → code-like → never stemmed
    toks = tokenize_for_index("Drawing DWG-2401 per AS3500 rev v1.2")
    assert "dwg-2401" in toks
    assert "as3500" in toks
    assert "v1.2" in toks
    assert "draw" in toks  # "Drawing" is word-like → stemmed


def test_stopwords_and_pure_numbers_dropped():
    assert tokenize_for_index("the of and 2024 4500 council") == {"council"}


def test_index_query_parity():
    # A doc containing "walls" must be found by a query for "wall" and vice-versa.
    assert normalize_token("walls") == normalize_token("wall")
    assert normalize_token("designing") == normalize_token("design")
    # Codes are stable both ways.
    assert normalize_token("dwg-2401") == "dwg-2401"


def test_trailing_separators_stripped_before_classification():
    # #15: prose punctuation must NOT make a plain word look code-like.
    # "walls." → strip "." → word-like → stemmed to "wall".
    assert tokenize_for_index("retaining walls.") == {"retain", "wall"}
    assert normalize_token("walls.") == "wall"
    assert normalize_token("wall.") == "wall"
    # Genuine codes still keep their internal separators verbatim.
    assert normalize_token("dwg-2401") == "dwg-2401"
    assert normalize_token("v1.2") == "v1.2"
    assert normalize_token("as3500") == "as3500"
    assert normalize_token("state-of-the-art") == "state-of-the-art"


def test_normalize_token_lowercases():
    # #29: normalize_token must lowercase, matching the index path.
    assert normalize_token("Walls") == normalize_token("walls")
    assert normalize_token("Walls") == "wall"
    assert normalize_token("DWG-2401") == "dwg-2401"


def test_post_stem_stopwords_dropped():
    # #30: inflected forms that stem to a stopword must not leak in.
    assert normalize_token("having") is None  # → "have" (stopword)
    assert normalize_token("wills") is None  # → "will" (stopword)
    assert normalize_token("ours") is None  # → "our" (stopword)
    # A real word that merely starts like a stopword is unaffected.
    assert normalize_token("having") is None
    assert normalize_token("walls") == "wall"


def test_dotted_and_hyphenated_pure_numbers_dropped():
    # #31: pure numbers with dots/hyphens are noise, not codes.
    assert normalize_token("2024.05") is None
    assert normalize_token("192.168.1.1") is None
    assert normalize_token("3.14159") is None
    assert normalize_token("2024.") is None  # strip → "2024" → still numeric
    # Alphabetic-containing codes survive.
    assert normalize_token("v1.2") == "v1.2"
    assert normalize_token("dwg-2401") == "dwg-2401"
    assert normalize_token("as3500") == "as3500"


def test_dedupe_within_text():
    # set return → one entry per term regardless of repetition
    assert tokenize_for_index("wall wall walls WALL") == {"wall"}


def test_drops_one_char_and_empty():
    assert normalize_token("a") is None  # stopword
    assert normalize_token("") is None
    assert tokenize_for_index("") == set()


def test_stopwords_are_lowercase_set():
    assert "the" in STOPWORDS and "council" not in STOPWORDS
