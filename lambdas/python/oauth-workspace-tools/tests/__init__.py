"""Test package init.

``unittest discover -s tests`` imports this package before any test module, but
(unlike pytest) it does NOT auto-load ``conftest.py``. Import the hermetic-vault
installer here so the company-vault cache is seeded and dummy AWS env is set
before the first test module is collected — keeping the ~78 needs_credential
tests off real Secrets Manager under both unittest and pytest.
"""

from .conftest import install_hermetic_vault

install_hermetic_vault()
