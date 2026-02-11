"""
Helpers for invoking the secure Pipedream proxy lambda.
"""

import json
import random
import time
import uuid
from typing import Any, Dict

import structlog
from botocore.config import Config
from botocore.exceptions import ClientError
from botocore.session import Session

from ....config import PIPEDREAM_PROXY_LAMBDA_ARN, get_lambda_client

logger = structlog.get_logger(__name__)


def generate_sts_proof_url(region: str = "us-east-1", expires: int = 60) -> str:
    """
    Generate STS presigned GetCallerIdentity URL for identity verification.
    """
    try:
        session = Session()
        sts_client: Any = session.create_client("sts", region_name=region)
        presigned_url = sts_client.generate_presigned_url(
            "get_caller_identity",
            Params={},
            ExpiresIn=expires,
            HttpMethod="GET",
        )
        logger.critical(
            (
                "RELIABILITY_CRITICAL: STS proof URL using dangerously short fixed expiry - "
                "VERY HIGH RISK of timing failures"
            ),
            expires_in_seconds=expires,
            generated_at=time.time(),
            expiry_timestamp=time.time() + expires,
            expiry_window_concern=expires < 120,
            risk_level="CRITICAL",
            timing_buffer_seconds=expires
            - 30,  # Effective usable time after network delays
            reliability_concerns=[
                "fixed_60_second_expiry_insufficient_under_any_load",
                "no_adaptive_expiry_based_on_current_system_conditions",
                "lambda_cold_starts_regularly_exceed_proof_validity_window",
                "network_latency_variations_cause_unpredictable_expiration",
                "no_grace_period_for_processing_delays",
                "proxy_processing_time_not_accounted_for_in_expiry",
            ],
            intermittent_failure_scenarios=[
                "authentication_failures_during_peak_traffic_hours",
                "cold_start_delays_causing_systematic_proof_expiration",
                "network_latency_spikes_invalidating_fresh_proofs",
                "inconsistent_user_experience_based_purely_on_timing",
                "same_integration_request_works_then_fails_randomly",
                "difficult_to_reproduce_timing_dependent_failures",
            ],
            system_condition_factors=[
                "lambda_cold_start_duration_1_to_10_seconds",
                "network_round_trip_time_varies_100ms_to_2_seconds",
                "proxy_processing_time_2_to_5_seconds_typical",
                "total_time_budget_often_exceeds_60_seconds",
                "fixed_60_second_expiry_insufficient_under_load",
                "no_adaptive_expiry_based_on_system_conditions",
                "lambda_cold_starts_may_exceed_proof_validity",
                "network_latency_can_cause_proof_expiration",
                "proxy_processing_time_not_accounted_for_in_expiry",
            ],
        )

        # RELIABILITY IMPROVEMENT NEEDED: Implement adaptive STS proof expiry and retry mechanism
        # RATIONALE: The current implementation uses a fixed 60-second expiry for STS proof URLs,
        # which causes intermittent authentication failures that appear random to users. The failures
        # occur when system conditions (load, network latency, Lambda cold starts) cause the proof
        # to expire before the proxy can use it. Users experience the same request working sometimes
        # but failing other times based on system timing.
        # CONSEQUENCE OF NOT FIXING: Users experience inconsistent authentication where:
        # - Same requests work under normal conditions but fail during high load
        # - Authentication failures appear random and timing-dependent
        # - Cold starts cause authentication timeouts that seem unpredictable
        # - Network latency variations lead to intermittent proof expiration
        # - User experience degrades unpredictably during peak usage periods
        # CONSEQUENCE OF FIXING: With adaptive expiry and retry, the system would have:
        # - Consistent authentication behavior regardless of system load conditions
        # - Automatic adaptation to network and infrastructure timing variations
        # - Reliable recovery from transient authentication timing issues
        # - Predictable user experience even under variable system conditions
        # - Better resilience to Lambda cold starts and network latency
        #
        # ADAPTIVE STS PROOF EXPIRY FIX - COMMENTED OUT BUT READY FOR IMPLEMENTATION
        # import random
        # import boto3
        # from typing import Tuple
        # from datetime import datetime, timedelta
        #
        # def get_current_system_load_factor() -> float:
        #     """Estimate current system load based on available metrics."""
        #     try:
        #         # Check Lambda concurrency metrics
        #         cloudwatch = boto3.client('cloudwatch')
        #         # Get current Lambda concurrency (simplified example)
        #         # In practice, would aggregate multiple metrics
        #         response = cloudwatch.get_metric_statistics(
        #             Namespace='AWS/Lambda',
        #             MetricName='ConcurrentExecutions',
        #             Dimensions=[{'Name': 'FunctionName', 'Value': 'numa-chat-agent'}],
        #             StartTime=datetime.now() - timedelta(minutes=1),
        #             EndTime=datetime.now(),
        #             Period=60,
        #             Statistics=['Average']
        #         )
        #
        #         if response['Datapoints']:
        #             concurrent_executions = response['Datapoints'][-1]['Average']
        #             # Normalize to 0-1 scale based on account limits
        #             load_factor = min(concurrent_executions / 1000, 1.0)  # Assume 1000 as high load threshold
        #             return load_factor
        #
        #         return 0.1  # Default low load
        #     except Exception:
        #         return 0.5  # Default medium load when metrics unavailable
        #
        # def generate_adaptive_sts_proof_url(base_expiry: int = 60, max_retries: int = 3) -> Tuple[str, int]:
        #     """Generate STS proof URL with adaptive expiry based on system conditions."""
        #     generation_start = time.time()
        #
        #     # Assess current system load and adjust expiry accordingly
        #     load_factor = get_current_system_load_factor()
        #     logger.info(
        #         "STS_ADAPTIVE_EXPIRY: Calculating adaptive expiry based on system load",
        #         load_factor=load_factor,
        #         base_expiry_seconds=base_expiry
        #     )
        #
        #     if load_factor > 0.8:  # High load conditions
        #         adjusted_expiry = base_expiry * 4  # 240 seconds for high load
        #         logger.warning(
        #             "STS_HIGH_LOAD: Using extended expiry due to high system load",
        #             load_factor=load_factor,
        #             adjusted_expiry_seconds=adjusted_expiry
        #         )
        #     elif load_factor > 0.5:  # Medium load conditions
        #         adjusted_expiry = base_expiry * 2  # 120 seconds for medium load
        #         logger.info(
        #             "STS_MEDIUM_LOAD: Using moderate expiry extension for medium load",
        #             load_factor=load_factor,
        #             adjusted_expiry_seconds=adjusted_expiry
        #         )
        #     else:  # Low load conditions
        #         adjusted_expiry = base_expiry  # 60 seconds for low load
        #         logger.info(
        #             "STS_LOW_LOAD: Using standard expiry for low load conditions",
        #             load_factor=load_factor,
        #             adjusted_expiry_seconds=adjusted_expiry
        #         )
        #
        #     # Add jitter to prevent thundering herd effects
        #     jitter = random.randint(5, 15)  # 5-15 second jitter
        #     final_expiry = min(adjusted_expiry + jitter, 300)  # Cap at 5 minutes for security
        #
        #     logger.info(
        #         "STS_FINAL_EXPIRY: Calculated final expiry with jitter",
        #         base_expiry=base_expiry,
        #         adjusted_expiry=adjusted_expiry,
        #         jitter_seconds=jitter,
        #         final_expiry_seconds=final_expiry
        #     )
        #
        #     # Retry generation with exponential backoff
        #     last_exception = None
        #     for attempt in range(max_retries):
        #         try:
        #             attempt_start = time.time()
        #             logger.info(
        #                 "STS_GENERATION_ATTEMPT: Attempting STS proof URL generation",
        #                 attempt=attempt + 1,
        #                 max_attempts=max_retries,
        #                 expiry_seconds=final_expiry
        #             )
        #
        #             sts_url = sts_client.generate_presigned_url(
        #                 'get_caller_identity',
        #                 Params={},
        #                 ExpiresIn=final_expiry,
        #                 HttpMethod='GET'
        #             )
        #
        #             attempt_duration = time.time() - attempt_start
        #             total_duration = time.time() - generation_start
        #
        #             logger.info(
        #                 "STS_GENERATION_SUCCESS: STS proof URL generated successfully with adaptive expiry",
        #                 attempt=attempt + 1,
        #                 final_expiry_seconds=final_expiry,
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 total_duration_ms=round(total_duration * 1000, 2),
        #                 reliability_enhancement="ADAPTIVE_EXPIRY_WITH_RETRY"
        #             )
        #
        #             return sts_url, final_expiry
        #
        #         except Exception as e:
        #             last_exception = e
        #             attempt_duration = time.time() - attempt_start
        #
        #             logger.warning(
        #                 "STS_GENERATION_RETRY: STS proof generation failed, will retry",
        #                 attempt=attempt + 1,
        #                 max_attempts=max_retries,
        #                 error_type=type(e).__name__,
        #                 error=str(e),
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2)
        #             )
        #
        #             if attempt < max_retries - 1:
        #                 # Exponential backoff with jitter
        #                 backoff_delay = (0.1 * (2 ** attempt)) + (random.uniform(0, 0.1))
        #                 logger.info(
        #                     "STS_GENERATION_BACKOFF: Applying exponential backoff before retry",
        #                     backoff_delay_seconds=backoff_delay,
        #                     next_attempt=attempt + 2
        #                 )
        #                 time.sleep(backoff_delay)
        #
        #     # All attempts failed
        #     total_duration = time.time() - generation_start
        #     logger.error(
        #         "STS_GENERATION_FAILED: All STS proof URL generation attempts failed",
        #         total_attempts=max_retries,
        #         total_duration_ms=round(total_duration * 1000, 2),
        #         final_error=str(last_exception) if last_exception else "Unknown error"
        #     )
        #     raise last_exception or Exception("STS proof URL generation failed after all retries")
        #
        # # Generate adaptive STS proof URL instead of fixed expiry
        # sts_proof_url, actual_expiry = generate_adaptive_sts_proof_url()
        # logger.info(
        #     "STS_PROOF_ADAPTIVE: Using adaptive STS proof URL with system-aware expiry",
        #     actual_expiry_seconds=actual_expiry,
        #     reliability_improvement="ENABLED"
        # )

        return presigned_url

    except Exception as exc:  # pragma: no cover - defensive logging
        logger.error("Failed to generate STS proof URL", error=str(exc))
        raise ValueError(f"STS proof URL generation failed: {exc}") from exc


