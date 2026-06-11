# Numa Codebase Bug Hunt — Confirmed Findings (rev. 2)

Generated 2026-06-08 via 40-partition fan-out review (260 agents). 220 raised → 137 confirmed → **130 actionable** after removing RDS-retired + build-artifact-only items.

**Actionable by severity:** 8 critical · 71 high · 45 medium · 6 low

## ⚠️ Removed as moot (RDS retired / no source)

- ~~`infra/constructs/knowledge-base-construct.ts:84` — RDS cluster configured to skip final snapshot on destruction~~ (Aurora/RDS cluster — RDS retired (you use S3 Vectors KB))
- ~~`lambdas/python/content-search/lambda_function.py:72` — IndexError in \_parse_rows when columnMetadata mismatch~~ (No source in repo — only built lambda_function.zip; legacy crawler/Data-API pipeline)
- ~~`lambdas/python/content-indexer/lambda_function.py:185-191` — Missing error handling in content-indexer RDS execution~~ (No source in repo — only built lambda_function.zip; legacy crawler/Data-API pipeline)
- ~~`lambdas/python/content-indexer/lambda_function.py:91-102` — Potential KeyError in content-indexer filemeta extraction~~ (No source in repo — only built lambda_function.zip; legacy crawler/Data-API pipeline)
- ~~`lambdas/node/vector-db-init/index.ts:65, 81` — SQL Injection via unescaped password in SQL statement~~ (Inits Aurora pgvector KB (rds-data) — RDS retired)
- ~~`lambdas/python/restart-crawler/lambda_function.py:51-58` — Incomplete state preservation during crawler restart~~ (Legacy web-crawler pipeline (rds-data/redshift Data API) — likely retired with RDS)
- ~~`lambdas/python/content-indexer/lambda_function.py:50-53` — Missing null check in content-indexer text extraction fallback~~ (No source in repo — only built lambda_function.zip; legacy crawler/Data-API pipeline)

---

## CRITICAL (8)

### C1. Global mutable state causes cross-request interference in web search anti-detection

- **File:** `lambdas/python/workspace-chat-tools/tools/web_search.py:307-308, 369`
- **Category:** race · **Confidence:** high · **Partition:** py-wschat-misc
- **What's wrong:** Module-level globals `_last_search_time` and `_failed_searches_in_row` persist across Lambda invocations within a warm container. In a multi-user, concurrent environment, one user's failed searches cause subsequent users' searches to experience exponential backoff delays (line 329: `base_delay *= min(2**_failed_searches_in_row, 8)`). A single user generating failed searches can degrade performance for all users sharing the same Lambda container instance.
- **Impact:** In production, one user's search failures cause 5-60 second delays for other unrelated users' searches in the same container. With enough containers, this could be triggered deliberately or accidentally, degrading search performance across the platform. The `_failed_searches_in_row` counter is never reset except on success, accumulating indefinitely.
- **Verifier reasoning:** The bug is real and directly observable in the code at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/workspace-chat-tools/tools/web_search.py. Lines 307-308 define module-level mutable globals `_last_search_time` and `_failed_searches_in_row` that persist across Lambda invocations. Line 321 declares these as global within `_google_search()`. The exponential backoff at line 328-329 multiplies `base_delay` by `min(2**_failed_searches_in_row, 8)`. Line 369 increments `_failed_searches_in_row` whenever all search attempts fail (a reachable condition across 3 engines × 3 retries). Line 355 only resets the counter to 0 on successful search, not on request boundaries. In Lambda's warm container model, subsequent requests (potentially from different users) inherit this accumulated failure count, causing 5-60+ second delays for unrelated users. The counter never auto-resets on failure scenarios — only on success. This creates direct cross-request/cross-user interference in multi-tenant Lambda environments. The bug is not guarded, validated away, or unreachable; it manifests whenever a search fails and the next invocation hits the exponential backoff calculation.
- **Suggested fix:** Reset the failure counter at the start of each `_google_search()` invocation to isolate requests: add `_failed_searches_in_row = 0` and `_last_search_time = 0.0` at the beginning of the function (after line 322). Alternatively, use `contextvars.ContextVar` or `threading.local()` to scope state per request/user, or remove the anti-detection mechanism entirely if it's not providing value against current search engines. The safest fix is per-request reset: insert `_failed_searches_in_row = 0` after the global declaration to prevent one user's failures from penalizing another.

### C2. Dropzone Token Secret Per-Lambda-Instance Breaks Cross-Instance Validation

- **File:** `lambdas/python/shared-nova-api/shared_nova_api/app.py:56`
- **Category:** idempotency · **Confidence:** high · **Partition:** py-shared-nova
- **What's wrong:** The dropzone authentication token secret is initialized as a module-level global with a random value at Lambda startup. This causes tokens created in one Lambda container instance to fail validation in other instances, breaking dropzone functionality when requests are distributed across multiple containers (standard in Lambda auto-scaling).
- **Impact:** Dropzone authentication tokens become invalid when a Lambda container restarts or when requests hit different container instances. This breaks multi-user dropzone uploads in production where Lambda scales to multiple concurrent instances. A user obtains a token from one request, then subsequent requests fail with 401 Unauthorized.
- **Verifier reasoning:** The bug is real. Code inspection shows: (1) Line 56 initializes \_DROPZONE_TOKEN_SECRET with secrets.token_hex(32), a random value per container; (2) Lines 902 and 921 use this secret for HMAC token creation and verification; (3) No code persists or retrieves this secret from environment, Secrets Manager, or any shared store; (4) The infrastructure (shared-chat-construct.ts) does not set reservedConcurrentExecutions, allowing the Lambda to auto-scale to multiple instances; (5) Each instance will have a different random secret, causing token validation to fail when requests cross instance boundaries. This manifests in production whenever dropzone auth tokens are created on one Lambda instance and validated on another - a standard scenario under load or with container restarts.
- **Suggested fix:** Replace line 56 with: \_DROPZONE_TOKEN_SECRET = os.environ.get("DROPZONE_TOKEN_SECRET") or secrets.token_hex(32). Then provision the secret at deployment in shared-chat-construct.ts by adding to environment object: DROPZONE_TOKEN_SECRET: props.dropzoneTokenSecret (where dropzoneTokenSecret is generated once and stored in Secrets Manager or passed from the stack). Alternatively, generate the secret at deployment time and inject as an immutable environment variable across all Lambda container instances.

### C3. Bytes not decoded before prompt formatting in contract-analysis

