"""Synergy KB crawler — restart Lambda.

Starts a fresh execution of the Synergy crawl Step Function to continue draining
pending jobs when the current execution approaches the Step Functions history
event limit. Carries forward the crawl identity (run_id + credential pointer)
and the job counter, but starts a new event counter. Mirrors restart-crawler.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from prm import client as prm_client

logger = structlog.get_logger()
sfn = prm_client("stepfunctions")


def handler(event: Dict[str, Any], _: LambdaContext) -> Dict[str, Any]:
    state_machine_arn = event.get("stateMachineArn")
    if not state_machine_arn:
        # Raise (don't swallow): the SFN task is End:true, so a soft error
        # return would end the execution "successfully" with every remaining
        # pending job stranded until the next coordinator pass.
        raise ValueError("Missing state machine ARN")

    input_data = event.get("input", {}) or {}

    # Carry forward crawl identity + credential pointer; the PAT itself is never
    # in the input — only the vault secret_id the coordinator/worker resolve.
    clean_input = {
        "continue": True,
        "run_id": input_data.get("run_id", "unknown"),
        "user_sub": input_data.get("user_sub", "anonymous"),
        "secret_id": input_data.get("secret_id", ""),
        "instance_url": input_data.get("instance_url", ""),
        "counter": input_data.get("counter", 0),
    }

    execution_name = f"continuation-{uuid.uuid4()}"
    try:
        response = sfn.start_execution(
            stateMachineArn=state_machine_arn,
            name=execution_name,
            input=json.dumps(clean_input),
        )
    except Exception as e:  # noqa: BLE001
        # Re-raise so the SFN RestartExecution task FAILS (and its Retry block
        # fires) instead of the execution ending cleanly with the run stranded.
        logger.error("synergy_restart_error", error=str(e), exc_info=True)
        raise

    logger.info(
        "synergy_restart_started",
        _name="SYNERGY_CRAWL_RESTART",
        execution_arn=response["executionArn"],
        run_id=clean_input["run_id"],
    )
    return {
        "status": "success",
        "executionArn": response["executionArn"],
        "executionName": execution_name,
    }
