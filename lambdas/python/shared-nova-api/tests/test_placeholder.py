"""Placeholder test for shared-nova-api."""

import unittest


class TestSharedNovaApi(unittest.TestCase):
    def test_import(self):
        """Verify the package can be imported."""
        import shared_nova_api  # noqa: F401

        self.assertIsNotNone(shared_nova_api)
