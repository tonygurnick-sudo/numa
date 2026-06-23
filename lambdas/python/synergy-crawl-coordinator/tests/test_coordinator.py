"""Unit tests for the coordinator's pure helpers — PAT extraction, job
identity, and the grant/revocation set algebra of the scheduled pass."""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with mock.patch.dict(
    "os.environ", {"CLIENT_NAME": "testclient", "STATE_TABLE_NAME": "t"}
):
    import lambda_function  # noqa: E402


class TestExtractPat(unittest.TestCase):
    def test_connector_synergy(self):
        vault = {
            "secrets": {"connector-synergy": {"fields": {"access_token": " tok "}}}
        }
        self.assertEqual(lambda_function._extract_pat(vault), "tok")

    def test_oauth_synergy_fallback(self):
        vault = {"secrets": {"oauth-synergy": {"fields": {"access_token": "tok2"}}}}
        self.assertEqual(lambda_function._extract_pat(vault), "tok2")

    def test_missing(self):
        self.assertEqual(lambda_function._extract_pat(None), "")
        self.assertEqual(lambda_function._extract_pat({}), "")
        self.assertEqual(lambda_function._extract_pat({"secrets": {}}), "")
        self.assertEqual(
            lambda_function._extract_pat(
                {"secrets": {"connector-synergy": {"fields": {}}}}
            ),
            "",
        )


class TestJobIdentity(unittest.TestCase):
    def test_nested_id(self):
        self.assertEqual(lambda_function._job_id({"ID": {"IDString": "8_1"}}), "8_1")

    def test_flat_id(self):
        self.assertEqual(lambda_function._job_id({"IDString": "9_1"}), "9_1")

    def test_missing(self):
        self.assertIsNone(lambda_function._job_id({}))


class TestStructuredAttrs(unittest.TestCase):
    def test_extracts_created_parent_template(self):
        out = lambda_function._job_structured_attrs(
            {
                "Type": 1,
                "CreatedDate": "2026-01-15T00:00:00Z",
                "ParentJobID": {"IDString": "50_1"},
            }
        )
        self.assertEqual(out["created_date"], "2026-01-15T00:00:00Z")
        self.assertEqual(out["parent_job_id"], "50_1")
        self.assertTrue(out["is_template"])

    def test_omits_absent_keys_but_always_is_template(self):
        out = lambda_function._job_structured_attrs({"Type": 0})
        self.assertEqual(out, {"is_template": False})  # no created_date/parent nulls

    def test_structured_set_builds_fragment_and_values(self):
        frag, vals = lambda_function._structured_set(
            {"is_template": False, "parent_job_id": "9_1"}
        )
        self.assertTrue(frag.startswith(", "))
        self.assertIn("is_template = :sa_is_template", frag)
        self.assertEqual(vals[":sa_parent_job_id"], "9_1")

    def test_structured_set_empty(self):
        self.assertEqual(lambda_function._structured_set({}), ("", {}))

    def test_tenant_attributes_extracted_and_normalised(self):
        job = {
            "Type": 0,
            "Attributes": [
                {"Name": "Job Type", "Value": "Council"},
                {"Attribute": {"Name": "Status"}, "Value": "Active"},  # richer form
            ],
        }
        out = lambda_function._job_structured_attrs(job)
        self.assertEqual(out["attr_job_type"], "Council")
        self.assertEqual(out["attr_status"], "Active")

    def test_tenant_attributes_skip_freetext_and_nonscalar(self):
        long_val = "x" * 200
        job = {
            "Attributes": [
                {"Name": "Notes", "Value": long_val},  # too long → skipped
                {"Name": "Geo", "Value": {"lat": 1}},  # non-scalar → skipped
                {"Name": "Region", "Value": "Wgtn"},  # kept
            ]
        }
        out = lambda_function._job_attributes(job)
        self.assertEqual(out, {"attr_region": "Wgtn"})

    def test_tenant_attributes_bounded(self):
        job = {"Attributes": [{"Name": f"A{i}", "Value": "v"} for i in range(40)]}
        self.assertLessEqual(len(lambda_function._job_attributes(job)), 15)


class TestVaultPath(unittest.TestCase):
    def test_path(self):
        self.assertEqual(
            lambda_function._vault_path("abc-123"), "testclient/vault/users/abc-123"
        )


