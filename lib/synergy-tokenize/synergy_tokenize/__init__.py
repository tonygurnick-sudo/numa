"""Shared Synergy term tokenizer for the exact-term inverted index.

This MUST be byte-identical at index time (the synergy-text-crawler worker, which
writes TERM rows) and at query time (the chat exact-term handler). If the two ever
drift, stored terms stop matching queries and the index silently returns nothing —
so this is the single shared source of truth, imported by both lambdas.

Rules (LOCKED — changing ANY of them requires a full re-crawl, because the stored
terms would no longer match freshly-tokenized queries):

1. lowercase the text
2. token = `[a-z0-9][a-z0-9_.\\-]{1,49}` (length 2–50)
3. drop ~80 English stopwords + pure-numeric noise
4. classify each token:
   - CODE-LIKE — contains a digit, hyphen, or dot (e.g. ``dwg-2401``, ``as3500``):
     kept VERBATIM. Stemming would mangle part numbers / standards / names, which
     is exactly what exact-term mode is best at.
   - WORD-LIKE — plain alphabetic: Snowball (English) stemmed (``walls`` → ``wall``)
     for ~25–35% fewer unique terms and better recall.

`tokenize_for_index` returns the deduped set for a single text blob. The crawler
unions these across a job's files so each (term, job) is written once — that
per-job dedup (not per file) is what keeps the first crawl ~$200, not ~$10K.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Optional, Set

import snowballstemmer

# token = a letter/digit then 1–49 of [a-z0-9_.-]  → length 2–50, already lowercased
_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_.\-]{1,49}")
# code-like = contains a digit, dot, or hyphen → kept verbatim (never stemmed)
_CODE_CHARS = re.compile(r"[0-9.\-]")

_stemmer = snowballstemmer.stemmer("english")

# ~80 high-frequency English stopwords. LOCKED — adding/removing any needs a recrawl.
STOPWORDS = frozenset(
    """a an and are as at be been being but by for from had has have he her his
    i if in into is it its of on or our that the their them then there these they
    this to was we were what when where which who will with would you your about
    above after again all also am any because before below between both can did do
    does doing down during each few further here how more most no nor not now off
    only other out over own same so some such than too under up very""".split()
)


@lru_cache(maxsize=200_000)
def _stem(word: str) -> str:
    return _stemmer.stemWord(word)


def normalize_token(raw: str) -> Optional[str]:
    """Normalize a SINGLE already-extracted candidate token to its indexed form, or
    return None to drop it. This expects ONE token that has already been pulled out
    by ``_TOKEN_RE`` — it does NOT itself extract tokens or split on whitespace.

    NEVER call this on a raw query string. Doing so diverges from how the index was
    built (multi-token and non-ASCII/accented input would be mishandled), silently
    breaking index/query parity. Query terms — like indexed text — must ALWAYS go
    through ``tokenize_for_index``, which is the byte-identical entry point both the
    crawler and the chat query handler use."""
    raw = (raw or "").lower()
    # Strip leading/trailing separators BEFORE classification, so prose like
    # "walls." normalizes to a word-like "walls" (→ "wall") instead of being
    # treated as code-like and kept verbatim.
    raw = raw.strip("._-")
    if not raw or len(raw) < 2 or raw in STOPWORDS:
        return None
    # Pure numbers, including dotted/hyphenated ones ("2024.05", "192.168.1.1"),
    # are noise. Alphabetic-containing codes ("v1.2", "dwg-2401") survive.
    if raw.isdigit() or re.fullmatch(r"[0-9._\-]+", raw):
        return None
    if _CODE_CHARS.search(raw):
        return raw  # code-like → kept verbatim, never stemmed
    tok = _stem(raw)
    # Re-check stopwords on the POST-stem form so inflected words that stem to a
    # stopword ("having" → "have", "wills" → "will") don't leak into the index.
    if tok in STOPWORDS or len(tok) < 2:
        return None
    return tok


def tokenize_for_index(text: str) -> Set[str]:
    """Deduped set of indexed terms for a text blob (one file's extracted text, or
    a user's query string). The crawler unions these across a job's files."""
    out: Set[str] = set()
    for raw in _TOKEN_RE.findall((text or "").lower()):
        norm = normalize_token(raw)
        if norm:
            out.add(norm)
    return out
