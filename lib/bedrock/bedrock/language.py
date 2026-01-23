"""
Language utilities for LLM responses.

Provides helpers to generate language-specific system prompts for apps.
"""

from typing import Optional

# Map of ISO 639-1 language codes to their full names
LANGUAGE_NAMES = {
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "ar": "Arabic",
    "ru": "Russian",
    "nl": "Dutch",
    "sv": "Swedish",
    "no": "Norwegian",
    "da": "Danish",
    "fi": "Finnish",
    "pl": "Polish",
    "tr": "Turkish",
    "he": "Hebrew",
    "hi": "Hindi",
    "th": "Thai",
    "vi": "Vietnamese",
    "id": "Indonesian",
    "ms": "Malay",
}


def get_language_system_prompt(language: Optional[str]) -> Optional[str]:
    """
    Generate a system prompt instruction for the specified language.

    Args:
        language: ISO 639-1 language code (e.g., "en", "fr", "es")
                  or None to skip language instruction.

    Returns:
        System prompt string instructing the LLM to respond in the specified language,
        or None if no language is provided.
    """
    if not language:
        return None

    lang_code = language.strip().lower()
    if not lang_code:
        return None

    lang_name = LANGUAGE_NAMES.get(lang_code, lang_code.upper())
    return f"You must respond in the language {lang_name}."
