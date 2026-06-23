"""Tests for optimistic-locked secret writes and PAT-rotation retry (BUG-295).

Concurrent Synergy PAT rotations used to do an unprotected read-modify-write on
the Secrets Manager payload, silently dropping audit-history entries. These
tests cover the AWS-native optimistic-locking primitive in
``storage.upsert_secret`` and the bounded retry loop in
``lambda_function._rotate_synergy_pat`` that together prevent that loss.
"""

from __future__ import annotations

import json
import unittest
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch


class _ResourceExistsException(Exception):
    pass


class _InvalidRequestException(Exception):
    pass


class _ResourceNotFoundException(Exception):
    pass


class FakeSecretsClient:
    """Minimal stand-in for the boto3 secretsmanager client.

    Models a single existing secret with a versioned ``AWSCURRENT`` stage so the
    compare-and-swap promotion in ``upsert_secret`` can be exercised.
    """

    def __init__(self) -> None:
        self.exceptions = MagicMock()
        self.exceptions.ResourceExistsException = _ResourceExistsException
        self.exceptions.InvalidRequestException = _InvalidRequestException
        self.exceptions.ResourceNotFoundException = _ResourceNotFoundException

        self._arn = "arn:aws:secretsmanager:us-east-1:123:secret:foo"
        self._version_counter = 0
        # version_id -> SecretString
        self.versions: Dict[str, str] = {}
        # version_id currently holding AWSCURRENT
        self.current_version: str = self._new_version(json.dumps({"seed": True}))

    def _new_version(self, secret_string: str) -> str:
        self._version_counter += 1
        vid = f"v{self._version_counter}"
        self.versions[vid] = secret_string
        return vid

    # -- API surface used by storage.upsert_secret / read_secret_with_version --
    def create_secret(self, **_: Any) -> Dict[str, str]:
        raise _ResourceExistsException("already exists")

    def get_secret_value(self, **_: Any) -> Dict[str, str]:
        return {
            "ARN": self._arn,
            "VersionId": self.current_version,
            "SecretString": self.versions[self.current_version],
        }

    def put_secret_value(
        self, SecretString: str, VersionStages: List[str] | None = None, **_: Any
    ) -> Dict[str, str]:
        vid = self._new_version(SecretString)
        if not VersionStages or "AWSCURRENT" in VersionStages:
            # Unconditional overwrite path moves AWSCURRENT immediately.
            self.current_version = vid
        return {"ARN": self._arn, "VersionId": vid}

    def update_secret_version_stage(
        self,
        VersionStage: str,
        MoveToVersionId: str | None = None,
        RemoveFromVersionId: str | None = None,
        **_: Any,
    ) -> Dict[str, str]:
        if VersionStage == "AWSCURRENT":
            if RemoveFromVersionId != self.current_version:
                # CAS failed — AWSCURRENT already moved by a concurrent writer.
                raise _InvalidRequestException("AWSCURRENT no longer on version")
            self.current_version = MoveToVersionId  # type: ignore[assignment]
        return {"ARN": self._arn}


class TestUpsertSecretOptimisticLock(unittest.TestCase):
    def test_backward_compatible_unconditional_write(self) -> None:
        import storage

        fake = FakeSecretsClient()
        with patch.object(storage, "prm_client", return_value=fake):
            arn = storage.upsert_secret("name", {"x": 1})
        self.assertTrue(arn.startswith("arn:aws:secretsmanager"))
        # No version id supplied => no compare-and-swap promotion attempted.
        self.assertEqual(json.loads(fake.versions[fake.current_version]), {"x": 1})

    def test_locked_write_succeeds_when_version_unchanged(self) -> None:
        import storage

        fake = FakeSecretsClient()
        with patch.object(storage, "prm_client", return_value=fake):
            payload, version = storage.read_secret_with_version("name")
            self.assertEqual(payload, {"seed": True})
            arn = storage.upsert_secret("name", {"y": 2}, expected_version_id=version)
        self.assertTrue(arn.startswith("arn:aws:secretsmanager"))
        self.assertEqual(json.loads(fake.versions[fake.current_version]), {"y": 2})

    def test_locked_write_raises_conflict_when_version_moved(self) -> None:
        import storage

        fake = FakeSecretsClient()
        with patch.object(storage, "prm_client", return_value=fake):
            _, stale_version = storage.read_secret_with_version("name")
            # Simulate a concurrent writer advancing AWSCURRENT after our read.
            fake.current_version = fake._new_version(json.dumps({"other": True}))
            with self.assertRaises(storage.SecretConflictError):
                storage.upsert_secret(
                    "name", {"y": 2}, expected_version_id=stale_version
                )


class TestRotateSynergyPatRetry(unittest.TestCase):
    """The rotation loop must not lose history entries under write conflicts."""

    def _patched_rotation(self, fake: FakeSecretsClient) -> Any:
        import lambda_function

        rotation_resp = MagicMock()
        rotation_resp.status_code = 200
        rotation_resp.json.return_value = {"Token": "new-token-abcdef0123"}

        return (
            patch.multiple(
                lambda_function,
                httpx=MagicMock(post=MagicMock(return_value=rotation_resp)),
                _update_connector_expiry=MagicMock(),
            ),
            rotation_resp,
        )

    def test_conflict_then_success_preserves_concurrent_history(self) -> None:
        import lambda_function
        import storage

        # Seed an existing Synergy secret with one prior history entry.
        fake = FakeSecretsClient()
        seed_payload = {
            "access_token": "old-token-0000000000",
            "pat_created_at": "2026-01-01T00:00:00+00:00",
            "pat_expires_at": "2026-04-01T00:00:00+00:00",
            "pat_history": [{"token_prefix": "ancient...", "reason": "auto_rotation"}],
        }
        fake.current_version = fake._new_version(json.dumps(seed_payload))

        # First promotion attempt loses the CAS race; storage re-reads and the
        # second attempt wins. We inject the race by advancing AWSCURRENT (with a
        # rival's appended history entry) exactly once, on the first promotion.
        real_update = fake.update_secret_version_stage
        state = {"injected": False}

        def racing_update(*args: Any, **kwargs: Any) -> Any:
            if kwargs.get("VersionStage") == "AWSCURRENT" and not state["injected"]:
                state["injected"] = True
                rival = {
                    **seed_payload,
                    "access_token": "rival-token-1111111",
                    "pat_history": seed_payload["pat_history"]
                    + [{"token_prefix": "rival...", "reason": "auto_rotation"}],
                }
                fake.current_version = fake._new_version(json.dumps(rival))
            return real_update(*args, **kwargs)

        cm, _ = self._patched_rotation(fake)
        with patch.object(storage, "prm_client", return_value=fake), cm, patch.object(
            fake, "update_secret_version_stage", side_effect=racing_update
        ), patch("connectors.synergy._build_base_url", return_value="https://s"), patch(
            "connectors.synergy._normalize_token", return_value="Bearer t"
        ):
            result = lambda_function._rotate_synergy_pat(
                "https://s", "old-token-0000000000", seed_payload, "table", "user-1"
            )

        self.assertIsNotNone(result)
        assert result is not None
        new_token, _expires = result
        self.assertEqual(new_token, "new-token-abcdef0123")

        final = json.loads(fake.versions[fake.current_version])
        self.assertEqual(final["access_token"], "new-token-abcdef0123")
        prefixes = [h.get("token_prefix") for h in final["pat_history"]]
        # The rival's entry survived (not clobbered) and our supersede entry was
        # appended on top — no history lost under the conflict.
        self.assertIn("rival...", prefixes)
        self.assertIn("ancient...", prefixes)
        self.assertTrue(state["injected"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