- **File:** `lambdas/python/contract-analysis/lambda_function.py:40-47, 194`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-analysis-apps
- **What's wrong:** The contract content is read from S3 as bytes but not decoded to string before being used in prompt.format(). When bytes are formatted into a string with .format(), Python converts them to their string representation (e.g., b'content') instead of the actual content.
- **Impact:** The Bedrock model receives a corrupted prompt containing the string representation of bytes (e.g., 'b\'contract text\'') instead of the actual contract text. This causes the model to analyze malformed input and return meaningless results, breaking the entire contract analysis feature.
- **Verifier reasoning:** The bug is confirmed through code inspection. (1) s3_helpers.read() explicitly returns bytes (type annotation at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/s3_helpers/s3_helpers/**init**.py:14), (2) contract_content is assigned directly from read() without decoding at lambda_function.py:40, (3) this bytes object is placed into input_data dict and passed to get_model_response() at lines 46-49, (4) at line 194, prompt.format(\*\*input_data) is called, which converts bytes to their string representation (e.g., b'content') instead of the actual decoded string, (5) the bedrock.run() method receives this corrupted string directly (bedrock/**init**.py shows run() expects query: str and passes it to API without decoding). Python's str.format() behavior with bytes was verified experimentally. The fix is to decode on line 40: contract_content = s3_helpers.read(input_key).decode('utf-8')
- **Suggested fix:** In /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/contract-analysis/lambda_function.py, line 40, change:
  contract_content = s3_helpers.read(input_key)
  to:
  contract_content = s3_helpers.read(input_key).decode('utf-8')

### C4. Bytes not decoded before prompt formatting in candidate-screening

- **File:** `lambdas/python/candidate-screening/lambda_function.py:34, 45, 87`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-analysis-apps
- **What's wrong:** The resume text is read from S3 as bytes but not decoded to string before being formatted into the prompt. Similar to the contract-analysis issue, this causes the prompt to contain the string representation of bytes instead of the actual resume content.
- **Impact:** The Bedrock model receives resume data as byte string representation (e.g., 'b\'resume text\'') instead of actual content. This causes incorrect candidate screening results, leading to wrong hiring decisions based on corrupted data.
- **Verifier reasoning:** The bug is confirmed real by reading the actual code. s3_helpers.read() returns bytes (explicit type annotation at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/s3_helpers/s3_helpers/**init**.py:14). In candidate-screening/lambda_function.py, line 34 calls s3_helpers.read(resume_text_key) returning bytes, and line 39 does the same for cover_letter_text. These bytes are added to input_data dict at lines 45-46 without decoding. At line 87, they are passed to CANDIDATE_SCREENING_PROMPT.format(resume_text=input_data["resume_text"], ...). When bytes objects are passed to Python's str.format(), they are converted to their string representation (e.g., b'content' instead of content), which is confirmed by direct testing. This corrupted prompt is then sent to the Bedrock model at line 95. The company-profile lambda (lines 28-29) shows the correct pattern by explicitly calling .decode('utf-8') on bytes before use, confirming this is a known mistake being made in candidate-screening.
- **Suggested fix:** In /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/candidate-screening/lambda_function.py, modify lines 34 and 39-42 to decode bytes to string:

Line 34 should be:
resume_text = s3_helpers.read(resume_text_key).decode('utf-8')

Lines 39-42 should be:
if cover_letter_text_key:
try:
cover_letter_text = s3_helpers.read(cover_letter_text_key).decode('utf-8')
except Exception as e:
logger.warning(f"Failed to read cover letter: {e}")
cover_letter_text = None

This matches the pattern used in company-profile/lambda_function.py at lines 28-29.

### C5. Undecoded bytes passed to LLM prompt causing string representation instead of content

- **File:** `lambdas/python/infringement-review/lambda_function.py:44-56`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-assessment-apps
- **What's wrong:** The evidence_content is read as bytes from S3 but passed directly to the prompt template without decoding. When the prompt is formatted, the bytes object will be converted to its string representation (e.g., 'b"...content..."') instead of the actual decoded text. This causes the LLM to process malformed input that includes the b'' prefix, corrupting the evidence data.
- **Impact:** The LLM receives corrupted evidence input (with b'' prefix) instead of actual document content. All 5 analysis steps (evidence analysis, human error analysis, legislation evaluation, decision determination, response letter) will operate on this corrupted data, producing incorrect analysis results. Users will receive legally/operationally flawed infringement review decisions based on misinterpreted evidence.
- **Verifier reasoning:** The bug is real and confirmed by reading actual code. The s3_helpers.read() function at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/s3_helpers/s3_helpers/**init**.py line 14 explicitly returns bytes. At /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/infringement-review/lambda_function.py line 44, evidence_content is assigned these bytes. At lines 56-57, this bytes object is passed to the prompt template. At line 235, when prompt.format(\*\*input_data) is called, Python converts the bytes to their string representation (b'...') rather than the decoded text content. I verified this behavior experimentally. There is no .decode() call anywhere in the code path. This corrupts all 5 analysis steps (evidence analysis, human error analysis, legislation evaluation, decision determination, response letter) by passing malformed input with the b'' prefix to the LLM.
- **Suggested fix:** At /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/infringement-review/lambda_function.py line 44, change: `evidence_content = s3_helpers.read(input_key)` to: `evidence_content = s3_helpers.read(input_key).decode('utf-8')`

### C6. Path Traversal in S3 File Download - sync_from_s3 and sync_workspace_prefixes

- **File:** `services/numa-workspace-agent/numa_workspace_agent/s3_workspace.py:329-350, 430-438`
- **Category:** security · **Confidence:** high · **Partition:** ws-workspace-s3
- **What's wrong:** S3 key names are not validated before constructing filesystem paths. An attacker who can control S3 object keys (via compromised S3 credentials, misconfigured bucket policy, or untrusted upload source) can write files containing path traversal sequences like '../../../' which escape the /workdir workspace boundary and write to arbitrary locations on the container filesystem.
- **Impact:** An attacker could write arbitrary files to the container at any location (e.g., /app/malicious.py to inject code, /etc/passwd to corrupt system files, or ~/.ssh/authorized_keys to gain persistent access). This breaks multi-tenant isolation and allows container escape.
- **Verifier reasoning:** The vulnerability is REAL and CRITICAL. I confirmed through code inspection and executable proof-of-concept that:

1. **Root cause is present**: Lines 329 and 430 extract rel_path from S3 keys without validation. Lines 345 and 434 directly use rel_path in Path concatenation without guards.

2. **No guards exist**: Code review confirmed no ".." validation, no relative_to() checks, no path normalization before mkdir() or download_file() calls at lines 350 and 435.

3. **Exploitable in practice**: S3 allows arbitrary key names including "../" sequences. When list_objects_v2() returns a key like "numa-chat/workspace/user/{conv_id}/../../../etc/passwd", the extracted rel_path becomes "../../../etc/passwd", which Path concatenation and filesystem operations will traverse and resolve.

4. **Executable**: Demonstrated with Python that (Path("/workdir") / "../../../etc/passwd").resolve() resolves to /etc/passwd, and mkdir(parents=True) followed by write creates the traversed directory structure.

5. **Impact**: Arbitrary file write to container filesystem at any location, code injection to /app, system file corruption, persistent access via ~/.ssh/authorized_keys, breaking multi-tenant isolation and enabling container escape.

The attack requires S3 object keys containing ".." which S3 allows. An attacker can achieve this via: (1) compromised S3 credentials, (2) misconfigured bucket policy allowing untrusted uploads, or (3) internal service uploading to attacker-controlled prefixes.</reasoning>
<parameter name="fix">Add path traversal validation immediately after extracting rel_path (before any filesystem operations):

In sync_from_s3 (after line 329):

```python
rel_path = s3_key[len(s3_prefix):]
if not rel_path or ".." in rel_path or rel_path.startswith("/"):
    logger.warning("Rejecting S3 key with path traversal", s3_key=s3_key)
    continue
```

In sync_workspace_prefixes (after line 430):

```python
rel_path = s3_key[len(norm_prefix):]
if not rel_path or ".." in rel_path or rel_path.startswith("/"):
    logger.warning("Rejecting S3 key with path traversal", s3_key=s3_key)
    continue
```

Apply same validation to sync_uploads_from_s3 (line 693) and list_conversation_files_from_s3 (line 803).</parameter>
</StructuredOutput>

### C7. Path traversal vulnerability in S3 prefix download

- **File:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/workspace_setup.py:218`
- **Category:** security · **Confidence:** high · **Partition:** ws-nolia
- **What's wrong:** The \_download_s3_prefix function does not validate that the relative path (computed by stripping the prefix length) stays within the target directory. Attacker-controlled S3 keys with directory traversal patterns (e.g., '../../../') can escape the target directory and write files anywhere on the container filesystem.
- **Impact:** A malicious S3 object with a key like 'documents/kb-{id}/../../../etc/myfile' would extract to outside /workdir/knowledge-bases/, potentially overwriting container files, escape the sandbox, or achieve arbitrary file write within the container.
- **Verifier reasoning:** REAL VULNERABILITY CONFIRMED. Code at /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/workspace_setup.py lines 210-228 constructs S3 prefix using untrusted user input (`kb_id` from HTTP request metadata, passed through main.py line 2526). The `_download_s3_prefix` function extracts relative paths by stripping prefix length (line 218) and downloads to `target_dir / relative` (line 222) WITHOUT validating the final path stays within target_dir. An attacker can inject directory traversal sequences (e.g., `kb_id="123/../../../etc"`) creating prefix `"documents/kb-123/../../../etc/"`. If an S3 object exists at key `"documents/kb-123/../../../etc/passwd"`, it matches the prefix. When processed, relative becomes `"../../../etc/passwd"` and local_path normalizes to `/etc/passwd` outside `/workdir/knowledge-bases/`. The fix is to validate: `(target_dir / relative).resolve().relative_to(target_dir.resolve())` and skip mismatches.
- **Suggested fix:** Add path validation in \_download_s3_prefix function (line 222 area):

```python
# Add before line 222:
local_path = (target_dir / relative).resolve()
target_dir_resolved = target_dir.resolve()

# Validate path stays within target_dir
try:
    local_path.relative_to(target_dir_resolved)
except ValueError:
    logger.warning(f"Skipping path traversal: {key}")
    continue

# Then use local_path for download
s3.download_file(bucket, key, str(local_path))
```

### C8. Wrong deployed_trigger_id value stored in connector events

- **File:** `lambdas/node/pipedream-event-receiver/index.ts:406`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-events-notif
- **What's wrong:** The deployed_trigger_id field is set to pk (${connectorId}#${eventType}) instead of the actual emitterId from the x-pd-emitter-id header. This causes all events from the same trigger type to have the same deployed_trigger_id, making it impossible to identify which specific Pipedream trigger (dc_xxx) fired.
- **Impact:** Production data corruption: connector event records will have incorrect deployed_trigger_id values. Any downstream systems attempting to correlate events back to their specific deployed triggers will get wrong data. This breaks audit trails and event tracing.
- **Verifier reasoning:** The bug is confirmed by reading the actual code. At line 406, `deployed_trigger_id` is set to `pk` which equals `'pipedream#${trigger_app_slug}.${trigger_component_id}'` — a generic partition key combining connector and event type. The actual emitter ID (`dc_xxx` from the x-pd-emitter-id header, extracted at line 245) is never passed to the `persistAndEmit()` function (line 332-337), so it cannot be used at line 406. This means all events from the same trigger type share the same deployed_trigger_id value, destroying the ability to identify which specific Pipedream trigger instance (dc_xxx) fired. This is a genuine data-loss bug: downstream systems relying on deployed_trigger_id to correlate events back to their source will get wrong data. The fix requires adding emitterId to PersistArgs (line 366), passing it at the call site (line 332), and using it instead of pk at line 406.
- **Suggested fix:** 1. Modify PersistArgs type to include emitterId:

```typescript
type PersistArgs = {
  schedule: ScheduleLookupResult;
  rawBody: string;
  pdTimestamp: string | undefined;
  projectId: string | undefined;
  emitterId: string; // ADD THIS
};
```

2. Pass emitterId when calling persistAndEmit (lines 332-337):

```typescript
await persistAndEmit({
  schedule,
  rawBody,
  pdTimestamp,
  projectId,
  emitterId, // ADD THIS
});
```

3. Update line 406 to use the actual emitter ID:

```typescript
deployed_trigger_id: args.emitterId,  // CHANGE from: deployed_trigger_id: pk,
```

---

## HIGH (71)

### H1. Missing type validation for auto_approved approval bypass

- **File:** `lambdas/python/workspace-chat-tools/tools/ops.py:1751, 1770`
- **Category:** security · **Confidence:** high · **Partition:** py-wschat-kb-ops
- **What's wrong:** The auto_approved field is not validated as a boolean before use in approval gate checks. Python's truthiness evaluation means any non-empty string or number would bypass approval requirements, even if sent as auto_approved='false' (string) or auto_approved=1.
- **Impact:** An attacker or misconfigured caller could bypass the approval workflow for sensitive ops operations (create_ticket, update_customer, etc.) by sending auto_approved as a truthy non-boolean value like a string or integer, potentially allowing unauthorized modifications to critical business data.
- **Verifier reasoning:** The bug is REAL but with important context. The code at line 1751 (`auto_approved = event.get("auto_approved", False)`) retrieves the value without type validation, and line 1770 (`if not auto_approved and request_id:`) relies on Python truthiness evaluation. This means: (1) If `auto_approved="true"` (string), `not "true"` evaluates to `False`, skipping approval; (2) If `auto_approved=1` (integer), `not 1` evaluates to `False`, skipping approval. The code even logs the type at line 1762 (`auto_approved_type=type(auto_approved).__name__`), indicating awareness that unexpected types could arrive, but doesn't actually validate or reject them. The comment at line 1750 states "If auto_approved is missing or unexpected, require approval" but the code doesn't enforce this. However, in the normal code path, `auto_approved` is ALWAYS a boolean because it's created in `numa_ops.py` line 368 as `auto_approved = approval_mode_raw == "auto"` (comparison result is always bool). The vulnerability is only exploitable if someone with AWS Lambda invocation credentials crafts a malicious event with non-boolean `auto_approved`. The severity is HIGH (not CRITICAL) because: (1) requires AWS credentials to invoke the Lambda directly, (2) the normal code path is protected, (3) the fix is straightforward (add isinstance check), and (4) the approval is already logged by type, making misuse detectable.
- **Suggested fix:** Add type validation after line 1751 in `/Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/workspace-chat-tools/tools/ops.py`:

```python
auto_approved = event.get("auto_approved", False)

# Validate auto_approved is a boolean (fail-closed if unexpected type)
if not isinstance(auto_approved, bool):
    logger.warning(
        "Invalid auto_approved type - treating as False (fail-closed)",
        auto_approved=auto_approved,
        auto_approved_type=type(auto_approved).__name__,
    )
    auto_approved = False
```

This ensures that only actual boolean `True` values skip the approval check, aligning with the stated intent in the comment at line 1750.

### H2. Orphaned metadata created when finalize_upload called without file verification

- **File:** `lambdas/python/workspace-chat-tools/tools/knowledge_base.py:1123-1140, 1174-1182`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-wschat-kb-ops
- **What's wrong:** The finalize_upload flow writes metadata sidecar files for S3 objects without verifying that the actual file content exists in S3. The presigned URL upload pattern is: (1) request presigned URL, (2) user uploads to S3 directly, (3) finalize to record metadata. But finalize doesn't check if step 2 actually succeeded.
- **Impact:** If a user requests a presigned URL but never uploads the file (or uploads to wrong key), then calls finalize_upload, an orphaned .metadata.json file is created in S3 referencing a non-existent data file. This corrupts the KB index, leading to broken references. The KB indexer will attempt to process non-existent files, potentially failing silently or with errors.
- **Verifier reasoning:** The code path is REAL. When finalize_upload=True and get_presigned_url=False, line 1123-1140 creates a metadata sidecar file ({s3_key}.metadata.json) via put_object WITHOUT verifying the actual data file exists at {s3_key}. This is confirmed by: (1) Line 1123 condition `if not get_presigned_url:` evaluates TRUE when finalize_upload=True, (2) Lines 1135-1140 unconditionally call put_object for the metadata without any head_object verification, (3) grep search shows head_object IS used elsewhere in the codebase (line 1296 in delete flow) but NOT in the finalize_upload path, (4) The normal client workflow (numa_tool.py lines 1041-1059) protects against this by calling upload_to_presigned_url before finalize, but the Lambda API exposes finalize_upload as a direct parameter with no validation that the file actually exists. An attacker or buggy client calling finalize_upload=True without uploading creates orphaned metadata files that corrupt the KB index. Severity is HIGH because KB indexing failures are data-integrity issues, though practical reachability is constrained to direct API calls (clients should use the numa_tool.py workflow).
- **Suggested fix:** Add head_object verification before creating metadata sidecar in the finalize_upload path. Around line 1123, after the condition `if not get_presigned_url:` and before the metadata creation, add: `if finalize_upload: s3_client.head_object(Bucket=DATA_BUCKET_NAME, Key=s3_key)` with exception handling to raise ValueError if NoSuchKey. This ensures the data file actually exists before recording metadata, preventing orphaned metadata files from being created.

### H3. DynamoDB exception handler too specific, masks other failures

- **File:** `lambdas/python/workspace-chat-tools/tools/pipedream_integration.py:315`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-wschat-misc
- **What's wrong:** The idempotency guard catches only `dynamodb.exceptions.ConditionalCheckFailedException`, but other DynamoDB errors (ValidationException, ResourceNotFoundException, AccessDeniedException, network timeout, etc.) will propagate uncaught and crash the handler. This leaves the execution_status in 'executing' state indefinitely, permanently blocking retry of that approval.
- **Impact:** If DynamoDB has a transient error (throttling, network blip) or configuration issue (wrong table name, insufficient IAM permissions), the approval record gets stuck in 'executing' state forever. Subsequent retries will also fail with the same DynamoDB error, never reaching the application logic. Users cannot retry the action.
- **Verifier reasoning:** The bug is real. Line 315 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/workspace-chat-tools/tools/pipedream_integration.py catches only `dynamodb.exceptions.ConditionalCheckFailedException`. The `update_item()` call at lines 301-314 can raise other exceptions: ValidationException (wrong attributes), ResourceNotFoundException (missing table), AccessDeniedException (IAM), ClientError (network timeout), etc. These will propagate uncaught from the try block, crashing the handler. If the update_item partially succeeds before throwing, execution_status will be left at 'executing', blocking retries. The exception handling scope is provably too narrow — only one specific exception class is caught while many others can occur from the same boto3 call.
- **Suggested fix:** Replace the narrow exception handler with a broader catch that handles all DynamoDB errors but preserves the idempotency logic:

```python
try:
    dynamodb.update_item(
        TableName=INTEGRATIONS_APPROVAL_TABLE,
        Key={"approval_id": {"S": approval_id}},
        UpdateExpression="SET execution_status = :executing",
        ConditionExpression=(
            "attribute_not_exists(execution_status) "
            "OR execution_status IN (:pending, :unknown)"
        ),
        ExpressionAttributeValues={
            ":executing": {"S": "executing"},
            ":pending": {"S": "pending"},
            ":unknown": {"S": "unknown"},
        },
    )
except dynamodb.exceptions.ConditionalCheckFailedException:
    logger.warning(
        "Idempotency guard: action already executed",
        approval_id=approval_id,
    )
    return {
        "status": "already_executed",
        "message": "This action has already been executed.",
    }
except Exception as exc:
    # Other DynamoDB errors (validation, permissions, network, throttling)
    # should not silently pass — log and re-raise to prevent stuck state
    logger.error(
        "Failed to acquire idempotency lock due to DynamoDB error",
        approval_id=approval_id,
        error=str(exc),
    )
    raise
```

This ensures that only the intended idempotency condition (already-executed state) returns gracefully; all other errors propagate for upstream handling or retry logic.

### H4. Cross-request Lambda container state leakage in ops tool user group cache

- **File:** `lambdas/python/workspace-chat-tools/tools/ops.py:37, 75`
- **Category:** security · **Confidence:** high · **Partition:** py-wschat-misc
- **What's wrong:** The `_USER_GROUPS_CACHE` dict at module level persists group membership across Lambda invocations. If UserA gets cached with groups=['user'] and then UserB authenticates with the same user_sub (e.g., account takeover, compromised session), UserB will see UserA's cached groups. More critically, if the Cognito user's group membership changes during a warm container's lifetime, the cache serves stale data.
- **Impact:** In production: (1) If a user's groups are revoked (e.g., admin removed), their old group cache persists for the container's lifetime (~15 min), allowing continued admin access after revocation. (2) In account takeover scenarios, the attacker inherits the legitimate user's group cache without needing valid Cognito credentials.
- **Verifier reasoning:** The cache vulnerability is REAL and manifesting. The module-level `_USER_GROUPS_CACHE` dict at line 37 of lambdas/python/workspace-chat-tools/tools/ops.py persists Cognito group membership across warm Lambda invocations without TTL. When an admin user's groups are revoked in Cognito, the same Lambda container reused for ~15 minutes continues returning stale cached groups. At line 1748, `_resolve_user_groups(user_sub, event.get("user_groups"))` is called, which checks the cache at line 58-60 and returns the cached value without re-fetching from Cognito. These stale groups are then passed to downstream ops Lambdas (numa-ops-config-api, etc.) at lines 1887-1890, which trust the groups parameter (via resolveAuthContext at numa-ops-config-api line 148-157) and enforce authorization checks using `isAdmin(auth)` that includes('admin') (line 178). Admin-only operations like create_field, update_crm_config, update_supplier_config use these stale groups for authorization (lines 369, 404, 866, 885 of numa-ops-config-api/index.ts). The window is the Lambda container lifetime (~15 minutes), and multiple concurrent containers could exacerbate this. This is a real privilege-retention vulnerability, not account takeover (the account takeover claim was unfounded - user_sub is immutable per authenticated identity).
- **Suggested fix:** Implement a TTL-based cache with invalidation: (1) Add timestamp to cache entries: `_USER_GROUPS_CACHE[user_sub] = (groups, time.time())`; (2) Set a TTL (e.g., 5 minutes): `TTL_SECONDS = 300`; (3) In \_resolve_user_groups, check both cache hit and TTL: `cached, ts = _USER_GROUPS_CACHE.get(user_sub, (None, 0)); if cached is not None and time.time() - ts < TTL_SECONDS: return cached`; (4) Always re-fetch on TTL expiry; (5) Alternatively, disable the cache and accept the Cognito latency overhead, or implement request-scoped cache (per-invocation) instead of module-level. Best fix: per-invocation cache via adding cache dict as parameter to functions, eliminating cross-request state leakage entirely.

### H5. Global session state in web search causes concurrent request interference

- **File:** `lambdas/python/numa-chat-agent/numa_chat_agent/tools/web_search.py:562-644`
- **Category:** logic · **Confidence:** high · **Partition:** py-chatagent-pd
- **What's wrong:** Three module-level global variables (\_last_search_time, \_search_count_in_session, \_failed_searches_in_row) track search session state without synchronization. In concurrent Lambda executions, one user's search state pollutes another user's search timing, backoff calculations, and failure counters.
- **Impact:** Production failure: Concurrent users experience unpredictable search behavior. One user's failed searches trigger exponential backoff for another user's subsequent searches. Search delays accumulate non-deterministically based on request ordering. Users report intermittent 'random delays' in web search that correlate with other users' activity on the platform.
- **Verifier reasoning:** The bug is REAL. Module-level globals `_last_search_time`, `_search_count_in_session`, and `_failed_searches_in_row` (lines 562-564) persist across sequential Lambda invocations when containers are reused. These state variables are read and modified without request-scoped isolation (lines 606-644, 684, 724). When Lambda reuses a warm container for a different user's request, that user inherits the previous user's search state: if the prior request's searches failed, `_failed_searches_in_row` persists (line 607), causing exponential backoff to be applied incorrectly to an innocent user. The claim's terminology of "concurrent" is technically imprecise—Lambda containers execute sequentially, not concurrently—but the functional impact is identical: one user's failed searches trigger delays for another user's subsequent search requests. Code evidence: Line 562-564 define globals without initialization guards; line 606 reads `_failed_searches_in_row` to calculate backoff without resetting per-request; line 617 reads `_search_count_in_session` to apply session multiplier across user boundaries. The correct fix would initialize these per-request or use a request-scoped context object instead of module-level state.
- **Suggested fix:** Initialize the three globals at the start of each `google_search()` call based on request context, or use request-scoped context storage: (1) Reset `_search_count_in_session = 0` and `_failed_searches_in_row = 0` at function entry (not just on cold start); (2) Or refactor to use function-scoped dictionaries passed through the call stack, eliminating module-level persistence entirely; (3) Or use a context-aware cache keyed by request ID / user ID if true session state is desired.

### H6. JWKS cache never invalidates - stale keys cause authentication failures

- **File:** `lambdas/python/numa-chat-agent/numa_chat_agent/app.py:47-56`
- **Category:** logic · **Confidence:** high · **Partition:** py-chatagent-pd
- **What's wrong:** The JWKS (JSON Web Key Set) cache at module level is fetched once and never refreshed. If AWS rotates Cognito signing keys, the cached keys become stale and all subsequent JWT verifications fail with 'Unable to find matching key' until Lambda cold start.
- **Impact:** Production failure: During Cognito key rotation events, all tokens signed with new keys are rejected. Users experience authentication failures for hours until Lambda containers are recycled. API becomes unavailable for new key rotation windows. Service degradation correlates with Cognito maintenance events.
- **Verifier reasoning:** The bug is REAL and CONFIRMED by code inspection. The `_get_jwks()` function at lines 50-56 implements a simple check-if-None caching pattern that never invalidates. During Cognito key rotation events (normal AWS operation), new JWTs are signed with new key IDs that don't exist in the stale cached JWKS. The `_verify_jwt_token()` function at lines 69-75 searches for matching keys and fails with "Unable to find matching key" if not found, with NO retry or refresh logic. AWS's own JWT verification library (aws-jwt-verify, available in node_modules/aws-jwt-verify/README.md) explicitly documents that JWKS cache should "thereafter only upon key rotations (detected by the occurrence of a JWT with a kid that is not yet in the cache)" - this detection logic is completely absent. The code will fail every request with a rotated key until the Lambda container is recycled (cold start). This is not a misread - the missing logic is clearly absent from lines 50-56 and 69-75. The identical vulnerability exists in shared-nova-api/app.py (lines 91-99, same pattern). This manifests as production failures during Cognito maintenance windows.
- **Suggested fix:** Implement key rotation detection by re-fetching JWKS when a key ID is not found:

```python
def _get_jwks() -> Dict[str, Any]:
    if _jwks_cache["data"] is None:
        jwks_url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
        resp = requests.get(jwks_url, timeout=10)
        resp.raise_for_status()
        _jwks_cache["data"] = resp.json()
    return _jwks_cache["data"]


def _verify_jwt_token(token: str) -> Dict[str, Any]:
    if token.startswith("Bearer "):
        token = token[7:]

    unverified = jwt.get_unverified_header(token)
    kid = unverified.get("kid")
    if not kid:
        raise ValueError("Token missing 'kid' header")

    # Try up to 2 times: first with cached JWKS, then with refreshed JWKS if key not found
    for attempt in range(2):
        jwks = _get_jwks()
        rsa_key = None
        for jwk in jwks.get("keys", []):
            if jwk.get("kid") == kid:
                rsa_key = algorithms.RSAAlgorithm.from_jwk(jwk)
                break

        if rsa_key:
            # Key found, proceed with verification
            payload_check = jwt.decode(
                token,
                rsa_key,
                algorithms=["RS256"],
                issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
                options={"verify_exp": True, "verify_aud": False},
            )

            token_use = payload_check.get("token_use")
            if token_use == "id":
                payload = jwt.decode(
                    token,
                    rsa_key,
                    algorithms=["RS256"],
                    audience=USER_POOL_CLIENT_ID,
                    issuer=f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}",
                    options={"verify_exp": True},
                )
            elif token_use == "access":
                if payload_check.get("client_id") != USER_POOL_CLIENT_ID:
                    raise ValueError("Invalid client_id")
                payload = payload_check
            else:
                raise ValueError(f"Unknown token_use: {token_use}")

            if not payload.get("sub"):
                raise ValueError("Token missing required 'sub' claim")
            return payload

        # Key not found - might be due to key rotation. Force refresh and retry once.
        if attempt == 0:
            _jwks_cache["data"] = None

    # After 2 attempts, key still not found
    raise ValueError("Unable to find matching key")
```

This implements the AWS best practice: refresh the JWKS when encountering a `kid` not in the cache, handling key rotation transparently.

### H7. Missing connection health check before MCP tool execution causes intermittent failures

- **File:** `lambdas/python/numa-chat-agent/numa_chat_agent/mcp/providers/pipedream/router.py:1959-1963`
- **Category:** logic · **Confidence:** high · **Partition:** py-chatagent-pd
- **What's wrong:** MCP tool calls are executed without verifying the client connection is healthy. Stale connections, authentication issues, or closed clients fail silently at tool execution time with non-specific error messages, making failures appear random and unpredictable.
- **Impact:** Production failure: Same tool call works sometimes but fails other times depending on connection lifecycle. Users report flaky integrations where 'the action worked yesterday but fails today' without any code changes. Errors are vague rather than clear, making debugging difficult.
- **Verifier reasoning:** The bug is REAL and explicitly acknowledged in the code itself. Lines 1711-1742, 1847-1866, and 1892-1912 contain logger.critical() and logger.warning() calls documenting this exact issue. The code at lines 1959-1963 calls self.\_mcp_client.call_tool_sync() without prior health verification. Lines 1744-1844 provide detailed commented-out code showing a proposed fix using list_tools_sync(). The failure mode is real: if a connection becomes stale, disconnected, or invalid between initialization and tool execution, the error only manifests at call time (lines 1959-1963), caught by the exception handler (lines 1998-2011), but may present vague error messages to users rather than clear "connection unhealthy" indicators. The logger warnings explicitly state this causes "intermittent_connection_drops", "unpredictable_timeouts", "inconsistent_user_experience", and "random_execution_failures". Exception handling exists but doesn't prevent the early detection problem.
- **Suggested fix:** Implement the health check function documented in the commented-out code (lines 1763-1844). Before calling self.\_mcp_client.call_tool_sync() at line 1959, add:

```python
# Verify connection health before tool execution
connection_healthy, health_message = verify_mcp_connection_health(self._mcp_client, self.integration_name)
if not connection_healthy:
    logger.error(
        "RELIABILITY_FAILURE: MCP connection health check failed - aborting tool execution",
        integration=self.integration_name,
        tool=definition.name,
        request_id=request_id,
        tool_use_id=tool_use_id,
        health_failure_reason=health_message
    )
    raise RuntimeError(f"MCP connection health check failed for {self.integration_name}: {health_message}")
```

Where verify_mcp_connection_health() uses list_tools_sync() as a lightweight health check with timeout protection (as detailed in lines 1763-1844).

### H8. Fixed 60-second STS proof expiry causes authentication timeouts under load

- **File:** `lambdas/python/numa-chat-agent/numa_chat_agent/mcp/providers/pipedream/proxy.py:20-31`
- **Category:** logic · **Confidence:** high · **Partition:** py-chatagent-pd
- **What's wrong:** STS presigned URL proof is generated with a fixed 60-second expiry. Under load (Lambda cold starts 1-10s, network latency 0.5-2s, proxy processing 2-5s), the total time approaches or exceeds 60 seconds, causing the proof to expire before the proxy can use it.
- **Impact:** Production failure: During peak traffic or after Lambda cold starts, the STS proof expires before the proxy can validate it. Proxy invocations fail with 'expired proof URL' errors. Users experience intermittent authentication failures that correlate with high load or cold start periods. Success rate appears to depend on system conditions rather than code.
- **Verifier reasoning:** The bug is real and manifest. At line 30 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/numa-chat-agent/numa_chat_agent/mcp/providers/pipedream/proxy.py, the STS proof URL is generated with ExpiresIn=60 seconds. However, the calling code at line 462 passes this single-generated proof to \_invoke_lambda_with_retry() (line 898) which can take up to ~127 seconds total (30s base + 40s + 50s for three attempts plus exponential backoff), far exceeding the 60-second window. Critically, the proxy lambda's security validator (line 140 of security_validator.py) checks that the STS proof URL is no older than 120 seconds - meaning even if the initial invocation succeeded in <60s, retries with the same old proof would fail the freshness check. The proof is generated only once and never regenerated during retries (lines 460-479), so any delayed invocation will use an expired or too-old proof. The extensive logging at lines 33-72 explicitly documents this as a "CRITICAL" risk with detailed failure scenarios. Comparison: pipedream-relay correctly uses 120-second expiry (matching the proxy's validation window), while numa-chat-agent incorrectly uses 60 seconds. The mismatch is the root cause of intermittent "expired proof" auth failures under load.
- **Suggested fix:** Change line 20 from `def generate_sts_proof_url(region: str = "us-east-1", expires: int = 60) -> str:` to `def generate_sts_proof_url(region: str = "us-east-1", expires: int = 120) -> str:` to align the STS proof expiry window (120 seconds) with both the retry logic duration and the proxy's freshness validation requirement (which checks age <= 120 seconds at line 140 of security_validator.py). This matches the 120-second default already used in pipedream-relay.

### H9. IP Allowlist Bypass via X-Forwarded-For Header Spoofing

- **File:** `lambdas/python/shared-nova-api/shared_nova_api/app.py:958`
- **Category:** security · **Confidence:** high · **Partition:** py-shared-nova
- **What's wrong:** The IP allowlist check extracts the first IP from the X-Forwarded-For header without trusting infrastructure boundaries. An attacker can send a custom X-Forwarded-For header with a spoofed allowed IP as the first value, causing the header parsing to extract the attacker's fake IP instead of the actual client IP.
- **Impact:** A user who creates a document share with IP allowlist restriction (e.g., allowing only 10.0.0.0/8) can be bypassed by any attacker. The attacker simply includes 'X-Forwarded-For: 10.0.0.1' in their request, and the allowlist check will pass.
- **Verifier reasoning:** The vulnerability is REAL and exploitable in production. Analysis of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/shared-nova-api/shared_nova_api/app.py confirms: (1) Line 958 extracts only the FIRST IP from X-Forwarded-For without validation. (2) Line 1086-1087 stores user-provided allowed_ips without validation. (3) No proxy trust middleware is configured in the app. (4) Infrastructure in infra/constructs/numa-frontend-infra-construct.ts line 573 exposes shared-chat via CloudFront with originRequestPolicyId 'b689b0a8-53d0-40ab-baf2-68738e2966ac' (AllViewerExceptHostHeader), which forwards ALL client-supplied headers including X-Forwarded-For. This means an attacker can send X-Forwarded-For: [allowed-ip], [attacker-ip] and the code will extract and validate only the first (spoofed) IP, bypassing the allowlist entirely. The attack is reachable via any public endpoint calling \_check_ip_allowlist (lines 1501, 1698, 1786, 2062, 2107, 2234, 2308).
- **Suggested fix:** Use the LAST IP in X-Forwarded-For instead of the first: change line 958 from `forwarded_for.split(",")[0].strip()` to `forwarded_for.split(",")[-1].strip()`, OR configure middleware to validate X-Forwarded-For against CloudFront's IP ranges, OR use CloudFront's native `CloudFront-Viewer-Address` header instead (requires code change to extract from that header when present). The safest approach: (1) Use StrictHTTP middleware with trusted_hosts configured to CloudFront's IP range, OR (2) Validate that request.client.host (the direct connection IP) matches CloudFront's expected egress IPs, then trust X-Forwarded-For, OR (3) Use the rightmost IP in the chain: `client_ip_str = forwarded_for.split(",")[-1].strip()` to extract the IP closest to the load balancer.

### H10. Dropzone Upload Quota Bypass via Race Condition

- **File:** `lambdas/python/shared-nova-api/shared_nova_api/app.py:2131-2137`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-shared-nova
- **What's wrong:** The quota validation in the upload endpoint reads `used_quota_mb` from the share record, checks if the new upload would exceed the limit, and returns a presigned URL. However, between the read and the actual confirmation via `/upload/confirm`, multiple concurrent requests can read the same `used_quota_mb` value, bypass the quota check, and all confirm their uploads, collectively exceeding the quota.
- **Impact:** A dropzone with 100 MB quota can receive 200 MB of uploads if two users each request a 150 MB file simultaneously. Both requests pass the quota check (used=0, each sees 0+150=150 < 100MB limit is false, so both should fail... wait, let me recalculate: used=0, limit=100, first request: 0+150>100=True, fails. So this isn't the issue).
- **Verifier reasoning:** The bug is real and manifests as a classic TOCTOU (time-of-check-time-of-use) race condition. Code reads `used_quota_mb` at line 2134 in the `/upload` endpoint, validates against `total_quota_mb`, and generates a presigned URL. However, the confirm endpoint at line 2246 performs an unconditional atomic increment of `used_quota_mb` with NO post-update validation. Multiple concurrent requests can all read the same `used_quota_mb` value (e.g., 50 MB), each calculating 50+40=90 < 100 and all passing. When all confirmations execute sequentially on DynamoDB, the counter becomes 50+40+40+40=170 MB, exceeding the 100 MB limit. The code logs the final quota (lines 2275-2288) but does not reject the upload or rollback. This directly contradicts the quota enforcement intent and can cause storage overages.
- **Suggested fix:** Add a ConditionExpression to the DynamoDB UpdateItem call at line 2246 that atomically verifies the new quota won't exceed the total: `ConditionExpression="(if_not_exists(used_quota_mb, :zero_d) + :size_mb) <= :total_quota"`. If the condition fails, catch the ConditionalCheckFailedException and return a 413 error rejecting the upload. This ensures quota enforcement is atomic and prevents the race condition.

### H11. Chat Stream Stores Partial State on Exception During Message Processing

- **File:** `lambdas/python/shared-nova-api/shared_nova_api/app.py:2001-2015`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-shared-nova
- **What's wrong:** In the chat endpoint's streaming response, chat history messages are stored (lines 2001-2012) and the call count is incremented (line 2015) before the completion event is sent (lines 2018-2026). If an exception occurs during message storage or call count increment, these operations may partially succeed, and the exception handler (lines 2036-2040) yields an error response without rolling back the partial state.
- **Impact:** A user's call count can be incremented even if the chat fails. More critically, if message storage succeeds but call count increment fails, or vice versa, the share record and chat history are left in an inconsistent state. Future chats for that share will include incomplete or orphaned messages.
- **Verifier reasoning:** The bug is real and confirmed by code inspection. The streaming chat endpoint stores chat history messages (via chat_history.add_message() at lines 2001-2012 in app.py) which internally handle exceptions silently (chat_history.py lines 419-432), then calls increment_call_count(uuid) at line 2015 with NO exception handling. If increment_call_count() throws a DynamoDB exception (ClientError, connection timeout, etc.), the exception propagates to the outer try-except at line 2036, yielding an error response at line 2040. However, the chat history messages are already persisted in DynamoDB because the add_message() calls completed before the increment_call_count() failure. This leaves the share record in an inconsistent state: chat history entries exist but the call count was not incremented. The operations are independent DynamoDB calls (put_item on shared-chat-history table vs update_item on shares table) with no transactional atomicity. A future request will see incomplete chat history without a corresponding call count increment, violating the invariant that every stored message corresponds to a counted call.
- **Suggested fix:** Wrap the increment_call_count() call in a try-except block, or better: wrap both add_message calls and increment_call_count in a transaction. The most practical fix given current DynamoDB limitations is to either: (1) Call increment_call_count BEFORE storing messages, so if it fails, messages aren't stored; (2) Add exception handling around increment_call_count() and handle/retry failures before yielding the error response; (3) Implement a transaction that stores all state changes atomically. Option 1 is simplest - reorder lines 2015, 2001-2012 so the call count is incremented first. Alternatively, wrap increment_call_count in try-except with explicit error handling: `try: increment_call_count(uuid) except Exception as e: logger.error(...); raise` to prevent partial state when this operation fails.

### H12. Error Message Leakage in HTTP Response Bodies

- **File:** `lambdas/python/shared-nova-api/shared_nova_api/app.py:2199`
- **Category:** security · **Confidence:** high · **Partition:** py-shared-nova
- **What's wrong:** The dropzone_upload endpoint returns detailed exception messages in the HTTP response body (line 2199). If the S3 bucket name, key path, or boto3 errors contain sensitive information, these are exposed to the client.
- **Impact:** An attacker can observe error messages to infer the S3 bucket structure, IAM configuration, or internal system details. For example, 'Failed to generate presigned URL: NoSuchBucket: numa-prod-data' reveals the bucket name and that it doesn't exist in the current account.
- **Verifier reasoning:** The vulnerability is real and confirmed by code inspection at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/shared-nova-api/shared_nova_api/app.py line 2199. The dropzone_upload endpoint catches all exceptions from s3.generate_presigned_url() and directly includes the exception message in the HTTP response detail field: `detail=f"Failed to generate upload URL: {e}"`. This is a security issue because: (1) boto3's generate_presigned_url() raises ClientError exceptions that include sensitive S3 error messages (e.g., "NoSuchBucket: bucket-name"), (2) the endpoint is public per the docstring at line 2098 ("public with optional auth"), allowing external attackers to trigger errors, (3) the same file demonstrates the correct pattern at line 470 where other exception handlers log errors internally but return generic messages to clients, and (4) the HTTPException handler at line 2747-2752 returns the detail field directly in JSON responses to clients. The severity is high (not just medium) because the endpoint is publicly accessible without strong authentication requirements, making it easy for attackers to probe and extract infrastructure details like bucket names and IAM configuration.
- **Suggested fix:** Replace line 2199 with a generic error message that does not include the exception details: `detail="Failed to generate upload URL"` instead of `detail=f"Failed to generate upload URL: {e}"`. The full error details are already logged at line 2191-2197 for debugging purposes, so removing the exception message from the HTTP response maintains debugging capability while preventing information leakage to clients.

### H13. Table cell alignment lost when filtering empty cells

- **File:** `lambdas/python/extract-content-from-file/lambda_function.py:1135`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-content-extract
- **What's wrong:** The \_collect_row_segments function filters out empty cells before joining with ' | ', destroying table column alignment. Cells with content are concatenated directly, losing positional information for empty cells in the middle of rows.
- **Impact:** When extracting DOCX files with tables containing empty cells, the table structure is corrupted. A table like [['A', '', 'B']] becomes 'A | B' instead of 'A | | B', making it impossible to reconstruct the original table structure. This causes data loss in extracted documents.
- **Verifier reasoning:** The bug is REAL and manifests in the \_collect_row_segments function at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/extract-content-from-file/lambda_function.py. The function filters out empty cells at two levels:

1. Lines 1131-1132: When a cell has a segment at the current index, the code checks `if text:` before appending to row_cells. For empty strings (e.g., truly empty cell content), this skips the append.

2. Line 1135: The join uses a generator expression `if cell_text`, filtering out empty strings again.

This double-filtering destroys table alignment. For a row with 3 cells [['A'], [''], ['C']], the function builds row_cells=['A', 'C'] (missing the middle empty cell) and produces 'A | C' instead of 'A | | C'. The missing column makes it impossible to reconstruct the original table structure.

I verified this is genuinely a bug by:

- Tracing through the exact code path with concrete data
- Checking the Excel extraction function (lines 1294-1295) which properly does `" | ".join(row_cells)` WITHOUT filtering
- Confirming there are no tests covering empty cells in DOCX tables
- Verifying no guards or validation logic prevents this path from executing

The bug is reachable in normal use (any DOCX table with empty cells) and causes actual data loss.

- **Suggested fix:** Lines 1131-1132 should always append the text (even if empty):

```python
text = segments[segment_index]
row_cells.append(text)  # Remove the 'if text:' check
```

And line 1135 should join without filtering:

```python
joined = " | ".join(row_cells)  # Remove the 'if cell_text' generator filter
```

This preserves empty cells as empty strings in the output, maintaining table column alignment.

### H14. Missing input validation for return_content parameter

- **File:** `lambdas/python/extract-content-from-file/lambda_function.py:368-369`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-content-extract
- **What's wrong:** The handler allows return_content to be set to true without checking the actual response size. The code comment on line 279 warns 'only set this to true when it's certain this will be less than 256KB', but there is no runtime validation to enforce this limit.
- **Impact:** If a large document is extracted and return_content=true is set, the lambda response could exceed API Gateway's 6MB payload limit (or 256KB soft limit), causing the entire invocation to fail or return truncated content. No error is raised; the response is simply sent oversized.
- **Verifier reasoning:** The bug is REAL. Lines 368-369 unconditionally add content to the result dict without checking size: `if return_content: result["content"] = _document_to_string(document)`. The function `_document_to_string()` (lines 1048-1050) simply joins all page text with newlines—no truncation, no size validation. Line 279 has a comment acknowledging the 256KB risk ("only set this to true when it's certain this will be less than 256KB") but there is ZERO runtime code enforcement. While AWS Lambda does enforce hard limits (~6MB synchronous response), exceeding those limits causes the entire invocation to fail without graceful error handling. The code demonstrates awareness of payload size risks elsewhere (line 1566 comment about Step Functions limits), making this oversight more significant. A large document extraction with return_content=true will silently fail at the Lambda boundary rather than being caught and handled by the application code.
- **Suggested fix:** Add explicit size validation before adding content to result:

```python
if return_content:
    content_str = _document_to_string(document)
    content_size_kb = len(content_str.encode('utf-8')) / 1024
    if content_size_kb > 256:
        logger.warning(
            "Extracted content exceeds 256KB limit",
            content_size_kb=content_size_kb,
            input_key=input_key
        )
        # Either truncate or skip inline content
        # Option 1: Raise error with clear message
        raise ValueError(
            f"Extracted content ({content_size_kb:.1f}KB) exceeds 256KB limit. "
            "Content is available in S3 output file."
        )
        # Option 2: Return truncated content with warning
        # content_str = content_str[:256000]  # ~256KB of chars
    result["content"] = content_str
```

This ensures clear, predictable behavior: either reject oversized content with a descriptive error, or truncate with an explicit warning to the caller.

### H15. Race condition in consolidated vault token refresh allows stale token persistence

- **File:** `lambdas/python/oauth-files-api/vault_integration.py:443-480`
- **Category:** race · **Confidence:** high · **Partition:** py-oauth-connectors
- **What's wrong:** After token refresh succeeds, the code updates the in-memory entry and writes back to vault. However, there is NO atomic compare-and-set. If a concurrent request reads the vault between refresh completion and write, it will get the old expired token. Worse, concurrent refreshes from the same user can both succeed and the last write wins, potentially persisting the wrong token.
- **Impact:** In production, concurrent calls to the same provider for the same user can result in: (1) one token refresh overwriting another's result with stale data, (2) LLM agent receiving expired tokens that fail on API calls, (3) silent token degradation where older refresh wins over newer one, causing 401 errors minutes after successful 200.
- **Verifier reasoning:** This is a REAL, reachable race condition. Evidence from actual code:

**File**: /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/oauth-files-api/vault_integration.py
**Lines 443-480 (get_oauth_token function)**: The function reads user vault once (line 404), then if the token is expired (line 444), it calls refresh_access_token() (line 451) which is async and can take several seconds. After refresh succeeds (line 452), it updates the in-memory vault_data and calls \_put_user_consolidated_vault() (line 476).

**The race condition**:

1. Two concurrent Lambda invocations for the same user+provider both reach line 404 and read the vault with an expired token
2. Both reach line 444 (secret.is_valid returns False)
3. Both call refresh_access_token() (line 451) and both succeed, getting new tokens from the OAuth provider
4. Both build vault_data structures with their respective new tokens (lines 468-474)
5. Both call \_put_user_consolidated_vault() (line 476), which calls secrets_manager.put_secret_value() (vault_integration.py line 167)
6. **No compare-and-swap**: AWS Secrets Manager's put_secret_value() API simply overwrites the secret with no versioning check, CAS, or ClientRequestToken support for conditional writes
7. **Last write wins**: Whichever Lambda's write completes last overwrites the other's token, potentially persisting a stale or different token

**Why it manifests**: The oauth-files-api Lambda (lines 160-172 of oauth-integration-construct.ts) has NO ReservedConcurrentExecutions setting, meaning AWS Lambda can invoke it concurrently for the same user (typical during high load or multiple API calls). The refresh_access_token() call (lines 357-384 of vault_integration.py) is async and synchronous I/O to an external OAuth provider, making the window between refresh and write very wide.

**Impact matches claim**:

- Concurrent refreshes from the same user can result in one overwriting another (confirmed by code path)
- LLM agents can receive expired tokens if an older refresh overwrites a newer one
- Silent token degradation where 401 errors occur minutes after successful 200 responses (confirmed by the refresh_expires_at calculation on line 461 being per-Lambda, not globally coordinated)

**NOT mitigated by**:

- No DynamoDB lock in the code
- No version/ETag checks in \_put_user_consolidated_vault()
- No ClientRequestToken usage
- No reserved concurrency setting in infrastructure
- In-memory cache (lines 44-47) only applies to company config, not user tokens
- **Suggested fix:** Implement optimistic locking with token expiry comparison. Before writing the refreshed token, re-read the vault and compare expiry times. Only write if the new token is fresher:

```python
# After line 451 refresh succeeds, before line 476 write:
# Re-read vault to detect concurrent refresh
current_vault = _get_user_consolidated_vault(user_id)
if current_vault:
    current_secrets = current_vault.get("secrets", {})
    current_entry = current_secrets.get(secret_key, {})
    current_fields = current_entry.get("fields") or current_entry
    current_expires_at = current_fields.get("expires_at", "")

    # Only write if new token is fresher (later expiry)
    try:
        current_dt = datetime.fromisoformat(current_expires_at.replace("Z", "+00:00"))
        new_dt = datetime.fromisoformat(secret.expires_at.replace("Z", "+00:00"))
        if current_dt > new_dt:
            # Another Lambda refreshed to a fresher token; use theirs instead
            logger.info(f"Concurrent refresh detected for {provider} user {user_id}; using fresher token")
            return current_fields.get("access_token", secret.access_token)
    except (ValueError, TypeError):
        pass  # Malformed dates; proceed with write

# Write only if our token is fresher or no concurrent write occurred
if _put_user_consolidated_vault(user_id, vault_data):
    logger.info(f"Successfully refreshed OAuth token for {provider} user {user_id}")
    return secret.access_token
```

This prevents the last-write-wins scenario by detecting fresher concurrent refreshes and preferring them. Alternatively, use DynamoDB conditional writes with a refresh-lock key for stronger isolation.

### H16. Vault secret update merges silently, loses template_version bump causing validation skip

- **File:** `lambdas/python/vault-secrets/lambda_function.py:367-420`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-oauth-connectors
- **What's wrong:** \_handle_update_secret merges request body over existing secret (lines 380-384). If the update body doesn't include template_version, the old one persists. There's no explicit versioning on update. When template definitions are upgraded, secrets keep old template_version in metadata, allowing them to skip new validators.
- **Impact:** Admin updates OAuth-template v1.0 to v2.0 (adds required field 'enterprise_scope'). Admin bulk-updates existing secrets via API without passing template_version. Secrets keep old template_version=1.0. Later validation code checks template_version and skips v2.0 validators, allowing secrets missing enterprise_scope to persist and fail on use.
- **Verifier reasoning:** The bug is REAL and I can cite the exact code path. In lambda_function.py lines 380-384, \_handle_update_secret merges the existing secret with the update request body. The existing secret from storage (returned by get_vault_secret) has template_version nested in metadata only, not at the top level. When merged via spread operators, if the request body doesn't include a top-level template_version key (which is normal/expected for partial updates), the merged data still has template_version only in metadata. Then at consolidated_storage.py line 387, add_secret_to_vault does `secret_data.get("template_version")` which looks for the top-level key and returns None. The secret is saved with metadata.template_version = None. This causes silent data loss of the version metadata on any update that doesn't explicitly include template_version at the top level. However, the claim's assertion about "skipping validators" is incorrect—the code contains no version-aware validators that would skip based on template_version. The real impact is metadata loss, which could break audit trails and future version-aware features.
- **Suggested fix:** In \_handle_update_secret (lambda_function.py ~380-384), after merging, explicitly preserve template_version from the existing secret's metadata: `if "template_version" not in updated_data and "metadata" in existing_secret: updated_data["template_version"] = existing_secret["metadata"].get("template_version")`. Alternatively, have add_secret_to_vault check both locations: line 387 should be `"template_version": secret_data.get("template_version") or secret_data.get("metadata", {}).get("template_version")`.

### H17. Race condition: Concurrent month aggregate updates can lose conversation credits

- **File:** `lambdas/python/credit-debit/lambda_function.py:371-408`
- **Category:** race · **Confidence:** high · **Partition:** py-credits-cost
- **What's wrong:** The month aggregate calculation reads all conversations in a month from GSI2, computes a total, and overwrites. When two credit-debit lambdas execute concurrently for different conversations in the same month, both may read the same set of prior conversations from the eventually-consistent GSI2 index. Lambda A computes total=prior_convs+conv_A and writes. Lambda B computes total=prior_convs+conv_B (never seeing conv_A because it read GSI2 before conv_A was indexed) and overwrites, losing conv_A's credits from the aggregate.
- **Impact:** If two conversations are metered within the GST2 index consistency window (typically <1 second), one will disappear from the monthly aggregate. The conversation's credits will still exist in the CONV#\* row, but the CLIENT#/MONTH# aggregate will undercount. Audit queries rolling up by month will show lower total_credits and credit_revenue than the sum of individual conversations.
- **Verifier reasoning:** The race condition is REAL and manifesting. Analysis:

1. CONFIRMED: Lines 371-382 perform a query on GSI2 (eventually consistent index) without any concurrency protection.

2. CONFIRMED: Lines 388-391 only override with the CURRENT conversation's data: `contrib[conv_key] = (float(meta["creditsCharged"]), ...)`. This is idempotent for re-metering the same conversation but provides zero protection against concurrent metering of different conversations.

3. CONFIRMED: Lines 392-408 compute an aggregate total and perform an unconditional `put_item` (last-write-wins). There is no ConditionExpression, no atomic ADD operation, no version checking.

4. CONFIRMED: The race scenario is reproducible:
   - Lambda A processes convA for month M
   - Lambda B processes convB for month M
   - Both read GSI2 before either's META row is indexed in the GSI
   - Both see [conv1, conv2] only
   - A computes: conv1 + conv2 + convA and writes MONTH#M row
   - B computes: conv1 + conv2 + convB (never saw convA) and OVERWRITES MONTH#M row
   - Result: convA's credits vanish from the monthly aggregate row (though the CONV#convA META row still exists)

5. CONFIRMED: The comment at line 363-365 states 'concurrency-tolerant' but this is misleading. The code is only idempotent for re-processing the same conversation. It is NOT tolerant of concurrent processing of different conversations in the same month.

6. CONFIRMED: The impact matches the claim - audit queries summing the MONTH# row will undercount compared to summing individual CONV# META rows if two conversations are metered within the GSI2 indexing window.

Concrete file path: /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/credit-debit/lambda_function.py, lines 371-408.

Fix: Replace the read-compute-write pattern with DynamoDB's atomic UpdateItem using ADD for creditsCharged/consumptionCostUsd, or move monthly reconciliation to a scheduled post-month-close job that processes all conversations atomically.

- **Suggested fix:** Replace lines 368-418 with atomic UpdateItem operations:

```python
if CLIENT_NAME:
    try:
        # Add current conversation atomically instead of read-compute-write
        table.update_item(
            Key={
                "PK": f"CLIENT#{CLIENT_NAME}",
                "SK": f"MONTH#{month}"
            },
            UpdateExpression="ADD creditsCharged :cred, consumptionCostUsd :cons SET creditRevenueUsd = :rev, allocationSnapshot = :alloc",
            ExpressionAttributeValues={
                ":cred": Decimal(str(meta["creditsCharged"])),
                ":cons": Decimal(str(meta.get("consumptionCostUsd") or 0)),
                ":rev": Decimal(str(round(meta["creditsCharged"] * eff_credit, 6))),
                ":alloc": Decimal(str(alloc_snapshot)) if alloc_snapshot else None,
            }
        )
    except Exception as exc:
        logger.warning(
            "month aggregate update failed",
            _name="CREDIT_DEBIT_MONTHAGG",
            phase="cleanup",
            month=month,
            error=str(exc),
        )
```

OR: Eliminate the per-Lambda monthly aggregate entirely. Instead, implement a scheduled month-close job (once per month at billing cutoff) that reads all CONV# META rows for the month, computes the aggregate once atomically, and writes the MONTH# row. This eliminates the race entirely by serializing the aggregate computation.

### H18. Unchecked response array access in policy-builder lambdas

- **File:** `lambdas/python/policy-builder-completion/lambda_function.py:97`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-policy-apps
- **What's wrong:** Direct access to response[0] without validating that response is non-empty. If model.run() returns an empty response list, this will raise IndexError.
- **Impact:** Lambda crashes with IndexError if Bedrock model returns empty response, causing step function failure and policy generation to fail without meaningful error message.
- **Verifier reasoning:** This is a real, reachable bug. Code analysis reveals: (1) AmazonProvider.normalize_response() at line 216 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/bedrock/bedrock/model_providers.py explicitly returns an empty list `[]` on exception, and AnthropicProvider can return an empty list if response content is empty. (2) BedrockClaude3Model.\_process_response() (lines 400-422 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/bedrock/bedrock/**init**.py) does NOT validate that normalized_content is non-empty before passing it to \_convert_to_legacy_format(), which means GPTResponse.response can be an empty list. (3) All six lambda functions directly access response[0] without guards: policy-builder-completion line 97, policy-builder-expert-review line 81, policy-builder-generation line 73, policy-builder-legal-review lines 84 and 122, policy-builder-principles-and-structure line 46, and policy-builder-explainability line 107. When response is empty, these will raise IndexError. The tests (test_bedrock.py) never test the empty response case, so this bug goes undetected.
- **Suggested fix:** Add validation in BedrockClaude3Model.\_process_response() before returning:

```python
def _process_response(self, response: dict, name_for_logging: str, model_used: Optional[str] = None) -> GPTResponse:
    """Process response using provider-specific normalization"""
    result = json.loads(response["body"].read())

    # ... existing code ...

    normalized_content = provider.normalize_response(result)

    # Validate response is not empty
    if not normalized_content:
        raise RuntimeError(
            f"Model returned empty response for {name_for_logging or 'request'}. "
            f"Model used: {model_used or self.current_model_id}"
        )

    legacy_content = self._convert_to_legacy_format(normalized_content)
    return GPTResponse(legacy_content, metadata, model_used)
```

This prevents empty responses from propagating to downstream code and provides a meaningful error message instead of an IndexError.

### H19. Missing bytes-to-string decoding in policy-reviewer

- **File:** `lambdas/python/policy-reviewer/lambda_function.py:261`
- **Category:** type · **Confidence:** high · **Partition:** py-policy-apps
- **What's wrong:** policy_content is read from s3_helpers.read() which returns bytes, but is passed directly to prompt.format() without decoding. This causes TypeError when format() tries to substitute bytes into a string template.
- **Impact:** Lambda fails with TypeError when attempting to format the policy review prompt, causing policy review to fail. Similar issue at line 273 with updated_policy prompt.
- **Verifier reasoning:** The bug is REAL but the manifestation claimed is inaccurate. s3_helpers.read() at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/s3_helpers/s3_helpers/**init**.py line 14 returns bytes. At lambda_function.py line 234, policy_content is assigned this bytes object. It's then passed to get_model_response() at lines 258-266 and 270-277, where it's included in input_data with the bytes object unmodified. In get_model_response() at line 341, prompt.format(\*\*input_data) is called. Python's str.format() does NOT raise TypeError when passed bytes - instead it converts them to their string representation (e.g., b'actual text' becomes the literal string "b'actual text'"). This causes the prompt sent to Bedrock to be malformed with the bytes literal prefix instead of the actual policy content. Testing confirmed: prompt.format(policy_content=b"text") produces "...b'text'..." not "...text...". The claim's reference to policy-drafter line 55 correctly using .decode("utf-8") confirms this is the right pattern. The bug will cause policy reviews to fail or produce incorrect results due to malformed LLM prompts.
- **Suggested fix:** At line 234, change: `policy_content = s3_helpers.read(input_key)` to `policy_content = s3_helpers.read(input_key).decode("utf-8")`. Or alternatively, in get_model_response() at line 341, modify the input_data dict to decode all bytes values before calling format().

### H20. Silent data loss from decoding with errors='ignore' - UTF-8 corruption silently dropped

- **File:** `lambdas/python/rfp-response-comparison/lambda_function.py:34, 52`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-assessment-apps
- **What's wrong:** Using decode('utf-8', errors='ignore') silently discards any invalid UTF-8 byte sequences. If extracted response documents or framework documents contain non-UTF-8 encoded content or corrupted bytes, those portions will be silently truncated at the first invalid byte, causing incomplete data to be sent to the LLM comparison.
- **Impact:** If any RFP response document or framework has encoding issues (e.g., PDF text extraction artifacts, corrupted character sequences), those portions are silently dropped without any warning. The LLM receives incomplete/truncated documents and produces comparisons based on partial data. Missing content could affect comparison accuracy for compliance/legal reviews.
- **Verifier reasoning:** The bug is REAL at line 52 but NOT at line 34. Line 34 decodes extracted JSON which is guaranteed UTF-8 valid (generated by extract-content lambda via json.dumps().encode('utf-8')). Line 52 decodes the raw user-uploaded framework file with NO file type validation or extraction preprocessing. Users can upload binary files (PDF, DOCX), non-UTF-8 text, or corrupted files. The decode('utf-8', errors='ignore') will silently truncate at the first invalid byte with NO logging or warning. Since the framework content is passed directly to the LLM for critical legal/compliance comparison, this silent data loss is a real vulnerability. Evidence: (1) s3_helpers.read() at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/s3_helpers/s3_helpers/**init**.py:14-24 returns raw S3 bytes with no validation; (2) extract-content lambda at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/extract-content-from-file/lambda_function.py:237 writes json.dumps().encode('utf-8') ensuring valid UTF-8; (3) RFP construct at /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/constructs/apps/rfp-response-comparison-construct.ts:143 passes framework as raw s3_key from user upload with no extraction step (unlike extracted_keys which go through Map/Extract); (4) No file type validation in S3_UPLOAD_TASK parameters.
- **Suggested fix:** Replace line 52 with error handling and logging: try: framework = framework_bytes.decode('utf-8') except UnicodeDecodeError as e: logger.error('Framework contains invalid UTF-8', error=str(e)); framework = framework_bytes.decode('utf-8', errors='replace'). Alternatively, extract framework through same extraction pipeline as responses, or validate/require framework to be uploaded as text/plain or application/json with explicit file type checking before decode.

### H21. Bare exception handler silently swallows all errors without logging - causes inconsistent data state

- **File:** `lambdas/python/council-resource-consents/lambda_function.py:97-98`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-assessment-apps
- **What's wrong:** The extract_document_text function catches all exceptions (S3 read errors, JSON parse errors, file not found, corrupt data) with a bare 'except Exception' and silently returns empty string with no logging or error indication. When extract_document_text fails on a council reference document, the empty string is appended to the list (line 35 checks 'if document_text' which is falsy for empty string). This creates inconsistent data - if 3 council documents are provided and 1 fails to parse, the analysis proceeds with 2 documents instead of 3, without any indication that data was missing.
- **Impact:** Resource consent analysis completes with missing council reference documents without any warning. The analysis proceeds with fewer reference documents than provided, leading to incomplete legal/compliance assessment. Upstream systems have no way to know data was silently omitted. For critical regulatory reviews, this could result in incomplete analysis being treated as complete.
- **Verifier reasoning:** The bug is confirmed real by code inspection of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/council-resource-consents/lambda_function.py. Lines 97-98 contain a bare `except Exception: return ""` that catches all errors (S3 read failures, JSON parse errors, file not found, corrupt data) and silently returns empty string with zero logging. The extract_document_text function has no logging whatsoever (confirmed by grep - only top-level handler logs at line 81). For council references (lines 32-35), empty strings from failed extractions are silently filtered out by the `if document_text:` check, meaning the analysis proceeds with fewer documents than provided. For the application content (line 38), the empty string is passed directly without any filtering. The caller (handler function) has no way to distinguish between successful extraction of an empty document vs. extraction failure. This creates the exact scenario described: missing reference documents cause incomplete analysis without any warning or indication to upstream systems. Severity is high because this is a regulatory/compliance system (council resource consents) where incomplete analysis could be treated as complete.
- **Suggested fix:** Add logging to extract_document_text: change lines 97-98 from `except Exception: return ""` to `except Exception as e: logger.exception("Failed to extract document text", file_key=file_key); raise`. Then in handler (lines 32-35 and 38), wrap extract_document_text calls in try-catch blocks that log the failure and either re-raise or handle gracefully. This ensures: (1) all extraction failures are logged, (2) upstream systems are notified of missing data, (3) the analysis either fails fast or explicitly handles partial data.

### H22. Client name not validated against STS role

- **File:** `lambdas/python/numa-voice-config-writer/lambda_function.py:92-99`
- **Category:** security · **Confidence:** high · **Partition:** py-voice
- **What's wrong:** The handler accepts client_name from the request body without validating it against the caller's STS role. The documented security model states client_name should be 'resolved SERVER-SIDE from its account (never from the request body)', but the code accepts it from the request. In shared dev accounts, this allows a caller to write to any client in their account, not just their own.
- **Impact:** In shared dev environments where multiple clients are in the same AWS account, a voice-admin role for one client (e.g., arcanum-demo-greg_voice-admin) can write configuration for a different client (e.g., arcanum-demo-tony) in the same account, violating the intended isolation.
- **Verifier reasoning:** The bug is real and confirmed by code inspection. The lambda accepts client_name from the request body (line 92 in lambda_function.py) and validates it only via account ownership (authorize_client_write in security_validator.py, lines 82-118). In shared dev accounts where multiple clients exist in the same AWS account, this allows privilege escalation: a voice-admin role for one client (e.g., arcanum-demo-greg_voice-admin) can write config for any other client in that account (e.g., arcanum-demo-tony) because both records have the same clientAccountId. The documented security model (lines 11-13) states client_name should be "resolved SERVER-SIDE from its account (never from the request body)", but the code violates this by accepting it from the request. The per-client role pattern {clientName}\_voice-admin exists, but once inside the handler, there's no verification that the provided client_name matches the caller's role name. The fix is to extract client_name from the validated role_name (which is returned from validate_request at line 105 and available in the validation result), using the role parsing logic already present in security_validator.py lines 225-227.
- **Suggested fix:** Extract client_name from the validated STS role name instead of accepting it from the request body. The role name is available from the validate_request response. Parse the client name from the role using the pattern {clientName}\_voice-admin (already implemented in security_validator.py lines 225-227). Replace lines 92-99 in lambda_function.py with logic that extracts client_name from validation["role_name"] by removing the trailing "\_voice-admin" or "-voice-admin" suffix, ensuring only the caller's own client can be written to regardless of shared account status.

### H23. Exception swallowing masks transient transcription failures

- **File:** `lambdas/python/numa-voice-processor/lambda_function.py:153-164`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-voice
- **What's wrong:** The \_handle_s3 function catches all exceptions from \_start() and logs them but continues processing. The comment suggests only ConflictException (existing job name) should be swallowed, but all exceptions are caught. This prevents S3 from retrying on transient failures like service unavailability or throttling.
- **Impact:** When Transcribe is temporarily unavailable or throttled, \_start() will fail but the exception is swallowed. S3 won't retry the invocation, so the recording fails to start transcription with no automatic recovery. The recording will never be transcribed and the post-call agent never fires.
- **Verifier reasoning:** This is a REAL bug. The analysis:

**What the code does (lines 153-164):**
The `_handle_s3` function catches ALL exceptions from `_start()` (which wraps AWS Transcribe API calls), logs them, and allows the Lambda to return successfully with `{"started": len(started), "jobs": started}`.

**Why this is a bug:**

1. The `_start()` function calls `aws_transcribe.start_transcription_job()` which catches `ClientError` and raises custom `TranscriptionError` (aws_transcribe/**init**.py:58-60).

2. AWS Transcribe `start_transcription_job` can throw multiple exceptions:
   - ConflictException: job with that name already exists (permanent, idempotent scenario)
   - LimitExceededException, ThrottlingException, InternalFailureException (TRANSIENT - service temporarily unavailable)
   - BadRequestException (permanent)

3. The current code treats all exceptions identically - catches and logs them, then returns HTTP 200. This means:
   - Lambda returns successfully
   - No unhandled exception is raised
   - Lambda's automatic retry mechanism is NOT triggered (it only retries on failed invocations)
   - The S3 event is considered "processed" and won't be retried
   - The event never reaches the DLQ (line 374 of numa-voice-construct.ts configures a DLQ, but it only receives Lambda failures, not successful returns that log exceptions)

4. When Transcribe is temporarily throttled or unavailable, the transient error is silently swallowed. The recording fails to start transcription with no automatic recovery path.

**Evidence from code:**

- Line 155-164 in lambda_function.py: `except (Exception) as exc:` catches everything
- Comment on line 156 mentions only ConflictException, but the code catches all exceptions
- aws_transcribe/**init**.py:58-60: Converts ClientError to TranscriptionError
- numa-voice-construct.ts:238-240: Explicit comment acknowledges Lambda retries work for FAILED invocations

**The fix:**
Differentiate between transient and permanent errors. Only catch ConflictException (idempotent); re-raise transient errors to trigger Lambda's 2 automatic retries and eventual DLQ delivery if all retries fail.

- **Suggested fix:** In `/Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/numa-voice-processor/lambda_function.py`, lines 153-164:

Replace:

```python
try:
    started.append(_start(bucket, key))
except (
    Exception
) as exc:  # noqa: BLE001 — re-delivery may hit an existing job name
    logger.exception(
        "Failed to start transcription",
        _name="VOICE_START_ERROR",
        bucket=bucket,
        key=key,
        error=str(exc),
    )
```

With:

```python
try:
    started.append(_start(bucket, key))
except Exception as exc:
    # ConflictException (job name already exists) is idempotent — treat as success.
    # All other exceptions (transient: throttling/service-unavailable; permanent: bad params)
    # should propagate so Lambda retries (up to 2 automatic retries) and routes to DLQ on failure.
    error_code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
    if error_code == "ConflictException":
        logger.info(
            "Transcription job already started (idempotent)",
            _name="VOICE_START_CONFLICT",
            bucket=bucket,
            key=key,
            error=str(exc),
        )
        started.append({"job_name": _job_name(key)})
    else:
        # Re-raise transient/permanent errors to trigger Lambda retry mechanism.
        raise
```

This requires checking if the exception has a `.response` attribute (boto3 ClientError structure). Alternatively, catch `TranscriptionError` and inspect its cause.

### H24. Dedup collision when contact_id is empty in failed transcriptions

- **File:** `lambdas/python/numa-voice-processor/lambda_function.py:407-428`
- **Category:** idempotency · **Confidence:** high · **Partition:** py-voice
- **What's wrong:** When transcription fails and contact_id cannot be parsed from the recording key (unparseable filename), both event_id and dedup_key become non-unique ('voice' and '' respectively). This causes multiple failed calls to collide on dedup, silently dropping all but the first one.
- **Impact:** If multiple recordings have unparseable contact IDs and fail transcription, the post-call events will be deduped incorrectly. Only the first event will be emitted; subsequent events will be dropped by dedup. The qualified prospects will never be routed to the post-call agent.
- **Verifier reasoning:** The bug is real and manifesting. Analysis of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/numa-voice-processor/lambda_function.py confirms:

1. Line 428 defines `'dedup_key': contact_id or transcript_kb_file` with NO fallback value.
2. Line 407 defines `'event_id': contact_id or transcript_kb_file or 'voice'` WITH a fallback.
3. When contact_id is unparseable (empty string from \_contact_id on line 240) AND transcription fails (transcript_kb_file="" from line 262), dedup_key becomes ''.
4. The \_contact_id function (lines 97-101) explicitly returns '' when the filename is unparseable: "Empty if not parseable."
5. There is no validation guard preventing empty contact_ids from reaching \_emit_post_call_event - they proceed through the degraded paths (lines 244-267 for failed transcription, lines 332-354 for transcript errors).
6. Multiple failed transcriptions with unparseable contact IDs will all emit events with dedup_key='', causing EventBridge dedup within the dedup window to silently drop all but the first event (the implicit dedup behavior of EventBridge).

This violates idempotency guarantees and causes silent loss of post-call events. The fix is to apply the same fallback pattern to dedup_key: `'dedup_key': contact_id or transcript_kb_file or 'voice'`.

- **Suggested fix:** Line 428 should be changed from:
  `'dedup_key': contact_id or transcript_kb_file,`
  to:
  `'dedup_key': contact_id or transcript_kb_file or 'voice',`

This ensures dedup_key always has a value when both contact_id and transcript_kb_file are empty, matching the fallback pattern used for event_id on line 407.

### H25. Body fields can overwrite reserved keys in create_job causing data corruption

- **File:** `lambdas/python/numa-recent-jobs/create_job.py:67`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-system
- **What's wrong:** The item construction spreads the request body into the item dict after setting reserved fields (jobId, userId, dateTime, createdAt). If the request body contains any of these keys, the spread operator will overwrite the intended system-managed values.
- **Impact:** A malicious or buggy client could submit userId, dateTime, or createdAt in the request body and overwrite the system-assigned values. This could cause incorrect user associations, wrong timestamps, or duplicate job IDs. In production this corrupts the job database.
- **Verifier reasoning:** The code at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/numa-recent-jobs/create_job.py lines 62-68 creates a dictionary with reserved keys (jobId, userId, dateTime, createdAt) then spreads the request body over it. In Python, dictionary spread operations later in the dict literal will overwrite earlier keys with the same name. Since the code never removes these reserved keys from the body dict, a malicious client can include userId, dateTime, or createdAt in the request payload, and line 67's \*\*body will overwrite the system-assigned values from lines 63-66. The code only validates userId is present (line 38) but does not prevent it (or other reserved keys) from appearing in the body to overwrite system values. This is reachable—no guards prevent a client from sending these keys. The test file shows userId is expected to come from the request, but the current implementation allows it to be overwritten via the spread. This causes data corruption where user associations can be spoofed.
- **Suggested fix:** Move the reserved keys assignment AFTER the body spread, so system-managed values always take precedence:

```python
item = {
    **body,
    "jobId": job_id,
    "userId": user_id,
    "dateTime": timestamp,
    "createdAt": timestamp,
}
```

Alternatively, filter reserved keys from body before spreading:

```python
reserved_keys = {"jobId", "userId", "dateTime", "createdAt"}
filtered_body = {k: v for k, v in body.items() if k not in reserved_keys}

item = {
    "jobId": job_id,
    "userId": user_id,
    "dateTime": timestamp,
    "createdAt": timestamp,
    **filtered_body,
}
```

### H26. Swallowed attachment processing errors silently drop email attachments

- **File:** `lambdas/python/send-email/lambda_function.py:122-123`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-system
- **What's wrong:** The process_attachments function wraps ALL attachment processing in a bare except clause that only logs the error. Any failure reading from S3, parsing attachment metadata, or building MIME parts results in a silent failure with the attachment dropped from the email.
- **Impact:** Clients cannot detect when attachments fail to attach. Emails are sent without their intended attachments and users never know the attachment was lost. Critical documents may be silently dropped during delivery.
- **Verifier reasoning:** The bug is confirmed by code analysis. Lines 113-123 show a bare `except Exception` that catches all attachment processing errors (S3 read failures, MIME encoding failures, etc.) and only logs them without re-raising. The function signature (line 106: `-> None`) and no error tracking means the caller has no way to detect failure. The message is returned from `prepare_mime_message` (line 188) with zero attachments attached if any exception occurs. The handler then sends this incomplete message via SES (lines 544-551) with status "sent" (line 243-244), and the caller receives success indication even though attachments silently dropped. The absence of any tracking of processed count vs. requested count, return value from `process_attachments`, or re-raising of exceptions means attachment failures are completely invisible to callers. A real-world scenario: S3 key doesn't exist (permissions issue, typo, deleted file) → ClientError raised in s3_helpers.read (line 36) → caught and logged only (line 122-123) → attachment never attached → email sent without it → user gets email missing critical document unaware of failure.
- **Suggested fix:** Modify `process_attachments` to track failures and either: (1) Re-raise an exception if any attachment fails (fail-fast), or (2) Return a tuple of (success_count, failure_list) and have the caller check if all attachments succeeded before sending. Example fix (option 1 - fail-fast, most conservative): Change line 122-123 from `except Exception: logger.exception(...)` to `except Exception as e: logger.exception(...); raise` with a descriptive error. This ensures the handler catches the error and returns status "error" instead of "sent". Or (option 2 - partial success tracking): Make `process_attachments` return Dict[str, List] of {attached: [...], failed: [...]} and have handler check `result['failed']` before sending, returning error status if any attachments failed.

### H27. DynamoDB idempotency bug in enqueue_links - wrong condition key

- **File:** `lambdas/python/browser-lambda/lambda_function.py:796`
- **Category:** idempotency · **Confidence:** high · **Partition:** py-browser-web
- **What's wrong:** The enqueue_links function uses ConditionExpression="attribute_not_exists(userId)" to prevent duplicates, but userId is always the same for a single user across all links. This means the condition only blocks if the exact same userId+url combination is already in the table, but the comparison is against userId alone. The correct condition should check if the url attribute already exists (or a composite key of userId+url).
- **Impact:** If the Lambda is retried or invoked multiple times for the same crawl session, duplicate URL entries will be created in DynamoDB, causing duplicate crawl attempts and wasted resources. This violates the idempotency requirement for Lambda side effects.
- **Verifier reasoning:** The bug is REAL and confirmed by reading the code and infrastructure definitions.

Evidence:

1. DynamoDB table schema (web-crawler-construct.ts:44-104): hashKey='userId', rangeKey='url'. This means the composite primary key is (userId, url).
2. enqueue_links function (lambda_function.py:794-797): Uses ConditionExpression="attribute_not_exists(userId)" for idempotency.
3. The issue: The condition only checks if an item with the given userId exists, NOT if an item with the specific (userId, url) composite key exists.

Actual manifestation:

- First enqueue_links call with user_id="alice" url="https://example.com/page1": Succeeds (no item with userId="alice" yet exists)
- Second enqueue_links call with user_id="alice" url="https://example.com/page2": FAILS with ConditionalCheckFailedException because an item with userId="alice" now exists (from first call)
- This blocks all subsequent URL enqueuing for the same user, violating idempotency

The comment on line 801 confirms the misunderstanding: "ConditionalCheckFailedException means URL already exists -- skip silently" - but the actual condition doesn't check URL at all, it only checks userId.

The fix should check the composite key: `attribute_not_exists(userId) AND attribute_not_exists(url)` or simply `attribute_not_exists(url)` if URLs are unique across all users.

- **Suggested fix:** Change line 796 from:

```python
ConditionExpression="attribute_not_exists(userId)",
```

To:

```python
ConditionExpression="attribute_not_exists(userId) AND attribute_not_exists(url)",
```

This ensures the condition checks the entire composite primary key (userId + url), not just the hash key component. Only items with BOTH the same userId AND same url will be rejected, allowing different URLs for the same user to be enqueued successfully.

### H28. Unawaited Background Task in Streaming Response

- **File:** `lambdas/python/workspace-chat-agent-proxy/lambda_function.py:1232-1233`
- **Category:** race · **Confidence:** high · **Partition:** py-wsproxy-claude
- **What's wrong:** The background thread reading chunks is started with run_in_executor but never awaited. This creates a fire-and-forget task that can be cancelled if the async generator exits before the reader completes, causing the stream to end prematurely without flushing all data.
- **Impact:** Clients receive incomplete SSE streams where the last chunks are lost. In production, users see chat responses that cut off mid-message. The reader thread may be cancelled by Python's event loop cleanup, dropping buffered data.
- **Verifier reasoning:** The bug is REAL but with a more nuanced description than claimed:

READING THE CODE (lines 1232-1248):

- Line 1233: `loop.run_in_executor(None, _reader)` starts a background thread to read from boto3 and populate `chunk_q`. The returned Future is NOT stored or awaited.
- Lines 1235-1248: Async generator enters `while True` loop that consumes from `chunk_q` and yields items to client.
- Line 1244-1245: Only breaks when sentinel received.

VERIFICATION OF CLAIM:
The claim states "the future is never awaited" and "can be cancelled/garbage collected" — TRUE on the first count. However, THREADS ARE NOT CANCELLED when futures are garbage collected. I verified this: even when the executor future is unreferenced, the background thread completes successfully.

ACTUAL BUG (not as described):
When a client disconnects mid-stream (e.g., browser refresh, network timeout), the ASGI/FastAPI framework closes the generator by stop iterating/raising GeneratorExit. At this point:

1. The generator's `await asyncio.to_thread(chunk_q.get, True, _keepalive_secs)` is cancelled
2. The generator exits its while loop prematurely (never reaching sentinel)
3. The `_reader` background thread CONTINUES running and successfully completes
4. Data placed in `chunk_q` AFTER generator exit is never yielded to the client
5. Client receives incomplete SSE stream (missing final chunks)

This is NOT because the reader is cancelled, but because the generator exits early. The unflushed items exist in memory (in `chunk_q`) but are never streamed.

SEVERITY ASSESSMENT:

- HIGH (not critical): Users see cut-off responses only if they disconnect during streaming (network issues, refresh, etc.)
- Data is not permanently lost (re-request gets full response)
- Silent failure risk: no error indicator sent to client about incomplete stream

ROOT CAUSE:
Not storing/awaiting the executor future means there's no synchronization point ensuring the generator remains alive for the full duration of `_reader` execution. If client disconnects, generator dies, but thread continues orphaned.

- **Suggested fix:** ```python

# Line 1232-1233: Store and await the executor future

loop = asyncio.get_event_loop()
reader_future = loop.run_in_executor(None, \_reader)

# Before exiting the generator (after while loop):

while True:
...
if item is \_sentinel:
break
...

# Ensure reader thread completes before generator exits

await reader_future

# OR: store the future and use it to track completion

# Better pattern: use try/finally

try:
while True:
try:
item = await asyncio.to_thread(chunk_q.get, True, \_keepalive_secs)
except queue_mod.Empty:
yield \_keepalive
continue

        if item is _sentinel:
            break
        if isinstance(item, BaseException):
            raise item
        yield item

finally: # Ensure reader completes even if client disconnects
try:
await reader_future
except Exception:
pass # Reader thread exception already handled via queue

````

### H29. Empty Audience Set Breaks JWT Verification
- **File:** `lambdas/python/workspace-chat-agent-proxy/lambda_function.py:59-61, 244`
- **Category:** security · **Confidence:** high · **Partition:** py-wsproxy-claude
- **What's wrong:** When COGNITO_CLIENT_ID environment variable is empty and ADDITIONAL_COGNITO_CLIENT_IDS is not set, ALLOWED_CLIENT_IDS becomes an empty set. This is then converted to an empty list and passed as the audience parameter to jwt.decode() on line 244. PyJWT will reject ANY token with an 'aud' claim when audience is an empty list, causing all id tokens to fail verification.
- **Impact:** If the Lambda is deployed with missing or empty COGNITO_CLIENT_ID, all user authentication will fail with 'Invalid token' errors. Users cannot log in or access the workspace chat agent at all.
- **Verifier reasoning:** The vulnerability is REAL. Reading lines 57-61 of lambda_function.py, if COGNITO_CLIENT_ID is empty string and ADDITIONAL_COGNITO_CLIENT_IDS is not set, ALLOWED_CLIENT_IDS becomes {""} (a set with one empty string, not an empty set as the claim states - minor inaccuracy in claim wording). Then at line 244, audience=list(ALLOWED_CLIENT_IDS) creates [""] which is passed to jwt.decode(). For ID tokens (token_use=="id", line 239), PyJWT will then fail to verify any real Cognito token because the token's actual "aud" claim (e.g., "abc123xyz") does NOT match the audience list [""], causing InvalidAudienceError. The infrastructure code (numa-client-stack.ts line 544) provides protection in normal deployments by passing a real AWS-generated client ID, but there is no runtime validation in lambda_function.py to prevent empty COGNITO_CLIENT_ID. A deployment misconfiguration or manual override of the environment variable would cause all ID token verification to fail, breaking user authentication for workspace chat. This meets the criteria of a security-relevant authentication failure.
- **Suggested fix:** Add validation in lambda_function.py after line 61 to filter out empty strings from ALLOWED_CLIENT_IDS: ALLOWED_CLIENT_IDS = {COGNITO_CLIENT_ID} | {s.strip() for s in _additional_ids.split(",") if s.strip()} followed by: ALLOWED_CLIENT_IDS = {cid for cid in ALLOWED_CLIENT_IDS if cid}. Alternatively, add an early check in _verify_jwt_token() or extract_user_sub() to validate that ALLOWED_CLIENT_IDS is not empty or doesn't contain empty strings before calling jwt.decode().

### H30. Silent Failure in Log File Parsing
- **File:** `lambdas/python/beyond-expectations-format-error-logs/lambda_function.py:242-251`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-wsproxy-claude
- **What's wrong:** Exception handling with bare except silently swallows ALL exceptions (including programming errors, timeouts, OOM) when loading log files. The code continues processing, silently losing error logs. Callers have no way to know logs were dropped.
- **Impact:** In production, corrupted S3 objects or network errors cause logs to be silently skipped. The handler returns success=true but the analysis runs on incomplete data. Customers see reports with missing errors, creating false confidence about system health.
- **Verifier reasoning:** I confirmed this is a real, reachable bug by reading the actual code:

1. Lines 242-251 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/beyond-expectations-format-error-logs/lambda_function.py show a bare `except Exception:` with only logging but NO `raise` statement.

2. This is part of a loop (lines 231-251) that iterates through S3 log files. When an exception occurs during `s3_helpers.read()` (line 243) or `json.loads()` (line 244), the exception is caught, logged, and the loop continues to the next file without re-raising.

3. Specific exceptions that will be silently swallowed include:
   - NoSuchKey errors (S3 object deleted between list and read)
   - ClientError (network issues, throttling, permissions)
   - JSONDecodeError (corrupted S3 object)
   - Timeout exceptions
   - Any programming error

4. The handler completes and returns `{"chunkPrefix": chunk_prefix}` (line 296) with success=true even when log files failed to load, causing the Step Function to continue downstream with incomplete data.

5. I verified this is NOT the intended pattern by comparing with aggregate-candidate-results/lambda_function.py (lines 142-144) which has the same try-except structure BUT includes `raise` to fail loudly on the first error.

6. The bug manifests in production when S3 operations fail (corruption, throttling, transient errors) - logs are silently dropped and customers see analysis reports with missing errors, creating false confidence about system health.

The bug is REAL and manifests as silent data loss in production with no alerting mechanism.
- **Suggested fix:** Replace lines 250-251 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/beyond-expectations-format-error-logs/lambda_function.py with:

```python
            except Exception:
                logger.exception("Error loading log file", key=key)
                raise
````

This makes the Lambda fail loudly when any log file cannot be read, causing the Step Function to fail and alerting operators that data loss occurred, rather than silently skipping the file and returning success.

### H31. Data loss from duplicate file basenames in zip

- **File:** `lambdas/python/racetech-unzip/lambda_function.py:50-70`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-racetech-rest
- **What's wrong:** When a zip file contains multiple files with the same basename (e.g., 'dir1/export.sqlite' and 'dir2/export.sqlite'), both extract to the same /tmp path. The second extraction overwrites the first, causing the first file's data to be lost. Only the last file with each basename gets uploaded to S3.
- **Impact:** If Moneyworks or Opencart exports contain files from multiple directories with overlapping names, some data is silently lost during extraction. Users uploading such zips would not realize some data was dropped.
- **Verifier reasoning:** The bug is real and reaches production. Reading lines 50-70 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/racetech-unzip/lambda_function.py: The loop iterates all zip members (line 50). Line 56 strips directory components with Path(member).name, leaving only basename. Line 57 creates local_path using only this basename (TMP_DIR / filename), so any two zip members with identical basenames (e.g., "dir1/export.sqlite" and "dir2/export.sqlite") both map to the same /tmp/export.sqlite. The second iteration (lines 59-60) overwrites the first file's extraction. Line 63 uploads whichever file remains in /tmp—only the last one per basename. No collision detection exists. The loss is silent and permanent. Users uploading Moneyworks/Opencart multi-directory exports with repeated filenames would lose data without notification. Severity is HIGH due to irreversible data loss.
- **Suggested fix:** Preserve zip directory structure or use collision-resistant naming. Replace line 56 from `filename = Path(member).name` to either: (1) `filename = member` to preserve full path, or (2) `filename = member.replace('/', '_')` for flat S3 structure with collision resistance.

### H32. Temporary files not cleaned up on upload failure

- **File:** `lambdas/python/racetech-unzip/lambda_function.py:59-81`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-racetech-rest
- **What's wrong:** If S3 upload fails at line 63, the exception is caught at line 76 and the finally block at lines 79-81 only deletes the zip file, not the extracted temporary files. These files remain in /tmp and accumulate across warm Lambda reuses, eventually filling the 2GB ephemeralStorage and causing OOM failures on subsequent invocations.
- **Impact:** Repeated S3 upload failures (e.g., due to network issues, permission changes, or quota issues) cause /tmp to fill with stale extracted files. Future Lambda invocations reusing the same environment will fail with disk full errors, breaking the entire data feed pipeline until the Lambda environment is recycled.
- **Verifier reasoning:** The code at lines 59-81 has a clear resource leak. When s3.upload_file() fails at line 63, the exception is caught at line 76 and re-raised. The finally block (lines 79-81) only deletes the downloaded zip file (local_zip), not the extracted temporary file (local_path). Line 70 (local_path.unlink()) is inside the try block and only executes if the upload succeeds. If upload fails, the extracted file remains in /tmp. This happens inside a loop processing multiple files, so if file N fails to upload, it leaks /tmp/{filename}. Across Lambda warm reuses with repeated upload failures (due to S3 permissions, quota, or network issues), these files accumulate and can exhaust ephemeralStorage, breaking subsequent invocations.
- **Suggested fix:** Collect all extracted local_path files in a list and delete them all in the finally block:

```python
def handler(event: dict, _ctx: object) -> None:
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]

        if not key.endswith(".zip"):
            logger.info("Skipping non-zip file", key=key)
            continue

        logger.info("Processing zip upload", bucket=bucket, key=key)

        prefix = key.rsplit("/", 1)[0] + "/" if "/" in key else ""
        zip_filename = key.rsplit("/", 1)[-1]
        local_zip = TMP_DIR / zip_filename
        extracted_files = []  # Track all extracted files

        try:
            s3.download_file(bucket, key, str(local_zip))
            logger.info("Downloaded zip", size_bytes=local_zip.stat().st_size)

            with zipfile.ZipFile(local_zip, "r") as zf:
                for member in zf.namelist():
                    if member.endswith("/") or member.startswith("__MACOSX"):
                        continue

                    filename = Path(member).name
                    local_path = TMP_DIR / filename
                    extracted_files.append(local_path)  # Track it

                    with zf.open(member) as src, open(local_path, "wb") as dst:
                        dst.write(src.read())

                    upload_key = f"{prefix}{filename}"
                    s3.upload_file(str(local_path), bucket, upload_key)
                    logger.info(
                        "Uploaded extracted file",
                        key=upload_key,
                        size_bytes=local_path.stat().st_size,
                    )

                    local_path.unlink()

            s3.delete_object(Bucket=bucket, Key=key)
            logger.info("Deleted original zip", key=key)

        except Exception:
            logger.exception("Failed to process zip", key=key)
            raise
        finally:
            # Clean up all extracted files
            for extracted_file in extracted_files:
                if extracted_file.exists():
                    extracted_file.unlink()
            if local_zip.exists():
                local_zip.unlink()
```

This ensures that even if upload fails partway through, all extracted files are cleaned up in the finally block.

### H33. No size limits on zip extraction

- **File:** `lambdas/python/racetech-unzip/lambda_function.py:49-70`
- **Category:** resource-leak · **Confidence:** high · **Partition:** py-racetech-rest
- **What's wrong:** The code has no validation of compressed or extracted file sizes. A zip bomb (highly compressed data expanding to large sizes) or a legitimately large export could cause memory exhaustion. Line 60: `src.read()` loads the entire extracted member into memory before writing.
- **Impact:** A malicious or oversized zip could cause the Lambda to fail with OutOfMemory or disk full errors. With 512MB memory and 2048MB ephemeralStorage, a zip containing a 1.5GB SQLite file could fail. An attacker could craft a zip bomb to repeatedly crash the Lambda.
- **Verifier reasoning:** The vulnerability is real and manifesting. Code at line 60 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/racetech-unzip/lambda_function.py uses `dst.write(src.read())` which loads the entire extracted file into memory without bounds. The Lambda is configured with only 512MB memory (line 173 of racetech-data-feed-construct.ts) and 2048MB disk (line 174). No file size validation exists before or during extraction. Any extracted file >512MB will cause OutOfMemory failure. A zip bomb could reach 2GB uncompressed. The upload-url Lambda (racetech-upload-url/lambda_function.py) has no ContentLength validation either. While operationally the attacker must have the API key + allowed IP (limiting exposure to Glenn or someone who compromised the API key), the technical defect is clear and will cause Lambda failure if a legitimately large SQLite export (common in business data) exceeds 512MB.
- **Suggested fix:** Add file size validation before extraction and use streaming writes:

1. Check compressed size: if zf.getinfo(member).compress_size > 100_000_000 (100MB), reject.
2. Check uncompressed size: if zf.getinfo(member).file_size > 500_000_000 (500MB), reject.
3. Replace line 60 `dst.write(src.read())` with chunked streaming:
   ```python
   while True:
       chunk = src.read(8192)  # 8KB chunks
       if not chunk:
           break
       dst.write(chunk)
   ```
4. Track cumulative size and abort if total > 1500MB.
5. Optionally add presigned URL ContentLength header validation in racetech-upload-url Lambda.

### H34. Pagination Truncation in load_v1_conversation_history - Silent Data Loss

- **File:** `services/numa-workspace-agent/numa_workspace_agent/dynamo.py:236-246`
- **Category:** data-loss · **Confidence:** high · **Partition:** ws-workspace-s3
- **What's wrong:** DynamoDB query() without pagination only returns 1MB of data by default. If a conversation has >1MB of message history, the query silently truncates and returns incomplete results. The code then takes only the last max_messages from this truncated set, losing all earlier messages permanently.
- **Impact:** Large conversations (e.g., hours of interaction with many tool calls) will lose old message history during V1-to-V2 migration. Users see incomplete conversation context. No error indication that data was lost.
- **Verifier reasoning:** The bug is REAL and manifests in production. Reading /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/dynamo.py lines 236-246 shows `client.query()` without pagination: (1) no `Limit` parameter set, (2) no loop checking `LastEvaluatedKey` for truncation. AWS DynamoDB query() returns up to 1MB by default; if exceeded, results truncate silently. Line 248 retrieves all items from a single unpaginated response: `items = query_response.get("Items", [])`. Line 259 then takes only the last 50: `for item in items[-max_messages:]`. For conversations with >1MB of message history (realistic for power users with hours of interaction + tool calls), the query silently returns only the first ~1MB. The code has no detection of `LastEvaluatedKey` in the response, so it never knows truncation occurred. It then migrates only the last 50 of the truncated set, permanently losing older messages. The severity is HIGH because this causes permanent data loss during V1-to-V2 migration (line 380 marks the conversation as V2, preventing re-migration). The logging at lines 296-302 does not detect or warn about truncation.
- **Suggested fix:** Add pagination loop to handle LastEvaluatedKey. Replace lines 234-246 with pagination logic that loops while `LastEvaluatedKey` is present in the query response, accumulating all items across pages before slicing to the last max_messages. Also add a log line to detect and warn if LastEvaluatedKey was present (indicating truncation occurred), and possibly add a max iteration limit to prevent infinite loops on misconfigured tables.

### H35. Unbounded Memory Allocation in \_parse_events_to_messages - Trace File

- **File:** `services/numa-workspace-agent/numa_workspace_agent/trace_parser.py:249`
- **Category:** resource-leak · **Confidence:** high · **Partition:** ws-workspace-s3
- **What's wrong:** The entire trace file is eagerly loaded into memory as a Python list of parsed events with no bounds checking. For long-running conversations with hundreds of thousands of events, this can allocate gigabytes of RAM, causing out-of-memory errors and container termination.
- **Impact:** Long conversations trigger OOM killer, causing agent failure mid-conversation and data loss. No graceful handling. Container memory limits are exceeded. Production conversations exceeding ~100k events will crash.
- **Verifier reasoning:** The code at line 249 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/trace_parser.py materializes the entire event iterator into a list (`all_events = list(event_iterator)`) with no bounds checking. The call chain is: (1) get_conversation_trace_from_s3() reads entire file as string (line 877 in s3_workspace.py), (2) parse_trace_content_to_messages() passes it to \_parse_events_to_messages() (line 500), (3) \_iterate_trace_content() yields events line-by-line via split (line 120), but (4) all_events immediately consumes the entire iterator into a list. The function then iterates over this list 4 times (lines 256, 275, 295, 341) without any max event checks, max memory checks, or streaming. No exception handlers catch MemoryError. For long conversations with 100k+ events at ~1KB each, this causes gigabyte-scale allocations that exceed the 8GB container limit, triggering OOM killer. The bug is reachable and manifesting in production conversations.</parameter>
  <parameter name="fix">Add a max event limit before materialization and implement streaming processing. (1) Add constant MAX_EVENTS_PER_TRACE = 50000, (2) In \_parse_events_to_messages(), check event count and raise ValueError if exceeded, (3) Refactor to process events in streaming passes instead of materializing all at once: collect tool_results and assistant_messages by iterating event_iterator multiple times separately, or accumulate only the filtered ordered_events list rather than all_events.</parameter>
  </invoke>

### H36. No Protection Against Symlink Escape in Downloaded Files

- **File:** `services/numa-workspace-agent/numa_workspace_agent/s3_workspace.py:323-365`
- **Category:** security · **Confidence:** high · **Partition:** ws-workspace-s3
- **What's wrong:** S3 file downloads don't validate that the constructed local_file path doesn't contain symlinks that could escape the workspace. An attacker who can control S3 objects could create a file in /workdir/uploads/foo that is actually a symlink to /../../../etc/passwd, then later operations read/write to escaped locations.
- **Impact:** Cross-tenant data leak: if workspace is shared across multiple tenants or conversations, a symlink in one tenant's uploads can be read by another tenant. Container escape by symlinking to system files.
- **Verifier reasoning:** The vulnerability is CONFIRMED. Code inspection of lines 323-365 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/s3_workspace.py shows:

1. Line 329: `rel_path = s3_key[len(s3_prefix):]` extracts relative path via string slicing with NO normalization
2. Line 345: `local_file = local_base / rel_path` constructs path with NO validation for escape sequences
3. Line 350: `local_file.parent.mkdir(parents=True, exist_ok=True)` creates parent dirs without checking if path escaped workspace
4. Line 353: `s3.download_file()` writes to the constructed path

PROOF OF CONCEPT: I tested the exact code pattern and confirmed that S3 keys like "uploads/../../../../etc/passwd" will:

- Construct path `/workdir/uploads/../../../../etc/passwd`
- Resolve to `/etc/passwd`
- Successfully mkdir would create directories outside workspace
- File would be written outside workspace boundary

This affects 3 functions identically:

- sync_from_s3() at line 345
- sync_workspace_prefixes() at line 434
- sync_uploads_from_s3() at line 698

S3 is a key-value store with NO path validation - attackers with S3 bucket access CAN upload objects with ".." in the key. The download code has no defense. The claim correctly identifies that rel_path is never validated against symlink/escape attempts. While the claim mentions symlinks, the actual vulnerability is the broader path traversal issue via ".." sequences in S3 keys.

- **Suggested fix:** Add path validation before mkdir/download in all three vulnerable functions. For sync_from_s3 (lines 344-353), insert after line 345:

```python
# Validate resolved path stays within workspace
local_base_resolved = local_base.resolve()
try:
    local_file.resolve().relative_to(local_base_resolved)
except ValueError:
    logger.warning(
        "Rejected file with path escape attempt",
        s3_key=s3_key,
        rel_path=rel_path,
    )
    continue
```

Apply the same validation to sync_workspace_prefixes (after line 434) and sync_uploads_from_s3 (after line 698) using their respective `target_path` and `uploads_dir` variables as the base.

### H37. Unhandled exception in async Lambda invocation

- **File:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_tool.py:728`
- **Category:** error-handling · **Confidence:** high · **Partition:** ws-mcp-tools
- **What's wrong:** The invoke_workspace_tool_async call is not wrapped in try-except. If the Lambda invocation fails (network error, bad credentials, quota exceeded), the exception propagates uncaught, interrupting the async transcription flow and leaving the S3 polling loop waiting forever for a result that will never arrive.
- **Impact:** User calls extract_content on audio/video with transcription timeout (15 minutes) while Lambda was never actually invoked. The timeout error message is misleading - it suggests transcription is still processing when Lambda invocation failed. On retry, multiple Lambda invocations could be queued, causing duplicate transcriptions and wasted resources.
- **Verifier reasoning:** The invoke_workspace_tool_async() call at lines 728-735 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_tool.py is completely unguarded by try-except. The function being called (in lambda_client.py lines 333-386) can raise ValueError (missing WORKSPACE_TOOLS_LAMBDA_NAME env var), boto3 ClientError (network/auth/quota issues), or Exception (non-202 status code). If any exception occurs, execution stops before the S3 polling loop at line 742 ever begins, leaving the polling loop waiting forever for a result that will never arrive. There is no exception handling at the caller level either (\_handle_extract_content), so the exception propagates uncaught to the MCP layer, producing a generic error instead of a clear message. On retry, a second Lambda invocation could be queued, causing duplicate transcriptions. This is a reachable failure scenario with real operational impact."
- **Suggested fix:** Wrap the invoke_workspace_tool_async() call in a try-except block:

```python
try:
    invoke_workspace_tool_async(
        "extract_content",
        {"file_path": file_path},
        extra_event_fields={
            "user_sub": user_sub,
            "conversation_id": conversation_id,
        },
    )
except Exception as e:
    logger.error(
        "Failed to invoke async transcription Lambda",
        error=str(e),
        file_path=file_path,
    )
    return _err(
        f"Failed to start transcription: {e}. "
        f"The file may not have been queued for processing. Retry after a moment."
    )
```

This catches all exceptions from the Lambda invocation, logs them with context, and returns a clear error to the user without attempting the S3 polling loop. The user knows the invocation failed and why, avoiding the misleading 15-minute timeout message when the Lambda was never actually invoked.

### H38. Bash brace expansion sandbox escape

- **File:** `services/numa-workspace-agent/numa_workspace_agent/hooks/security.py:655-668`
- **Category:** security · **Confidence:** high · **Partition:** ws-security
- **What's wrong:** The path tokenization check at lines 655-668 uses shlex.split() which preserves bash brace expansions and glob patterns as literal tokens. These tokens pass the /workdir prefix check because they literally start with '/workdir/', but bash then expands them at execution time to access blocked directories.
- **Impact:** An attacker can use `ls /workdir/.{system,outputs}/` or similar brace expansions to access and list the contents of the blocked /workdir/.system/ directory, bypassing the sandbox restrictions. Similarly, glob patterns like `ls /workdir/.sy*tem/` or character classes like `ls /workdir/.[s]ystem/` would also escape the protection.
- **Verifier reasoning:** The vulnerability is REAL and manifests in practice. I confirmed through code inspection and direct testing that:

1. Commands like `ls /workdir/.{system,outputs}/`, `ls /workdir/.sy*tem/`, and `ls /workdir/.[s]ystem/` pass ALL security checks in check_bash_command because:
   - PROTECTED_DIR_PATTERNS (line 603-609) uses regex matching for literal `.system` or `secrets` substrings, which don't match brace/glob expansions like `.{system,outputs}` or `.sy*tem`
   - BLOCKED_PATH_PATTERNS (line 670-674) uses substring matching with `if clean_pattern in command`, which fails because `.system` is not a substring of `.{system,outputs}`, `.sy*tem`, or `.[s]ystem`
   - The shlex tokenization (line 655-668) preserves `/workdir/.{system,outputs}/` as a single token, which passes because it starts with `/workdir/`

2. After passing the security hook, bash then expands these metacharacters at execution time:
   - `/workdir/.{system,outputs}/` expands to `/workdir/.system/` and `/workdir/.outputs/`
   - `/workdir/.sy*tem/` expands to `/workdir/.system/`
   - `/workdir/.[s]ystem/` expands to `/workdir/.system/`

3. These directories are then successfully accessed, bypassing the intended sandbox restrictions.

The exact code paths are:

- Line 603-609: PROTECTED_DIR_PATTERNS check fails for obfuscated patterns
- Line 670-674: BLOCKED_PATH_PATTERNS substring check fails for obfuscated patterns
- Line 663: shlex-tokenized paths with /workdir/ prefix pass through
- Bash then executes the command with full shell expansion enabled

This is a genuine sandbox escape vulnerability where shell metacharacters allow bypassing path validation intended to block access to sensitive directories.

- **Suggested fix:** Add validation for shell metacharacters in path tokens. Insert the following after line 663 in check_bash_command:

```python
# Reject paths containing shell metacharacters (brace expansion, globs, character classes)
if any(char in token for char in ['*', '?', '[', ']', '{', '}']):
    return True, f"Command references path with shell metacharacters: {token}"
```

Alternatively, enhance PROTECTED_DIR_PATTERNS to match common obfuscation patterns:

```python
r"\bls\b.*\.[\{\[].*(?:system|secrets)",  # Catches .[{system, .[s]ystem, etc.
r"\bls\b.*\.s[\*\[].*tem",  # Catches .sy*tem, .s[y]tem, etc.
```

Or use a dedicated regex in check_bash_command before shlex tokenization to reject brace expansions and globs in commands targeting the protected directories.

### H39. Overly broad substring matching blocks legitimate paths

- **File:** `services/numa-workspace-agent/numa_workspace_agent/hooks/security.py:455`
- **Category:** logic · **Confidence:** high · **Partition:** ws-security
- **What's wrong:** The pattern matching at line 455 uses substring checking: `if pattern in normalized or normalized.endswith(pattern.rstrip('/'))`. This blocks legitimate paths that contain the blocked patterns as substrings, such as /workdir/.environment/config.json being blocked because it contains '/workdir/.env'.
- **Impact:** Legitimate user workflows that create directories like /workdir/.environment/, /workdir/.envisioned/, /workdir/secrets-backup/, or /workdir/.system_output/ would be blocked from file operations, causing false positives and preventing users from accessing their own files.
- **Verifier reasoning:** The bug is REAL and manifests in practice. At line 455, the pattern matching uses substring checking: `if pattern in normalized or normalized.endswith(pattern.rstrip("/"))`.

For BLOCKED_PATH_PATTERNS = ["/workdir/.system/", "/workdir/.system", "/workdir/secrets/", "/workdir/secrets", "/workdir/.env"], the substring check `pattern in normalized` will falsely block legitimate paths:

1. `/workdir/.environment/config.json` contains `/workdir/.env` as a substring, so it is blocked
2. `/workdir/.system_output/file.txt` contains `/workdir/.system` as a substring, so it is blocked
3. `/workdir/secrets-backup/data.json` contains `/workdir/secrets` as a substring, so it is blocked
4. `/workdir/.envisioned/plan.txt` contains `/workdir/.env` as a substring, so it is blocked

The endswith check `normalized.endswith(pattern.rstrip("/"))` does NOT mitigate this - it only catches paths ending with the pattern (e.g., `/something/.system`), not paths containing the pattern as an internal substring.

The function normalize_path (line 389-403) uses os.path.realpath() which resolves symlinks but does NOT prevent substring false positives.

There is no downstream validation or guard that prevents this false positive from manifesting - the security_hook (line 810-884) directly calls is_blocked_path for file operations, and if it returns True, the operation is blocked with the misleading error message.

This is high severity because it prevents users from accessing their own legitimate files in directories with names that happen to contain blocked patterns as substrings, causing legitimate workflows to fail.

- **Suggested fix:** Replace the substring-based matching with proper path component checking. For directory patterns like `/workdir/.system/` and `/workdir/secrets/`, check if the normalized path is exactly that directory or a child of it using path component boundaries. For file patterns like `/workdir/.env`, check if the basename matches or if it's in a blocked directory.

Correct implementation:

```python
# Instead of: if pattern in normalized or normalized.endswith(pattern.rstrip("/"))
# Use path component checking:
for pattern in BLOCKED_PATH_PATTERNS:
    # Normalize pattern by removing trailing slash
    clean_pattern = pattern.rstrip("/")

    # Check if path is exactly the blocked path
    if normalized == clean_pattern:
        return (True, f"Access to '{pattern.strip('/')}' is blocked by security policy")

    # Check if path is a child of a blocked directory
    # (must have a path separator after the pattern to avoid substring matches)
    if normalized.startswith(clean_pattern + "/"):
        return (True, f"Access to '{pattern.strip('/')}' is blocked by security policy")
```

This uses startswith() with an explicit "/" suffix to ensure path component boundaries, preventing `/workdir/.env` from matching `/workdir/.environment/config.json` or `/workdir/.envisioned/`.

Alternatively, use os.path operations to check if the path is within a blocked directory:

```python
clean_pattern = pattern.rstrip("/")
if normalized == clean_pattern or normalized.startswith(clean_pattern + "/"):
    return (True, f"Access to '{pattern.strip('/')}' is blocked by security policy")
```

### H40. Potential data loss in compare workspace setup on cross-user access

- **File:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia_funding/workspace_setup.py:777-814`
- **Category:** data-loss · **Confidence:** high · **Partition:** ws-nolia
- **What's wrong:** The setup_funding_compare_workspace() function downloads prior assessment runs from S3 for comparison. It uses owner_sub from metadata to construct the S3 prefix (line 791). If a cross-user compare request includes an invalid owner_sub, the download silently fails (line 806-813). The pipeline continues with incomplete prior assessment data, leading to corrupt comparison output.
- **Impact:** If a frontend bug or user manipulation passes an incorrect owner_sub for a prior run, the run's data (applicant info, decision, findings) is not downloaded. The comparison phase runs with empty/missing data from that run, producing incorrect comparisons that the frontend cannot detect are incomplete.
- **Verifier reasoning:** The bug IS real: Lines 777-814 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia_funding/workspace_setup.py contain a validation gap. The code constructs an S3 prefix from owner_sub (line 791) and calls \_download_s3_prefix (line 796), but does NOT validate that files were actually downloaded. The \_download_s3_prefix function (lines 210-228 in nolia/workspace_setup.py) returns 0 silently for non-existent prefixes — it does not raise exceptions. Lines 797-805 log success unconditionally, even if count=0. The exception handler (806-813) never triggers because missing S3 prefixes don't throw exceptions. This leaves empty directories in /workdir/prior-assessments/run-{i}/ when owner_sub is invalid or access is denied. However, the practical impact is LESS severe than claimed: the agent will attempt to Read the missing files, encounter file-not-found errors, and report step failure. The compare result is caught at line 267 (if status=="error") and returns an error result. So the pipeline fails gracefully rather than producing "corrupt output silently." The real bug is the lack of validation (compare to lines 241-249 and 346-352 which check if count > 0), making debugging harder and creating a false appearance of success in logs when the download actually failed.
- **Suggested fix:** Add validation after line 796 to check that files were actually downloaded. For example: (1) Check if count==0 and log a warning/error before continuing, (2) Or check that expected files exist locally after download (e.g., verify \_result.json exists in target_dir), (3) Or raise an exception if count==0 for critical runs. The fix should mirror the pattern used in lines 241-249: `if count > 0: logger.info(...)` but for the compare case, should fail the orchestration if count==0 for cross-user runs or raise an informative error.

### H41. Missing commentCount decrement when boardId not provided in DELETE comment

- **File:** `lambdas/node/numa-ops-api/index.ts:1822-1850`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-ops
- **What's wrong:** The DELETE /ops/tickets/{ticketId}/comments/{commentId} endpoint silently skips decrementing commentCount and bumping board version if body.boardId is not provided. This leaves the ticket's commentCount stale and clients polling boardVersion won't detect the comment deletion.
- **Impact:** In production, if comments are deleted via a code path that doesn't include boardId in the request body, the ticket's commentCount metric becomes incorrect and the board UI won't refresh to reflect the deleted comment. This creates a persistent inconsistency in displayed state vs. actual data.
- **Verifier reasoning:** The DELETE comment endpoint at lines 1822-1850 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/numa-ops-api/index.ts contains an incomplete implementation. The comment at line 1832 explicitly states "find ticket via body.boardId or best-effort", indicating intent to have a fallback mechanism. However, the actual code (lines 1833-1847) ONLY performs the commentCount decrement and boardVersion bump if body.boardId is provided in the request body. If boardId is missing, both operations are silently skipped (lines 1833-1847 are wrapped in `if (body.boardId)`), and the endpoint returns success anyway (line 1849). This creates a data consistency issue: the comment IS deleted (line 1830, unconditional), but the ticket's commentCount is not decremented. The POST comment endpoint (lines 1698-1797) demonstrates the correct pattern: it calls `findTicketByUuid(ticketId)` to fetch the ticket and uses ticket.teamId for side-effects (lines 1788-1796), making boardId unnecessary in the request body. The DELETE endpoint should implement the same fallback mechanism rather than being conditional on body.boardId. Without this fix, any DELETE comment request that doesn't include boardId will leave commentCount and boardVersion stale, violating data consistency."
- **Suggested fix:** Replace the DELETE comment handler (lines 1822-1850) to fetch the ticket using findTicketByUuid (like POST does) and use ticket.teamId for commentCount and boardVersion updates, rather than being conditional on body.boardId. Concrete change: After line 1830 (deleteItem), add `const ticket = await findTicketByUuid(ticketId);` then unconditionally attempt the commentCount decrement and boardVersion bump using ticket.teamId, removing the `if (body.boardId)` conditional wrapper.

### H42. Non-atomic comment deletion followed by best-effort counter decrement

- **File:** `lambdas/node/numa-ops-api/index.ts:1830-1846`
- **Category:** idempotency · **Confidence:** high · **Partition:** node-ops
- **What's wrong:** The comment is deleted from DynamoDB (line 1830) before the commentCount is decremented (line 1839). If the decrement fails or the Lambda times out after deletion but before decrement, the comment is gone but commentCount still reflects it exists, creating permanent data inconsistency.
- **Impact:** If the decrement operation fails (network error, transient DynamoDB throttle, etc.), the ticket record will report an incorrect comment count that is higher than reality. The stale count persists because the comment is already deleted and cannot be re-incremented. Clients see phantom comment counts.
- **Verifier reasoning:** The bug is real. Code at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/numa-ops-api/index.ts lines 1822-1850 shows the DELETE comment handler: (1) deletes the comment unconditionally at line 1830 without transaction wrapping; (2) wraps the commentCount decrement in try-catch that swallows errors (lines 1835-1845); (3) returns 200 success at line 1849 regardless of decrement outcome. If deleteItem() throws (e.g., throttling, network error), the outer handler catch (line 3372) will trigger, causing Lambda to retry. On retry, the comment is already deleted, so queryByPK returns it missing, and the handler returns 404 at line 1828 without ever attempting to decrement commentCount. This leaves commentCount permanently inconsistent—higher than the actual comment count. The operation is not idempotent: first invocation deletes comment+decrements counter (or fails before decrement), but retry fails to decrement because the comment is gone. The architectural problem is that the deletion and counter decrement are separate, unrelated DynamoDB operations without transactional atomicity or idempotency safeguards.
- **Suggested fix:** Use TransactWriteItems to atomically delete the comment and decrement commentCount in a single transaction. This ensures either both operations succeed or both fail together, preventing the inconsistent state. Alternatively, reorder logic to decrement first (wrapped in try-catch with clear intent), then delete, so on retry the missing comment is an expected state. Or add idempotency guards: store a deletion token, check it on retry, and decrement even if the comment is already gone.

### H43. Link deletion with transactional atomicity but incomplete counter maintenance

- **File:** `lambdas/node/numa-ops-api/index.ts:1961-2006`
- **Category:** idempotency · **Confidence:** high · **Partition:** node-ops
- **What's wrong:** DELETE /ops/tickets/{ticketId}/links uses TransactWrite to atomically delete both link records (line 1976) but then decrements linkCount on both tickets in separate, sequential UPDATE commands that are not transactional (lines 1983-2000). If linkCount decrements fail and are caught silently (line 2001), the link is deleted but counts remain high, creating permanent inconsistency.
- **Impact:** Users see link badges/counts that don't match actual links. The decrements are best-effort with silent failure (catch at line 2001 only logs), so production will exhibit stale linkCount values. The counter can never recover because the actual link records are already deleted and the decrement won't retry.
- **Verifier reasoning:** The code exhibits a clear architectural inconsistency and real idempotency bug. In the POST operation (lines 1920-1948), linkCount increments are included INSIDE the TransactWrite, making the entire operation atomic. In the DELETE operation (lines 1961-2008), the link records are deleted atomically via TransactWrite (line 1976), but the linkCount decrements execute in separate, non-transactional UPDATE commands at lines 1983-2000, wrapped in a try-catch that silently logs failures (line 2002). This creates a failure mode where: (1) TransactWrite succeeds (links deleted), (2) Promise.all fails due to transient DynamoDB errors, (3) Catch swallows the error with only a console.warn, (4) API returns 200 OK, and (5) linkCount remains high permanently since the actual link records are already deleted and won't auto-recover. This violates idempotent-operation principles and produces permanent data inconsistency. The comment at line 1978 'Decrement linkCount (best-effort)' acknowledges this is not guaranteed, and the POST operation's pattern (which includes these updates in the transact write) proves it CAN be done atomically.
- **Suggested fix:** Move the linkCount UPDATE operations into the transactItems array before the TransactWriteCommand at line 1976. Add conditional Update items for both tickets (matching the POST pattern at lines 1922-1940) with the :dec value set to -1. This makes the entire link deletion atomic: either all link records and counters are decremented, or nothing changes. This matches the idempotent design of the POST operation and eliminates the silent failure path.

### H44. Comment deletion without boardId fails silently without board heartbeat bump

- **File:** `lambdas/node/numa-ops-api/index.ts:1849`
- **Category:** api-contract · **Confidence:** high · **Partition:** node-ops
- **What's wrong:** When DELETE /ops/tickets/{ticketId}/comments/{commentId} is called without boardId in request body, the API returns 200 OK with {deleted: true} but has NOT actually bumped the board version heartbeat. The response claims success but the board's listening clients won't refresh because boardVersion remains unchanged.
- **Impact:** In production, if a frontend client calls delete-comment without sending boardId (or if a caller doesn't have boardId at that moment), the API will respond with success but the UI won't refresh. The comment deletion is real but invisible to the board UI. Other users see stale data.
- **Verifier reasoning:** The bug is REAL and manifests in production. I verified by reading the actual code:

1. FRONTEND CALL (OpsService.ts): deleteComment() makes a DELETE request with no request body or boardId parameter
2. BACKEND PARSING (index.ts:3341): body is parsed from event.body, which will be empty {}
3. COMMENT DELETION (index.ts:1830): Comment IS deleted via deleteItem(PK, SK)
4. VERSION BUMP GUARD (index.ts:1833): Entire block guarded by if (body.boardId) - this condition is FALSE since no body is sent
5. NO HEARTBEAT BUMP (index.ts:1846): bumpBoardVersion() is never called
6. FALSE SUCCESS (index.ts:1849): Returns 200 OK {deleted: true} regardless

The issue is critical because the frontend uses heartbeat polling (useOpsData.ts lines 407-441) that compares boardVersion. When boardVersion isn't bumped, clients won't refresh their board view. The comment deletion persists in the database, but the UI shows stale data to other users.

The same function at line 1796 (POST comment) correctly handles this by: (1) looking up the ticket via findTicketByUuid, (2) getting its teamId, (3) calling bumpBoardVersion(String(ticket.teamId)). The DELETE endpoint should use the same pattern but doesn't.

The POST comment deletion also lacks a boardVersion bump - this appears to be a systemic issue affecting both comment creation and deletion paths.

- **Suggested fix:** In lambdas/node/numa-ops-api/index.ts at lines 1822-1850, change the DELETE comment endpoint to look up the ticket and bump boardVersion:

```typescript
// DELETE /ops/tickets/{ticketId}/comments/{commentId}
if (method === 'DELETE' && segments.length === 3 && segments[1] === 'comments') {
  const ticketId = segments[0];
  const commentId = segments[2];
  const comments = await queryByPK(`TICKET#${ticketId}`, 'COMMENT#');
  const existing = comments.find((c) => c.commentId === commentId);
  if (!existing) return errorResponse(404, 'Comment not found');

  await deleteItem(String(existing.PK), String(existing.SK));

  // Look up ticket to get teamId for commentCount and boardVersion bump
  const ticket = await findTicketByUuid(ticketId);
  if (ticket && ticket.teamId) {
    const teamId = String(ticket.teamId);
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: OPS_TABLE,
          Key: { PK: `TEAM#${teamId}`, SK: `TICKET#${ticketId}` },
          UpdateExpression: 'ADD commentCount :dec',
          ExpressionAttributeValues: { ':dec': -1 },
        })
      );
    } catch (e) {
      console.warn('Failed to decrement commentCount', (e as Error).message);
    }
    await bumpBoardVersion(teamId);
  }

  return jsonResponse(200, { deleted: true });
}
```

This mirrors the POST comment approach (line 1698-1796) and ensures boardVersion is always bumped on comment deletion.

### H45. Missing pagination in listSchedules causes silent result truncation

- **File:** `lambdas/node/agent-schedules/index.ts:622-635`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-agents-sched
- **What's wrong:** The listSchedules function queries user schedules but fails to handle pagination. If a user has more schedules than the DynamoDB default page size (~1MB), only the first page is returned. The caller receives an incomplete list with no indication that results were truncated.
- **Impact:** Users with many schedules see only a partial list in the UI. Schedules beyond the first page are invisible and cannot be managed, paused, or edited until accessed through other means. This silently loses visibility into the user's automation portfolio.
- **Verifier reasoning:** The listSchedules function at lines 622-635 executes a single QueryCommand without pagination. It does not check or iterate over result.LastEvaluatedKey, unlike the correctly-implemented listSchedulesByAgent function (lines 643-668) in the same file. DynamoDB returns at most 1MB per query; with the default user quota of 100 active schedules and ScheduleRecords containing large agent_snapshot objects, truncation is realistic. The truncated results are returned silently to the caller (line 291, GET /agent-schedules handler) with no indication that more data exists. The caller receives an incomplete list with no warning—users will see only partial schedules in the UI. The getCalendarEvents function (line 680-715) exhibits the identical pagination defect. This is not a misread: the code clearly omits pagination handling that exists in the nearby listSchedulesByAgent function.
- **Suggested fix:** Implement pagination in listSchedules by wrapping the QueryCommand in a do-while loop that accumulates results and checks LastEvaluatedKey, mirroring the pattern used in listSchedulesByAgent (lines 643-668). Also fix getCalendarEvents (line 680) identically. Example pattern:

const listSchedules = async (userId: string): Promise&lt;ScheduleRecord[]&gt; =&gt; {
const records: ScheduleRecord[] = [];
let lastKey: Record&lt;string, unknown&gt; | undefined;
do {
const result = await dynamo.send(
new QueryCommand({
TableName: TABLE_NAME,
KeyConditionExpression: 'user_id = :u',
ExpressionAttributeValues: { ':u': userId },
ExclusiveStartKey: lastKey,
})
);
for (const item of result.Items ?? []) {
records.push(item as ScheduleRecord);
}
lastKey = result.LastEvaluatedKey;
} while (lastKey);
return records.sort((a, b) =&gt; (b.updated_at ?? 0) - (a.updated_at ?? 0));
};

### H46. Race condition in recent_runs initialization causes unhandled exception

- **File:** `lambdas/node/agent-schedule-runner/index.ts:1883-1891`
- **Category:** race · **Confidence:** high · **Partition:** node-agents-sched
- **What's wrong:** When markScheduleStatus is called on the first-ever fire of a schedule (or pre-existing schedules before recent_runs was added), it attempts to initialize the recent_runs map. If two concurrent fires hit the same schedule, one initializes successfully and the other's ConditionalCheckFailedException is not caught, causing the function to throw an uncaught error.
- **Impact:** Concurrent scheduled runs on the same schedule during initialization can cause one invocation to fail with an unhandled DynamoDB exception. The failed run is not properly tracked, status is not updated, and the error propagates to EventBridge Scheduler which retries indefinitely (up to the DLQ), wasting quota and infrastructure capacity. Monthly run counts and quota enforcement become inconsistent.
- **Verifier reasoning:** The race condition is REAL. Located at lines 1883-1891 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/agent-schedule-runner/index.ts, the initialization UpdateCommand has `ConditionExpression: 'attribute_not_exists(recent_runs)'` but is NOT wrapped in a try-catch. If two concurrent invocations of markScheduleStatus both reach this code (which can happen if claimRunSlot fails with a non-ConditionalCheckFailedException error per line 1008, returning true and allowing both through), one will initialize recent_runs successfully while the other's ConditionalCheckFailedException will propagate uncaught, crashing the Lambda. The Lambda handler has no outer try-catch (lines 742-747 explicitly document this by design), so the uncaught exception crashes the invocation and EventBridge Scheduler retries indefinitely, wasting quota and infrastructure capacity. The fix is clearly shown in claimEventMessageSlot (lines 1053-1088 and 1068-1084), which uses nested try-catch to handle ConditionalCheckFailedException on initialization races. The markScheduleStatus function must do the same: wrap lines 1883-1901 in a try-catch that catches ConditionalCheckFailedException and either retries the nested-path increment directly or logs a warning and continues, similar to the claimEventMessageSlot pattern.
- **Suggested fix:** Wrap the initialization UpdateCommand at lines 1883-1891 in a try-catch block to handle ConditionalCheckFailedException. The pattern should match claimEventMessageSlot (lines 1068-1084): when the condition fails due to a race, catch the exception and continue with the retry at line 1893 (the full update now that the map exists). Example fix:

```typescript
} catch (err) {
  if ((err as { name?: string })?.name === 'ValidationException') {
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: SCHEDULES_TABLE,
          Key: { user_id: userId, schedule_id: scheduleId },
          UpdateExpression: 'SET recent_runs = :rr',
          ConditionExpression: 'attribute_not_exists(recent_runs)',
          ExpressionAttributeValues: { ':rr': { [today]: 0 } },
        })
      );
    } catch (initErr) {
      if ((initErr as { name?: string })?.name !== 'ConditionalCheckFailedException') {
        throw initErr;
      }
      // Lost the init race — another fire created the map. Continue to the retry below.
      console.warn('[SCHEDULE_RUNNER] markScheduleStatus init race — map already exists, proceeding with retry', initErr);
    }
    // Retry the full update now that the map exists.
    await dynamo.send(
      new UpdateCommand({
        TableName: SCHEDULES_TABLE,
        Key: { user_id: userId, schedule_id: scheduleId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: { '#today': today },
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );
  } else {
    throw err;
  }
}
```

### H47. Auth bypass: Unsafe type assertion on cognito:groups claim

- **File:** `lambdas/node/admin-data-connector-settings/index.ts:60`
- **Category:** security · **Confidence:** high · **Partition:** node-connectors
- **What's wrong:** The isAdminFromAuth function uses an unsafe type assertion `(claims['cognito:groups'] as string[])` without validating the claim is actually an array. If the claim is a string like 'admin,user', the code treats it as an array and `groups.includes('admin')` returns false. If claim is a string 'admin', TypeScript type assertion tricks runtime into treating a string as an array.
- **Impact:** An admin user with their cognito:groups claim formatted as a comma-separated string instead of a JSON array will be denied access to the connector settings admin endpoints, OR if Cognito returns the claim in unexpected formats, auth can be bypassed entirely depending on how the claim is shaped.
- **Verifier reasoning:** The vulnerability is REAL. Line 60 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/admin-data-connector-settings/index.ts contains an unsafe type assertion: `const groups: string[] = (claims['cognito:groups'] as string[]) || [];` without runtime validation. The type definition (line 44) declares `'cognito:groups'?: string[]`, but at runtime the claim could be a string like "admin,user" or any other type. If the claim is a comma-separated string, the code will not correctly identify admin membership because `string.includes()` performs substring matching, not array element matching. For example, "user,admin".includes('admin') returns true (substring), but the intended behavior is array element membership. The oauth-auth-handler demonstrates the correct pattern (lines 354-361) with proper type guards: checking `Array.isArray()` first, then handling string format with `split(',')`. This creates an auth bypass vulnerability where claim format variations could cause incorrect authorization decisions on the PUT /settings/data-connectors endpoint (line 101).
- **Suggested fix:** Replace the isAdminFromAuth function (lines 55-62) with proper type guards matching the oauth-auth-handler pattern:

```typescript
function isAdminFromAuth(event: Pick<APIGatewayProxyEventV2, 'headers'>): boolean {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth) return false;
  const token = String(auth).replace(/^Bearer\s+/i, '');
  const claims = parseJwt(token) || ({} as JwtClaims);
  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as unknown[]).filter((g): g is string => typeof g === 'string')
    : typeof claims['cognito:groups'] === 'string'
      ? (claims['cognito:groups'] as string)
          .split(',')
          .map((g: string) => g.trim())
          .filter(Boolean)
      : [];
  return groups.includes('admin');
}
```

This safely handles both array and comma-separated string formats, with proper type guards preventing runtime errors.

### H48. Partial failure not propagated: watermark advances despite dispatch failures

- **File:** `lambdas/node/connector-event-dispatcher/index.ts:858-859, 865-866`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-connectors
- **What's wrong:** The dispatcher updates the Gmail watermark even in early-exit cases where dispatch hasn't been attempted. If listEventSchedulesForUser returns empty (line 864), or if fetchHistory returns empty (line 858), the watermark advances to the incoming historyId. If the empty result is transient (e.g., Schedules table temporarily unavailable), messages are permanently lost.
- **Impact:** A temporary DynamoDB read failure on SCHEDULES_TABLE will cause all pending emails to be silently dropped. On the next Gmail event, the history API will not re-deliver those messages because the watermark has advanced past them.
- **Verifier reasoning:** The bug is REAL for `fetchHistory` (lines 858-859) but NOT for `listEventSchedulesForUser` (lines 865-866).

REAL ISSUE (fetchHistory):

- `fetchHistory` (lines 279-299) returns `[]` in two indistinguishable cases:
  1. Legitimate: API returns 200 with no history entries (no new emails)
  2. Failure: API returns 5xx/429/timeout, line 289 returns `[]` on `!res.ok`
- At line 857-861, the handler cannot tell which occurred
- If the Gmail API is temporarily unavailable (transient 500, timeout, etc.), `fetchHistory` catches it and returns `[]`
- The watermark is unconditionally advanced on line 859 `await updateConnectorWatermark(connector, incomingHistoryId)`
- By advancing past the failed fetch attempt, messages are permanently lost: the Gmail History API won't re-deliver them because historyId has moved forward
- Impact: A temporary Gmail API outage silently drops all pending emails in that event window

FALSE ISSUE (listEventSchedulesForUser):

- Claims schedules.length === 0 could mask DynamoDB unavailability
- This is wrong: `ddbDoc.send()` at line 464 throws on DynamoDB errors (no try-catch wraps it)
- Throwing causes the handler to crash, which triggers EventBridge retry logic
- Only returns `[]` if query succeeds with 0 matching records (legitimate: no active Gmail schedules)
- This path is actually safer because failed queries crash instead of silently advancing watermark

The claim conflates two different failure modes. Line 858-859 is genuinely broken (data loss risk). Line 865-866 is protected by exception propagation (correct behavior)."

- **Suggested fix:** For `fetchHistory` to safely distinguish between transient failures and legitimate empty results, one approach:

1. Modify `fetchHistory` to throw on API errors instead of returning `[]`:

```typescript
const fetchHistory = async (accessToken: string, startHistoryId: string): Promise<string[]> => {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
  url.searchParams.set('startHistoryId', startHistoryId);
  url.searchParams.set('historyTypes', 'messageAdded');
  url.searchParams.set('labelId', 'INBOX');
  const res = await fetchWithRetry(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail history.list failed with status ${res.status}`);
  }
  const data = (await res.json()) as GmailHistoryResponse;
  const ids = new Set<string>();
  for (const h of data.history || []) {
    for (const m of h.messagesAdded || []) {
      if (m.message?.id) ids.add(m.message.id);
    }
  }
  return Array.from(ids);
};
```

2. Wrap the call in try-catch at the handler level (line 857):

```typescript
let messageIds: string[];
try {
  messageIds = await fetchHistory(accessToken, startHistoryId);
} catch (err) {
  console.error(`${LOG_PREFIX} Failed to fetch history, will retry on next event`, err);
  return { success: false, error: 'History fetch failed' };
}
```

This ensures watermark is only advanced when fetch truly succeeds.

### H49. Scan with Limit does not guarantee pagination safety

- **File:** `lambdas/node/connector-event-dispatcher/index.ts:245-256`
- **Category:** logic · **Confidence:** high · **Partition:** node-connectors
- **What's wrong:** The findConnectorByEmail Scan uses Limit: 1000 but does not check for LastEvaluatedKey. If the table has many items, the Scan stops after 1000 items evaluated (not returned), and the function only checks the first item of res.Items. If the matching record is beyond the 1000-item limit, it is silently not found.
- **Impact:** If a user's connector record exists but the Scan pagination stops before reaching it, findConnectorByEmail returns null. The dispatcher then fails with 'Connector not found' error, preventing Gmail triggers from firing for that user.
- **Verifier reasoning:** The bug is real. The `findConnectorByEmail` function at lines 245-257 uses a DynamoDB Scan with `Limit: 1000` to search across all users' connector records for a matching `(connector_id, connected_email)` pair. However, it only returns `res.Items[0]` without checking or looping on `res.LastEvaluatedKey`.

DynamoDB Scan with Limit evaluates up to 1000 items, applies the FilterExpression, and returns matching results. If there are more items to scan (indicated by LastEvaluatedKey), the code ignores this and returns null if no match was found in the first 1000 evaluated items.

For a large connector table where Gmail records are distributed throughout, a user's matching record could exist beyond the first 1000 evaluated items. In that case, findConnectorByEmail would return null instead of finding the record, causing the handler at line 828-830 to fail with "Connector not found" error, preventing Gmail triggers from firing for that user.

The table schema (infra/constructs/core-numa-infra-construct.ts lines 1102-1117) confirms: hashKey='user_id', rangeKey='connector_id', with no GSI on 'connected_email'. This means Scan is the only option, making pagination mandatory for correctness.

The fix requires looping while LastEvaluatedKey exists, continuing the scan from that key until a match is found or scanning completes.

- **Suggested fix:** Implement pagination loop in findConnectorByEmail:

```typescript
const findConnectorByEmail = async (connectorId: string, email: string): Promise<ConnectorRecord | null> => {
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddbDoc.send(
      new ScanCommand({
        TableName: DATA_CONNECTORS_TABLE,
        FilterExpression: 'connector_id = :cid AND connected_email = :email',
        ExpressionAttributeValues: { ':cid': connectorId, ':email': email },
        ProjectionExpression: 'user_id, connector_id, connected_email, last_history_id',
        Limit: 1000,
        ExclusiveStartKey: lastKey,
      })
    );
    const item = (res.Items || [])[0] as ConnectorRecord | undefined;
    if (item) return item;
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  return null;
};
```

### H50. Missing null check on user email during Gmail watch registration

- **File:** `lambdas/node/oauth-auth-handler/index.ts:880-889`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-connectors
- **What's wrong:** In registerGmailWatch, if the Gmail profile fetch fails or returns no emailAddress, userEmail remains empty string. The code continues and writes the connector row with an empty connected_email (line 915). Later, the dispatcher's findConnectorByEmail scan cannot match this row when a Pub/Sub event arrives with an actual email address.
- **Impact:** If the Gmail profile API is temporarily unavailable during OAuth callback, the user's connection is partially set up but non-functional. Inbound emails will not trigger automations because the dispatcher cannot find the connector row.
- **Verifier reasoning:** This is a real, manifesting bug. Evidence: (1) Line 881 initializes `userEmail = ''`; (2) Lines 882-894 attempt to fetch Gmail profile but on failure/timeout, userEmail remains empty - no retry or validation; (3) Lines 906-918 ALWAYS write the connector row with `connected_email = userEmail` (which could be empty); (4) Lines 245-257 in dispatcher later filters `connected_email = :email` where email is from Pub/Sub event; (5) Empty string will never match actual email addresses, causing findConnectorByEmail to return null and line 828-830 to fail with "No connector record". The bug manifests because: registerGmailWatch (line 868) wraps everything in a try-catch that silently swallows errors (line 983-985), the caller (line 1346) doesn't validate, and the function ALWAYS writes the row even if the profile fetch fails. A transient Gmail API timeout or network failure during OAuth callback will leave the connector row with empty connected_email, rendering the connection non-functional. No code path later repopulates connected_email. The developer comment (lines 896-905) explicitly describes the "silent-failure mode where a transient watch error left a user connected-in-vault but with no connector row" - they fixed the watch-error case by decoupling the row write, but missed the profile-fetch-failure case. The missing null check on userEmail before line 915 is the root cause."
- **Suggested fix:** Add validation after the profile fetch (line 894) and before writing the connector row: if (!userEmail) { console.error('Cannot register Gmail watch: profile fetch failed, no email available'); return; } This ensures the connector row is only written when we have a valid email to match against the dispatcher's findConnectorByEmail scan. Alternatively, implement exponential backoff retry for the profile fetch (lines 882-894) rather than failing silently.

### H51. Hardcoded admin identifier in audit trail loses actual admin identity

- **File:** `lambdas/node/admin-capabilities/index.ts:78`
- **Category:** logic · **Confidence:** high · **Partition:** node-admin
- **What's wrong:** The updatedBy field is hardcoded to the string 'admin' instead of capturing the actual admin user's identity (sub/email). This breaks audit trail accountability and prevents auditors from determining which specific admin made changes.
- **Impact:** When an admin disables a capability flag, the audit record only shows 'admin' made the change, not which user. In a multi-admin deployment, an attacker or rogue admin's actions are indistinguishable from legitimate changes. Compliance violations for non-repudiation.
- **Verifier reasoning:** The bug is confirmed by reading the actual code. Line 78 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/admin-capabilities/index.ts contains `updatedBy: 'admin',` as a hardcoded string. The JWT is parsed in the function (lines 19-26) and verified for admin group membership (lines 28-35), but the claims object is never used to extract the actual admin's identity (sub or email). This is demonstrably wrong when compared to admin-sso-settings/index.ts (lines 121-127, 565), which correctly uses `getSubFromAuth()` to capture the actual admin user's sub. In a multi-admin system, all capability changes appear to come from a generic 'admin' user, breaking audit trail accountability and non-repudiation compliance. Also confirmed in admin-integration-settings at line 247, showing this is a systemic issue across multiple admin endpoints."
- **Suggested fix:** Extract the admin's sub from the JWT claims and use it in the updatedBy field. Replace line 78 in admin-capabilities/index.ts from `updatedBy: 'admin',` to `updatedBy: claims.sub || undefined,` where claims is extracted from the Authorization header token using the existing parseJwt function (like admin-sso-settings does with getSubFromAuth helper on lines 121-127).

### H52. Hardcoded admin identifier in audit trail loses actual admin identity

- **File:** `lambdas/node/admin-integration-settings/index.ts:247`
- **Category:** logic · **Confidence:** high · **Partition:** node-admin
- **What's wrong:** The updatedBy field is hardcoded to the string 'admin' instead of capturing the actual admin user's identity. This breaks audit trail accountability.
- **Impact:** Same as admin-capabilities: audit records cannot identify which admin made integration changes. Multi-admin accountability is broken.
- **Verifier reasoning:** Confirmed hardcoded 'admin' at line 247 of admin-integration-settings/index.ts. The JWT parsing and isAdminFromAuth guards are present (lines 55-71), proving the code CAN extract admin identity via claims.sub. Comparison with admin-sso-settings/index.ts (which correctly extracts adminSub via getSubFromAuth and uses it in updatedBy fields at lines 121-127, 565, 651, 692) proves this is a consistent pattern in the codebase that should be followed. Same hardcoding bug exists in admin-capabilities/index.ts line 78 and admin-data-connector-settings/index.ts line 116. The code path is reachable: PUT request at line 215 is guarded by isAdminFromAuth at line 216, then at line 247 it hardcodes updatedBy: 'admin' instead of capturing actual admin.sub. This breaks multi-admin audit accountability as all changes show generic 'admin' instead of the specific admin who made them.
- **Suggested fix:** Add helper function to extract sub from JWT: function getSubFromAuth(event: Pick<APIGatewayProxyEventV2, 'headers'>): string | null { const auth = event.headers?.authorization || event.headers?.Authorization; if (!auth) return null; const token = String(auth).replace(/^Bearer\s+/i, ''); const claims = parseJwt(token) || ({} as JwtClaims); return (claims?.sub as string) || null; } Then change line 247 from updatedBy: 'admin', to updatedBy: getSubFromAuth(event) || undefined,

### H53. Race condition: billing-admin self-removal lockout check occurs before list query

- **File:** `lambdas/node/admin-credits/index.ts:410`
- **Category:** race · **Confidence:** high · **Partition:** node-admin
- **What's wrong:** The endpoint queries the admin list once (line 394) and uses that snapshot to check if removal would leave zero admins (line 410). Between the read and the delete, another concurrent request could remove a different admin, resulting in the last admin being deleted despite the check.
- **Impact:** All billing admins removed concurrently; no one can view/manage credits (locked out). The check on line 410-415 prevents removing the LAST admin, but only if they're the only one left at read time. A race between two concurrent DELETE requests can both pass the check if they each see 2 admins at line 394.
- **Verifier reasoning:** The race condition is REAL. The code at lines 394–419 has a time-of-check to time-of-use (TOCTOU) vulnerability. The list is read once at line 394: `const admins = await listBillingAdmins();`. The check at line 410 uses that stale snapshot: `if (admins.length <= 1 && admins.some((a) => a.sub === targetSub))`. The delete happens at lines 417–419 without rechecking. When exactly 2 admins exist and two concurrent DELETE requests target different admins: both read [A, B] at line 394 (length=2), both evaluate the check (2 <= 1 is false, so neither blocks), both proceed to delete at line 417–419, resulting in zero admins. This violates the intended invariant of "at least one billing admin must exist" and causes a lockout where no one can manage billing credits. The fix requires either: (a) re-querying the list immediately before delete to confirm the invariant still holds, (b) using DynamoDB ConditionExpression on the DeleteCommand to ensure at least 2 admins exist before deletion, or (c) implementing optimistic locking with version counters.
- **Suggested fix:** Use a conditional delete: before line 417, re-query to get the current admin count, or use DynamoDB's ConditionExpression to atomically verify >1 admins remain. Example: Add a `ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(SK)'` paired with a pre-delete re-query, or use a version counter on the admin list row and condition the delete on that version not changing. The simplest fix is to re-query: `const currentAdmins = await listBillingAdmins(); if (currentAdmins.length <= 1) { return 409 error; }` immediately before the DeleteCommand at line 417.

### H54. Unawaited email send loses errors silently in MFA reset flow

- **File:** `lambdas/node/admin-mfa-settings/index.ts:748-773`
- **Category:** error-handling · **Confidence:** high · **Partition:** node-admin
- **What's wrong:** The sendEmail() call on line 749 is awaited (correctly), but the function is fire-and-forget by design (InvocationType: 'Event' on line 174). Email dispatch errors are logged but never propagated. If email sender Lambda fails, the user never receives MFA reset instructions but the endpoint returns 200 OK, leaving them locked out.
- **Impact:** Admin initiates MFA reset. Email fails silently. User receives no reset link/instructions. User cannot re-enroll MFA. User remains locked out. No alert to admin that notification failed.
- **Verifier reasoning:** The bug is REAL and affects multiple email send paths in the MFA reset flow.

CRITICAL ISSUE CONFIRMED:
The sendEmail() function (lines 157-197) uses InvocationType: 'Event' (line 174) for async Lambda invocation. This means:

1. The InvokeCommand.send() call (line 171) returns immediately with success, even though the email Lambda runs asynchronously in the background
2. Any errors that occur INSIDE the email Lambda execution are never caught by the try-catch at lines 193-196
3. The try-catch only catches errors from the invoke REQUEST itself, not from the Lambda execution

CODE EVIDENCE:

- Line 174: `InvocationType: 'Event'` confirms fire-and-forget async invocation
- Lines 193-196: error handling only catches invoke request failures, not Lambda execution failures
- Line 749: `await sendEmail({...})` is called in reset-user endpoint, but failures are invisible
- Line 971: `await sendEmail({...})` is called in send-reset-otp endpoint with same vulnerability

REAL-WORLD IMPACT:
The most critical manifestation is at line 971 (send-reset-otp endpoint). If the OTP email Lambda fails:

1. The DynamoDB OTP record is already persisted (line 945-966)
2. The endpoint returns 200 OK with masked email (line 1011-1014)
3. User receives no OTP code
4. User cannot complete verification (verify-reset-otp requires valid OTP)
5. User remains locked out, cannot re-enroll MFA
6. No error is propagated to the admin

At line 749 (reset-user endpoint), the impact is slightly less critical since it's just a notification, but the same pattern applies.

COMPARISON WITH SIMILAR CODE:
The send-reset-otp endpoint actually has a BETTER guard at lines 989-996: if getUserEmail() returns null, it returns 500. This is the right pattern - critical operations should fail visibly rather than silently. But the sendEmail() call at line 971 doesn't have equivalent failure handling.

SEVERITY ASSESSMENT:
The claimed severity is 'medium' but should be 'high' because:

- The bug directly causes users to be locked out (cannot complete MFA re-enrollment)
- No error is visible to admins
- Affects the most sensitive operation (MFA reset verification flow)"
- **Suggested fix:** Apply error propagation for critical email sends:

1. For line 971 (send-reset-otp - HIGH PRIORITY):
   Change to return 500 if email fails, mirroring the pattern at lines 989-996:

   ```typescript
   // Send OTP via email
   const email = await getUserEmail(userSub);
   if (email) {
     try {
       await sendEmail({...});
     } catch (err) {
       console.error(`send-reset-otp: email dispatch failed`, err);
       return {
         statusCode: 500,
         headers: HEADERS,
         body: JSON.stringify({ error: 'Failed to send verification email. Try again or contact your administrator.' }),
       };
     }
   } else {
     console.error(`send-reset-otp: could not resolve email for user ${userSub}`);
     return {
       statusCode: 500,
       headers: HEADERS,
       body: JSON.stringify({ error: 'Could not resolve your email address. Contact your administrator.' }),
     };
   }
   ```

2. For line 749 (reset-user - MEDIUM PRIORITY):
   Add explicit error handling:
   ```typescript
   if (targetUserEmail) {
     try {
       await sendEmail({...});
     } catch (err) {
       console.warn(`MFA reset initiated but notification email failed for ${targetUserId}:`, err);
       // Still return 200 since MFA reset is already committed, but alert admin via logs
     }
   }
   ```

The real fix requires either:
a) Switching to InvocationType: 'RequestResponse' for critical emails (adds latency)
b) Implementing delivery confirmation via DynamoDB status tracking (more complex)
c) Making the email Lambda invocation failures propagate properly (requires separate instrumentation)

The simplest immediate fix is option (c): explicitly check if the InvokeCommand fails and propagate those errors.

### H55. HTTP redirects allowed in OAuth2 token exchange (should be HTTPS-only)

- **File:** `lambdas/node/sso-token-exchange/index.ts:64`
- **Category:** security · **Confidence:** high · **Partition:** node-auth-sso
- **What's wrong:** The redirectUri validation allows both http:// and https:// protocols (condition is 'if protocol !== https AND !== http'), but the code comment and error message indicate only https should be allowed. HTTP redirects expose authorization codes to network-level attackers who can intercept unencrypted traffic.
- **Impact:** An attacker on the same network as the user could intercept an HTTP redirect callback, steal the authorization code, and impersonate the user without HTTPS encryption protection.
- **Verifier reasoning:** The bug is REAL and manifests in production. At line 64 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/sso-token-exchange/index.ts, the code validates: `if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')` — this condition uses AND logic, which means both conditions must be true to reject. Therefore, when protocol IS 'http:', the condition evaluates to `true && false = false`, allowing the request to proceed. This directly contradicts the error message 'redirectUri must use https' and the comment 'Validate redirectUri is a valid URL with https'. The frontend at /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/Components/Auth/SSOCallbackHandler.tsx:77 derives redirectUri from `window.location.origin`, which can be http:// if the user accesses the application over an unencrypted connection. An attacker on the network could intercept an HTTP redirect, steal the authorization code, and exchange it for valid user tokens via this lambda. This violates OAuth2 security best practices (RFC 6819, OWASP) which mandate HTTPS-only redirect URIs. The fix is straightforward: change the condition to `if (parsed.protocol !== 'https:')` to reject all non-HTTPS protocols.
- **Suggested fix:** Change line 64 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/sso-token-exchange/index.ts from:

```typescript
if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
```

to:

```typescript
if (parsed.protocol !== 'https:') {
```

This ensures only HTTPS redirects are accepted for the OAuth2 token exchange, eliminating the opportunity for network-level attackers to intercept authorization codes sent over unencrypted HTTP connections.

### H56. Non-idempotent moveS3Prefix operation can leave inconsistent state

- **File:** `lambdas/node/user-files/index.ts:232-245`
- **Category:** idempotency · **Confidence:** high · **Partition:** node-apps-files
- **What's wrong:** The moveS3Prefix function performs copy-then-delete for each object. If it crashes after copying but before deleting some files, a retry will copy them again without error, creating duplicates at the new prefix while the old copies remain.
- **Impact:** Folder move/rename operations that crash mid-operation (network failure, Lambda timeout) result in duplicate files at both old and new prefixes on retry. Users see duplicate files, data integrity is compromised, and manual cleanup is required.
- **Verifier reasoning:** The moveS3Prefix function (lines 232-245) performs copy-then-delete in a loop without atomic semantics. It is genuinely non-idempotent: if the Lambda crashes after copying a file but before deleting it, a retry will copy that file again. HOWEVER, the actual impact is mitigated by application-level guards in the renameFolder caller (lines 579-585): DynamoDB checks prevent re-execution once the folder record is updated. BUT there remains a real race condition: if the Lambda crashes between moveS3Prefix completion (line 590/644) and the subsequent DynamoDB updates (lines 607-629 or 646-663), orphaned files exist at both old and new S3 prefixes, and the operation succeeds on API retry because DynamoDB was never updated. The function itself lacks proper idempotency semantics (e.g., conditional copy, atomic batch delete, or pre-delete cleanup). The bug is real but the severity is slightly less than claimed because the application layer provides partial defense—duplicates occur only in crash-between-stages scenarios, not on every retry."
- **Suggested fix:** Add idempotency to moveS3Prefix by cleaning up any existing objects at the new prefix before starting the move, or by using a two-phase approach with a staging prefix and atomic rename. Example fix:\n\nconst moveS3Prefix = async (oldPrefix: string, newPrefix: string) => {\n // Phase 1: Copy all objects to new prefix\n const allKeys = await listAllS3Objects(oldPrefix);\n for (const key of allKeys) {\n const newKey = key.replace(oldPrefix, newPrefix);\n await s3.send(new CopyObjectCommand({...}));\n }\n // Phase 2: Only after all copies succeed, delete old objects\n for (const key of allKeys) {\n await s3.send(new DeleteObjectCommand({Bucket: DATA_BUCKET!, Key: key}));\n }\n};\n\nOr better: use a staging prefix and atomic batch operations to ensure all-or-nothing semantics."

### H57. Folder rename doesn't verify all dependent folder records updated atomically

- **File:** `lambdas/node/user-files/index.ts:593-630`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-apps-files
- **What's wrong:** When renaming a folder with subfolders, the code updates DynamoDB folder records and S3 objects sequentially in a loop. If the process crashes mid-loop after some descendants are updated but before others, the folder tree becomes corrupted with some descendants at the old path and some at the new path.
- **Impact:** Renaming a folder with subfolders can leave the folder tree in an inconsistent state (some subfolders at old path, some at new path). List operations will show corrupted folder hierarchy, and subsequent operations on those folders may fail or operate on wrong data.
- **Verifier reasoning:** The bug is real and confirmed by code inspection. In /Users/arcanum/WebstormProjects/numa-proj-main/NOLIA-OFFICIAL/numa/lambdas/node/user-files/index.ts lines 601-630, the folder rename operation processes descendant folders in a sequential loop without transactional guarantees. Key findings:

1. No DynamoDB TransactWriteItems used - each Delete (607-612) and Put (613-618) are separate sequential calls. If a crash occurs between these two operations, a folder record is deleted but the new record never written, causing data loss.

2. S3 folder marker deletion (620) and write (621-629) are not atomic with DynamoDB changes. A crash between DynamoDB Put (618) and S3 marker deletion (620) leaves DynamoDB records at new paths but S3 markers still at old paths, corrupting the folder tree.

3. Multiple items in the loop (line 601) can be partially updated. If iteration 1 completes but iteration 2 crashes mid-way, some descendants are at new paths while others remain at old paths or are lost entirely.

4. No rollback or try-catch logic exists to handle failures - the code proceeds sequentially with no protection against partial state.

The code uses DynamoDBDocumentClient with DeleteCommand and PutCommand (lines 18-25), which do not support transactions. The correct fix would be to use TransactWriteCommand to batch all descendant folder updates into a single atomic operation, or implement a comprehensive rollback mechanism.

This is a genuine data integrity bug that can manifest under failure conditions (Lambda timeout, network errors, process crash). The impact is data loss and folder tree corruption as claimed.

- **Suggested fix:** Use DynamoDB TransactWriteCommand to batch all Delete and Put operations for descendant folders into a single atomic transaction. Example:

```typescript
const transactItems = [];
for (const item of descendantFolders.Items || []) {
  const oldSk = item.sk as string;
  const oldFolderPath = oldSk.replace('FOLDER#', '');
  const newFolderPath = oldFolderPath.replace(normalizedPath, newPath);
  const itemName = oldFolderPath === normalizedPath ? folderName : item.name;

  transactItems.push(
    { Delete: { TableName: FILES_TABLE, Key: { scope_key: scopeKey, sk: oldSk } } },
    { Put: { TableName: FILES_TABLE, Item: { ...item, sk: `FOLDER#${newFolderPath}`, name: itemName, updated_at: now } } }
  );
}

if (transactItems.length > 0) {
  await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems }));
}

// Then handle S3 operations
for (const item of descendantFolders.Items || []) {
  const oldFolderPath = (item.sk as string).replace('FOLDER#', '');
  const newFolderPath = oldFolderPath.replace(normalizedPath, newPath);
  await deleteFolderMarker(s3Prefix, oldFolderPath);
  await writeFolderMarker(...);
}
```

Additionally, consider batching the S3 marker operations or implementing comprehensive error handling with manual rollback logic.

### H58. MFA enforcement triggered on token refresh violates comment intent

- **File:** `lambdas/node/token-adjuster/index.ts:230-239`
- **Category:** logic · **Confidence:** high · **Partition:** node-analytics-voice
- **What's wrong:** The comment at line 230 states 'MFA enforcement — only on initial authentication, not token refresh' but the condition at lines 237-239 includes 'TokenGeneration_RefreshTokens' which IS a token refresh scenario. This means MFA enforcement incorrectly runs on token refresh, violating the intended behavior and potentially breaking legitimate user sessions.
- **Impact:** Users refreshing their tokens when MFA is not yet set up will be forced to set up MFA on every token refresh, even if they previously declined or completed the setup in a prior session, breaking the user session flow.
- **Verifier reasoning:** The bug is REAL. Code at lines 237-239 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/token-adjuster/index.ts includes 'TokenGeneration_RefreshTokens' in the condition that triggers MFA enforcement, directly contradicting the comment at line 230 which explicitly states 'only on initial authentication, not token refresh.' There is NO guard condition preventing mfaSetupRequired from being set when triggerSource === 'TokenGeneration_RefreshTokens'. This means when a user without MFA tries to refresh their token and the pool has MFA set to OPTIONAL, the Lambda will inject 'custom:mfa_setup_required' claim into the ID token on EVERY refresh, causing the frontend to repeatedly prompt for MFA setup (as shown in authService.ts line 58 which checks for requiresMfaSetup from the ID token). This breaks the user session flow by repeatedly forcing MFA setup on every refresh, violating the stated and intended behavior. The condition should exclude TokenGeneration_RefreshTokens or require an additional guard to prevent enforcement on refresh.
- **Suggested fix:** Remove 'TokenGeneration_RefreshTokens' from the condition at lines 237-239, changing it to: (event.triggerSource === 'TokenGeneration_Authentication' || event.triggerSource === 'TokenGeneration_HostedAuth')

### H59. Non-atomic writes allow inconsistent branding config state

- **File:** `lambdas/node/branding-config/index.ts:299-318`
- **Category:** data-loss · **Confidence:** high · **Partition:** node-analytics-voice
- **What's wrong:** When createVersion is true, the handler performs two separate PutCommand operations: one at line 299 for the current config, and one at line 318 for the version record. These are not wrapped in a DynamoDB transaction. If the second put fails after the first succeeds, the version is never created but the handler returns 200 OK to the caller, leaving the system in an inconsistent state where a version was requested but not persisted.
- **Impact:** An admin requests a version snapshot via PUT with createVersion=true. Line 299 succeeds (current config saved). Line 318 fails (version creation fails due to transient error or throttle). Handler returns 200 OK. Admin believes version was created but it never was. Next admin attempt to restore that version will get 404, but the current config already reflects the version snapshot.
- **Verifier reasoning:** The code at lines 299-318 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/branding-config/index.ts performs two separate PutCommand operations: first at line 299 for the current config, then conditionally at line 318 for the version record. These are not wrapped in a DynamoDB transaction. While the current exception handler (line 384-387) would return 500 if line 318 throws, the fundamental problem remains: there is no atomic guarantee between the two writes. If line 318 fails after line 299 succeeds, the current config is persisted but the version is not, creating inconsistent state. A retry would fail for the same reason. The fix requires using DynamoDB's TransactWriteCommand to group both operations into a single atomic transaction.
- **Suggested fix:** Wrap the two PutCommand operations (lines 299 and 318) in a single TransactWriteCommand. Import TransactWriteCommand from '@aws-sdk/lib-dynamodb' and replace the sequential puts with: `await ddbDoc.send(new TransactWriteCommand({ TransactItems: [{ Put: { TableName: TABLE_NAME, Item: item } }, { Put: { TableName: TABLE_NAME, Item: versionItem } }] }));` This ensures both writes succeed or both fail together, preventing the inconsistent state described in the claim.

### H60. Path traversal vulnerability in static asset serving

- **File:** `lambdas/node/openapi-docs-server/index.ts:157-160`
- **Category:** security · **Confidence:** high · **Partition:** node-init-seed
- **What's wrong:** The serveStaticAsset function extracts assetPath from user input via requestPath.replace('/docs/static/', '') and passes it directly to path.join() without validating that the resulting file path is within the intended swagger-ui-dist directory. An attacker can use ../ sequences to escape the directory and read arbitrary files.
- **Impact:** Authenticated or unauthenticated attacker can read arbitrary files from the Lambda's filesystem, potentially exposing environment variables, configuration files, or other sensitive data bundled in the Lambda package.
- **Verifier reasoning:** Confirmed by code inspection and practical testing. Lines 157-160 extract assetPath via string replacement without validation, then pass to path.join() which normalizes but does not contain paths. A request like /docs/static/../../../../etc/passwd resolves to /etc/passwd, completely outside swaggerUiDir. No handler-level authentication (lines 25-54 show zero auth checks), so any attacker can trigger this. Filesystem read via fs.readFileSync(filePath) is unrestricted. Tested with Node.js: path.join('/var/task/node_modules/swagger-ui-dist', '../../../../etc/passwd') returns '/etc/passwd', confirming path traversal. Correct mitigation: resolve both paths and verify resolvedFilePath.startsWith(resolvedSwaggerUiDir + path.sep).
- **Suggested fix:** Add path containment validation after line 160:

const resolvedSwaggerUiDir = path.resolve(swaggerUiDir);
const resolvedFilePath = path.resolve(filePath);
if (!resolvedFilePath.startsWith(resolvedSwaggerUiDir + path.sep)) {
return createResponse(404, { error: 'Asset not found' });
}

Alternatively, use a dedicated path traversal library or check: ensure filePath normalized path does not escape swaggerUiDir boundary before reading.

### H61. Overly broad IAM policy for Q Business data source role

- **File:** `infra/constructs/core-numa-infra-construct.ts:1581-1596`
- **Category:** security · **Confidence:** high · **Partition:** infra-client-core
- **What's wrong:** Q Business data source role is granted '_' actions on '_' resources, violating the principle of least privilege. This allows the role to perform any AWS action in any resource.
- **Impact:** If Q Business or the data source configuration is compromised, attackers could perform unrestricted actions across AWS resources in the client account, including accessing sensitive data, modifying infrastructure, or creating backdoors.
- **Verifier reasoning:** The overly broad IAM policy (actions: ['*'], resources: ['*']) at lines 1581-1596 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/constructs/core-numa-infra-construct.ts is REAL and would be a critical security issue IF deployed. However, this code is guarded by an optional feature flag `provisionQResources` that defaults to false (line 131), meaning it only executes for customers who explicitly opt-in. The code includes an explicit TODO comment (line 1581) acknowledging the overly permissive scope. While the policy technically violates least privilege and would grant unrestricted AWS access to the Q Business service within the account, it is not currently a manifesting vulnerability in active production use—it is a latent vulnerability in optional, infrequently-deployed code. The severity is downgraded from critical to high because: (1) it's not enabled by default, (2) there's no evidence of customer deployments with this enabled, (3) the assume role policy restricts to qbusiness.amazonaws.com service principal only, and (4) it's marked with TODO showing developer awareness. However, the core security principle violation is genuine—any customer who enables Q Business provisioning would have this vulnerability.
- **Suggested fix:** Scope the Q Business data source role policy to only the actions and resources Q Business actually needs. Per AWS documentation for Q Business data connectors with S3: (1) For S3 data sources, restrict to s3:GetObject, s3:ListBucket on the specific data bucket ARN and bucket contents. (2) For other supported data source types, grant only the minimum required actions. (3) Consider using AWS managed policies like AmazonQBusinessWebExperienceAccess rather than custom broadly-permissive policies. Example fix for S3: actions: ['s3:GetObject', 's3:ListBucket'], resources: ['arn:aws:s3:::data-bucket-name', 'arn:aws:s3:::data-bucket-name/*']

### H62. Overly broad IAM policy for Q Business web experience role

- **File:** `infra/constructs/core-numa-infra-construct.ts:1385-1394`
- **Category:** security · **Confidence:** high · **Partition:** infra-client-core
- **What's wrong:** Web experience role (used by Q Business frontend) is granted '_' actions on '_' resources, granting full AWS privileges to the web identity role. This is an identity federation vulnerability.
- **Impact:** Any user authenticating to Q Business can assume this role and perform unrestricted actions across the entire AWS account, including data exfiltration, lateral movement, and infrastructure modification.
- **Verifier reasoning:** The overly broad IAM policy with actions: ['*'] and resources: ['*'] is REAL and EXISTS in the infrastructure at /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/constructs/core-numa-infra-construct.ts lines 1385-1394. The policy is definitively ATTACHED to the web experience role at lines 1443-1447 via IamRolePolicy. The trust policy at lines 1398-1431 allows sts:AssumeRoleWithWebIdentity with the Cognito OIDC provider as a Federated principal, making it assumable by authenticated Cognito users. However, severity is HIGH (not CRITICAL) because: (1) the application does NOT actively use or expose this role to users - the frontend gets the properly scoped CognitoGroupsConstruct role via line 2031 overwrite which retrieves the identity pool role with feature-set-based scoped permissions instead, (2) the webExperienceRoleArn property is set at line 1439 but never referenced downstream, and (3) the defaultWebIdentityRoleArn passed to frontend config at line 967 uses the properly scoped role. The vulnerability exists in deployed infrastructure but is not actively exploited by application code paths. Fix: either delete the unused web experience role and policy entirely (lines 1433-1447, 1439-1441), or restrict the policy to only necessary Q Business actions (qbusiness:SearchRelevantContent, qbusiness:GetChatControls, etc.) per the AWS documentation referenced in the TODO comment at line 1384."
- **Suggested fix:** Option 1 (Recommended - Remove dead code): Delete lines 1433-1447 and lines 1439-1441 entirely since the web-experience-role is created but never used, with defaultWebIdentityRoleArn being overwritten at line 2031. Option 2 (Keep but secure): Replace the overly broad policy (lines 1385-1394) with properly scoped Q Business permissions following the AWS documentation at https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/making-sigv4-authenticated-api-calls-iam.html#control-plane-setup-iam such as: actions: ['qbusiness:SearchRelevantContent', 'qbusiness:GetChatControls'], resources: [arn:aws:qbusiness:region:account:application/app-id]

### H63. S3 Vectors Knowledge Base silently initializes with empty IDs if Lambda fails

- **File:** `infra/constructs/s3-vectors-knowledge-base-construct.ts:349-351`
- **Category:** data-loss · **Confidence:** high · **Partition:** infra-ws-apps-kb
- **What's wrong:** The construct invokes a Lambda to create the S3 Vectors Knowledge Base stack. On return, it uses `Fn.lookup()` with empty string defaults (`''`) to extract KnowledgeBaseId, KnowledgeBaseArn, and DataSourceId. If the Lambda fails or returns missing keys, the construct silently continues with empty IDs.
- **Impact:** State machine configuration downstream references empty `knowledgeBaseId` and `dataSourceId`, causing ingestion jobs to fail at runtime. The construct appears to deploy successfully but the knowledge base is non-functional. Hard to debug because the failure is not surfaced at deploy time.
- **Verifier reasoning:** The bug is REAL and reachable. At lines 348-351 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/constructs/s3-vectors-knowledge-base-construct.ts, the code extracts Lambda invocation results without checking if the Lambda failed. The Lambda handler at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/s3-vectors-manager/index.ts (lines 35-48) throws errors on failure. When CDKTF's aws_lambda_invocation resource receives a Lambda error, it sets the `functionError` field but the construct does NOT check this field. Instead, it blindly calls Fn.jsondecode(invocation.result) and uses Fn.lookup() with empty string defaults for KnowledgeBaseId, KnowledgeBaseArn, and DataSourceId. If the Lambda fails (e.g., S3 Vectors API errors, Bedrock API failures, IAM permission issues), these critical IDs remain empty strings and are propagated to the state machine configuration (lines 397-398) and IAM policies (lines 371, 375). This causes runtime ingestion job failures with cryptic error messages at lines 400+ where the state machine tries to use empty IDs. The failure is silent at deploy time because Terraform's Fn functions don't validate at synthesis time—they evaluate during apply.
- **Suggested fix:** Add explicit error checking before extracting values from invocation result. In CDKTF with Terraform interpolation, add validation after line 348:

```typescript
// Validate Lambda invocation succeeded
const invocationError = Fn.lookup(Fn.jsondecode(Fn.tostring(invocation.functionError || 'null')), 'message', '');
if (invocationError !== '') {
  throw new Error(`S3 Vectors Knowledge Base Lambda failed: ${invocationError}`);
}

// Or use Terraform's assertions (requires cdktf.Assertions):
Terraform.assert(
  Fn.lookup(invocation.functionError || '', 'message', '') === '',
  `Lambda invocation failed - check logs for details`
);
```

Or more robustly, add a local-exec provisioner that validates the Lambda succeeded before continuing, or use `null_resource` with `depends_on` to create a validation step that checks invocation function_error field before the IAM and state machine resources are created (lines 354-509).

### H64. Invocation security policy ignores orgId restriction entirely

- **File:** `infra/constructs/portal-nextgen-broker-construct.ts:88-104`
- **Category:** security · **Confidence:** high · **Partition:** infra-deployer-portal
- **What's wrong:** The Lambda invocation policy creates identical 'Allow' statements regardless of whether orgId is provided. When orgId is specified (intended to restrict invocation to principals in that org), the code still creates an open invocation policy with principal: '\*', completely ignoring the orgId constraint. The comment acknowledges that LambdaPermission doesn't support conditions but the code fails to document that orgId is being silently ignored.
- **Impact:** Anyone who can invoke the Lambda can bypass organization boundary controls intended by the orgId parameter. Multi-tenant isolation is compromised when organizations attempt to restrict broker access to their org ID - the restriction has no effect. The portal-nextgen-broker can be invoked from any AWS account even when deployed with orgId='o-apdsu3c1a7'.
- **Verifier reasoning:** The bug is confirmed by code inspection. The construct accepts an orgId parameter (line 15: "if provided, restrict invoke to principals in this org") and the caller passes orgId: 'o-apdsu3c1a7' (q-apps-deployer-stack.ts:204). However, lines 89-96 create a LambdaPermission with principal: '\*' and completely omit the principalOrgId field. The CDKTF LambdaPermissionConfig interface explicitly supports principalOrgId (node_modules/@cdktf/provider-aws/lib/lambda-permission/index.d.ts line 36-38), so the field is available and functional. The misleading comment about "LambdaPermission does not support conditions" conflates general IAM conditions (which are unsupported) with principalOrgId (a dedicated, first-class field). The code runs identically whether orgId is provided or not, completely ignoring the intended org restriction. This is a real security gap where organization boundary controls have no effect.
- **Suggested fix:** Add `principalOrgId: props.orgId` to the LambdaPermission config in the if branch (lines 89-96). The corrected code should be:\n\n`typescript\nif (props.orgId) {\n  new LambdaPermission(this, 'portal-nextgen-broker-invoke', {\n    statementId: 'AllowInvocationFromOrg',\n    action: 'lambda:InvokeFunction',\n    functionName: fn.functionName,\n    principal: '*',\n    principalOrgId: props.orgId,  // ADD THIS LINE\n  });\n} else {\n  // existing else branch unchanged\n}\n`\n\nAlternatively, implement fail-safe behavior: throw an error if orgId is provided, or ensure principalOrgId is always set whenever available.

### H65. Race condition in subagent tool event appending (content_block_start)

- **File:** `numa-frontend/src/utils/workspaceChatEventHandlers.ts:1967-1985`
- **Category:** race · **Confidence:** high · **Partition:** fe-chat-stream
- **What's wrong:** When a tool_use content_block_start event arrives for a subagent tool, the code searches for the parent subagent segment. If the parent is not found (parentIdx < 0), the function silently returns without appending the tool event, and the caller continues as if the update succeeded (returns `updated` not `prev`).
- **Impact:** If a subagent's tool events arrive before the Task segment is created (which can happen with concurrent streaming), the tool is silently dropped from the subagent's event list. The UI shows an incomplete subagent run with missing tool invocations. No retry mechanism recovers the lost event.
- **Verifier reasoning:** The bug is REAL and manifests as a race condition in React state batching. When a child tool's `content_block_start` StreamEvent arrives immediately after a parent Task tool's `content_block_start` StreamEvent, the following happens:

1. Task's content_block_start arrives (StreamEvent) at line 1920-1926
2. Since name === 'Task', effectiveParentId is set to null (line 1937)
3. Code enters the else clause (line 1989) and calls setMessages to create the Task subagent segment (lines 1994-2028)
4. setMessages is asynchronous - the state update is queued but NOT immediately applied
5. Child tool's content_block_start arrives immediately (event arrives before React batches the previous update)
6. Child tool's handler enters the if block at line 1957 with effectiveParentId set to the Task ID
7. Code calls setMessages again (line 1959) but reads stale state via `prev` parameter
8. The segments.findIndex at line 1967-1969 finds parentIdx < 0 because the Task subagent segment hasn't been added to state yet
9. Since parentIdx < 0, the condition at line 1971 is false, so the child tool event is NOT appended
10. Function returns updated (which is unchanged) at line 1987

The child tool event is silently lost. Later when content_block_stop arrives for the child tool (lines 2066-2068), it also searches for the parent segment, finds it missing, and does nothing (lines 2070-2093).

Evidence: At /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/utils/workspaceChatEventHandlers.ts lines 1967-1987, the code silently returns `updated` without the tool event appended when parentIdx < 0. Combined with asynchronous setMessages calls (lines 1994, 1959), concurrent StreamEvents can arrive faster than React batches the state, causing the parent segment to not yet exist in state when the child tool searches for it.

Severity is HIGH because: (1) Tool invocations are silently dropped from the UI with no error indication, (2) Users cannot see which tools were called by subagents, (3) No recovery mechanism exists - the event is permanently lost, (4) This can occur with normal streaming patterns when events arrive closely together.

- **Suggested fix:** Option 1 (Recommended): Buffer child tool events until parent segment exists. When a child tool's content_block_start arrives and the parent isn't found, store it in a ref (pendingSubagentEvents) and retry appending when the parent segment is created.

Option 2: Pre-create the Task subagent segment in streamingToolsRef when the Task's content_block_start arrives, before any child tools can be routed to it. Then eagerly create the actual segment in the message state only if it doesn't exist when a child tool tries to append.

Option 3: Use React.flushSync or move state logic to refs to make segment creation synchronous, eliminating the race window.

A minimal concrete fix: Add a pendingSubagentEvents ref to track tool events for parent segments not yet found. At lines 1971-1985, when parentIdx < 0, check if the parent Task was just added to activeStreamingTasksRef and buffer the event. When the Task segment is actually created (in addSubagentSegment or after setMessages completes), iterate pending events and append them.

### H66. Non-idempotent state in subagent tool input update within content_block_stop

- **File:** `numa-frontend/src/utils/workspaceChatEventHandlers.ts:2056-2096`
- **Category:** idempotency · **Confidence:** high · **Partition:** fe-chat-stream
- **What's wrong:** In the subagent tool input update handler (content_block_stop), when parentIdx < 0 (parent segment not found), the function returns `updated` unchanged instead of `prev`. This breaks React's state update idempotency guarantee.
- **Impact:** If tool input deltas arrive before the parent Task segment is rendered, the tool input parameters are lost. Subagent tools execute with empty/default inputs instead of the parameters from the streaming agent.
- **Verifier reasoning:** The bug is REAL and manifests in practice. Code analysis of /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/utils/workspaceChatEventHandlers.ts lines 2056-2096 reveals:

IDEMPOTENCY ISSUE (as claimed): When `parentIdx < 0` at line 2070, the function skips lines 2070-2093 and returns the new `updated` array at line 2095 without any modifications. This breaks React's idempotency guarantee—React sees a new state value even though nothing changed semantically.

ACTUAL DATA LOSS (extending the claim): The idempotency issue masks a more serious problem. The root cause is in lines 1957-1988 (also exhibits same pattern): when a subagent tool's content_block_start fires, it only adds the child tool to the parent segment IF the parent segment already exists in state (line 1971 `if (parentIdx >= 0)`).

Due to React 18's automatic batching, when both parent Task and child tool content_block_start events fire in succession, they're batched together. The child tool's setMessages handler executes with `prev` state that doesn't yet include the parent segment from the parent Task's earlier setMessages call in the same batch. Thus `parentIdx < 0`, the conditional block is skipped, and the child tool is never added to parent's events.

Later, when the SDK AssistantEvent arrives, handleToolUseBlock is called (line 1661), which would normally call addSubagentSegment to create the segment. However, skipTextFromAssistant is true during streaming (line 1816), so addSubagentSegment returns early (line 1276) without creating any segment.

RESULT: The subagent tool is completely orphaned—never rendered in the UI, tool execution results are invisible to the user, tool input is lost.

This is confirmed by reading:

- Line 1816: `eventContextRef.current.skipTextFromAssistant = true` (set for StreamEvent handling)
- Lines 1957-1988: Child tool only added if parent found
- Lines 1971, 1985: Parent search uses current `prev` state (stale during batching)
- Line 1276-1278: SDK handler skips segment creation if skipTextFromAssistant
- The complete flow shows no fallback or recovery mechanism for orphaned tools
- **Suggested fix:** Fix the race condition by ensuring parent segments exist before children are added. Replace the conditional parent check in lines 1957-1988 with logic that creates the parent segment if it doesn't exist. For the subagent tool input update (lines 2056-2096), implement similar logic: if parentIdx < 0, either create the parent segment or queue the update for later reconciliation. Alternatively, use React's flushSync to prevent batching of content_block_start events, ensuring parent segment exists in state before child processing begins.

### H67. Missing boardId dependency in handleBulkMove callback

- **File:** `numa-frontend/src/Components/Ops/BacklogView/BacklogView.tsx:1114-1135`
- **Category:** logic · **Confidence:** high · **Partition:** fe-ops
- **What's wrong:** The handleBulkMove function uses boardId in its body but does not include it in the useCallback dependency array. This causes stale closures where boardId may be empty/undefined when the callback is invoked, resulting in bulk moves being persisted with an empty boardId.
- **Impact:** Bulk-moving tickets from the backlog will persist updates with a missing or stale boardId. When a user selects multiple tickets and moves them to a new stage, the backend may reject the update or store it incorrectly, silently failing the operation while the UI appears to succeed until the next refresh.
- **Verifier reasoning:** The bug is confirmed by reading the actual code. At line 656, boardId is derived from context state: `const boardId = boardData?.board?.id ?? ''`. The handleBulkMove function at lines 1114-1135 uses boardId in the API payload (line 1124) but fails to include it in the useCallback dependency array (line 1134). The dependency array only contains `[selectedTickets, bulkActing, allStages, numaPost, refreshTickets]` but is missing `boardId`. This creates a stale closure: if boardData changes (e.g., user switches boards), the callback will continue using the old boardId value. Additionally, there is no guard for !boardId in the early return (line 1116), unlike the nearly-identical handleBulkAssignSprint function at lines 1171-1190, which explicitly includes both the !boardId guard (line 1173) and boardId in its dependency array (line 1189). When a user selects multiple tickets and moves them, if boardData becomes null or changes between selection and invocation, the bulk update will be persisted with a stale or empty boardId, causing silent failures or data corruption."
- **Suggested fix:** 1. Add `boardId` to the useCallback dependency array on line 1134: change `[selectedTickets, bulkActing, allStages, numaPost, refreshTickets]` to `[selectedTickets, bulkActing, allStages, boardId, numaPost, refreshTickets]`. 2. Add a guard check for missing boardId on line 1116: change `if (selectedTickets.length === 0 || bulkActing) return;` to `if (selectedTickets.length === 0 || bulkActing || !boardId) return;` to match the pattern used in handleBulkAssignSprint.

### H68. Unhandled Promise rejection in bulk archive/delete operations

- **File:** `numa-frontend/src/Components/Ops/BacklogView/BacklogView.tsx:1137-1170`
- **Category:** error-handling · **Confidence:** high · **Partition:** fe-ops
- **What's wrong:** handleBulkArchive and handleBulkDelete use Promise.all() without handling partial failures. If one ticket fails to archive/delete, the entire operation rejects and silently catches the error, leaving some tickets in an inconsistent state and clearing selection while the UI refresh happens.
- **Impact:** Production scenario: User selects 5 tickets to delete. The 3rd ticket fails due to a conflict (another user modifying it). Promise.all() rejects the entire batch. The error is logged but user is given no feedback. Selection is cleared, setBulkActing(false) runs, then refreshTickets() fetches the current state—showing only 4 tickets deleted (a silent partial failure). Users trust their bulk operations completed when they partially succeeded.
- **Verifier reasoning:** The claim's explanation contains a CRITICAL MISREADING: it states "setSelectedIds and refreshTickets still run via finally block" but these statements are actually in the try block (lines 1142-1143 for archive, 1162-1163 for delete), not the finally block. The finally block only contains setBulkActing(false).

HOWEVER, the underlying bug IS REAL and more subtle than described:

When Promise.all() throws on ANY individual failure (e.g., ticket 3 of 5 fails), the catch block executes, but:

1. setSelectedIds(new Set()) never runs (it's in try block, past the failure point)
2. refreshTickets() never runs (it's in try block, past the failure point)
3. setBulkActing(false) runs (finally block)
4. Only console.error() provides feedback

This creates a genuine inconsistency: if tickets 1-2 succeed but ticket 3 fails, those 2 tickets are deleted on the server, but:

- The UI never refreshes to show the new state
- Selected IDs are never cleared
- User gets no error notification
- The bulkActing flag resets, but the operation partially succeeded

Evidence from code at /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/Components/Ops/BacklogView/BacklogView.tsx:

- Lines 1141-1143: Promise.all() then setSelectedIds/refreshTickets in try block
- Lines 1144-1145: Only console.error in catch
- Lines 1146-1147: Only setBulkActing(false) in finally
- Same pattern in handleBulkDelete (lines 1161-1167)

Contrast with handleChangeStage (lines 1074-1079) which correctly calls refreshTickets() in its catch block to re-sync UI on error.

The fix would be to call refreshTickets() in the catch block for all bulk operations, similar to how handleChangeStage does it, and ideally add user-facing error notification.

- **Suggested fix:** Add refreshTickets() call to catch blocks in handleBulkArchive and handleBulkDelete, and consider adding user-facing error notification (toast/modal). For example:

```typescript
const handleBulkArchive = useCallback(async () => {
  if (selectedTickets.length === 0 || bulkActing) return;
  setBulkActing(true);
  try {
    await Promise.all(selectedTickets.map((tk) => OpsService.archiveTicket(numaPut, tk.id, tk.version, tk.boardId)));
    setSelectedIds(new Set());
    await refreshTickets();
  } catch (err) {
    console.error('[BacklogView] Bulk archive failed:', err);
    await refreshTickets(); // Re-sync UI with server state
    // TODO: Add user-facing error notification
  } finally {
    setBulkActing(false);
  }
}, [selectedTickets, bulkActing, numaPut, refreshTickets]);
```

Apply the same pattern to handleBulkDelete.

### H69. Race condition in DnD drag-and-drop with version conflicts

- **File:** `numa-frontend/src/Components/Ops/BacklogView/BacklogView.tsx:1252-1393`
- **Category:** race · **Confidence:** high · **Partition:** fe-ops
- **What's wrong:** handleDragEnd captures ticket.version from the ticket at drag-start time (line 1264: ticket = filteredTickets.find(...)), but by the time the async update is sent (lines 1374-1385), the ticket may have been updated by another user. The version check will fail. The optimistic update is not rolled back, leaving the UI in a stale state. A refreshTickets() is called on error, but may take time to complete.
- **Impact:** User A and User B are viewing the same backlog. User A drags a ticket and starts moving it. User B updates the ticket's assignee. User A's drag completes, sending the update with the old version number. The server rejects it due to version mismatch (409). The optimistic update in the UI is not reverted. User A sees the ticket in the new stage/order, but it's actually still in the old stage (server state). When the refresh completes, the UI snaps back to the server state, confusing the user about whether the move actually happened.
- **Verifier reasoning:** The race condition is REAL and confirmed by code inspection.

TIMELINE OF THE BUG:

1. Line 1264: User A's drag captures `const ticket = filteredTickets.find(...)` with version N
2. Line 1318: draggedTickets collected from filteredTickets, containing version N
3. Lines 1359-1371: Optimistic update applied immediately via setTickets() — UI updated with new stage/order
4. [Meanwhile] User B updates the ticket's assignee — server increments version to N+1
5. Lines 1374-1385: updateTicket() sent with tk.version (which is N, the old version)
6. Server rejects with 409 Conflict (version mismatch)
7. Lines 1387-1389: Error caught, refreshTickets() called but NO ROLLBACK of optimistic state

CRITICAL ISSUE: The optimistic update at lines 1359-1371 is unconditionally applied BEFORE the try block, so it's already in UI state. When the server rejects with 409 due to version mismatch, the error handler (lines 1387-1390) does NOT roll back the optimistic update — it only logs and calls refreshTickets(). There is a window of time where the UI displays the stale optimistic state (ticket in new stage/position) even though the server operation failed.

IMPACT: User A sees the ticket moved in the UI, but when refreshTickets() completes and fetches server state, the ticket snaps back to its original position (because User A's move never succeeded). This confuses the user about whether the operation succeeded.

The version used at line 1382 (tk.version) is captured from the state at drag-start time and is not updated during the drag, so it becomes stale if another user modifies the ticket before the drag completes.

Root cause: Optimistic update applied unconditionally before async operation, with no rollback on version conflict error.

- **Suggested fix:** 1. Capture the current ticket state immediately before the API call (inside the try block, just before Promise.all) to use the latest version

2. Or, explicitly roll back the optimistic update on error by restoring the previous ticket states before calling refreshTickets()
3. Example fix: Save the previous tickets state, and on error, restore it before calling refreshTickets():

```typescript
const previousTickets = tickets; // capture before optimistic update
setTickets((prev) => /* optimistic update */);
try {
  await Promise.all(/* update requests with old version */);
  await refreshTickets();
} catch (err) {
  console.error('[BacklogView] Failed to move tickets:', err);
  setTickets(previousTickets); // explicit rollback
  await refreshTickets();
}
```

Better solution: Fetch the latest ticket data before sending the update to get the current version number, OR re-fetch the ticket just before sending the update to minimize version staleness.

### H70. Missing dzSelectedKbId and dzKbFolders in handleDropzoneSubmit dependency array

- **File:** `numa-frontend/src/Components/Files/CreateShareModal.tsx:834-851`
- **Category:** logic · **Confidence:** high · **Partition:** fe-files-agents
- **What's wrong:** The handleDropzoneSubmit callback uses dzSelectedKbId and dzKbFolders (line 794, 796) but these are not included in the dependency array. This creates a stale closure: if dzSelectedKbId changes, the callback still references the old value. Meanwhile, selectedFolder is in the dependencies (line 836) but is never used in the function body.
- **Impact:** When dzSelectedKbId changes (user selects a different KB), the callback still uses the stale dzSelectedKbId value from when the callback was created. Additionally, the dependency on selectedFolder which is unused causes unnecessary callback recreation. Combined with bug #1, this means the dropzone will be created in an unpredictable KB location.
- **Verifier reasoning:** The bug is real and confirmed by code inspection:

1. **Missing dependencies in handleDropzoneSubmit (lines 834-851)**:
   - Line 794 uses: `const targetKbId = dzSelectedKbId || userSub;`
   - Line 796 uses: `dzKbFolders.find((kb) => kb.kb_id === targetKbId)?.kb_name`
   - Yet the dependency array does NOT include `dzSelectedKbId` or `dzKbFolders`

2. **Unused dependency**:
   - Line 836 includes `selectedFolder` in the dependency array
   - `selectedFolder` is never referenced in the function body (lines 785-833)
   - It is only used for UI display elsewhere (lines 1215, 1522)

3. **Same issue in handleQuickCreateDropzone (line 996)**:
   - Line 967 uses `dzSelectedKbId`
   - Line 969 uses `dzKbFolders`
   - Line 996 dependency array includes `selectedFolder` but not `dzSelectedKbId` or `dzKbFolders`

**Impact**: This creates stale closures. If a user selects a different KB via `setDzSelectedKbId()` (line 1132) or the `dzKbFolders` array is repopulated (line 465), the callback will continue using the old values captured at callback creation time. The dropzone will be created in the wrong KB location, matching the claim's impact assessment.

The unused `selectedFolder` dependency causes unnecessary callback recreations whenever the folder display changes, compounding the issue.

- **Suggested fix:** In handleDropzoneSubmit (line 834), change the dependency array from:

```
  ], [
    user,
    selectedFolder,
    instructions,
    authMode,
    passcode,
    expiryHours,
    maxFileSizeMb,
    totalQuotaMb,
    allowedExtensions,
    enableApi,
    enableChat,
    description,
    dropzoneMaxQuestions,
    selectedKbId,
    onCreated,
    t,
  ]);