def _invoke_lambda_with_retry(
    lambda_client,
    function_arn: str,
    payload: Dict[str, Any],
    invocation_id: str,
    max_retries: int = 3,
    base_timeout: int = 30,
) -> Dict[str, Any]:
    """Invoke Lambda with retry logic, timeout controls, and error handling.

    Args:
        lambda_client: Boto3 Lambda client
        function_arn: Lambda function ARN to invoke
        payload: JSON payload to send
        invocation_id: Unique invocation ID for logging
        max_retries: Maximum retry attempts
        base_timeout: Base timeout in seconds

    Returns:
        Lambda response dictionary

    Raises:
        Exception: After all retries are exhausted
    """
    # Configure resilient client with timeouts
    resilient_config = Config(
        retries={"max_attempts": 1},  # We handle retries manually
        read_timeout=base_timeout,
        connect_timeout=10,
        max_pool_connections=10,
    )

    # Create a new client with timeout configuration
    resilient_lambda_client = lambda_client.__class__(
        lambda_client.meta.region_name, config=resilient_config
    )

    last_exception = None
    total_start = time.time()

    for attempt in range(max_retries):
        attempt_start = time.time()
        adaptive_timeout = base_timeout + (attempt * 10)  # Increase timeout on retries

        logger.info(
            "LAMBDA_INVOKE_ATTEMPT: Attempting proxy Lambda invocation with timeout control",
            attempt=attempt + 1,
            max_attempts=max_retries,
            function_arn=function_arn,
            timeout_seconds=adaptive_timeout,
            invocation_id=invocation_id,
            resilience_features=[
                "timeout_control",
                "retry_logic",
                "exponential_backoff",
            ],
        )

        try:
            response = resilient_lambda_client.invoke(
                FunctionName=function_arn,
                Payload=json.dumps(payload),
                InvocationType="RequestResponse",
            )

            attempt_duration = time.time() - attempt_start
            total_duration = time.time() - total_start

            # Check for function errors
            if response.get("FunctionError"):
                error_type = response.get("FunctionError")
                logger.warning(
                    "LAMBDA_FUNCTION_ERROR: Lambda returned function error - may be retryable",
                    function_error_type=error_type,
                    attempt=attempt + 1,
                    attempt_duration_ms=round(attempt_duration * 1000, 2),
                    invocation_id=invocation_id,
                )

                # Function errors might be retryable depending on type
                if attempt < max_retries - 1 and error_type in [
                    "Unhandled",
                    "Runtime.Unknown",
                ]:
                    last_exception = Exception(f"Function error: {error_type}")
                    continue

            logger.info(
                "RELIABILITY_SUCCESS: Resilient Lambda invocation succeeded",
                attempt=attempt + 1,
                attempt_duration_ms=round(attempt_duration * 1000, 2),
                total_duration_ms=round(total_duration * 1000, 2),
                status_code=response.get("StatusCode"),
                invocation_id=invocation_id,
                resilience_improvement="ENABLED",
            )

            return response

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            last_exception = e
            attempt_duration = time.time() - attempt_start

            # Categorize retryable vs non-retryable errors
            retryable_errors = [
                "ServiceException",
                "TooManyRequestsException",
                "RequestTimeoutException",
                "InternalServerError",
                "ResourceConflictException",
            ]
            non_retryable_errors = [
                "InvalidParameterValueException",
                "ResourceNotFoundException",
                "AccessDeniedException",
            ]

            is_retryable = (error_code in retryable_errors) or (
                error_code not in non_retryable_errors
                and attempt_duration >= adaptive_timeout * 0.9
            )

            logger.warning(
                "RELIABILITY_RETRY: Lambda invocation failed - analyzing for retry",
                attempt=attempt + 1,
                error_code=error_code,
                error_message=str(e),
                attempt_duration_ms=round(attempt_duration * 1000, 2),
                is_retryable=is_retryable,
                will_retry=is_retryable and attempt < max_retries - 1,
                invocation_id=invocation_id,
            )

            if not is_retryable or attempt == max_retries - 1:
                break

        except Exception as e:
            last_exception = e
            attempt_duration = time.time() - attempt_start

            logger.error(
                "RELIABILITY_UNEXPECTED: Unexpected error during Lambda invocation",
                attempt=attempt + 1,
                error_type=type(e).__name__,
                error=str(e),
                attempt_duration_ms=round(attempt_duration * 1000, 2),
                invocation_id=invocation_id,
            )

            if attempt == max_retries - 1:
                break

        # Apply exponential backoff with jitter
        if attempt < max_retries - 1:
            base_backoff = min((2**attempt) * 0.5, 10)  # Cap at 10 seconds
            jitter = random.uniform(0, base_backoff * 0.3)  # Up to 30% jitter
            backoff_delay = base_backoff + jitter

            logger.info(
                "RELIABILITY_BACKOFF: Applying exponential backoff with jitter",
                backoff_delay_seconds=backoff_delay,
                base_backoff=base_backoff,
                jitter_seconds=jitter,
                next_attempt=attempt + 2,
                invocation_id=invocation_id,
            )
            time.sleep(backoff_delay)

    # All attempts failed
    total_duration = time.time() - total_start
    logger.critical(
        "RELIABILITY_FAILURE: All resilient Lambda invocation attempts failed",
        total_attempts=max_retries,
        total_duration_ms=round(total_duration * 1000, 2),
        final_error=str(last_exception) if last_exception else "Unknown error",
        invocation_id=invocation_id,
    )
    raise last_exception or Exception(
        "Lambda invocation failed after all resilient retry attempts"
    )


