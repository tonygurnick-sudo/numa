import os
import types

# Env must be set before importing the module (read at load time).
os.environ["CREDIT_METERING_ENABLED"] = "true"
os.environ["CREDITS_TABLE_NAME"] = "numa-test-credit-ledger"
os.environ["CLIENT_NAME"] = "testclient"

import lambda_function as lf  # noqa: E402


class FakeTable:
    def __init__(self, config=None):
        self.puts = []
        self._config = config or {}

    def get_item(self, Key):  # noqa: N803
        if Key.get("SK") == "CONFIG" and self._config:
            return {"Item": self._config}
        return {}

    def put_item(self, Item):  # noqa: N803
        self.puts.append(Item)
        return {}

    def query(self, **kwargs):
        return {"Items": []}


def _patch_table(monkeypatch, table):
    monkeypatch.setattr(
        lf,
        "prm_resource",
        lambda *a, **k: types.SimpleNamespace(Table=lambda name: table),
    )


def test_meters_a_call_with_defaults(monkeypatch):
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler(
        {
            "contact_id": "c1",
            "user_sub": "sub-1",
            "duration_seconds": 60,
            "transcribed": True,
        },
        None,
    )
    # 60s = 0.064 USD → floor at low margin (1.15), credit_usd 0.30 → ceil(0.2453) = 1 credit
    assert res["consumption_usd"] == 0.064
    assert res["credits"] == 1

    meta = next(p for p in table.puts if p.get("SK") == "META")
    assert meta["PK"] == "CONV#voice-c1"
    assert meta["source"] == "voice"
    assert meta["userSub"] == "sub-1"
    assert meta["creditsCharged"] == 1
    assert float(meta["consumptionCostUsd"]) == 0.064
    assert meta["GSI1PK"] == "USER#sub-1"
    # month aggregate written
    assert any(
        str(p.get("SK", "")).startswith("MONTH#") and p.get("PK") == "CLIENT#testclient"
        for p in table.puts
    )


def test_config_overrides_rates_and_credit_usd(monkeypatch):
    table = FakeTable(
        config={
            "creditUsd": 0.50,
            "voiceRates": {"telephonyPerMin": 0.10, "transcribePerMin": 0.0},
        }
    )
    _patch_table(monkeypatch, table)
    res = lf.handler(
        {
            "contact_id": "c2",
            "user_sub": "sub-2",
            "duration_seconds": 60,
            "transcribed": True,
        },
        None,
    )
    # telephony 0.10/min only (transcribe 0) = 0.10 USD; floor at 1.15 margin, credit_usd 0.50 → ceil(0.23)=1
    assert res["consumption_usd"] == 0.10
    assert res["credits"] == 1


def test_no_answer_zero_cost(monkeypatch):
    table = FakeTable()
    _patch_table(monkeypatch, table)
    res = lf.handler(
        {
            "contact_id": "c3",
            "user_sub": "s",
            "duration_seconds": 0,
            "transcribed": False,
        },
        None,
    )
    assert res["consumption_usd"] == 0.0
    assert res["credits"] == 0


def test_skips_when_metering_disabled(monkeypatch):
    monkeypatch.setattr(lf, "METERING_ENABLED", False)
    res = lf.handler(
        {"contact_id": "c4", "user_sub": "s", "duration_seconds": 60}, None
    )
    assert res == {"skipped": "metering_disabled"}


def test_skips_without_ids(monkeypatch):
    monkeypatch.setattr(lf, "METERING_ENABLED", True)
    _patch_table(monkeypatch, FakeTable())
    assert lf.handler({"duration_seconds": 60}, None)["skipped"] == "missing_ids"