```

To:

```
  ], [
    user,
    dzSelectedKbId,
    dzKbFolders,
    instructions,
    authMode,
    passcode,
    expiryHours,
    maxFileSizeMb,
    totalQuotaMb,
    allowedExtensions,
    enableApi,
    enableChat,
    description,
    dropzoneMaxQuestions,
    selectedKbId,
    onCreated,
    t,
  ]);
```

Remove `selectedFolder` and add `dzSelectedKbId, dzKbFolders`.

Apply the same fix to handleQuickCreateDropzone at line 996.

### H71. Race condition: dzSelectedKbId not in handleDropzoneSubmit deps while used in submission

- **File:** `numa-frontend/src/Components/Files/CreateShareModal.tsx:785-851`
- **Category:** race · **Confidence:** high · **Partition:** fe-files-agents
- **What's wrong:** handleDropzoneSubmit references dzSelectedKbId at line 794 to determine the target KB, but dzSelectedKbId is not in the dependency array. If the user selects a different KB folder and immediately clicks submit before the callback dependency updates, the submission will use the stale KB ID.
- **Impact:** User selects KB 'TeamFolder', the callback was created with dzSelectedKbId='PersonalFolder'. User clicks submit before React updates the memoized callback. The dropzone is created in PersonalFolder instead of TeamFolder, and files will be placed in the wrong location.
- **Verifier reasoning:** The bug is REAL. At /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/Components/Files/CreateShareModal.tsx:

1. Line 285: `dzSelectedKbId` is declared as mutable state with `useState`
2. Lines 794-796: `handleDropzoneSubmit` uses `dzSelectedKbId` to determine the target KB folder for the dropzone
3. Lines 834-851: The dependency array does NOT include `dzSelectedKbId` or `dzKbFolders`
4. Lines 967-969: `handleQuickCreateDropzone` has the same issue (uses `dzSelectedKbId` and `dzKbFolders` but dependency array at line 996 is `[user, selectedFolder, onCreated, t]`)

The manifestation is possible because:

- User can navigate backward in the dropzone wizard (dzGoBack, line 926)
- From step 10, user can go back multiple steps to reach step 1
- At step 1, user can select a different KB folder, changing `dzSelectedKbId`
- User navigates forward again to step 10
- The memoized callbacks (`handleDropzoneSubmit`, `handleQuickCreateDropzone`) were created with the OLD `dzSelectedKbId` value in their closure
- When the user clicks submit, the callbacks use the stale KB ID

Example: User selects "PersonalFolder", goes to step 10, goes back to step 1, selects "TeamFolder", goes forward to step 10 again. Submitting will create the dropzone in PersonalFolder (the stale value) instead of TeamFolder.

Fix: Add `dzSelectedKbId` and `dzKbFolders` to the dependency array for both callbacks (lines 834-851 and line 996).

- **Suggested fix:** Add `dzSelectedKbId` and `dzKbFolders` to the dependency arrays:

For handleDropzoneSubmit (line 834-851), change:

```
  ], [
    user,
    selectedFolder,
    instructions,
    authMode,
    passcode,
    expiryHours,
    maxFileSizeMb,
    totalQuotaMb,
    allowedExtensions,
    enableApi,
    enableChat,
    description,
    dropzoneMaxQuestions,
    selectedKbId,
    onCreated,
    t,
  ]);
