"""Tests for the Numa Voice config-writer handler."""

import os
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from aws_lambda_powertools.utilities.typing import LambdaContext

os.environ["CLIENT_CONFIG_TABLE_NAME"] = "test-client-config"

import lambda_function as lf
from security_validator import SecurityValidationError


class _FakeCtx:
    function_name = "numa-voice-config-writer"


def _Ctx() -> LambdaContext:  # noqa: N802 — keep call-site spelling
    return cast(LambdaContext, _FakeCtx())


def _validation(client_name="arcanum-demo-tony"):
    return {
        "validated": True,
        "caller_account_id": "905418183804",
        "role_name": f"{client_name}_voice-admin",
    }


class TestDidCleaning:
    def test_keeps_valid_e164_dedup(self):
        assert lf._clean_did_numbers(
            ["+6421234567", "+6421234567", " +14155550123 "]
        ) == [
            "+6421234567",
            "+14155550123",
        ]

    def test_drops_non_e164_yielding_empty_list(self):
        # A list with no valid entries cleans to [] (not None) so releasing every
        # DID actually persists an empty list rather than leaving stale numbers.
        assert lf._clean_did_numbers(["021234567", "", "notanumber", 42]) == []

    def test_explicit_empty_list_is_empty_not_none(self):
        assert lf._clean_did_numbers([]) == []

    def test_non_list_is_none(self):
        assert lf._clean_did_numbers("nope") is None


_PROOF = "https://sts.us-east-1.amazonaws.com/?x"


class TestHandler:
    def setup_method(self):
        lf._validator = None  # reset memoized validator between tests

    def test_rejects_missing_proof(self):
        res = lf.handler({"client_name": "arcanum-demo-tony"}, _Ctx())
        assert res["statusCode"] == 400

    def test_rejects_missing_client_name(self):
        res = lf.handler({"sts_proof_url": _PROOF}, _Ctx())
        assert res["statusCode"] == 400

    def test_rejects_failed_proof_validation(self):
        with patch.object(lf, "_get_validator") as gv:
            gv.return_value.validate_request.side_effect = SecurityValidationError(
                "nope"
            )
            res = lf.handler(
                {"sts_proof_url": _PROOF, "client_name": "arcanum-demo-tony"}, _Ctx()
            )
        assert res["statusCode"] == 403

    def test_rejects_caller_not_owning_client(self):
        with patch.object(lf, "_get_validator") as gv:
            gv.return_value.validate_request.return_value = _validation()
            gv.return_value.authorize_client_write.side_effect = (
                SecurityValidationError("no")
            )
            res = lf.handler(
                {
                    "sts_proof_url": _PROOF,
                    "client_name": "someone-else",
                    "recordings_bucket": "b",
                },
                _Ctx(),
            )
        assert res["statusCode"] == 403

    def test_rejects_sibling_voice_admin_role(self):
        # BUG-242: greg's voice-admin role proven by STS, but claiming tony's
        # client_name — the role↔client binding must deny before any write.
        with patch.object(lf, "_get_validator") as gv:
            gv.return_value.validate_request.return_value = _validation(
                "arcanum-demo-greg"
            )
            gv.return_value.authorize_role_for_client.side_effect = (
                SecurityValidationError("Role not authorized for this client")
            )
            res = lf.handler(
                {
                    "sts_proof_url": _PROOF,
                    "client_name": "arcanum-demo-tony",
                    "recordings_bucket": "b",
                },
                _Ctx(),
            )
        assert res["statusCode"] == 403
        gv.return_value.authorize_role_for_client.assert_called_once_with(
            "arcanum-demo-tony", "arcanum-demo-greg_voice-admin"
        )

    def test_writes_scoped_nested_fields_for_authorized_client(self):
        table = MagicMock()
        with patch.object(lf, "_get_validator") as gv, patch.object(
            lf, "prm_resource"
        ) as prm:
            gv.return_value.validate_request.return_value = _validation()
            prm.return_value.Table.return_value = table
            res = lf.handler(
                {
                    "sts_proof_url": _PROOF,
                    "client_name": "arcanum-demo-tony",
                    "recordings_bucket": "numa-arcanum-demo-tony-connect-recordings",
                    "did_numbers": ["+6421234567"],
                    "connect_instance_url": "https://x.my.connect.aws",
                },
                _Ctx(),
            )
        assert res["statusCode"] == 200
        assert set(res["body"]["written"]) == {
            "recordingsBucket",
            "didNumbers",
            "connectInstanceUrl",
        }
        # The caller account was authorized against this client before any write.
        gv.return_value.authorize_client_write.assert_called_once_with(
            "arcanum-demo-tony", "905418183804"
        )
        # And the claimed client_name was bound to the STS-proven caller role.
        gv.return_value.authorize_role_for_client.assert_called_once_with(
            "arcanum-demo-tony", "arcanum-demo-tony_voice-admin"
        )
        kwargs = table.update_item.call_args.kwargs
        assert kwargs["Key"] == {"clientName": "arcanum-demo-tony"}
        # connectInstanceUrl is written via if_not_exists so it never clobbers.
        assert "if_not_exists(config.#ciu, :ciu)" in kwargs["UpdateExpression"]
        assert kwargs["ConditionExpression"] == "attribute_exists(clientName)"
        assert kwargs["ExpressionAttributeValues"][":dn"] == ["+6421234567"]

    def test_noop_when_nothing_to_write(self):
        table = MagicMock()
        with patch.object(lf, "_get_validator") as gv, patch.object(
            lf, "prm_resource"
        ) as prm:
            gv.return_value.validate_request.return_value = _validation()
            prm.return_value.Table.return_value = table
            res = lf.handler(
                {"sts_proof_url": _PROOF, "client_name": "arcanum-demo-tony"}, _Ctx()
            )
        assert res["statusCode"] == 200
        assert res["body"]["written"] == []
        table.update_item.assert_not_called()

    def test_missing_record_returns_404(self):
        from botocore.exceptions import ClientError

        table = MagicMock()
        table.update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem"
        )
        with patch.object(lf, "_get_validator") as gv, patch.object(
            lf, "prm_resource"
        ) as prm:
            gv.return_value.validate_request.return_value = _validation()
            prm.return_value.Table.return_value = table
            res = lf.handler(
                {
                    "sts_proof_url": _PROOF,
                    "client_name": "arcanum-demo-tony",
                    "recordings_bucket": "b",
                },
                _Ctx(),
            )
        assert res["statusCode"] == 404
