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


class TestApprovalIsUnattended(unittest.TestCase):
    """Unattended fast-fail (BUG-140): an approval with no seen_at ack past
    the grace window means nobody is viewing the conversation."""

    def _item(self, created_at=None, seen_at=None):
        item = {}
        if created_at is not None:
            item["created_at"] = {"N": str(created_at)}
        if seen_at is not None:
            item["seen_at"] = {"N": str(seen_at)}
        return item

    def test_acked_approval_is_never_unattended(self):
        import time

        from tools.approval import approval_is_unattended

        now = time.time()
        item = self._item(created_at=int(now - 1000), seen_at=int(now - 999))
        self.assertFalse(approval_is_unattended(item, now - 1000))

    def test_unacked_within_grace_window_is_attended(self):
        import time

        from tools.approval import approval_is_unattended

        now = time.time()
        item = self._item(created_at=int(now - 5))
        self.assertFalse(approval_is_unattended(item, now - 5))

    def test_unacked_past_grace_window_is_unattended(self):
        import time

        from tools.approval import (
            APPROVAL_UNATTENDED_GRACE_SECONDS,
            approval_is_unattended,
        )

        now = time.time()
        created = int(now - APPROVAL_UNATTENDED_GRACE_SECONDS - 1)
        item = self._item(created_at=created)
        self.assertTrue(approval_is_unattended(item, created))

    def test_missing_created_at_falls_back_to_poll_start(self):
        import time

        from tools.approval import (
            APPROVAL_UNATTENDED_GRACE_SECONDS,
            approval_is_unattended,
        )

        now = time.time()
        # No created_at on the record (e.g. ack-created partial item)
        self.assertFalse(approval_is_unattended({}, now - 5))
        self.assertTrue(
            approval_is_unattended({}, now - APPROVAL_UNATTENDED_GRACE_SECONDS - 1)
        )


if __name__ == "__main__":
    unittest.main()
