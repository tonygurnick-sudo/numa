"""Tests for the per-user Cognito group cache in the ops bridge.

These guard BUG-262 (TASK-181 SEC): the module-level ``_USER_GROUPS_CACHE``
persists across invocations on a warm Lambda container. It must never serve
one user's Cognito groups to a different user, and entries must be
time-bounded so a long-lived warm container cannot return stale membership.
"""

# pylint: disable=protected-access

from __future__ import annotations

import pytest

from tools import ops


class FakeCognito:
    """Records every admin_list_groups_for_user call and returns canned groups."""

    def __init__(self, groups_by_user: dict[str, list[str]]) -> None:
        self._groups_by_user = groups_by_user
        self.calls: list[str] = []

    def admin_list_groups_for_user(self, UserPoolId, Username):  # noqa: N803
        self.calls.append(Username)
        groups = self._groups_by_user.get(Username, [])
        return {"Groups": [{"GroupName": g} for g in groups]}


@pytest.fixture(autouse=True)
def _isolate_cache_and_cognito(monkeypatch):
    """Clean cache + a valid USER_POOL_ID so lookups aren't short-circuited."""
    ops._USER_GROUPS_CACHE.clear()
    monkeypatch.setattr(ops, "USER_POOL_ID", "pool-test")
    yield
    ops._USER_GROUPS_CACHE.clear()


def _patch_cognito(monkeypatch, fake: FakeCognito) -> None:
    monkeypatch.setattr(ops, "prm_client", lambda *a, **k: fake)


def test_groups_never_cross_users(monkeypatch):
    """Each user_sub resolves to its own groups, never another user's."""
    fake = FakeCognito({"sub-admin": ["admin"], "sub-plain": []})
    _patch_cognito(monkeypatch, fake)

    assert ops._resolve_user_groups("sub-admin", None) == ["admin"]
    # A different user on the same warm container must NOT inherit the cache.
    assert ops._resolve_user_groups("sub-plain", None) == []
    # And the admin entry is still keyed strictly to its own sub.
    assert ops._resolve_user_groups("sub-admin", None) == ["admin"]


def test_cache_hit_within_ttl_avoids_second_cognito_call(monkeypatch):
    fake = FakeCognito({"sub-admin": ["admin"]})
    _patch_cognito(monkeypatch, fake)
    # Freeze time so the entry stays within its TTL.
    monkeypatch.setattr(ops.time, "monotonic", lambda: 1000.0)

    assert ops._resolve_user_groups("sub-admin", None) == ["admin"]
    assert ops._resolve_user_groups("sub-admin", None) == ["admin"]
    assert fake.calls == ["sub-admin"]  # only one Cognito lookup


def test_entry_expires_after_ttl_and_refetches(monkeypatch):
    """A stale entry must not be served; it triggers a fresh Cognito lookup."""
    fake = FakeCognito({"sub-admin": ["admin"]})
    _patch_cognito(monkeypatch, fake)

    now = {"t": 1000.0}
    monkeypatch.setattr(ops.time, "monotonic", lambda: now["t"])

    assert ops._resolve_user_groups("sub-admin", None) == ["admin"]
    # Advance past the TTL — the cached entry must be considered expired.
    now["t"] = 1000.0 + ops._USER_GROUPS_CACHE_TTL_S + 1.0
    assert ops._resolve_user_groups("sub-admin", None) == ["admin"]
    assert fake.calls == ["sub-admin", "sub-admin"]  # refetched after expiry


def test_hint_short_circuits_cache(monkeypatch):
    """A forwarded hint is authoritative and never hits Cognito."""
    fake = FakeCognito({"sub-admin": ["admin"]})
    _patch_cognito(monkeypatch, fake)

    assert ops._resolve_user_groups("sub-admin", ["custom-group"]) == ["custom-group"]
    assert fake.calls == []