```

To:

```
  ], [
    user,
    selectedFolder,
    instructions,
    authMode,
    passcode,
    expiryHours,
    maxFileSizeMb,
    totalQuotaMb,
    allowedExtensions,
    enableApi,
    enableChat,
    description,
    dropzoneMaxQuestions,
    selectedKbId,
    dzSelectedKbId,
    dzKbFolders,
    onCreated,
    t,
  ]);
```

For handleQuickCreateDropzone (line 996), change:

```
  ], [user, selectedFolder, onCreated, t]);
```

To:

```
  ], [user, selectedFolder, dzSelectedKbId, dzKbFolders, onCreated, t]);
```

---

## MEDIUM (45)

### M1. Swallowed exceptions during metadata deletion hide failures

- **File:** `lambdas/python/workspace-chat-tools/tools/knowledge_base.py:1307-1310`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-wschat-kb-ops
- **What's wrong:** The metadata sidecar deletion uses a bare except clause that silently swallows all exceptions. While the code includes a comment saying the sidecar 'may not exist', this is too broad and could hide real S3 errors like permission issues, network failures, or service errors.
- **Impact:** If S3 delete_object fails due to permissions, throttling, or service issues, the error is silently ignored and only the main file is logged as deleted. An operator investigating missing metadata files would have no indication of the failure. In a multi-tenant system, permission errors could go undetected.
- **Verifier reasoning:** The bug is real. At /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/workspace-chat-tools/tools/knowledge_base.py lines 1307-1310, the code uses a bare except clause that catches ALL exceptions from s3_client.delete_object(). While boto3's delete_object() doesn't raise exceptions for non-existent keys (by design), it DOES raise exceptions for legitimate failure scenarios: transport errors, timeouts, credential/permission failures (AccessDeniedException), throttling errors (ServiceUnavailableError), and other AWS service errors. These legitimate failures are silently swallowed with pass, and the comment "Sidecar may not exist; not an error" doesn't justify catching all exception types. The metadata deletion failure is never logged, leaving operators with no indication of real permission, throttling, or connectivity issues. The asymmetry with the main file deletion (line 1303, no try-except) suggests the developer may have misunderstood that delete_object is a no-op for missing files but still can raise for actual service failures. Severity is medium rather than high because: (1) only the optional metadata sidecar is affected, not the main file operation which succeeds; (2) such service errors would be rare in normal operation; (3) the impact is loss of visibility rather than data loss. However, in a multi-tenant system, silently ignoring permission errors is a legitimate concern.
- **Suggested fix:** Replace the bare except clause with specific exception handling. Either: (a) catch ClientError specifically and check the error code, logging permission/service errors while silently ignoring missing key scenarios (though delete_object doesn't raise for missing keys anyway), or (b) remove the try-except entirely since delete_object doesn't fail for missing keys, relying on the outer exception handler (lines 1330-1338) to catch any legitimate service errors. Recommended approach: `try: s3_client.delete_object(...); except Exception as e: logger.warning("Failed to delete metadata sidecar", key=metadata_key, error=str(e))` to surface real errors while gracefully handling the missing sidecar case.

### M2. All-KBs mode may silently drop KBs if query fails without full error propagation

- **File:** `lambdas/python/workspace-chat-tools/tools/knowledge_base.py:310-327`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-wschat-kb-ops
- **What's wrong:** In \_handle_all_kbs_query, exceptions from individual KB queries are caught and logged as warnings, but the result object is populated with an error status. The caller receives partial results without clear indication of which KBs failed.
- **Impact:** If querying one KB fails (e.g., permission denied, service error), that KB's results are replaced with an error object in the response. The agent may proceed with incomplete information. In scenarios where a KB contains critical information, the agent won't know the query silently failed for that KB and may give incorrect answers to the user.
- **Verifier reasoning:** The bug is real. Code inspection shows: (1) Lines 310-327 catch exceptions from KB queries, log them as warnings, and append error entries to all_kb_results with 'provider': 'error' and 'error': str(e). (2) Lines 330-337 filter per_kb_references using "if result['references']", which excludes failed KBs (they have empty references). (3) Lines 349-378 return only raw_content, references (filtered per_kb_references), kbs_queried, total_results_count, and query—NO error information field. The error information appended at line 325 is completely lost in the final response. The agent receives kbs_queried (all attempted) and references (only successful), but has no explicit error messages. While the agent can infer failure by comparing these lists, it cannot determine why each KB failed or provide error context to the user. This is problematic for agents relying on critical KBs—if one fails, the agent won't know and may give incomplete answers. Severity is medium because: (a) error logs show the issue internally, (b) failures CAN be inferred but require custom agent logic, (c) actual error reasons are completely lost.
- **Suggested fix:** Modify \_handle_all_kbs_query to include KB error information in the response. After line 337, add: kb_errors = [{"kb_id": result["kb_id"], "kb_name": result["kb_name"], "error": result.get("error")} for result in all_kb_results if result.get("provider") == "error"]. Then include "kb_errors": kb_errors in all three return statements (lines 349-355, 364-370, 373-378). This exposes error information to the agent so it can make informed decisions and provide meaningful feedback to users about which KBs failed and why.

### M3. Transcript stitching misses content on identical chunk boundaries

- **File:** `lambdas/python/workspace-chat-tools/tools/transcribe.py:816-846`
- **Category:** logic · **Confidence:** high · **Partition:** py-wschat-misc
- **What's wrong:** The overlap detection in `_find_overlap()` attempts to deduplicate repeated text at chunk boundaries. However, if two consecutive chunks both start with the exact same text (e.g., silence padding that appears in both chunks due to overlap configuration), the function may incorrectly identify overlap when there is none, causing content loss. The comparison is word-based (line 829: `.lower().strip()`) which may normalize away punctuation that should be preserved.
- **Impact:** For meeting recordings with repetitive sections (e.g., repeated "Hello?"), the stitching logic may incorrectly skip content from the second chunk, producing a transcript with missing words or phrases from mid-meeting.
- **Verifier reasoning:** The bug is real and reachable. At lines 816-846, `_find_overlap()` searches for matching word sequences between the tail of the previous chunk and start of the next chunk. The algorithm has NO MINIMUM MATCH LENGTH requirement and can match single words (line 843: `if next_lower[:seq_len] == seq` with seq_len potentially = 1). This creates a false-positive scenario: if the overlapping audio region (0.5 seconds, by design at line 61) transcribes to content that coincidentally matches text at the boundary, the algorithm will incorrectly deduplicate it. Example: previous chunk ends with "hello", next chunk starts with "hello repeated..." where the overlap region was silent or unintelligible. The algorithm would match the single word "hello" (seq_len=1 at line 844) and skip it, producing "repeated..." instead of "hello repeated...". The claim's concern about "silence padding" is mischaracterized (silence transcribes to nothing), but the core logic issue is valid: any sequence including single-word matches at chunk boundaries can trigger false deduplication when the overlap region doesn't actually contain that sequence or when text naturally repeats at boundaries. Severity is medium, not critical, because: (1) the 0.5-second overlap typically transcribes to multi-word content, reducing false positive likelihood; (2) the scenario requires coincidental repetition at chunk boundaries; (3) the impact is content loss (missing words), not complete transcript corruption. The fix is straightforward: add `if best_match >= 2: return best_match` at line 844 to require at least 2-word matches, reducing false positives while preserving legitimate overlap detection.
- **Suggested fix:** Add a minimum match length requirement to `_find_overlap()` at line 846 to prevent single-word false positives:

```python
def _find_overlap(tail_words: list[str], next_words: list[str]) -> int:
    """..."""
    if not tail_words or not next_words:
        return 0

    tail_lower = [w.lower().strip(".,!?;:") for w in tail_words]
    next_lower = [w.lower().strip(".,!?;:") for w in next_words]

    best_match = 0

    for start in range(len(tail_lower)):
        seq = tail_lower[start:]
        seq_len = len(seq)

        if seq_len > len(next_lower):
            continue

        if next_lower[:seq_len] == seq:
            # Require at least 2 words to avoid single-word false positives
            if seq_len >= 2:
                best_match = max(best_match, seq_len)

    return best_match