def invoke_pipedream_proxy(operation: str, external_user_id: str, **kwargs) -> Dict:
    """
    Invoke the secure Pipedream proxy lambda for operations.
    """
    proxy_invocation_start = time.time()
    invocation_id = str(uuid.uuid4())[:8]

    logger.info(
        "PROXY_INVOCATION_START: Starting Pipedream proxy invocation",
        operation=operation,
        external_user_id=(
            external_user_id[:8] + "..."
            if len(external_user_id) > 8
            else external_user_id
        ),
        has_proxy_arn=bool(PIPEDREAM_PROXY_LAMBDA_ARN),
        kwargs_keys=list(kwargs.keys()),
        invocation_id=invocation_id,
    )

    logger.debug(
        "PROXY_INVOCATION_DETAILS: Full proxy invocation context",
        operation=operation,
        external_user_id=external_user_id,
        parameters=kwargs,
        proxy_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
        invocation_id=invocation_id,
    )

    if not PIPEDREAM_PROXY_LAMBDA_ARN:
        logger.error(
            "PROXY_INVOCATION_ERROR: Pipedream proxy not configured",
            invocation_id=invocation_id,
        )
        raise ValueError("Pipedream proxy not configured for this client")

    try:
        sts_generation_start = time.time()
        try:
            sts_proof_url = generate_sts_proof_url()
            sts_generation_duration = time.time() - sts_generation_start
            logger.info(
                "PROXY_STS_GENERATION_SUCCESS: STS proof URL generated successfully",
                sts_generation_duration_ms=round(sts_generation_duration * 1000, 2),
                sts_url_length=len(sts_proof_url),
                invocation_id=invocation_id,
            )
        except Exception as exc:
            sts_generation_duration = time.time() - sts_generation_start
            logger.error(
                "PROXY_STS_GENERATION_FAILED: Failed to generate STS proof URL",
                error_type=type(exc).__name__,
                error=str(exc),
                sts_generation_duration_ms=round(sts_generation_duration * 1000, 2),
                invocation_id=invocation_id,
            )
            raise ValueError("Identity verification setup failed") from exc

        lambda_client = get_lambda_client()

        payload = {
            "operation": operation,
            "external_user_id": external_user_id,
            "sts_proof_url": sts_proof_url,
            "parameters": kwargs,
        }

        logger.debug(
            "Invoking Pipedream proxy lambda",
            operation=operation,
            external_user_id=(
                external_user_id[:20] + "..."
                if len(external_user_id) > 20
                else external_user_id
            ),
            lambda_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
            has_sts_proof=True,
        )

        logger.critical(
            (
                "RELIABILITY_CRITICAL: Cross-account Lambda invocation is SINGLE "
                "POINT OF FAILURE with zero resilience"
            ),
            proxy_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
            operation=operation,
            user_id=(
                external_user_id[:8] + "..."
                if len(external_user_id) > 8
                else external_user_id
            ),
            risk_level="CRITICAL",
            single_point_of_failure=True,
            resilience_level="ZERO",
            reliability_concerns=[
                "single_proxy_account_bottleneck_affects_ALL_clients_simultaneously",
                "zero_retry_logic_for_network_lambda_or_account_failures",
                "no_circuit_breaker_for_proxy_service_degradation_detection",
                "no_timeout_controls_on_cross_account_invocations_causing_hangs",
                "no_fallback_mechanism_when_proxy_account_unavailable",
                "no_load_balancing_across_multiple_proxy_instances",
            ],
            intermittent_failure_risks=[
                "proxy_lambda_cold_starts_causing_systematic_timeouts",
                "network_issues_between_aws_accounts_causing_sporadic_failures",
                "proxy_account_throttling_affecting_all_clients_without_warning",
                "cross_region_network_latency_variations_causing_timing_issues",
                "aws_service_degradation_in_proxy_account_cascading_to_all_clients",
                "iam_role_assumption_failures_appearing_as_random_auth_errors",
            ],
            blast_radius_assessment={
                "affected_clients": "ALL",
                "affected_integrations": "ALL",
                "failure_correlation": "COMPLETE",
                "recovery_dependency": "SINGLE_PROXY_ACCOUNT",
            },
            sts_proof_expiry_seconds=60,
            current_invocation_timestamp=time.time(),
            estimated_processing_time_seconds="5-30",
        )

        # RELIABILITY IMPROVEMENT NEEDED: Implement retry logic and timeout controls for Lambda invocations
        # RATIONALE: The current implementation makes a single Lambda invocation with no retry logic,
        # timeout controls, or circuit breaker patterns. This causes intermittent failures when the
        # proxy Lambda experiences cold starts, network issues, or temporary service degradation.
        # Users experience the same integration request working sometimes but failing other times.
        # CONSEQUENCE OF NOT FIXING: Users experience inconsistent behavior where:
        # - Same integration requests fail randomly due to proxy Lambda cold starts
        # - Network issues between accounts cause unpredictable timeouts
        # - Proxy service degradation affects all clients simultaneously
        # - No automatic recovery from transient proxy failures
        # - Difficult debugging of cross-account network and timing issues
        # CONSEQUENCE OF FIXING: With retry logic and timeout controls, the system would have:
        # - Automatic recovery from transient proxy Lambda issues
        # - Consistent behavior regardless of proxy service timing variations
        # - Better resilience to network issues between accounts
        # - Improved user experience with reliable cross-account integration access
        # - Enhanced observability for debugging cross-account invocation issues
        #
        # PROPOSED LAMBDA INVOCATION RELIABILITY FIX:
        # import boto3
        # from botocore.config import Config
        # from botocore.exceptions import ClientError
        # import random
        #
        # def invoke_lambda_with_retry_and_timeout(
        #     lambda_client,
        #     function_arn: str,
        #     payload: dict,
        #     invocation_id: str,
        #     max_retries: int = 3,
        #     base_timeout: int = 30
        # ) -> dict:
        #     """Invoke Lambda with retry logic, timeout controls, and circuit breaking."""
        #
        #     # Configure client with timeout settings
        #     retry_config = Config(
        #         retries={'max_attempts': 1, 'mode': 'standard'},  # We'll handle retries manually
        #         read_timeout=base_timeout,
        #         connect_timeout=10
        #     )
        #     reliable_lambda_client = boto3.client('lambda', config=retry_config)
        #
        #     last_exception = None
        #     total_start = time.time()
        #
        #     for attempt in range(max_retries):
        #         attempt_start = time.time()
        #
        #         # Calculate adaptive timeout based on attempt
        #         adaptive_timeout = base_timeout + (attempt * 10)  # Increase timeout on retries
        #
        #         logger.info(
        #             "LAMBDA_INVOKE_ATTEMPT: Attempting proxy Lambda invocation with timeout control",
        #             attempt=attempt + 1,
        #             max_attempts=max_retries,
        #             function_arn=function_arn,
        #             timeout_seconds=adaptive_timeout,
        #             invocation_id=invocation_id
        #         )
        #
        #         try:
        #             response = reliable_lambda_client.invoke(
        #                 FunctionName=function_arn,
        #                 Payload=json.dumps(payload),
        #                 InvocationType="RequestResponse"
        #             )
        #
        #             attempt_duration = time.time() - attempt_start
        #             total_duration = time.time() - total_start
        #
        #             logger.info(
        #                 "LAMBDA_INVOKE_SUCCESS: Proxy Lambda invocation succeeded with reliability controls",
        #                 attempt=attempt + 1,
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 total_duration_ms=round(total_duration * 1000, 2),
        #                 status_code=response.get("StatusCode"),
        #                 invocation_id=invocation_id,
        #                 reliability_enhancement="RETRY_WITH_TIMEOUT"
        #             )
        #
        #             return response
        #
        #         except ClientError as e:
        #             error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        #             last_exception = e
        #             attempt_duration = time.time() - attempt_start
        #
        #             # Determine if error is retryable
        #             retryable_errors = [
        #                 'ServiceException',
        #                 'TooManyRequestsException',
        #                 'RequestTimeoutException',
        #                 'InternalServerError'
        #             ]
        #
        #             is_retryable = error_code in retryable_errors or attempt_duration >= adaptive_timeout
        #
        #             logger.warning(
        #                 "LAMBDA_INVOKE_ERROR: Proxy Lambda invocation failed",
        #                 attempt=attempt + 1,
        #                 max_attempts=max_retries,
        #                 error_code=error_code,
        #                 error_message=str(e),
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 is_retryable=is_retryable,
        #                 invocation_id=invocation_id
        #             )
        #
        #             if not is_retryable or attempt == max_retries - 1:
        #                 break
        #
        #         except Exception as e:
        #             last_exception = e
        #             attempt_duration = time.time() - attempt_start
        #
        #             logger.error(
        #                 "LAMBDA_INVOKE_UNEXPECTED_ERROR: Unexpected error during proxy Lambda invocation",
        #                 attempt=attempt + 1,
        #                 error_type=type(e).__name__,
        #                 error=str(e),
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 invocation_id=invocation_id
        #             )
        #
        #             if attempt == max_retries - 1:
        #                 break
        #
        #         # Apply exponential backoff with jitter before retry
        #         if attempt < max_retries - 1:
        #             backoff_delay = min((2 ** attempt) + random.uniform(0, 1), 30)  # Cap at 30 seconds
        #             logger.info(
        #                 "LAMBDA_INVOKE_BACKOFF: Applying exponential backoff before retry",
        #                 backoff_delay_seconds=backoff_delay,
        #                 next_attempt=attempt + 2,
        #                 invocation_id=invocation_id
        #             )
        #             time.sleep(backoff_delay)
        #
        #     # All attempts failed
        #     total_duration = time.time() - total_start
        #     logger.error(
        #         "LAMBDA_INVOKE_FAILED: All proxy Lambda invocation attempts failed",
        #         total_attempts=max_retries,
        #         total_duration_ms=round(total_duration * 1000, 2),
        #         final_error=str(last_exception) if last_exception else "Unknown error",
        #         invocation_id=invocation_id
        #     )
        #     raise last_exception or Exception("Lambda invocation failed after all retries")
        #
        # # Use reliable Lambda invocation with retry and timeout controls
        # response = invoke_lambda_with_retry_and_timeout(
        #     lambda_client, PIPEDREAM_PROXY_LAMBDA_ARN, payload, invocation_id
        # )

        lambda_invocation_start = time.time()
        logger.critical(
            (
                "RELIABILITY_CRITICAL: About to invoke cross-account Lambda with ZERO "
                "resilience controls - HIGH RISK operation"
            ),
            function_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
            payload_size_bytes=len(json.dumps(payload)),
            invocation_id=invocation_id,
            operation_type="SYNCHRONOUS_SINGLE_SHOT",
            timeout_control="NONE",
            retry_logic="DISABLED",
            circuit_breaker="DISABLED",
            fallback_mechanism="NONE",
            reliability_status="MAXIMUM_VULNERABILITY",
            risk_level="CRITICAL",
            invocation_timestamp=time.time(),
            sts_proof_remaining_seconds=max(
                0, 60 - (time.time() - sts_generation_start)
            ),
            failure_modes_active=[
                "lambda_cold_start_timeout_no_retry",
                "network_failure_between_accounts_no_fallback",
                "proxy_account_throttling_no_circuit_breaker",
                "sts_proof_expiration_during_processing",
                "indefinite_hang_with_no_timeout_control",
                "cascading_failure_from_single_point_of_failure",
            ],
        )

        # LAMBDA INVOCATION RELIABILITY FIX - COMMENTED OUT BUT READY FOR IMPLEMENTATION
        # from botocore.config import Config
        # from botocore.exceptions import ClientError
        # import random
        #
        # def invoke_lambda_with_comprehensive_resilience(
        #     lambda_client,
        #     function_arn: str,
        #     payload: dict,
        #     invocation_id: str,
        #     max_retries: int = 3,
        #     base_timeout: int = 30,
        #     circuit_breaker_threshold: int = 5
        # ) -> dict:
        #     """Invoke Lambda with comprehensive resilience: retries, timeouts, circuit breaking."""
        #
        #     # Configure resilient client with timeouts
        #     resilient_config = Config(
        #         retries={'max_attempts': 1},  # We handle retries manually for better control
        #         read_timeout=base_timeout,
        #         connect_timeout=10,
        #         max_pool_connections=10
        #     )
        #     resilient_lambda_client = boto3.client('lambda', config=resilient_config)
        #
        #     last_exception = None
        #     total_start = time.time()
        #
        #     for attempt in range(max_retries):
        #         attempt_start = time.time()
        #         adaptive_timeout = base_timeout + (attempt * 10)  # Increase timeout on retries
        #
        #         logger.info(
        #             "RELIABILITY_IMPROVEMENT: Resilient Lambda invocation attempt",
        #             attempt=attempt + 1,
        #             max_attempts=max_retries,
        #             function_arn=function_arn,
        #             timeout_seconds=adaptive_timeout,
        #             invocation_id=invocation_id,
        #             resilience_features=["retry_logic", "adaptive_timeout", "exponential_backoff"]
        #         )
        #
        #         try:
        #             response = resilient_lambda_client.invoke(
        #                 FunctionName=function_arn,
        #                 Payload=json.dumps(payload),
        #                 InvocationType="RequestResponse"
        #             )
        #
        #             attempt_duration = time.time() - attempt_start
        #             total_duration = time.time() - total_start
        #
        #             # Check for function errors
        #             if response.get("FunctionError"):
        #                 error_type = response.get("FunctionError")
        #                 logger.warning(
        #                     "LAMBDA_FUNCTION_ERROR: Lambda returned function error - may be retryable",
        #                     function_error_type=error_type,
        #                     attempt=attempt + 1,
        #                     attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                     invocation_id=invocation_id
        #                 )
        #
        #                 # Function errors might be retryable depending on type
        #                 if attempt < max_retries - 1 and error_type in ["Unhandled", "Runtime.Unknown"]:
        #                     last_exception = Exception(f"Function error: {error_type}")
        #                     continue
        #
        #             logger.info(
        #                 "RELIABILITY_SUCCESS: Resilient Lambda invocation succeeded",
        #                 attempt=attempt + 1,
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 total_duration_ms=round(total_duration * 1000, 2),
        #                 status_code=response.get("StatusCode"),
        #                 invocation_id=invocation_id,
        #                 resilience_improvement="ENABLED"
        #             )
        #
        #             return response
        #
        #         except ClientError as e:
        #             error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        #             last_exception = e
        #             attempt_duration = time.time() - attempt_start
        #
        #             # Categorize retryable vs non-retryable errors
        #             retryable_errors = [
        #                 'ServiceException',
        #                 'TooManyRequestsException',
        #                 'RequestTimeoutException',
        #                 'InternalServerError',
        #                 'ResourceConflictException'  # Sometimes transient
        #             ]
        #             non_retryable_errors = [
        #                 'InvalidParameterValueException',
        #                 'ResourceNotFoundException',
        #                 'AccessDeniedException'
        #             ]
        #
        #             is_retryable = (error_code in retryable_errors) or (
        #                 error_code not in non_retryable_errors and attempt_duration >= adaptive_timeout * 0.9
        #             )
        #
        #             logger.warning(
        #                 "RELIABILITY_RETRY: Lambda invocation failed - analyzing for retry",
        #                 attempt=attempt + 1,
        #                 error_code=error_code,
        #                 error_message=str(e),
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 is_retryable=is_retryable,
        #                 will_retry=is_retryable and attempt < max_retries - 1,
        #                 invocation_id=invocation_id
        #             )
        #
        #             if not is_retryable or attempt == max_retries - 1:
        #                 break
        #
        #         except Exception as e:
        #             last_exception = e
        #             attempt_duration = time.time() - attempt_start
        #
        #             logger.error(
        #                 "RELIABILITY_UNEXPECTED: Unexpected error during Lambda invocation",
        #                 attempt=attempt + 1,
        #                 error_type=type(e).__name__,
        #                 error=str(e),
        #                 attempt_duration_ms=round(attempt_duration * 1000, 2),
        #                 invocation_id=invocation_id
        #             )
        #
        #             if attempt == max_retries - 1:
        #                 break
        #
        #         # Apply exponential backoff with jitter
        #         if attempt < max_retries - 1:
        #             base_backoff = min((2 ** attempt) * 0.5, 10)  # Cap at 10 seconds
        #             jitter = random.uniform(0, base_backoff * 0.3)  # Up to 30% jitter
        #             backoff_delay = base_backoff + jitter
        #
        #             logger.info(
        #                 "RELIABILITY_BACKOFF: Applying exponential backoff with jitter",
        #                 backoff_delay_seconds=backoff_delay,
        #                 base_backoff=base_backoff,
        #                 jitter_seconds=jitter,
        #                 next_attempt=attempt + 2,
        #                 invocation_id=invocation_id
        #             )
        #             time.sleep(backoff_delay)
        #
        #     # All attempts failed
        #     total_duration = time.time() - total_start
        #     logger.critical(
        #         "RELIABILITY_FAILURE: All resilient Lambda invocation attempts failed",
        #         total_attempts=max_retries,
        #         total_duration_ms=round(total_duration * 1000, 2),
        #         final_error=str(last_exception) if last_exception else "Unknown error",
        #         invocation_id=invocation_id
        #     )
        #     raise last_exception or Exception("Lambda invocation failed after all resilient retry attempts")
        #
        # # Use resilient Lambda invocation instead of single-shot call
        # logger.info(
        #     "RELIABILITY_IMPROVEMENT: Using resilient Lambda invocation with comprehensive error handling",
        #     invocation_id=invocation_id,
        #     resilience_features=["retry_logic", "timeout_controls", "exponential_backoff", "error_categorization"]
        # )
        # response = invoke_lambda_with_comprehensive_resilience(
        #     lambda_client, PIPEDREAM_PROXY_LAMBDA_ARN, payload, invocation_id
        # )

        # RELIABILITY IMPROVEMENT: Resilient Lambda invocation with timeout and retry
        response = _invoke_lambda_with_retry(
            lambda_client=lambda_client,
            function_arn=PIPEDREAM_PROXY_LAMBDA_ARN,
            payload=payload,
            invocation_id=invocation_id,
        )

        response = lambda_client.invoke(
            FunctionName=PIPEDREAM_PROXY_LAMBDA_ARN,
            Payload=json.dumps(payload),
            InvocationType="RequestResponse",
            max_retries=3,
            base_timeout=30,
        )
        lambda_invocation_duration = time.time() - lambda_invocation_start

        logger.info(
            "PROXY_LAMBDA_RESPONSE: Lambda invocation completed",
            lambda_invocation_duration_ms=round(lambda_invocation_duration * 1000, 2),
            has_function_error=bool(response.get("FunctionError")),
            status_code=response.get("StatusCode"),
            invocation_id=invocation_id,
        )

        response_parsing_start = time.time()
        response_payload = json.loads(response["Payload"].read())
        response_parsing_duration = time.time() - response_parsing_start

        logger.debug(
            "PROXY_RESPONSE_PARSING: Lambda response parsed",
            response_parsing_duration_ms=round(response_parsing_duration * 1000, 2),
            response_status_code=response_payload.get("statusCode"),
            has_body=bool(response_payload.get("body")),
            invocation_id=invocation_id,
        )

        try:
            body_parsing_start = time.time()
            body = json.loads(response_payload.get("body", "{}"))
            body_parsing_duration = time.time() - body_parsing_start

            logger.debug(
                "PROXY_BODY_PARSING: Response body parsed successfully",
                body_parsing_duration_ms=round(body_parsing_duration * 1000, 2),
                body_success=body.get("success"),
                body_operation=body.get("operation"),
                has_data=bool(body.get("data")),
                invocation_id=invocation_id,
            )
        except (json.JSONDecodeError, TypeError) as exc:
            logger.error(
                "PROXY_BODY_PARSING_FAILED: Failed to parse proxy response body",
                error_type=type(exc).__name__,
                error=str(exc),
                body_content=response_payload.get("body"),
                invocation_id=invocation_id,
            )
            raise ValueError("Invalid proxy response format") from exc

        logger.info(
            "PROXY_RESPONSE_PROCESSED: Proxy lambda response processed",
            status_code=response_payload.get("statusCode"),
            operation=operation,
            success=body.get("success"),
            lambda_invocation_duration_ms=round(lambda_invocation_duration * 1000, 2),
            invocation_id=invocation_id,
        )

        if response.get("FunctionError"):
            error_message = response_payload.get("errorMessage", "Unknown lambda error")
            proxy_invocation_duration = time.time() - proxy_invocation_start
            logger.error(
                "PROXY_LAMBDA_ERROR: Lambda function execution error",
                error_message=error_message,
                function_error_type=response.get("FunctionError"),
                operation=operation,
                proxy_invocation_duration_ms=round(proxy_invocation_duration * 1000, 2),
                invocation_id=invocation_id,
            )
            raise ValueError(f"Proxy lambda execution failed: {error_message}")

        if response_payload.get("statusCode") != 200:
            error_message = body.get(
                "error", f"HTTP {response_payload.get('statusCode')} error"
            )
            proxy_invocation_duration = time.time() - proxy_invocation_start
            logger.error(
                "PROXY_OPERATION_ERROR: Proxy operation failed with non-200 status",
                status_code=response_payload.get("statusCode"),
                error_message=error_message,
                operation=operation,
                proxy_invocation_duration_ms=round(proxy_invocation_duration * 1000, 2),
                invocation_id=invocation_id,
            )
            raise ValueError(f"Proxy operation failed: {error_message}")

        # Success!
        proxy_invocation_duration = time.time() - proxy_invocation_start
        logger.info(
            "PROXY_INVOCATION_SUCCESS: Pipedream proxy invocation completed successfully",
            operation=operation,
            external_user_id=(
                external_user_id[:8] + "..."
                if len(external_user_id) > 8
                else external_user_id
            ),
            proxy_invocation_duration_ms=round(proxy_invocation_duration * 1000, 2),
            response_data_keys=(
                list(body.get("data", {}).keys())
                if isinstance(body.get("data"), dict)
                else []
            ),
            invocation_id=invocation_id,
        )

        return body

    except Exception as exc:
        proxy_invocation_duration = time.time() - proxy_invocation_start
        logger.error(
            "PROXY_INVOCATION_FAILED: Failed to invoke Pipedream proxy lambda",
            error_type=type(exc).__name__,
            error=str(exc),
            operation=operation,
            external_user_id=(
                external_user_id[:8] + "..."
                if len(external_user_id) > 8
                else external_user_id
            ),
            proxy_invocation_duration_ms=round(proxy_invocation_duration * 1000, 2),
            invocation_id=invocation_id,
            exc_info=True,
        )
        raise ValueError(f"Pipedream proxy invocation failed: {exc}") from exc


def get_mcp_connection_details_from_proxy(external_user_id: str, app_name: str) -> Dict:
    """
    Get MCP client connection details via proxy lambda.
    """
    response = invoke_pipedream_proxy(
        "create_mcp_client", external_user_id, app_name=app_name
    )

    if not response.get("success"):
        raise ValueError(response.get("error", "Failed to get MCP connection details"))

    connection_details = response.get("data", {})

    logger.info(
        "Retrieved MCP connection details from proxy",
        app_name=app_name,
        external_user_id=(
            external_user_id[:20] + "..."
            if len(external_user_id) > 20
            else external_user_id
        ),
        base_url=connection_details.get("base_url"),
    )

    return connection_details
