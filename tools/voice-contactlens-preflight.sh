#!/usr/bin/env bash
#
# voice-contactlens-preflight.sh — de-risk the Numa Voice Contact Lens / live-assist
# build (task #7) BEFORE writing any infra. It answers the two unknowns that the
# numa-voice-construct NOTE flags as deploy-breaking:
#
#   1. Is Contact Lens enabled on the instance, and where does post-call analysis land?
#   2. What is the EXACT contact-flow JSON for UpdateContactRecordingAndAnalyticsBehavior
#      that this instance/region actually accepts? (A bare AnalyticsBehavior/AnalyticsMode
#      is invalid flow language and breaks the deploy — so we validate candidates against
#      the live API instead of guessing.)
#
# READ-ONLY by default. The --probe flag additionally validates candidate flow JSON by
# CREATING a throwaway OUTBOUND_WHISPER flow (named *-PROBE-DELETEME) and DELETING it
# immediately — it is never associated with a queue, so it analyses nothing and costs
# nothing. Dev stack (arcanum-demo-tony) only — never run --probe against a customer.
#
# Usage:
#   tools/voice-contactlens-preflight.sh                 # read-only checks
#   tools/voice-contactlens-preflight.sh --probe         # + validate flow JSON candidates
#
# Env overrides: INSTANCE, REGION, AWS_PROFILE, OUTBOUND_FLOW_ID, ANALYTICS_LANG
set -uo pipefail

INSTANCE="${INSTANCE:-0621c695-cb29-4380-bb5b-4732993860fc}"
REGION="${REGION:-ap-southeast-2}"
export AWS_PROFILE="${AWS_PROFILE:-q-demo}"
OUTBOUND_FLOW_ID="${OUTBOUND_FLOW_ID:-7724adfc-02f1-49cd-b104-77e7ec14126a}"
ANALYTICS_LANG="${ANALYTICS_LANG:-en-AU}"

aws_connect() { aws connect "$@" --region "$REGION"; }
line() { printf '\n=== %s ===\n' "$1"; }

line "Instance ($INSTANCE / $REGION / profile=$AWS_PROFILE)"
aws_connect describe-instance --instance-id "$INSTANCE" \
  --query 'Instance.{Alias:InstanceAlias,Status:InstanceStatus,Outbound:OutboundCallsEnabled}' --output table

line "Contact Lens instance attribute (must be true to enable analytics in a flow)"
aws_connect describe-instance-attribute --instance-id "$INSTANCE" --attribute-type CONTACT_LENS \
  --query 'Attribute.Value' --output text

line "Storage configs (post-call CL analysis lands in the CALL_RECORDINGS bucket under Analysis/Voice/)"
for T in CALL_RECORDINGS CONTACT_TRACE_RECORDS; do
  printf -- '- %s: ' "$T"
  aws_connect list-instance-storage-configs --instance-id "$INSTANCE" --resource-type "$T" \
    --query 'StorageConfigs[0].S3Config.{Bucket:BucketName,Prefix:BucketPrefix}' --output text 2>/dev/null || echo "(none)"
done

line "Current outbound whisper flow content (the action we will change)"
aws_connect describe-contact-flow --instance-id "$INSTANCE" --contact-flow-id "$OUTBOUND_FLOW_ID" \
  --query 'ContactFlow.Content' --output text | python3 -m json.tool 2>/dev/null || echo "(could not read flow)"

if [[ "${1:-}" != "--probe" ]]; then
  printf '\nRead-only checks done. Re-run with --probe to validate the flow-language candidates.\n'
  exit 0
fi

# ── Probe: find the accepted UpdateContactRecordingAndAnalyticsBehavior JSON ──────────
# Each candidate is a full minimal OUTBOUND_WHISPER flow. We create it (Connect validates
# the flow language on create), record pass/fail, then delete it. The first candidate that
# creates cleanly is the shape to use in the construct.
probe_candidate() {
  local label="$1" analytics_json="$2"
  local name="numa-voice-cl-PROBE-DELETEME-$3"
  local content
  # The analytics action REQUIRES NoMatchingError + ChannelMismatch error transitions
  # (verified — omitting them fails validation regardless of Parameters).
  content=$(cat <<JSON
{"Version":"2019-10-30","StartAction":"rec","Actions":[
 {"Identifier":"rec","Type":"UpdateContactRecordingAndAnalyticsBehavior",
  "Parameters":{$analytics_json},
  "Transitions":{"NextAction":"end","Errors":[
    {"NextAction":"end","ErrorType":"NoMatchingError"},
    {"NextAction":"end","ErrorType":"ChannelMismatch"}],"Conditions":[]}},
 {"Identifier":"end","Type":"EndFlowExecution","Parameters":{},"Transitions":{}}]}
JSON
)
  printf -- '\n--- candidate: %s ---\n' "$label"
  local out fid
  out=$(aws_connect create-contact-flow --instance-id "$INSTANCE" --name "$name" \
        --type OUTBOUND_WHISPER --content "$content" --output json 2>&1)
  if echo "$out" | grep -q '"ContactFlowId"'; then
    fid=$(echo "$out" | python3 -c 'import sys,json;print(json.load(sys.stdin)["ContactFlowId"])')
    printf 'ACCEPTED ✅  (flowId=%s) — deleting throwaway flow\n' "$fid"
    aws_connect delete-contact-flow --instance-id "$INSTANCE" --contact-flow-id "$fid" >/dev/null 2>&1 \
      && echo "deleted." || echo "WARN: delete failed — remove $name manually."
    echo "$analytics_json" > /tmp/voice-cl-accepted-analytics.json
    return 0
  fi
  printf 'REJECTED ❌  %s\n' "$(echo "$out" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-300)"
  return 1
}

ACCEPTED=""
# VERIFIED 2026-06-13 against numa-arcanum-demo-tony (ap-southeast-2): this exact shape
# was accepted by CreateContactFlow. The recording + analytics nest under a per-channel
# `VoiceBehavior`; `AnalyticsModes` is a required array and accepts ["RealTime"] (which
# also yields the post-call S3 analysis) — but NOT ["RealTime","PostCall"] together. The
# action additionally REQUIRES NoMatchingError + ChannelMismatch error transitions (handled
# by probe_candidate's Transitions block). Re-running --probe re-validates the schema.
probe_candidate "VERIFIED: VoiceBehavior.{VoiceRecordingBehavior,VoiceAnalyticsBehavior.AnalyticsModes=[RealTime]}" \
"\"VoiceBehavior\":{\"VoiceRecordingBehavior\":{\"RecordedParticipants\":[\"Agent\",\"Customer\"]},\"VoiceAnalyticsBehavior\":{\"Enabled\":\"True\",\"AnalyticsLanguage\":\"$ANALYTICS_LANG\",\"AnalyticsModes\":[\"RealTime\"],\"ConversationalAnalyticsRedactionConfiguration\":{\"Enabled\":\"False\"}}}" \
VERIFIED && ACCEPTED="VERIFIED"

line "Result"
if [[ -n "$ACCEPTED" ]]; then
  printf 'Accepted flow-language is candidate %s. AnalyticsBehavior JSON saved to:\n  /tmp/voice-cl-accepted-analytics.json\n' "$ACCEPTED"
  cat /tmp/voice-cl-accepted-analytics.json
else
  printf 'No candidate validated — none of A–D were accepted. Inspect the REJECTED messages above\n'
  printf 'for the exact field Connect complained about, add a candidate, and re-run.\n'
fi