```

This ensures overlap detection only triggers on meaningful multi-word sequences that are unlikely to be coincidental repetitions at chunk boundaries.

### M4. Non-idempotent global state modification in google_search breaks replay safety

- **File:** `lambdas/python/numa-chat-agent/numa_chat_agent/tools/web_search.py:643-644, 724`
- **Category:** idempotency · **Confidence:** high · **Partition:** py-chatagent-pd
- **What's wrong:** The google_search function modifies global state (\_search_count_in_session, \_last_search_time) on every call. If a request is replayed or retried, search delays and backoff behavior change unpredictably because the global counters have already been incremented from the first attempt.
- **Impact:** Production failure: Idempotent retry logic becomes unreliable. A request retried due to transient network failure experiences different backoff behavior on retry vs. initial attempt, violating idempotency requirements. SQS message retries, Lambda auto-retries, or user-initiated retries all produce inconsistent results.
- **Verifier reasoning:** The bug is REAL. I confirmed: (1) Global variables \_search_count_in_session, \_last_search_time, \_failed_searches_in_row are declared at module level (lines 562-564). (2) They are unconditionally incremented on every google_search() call (line 643: \_search_count_in_session += 1, line 724: \_failed_searches_in_row += 1). (3) No reset mechanism exists between function invocations. (4) AWS Lambda containers reuse global state across warm invocations. (5) The delay calculation logic (lines 617-626) uses these counters to compute session_multiplier and backoff_multiplier, which affects sleep durations. If a request is retried at the Lambda/HTTP level and the same container is reused, the second attempt will see different global state, producing different delays than the first attempt, violating idempotency semantics. However, severity is MEDIUM (not high) because this affects timing/rate-limiting behavior rather than search correctness; the code will still function but with inconsistent backoff behavior across retries.
- **Suggested fix:** Reset the global state at the start of google_search() or web_search_impl() to ensure idempotency. Options: (1) Reset counters at function entry: add `global _search_count_in_session, _last_search_time, _failed_searches_in_row` and `_search_count_in_session = 0; _failed_searches_in_row = 0` at the start of web_search_impl(). (2) Pass session state as a parameter instead of using globals. (3) Use request-scoped context (AsyncVar or contextvars) to isolate state per invocation. (4) Pass force_delay=False on retries to disable the global state check. The cleanest fix is option 1: reset the counters at web_search_impl() entry to ensure each invocation starts fresh.

### M5. Missing placeholders in vision extraction prompts

- **File:** `lambdas/python/extract-content-from-file/fm_vision_extraction.py:359-365`
- **Category:** logic · **Confidence:** high · **Partition:** py-content-extract
- **What's wrong:** The code calls .format(start_page=start_page, end_page=end_page) on prompts that don't contain {start_page} or {end_page} placeholders. Python's str.format() silently ignores unused kwargs, so the format calls have no effect and page context is never added to the prompts.
- **Impact:** When processing multi-page PDFs in chunks, the vision model is not informed which pages it's processing. This could impact the quality of page headers/footers in extracted content and loses context about page ranges during concurrent extraction.
- **Verifier reasoning:** REAL BUG: Lines 359 and 363 call .format(start_page=start_page, end_page=end_page) on VISION_EXTRACTION_PROMPT_TEMPLATE (lines 116-128) and VISION_EXTRACTION_PROMPT_TRANSLATE_TEMPLATE (lines 143-158). I verified both prompt templates contain ZERO {start_page} or {end_page} placeholders—they are static strings with formatting instructions only. Python's str.format() silently ignores unused kwargs, so these format() calls do nothing (the kwargs are discarded). The code path IS reachable: process_page_batch() at lines 701-702 passes start_page and end_page to \_process_image_batch_with_retry(), which invokes \_process_image_batch() that executes lines 359/363. This means multi-page PDF processing passes page numbers to the function, but the prompts never actually mention which pages are being processed. The vision model receives no textual context about page numbers in its instruction. Severity is medium (not critical) because: (1) the image itself contains visual context, and (2) with max_images_per_call=1, each image is processed alone anyway. The bug represents wasted code and lost opportunity to add page context to improve extraction quality, but isn't a hard functional failure.
- **Suggested fix:** Add {start_page} and {end_page} placeholders to both VISION_EXTRACTION_PROMPT_TEMPLATE and VISION_EXTRACTION_PROMPT_TRANSLATE_TEMPLATE. For example, insert "Processing pages {start_page} to {end_page}.\n\n" at the start of each template. Or modify the conditional logic at lines 357-365 to only call .format() if placeholders exist, falling back to the single-image prompts otherwise.

### M6. Non-idempotent state creation in prepare_chunks for Step Functions

- **File:** `lambdas/python/extract-content-from-file/lambda_function.py:1418`
- **Category:** idempotency · **Confidence:** high · **Partition:** py-content-extract
- **What's wrong:** The \_handle_prepare_chunks function generates a new UUID for batch_id on every invocation (line 1418: `batch_id = str(uuid.uuid4())`). In a Step Functions workflow, if this lambda is retried due to transient failures, a new batch_id is generated, leaving orphaned temporary S3 files from previous attempts.
- **Impact:** Repeated retries of prepare_chunks in Step Functions cause S3 storage leaks. Each retry creates a new temp-pdf/{uuid} prefix, but only the final batch_id is tracked for cleanup. Previous temporary PDF page images are never deleted, accumulating over time.
- **Verifier reasoning:** The bug is real. When \_handle_prepare_chunks (line 1418 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/extract-content-from-file/lambda_function.py) is retried by Step Functions, it unconditionally generates a new UUID for batch_id via `str(uuid.uuid4())` on every invocation. The Step Functions Retry policy (defined in /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/dist/constructs/apps/nolia-construct.js lines 340-346) retries with identical input payload, so the Lambda receives no idempotency key. The previous attempt's S3 files (uploaded via pdf_to_images at lines 770-773 of fm_vision_extraction.py) use the OLD batch_id as part of their key path (temp-pdf/{old_batch_id}/_). When a retry generates a new batch_id, it creates new S3 files at temp-pdf/{new_batch_id}/_ while the old files remain. The merge_chunks function (line 1701 in lambda_function.py) only cleans up the temp_prefix from the final successful prepare_chunks (line 429 in nolia-construct.js: 'temp_prefix.$': '$.prepare_result.temp_prefix'), leaving all previous retry attempt files orphaned. No S3 lifecycle policy exists on the outputs bucket to automatically clean these up. This creates S3 storage leaks when Lambda.ServiceException or Lambda.TooManyRequestsException triggers retries (the only Retry.ErrorEquals in Step Functions config), which while relatively rare, are realistic failure modes.
- **Suggested fix:** Implement idempotent batch_id generation: Either (1) add batch_id to the Step Functions payload after first prepare_chunks success and check for it in the lambda, (2) generate batch_id from deterministic inputs like hash(job_id + file_key), or (3) add an S3 lifecycle policy to automatically delete objects in temp-pdf/\* after configurable TTL (e.g., 1 day). Option 1 is cleanest: modify prepare_chunks to accept optional batch_id from payload and only generate if missing, then update Step Functions to pass batch_id through subsequent retries via ResultPath.

### M7. Unchecked JSON deserialization of chunk page data

- **File:** `lambdas/python/extract-content-from-file/lambda_function.py:1648`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-content-extract
- **What's wrong:** In \_handle_merge_chunks, the code deserializes JSON from S3 without validating the structure. If the chunk result JSON is malformed, the IndexError or KeyError on line 1656-1658 will crash the entire merge operation with no partial recovery.
- **Impact:** If a single chunk's JSON in S3 is corrupted or incomplete, the merge operation fails entirely, losing all prior progress. The lambda crashes with an unhandled exception instead of providing meaningful error feedback about which chunk failed.
- **Verifier reasoning:** The bug is REAL and confirmed by code inspection:

1. Line 1648 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/extract-content-from-file/lambda_function.py performs unchecked JSON deserialization: `chunk_pages = json.loads(response["Body"].read().decode("utf-8"))` with no try-catch.

2. Lines 1656-1658 directly access dictionary keys without validation:

   ```
   DocumentPage(
       page_number=page_data["page_number"],
       text=page_data["text"],
       num_words=page_data["num_words"],
   )
   ```

   These will raise KeyError if keys are missing from the deserialized JSON.

3. The deserialized JSON could have the wrong structure (e.g., not a list, or missing required fields) if S3 data is corrupted, tampered with, or incompletely written.

4. There is NO exception handling in \_handle_merge_chunks itself (lines 1587-1709).

5. The handler (line 266) calls \_handle_merge_chunks without a try-catch wrapper - only the default extraction flow (lines 327-393) has exception handling, not the action dispatch.

6. If ANY chunk fails deserialization or key access, the entire merge operation crashes with an unhandled exception, losing all progress from successfully processed chunks.

7. The code assumes S3 data is always valid and well-formed, which is not a safe assumption for external data sources.

The severity is medium (not high) because:

- This is an error-handling/resilience issue, not a correctness bug
- Impact is high (total failure) but likelihood depends on S3 integrity which is generally good
- Not a security vulnerability
- Partial recovery is possible (skip bad chunks) rather than total loss being mandatory
- **Suggested fix:** Add error handling around JSON deserialization and key access in the chunk processing loop (lines 1640-1660). Wrap the deserialization in try-except and validate the structure before accessing keys:

```python
for chunk in chunks:
    chunk_key = chunk.get("pages_key")
    chunk_bucket = chunk.get("pages_bucket")

    try:
        if chunk_key and chunk_bucket:
            response = s3_client.get_object(Bucket=chunk_bucket, Key=chunk_key)
            chunk_pages = json.loads(response["Body"].read().decode("utf-8"))

            if not isinstance(chunk_pages, list):
                logger.error(f"Invalid chunk format at {chunk_key}: expected list, got {type(chunk_pages).__name__}")
                continue
        else:
            chunk_pages = chunk.get("pages", [])

        for page_data in chunk_pages:
            if not isinstance(page_data, dict):
                logger.error(f"Invalid page data type: expected dict, got {type(page_data).__name__}")
                continue

            required_keys = {"page_number", "text", "num_words"}
            missing = required_keys - set(page_data.keys())
            if missing:
                logger.error(f"Page data missing required keys {missing}")
                continue

            all_pages.append(
                DocumentPage(
                    page_number=page_data["page_number"],
                    text=page_data["text"],
                    num_words=page_data["num_words"],
                )
            )
    except json.JSONDecodeError as e:
        logger.error(f"Failed to deserialize chunk at {chunk_key}: {e}")
        continue
    except Exception as e:
        logger.error(f"Unexpected error processing chunk {chunk_key}: {e}")
        continue
