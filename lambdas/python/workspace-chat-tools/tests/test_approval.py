"""Tests for the shared approval module.

Includes a sync-test to guarantee that the approval constants have not been
shadowed (re-declared locally) by modules that import them. There is no
shared package across the lambdas + agent service + frontend, so the
constants must be kept in sync manually. This test catches Python-side
drift; the frontend has its own copy in
`numa-frontend/src/Components/WorkspaceChat/WorkspaceChatInlineTool.tsx`
that must be updated by hand.
"""

import unittest


class TestApprovalConstantSync(unittest.TestCase):
    def test_timeout_seconds_consistent_across_modules(self):
        from tools.approval import APPROVAL_TIMEOUT_SECONDS as canonical
        from tools.enhanced_vault_connectors import (
            APPROVAL_TIMEOUT_SECONDS as enhanced_vault,
        )
        from tools.vault_connectors import APPROVAL_TIMEOUT_SECONDS as vault

        self.assertEqual(canonical, enhanced_vault)
        self.assertEqual(canonical, vault)

    def test_poll_interval_consistent_across_modules(self):
        from tools.approval import APPROVAL_POLL_INTERVAL_SECONDS as canonical
        from tools.enhanced_vault_connectors import (
            APPROVAL_POLL_INTERVAL_SECONDS as enhanced_vault,
        )
        from tools.vault_connectors import APPROVAL_POLL_INTERVAL_SECONDS as vault

        self.assertEqual(canonical, enhanced_vault)
        self.assertEqual(canonical, vault)


if __name__ == "__main__":
    unittest.main()
