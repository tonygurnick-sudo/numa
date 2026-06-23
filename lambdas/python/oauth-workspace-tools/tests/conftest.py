"""Hermetic test fixtures for the oauth-workspace-tools suite.

The Synergy auth / needs_credential handlers build their error payload from the
consolidated COMPANY vault (display_name, connector_type, credential_fields). In
a test process the in-memory vault cache is empty, so every such call falls
through to a REAL ``secretsmanager:GetSecretValue`` that has to time out before
it returns — roughly 1s per call, three calls per needs_credential response, and
~78 tests on that path. That is ~150s of pure network-timeout latency with no
test value (and it makes the suite non-hermetic — it depends on ambient AWS).

This module makes the suite hermetic in two ways:

* **Dummy AWS env** — set placeholder ``AWS_*`` so botocore never reaches for
  real ambient credentials/region resolution.
* **Seed the company-vault cache to ``{}``** — both ``tools.oauth_tools`` and
  ``tools.connect_tools`` invoke the SAME ``_get_consolidated_company_vault``
  function object (connect_tools imports it by name), whose body reads the
  module-level ``_company_vault_cache``. Seeding that cache with a far-future
  timestamp makes every reference return ``{}`` instantly — no Secrets Manager
  call — for the whole session. We also rebind the function in both modules to a
  ``lambda: {}`` as belt-and-suspenders against any direct/uncached caller.

``conftest.py`` is auto-loaded by **pytest**. The canonical runner here is
``unittest discover``, which does NOT auto-load conftest — so ``tests/__init__``
imports :func:`install_hermetic_vault` to apply the same setup before any test
module is collected. Either runner ends up hermetic.
"""

from __future__ import annotations

import os
import time

_DUMMY_AWS_ENV = {
    "AWS_ACCESS_KEY_ID": "testing",
    "AWS_SECRET_ACCESS_KEY": "testing",
    "AWS_SESSION_TOKEN": "testing",
    "AWS_SECURITY_TOKEN": "testing",
    "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_REGION": "us-east-1",
}

# A timestamp far enough in the future that the 5-minute TTL check never expires
# the seeded cache for the lifetime of the test process.
_FAR_FUTURE = time.time() + 10**9

_installed = False


def install_hermetic_vault() -> None:
    """Make company-vault reads hermetic + seed dummy AWS env. Idempotent."""
    global _installed
    if _installed:
        return

    for key, val in _DUMMY_AWS_ENV.items():
        os.environ.setdefault(key, val)

    # Import after env is set so any module-level client picks up the dummy region.
    import tools.connect_tools as connect_tools
    import tools.oauth_tools as oauth_tools

    # 1) Seed the cache — covers every call site that goes through the real fn
    #    body (it reads this module global), in BOTH modules, with no SM hit.
    oauth_tools._company_vault_cache = ({}, _FAR_FUTURE)

    # 2) Belt-and-suspenders: rebind the function reference in both modules so an
    #    explicit cache-bypass (or a future refactor) still cannot reach SM.
    def _empty_vault() -> dict:
        return {}

    oauth_tools._get_consolidated_company_vault = _empty_vault  # type: ignore[assignment]
    connect_tools._get_consolidated_company_vault = _empty_vault  # type: ignore[assignment]

    _installed = True


# Auto-apply on import. Under pytest, importing conftest runs this at collection
# time; under unittest, tests/__init__ imports + calls it. Calling here too keeps
# the pytest path working even if __init__ is bypassed.
install_hermetic_vault()