```

This provides:

- Try-catch around deserialization to handle JSONDecodeError
- Type checking to ensure deserialized object is a list
- Key validation before dictionary access
- Graceful degradation (skip bad chunks instead of crashing)
- Meaningful error logging showing which chunk failed

### M8. Missing non-idempotent guard allows duplicate audit writes on Lambda retry

- **File:** `lambdas/python/oauth-workspace-tools/tools/oauth_tools.py:369-424`
- **Category:** idempotency · **Confidence:** high · **Partition:** py-oauth-connectors
- **What's wrong:** \_audit_oauth_fetch dedupes within \_OAUTH_AUDIT_DEDUP_SECONDS (60s) using module-level \_LAST_OAUTH_AUDIT_TS. But this is a Lambda container cache that does NOT survive cold starts. If a Lambda cold-starts between the same user's back-to-back token fetches within dedup window, duplicate audit entries write to DynamoDB. Worse: there's no idempotency key on put_item, so transient DynamoDB retries create duplicate rows.
- **Impact:** Audit log shows 1000 entries for a single chat that called the same OAuth tool 5 times. Each cold start causes re-audit. On DynamoDB transient errors, put_item is retried with different audit_id, creating duplicates. 'My Secrets > Activity' UI counts inflate. Compliance audits become unreliable.
- **Verifier reasoning:** The bug is PARTIALLY REAL. I confirmed by reading:

1. DynamoDB table schema (infra/constructs/core-numa-infra-construct.ts, lines 1214-1215): Hash key is user_id, range key is timestamp_audit_id. The composite key (user_id, timestamp_audit_id) must be unique.

2. Module-level cache (oauth_tools.py, line 50): `_LAST_OAUTH_AUDIT_TS: Dict[Tuple[str, str], float] = {}` is indeed a container-level cache that WILL be lost on cold start.

3. Dedup logic (lines 385-390): Checks against \_LAST_OAUTH_AUDIT_TS; if elapsed > 60s, updates the dict and proceeds.

4. Audit ID generation (line 394): `audit_id = str(uuid.uuid4())` generates a NEW UUID on every call.

5. The claim's scenario IS REACHABLE: On Lambda cold start, \_LAST_OAUTH_AUDIT_TS is empty. If a user's OAuth token is fetched again within 60s in a new container, the dedup check passes (no prior timestamp in the new dict), a new UUID is generated, and a new DynamoDB row is written with a different range key.

HOWEVER, the claim's second argument is INCORRECT: DynamoDB transient retries do NOT create duplicates. The `audit_id` is generated once and reused in retries—there's no new put_item call. The boto3 client handles retries transparently with the same item.

The comment at lines 48-49 shows this is KNOWN and ACCEPTED: 'Cold starts will re-audit — acceptable trade for visibility (TASK-146).' This is intentional, not a bug. The severity is MEDIUM, not HIGH, because:

- It's a known tradeoff, not an oversight
- The impact is audit log inflation (not data corruption or security breach)
- It only happens on cold starts, not on every retry
- The code explicitly acknowledges it in comments"
- **Suggested fix:** If this needs fixing despite the intentional design:

1. Use DynamoDB Condition Expression to prevent duplicate writes:

```python
dynamodb.put_item(
    TableName=VAULT_AUDIT_LOG_TABLE_NAME,
    Item={...},
    ConditionExpression='attribute_not_exists(#pk)',
    ExpressionAttributeNames={'#pk': 'timestamp_audit_id'}
)
```

2. Or use deterministic audit_id based on (timestamp, user_id, secret_name):

```python
audit_id = hashlib.sha256(f'{timestamp}#{user_sub}#{secret_name}'.encode()).hexdigest()[:8]
```

This ensures the same logical audit event (same second, same user, same secret) always produces the same range key, making put_item idempotent even across cold starts.

### M9. Synergy PAT rotation history truncation silently loses audit trail on concurrent rotations

- **File:** `lambdas/python/data-connectors/lambda_function.py:397-408`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-oauth-connectors
- **What's wrong:** \_rotate_synergy_pat appends to pat_history and caps to 50 entries (line 408). However, concurrent rotation calls can read the same secret, append independently, and the last write wins. If two rotations happen in parallel, the history from the first rotation is overwritten by the second, losing rotation events.
- **Impact:** Admin audits Synergy PAT rotation history and sees gaps (entries 5-10 are missing). Security team cannot determine if PAT was rotated on a given date. Compliance audits become unreliable.
- **Verifier reasoning:** The bug is REAL. I read the exact code at lines 397-408 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/data-connectors/lambda_function.py. The function \_rotate_synergy_pat exhibits a classic unprotected read-modify-write race condition on AWS Secrets Manager:

1. Line 311 in \_get_synergy_credentials fetches the secret (this is passed to \_rotate_synergy_pat)
2. Line 398: \_rotate_synergy_pat reads pat_history from the secret
3. Lines 399-407: appends a new history entry
4. Line 408: caps to 50 entries
5. Line 425: writes back via upsert_secret (no version checking, no optimistic locking)

Two concurrent Lambda invocations for the same user can:

- Both read the same secret state (say, 45 entries)
- Both append their rotation entry independently
- Second write overwrites first write, losing the first rotation's history entry

This is reachable: \_rotate_synergy_pat is called from \_get_synergy_credentials (line 341), which is invoked from read operations like search/details/history/weblink, and also via explicit /data-connectors/synergy/rotate-pat endpoint (line 1031). Concurrent requests are possible.

There is NO lock, NO version check, NO conditional write, and NO deduplication logic. AWS Secrets Manager's put_secret_value call at line 31-34 in storage.py uses no version control parameters.

The claim's impact assessment is accurate: audit trail entries are silently lost, creating compliance/audit gaps. Severity is MEDIUM because while the data loss is real, the concurrent window is narrow (only when days_remaining <= 30 and two requests arrive simultaneously).

- **Suggested fix:** Use AWS Secrets Manager's ClientRequestToken for idempotency, or implement a distributed lock via DynamoDB. Example: Generate a rotation operation ID, store it as a lock record in DynamoDB with TTL, and only proceed if you can acquire it. Alternatively, use Secrets Manager's versioning with conditional writes to ensure atomicity. Minimum fix: add ClientRequestToken to put_secret_value calls to prevent duplicate writes on retry.

### M10. Unbounded file download without size limit leads to memory exhaustion DoS

- **File:** `lambdas/python/structured-data-query/lambda_function.py:226-227`
- **Category:** resource-leak · **Confidence:** high · **Partition:** py-sql-data
- **What's wrong:** The download_url_to_tmp function calls urllib.request.urlopen().read() without any size limit or streaming mechanism. An attacker can craft a URL that streams infinite data or returns a multi-gigabyte file, causing the Lambda to consume unbounded memory and crash.
- **Impact:** Production DoS: A malicious user provides a URL that streams infinite data (e.g., /dev/urandom over HTTP). The Lambda reads the entire response into memory at line 227, exhausting available memory and crashing all concurrent invocations.
- **Verifier reasoning:** The vulnerability IS real. At lines 226-227 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/structured-data-query/lambda_function.py, the `download_url_to_tmp()` function calls `urllib.request.urlopen(request, timeout=30)` followed by `response.read()` with NO size limits, chunking, or Content-Length validation. The URL is user-controlled (passed as `csv_url` in the request body at line 759), making this reachable. An attacker can provide a URL serving multi-gigabyte or infinite data, causing the Lambda to either exhaust its 2048 MB memory (configured at line 52 of structured-data-query-construct.ts) or exceed its 512 MB `/tmp` storage limit, resulting in MemoryError or IOError on that invocation. However, the severity is mitigated by: (1) AWS Lambda's hard memory limit of 2048 MB prevents truly unbounded consumption, (2) the 120-second function timeout will eventually terminate the operation, and (3) exception handling at line 792 catches the error and returns a 500 response rather than crashing the container. The actual impact is per-invocation DoS (individual requests fail), not production-wide DoS. Recommended fix: add explicit size limits to `response.read()` using Content-Length header validation or streaming downloads with maximum file size enforcement (e.g., read in chunks, enforce 100-500 MB max).
- **Suggested fix:** Add size validation and chunked downloads in download_url_to_tmp() function:

```python
def download_url_to_tmp(url: str, max_size_bytes: int = 100 * 1024 * 1024) -> str:  # 100MB limit
    request = urllib.request.Request(url, headers={"User-Agent": "Numa/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        # Validate Content-Length header
        content_length = response.headers.get('Content-Length')
        if content_length:
            try:
                if int(content_length) > max_size_bytes:
                    raise ValueError(f"File too large: {content_length} bytes exceeds {max_size_bytes} limit")
            except (ValueError, TypeError):
                pass

        # Read in chunks with size enforcement
        data = b''
        chunk_size = 8192
        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break
            data += chunk
            if len(data) > max_size_bytes:
                raise ValueError(f"Download exceeded {max_size_bytes} byte limit")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as tmp_file:
        tmp_file.write(data)
        return tmp_file.name
```

### M11. Stack trace and exception details exposed in API responses

- **File:** `lambdas/python/structured-data-query/lambda_function.py:794`
- **Category:** security · **Confidence:** high · **Partition:** py-sql-data
- **What's wrong:** Error responses include the full traceback via traceback.format_exc(), which may expose internal code paths, file paths, database connection strings, or other sensitive information to API clients.
- **Impact:** Information disclosure: An attacker triggers an error (e.g., malformed request) and receives the full Python stack trace, revealing code structure, library versions, and potentially credentials or connection details if logged in exception context.
- **Verifier reasoning:** The code at line 794 in handle_investigate explicitly captures the full Python traceback via traceback.format_exc() and passes it directly to create_error_response() as the details parameter. The create_error_response() function (lines 180-191) unconditionally includes this details field in the JSON response body returned to API clients when details is non-empty. This means any unhandled exception during CSV processing, file download, or agent loop execution will expose the full stack trace to the client, potentially revealing: internal file paths (/tmp locations, S3 paths), library versions, code structure, AWS service details, and potentially sensitive context from exception messages. The vulnerability is reachable because handle_investigate performs multiple external operations (S3/HTTP download at lines 757-759, CSV parsing at line 765, LLM invocation at line 777) that can legitimately fail and trigger the exception handler. There is no input validation, sanitization, or filtering of the traceback before it's returned to clients. Contrast this with lambda_handler at line 838, which only passes str(e) without the full traceback, demonstrating that the codebase is aware of this risk pattern but inconsistently applied it.
- **Suggested fix:** Remove traceback.format_exc() from the client-facing response. Instead, log the full traceback server-side (to CloudWatch) and return only a generic error message to the client:

```python
except Exception as e:
    traceback.print_exc()
    # Log details server-side for debugging
    print(f"ERROR_DETAILS: {traceback.format_exc()}")
    # Return generic error to client (no traceback)
    return create_error_response(500, str(e))
```

Or modify create_error_response() to accept a flag controlling whether details are included in the response:

```python
def create_error_response(
    status_code: int, error: str, details: Optional[str] = None, expose_details: bool = False
) -> Dict[str, Any]:
    print(f"ERROR: {error} - Details: {details}")
    body: Dict[str, Any] = {"error": error, "status": "error"}
    if expose_details and details:
        body["details"] = details
    return create_response(status_code, body)
```

Then at line 794: `return create_error_response(500, str(e), traceback.format_exc(), expose_details=False)`

### M12. Query results silently included in debug iterations expose raw data

- **File:** `lambdas/python/structured-data-query/lambda_function.py:667, 788`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-sql-data
- **What's wrong:** When body.get('debug') is True, the entire iterations array (containing step_record['result'] at line 667) is returned in the API response. This bypasses any data sensitivity controls and exposes raw query results from all agent reasoning steps, even if they were meant to be intermediate/internal.
- **Impact:** Data leakage: A user sets debug=True in the request, and the response includes iterations with step_record['result'] containing raw CSV data from all intermediate SQL queries. A multi-row result set (up to AGENT_SQL_LIMIT=100 rows) is exposed per iteration, multiplied by up to 15 iterations, exposing potentially sensitive PII or financial data.
- **Verifier reasoning:** The bug is REAL but the claim about "bypassing data sensitivity controls" is misleading. Reading the actual code at line 667, 688-689, and 787-788 confirms:

1. Line 667 stores raw query results in step_record["result"]: `step_record["result"] = results`
2. Lines 688-689 return iterations from run_agent_loop (containing step_record)
3. Line 788 includes iterations in the response when debug=True: `payload["iterations"] = result.get("iterations", [])`

HOWEVER, the normal (non-debug) response at line 783 ALREADY includes raw results: `"data": result.get("data")` which comes from the last query execution. So raw query results ARE exposed in the standard API response.

The debug flag doesn't "bypass" controls—there are no pre-existing sensitivity controls in this handler. What it does is expose multiple iterations' results instead of just the latest one. Each iteration can contain up to 100 rows (AGENT_SQL_LIMIT), and there can be up to 15 iterations (AGENT_MAX_STEPS), so theoretical exposure is larger.

The claim conflates "debug mode exposes more data than normal mode" with "debug mode bypasses security." The actual issue is: both modes expose raw data, and there's no authentication visible in handle_investigate(). But the specific claim about iterations including step_record["result"] is factually correct.

Severity: MEDIUM because (1) raw data is already exposed in non-debug mode, (2) no visible auth controls in this handler, (3) requires explicit debug=true flag, (4) exposes potentially sensitive data like PII/financial data per CSV.

- **Suggested fix:** Implement one or both of these fixes:

1. SANITIZE iterations for debug mode - Remove the "result" field from step_records before returning iterations:

```python
if body.get("debug"):
    sanitized_iterations = []
    for iteration in result.get("iterations", []):
        sanitized = {k: v for k, v in iteration.items() if k != "result"}
        sanitized_iterations.append(sanitized)
    payload["iterations"] = sanitized_iterations
```

2. ADD AUTHENTICATION - Require an authorization header or API key before allowing debug=True requests (implement upstream in API Gateway or in this handler).

3. DOCUMENT WARNING - Add explicit warnings in logs/docs that debug mode exposes full query results, and recommend restricting to admin/dev use only.

### M13. Month aggregate monetary inconsistency: credit_revenue_usd and credits_charged don't reconcile

- **File:** `lambdas/python/credit-debit/lambda_function.py:403-405`
- **Category:** data-loss · **Confidence:** high · **Partition:** py-credits-cost
- **What's wrong:** The month_aggregate_item is constructed with credit_revenue_usd calculated from un-rounded total_credits, while credits_charged is rounded to 4 decimal places. This violates the accounting invariant that credit_revenue_usd should equal credits_charged \* credit_usd, causing reconciliation discrepancies and potential loss of tracked revenue in monthly reports.
- **Impact:** Monthly billing reconciliation reports will show credit_revenue_usd that doesn't match credits_charged _ CREDIT_USD per client. For example: if total_credits=10.123456 and eff_credit=$0.30, then credit_revenue_usd=round(3.0370368, 6)=3.037037 but credits_charged=round(10.123456, 4)=10.1235, and 10.1235 _ 0.30 = 3.03705 ≠ 3.037037. Auditors reviewing monthly statements will find unexplained discrepancies between revenue and credits.
- **Verifier reasoning:** The bug is real. In `/Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/credit-debit/lambda_function.py` lines 403-405, the month aggregate is constructed with:
- `credit_revenue_usd=round(total_credits * eff_credit, 6)` (un-rounded total_credits multiplied first, then rounded to 6 decimals)
- `credits_charged=round(total_credits, 4)` (rounded separately to 4 decimals)

This violates the accounting invariant that `credit_revenue_usd` should equal `credits_charged * eff_credit`. When you round total_credits to 4 decimals separately, then multiply by eff_credit, you get a different result than multiplying the full precision total_credits by eff_credit and rounding. For example: total_credits=10.123456, eff_credit=0.30 yields credit_revenue_usd=round(3.0370368,6)=3.037037, but round(10.123456,4)*0.30=10.1235*0.30=3.03705. The `month_aggregate_item` docstring in `/Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/credit-pricing/credit_pricing/ledger.py` line 207 explicitly states that creditsCharged should be 'the exact credit count consumed this month', implying it should represent the true sum without lossy rounding that breaks reconciliation. The per-conversation credits_charged values come from `floor_credits()` (line 57 of credits.py) which returns an integer, so their sum should be a whole number—the 4-decimal rounding is unnecessary and breaks the invariant. The fix is to compute credits_charged first (as a whole number), then derive credit_revenue_usd from it: `credits_charged=int(total_credits); credit_revenue_usd=round(credits_charged * eff_credit, 6)` OR ensure both use the same rounded precision in the same order of operations."

- **Suggested fix:** Change lines 403-405 in `/Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/credit-debit/lambda_function.py` from:

```python
credit_revenue_usd=round(total_credits * eff_credit, 6),
consumption_cost_usd=round(total_cons, 6),
credits_charged=round(total_credits, 4),
```

To:

```python
credits_charged=int(round(total_credits)),
credit_revenue_usd=round(int(round(total_credits)) * eff_credit, 6),
consumption_cost_usd=round(total_cons, 6),
```

This ensures the accounting invariant holds: credit_revenue_usd is always derived from credits_charged \* eff_credit, maintaining reconciliation consistency.

### M14. Missing validation of credit configuration: invalid margins or allocations silently default

- **File:** `lambdas/python/credit-debit/lambda_function.py:222-239`
- **Category:** logic · **Confidence:** high · **Partition:** py-credits-cost
- **What's wrong:** When reading marginsByTier from CONFIG, the code updates eff_margins by unpacking a dict from the config. If cfg['marginsByTier'] contains invalid keys (not in the VALID_TIERS list) or invalid values, they are silently skipped without validation. Similarly, if monthlyAllocations is provided but len() != 12, it silently defaults to the DEFAULT_MONTHLY_ALLOCATION without logging or alerting. Misconfiguration in the admin panel can go undetected.
- **Impact:** If an admin accidentally configures monthlyAllocations with 11 items instead of 12, the system silently falls back to the default 2000-credit plan for all months, potentially overallocating or underallocating credits without any audit trail. For margins, if an admin sets invalid tier names (typos), those entries are silently dropped, leaving affected tiers at the scalar margin instead of the configured per-tier margin.
- **Verifier reasoning:** This is a real bug. The Python credit-debit lambda (lambda_function.py:222-239) lacks validation of credit configuration inputs without error logging.

MARGINSBYTIER: Line 224 does `eff_margins.update({k: float(v) for k, v in cfg["marginsByTier"].items()})`. This accepts invalid tier keys (e.g., typos like "typo_low") without validation. While the code only accesses valid tier names when looking up margins (line 220: `(margins or {}).get(value_tier or "", margin)`), the claim is technically misleading—invalid keys aren't "skipped," they're silently added to the dict and never used. However, the core issue stands: no validation occurs.

MONTHLYALLOCATIONS (REAL PROBLEM): Line 235-238 checks `len(raw_alloc) == 12` but silently defaults to 2000-credit-all-months without any logging, warning, or error. The Customer Success Portal's Zod schema (types/index.ts:218) validates only `z.array(z.number().min(0)).optional()`, NOT that length must be 12. Therefore:

- An admin could provide 11 or 13 items through the CSP API
- The frontend has client-side guards (NumaCredits.tsx:60 checks length==12), but server-side validation is absent
- The lambda silently falls back to defaults without audit trail (lines 235-238)
- This is confirmed by line 396-398 bounds checking `0 <= month_idx < 12`, which shows the code _expects_ the possibility of invalid length

The lack of logging/alerting is the critical gap. The scenario in the claim is plausible: an admin misconfigures monthlyAllocations, it silently defaults without trace in logs, causing potential under/over-allocation of credits undetected.

The marginsByTier issue is lower severity (invalid keys cause no harm since they're never accessed), but monthlyAllocations misconfiguration can directly affect billing behavior without audit trail.

- **Suggested fix:** Add validation with error logging in lambda_function.py:

1. For marginsByTier (lines 222-224): Filter to only VALID_TIERS and log discarded keys:

```python
if isinstance(cfg.get("marginsByTier"), dict):
    stored = cfg["marginsByTier"]
    invalid_keys = [k for k in stored.keys() if k not in VALID_TIERS]
    if invalid_keys:
        logger.warning("marginsByTier has invalid tier keys; discarding", _name="CREDIT_DEBIT_CONFIG", invalid_keys=invalid_keys)
    eff_margins.update({k: float(v) for k, v in stored.items() if k in VALID_TIERS})
```

2. For monthlyAllocations (lines 234-239): Validate length and log when defaulting:

```python
raw_alloc = cfg.get("monthlyAllocations")
if isinstance(raw_alloc, list) and len(raw_alloc) == 12:
    eff_allocations = [float(x) for x in raw_alloc]
else:
    if raw_alloc is not None and not isinstance(raw_alloc, list):
        logger.warning("monthlyAllocations is not a list; using defaults", _name="CREDIT_DEBIT_CONFIG", raw_alloc_type=type(raw_alloc).__name__)
    elif isinstance(raw_alloc, list) and len(raw_alloc) != 12:
        logger.warning("monthlyAllocations length mismatch; using defaults", _name="CREDIT_DEBIT_CONFIG", provided_length=len(raw_alloc))
    eff_allocations = [float(DEFAULT_MONTHLY_ALLOCATION)] * 12
```

3. (UPSTREAM) Update Customer Success Portal types/index.ts (line 218) to enforce length:

```typescript
monthlyAllocations: z.array(z.number().min(0)).length(12).optional(),
```

### M15. Redundant S3 read operation in policy-builder-legal-review

- **File:** `lambdas/python/policy-builder-legal-review/lambda_function.py:50-51, 97-98`
- **Category:** resource-leak · **Confidence:** high · **Partition:** py-policy-apps
- **What's wrong:** board_assurance_statement is read from S3 twice - once at line 50-51 and again at line 97-98. The first read result is never used in the second model.run() call, it reads the same file again.
- **Impact:** Wasted S3 API call and network latency. On high-volume workloads, this doubles the S3 read cost for this file and increases lambda execution time.
- **Verifier reasoning:** The code reads `board_assurance_statement` from S3 at lines 50-52 and uses it in the first model.run() call at line 66-82. Then at lines 97-99, it reads the exact same file from S3 again without any modification to the variable or the file path. The variable is still in memory and in scope after the first use. This is a genuine redundant S3 get_object API call that wastes network bandwidth and API quota. The fix is to delete lines 97-99 and reuse the value read at line 50-52 in the second model.run() call at line 111.
- **Suggested fix:** Delete lines 97-99. The `board_assurance_statement` variable read at lines 50-52 is still in scope and unchanged, so it can be directly reused in the second model.run() call at line 109-120 without re-reading from S3.

### M16. Missing type validation before string operations in financial-analysis-data-extraction

- **File:** `lambdas/python/financial-analysis-data-extraction/lambda_function.py:60-63`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-analysis-apps
- **What's wrong:** The code checks if data is a list and returns early, but if data is anything other than a list, it assumes data is a string and calls .replace() on it. If the Bedrock model returns a non-string non-list type (None, dict, int, etc.), this will raise AttributeError.
- **Impact:** If the Bedrock model returns unexpected output format (e.g., due to a model update or malformed tool response), the Lambda will crash with an unhandled AttributeError, causing the financial data extraction job to fail without graceful fallback.
- **Verifier reasoning:** The code at lines 60-63 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/financial-analysis-data-extraction/lambda_function.py checks if `data` is a list and returns early, but otherwise assumes `data` is a string and calls `.replace()` on it without validation. The `data` variable is extracted at line 58 from `model.run(prompt).response[0]["input"]["data"]` with no upstream type validation or exception handling around this extraction. Looking at the bedrock module and the test case, the model returns either: (1) a JSON-serialized string that needs deserialization, or (2) a list. However, there is no isinstance(str) check before calling .replace() at line 63. If the Bedrock model returns any other type (None, dict, int, bool, etc.) due to misconfiguration, model updates, or malformed responses, this will raise an unhandled AttributeError since those types don't have a .replace() method. While unlikely in normal operation due to Claude's reliability with tool schemas, this is a real defensive programming issue—the code should validate the type before assuming string methods are available. The bug is technically real and reachable if Bedrock returns unexpected output.
- **Suggested fix:** Add type validation before the .replace() call:

```python
if isinstance(data, list):
    return data

if not isinstance(data, str):
    raise TypeError(f"Expected data to be list or str, got {type(data).__name__}")

return json.loads(data.replace("<UNKNOWN>", '"unknown"'))
```

Or use a more explicit if-else:

```python
if isinstance(data, list):
    return data
elif isinstance(data, str):
    return json.loads(data.replace("<UNKNOWN>", '"unknown"'))
else:
    raise TypeError(f"Unexpected data type from model: {type(data).__name__} = {data}")
```

### M17. Placeholder error message masks actual parsing failures - silent data degradation

- **File:** `lambdas/python/rfp-response-comparison/lambda_function.py:42-46`
- **Category:** error-handling · **Confidence:** high · **Partition:** py-assessment-apps
- **What's wrong:** When an exception occurs during response processing (JSON parsing, page extraction, S3 read failure), the exception is caught and a placeholder message 'Error processing response' is appended instead of the actual response content. The error is logged but the comparison still proceeds with this placeholder, potentially masking missing or corrupted data.
- **Impact:** If an RFP response fails to parse correctly, the LLM receives a placeholder 'Error processing response' string instead of actual content, leading to incomplete comparisons. The fact that data was missing/failed is hidden from the downstream result format (marked as Response N but with error placeholder). Users may not realize the comparison is incomplete.
- **Verifier reasoning:** The bug is REAL. Located at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/rfp-response-comparison/lambda_function.py lines 31-46. When an exception occurs during S3 read (line 33) or JSON parsing (line 35), the code catches it and appends a placeholder message 'Error processing response' (lines 44-45) instead of failing or properly indicating data loss. This causes the LLM to receive incomplete/masked error information while the comparison proceeds. The flow is: (1) extracted_keys point to JSON files from the extract Lambda; (2) RFP lambda reads and parses each; (3) if parsing fails (malformed JSON, S3 corruption, decode error), it's caught silently; (4) placeholder appended; (5) comparison runs with missing data. The error is logged but the downstream output format doesn't indicate data was lost. This is a real error-handling gap because: S3 read can fail due to transient errors or corruption, and JSON parsing can fail if the extract Lambda produced malformed output or if data is corrupted. Severity is medium because: data integrity is compromised, but the system doesn't crash—it silently degrades. Appropriate fix: raise the exception to fail the step function (letting infrastructure handle retries), or include detailed error context in the response so the LLM is aware data is missing.
- **Suggested fix:** In lambda_function.py lines 31-46, instead of catching and masking the exception with a placeholder, either: (1) Let the exception propagate to fail the Lambda (recommended—lets Step Functions retry), or (2) If continuing is necessary, include the actual error in the response and mark it clearly, e.g., responses_text.append(f'--- Response {idx+1} ---\\nFAILED: {str(e)}\\nActual content unavailable') so the LLM is explicitly aware of the data loss.

### M18. Silent error in council references join creates malformed separator when list is empty

- **File:** `lambdas/python/council-resource-consents/lambda_function.py:44-48`
- **Category:** logic · **Confidence:** high · **Partition:** py-assessment-apps
- **What's wrong:** The council_references join uses a multi-line separator string. If extract_document_text fails and returns empty strings (which are filtered out), and if ALL council documents fail to parse, council_references_content will be an empty list. Joining an empty list with a separator returns empty string, but the key is still added to input_data as 'council_references': '' (empty string). The prompt template then contains an empty council references section, which may cause the LLM to misunderstand the analysis context.
- **Impact:** If all council reference documents fail to parse (due to S3 errors, JSON errors, or corruption), the analysis receives empty council_references field. The LLM may misinterpret this as 'no council references provided' rather than 'council references failed to load'. This could lead to incomplete legal compliance analysis.
- **Verifier reasoning:** The bug is REAL and reachable. Code analysis confirms: (1) extract_document_text() at lines 85-98 silently returns empty string on any exception (S3 errors, JSON parse failures, corruption) with NO logging; (2) lines 32-35 filter out empty strings from the loop with 'if document_text:' check without logging failures; (3) lines 44-48 use .join() on the potentially empty council_references_content list, which produces empty string when the list is empty (verified by test); (4) this empty string is passed to the LLM in the prompt at line 119 via format(\*\*input_data); (5) there is no validation that at least one council reference was successfully extracted, no error raised, and no user warning. The prompt template (prompts.py line 17) expects council_references content but receives empty string, creating ambiguity for the LLM about whether references were provided vs. failed to load. The manifest requires at least one council reference file to be uploaded (construct.ts line 35), so users expect these to be analyzed. If all fail silently, the analysis proceeds with missing critical data. This fits the definition of a silent error in logic that can degrade output quality. The severity is medium (not critical) because: it doesn't crash the system, but it does produce incomplete legal analysis which could have business impact for resource consent decisions."
- **Suggested fix:** Add validation after line 35 to check if council_references_content is empty, and either: (1) raise an exception with descriptive error message, or (2) add a placeholder message to council_references like '[ERROR: All council reference documents failed to extract. This analysis is incomplete.]' so the LLM is explicitly aware of the failure. Additionally, add logging at line 98 when extract_document_text fails, so failures are visible in CloudWatch logs for debugging."

### M19. Missing CORS headers in error responses breaks API contract

- **File:** `lambdas/python/numa-recent-jobs/get_job.py:47`
- **Category:** api-contract · **Confidence:** high · **Partition:** py-system
- **What's wrong:** The exception handler on line 47 returns a response without CORS headers, while all other success/error paths include the headers dict. This inconsistency breaks the API contract and causes CORS failures in browser-based clients when exceptions occur.
- **Impact:** When an unexpected exception occurs (e.g. DynamoDB service error), the response lacks Access-Control-Allow-Origin headers. Browser clients will reject this response, making the error inaccessible to frontend code and appearing as a network error rather than a handled API error.
- **Verifier reasoning:** The code at line 47 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/numa-recent-jobs/get_job.py unambiguously demonstrates the bug. The exception handler returns a response object missing the "headers" key, while all other return paths (lines 25-29, 35-39, 41-45) include "headers": headers. The exception path is reachable—any exception from DynamoDB operations (lines 19, 31) or elsewhere in the try block will trigger line 47. There is no guard preventing this. This is a genuine API contract violation: responses without CORS headers will fail in browser clients, breaking the symmetric error handling contract where all responses should include the same CORS headers.
- **Suggested fix:** Add `"headers": headers` to the exception handler response on line 47. Change from: `return {"statusCode": 500, "body": json.dumps({"error": str(e)})}` to: `return {"statusCode": 500, "body": json.dumps({"error": str(e)}), "headers": headers}`

### M20. Missing CORS headers in error response in update_job breaks API contract

- **File:** `lambdas/python/numa-recent-jobs/update_job.py:80`
- **Category:** api-contract · **Confidence:** high · **Partition:** py-system
- **What's wrong:** The exception handler returns a response without CORS headers, inconsistent with other response paths. This breaks browser-based clients that expect CORS headers in all responses.
- **Impact:** When an unexpected exception occurs during job update, the response lacks Access-Control-Allow-Origin headers, causing browser clients to reject it. Users see generic network errors instead of the actual API error.
- **Verifier reasoning:** The bug is real. Line 80 returns an exception response without the "headers" key that is present in all other response paths (lines 36, 63, 77). The exception handler catches multiple reachable failure scenarios (malformed events, invalid JSON in body, DynamoDB errors) and returns a response missing CORS headers. This is an actual API contract violation — browsers will reject the error response due to missing Access-Control-Allow-Origin header, causing clients to see a generic network error instead of the actual API error message. The fix is to add "headers": headers to the line 80 return statement. Severity is medium because it only affects error paths and non-browser clients will still work, but it does break the API contract for browser-based clients.
- **Suggested fix:** Change line 80 from:
  return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
  to:
  return {"statusCode": 500, "body": json.dumps({"error": str(e)}), "headers": headers}

### M21. URL normalization logging uses wrong variable

- **File:** `lambdas/python/browser-lambda/lambda_function.py:1160-1165`
- **Category:** logic · **Confidence:** high · **Partition:** py-browser-web
- **What's wrong:** The logger.info call logs both original_url and normalized_url but uses the same variable 'url' for both, since url is reassigned before logging. The original_url parameter receives the normalized value, making the log misleading.
- **Impact:** Debugging and auditing become difficult as the 'original_url' logged is actually the normalized URL, not the user input. This breaks log-based tracing of input validation.
- **Verifier reasoning:** The bug is real and reachable. At line 1162, the url variable is reassigned to the normalized value: url = f"https://{url.lstrip('/')}". Immediately after at lines 1163-1165, the logger.info call uses original_url=url and normalized_url=url, but both parameters now reference the same normalized value because url was just reassigned. The original user input is lost. This is not guarded by any condition and occurs for any URL without http:// or https:// prefix. The impact is substantial for debugging and auditing—the log claim is "URL normalized" but shows the normalized URL twice, making it impossible to trace the original user input from logs. Severity upgraded from claimed "low" to "medium" because observability/auditability breakage affects debugging of user issues.
- **Suggested fix:** Store the original URL before reassignment: if not url.startswith(("http://", "https://")): original_url = url; url = f"https://{url.lstrip('/')}"; logger.info("URL normalized with https:// prefix", original_url=original_url, normalized_url=url)

### M22. Query Limit Not Enforced in load_v1_conversation_history

- **File:** `services/numa-workspace-agent/numa_workspace_agent/dynamo.py:245`
- **Category:** logic · **Confidence:** high · **Partition:** ws-workspace-s3
- **What's wrong:** The query() call has no Limit parameter, so it attempts to fetch all items (or up to 1MB) without respecting the max_messages parameter. The function then slices items[-max_messages:] after the fact, but this doesn't prevent excessive data transfer from DynamoDB or OOM in intermediate processing.
- **Impact:** For conversations with thousands of messages, fetching all items when only max_messages are needed wastes bandwidth and processing. If conversation has 10k messages but max_messages=50, the code fetches all 10k (or 1MB of them), processes them, then discards 9950, wasting resources.
- **Verifier reasoning:** The bug is REAL and confirmed by code inspection. In /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/dynamo.py at lines 236-246, the `load_v1_conversation_history()` function calls `client.query()` WITHOUT a `Limit` parameter. This causes it to fetch up to 1MB of items from DynamoDB (which could be thousands of messages), then discards all but the last `max_messages` (default 50) with slicing on line 259: `items[-max_messages:]`.

Evidence from code:

- Line 212: Function signature has `max_messages: int = 50`
- Lines 236-246: Query call contains NO `Limit` parameter (missing entirely)
- Line 245: Only has `ScanIndexForward=True`
- Line 259: Slicing happens AFTER fetch: `for item in items[-max_messages:]`
- Contrast: All other three query() calls in the same file (lines 64-74, 165-175, 338-348) DO include `Limit=1` when they only need one record

This is inefficient because for a conversation with thousands of messages, it transfers all 1MB of unnecessary data from DynamoDB through the network and into Python memory before discarding most of it. For V1 migration (the use case at lines 1-310), this only runs on legacy conversations during migration, but the pattern is still wasteful.

SEVERITY ASSESSMENT: Medium (not critical) because:

- Only affects V1 legacy conversation migration path (not active conversations)
- 1MB per-query is DynamoDB's natural page boundary, so transfer is bounded
- Not a data corruption or security bug
- But it DOES waste bandwidth and processing for large legacy conversations
- **Suggested fix:** Add `Limit=max_messages` to the query call in load_v1_conversation_history(). Change lines 236-246 from:

```python
query_response = client.query(
    TableName=DYNAMODB_TABLE_NAME,
    KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
    FilterExpression="message_type <> :meta",
    ExpressionAttributeValues={
        ":u": {"S": user_sub},
        ":c": {"S": f"{conversation_id}#"},
        ":meta": {"S": "meta"},
    },
    ScanIndexForward=True,  # Sort ascending by timestamp
)
```

To:

```python
query_response = client.query(
    TableName=DYNAMODB_TABLE_NAME,
    KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
    FilterExpression="message_type <> :meta",
    ExpressionAttributeValues={
        ":u": {"S": user_sub},
        ":c": {"S": f"{conversation_id}#"},
        ":meta": {"S": "meta"},
    },
    ScanIndexForward=True,  # Sort ascending by timestamp
    Limit=max_messages,
)
```

This prevents DynamoDB from returning more items than needed and eliminates the wasted bandwidth/processing of discarding 95%+ of fetched items in large conversations.

### M23. Environment variable mutation in list response handling

- **File:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/lambda_client.py:287`
- **Category:** logic · **Confidence:** high · **Partition:** ws-mcp-tools
- **What's wrong:** The invoke_workspace_tool function attempts to parse NUMA_ENABLED_TOOLS via json.loads() at line 287 without a try-except. If the JSON is malformed, json.JSONDecodeError is raised and not caught, causing the Lambda invocation to fail. However, this is inside the event construction, so the error happens AFTER the logger.info call (line 282-289), making diagnostics harder.
- **Impact:** If NUMA_ENABLED_TOOLS environment variable is corrupted (malformed JSON), all workspace tool invocations fail with a JSONDecodeError rather than a more informative error. The failure is not graceful and does not fall back to an empty list.
- **Verifier reasoning:** The bug is real but with clarifications. Reading /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/mcp_tools/lambda_client.py lines 281-302:

1. Line 281 reads: `_enabled_tools_raw = os.environ.get("NUMA_ENABLED_TOOLS", "[]")` with a safe default "[]".

2. Line 287 (within logger.info call) contains: `json.loads(_enabled_tools_raw)` without try-except.

3. Line 294 (in event dict construction) contains: `json.loads(os.environ.get("NUMA_ENABLED_TOOLS", "[]"))` without try-except.

If NUMA_ENABLED_TOOLS is set to malformed JSON (e.g., "[invalid]"), json.JSONDecodeError is raised at line 287 (during the logger.info call itself). The claim incorrectly stated the error happens after the logger call, but line 287 is part of the logger.info expression — it will fail during that call.

The bug is real: malformed JSON in NUMA_ENABLED_TOOLS causes unhandled JSONDecodeError. However, the severity is medium (not critical) because: (1) it requires explicit misconfiguration of the env var, (2) defaults are safe, and (3) the error message would still indicate the parse failure, even if not gracefully handled.

- **Suggested fix:** Wrap both json.loads() calls (lines 287 and 294) in try-except blocks. Example fix for line 287:

```python
try:
    parsed = json.loads(_enabled_tools_raw)
except json.JSONDecodeError:
    logger.error("Invalid JSON in NUMA_ENABLED_TOOLS env var", raw_value=_enabled_tools_raw)
    parsed = []
```

And similarly for line 294:

```python
try:
    allowed_tools = json.loads(os.environ.get("NUMA_ENABLED_TOOLS", "[]"))
except json.JSONDecodeError:
    allowed_tools = []
```

This allows graceful fallback to empty list and better diagnostics.

### M24. Idempotency violation: S3 object deletion without failure handling

- **File:** `services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_tool.py:714`
- **Category:** idempotency · **Confidence:** high · **Partition:** ws-mcp-tools
- **What's wrong:** The delete_object call on line 714 is wrapped in a try-except that swallows all ClientError exceptions (line 718). This is correct for the case where the object doesn't exist. However, if the delete fails due to permissions, throttling, or transient errors, the exception is silently ignored and polling proceeds anyway. If the Lambda retry policy causes this entire function to be retried, it will delete the correct S3 object on the first try, then on retry (if Lambda retries), the object won't exist to delete, causing no-op—but the subsequent polling will fail to find the (correctly deleted) stale output. This is NOT idempotent from the model's perspective: the first attempt and the retry behave differently.
- **Impact:** If AWS throttles the S3 delete, the code silently ignores it, proceeds to poll S3, and times out waiting for a result. On user retry (explicit re-invocation), the stale result might be found, causing the model to use old transcription data. Idempotency is violated: same input, different output depending on retry timing.
- **Verifier reasoning:** The bug is REAL but with important caveats. Analysis:

WHAT THE CODE DOES (lines 713-719): Calls s3_client.delete_object() and catches all ClientError exceptions, logging "Didn't exist, that's fine". However, AWS S3's delete_object() is idempotent and NEVER throws an error if the object doesn't exist - it returns HTTP 204 success regardless. Therefore, ANY ClientError caught here represents a REAL S3 failure: access denied, throttling, service error, or network failure.

THE ACTUAL BUG: If delete_object fails (permissions, throttling), the exception is silently swallowed. The code proceeds to invoke the async transcription Lambda (line 728) and immediately begins polling S3 (line 742). If a stale output file from a previous failed attempt exists, the polling will find that stale object instead of waiting for the new transcription. This causes the function to return old/incorrect transcription data.

WHY IT'S REAL:

1. The code explicitly catches and ignores ClientError without checking error type
2. If S3 delete fails due to permissions/throttling, that's a real error that should not be silently ignored
3. Polling will find a stale object if deletion failed, returning incorrect data
4. The function is supposed to delete stale output BEFORE invoking the async Lambda - if that delete fails, the entire precondition fails

WHY SEVERITY IS MEDIUM (not HIGH/CRITICAL):

1. S3 permission errors would be systematic (all transcriptions fail, not just retries)
2. Requires specific conditions: stale object must exist from a previous failed attempt
3. The failure mode is returning stale data (bad but detectable by the model if timestamps/content differ)
4. Throttling errors are transient; on user retry, usually succeeds
5. Not a complete data loss scenario

CONCRETE FIX: Replace lines 713-719 with one of:

- Remove try-except entirely (delete is truly idempotent)
- Or: catch and LOG the error but DON'T swallow it - let it propagate so caller knows deletion failed
- Or: check error response, but note: delete_object won't throw NoSuchKey errors even if object doesn't exist

Code read: /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/mcp_tools/numa_tool.py lines 711-767 and supporting S3 helper code showing head_object correctly handles 404 errors (lines 77-81 in s3_helpers.py)."

- **Suggested fix:** Replace the bare try-except at lines 713-719 with explicit error handling that distinguishes between actual failures and the idempotent success case:

```python
try:
    s3_client.delete_object(Bucket=outputs_bucket, Key=output_s3_key)
    logger.info(
        "Deleted stale output before async transcription", key=output_s3_key
    )
except ClientError as e:
    # delete_object is idempotent and never fails for non-existent objects.
    # Any ClientError here is a real problem (permissions, throttling, etc.).
    # Don't silently ignore it - the precondition for polling (clean S3 state) failed.
    logger.error(
        "Failed to delete stale output; polling may return old data",
        key=output_s3_key,
        error=str(e),
    )
    # Either: raise to fail the operation, or continue with warning.
    # Current code continues silently, which is the bug.
```

Or simplest: remove the try-except entirely since delete_object is guaranteed idempotent.

### M25. Substring matching in bash command checker blocks legitimate file names

- **File:** `services/numa-workspace-agent/numa_workspace_agent/hooks/security.py:679`
- **Category:** logic · **Confidence:** high · **Partition:** ws-security
- **What's wrong:** Line 679 checks `if pattern in command` for BLOCKED_FILE_PATTERNS like '.env', which will match any command containing '.env' as a substring, including commands that reference files like '.environment.json' or '.envisioned'.
- **Impact:** Legitimate commands like `cat /workdir/.environment.json` would be incorrectly blocked because the command string contains '.env' as a substring in '.environment'. Users cannot work with files whose names contain the patterns.
- **Verifier reasoning:** The bug is confirmed real through both code analysis and runtime testing. Lines 677-679 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/services/numa-workspace-agent/numa_workspace_agent/hooks/security.py use `if pattern in command:` for substring matching against BLOCKED_FILE_PATTERNS (".env", ".env.local", ".env.production", ".env.development"). This blocks legitimate commands like `cat /workdir/.environment.json` or `cat /workdir/.envisioned` because they contain ".env" as a substring. Runtime testing confirms that all three commands (.environment.json, .envisioned, .envelope) are incorrectly blocked. The contrast with `is_blocked_path` function (lines 462-465) which correctly uses `filename == pattern or filename.startswith(pattern)` on actual filenames extracted via `os.path.basename()` shows this is a logic error. The code is reachable in the bash execution path (check_bash_command called at line 866 of security_hook).
- **Suggested fix:** Replace lines 677-679 with proper filename extraction and matching:

```python
# Check for blocked file patterns (by actual filename, not substring)
for pattern in BLOCKED_FILE_PATTERNS:
    for token in tokens if 'tokens' in locals() else command.split():
        if token.startswith('/workdir/'):
            filename = os.path.basename(token.rstrip(';|>&()'))
            if filename == pattern or filename.startswith(pattern):
                return True, f"Bash command references blocked file '{pattern}'"
```

Or simpler: Use the shlex-tokenized path already computed in lines 644-668 and apply filename matching logic matching what is_blocked_path does.

### M26. Unchecked null return from merge Lambda result

- **File:** `services/numa-workspace-agent/numa_workspace_agent/agent_types/nolia/workspace_setup.py:726`
- **Category:** error-handling · **Confidence:** high · **Partition:** ws-nolia
- **What's wrong:** The merge_result from \_invoke_extract_lambda() is not validated before calling .get(). If the Lambda returns an error response (with errorMessage), line 785-789 raises RuntimeError, which propagates up and crashes the extraction. However, if the Lambda returns a dict without an 'output_key' field, line 726 silently falls back to the default output_key. This fallback may mask real Lambda failures where output_key is missing due to corruption or partial failure.
- **Impact:** If the merge Lambda partially succeeds but returns a malformed response without 'output_key', the code falls back to the original output_key (line 726), which may not have been written by the Lambda. Downstream code then tries to download a non-existent S3 object, failing silently or returning stale data.
- **Verifier reasoning:** Real but less severe than claimed. Lines 785-789 validate for `errorMessage` but do NOT validate the presence of `output_key` in the merge Lambda response. Line 726 then falls back to the original `output_key` variable without logging or raising an error. If the merge Lambda partially succeeds (returns dict without errorMessage but also without output_key), the code silently continues with a potentially incorrect S3 key. This is validated in lines 771-791 which only raise on errorMessage presence. Line 533 later attempts to download from this key, which will fail—but not at merge time, creating a delayed failure with poor diagnostics. The severity is Medium (insufficient validation/logging) rather than High because (1) this requires the Lambda to both succeed AND omit output_key (unlikely edge case), (2) the failure does eventually manifest during download, and (3) no data corruption occurs—just failure to extract. A fix would be to validate `output_key in merge_result` and raise if absent, or log a warning when falling back.
- **Suggested fix:** Add validation after line 726: `if 'output_key' not in merge_result: raise RuntimeError(f"Merge Lambda did not return output_key (got keys: {list(merge_result.keys())})")` before the return statement. Alternatively, log a warning when using the fallback to aid diagnostics: `if 'output_key' not in merge_result: logger.warning(...); return output_key`

### M27. POST comment increments counter without transactional ordering guarantee

- **File:** `lambdas/node/numa-ops-api/index.ts:1683-1796`
- **Category:** idempotency · **Confidence:** high · **Partition:** node-ops
- **What's wrong:** POST /ops/tickets/{ticketId}/comments creates the comment (line 1683) then asynchronously processes mentions and updates commentCount (lines 1700-1796). If the Lambda fails after creating the comment but before incrementing commentCount, the comment exists but count doesn't reflect it. Idempotent retry will fail at line 1671 (duplicate comment creation) or succeed silently without fixing the count.
- **Impact:** If an invocation fails between comment creation (line 1683) and count increment (line 1785-1792), a retry will either: (1) try to create the same comment again and fail, or (2) create a new comment with a different timestamp/ID, leaving the original comment uncounted. The counter will never catch up because the original comment's timestamp won't match retry timestamps.
- **Verifier reasoning:** The code at lines 1683-1792 does exhibit a real transactional ordering issue, but NOT for the idempotency reasons claimed. The actual bug: (1) Line 1683 creates a comment with `await putItem(commentItem)` where commentItem.SK = `COMMENT#${ts}#${randomUUID()}`. (2) Lines 1700-1796 asynchronously process mentions and increment commentCount in a separate try-catch. (3) NO TRANSACTION wraps these operations. (4) If Lambda fails between putItem and the UpdateCommand (lines 1785-1792), and the client retries, a NEW Lambda invocation will execute. (5) This NEW invocation generates a fresh randomUUID() and new now() timestamp, creating a DIFFERENT comment (different SK) — not a duplicate. (6) The retry's count increment succeeds for the new comment, leaving the original comment uncounted. The claim's specific wording "Idempotent retry will fail at line 1671 (duplicate comment creation)" is INCORRECT because the code doesn't check for duplicates and doesn't reuse the same commentId/timestamp on retry. However, the underlying transactional ordering vulnerability is REAL: a partial failure (comment created, count not incremented) causes data inconsistency, and naive retries compound the problem by creating additional comments instead of fixing the count. Files read: /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/numa-ops-api/index.ts (lines 1661-1800 and helper functions); /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/constructs/ops-construct.ts (confirmed Lambda configuration).
- **Suggested fix:** Wrap the comment creation and count increment in a DynamoDB TransactWriteCommand. Change line 1683 from `await putItem(commentItem)` to include the comment and count increment in a single transaction, and remove the separate UpdateCommand at lines 1785-1792. Example: const transactItems = [{ Put: { TableName: OPS_TABLE, Item: commentItem } }, { Update: { TableName: OPS_TABLE, Key: { PK: ticket.PK, SK: ticket.SK }, UpdateExpression: 'ADD commentCount :inc', ExpressionAttributeValues: { ':inc': 1 } } }]; await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems })); This ensures both operations succeed atomically or both fail, preventing the inconsistent state where a comment exists but is uncounted.

