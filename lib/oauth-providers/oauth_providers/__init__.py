"""OAuth Providers Library - Cloud storage provider implementations.

Provider registry is auto-discovered: drop a new `*_provider.py` file in this
package (subclassing OAuthProvider) and it will be picked up automatically.
No changes needed to this file.
"""

import importlib
import pkgutil

from .base_provider import (
    OAuthAuthenticationError,
    OAuthError,
    OAuthFile,
    OAuthFileMetadata,
    OAuthFolder,
    OAuthFolderContents,
    OAuthProvider,
    OAuthRateLimitError,
    normalize_file_path,
    parse_iso_datetime,
    test_provider_connection,
)

__all__ = [
    # Base classes and types
    "OAuthProvider",
    "OAuthFile",
    "OAuthFolder",
    "OAuthFolderContents",
    "OAuthFileMetadata",
    # Exceptions
    "OAuthError",
    "OAuthRateLimitError",
    "OAuthAuthenticationError",
    # Utility functions
    "test_provider_connection",
    "normalize_file_path",
    "parse_iso_datetime",
    # Registry
    "PROVIDERS",
    "create_provider",
]


def _discover_providers() -> dict[str, type]:
    """Auto-discover provider classes from *_provider.py modules.

    Scans this package for modules ending in `_provider` (excluding
    `base_provider`), imports them, and collects any class that is a
    concrete subclass of OAuthProvider.

    Returns:
        Dict mapping provider_name → provider class.
    """
    providers: dict[str, type] = {}
    for _, modname, _ in pkgutil.iter_modules(__path__):
        if modname.endswith("_provider") and modname != "base_provider":
            module = importlib.import_module(f".{modname}", __name__)
            for attr_name in dir(module):
                cls = getattr(module, attr_name)
                if (
                    isinstance(cls, type)
                    and issubclass(cls, OAuthProvider)
                    and cls is not OAuthProvider
                ):
                    # Instantiate temporarily to read provider_name
                    try:
                        instance = cls(client_id="", client_secret="")
                        providers[instance.provider_name] = cls
                    except Exception:
                        pass
    return providers


# Provider registry — auto-discovered from *_provider.py modules
PROVIDERS: dict[str, type] = _discover_providers()


def create_provider(
    provider_name: str, client_id: str, client_secret: str = None
) -> OAuthProvider:
    """Create a provider instance by name.

    Args:
        provider_name: Name of the provider (e.g. googledrive, onedrive, dropbox)
        client_id: OAuth client ID
        client_secret: OAuth client secret (if required)

    Returns:
        Provider instance

    Raises:
        ValueError: If provider name has no file-browsing implementation
    """
    if provider_name not in PROVIDERS:
        raise ValueError(
            f"No file-browsing implementation for provider: {provider_name}. "
            f"Available providers: {list(PROVIDERS.keys())}"
        )

    provider_class = PROVIDERS[provider_name]
    return provider_class(client_id=client_id, client_secret=client_secret)
