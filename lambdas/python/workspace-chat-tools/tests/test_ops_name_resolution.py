"""Tests for the ops bridge name → ID resolution layer.

These guard against the BUG-081 failure mode where the model would
hallucinate stage IDs (e.g. ``custom-1771234-abc``) instead of looking
them up. The resolver now lets the model pass ``stageName`` /
``customerName`` / ``assigneeName`` and the bridge does the lookup.
"""

# pylint: disable=protected-access

from __future__ import annotations

import pytest

from tools import ops


class FakeCache:
    """Stand-in for _LookupCache returning canned data for tests.

    Any unused method falls back to empty results.
    """

    def teams(self):
        return [
            {"id": "team-eng", "name": "Engineering"},
            {"id": "team-sales", "name": "Sales"},
        ]

    def team_details(self, team_id):
        if team_id != "team-eng":
            return {}
        return {
            "team": {"id": "team-eng", "name": "Engineering"},
            "zones": [
                {"id": "zone-backlog", "name": "Backlog", "zoneType": "backlog"},
                {"id": "zone-board", "name": "Board", "zoneType": "board"},
            ],
            "stages": [
                {"id": "stage-triage", "name": "Triage", "zoneId": "zone-backlog"},
                {"id": "stage-funnel-12345", "name": "Funnel", "zoneId": "zone-board"},
                {"id": "stage-done-1", "name": "Done", "zoneId": "zone-backlog"},
                {"id": "stage-done-2", "name": "Done", "zoneId": "zone-board"},
            ],
        }

    def config(self):
        return {
            "ticketTypes": [
                {"id": "tt-bug", "name": "Bug", "prefix": "BUG"},
                {"id": "tt-feat", "name": "Feature", "prefix": "FEAT"},
            ],
            "staff": [
                {"id": "sub-tom", "name": "Tom Wiltshire", "email": "tom@arcanum.ai"},
                {"id": "sub-greg", "name": "Greg Frantzen", "email": "greg@arcanum.ai"},
            ],
            "projects": [
                {"id": "proj-q1", "name": "Q1 Roadmap", "isActive": True},
            ],
            "crmConfig": {
                "lifecycleStages": [
                    {"id": "stage-prospect", "name": "Prospect"},
                    {"id": "stage-active", "name": "Active"},
                    {"id": "stage-funnel-cust", "name": "Funnel"},
                ],
            },
            "supplierConfig": {
                "lifecycleStages": [
                    {"id": "ssup-active", "name": "Active"},
                    {"id": "ssup-paused", "name": "Paused"},
                ],
            },
        }

    def customers_by_search(self, term):
        if "acme" in term.lower():
            return [{"id": "cust-acme", "companyName": "Acme Corp"}]
        return []

    def suppliers_by_search(self, _term):
        return []

    def work_units(self, _team_id):
        return [{"id": "wu-sprint1", "name": "Sprint 1", "status": "active"}]


def test_full_create_ticket_resolves_all_names():
    params = {
        "teamName": "Engineering",
        "stageName": "Triage",
        "ticketTypeName": "Bug",
        "assigneeName": "Tom",
        "title": "Test ticket",
        "priority": "high",
    }
    ops._resolve_names_in_params(params, FakeCache())
    assert params["teamId"] == "team-eng"
    assert params["stageId"] == "stage-triage"
    assert params["ticketTypeId"] == "tt-bug"
    assert params["assigneeId"] == "sub-tom"
    # Canonical name replaces partial input
    assert params["assigneeName"] == "Tom Wiltshire"
    # Lookup-only keys are popped
    assert "teamName" not in params
    assert "stageName" not in params
    assert "ticketTypeName" not in params


def test_stage_ambiguity_surfaces_zone_options():
    params = {"teamName": "Engineering", "stageName": "Done"}
    with pytest.raises(ValueError) as exc_info:
        ops._resolve_names_in_params(params, FakeCache())
    msg = str(exc_info.value)
    assert "Backlog" in msg and "Board" in msg
    assert "zoneName" in msg or "stageId" in msg


def test_stage_disambiguation_via_zone_name():
    params = {"teamName": "Engineering", "stageName": "Done", "zoneName": "Board"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["stageId"] == "stage-done-2"


def test_id_wins_over_name():
    params = {"teamId": "team-eng", "teamName": "Sales"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["teamId"] == "team-eng"
    assert "teamName" not in params


def test_stage_without_team_raises_clear_error():
    params = {"stageName": "Triage"}
    with pytest.raises(ValueError) as exc_info:
        ops._resolve_names_in_params(params, FakeCache())
    msg = str(exc_info.value).lower()
    assert "without" in msg and "team" in msg


def test_missing_stage_lists_available_options():
    params = {"teamName": "Engineering", "stageName": "Marshmallow"}
    with pytest.raises(ValueError) as exc_info:
        ops._resolve_names_in_params(params, FakeCache())
    msg = str(exc_info.value)
    assert "Marshmallow" in msg
    # Available stages should be listed so the agent can ask the user
    assert "Funnel" in msg and "Triage" in msg


def test_customer_name_resolves_to_id_with_canonical_name():
    params = {"customerName": "Acme Corp"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["customerId"] == "cust-acme"
    assert params["customerName"] == "Acme Corp"


def test_lifecycle_stage_routes_to_supplier_config_in_supplier_context():
    params = {"lifecycleStageName": "Active"}
    ops._resolve_names_in_params(params, FakeCache(), is_supplier_context=True)
    assert params["lifecycleStage"] == "ssup-active"


def test_lifecycle_stage_defaults_to_customer_config():
    params = {"lifecycleStageName": "Funnel"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["lifecycleStage"] == "stage-funnel-cust"


def test_partial_staff_name_canonicalizes_to_full_name():
    params = {"assigneeName": "tom"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["assigneeId"] == "sub-tom"
    assert params["assigneeName"] == "Tom Wiltshire"


def test_bulk_update_changes_resolves_with_parent_team():
    top = {"teamName": "Engineering", "ticketIds": ["t1"]}
    ops._resolve_names_in_params(top, FakeCache())
    changes = {"stageName": "Triage", "assigneeName": "Greg"}
    ops._resolve_names_in_params(changes, FakeCache(), parent_team_id=top["teamId"])
    assert changes["stageId"] == "stage-triage"
    assert changes["assigneeId"] == "sub-greg"


def test_ticket_type_resolves_by_prefix():
    params = {"ticketTypeName": "FEAT"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["ticketTypeId"] == "tt-feat"


def test_board_name_alias_for_team_name():
    params = {"boardName": "Sales"}
    ops._resolve_names_in_params(params, FakeCache())
    assert params["teamId"] == "team-sales"


def test_no_name_fields_is_a_no_op():
    """Resolution shouldn't disturb params when no name fields are present."""
    params = {"teamId": "team-eng", "stageId": "stage-triage", "title": "X"}
    before = dict(params)
    ops._resolve_names_in_params(params, FakeCache())
    assert params == before


def test_unknown_customer_raises_not_found():
    params = {"customerName": "DoesNotExist"}
    with pytest.raises(ValueError) as exc_info:
        ops._resolve_names_in_params(params, FakeCache())
    assert "DoesNotExist" in str(exc_info.value)