### M28. GET /capabilities endpoint returns configuration without auth check

- **File:** `lambdas/node/admin-capabilities/index.ts:55-62`
- **Category:** logic · **Confidence:** high · **Partition:** node-admin
- **What's wrong:** The GET /capabilities route has no authorization check. Any authenticated user (including non-admins) can read all capability flag statuses. While flag values themselves may not be sensitive, the absence of auth check is a violation of the admin-only principle and exposes system configuration state.
- **Impact:** Non-admin users can enumerate all enabled/disabled capabilities for the deployment. Can detect what features are disabled by admin policy, which may reveal business constraints or defensive postures.
- **Verifier reasoning:** The bug is confirmed by reading the actual code. The GET /capabilities endpoint at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/admin-capabilities/index.ts lines 55-62 has NO admin authorization check (no isAdminFromAuth() call). While the API Gateway route has addAuthorizer: true (requiring a valid JWT), the authorizer at /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/api-gateway-authorizer/index.ts only validates JWT signature and Cognito membership—it does NOT enforce admin-group membership. Any authenticated user can read capability flags. The PUT endpoint correctly enforces admin access via isAdminFromAuth() at line 65-67, creating an inconsistency. This violates admin-only principle and exposes system configuration state to non-privileged users."
- **Suggested fix:** Add admin authorization check to GET handler: Insert `if (!isAdminFromAuth(event)) { return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) }; }` before the DynamoDB scan at line 56 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/admin-capabilities/index.ts

### M29. Missing admin authorization check on GET /settings/integrations

- **File:** `lambdas/node/admin-integration-settings/index.ts:201-212`
- **Category:** logic · **Confidence:** high · **Partition:** node-admin
- **What's wrong:** The GET /settings/integrations endpoint allows any authenticated user to read all integration settings (enable/disable status, denyTools, allowMultipleAccounts). The comment says 'Allow any authenticated user to READ' but integration configuration is typically admin-only.
- **Impact:** Non-admin users can enumerate integration availability and denyTools settings. Low impact if integration list is not sensitive, but violates principle of least privilege. May expose business decisions (e.g., which integrations are disabled).
- **Verifier reasoning:** This is a REAL bug. The claim is accurate. At lines 201-212 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/admin-integration-settings/index.ts, the GET /settings/integrations endpoint explicitly allows any authenticated user to read all integration settings without checking for admin role.

Code evidence: Line 201 comment states "Allow any authenticated user to READ global settings", and lines 202-212 implement a GET handler that scans and returns ALL integration items (status, denyTools, allowMultipleAccounts, preferred_method) WITHOUT calling isAdminFromAuth(event).

In contrast, the PUT handler (lines 215-218) explicitly checks `if (!isAdminFromAuth(event))` and returns 403 Forbidden, proving the pattern is known.

The API Gateway applies a CUSTOM authorizer (api-gateway-authorizer) which validates JWT tokens via Cognito, ensuring only authenticated users can reach the endpoint. However, authenticated does not equal admin — the Cognito JWT can carry a 'cognito:groups' claim that includes 'admin' (line 70 of index.ts checks for this), but the GET handler never validates this group membership.

SEVERITY REASSESSMENT: The claim marks it "low", but this is overstated. Non-admin users can enumerate which integrations are enabled/disabled AND see which tools are denied per integration (denyTools array) AND see whether allowMultipleAccounts is enabled. This reveals business decisions about integration availability and restrictions. While arguably less critical than write access, this violates principle of least privilege and exposes internal integration strategy. Severity should be MEDIUM because: (1) it's a clear authorization bypass pattern, (2) it reads sensitive configuration, and (3) it contradicts the PUT endpoint's admin-gating pattern, suggesting oversight rather than intentional design.

CONCRETE FIX: Add `if (!isAdminFromAuth(event)) return { statusCode: 403, ... }` check at line 202, immediately after the route check and before the DynamoDB scan.

- **Suggested fix:** Add authorization check to the GET /settings/integrations handler. At line 202, add:

```
if (!isAdminFromAuth(event)) {
  return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
}
```

This mirrors the authorization pattern used in the PUT handler at lines 216-218.

### M30. Non-timing-safe comparison of path-based webhook secret

- **File:** `lambdas/node/pipedream-event-receiver/index.ts:235`
- **Category:** security · **Confidence:** high · **Partition:** node-events-notif
- **What's wrong:** Uses non-timing-safe string comparison (`!==`) for validating the path secret. While the primary security boundary is the HMAC signature, this path-level secret comparison is vulnerable to timing attacks.
- **Impact:** Timing attack: An attacker could exploit timing differences in the string comparison to deduce the path secret. Although the HMAC provides the main security, the path secret is documented as defence-in-depth.
- **Verifier reasoning:** The code at line 235 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/pipedream-event-receiver/index.ts uses non-timing-safe string comparison (`pathSecret !== WEBHOOK_SECRET`) for validating the path-based webhook secret. The file imports `timingSafeEqual` (line 30) and uses it correctly for HMAC signature verification (line 148), demonstrating awareness of timing-safe comparison needs. However, the path secret comparison on line 235 does not use `timingSafeEqual`. While the primary security boundary is the HMAC signature (which is properly timing-safe), this path-level secret is explicitly described as defence-in-depth. An attacker could exploit timing differences in the string comparison to gradually deduce the correct path secret through repeated requests. Severity is assessed as medium (not high) because: (1) HMAC validation provides the primary security boundary and is properly timing-safe, (2) the attacker would still need the HMAC key to forge valid requests, but (3) leaking the path secret does weaken the defence-in-depth strategy and violates cryptographic best practices for secret comparison.
- **Suggested fix:** Replace line 235's direct string comparison with timing-safe comparison. After checking if WEBHOOK_SECRET is empty, use crypto.timingSafeEqual() to compare buffers: Check length equality first (to avoid timingSafeEqual throwing), then use timingSafeEqual(Buffer.from(WEBHOOK_SECRET, 'utf8'), Buffer.from(pathSecret, 'utf8')) within a try-catch to safely handle any edge cases.

### M31. OAuth credentials leaked in error logs

- **File:** `lambdas/node/gmail-watch-manager/index.ts:164`
- **Category:** security · **Confidence:** high · **Partition:** node-events-notif
- **What's wrong:** When Gmail OAuth token refresh fails, the error response text from Google's OAuth endpoint is logged in plaintext. This could contain sensitive information or error details that expose system internals.
- **Impact:** Production security incident: If Google's OAuth error response contains any sensitive information (e.g., retry-after headers, rate limit details, or other metadata), it will be stored in CloudWatch logs where it may be accessible to more users than intended.
- **Verifier reasoning:** The code at line 164 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/gmail-watch-manager/index.ts does log the full response body from Google's OAuth endpoint without sanitization: `console.error('Failed to refresh Google token:', await res.text());`. While Google's documented OAuth error responses contain only error codes and descriptions (not credentials), logging unsanitized external API responses violates security best practices and risks exposing unexpected error details, system internals, or information not covered by current API documentation. The same pattern appears again at lines 200-201 in the renewGmailWatch function. This is a real security hygiene issue, though the practical risk is lower than feared because Google's error responses are designed not to leak credentials. Severity is medium (not high) because: (1) the response body from a token refresh failure is unlikely to contain actual tokens/credentials per OAuth2 spec, (2) CloudWatch has access controls, (3) however, defense-in-depth dictates never logging unsanitized external API responses, and (4) unexpected Google API changes could expose new information. Fix: log only status code and error type, not full response text.
- **Suggested fix:** Replace line 164: `console.error('Failed to refresh Google token:', { status: res.status, statusText: res.statusText });` — extract and log only the error code if safely parseable, or just the HTTP status. Also apply same fix to lines 200-201 in renewGmailWatch function.

### M32. Empty outputsBucket silently passes to S3 operations

- **File:** `lambdas/node/document-converter/index.ts:11, 235-247`
- **Category:** error-handling · **Confidence:** high · **Partition:** node-apps-files
- **What's wrong:** When OUTPUTS_BUCKET environment variable is not set, outputsBucket defaults to empty string. This empty bucket name is then passed to S3 PutObjectCommand and GetObjectCommand without validation, causing cryptic S3 errors instead of clear configuration errors.
- **Impact:** Document conversion requests will fail with unclear AWS SDK errors instead of a helpful 'missing configuration' message. Deployments with missing environment variable will only fail at runtime when a conversion is attempted.
- **Verifier reasoning:** The code at line 11 of index.ts does have the vulnerability: `const outputsBucket = process.env.OUTPUTS_BUCKET || '';` defaults to empty string if not set. Lines 235-247 pass this unsanitized value to PutObjectCommand and GetObjectCommand, which would fail with cryptic AWS SDK errors instead of a clear config error. However, the bug is NOT manifesting in practice because: (1) The Lambda is deployed via CDK infrastructure (app-agnostic-api-gateway-lambda-collection.ts:168) which ALWAYS sets OUTPUTS_BUCKET from props.outputsBucketName, (2) props.outputsBucketName is required (not optional) in the interface and constructed from core.outputsBucket.bucket.bucket which is guaranteed non-empty by NumaCorsEnabledBucket (cors-enabled-bucket.ts:49: `bucket: 'numa-${clientName}${envSuffix}-${bucketName}'`), and (3) The code doesn't support standalone manual deployment. This is poor defensive programming (failing fast with a clear error would be better), but not a critical runtime issue in the current deployed system. Severity is MEDIUM (not HIGH) because it requires manual misconfiguration outside the normal infrastructure path to manifest.
- **Suggested fix:** Add validation at Lambda handler startup to fail immediately with a clear error message: const outputsBucket = process.env.OUTPUTS_BUCKET; if (!outputsBucket) { throw new Error('Missing required environment variable: OUTPUTS_BUCKET'); }

### M33. Callback URL merge overwrites Cognito client fields when client data missing

- **File:** `lambdas/node/callback-renamer/index.ts:54-62`
- **Category:** logic · **Confidence:** high · **Partition:** node-apps-files
- **What's wrong:** The code spreads describeResult.UserPoolClient without checking if it exists. If DescribeUserPoolClientCommand returns a result with undefined UserPoolClient (edge case), all unspecified fields revert to Cognito defaults, potentially removing critical client configurations like allowed OAuth flows, scopes, or token validity settings.
- **Impact:** In edge cases where Cognito returns empty UserPoolClient, the UpdateUserPoolClientCommand with spread operator will reset unspecified fields to defaults, breaking authentication flows and OAuth integrations.
- **Verifier reasoning:** The AWS SDK types explicitly mark `UserPoolClient` as optional in the DescribeUserPoolClientResponse (line: UserPoolClient?: UserPoolClientType | undefined). The code at line 58 spreads describeResult.UserPoolClient without guarding against undefined. In JavaScript/TypeScript, spreading undefined adds no properties, so if UserPoolClient is undefined, the UpdateUserPoolClientCommand receives only ClientId, UserPoolId, and CallbackURLs—missing all other client configurations. The AWS SDK documentation indicates ResourceNotFoundException should be thrown if the client doesn't exist, but the optional type signature suggests edge cases where this guard may not apply, or the code could become unsafe if exception handling changes. The code's own comment (lines 55-57) explicitly documents that unspecified fields revert to Cognito defaults, confirming the impact. The proper fix is to guard: either use ...(describeResult.UserPoolClient ?? {}) or explicitly throw if undefined.
- **Suggested fix:** Replace line 58 with: ...( describeResult.UserPoolClient ?? {}), or add an explicit guard: if (!describeResult.UserPoolClient) throw new Error('UserPoolClient not found');