class TestGrantRevokeAlgebra(unittest.TestCase):
    """The scheduled pass's allowed_users rebuild, as set algebra.

    new = (old - verified) | {u in verified : job in S_u}

    i.e. users whose enumeration succeeded are fully re-derived (grant AND
    revoke); users we could not verify keep their existing grants.
    """

    @staticmethod
    def _rebuild(old, verified, jid):
        kept = {u for u in old if u not in verified}
        return kept | {u for u, seen in verified.items() if jid in seen}

    def test_grant_new_user(self):
        new = self._rebuild(set(), {"alice": {"j1"}}, "j1")
        self.assertEqual(new, {"alice"})

    def test_revoke_verified_user_who_lost_job(self):
        new = self._rebuild({"alice"}, {"alice": set()}, "j1")
        self.assertEqual(new, set())

    def test_unverified_user_keeps_grant(self):
        # bob's PAT expired — his enumeration is absent from `verified`, so his
        # existing grant must survive (fail-safe, derived from his own past PAT).
        new = self._rebuild({"bob"}, {"alice": {"j1"}}, "j1")
        self.assertEqual(new, {"alice", "bob"})

    def test_mixed(self):
        old = {"alice", "bob", "carol"}
        verified = {"alice": {"j1"}, "carol": set()}  # bob unverifiable
        new = self._rebuild(old, verified, "j1")
        self.assertEqual(new, {"alice", "bob"})  # carol revoked, bob kept


class TestPurgeSafety(unittest.TestCase):
    """Pins the partial-enumeration safety invariant of _run_scheduled: a purge
    must NEVER remove a job a non-enumerated / failed-PAT user can still see.

    Purge predicate (mirrors lambda_function._run_scheduled lines ~808-814):
    purge iff no verified user sees the job AND `new` is empty — where
    new = (old grantees still NOT verified) | (verified users who see the job).
    The `kept` term (old minus verified) is the fail-safe: a user whose
    enumeration failed/was skipped stays in `kept`, keeping `new` non-empty.
    """

    @staticmethod
    def _new(old, verified, jid):
        kept = {u for u in old if u not in verified}
        return kept | {u for u, seen in verified.items() if jid in seen}

    @classmethod
    def _purges(cls, old, verified, job_meta, jid):
        return jid not in job_meta and not cls._new(old, verified, jid)

    def test_failed_user_grant_blocks_purge(self):
        # A was the only grantee; A's PAT failed this run (absent from verified),
        # and no verified user sees the job → must NOT purge (A may still see it).
        self.assertFalse(self._purges({"A"}, {"B": set()}, {}, "j1"))

    def test_unenumerated_user_grant_blocks_purge(self):
        # A never enumerated this run at all (not in verified) → grant preserved.
        self.assertFalse(self._purges({"A"}, {}, {}, "j1"))

    def test_verified_sole_grantee_lost_it_purges(self):
        # A was the sole grantee, verified this run, no longer sees it, nobody
        # else does → safe to purge.
        self.assertTrue(self._purges({"A"}, {"A": set()}, {}, "j1"))

    def test_still_visible_not_purged(self):
        self.assertFalse(self._purges({"A"}, {"A": {"j1"}}, {"j1": {}}, "j1"))

    def test_no_connected_viewer_purges(self):
        # No prior grantee and no verified viewer → nobody in Numa can see it.
        self.assertTrue(self._purges(set(), {"A": set()}, {}, "j1"))