Code location: /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/callback-renamer/index.ts, lines 54-62

### M34. Inconsistent response structure in enableApis function

- **File:** `lambdas/node/google-cloud-setup/index.ts:272, 288-293, 297`
- **Category:** api-contract · **Confidence:** high · **Partition:** node-init-seed
- **What's wrong:** The enableApis function builds a results array with type Array<{ api: string; status: string; error?: string }> (line 272). However, in the error case within the if block (lines 288-293), it pushes an object with an additional errorCode property that is not declared in the type. In the catch block (line 297), it pushes an object without errorCode. This creates an inconsistent API response shape that breaks client contracts.
- **Impact:** Frontend clients expecting a consistent response structure may fail to parse the results array correctly. Some result objects have errorCode while others don't, causing type errors or undefined behavior in client code that attempts to access errorCode.
- **Verifier reasoning:** The code at lines 272, 288-293, and 297 creates a real inconsistency in the response structure. Line 272 declares results with type Array<{ api: string; status: string; error?: string }>, which does NOT include errorCode. However, lines 288-293 push objects WITH errorCode (from parsed Google error responses), and line 297 pushes objects WITHOUT errorCode (from caught exceptions). The developer attempted to reconcile this with an explicit type assertion `as (typeof results)[number]` on line 293, which suppresses the type error but does not eliminate the runtime inconsistency. Frontend clients that expect errorCode on all error objects will encounter undefined values when errors are caught as exceptions. The assertion indicates this was deliberate, but it still creates an inconsistent API contract where some error results have errorCode while others don't.
- **Suggested fix:** Add errorCode to the type declaration on line 272: const results: Array<{ api: string; status: string; error?: string; errorCode?: string }> = []; This makes the type explicitly accommodate both cases and removes the need for the type assertion on line 293. For line 297, either provide a sensible default errorCode (e.g., 'UNKNOWN') or document that errorCode is only present in API error responses, not in exception cases.

### M35. Silent failure in batch deletion with partial error handling

- **File:** `lambdas/node/bedrock-cleanup-failed-files/index.ts:152-173`
- **Category:** error-handling · **Confidence:** high · **Partition:** node-init-seed
- **What's wrong:** In the DeleteObjects batch operation, when deleteResult.Errors contains failed deletions, the code retries each failed key individually (lines 155-171). However, errors in the retry loop are caught but only logged (line 168-170), and retryError exceptions don't prevent the function from returning success (line 177-185). This means partial batch failures could silently succeed, leaving some failed files undeleted while reporting filesRemoved count that includes these undeleted files.
- **Impact:** Failed files from Bedrock ingestion that couldn't be deleted will not be cleaned up, but the function will return success and report them as deleted. This breaks the idempotent contract and could lead to re-ingestion attempts on files that were supposed to be cleaned up, potentially causing duplicate ingestion errors.
- **Verifier reasoning:** The bug is confirmed by reading lines 152-173. When a batch DeleteObjects operation returns errors, the code retries each failed key with a decoded variant (lines 155-167). The counter `deletedCount` is incremented immediately after each successful individual delete command (line 166). However, if the retry attempt throws an exception (lines 168-170), the exception is caught and logged but never re-thrown, and the counter is not decremented. The function then returns `success: true` at line 178 with the inflated `filesRemoved` count that includes files that actually failed to delete. This creates a silent failure where partial batch deletions are misreported as complete success, breaking the function's idempotent contract and misleading callers about cleanup status. The fix requires either tracking retry failures separately and throwing an error if any occur, or decrementing the counter when a retry fails.
- **Suggested fix:** Track retry failures and throw an error if any occur, preventing the function from returning success when some deletions actually failed. Add a `retryFailures` counter, increment it in the catch block instead of silently continuing, and throw an error after the retry loop if `retryFailures > 0`.

### M36. Missing return type consistency in Lambda handler

- **File:** `lambdas/node/step-function-shim/index.ts:8, 50`
- **Category:** api-contract · **Confidence:** high · **Partition:** node-init-seed
- **What's wrong:** The handler function is declared to return Promise<{ event: string }> (line 8), but at line 50 it returns JSON.parse(describeResult.output).CreateAccountStatus.AccountId, which is a string, not an object with an event property. The actual return value doesn't match the declared type signature.
- **Impact:** Callers expecting a { event: string } response will receive a string value instead, causing type errors or runtime failures when they try to access the .event property on the returned string.
- **Verifier reasoning:** The function signature at line 8 declares return type Promise<{ event: string }>, but line 50 returns JSON.parse(describeResult.output).CreateAccountStatus.AccountId, which is a string value, not an object with an event property. The code has no guards, transformations, or context that would make this type-safe. This is a genuine type contract violation: callers expecting an object with an event property will receive a string instead. TypeScript would flag this as a type error. The fix is to wrap the return value: `return { event: JSON.parse(describeResult.output).CreateAccountStatus.AccountId };`
- **Suggested fix:** Change line 50 from `return JSON.parse(describeResult.output).CreateAccountStatus.AccountId;` to `return { event: JSON.parse(describeResult.output).CreateAccountStatus.AccountId };` to match the declared return type of Promise<{ event: string }>.

### M37. Unbounded lambda:InvokeFunction permission in agent-schedule-runner

- **File:** `infra/constructs/app-agnostic-api-gateway-lambda-collection.ts:1965-1967`
- **Category:** security · **Confidence:** high · **Partition:** infra-client-core
- **What's wrong:** Agent schedule runner Lambda is granted permission to invoke any Lambda function across the account with `resources: ['*']`. This allows lateral movement to any Lambda function via scheduled agent runs.
- **Impact:** If a workspace agent is compromised or a malicious scheduled run is created, the attacker can invoke any Lambda function in the account, potentially executing administrative functions, accessing secrets, or escalating privileges.
- **Verifier reasoning:** The claim is technically REAL but with important nuance. The agent-schedule-runner Lambda at lines 1965-1967 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/infra/constructs/app-agnostic-api-gateway-lambda-collection.ts IS granted lambda:InvokeFunction with resources=['*'], which violates least-privilege. However, the actual code invocations are scoped: (1) line 213 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/agent-schedule-runner/index.ts invokes EMAIL_SENDER_LAMBDA_ARN from env vars (a fixed cross-account deployer Lambda), and (2) line 2498 invokes AWS_LAMBDA_FUNCTION_NAME which AWS automatically sets to the invoking Lambda's own name. Both are deterministic and not user-controlled, so practical lateral movement is blocked by the application logic. The overly broad permission WOULD enable attack IF the function's environment or code were compromised, making this a real but defense-in-depth issue rather than an immediately exploitable vulnerability. Should scope to specific ARNs like arn:aws:lambda:${region}:${account}:function:${clientName}-agent-schedule-runner (self) and the email sender Lambda ARN."
- **Suggested fix:** Update infra/constructs/app-agnostic-api-gateway-lambda-collection.ts lines 1963-1967 to scope the lambda:InvokeFunction permission. Replace the wildcard resources with specific ARNs: resources: [this.agentScheduleRunnerLambda.arn, ...(props.emailSenderLambdaArn ? [props.emailSenderLambdaArn] : [])]. This restricts invocation to only the runner itself and the email sender Lambda, matching the actual code paths.

### M38. CloudFront secret regenerated on every deploy due to ignoreChanges

- **File:** `infra/stacks/numa-client-stack.ts:276-282`
- **Category:** idempotency · **Confidence:** medium · **Partition:** infra-client-core
- **What's wrong:** CloudFront shared secret is generated with `uuidv4()` but immediately ignored via `ignoreChanges: ['value']`. On the first deploy it's created with a random UUID, but on subsequent deploys the Terraform change is ignored, potentially leaving stale values if manual SSM updates occur.
- **Impact:** If the SSM parameter is manually updated or rotated outside of Terraform, subsequent deploys won't enforce the declared secret value. This could leave the frontend and agents using an outdated secret if a rotation is needed, causing authentication failures. The initial random UUID also means the secret is ephemeral across Terraform state loss scenarios.
- **Verifier reasoning:** The claim's title is backwards: the code does NOT regenerate secrets on every deploy. The use of `value: uuidv4()` combined with `lifecycle: { ignoreChanges: ['value'] }` at lines 276-282 in numa-client-stack.ts prevents regeneration - it keeps the secret stable across deploys by ignoring changes to the SSM parameter value. However, there IS a real idempotency issue: this pattern is contradictory and creates brittleness. If Terraform state is lost (rare but possible with S3 backend), a fresh deploy would generate a NEW random UUID, changing the CloudFront secret and breaking authentication for clients using the old secret. The read at line 279 shows `value: uuidv4()` which is non-deterministic, but line 280's `ignoreChanges: ['value']` prevents updates. This obscures whether the intent is a stable secret (which it should be) or a random one. The proper fix uses a deterministic value so idempotency is explicit and survives state loss.
- **Suggested fix:** Replace random UUID generation with a deterministic value. At line 279, change from `value: uuidv4()` to something like `value: Fn.md5(clientConfig.clientName)`, and remove the `ignoreChanges` directive (lines 280). This makes the value stable and idempotent by design, not by accident, and survives Terraform state loss.

### M39. CloudFront Lambda Function URL allows overly permissive CORS with all origins

- **File:** `infra/constructs/workspace-chat-agent-proxy-construct.ts:207`
- **Category:** security · **Confidence:** high · **Partition:** infra-ws-apps-kb
- **What's wrong:** Lambda Function URL CORS is configured to allow all origins (`allowOrigins: ['*']`), all methods (`allowMethods: ['*']`), and all headers (`allowHeaders: ['*']`). The code includes a TODO comment noting this needs restriction in production.
- **Impact:** Any website can make cross-origin requests to the proxy Lambda, potentially allowing CSRF attacks or unauthorized access to the workspace chat agent if the CloudFront secret header validation is bypassed or misconfigured.
- **Verifier reasoning:** The CORS configuration at lines 206-212 of workspace-chat-agent-proxy-construct.ts is real and overly permissive. The code explicitly sets allowOrigins: ['*'], allowMethods: ['*'], and allowHeaders: ['*'], with a TODO comment on line 207 acknowledging the need for restriction in production. The vulnerability is genuine but partially mitigated:

REAL ISSUES:

1. Lines 206-212: CORS allows all origins, methods, and headers
2. Line 204: authorizationType is 'NONE', making the URL publicly accessible
3. Lambda function code (line 50): CLOUDFRONT_SECRET has a fallback default of empty string, causing validation to be skipped in dev mode (line 180-181: `if not CLOUDFRONT_SECRET: return`)
4. Line 327-334: The /ping endpoint has zero authentication
5. AWS permission (line 222): principal: '\*' allows public invocation

MITIGATING FACTORS:

1. Production deployment in numa-client-stack.ts properly sets the CloudFront secret via UUID (line 279)
2. Protected endpoints all call validate_cloudfront_secret() and extract_user_sub(), requiring either a valid secret or JWT
3. Line 210: allowCredentials: false prevents automatic cookie/session hijacking
4. Protected endpoints scope operations to user_sub extracted from JWT (lines 539, 648, 753 in lambda_function.py)

ATTACK SCENARIO:
If CloudFront secret validation is bypassed (dev mode, misconfiguration, or intentionally), an attacker can make cross-origin requests to protected endpoints with a stolen JWT, operating with the victim's privileges.

The claim is accurate: the configuration IS production-unsafe and the TODO acknowledges it. The CORS allowlist should be restricted to CloudFront domain and legitimate frontend domains instead of '\*'.

- **Suggested fix:** Restrict CORS origins to specific domains in workspace-chat-agent-proxy-construct.ts line 207:

```typescript
allowOrigins: [
  'https://your-cloudfront-domain.cloudfront.net',
  'https://legitimate-frontend-domain.com'
],
```

Additionally, ensure CloudFront secret is never empty by validating it in the Terraform construct during initialization, and consider removing the dev mode fallback that skips validation when CLOUDFRONT_SECRET is not set (line 180-181 of lambda_function.py).

### M40. Non-idempotent message state updates in subagent tool input handler

- **File:** `numa-frontend/src/utils/workspaceChatEventHandlers.ts:2070-2095`
- **Category:** idempotency · **Confidence:** high · **Partition:** fe-chat-stream
- **What's wrong:** When updating a subagent tool's input (content_block_stop event), if the parent subagent segment is not found, the function returns an unmodified copy of prev (line 2095) instead of returning prev unchanged. This violates React state update idempotency: if the callback fires twice or the segment later appears, the update is lost.
- **Impact:** In production, if StreamEvents arrive out of order (tool input delta arrives before parent Task segment is created), the tool input is silently dropped. Subsequent retries or concurrent updates won't recover the lost input since the callback returns a no-op state. Users see incomplete tool parameters in subagent runs.
- **Verifier reasoning:** The bug is REAL. I read the actual code at lines 2070-2095 and 2111-2117 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/utils/workspaceChatEventHandlers.ts. When the parent subagent segment is not found (parentIdx < 0 or segIdx < 0), the code returns `updated` (a shallow copy of the messages array) instead of `prev` (the same reference). This violates React state updater idempotency: setState updaters should return the same reference when semantically unchanged. More critically, if StreamEvents arrive out of order (per the comment at line 1273 stating "The assistant SDK event can arrive BEFORE its corresponding StreamEvents"), the tool input is buffered into inputBuffer but never applied to a segment if the parent doesn't exist, and there's no retry mechanism. I found a correct precedent pattern at line 850 (return prev when not found, updated when found), confirming this is a real deviation. Severity is MEDIUM (not HIGH) because: (1) it requires event out-of-order delivery which may be rare, (2) the tool block still appears even if input is missing, and (3) the idempotency violation causes unnecessary re-renders but not functional breakage in most cases.
- **Suggested fix:** At lines 2070-2095, track whether mutations occurred and conditionally return:

```typescript
if (parentIdx >= 0) {
  // ... mutations ...
  updated[lastIdx] = lastMsg;
  return updated; // Found and updated
}
return prev; // Not found, no changes
```

Apply the same fix at lines 2111-2117 for top-level tools. This matches the pattern used elsewhere (e.g., line 850) and ensures idempotency compliance while preventing silent tool input loss.

### M41. Non-idempotent message state updates in top-level tool input handler

- **File:** `numa-frontend/src/utils/workspaceChatEventHandlers.ts:2107-2117`
- **Category:** idempotency · **Confidence:** high · **Partition:** fe-chat-stream
- **What's wrong:** When updating a top-level tool's input, if the segment is not found (segIdx < 0), the function returns an unmodified `updated` array instead of returning `prev`. This violates idempotency: if the callback is retried or there's a race, the update is lost.
- **Impact:** If tool segments are searched on the last message but the tool is on an older message, or if the segment hasn't been created yet, the tool input is silently dropped. Users see stale or missing tool parameters in inline tool displays.
- **Verifier reasoning:** The bug is REAL. At lines 2107-2117 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/utils/workspaceChatEventHandlers.ts, when a tool segment is not found (segIdx < 0), the code:

1. Creates shallow copies of `prev`, `lastMsg`, and `segments` (lines 2100, 2104-2105)
2. Does NOT mutate these copies when segIdx < 0 (the if block at 2111-2115 is skipped)
3. Returns `updated` (the shallow copy) instead of `prev` (lines 2117)

This causes two issues:
a) FUNCTIONAL: If a tool segment genuinely doesn't exist (e.g., if createInitialToolSegment returned null for a 'hidden' tool, or due to an undetected race condition), the tool input update is silently dropped without any error or warning.
b) PERFORMANCE: Returning a shallow copy of `prev` instead of `prev` triggers unnecessary React re-renders even though the state hasn't changed.

The identical pattern exists in the subagent case (lines 2058-2096), so this is a systemic issue.

HOWEVER, the severity should be assessed as MEDIUM (not HIGH) because:

- In normal streaming flow, the segment should always exist, created via segments.push(initialSegment) in content_block_start
- Only tools with kind='hidden' skip segment creation, and these are intentionally not displayed
- The claim's framing around "idempotency violation if callback is retried" is overstated—the function is still idempotent from a state perspective
- The real risk is silent data loss in edge cases (race conditions or missing segments)

CORRECT FIX: Return `prev` unconditionally when segIdx < 0, and optionally add a console.warn to surface missing segments for debugging.

- **Suggested fix:** At lines 2099-2118, change to:

```typescript
setMessages((prev) => {
  const updated = [...prev];
  const lastIdx = updated.length - 1;
  if (lastIdx < 0) return prev;

  const lastMsg = { ...updated[lastIdx] };
  const segments = [...(lastMsg.segments || [])];

  const segIdx = segments.findIndex((s) => {
    return s.toolUseId === toolInfo.id || s.parentToolUseId === toolInfo.id;
  });

  if (segIdx >= 0) {
    segments[segIdx] = updateSegmentWithInput(segments[segIdx], toolInfo.name, input);
    lastMsg.segments = segments;
    updated[lastIdx] = lastMsg;
    return updated;
  }

  // Segment not found—return prev unchanged (prevents unnecessary re-render)
  // Optional: log warning for debugging race conditions or missing segments
  return prev;
});
```

And apply the same fix to the subagent case at lines 2058-2096.

### M42. Array mutation in group comparison breaks equality checks

- **File:** `numa-frontend/src/Providers/AuthProvider.tsx:638`
- **Category:** logic · **Confidence:** high · **Partition:** fe-auth-providers
- **What's wrong:** Line 638 mutates the `oldGroups` array in-place with `.sort()`: `const groupsChanged = JSON.stringify(oldGroups.sort()) !== JSON.stringify(groups.sort());` This modifies the original array from `user?.groups || []`, corrupting the user state. Even worse, both sides of the comparison sort their arrays in-place, and in JavaScript array.sort() returns the same array reference, making the comparison depend on mutation order rather than actual values. The condition `if (groupsChanged && user)` on line 641 then uses the now-mutated oldGroups.
- **Impact:** User group arrays get sorted in-place, potentially causing subtle state inconsistencies. More critically, if promoted to admin and the groups differ, line 654 calls `await refreshTokens()` recursively within the current refresh operation. If promotion happens again on the next refresh cycle, this could create a tight loop of nested refresh calls.
- **Verifier reasoning:** The array mutation at line 638 is REAL and confirmed by reading the code: `const groupsChanged = JSON.stringify(oldGroups.sort()) !== JSON.stringify(groups.sort());` does mutate both arrays in-place with `.sort()`.

However, the severity and impact are NOT as claimed in the bug report:

1. MUTATION IS REAL BUT LIMITED IMPACT: Line 635 captures `const oldGroups = user?.groups || []`. The `user` variable is part of a `useCallback` with dependencies `[logout, scheduleRefreshBeforeExpiry, showTokenRevocationNotification]` (line 787) - `user` is NOT included. This means `user` captures a STALE closure value from when the callback was first created. Mutating this stale reference's groups array doesn't corrupt the current React state.

2. RECURSIVE LOOP CLAIM IS FALSE: Line 654's `await refreshTokens()` call does NOT create a nested refresh loop. Lines 498-500 contain a guard: `if (refreshInProgressRef.current) return refreshPromiseRef.current;`. Since `refreshInProgressRef.current` is set to `true` at line 502 before the async operation begins, any recursive call immediately returns the existing promise without re-entering the refresh operation.

3. COMPARISON LOGIC IS NOT BROKEN: The mutation doesn't affect the correctness of the comparison. Both arrays are sorted before JSON.stringify, so the comparison result is correct regardless of mutation order. The claim that comparison depends on mutation order is misleading.

4. CONTRAST WITH LINE 683: The developers show awareness of this anti-pattern - at line 683 they explicitly use `.slice().sort()` to avoid mutation when updating state: `const groupsMatch = JSON.stringify(prevUser.groups?.slice().sort()) !== ...`

CONCRETE FIX: Change line 638 from `const groupsChanged = JSON.stringify(oldGroups.sort()) !== JSON.stringify(groups.sort());` to `const groupsChanged = JSON.stringify(oldGroups.slice().sort()) !== JSON.stringify(groups.slice().sort());` for consistency and to eliminate the anti-pattern, even though observable bugs are unlikely due to the stale closure.

- **Suggested fix:** Change line 638 from:

```typescript
const groupsChanged = JSON.stringify(oldGroups.sort()) !== JSON.stringify(groups.sort());
```

to:

```typescript
const groupsChanged = JSON.stringify(oldGroups.slice().sort()) !== JSON.stringify(groups.slice().sort());
```

This uses `.slice()` to create copies before sorting, avoiding mutation and matching the pattern already used at line 683 in the state update logic.

### M43. Fire-and-forget device trust clear without await creates race condition

- **File:** `numa-frontend/src/Providers/AuthProvider.tsx:887`
- **Category:** race · **Confidence:** high · **Partition:** fe-auth-providers
- **What's wrong:** Line 887 makes a fire-and-forget server call without awaiting: `void AdminMfaSettingsService.clearDeviceTrust(storedDeviceKey);` This clears the device trust record server-side to prevent a sibling tab from reusing a stale device key. However, if the network call is slow or fails, the local clear on line 888 proceeds immediately. A concurrent tab might read the stale localStorage device key before the server updates, causing both tabs to send the same invalid device key to Cognito.
- **Impact:** If device trust server-side clear fails or is slow, multi-tab sessions can get into a state where both tabs send stale device keys, causing spurious 'Invalid Refresh Token' errors and forced logouts. Users on unreliable networks would be affected.
- **Verifier reasoning:** The fire-and-forget pattern at line 1887 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/numa-frontend/src/Providers/AuthProvider.tsx is real. The code fires an async HTTP DELETE to `/settings/mfa/clear-device-trust` without awaiting it (line 1887: `void AdminMfaSettingsService.clearDeviceTrust(storedDeviceKey)`), then immediately clears localStorage synchronously (line 1888: `clearDeviceTrust()`). The backend handler (lambdas/node/admin-mfa-settings/index.ts line 448) performs an async DynamoDB DeleteCommand. During the window between firing the async clear and the DynamoDB delete completing, validateDevice() calls (line 1765) could return true (because the DynamoDB record still exists), even though Cognito has already rejected the device. This creates a race where subsequent login/refresh attempts might include an invalid DEVICE_KEY. However, the code has mitigations: (1) within the same tab's retry, localStorage is already cleared so DEVICE_KEY won't be sent again (lines 2115-1761), and (2) if another retry/tab does send it, the exception is caught and the pattern repeats. The code comments acknowledge this trade-off explicitly (lines 1883-1885). The race is real but the retry pattern provides resilience. A proper fix would be to await the server clear at line 1887 before proceeding to line 1888.
- **Suggested fix:** Change line 1887 from `void AdminMfaSettingsService.clearDeviceTrust(storedDeviceKey);` to `await AdminMfaSettingsService.clearDeviceTrust(storedDeviceKey);` to ensure the server-side DynamoDB delete completes before the local clear and subsequent validateDevice() calls could execute, eliminating the race window where validateDevice() returns stale data.

### M44. Missing dzSelectedKbId and dzKbFolders reset on modal open

- **File:** `numa-frontend/src/Components/Files/CreateShareModal.tsx:308-351`
- **Category:** data-loss · **Confidence:** high · **Partition:** fe-files-agents
- **What's wrong:** The reset effect that runs when the modal opens does not reset dzSelectedKbId and dzKbFolders state. This causes stale KB selections and folder lists to persist when the user reopens the modal in dropzone mode, leading to the wrong KB being selected on subsequent uses.
- **Impact:** When a user creates a dropzone, closes the modal, then opens it again to create another dropzone, the previously selected KB folder (dzSelectedKbId) will still be selected even though the UI shows step 1 (folder selection). This causes dropzones to be created in the wrong KB location without the user realizing it.
- **Verifier reasoning:** The bug is REAL and reachable. Evidence from code inspection:

1. STATE DEFINITION (line 285): `dzSelectedKbId` is a React state that persists across modal open/close cycles.

2. MISSING RESET (lines 309-351): The reset effect that runs when `show` becomes true resets many states (dropzoneWizardStep, dzBrowsePath, dzShowNewFolder, dzNewFolderName, setSelectedKbId, setAvailableKbs, etc.) but does NOT include `setDzSelectedKbId(null)` or `setDzKbFolders([])`.

3. USAGE IN SUBMISSIONS (lines 794, 967): Both `handleDropzoneSubmit` and `handleQuickCreateDropzone` use `dzSelectedKbId` to determine the target KB: `const targetKbId = dzSelectedKbId || userSub;`. If `dzSelectedKbId` retains a stale value from a previous session, the wrong KB will be selected.

4. VISUAL SELECTION STATE (lines 1115, 1125): Step 1 displays which KB is selected using `dzSelectedKbId`. The UI renders a 'selected' class if `dzSelectedKbId === kb.kb_id`. If the stale value matches a KB in the fresh list, the UI will visually show that KB as selected even though the user hasn't explicitly reselected it.

5. NO OTHER RESET MECHANISM: `setDzSelectedKbId` is only called when the user explicitly clicks a folder (lines 1117, 1132). There's no useEffect or other mechanism that auto-resets it when step 1 is entered.

MANIFEST SCENARIO: User creates dropzone in KB 'proj-a', closes modal, reopens modal. Step 1 reloads fresh folders but dzSelectedKbId='proj-a' remains. If user doesn't explicitly click a folder, they create the next dropzone in 'proj-a' again unintentionally.

However, SEVERITY is MEDIUM not HIGH because: (1) This doesn't cause data loss; dropzones are created successfully, just in unexpected locations, (2) Users can mitigate by explicitly re-selecting a folder, and (3) The selected state is visually displayed, so careful users may notice. The claim says 'data-loss' but this is data misplacement, not loss."

- **Suggested fix:** Add the following lines to the reset effect at lines 309-351, after line 348:

```javascript
setDzSelectedKbId(null);
setDzKbFolders([]);
```

This ensures that when the modal reopens, both the selected KB ID and the cached folder list are cleared, forcing the user to consciously reselect a folder rather than inadvertently using a stale selection.

### M45. Missing reset of dzKbFolders allows stale folder list to persist

- **File:** `numa-frontend/src/Components/Files/CreateShareModal.tsx:308-351`
- **Category:** data-loss · **Confidence:** high · **Partition:** fe-files-agents
- **What's wrong:** dzKbFolders is loaded once when entering dropzone step 1 (line 474) but is never reset when the modal closes or when show=false. If the user's KB list changed between modal opens (e.g., KB was deleted or shared), the stale dzKbFolders list will still show the old KB, and clicking it will fail or create the dropzone in the wrong location.
- **Impact:** User has KBs [Folder1, Folder2]. Creates dropzone. Folder1 is deleted server-side. User reopens modal. dzKbFolders still shows Folder1 (from previous session). User clicks Folder1. Either the click fails silently, or the API is called with a non-existent KB ID, causing a 404 or unexpected error.
- **Verifier reasoning:** The bug is REAL. Code inspection reveals: (1) Line 284 declares dzKbFolders state; (2) Lines 465-467 show it's only set in loadDzKbFolders(); (3) Lines 473-477 load it fresh when entering step 1 IF show+isDropzone+step1 all true; (4) However, the reset effect (lines 309-351) which runs when show changes does NOT reset dzKbFolders or dzSelectedKbId; (5) Grep confirms setDzKbFolders is never called in reset effect, and setDzSelectedKbId is never called in reset effect either. When a modal is reopened: the reset effect sets dropzoneWizardStep=1 but leaves dzKbFolders and dzSelectedKbId with stale values; then loadDzKbFolders() is called to refresh, but there's a window where the UI renders with old data. More critically, if a user selects a KB in session 1, closes the modal, that KB is deleted server-side, and they reopen: dzSelectedKbId still points to the deleted KB. The .find() at line 796 fails and defaults folderName to 'Personal', but dzSelectedKbId still references a non-existent KB, leading to API calls with invalid KB IDs. The manifest is: stale folder list shown briefly on reopen, and invalid KB ID sent to API if selected KB was deleted.
- **Suggested fix:** Add the following two lines to the reset effect (lines 309-351), after line 317 and before line 318: setDzKbFolders([]); setDzSelectedKbId(null);

---

## LOW (6)

### L1. Malformed string truncation creates truncated Python literal in LLM context

- **File:** `lambdas/python/structured-data-query/lambda_function.py:669-671`
- **Category:** logic · **Confidence:** high · **Partition:** py-sql-data
- **What's wrong:** Query results are converted to string representation (Python dict literal) and truncated at AGENT_RESULT_STR_MAX bytes with '... (truncated)' appended. This creates malformed/invalid syntax when truncated mid-value, confusing the LLM and potentially causing parsing errors or misinterpretation of data.
- **Impact:** Logic error: A query result contains a value with >10K characters. The string representation is truncated at AGENT_RESULT_STR_MAX=20000 bytes, potentially cutting a value in half (e.g., [...'long_field': 'xxx...]. The LLM receives invalid Python syntax in the observation, potentially leading to incorrect reasoning or repeated queries.
- **Verifier reasoning:** The code at lines 669-671 does create syntactically invalid Python dict/list representations when truncating at arbitrary byte boundaries (e.g., `[{'field': 'xxx...` without closing brackets). However, this is not a practical bug because: (1) the truncated string is sent to the LLM as text content in a user message (line 678: `messages.append({"role": "user", "content": obs})`), not parsed as code; (2) the LLM is instructed to output JSON, not to parse the observation as Python; (3) the "... (truncated)" suffix explicitly signals incompleteness; (4) the LLM can reason about partial/malformed data without parsing errors. The severity is low because while technically the string is malformed, it doesn't cause the claimed "parsing errors or misinterpretation"—it gracefully degrades to an incomplete but readable observation. A better approach would be to truncate at the last complete dict boundary or limit at the row level (AGENT_SQL_LIMIT is already applied on line 663), but the current implementation is defensive and functional.
- **Suggested fix:** To properly fix this: (1) Truncate at the last complete dict boundary, or (2) Limit results before serialization by reducing AGENT_SQL_LIMIT or number of rows returned, or (3) Use a safer serialization (JSON or repr of individual rows) instead of str() on the full list. Example fix: return only the first N rows that fit within AGENT_RESULT_STR_MAX when serialized, or use json.dumps(results) which is more predictable for truncation.

### L2. Duplicate domain_area variable assignment

- **File:** `lambdas/python/policy-builder-legal-review/lambda_function.py:43-44`
- **Category:** logic · **Confidence:** high · **Partition:** py-policy-apps
- **What's wrong:** Variable domain_area is assigned twice identically from the same event key, which is unnecessary and indicates potential copy-paste error or incomplete refactoring.
- **Impact:** No functional impact but indicates code quality issue and may mask intent errors if one assignment was meant to be different.
- **Verifier reasoning:** The code at lines 43-44 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/policy-builder-legal-review/lambda_function.py shows an identical duplicate assignment: `domain_area = event["domain_area"]` appears twice consecutively with no modifications, conditions, or logic between them. The variable is then used later in format strings at lines 72 and 112. There is no guard, validation, or conditional logic that would justify both assignments. This is a straightforward code quality issue resulting from apparent copy-paste or incomplete refactoring. No functional impact, but reduces code clarity and indicates potential intent errors if one assignment was meant to be different. Fix: remove line 44 (the duplicate).
- **Suggested fix:** Delete line 44 entirely. The duplicate assignment serves no purpose and should be removed to maintain code clarity.

### L3. Type annotation typo in policy-drafter

- **File:** `lambdas/python/policy-drafter/lambda_function.py:47`
- **Category:** type · **Confidence:** high · **Partition:** py-policy-apps
- **What's wrong:** Type annotation contains typo: 'AppOutputResulS3Output' should be 'AppOutputResultS3Output' (missing 't' in 'Result'). This will cause type checking to fail and may cause runtime AttributeError if this type is used.
- **Impact:** Type hints are incorrect which breaks mypy/pyright type checking. If the wrong class name is actually used in type checking tools or runtime code, this could cause AttributeError.
- **Verifier reasoning:** The typo exists and is real. Located in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/helpers/helpers/**init**.py at lines 106 and 111, the class names are defined as `AppOutputResulS3OutputData` and `AppOutputResulS3Output` (missing 't' in 'Result'), while the inline output counterpart at line 101 is correctly named `AppOutputResultInlineOutput`. The lambda_function.py at line 47 correctly references the actual class name that exists (`helpers.AppOutputResulS3Output`), so there's no runtime AttributeError. However, this is a genuine typo in the type definitions that creates naming inconsistency and confuses developers. The fix would be to rename the classes in helpers/**init**.py from `AppOutputResulS3Output` to `AppOutputResultS3Output` and update all references (line 106, 111, 112, 118 in helpers library, and line 47 in policy-drafter).
- **Suggested fix:** Rename in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lib/helpers/helpers/**init**.py: `AppOutputResulS3OutputData` → `AppOutputResultS3OutputData` (line 106), `AppOutputResulS3Output` → `AppOutputResultS3Output` (lines 111-112, 118). Update reference in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/python/policy-drafter/lambda_function.py line 47 from `AppOutputResulS3Output` to `AppOutputResultS3Output`. Search codebase for other uses of these class names and update them consistently.

### L4. Misleading error message contradicts implemented security validation

- **File:** `lambdas/node/sso-token-exchange/index.ts:65`
- **Category:** logic · **Confidence:** high · **Partition:** node-auth-sso
- **What's wrong:** The error message 'redirectUri must use https' is returned when protocol is neither https nor http, but the code actually allows both http and https. This inconsistency between the error message and the actual validation logic could cause confusion.
- **Impact:** Misleading error message may cause developers to misunderstand the actual security requirements and behave incorrectly.
- **Verifier reasoning:** The bug is confirmed by reading lines 61-66 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/sso-token-exchange/index.ts. Line 64 checks `if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')` - this condition is TRUE only when the protocol is NEITHER https NOR http. When TRUE, the error on line 65 is returned: 'redirectUri must use https'. The logic proves that both http:// and https:// protocols pass validation and do NOT trigger the error (they both make the condition FALSE). However, the error message claims "must use https" which contradicts the actual validation logic that permits both http and https. Additionally, the comment on line 61 states "Validate redirectUri is a valid URL with https" which is similarly misleading. This is a real inconsistency between the error message/comment and the implemented validation logic. While not a functional security bug (the code does permit both protocols as intended), it creates developer confusion about the actual security requirements.
- **Suggested fix:** Either: (1) Update the error message to 'redirectUri must use https or http', and update the comment to match; OR (2) if https-only is the intent, change line 64 to: `if (parsed.protocol !== 'https:')` to enforce https-only. The first option seems more likely the intent given that http is explicitly allowed in the code logic.

### L5. Non-timing-safe comparison of CloudFront shared secret

- **File:** `lambdas/node/notifications-stream/index.ts:18`
- **Category:** security · **Confidence:** high · **Partition:** node-events-notif
- **What's wrong:** Uses non-timing-safe string comparison (`!==`) for validating the x-arcanum-cloudfront-secret header. An attacker could use timing analysis to brute-force the secret by measuring response times.
- **Impact:** Potential authorization bypass: An attacker could exploit timing differences in the string comparison to deduce the CloudFront shared secret character-by-character, bypassing the authentication layer for the notification stream endpoint.
- **Verifier reasoning:** The code at line 18 of /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/notifications-stream/index.ts uses non-timing-safe string comparison (`!==`) for the CloudFront secret: `if (cfSecret !== CLOUDFRONT_SHARED_SECRET)`. This violates cryptographic best practices—timing-safe comparison using `crypto.timingSafeEqual()` should be used. The codebase demonstrates awareness of this pattern (scim-endpoint and pipedream-event-receiver both use `timingSafeEqual()`). However, the claimed 'high' severity is incorrect. The practical exploitability is extremely low because: (1) Network latency through CloudFront (50-500ms) dominates any microsecond-level timing differences from character-by-character comparison; (2) Lambda cold start variance (100-500ms) adds noise orders of magnitude larger than the signal; (3) Brute-forcing a 32+ character random secret would require billions of requests despite the timing advantage being negligible. The fix is straightforward—use `crypto.timingSafeEqual()` after length validation—but the severity should be 'low' (code smell/defense-in-depth), not 'high' (not practically exploitable in this deployment context).
- **Suggested fix:** Replace line 18 in /Users/arcanum/WebstormProjects/numa-proj-main/numa/lambdas/node/notifications-stream/index.ts: Import `timingSafeEqual` from 'crypto' at the top, then change `if (cfSecret !== CLOUDFRONT_SHARED_SECRET)` to `const cfSecretBuf = Buffer.from(cfSecret || ''); const expectedBuf = Buffer.from(CLOUDFRONT_SHARED_SECRET); if (cfSecretBuf.length !== expectedBuf.length || !timingSafeEqual(cfSecretBuf, expectedBuf))`

### L6. Missing idempotency check in handleBulkMove when boarding empty

- **File:** `numa-frontend/src/Components/Ops/BacklogView/BacklogView.tsx:1114-1135`
- **Category:** idempotency · **Confidence:** high · **Partition:** fe-ops
- **What's wrong:** If boardId is empty or undefined (due to the missing dependency bug), the bulkUpdateTickets call will send an empty string as the boardId. The backend may accept this or reject it, but if it silently accepts it, the tickets are persisted with a null/empty boardId, orphaning them from any board. This violates idempotency: retrying the operation with a populated boardId would then fail because the tickets no longer belong to the original board.
- **Impact:** Bulk move succeeds on the client (UI updates), but backend silently accepts the empty boardId. Tickets are now orphaned. If the user tries the bulk move again or refreshes, the orphaned tickets don't appear in the original board, confusing the user about where the tickets went.
- **Verifier reasoning:** The claim is partially real but the severity and root cause are misstated. The actual issue: handleBulkMove at line 1114-1135 is missing a guard check for empty boardId that is present in the similar handleBulkAssignSprint at line 1173 (`if (...|| !boardId) return;`). If boardData?.board?.id is falsy, boardId becomes an empty string (line 656: `const boardId = boardData?.board?.id ?? '';`), and the handleBulkMove callback will attempt the API call, causing a 400 error from the backend (lines 2044-2045 of numa-ops-api/index.ts: `if (!teamId) return errorResponse(400, 'Missing required field: changes.boardId');`). However, the claim's assertion that 'the backend may silently accept it, orphaning tickets' is FALSE - the backend explicitly rejects empty boardId with a 400 error. The real problem is: (1) missing guard allows unnecessary failed API requests, and (2) inconsistency with handleBulkAssignSprint's defensive pattern. The fix: add `if (selectedTickets.length === 0 || bulkActing || !boardId) return;` guard at line 1116, and add `boardId` to the dependency array at line 1134.
- **Suggested fix:** In handleBulkMove (line 1114-1135), change line 1116 from `if (selectedTickets.length === 0 || bulkActing) return;` to `if (selectedTickets.length === 0 || bulkActing || !boardId) return;` to match the defensive pattern used in handleBulkAssignSprint. Also add `boardId` to the dependency array on line 1134 to make it `[selectedTickets, bulkActing, allStages, boardId, numaPost, refreshTickets]` for consistency and proper React closure semantics.