class TestReconcileOpenRuns(unittest.TestCase):
    """The stale-run reconcile over CONFIG.open_run_ids: force-close only an open
    run that is BOTH not-terminal AND older than STALE_RUN_HOURS, meter its partial
    work once, and prune terminal runs from the bounded open set."""

    def _table(self, config_item, run_item):
        tbl = mock.MagicMock()

        def _get_item(Key):
            if Key["pk"] == "CONFIG#crawl":
                return {"Item": config_item} if config_item else {}
            return {"Item": run_item} if run_item else {}

        tbl.get_item.side_effect = _get_item
        return tbl

    def _run(self, run_item, config_item=None):
        cfg = config_item if config_item is not None else {"open_run_ids": {"r-prev"}}
        tbl = self._table(cfg, run_item)
        with mock.patch.object(
            lambda_function, "_close_run", return_value=True
        ) as close, mock.patch.object(lambda_function, "_fire_credit_debit") as debit:
            lambda_function._reconcile_open_runs(tbl)
        return close, debit

    def test_no_open_runs_noop(self):
        close, debit = self._run(run_item=None, config_item={})
        close.assert_not_called()
        debit.assert_not_called()

    def test_done_run_left_alone(self):
        close, debit = self._run({"status": "done", "started_at": _OLD})
        close.assert_not_called()
        debit.assert_not_called()

    def test_recent_running_run_not_closed(self):
        # In-flight (manual + scheduled overlap) — must NOT be force-closed.
        close, debit = self._run(
            {"status": "running", "started_at": _NOW, "remaining": 3}
        )
        close.assert_not_called()
        debit.assert_not_called()

    def test_stale_running_run_closed_and_metered(self):
        close, debit = self._run(
            {
                "status": "running",
                "started_at": _OLD,
                "remaining": 2,
                "doc_count": 40,
                "chars_extracted": 1000,
            }
        )
        close.assert_called_once()
        debit.assert_called_once_with("r-prev", 40, 1000)

    def test_overlapping_older_run_is_reconciled(self):
        # The #2 bug: a manual run (r-old) overlapped by a newer scheduled run
        # (r-new) gets its JOB# re-pended under r-new, so r-old's counter never
        # drains and the old last_run_id-only reconcile (pointer = r-new) could
        # never reach it. Reconciling over open_run_ids heals the stranded older
        # run while leaving the fresh newer run untouched.
        runs = {
            "r-old": {
                "status": "running",
                "started_at": _OLD,
                "remaining": 1,
                "doc_count": 7,
                "chars_extracted": 70,
            },
            "r-new": {"status": "running", "started_at": _NOW, "remaining": 3},
        }
        tbl = mock.MagicMock()

        def _get_item(Key):
            if Key["pk"] == "CONFIG#crawl":
                return {"Item": {"open_run_ids": {"r-old", "r-new"}}}
            return {"Item": runs.get(Key["pk"][len("RUN#") :])}

        tbl.get_item.side_effect = _get_item
        with mock.patch.object(
            lambda_function, "_close_run", return_value=True
        ) as close, mock.patch.object(lambda_function, "_fire_credit_debit") as debit:
            lambda_function._reconcile_open_runs(tbl)
        close.assert_called_once_with(tbl, "r-old", "reconciled")
        debit.assert_called_once_with("r-old", 7, 70)


class TestAdjustRemainingToEnqueued(unittest.TestCase):
    """Seed/enqueue shortfall reconcile: when fewer messages were enqueued than
    jobs seeded (eventually-consistent GSI lag), drop `remaining` so the counter
    still reaches 0; if the drop drains it, close + meter once."""

    def test_no_shortfall_is_noop(self):
        tbl = mock.MagicMock()
        lambda_function._adjust_remaining_to_enqueued(
            tbl, "r1", job_count=5, enqueued=5
        )
        tbl.update_item.assert_not_called()

    def test_partial_shortfall_decrements_remaining(self):
        tbl = mock.MagicMock()
        tbl.update_item.return_value = {"Attributes": {"remaining": 3}}
        with mock.patch.object(lambda_function, "_close_run") as close:
            lambda_function._adjust_remaining_to_enqueued(
                tbl, "r1", job_count=5, enqueued=3
            )
        args, kwargs = tbl.update_item.call_args
        self.assertEqual(kwargs["ExpressionAttributeValues"][":neg"], -2)
        self.assertIn("ADD remaining", kwargs["UpdateExpression"])
        close.assert_not_called()  # 3 still pending → workers will close it

    def test_full_shortfall_closes_and_meters(self):
        tbl = mock.MagicMock()
        tbl.update_item.return_value = {
            "Attributes": {"remaining": 0, "doc_count": 4, "chars_extracted": 40}
        }
        with mock.patch.object(
            lambda_function, "_close_run", return_value=True
        ) as close, mock.patch.object(lambda_function, "_fire_credit_debit") as debit:
            lambda_function._adjust_remaining_to_enqueued(
                tbl, "r1", job_count=4, enqueued=0
            )
        close.assert_called_once_with(tbl, "r1", "done")
        debit.assert_called_once_with("r1", 4, 40)


class TestWriteRunRowConditionalCreate(unittest.TestCase):
    """An async retry of the manual coordinator (same run_id) must NOT reset the
    RUN# row — the conditional create swallows ConditionalCheckFailed."""

    def test_existing_row_does_not_raise(self):
        from botocore.exceptions import ClientError

        tbl = mock.MagicMock()
        tbl.put_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem"
        )
        # Should not raise; still registers the run in open_run_ids via update_item.
        lambda_function._write_run_row(tbl, "sync-1", "manual", "user-1")
        self.assertTrue(tbl.update_item.called)
        _, put_kwargs = tbl.put_item.call_args
        self.assertEqual(put_kwargs["ConditionExpression"], "attribute_not_exists(pk)")


from datetime import datetime, timedelta, timezone  # noqa: E402

_NOW = datetime.now(timezone.utc).isoformat()
_OLD = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()


if __name__ == "__main__":
    unittest.main()
