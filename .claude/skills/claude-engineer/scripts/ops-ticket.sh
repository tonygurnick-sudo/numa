#!/usr/bin/env bash
# claude-engineer / ops-ticket.sh
#
# HQ Ops ticket helper for the pipeline. Resolve a ticket by share-URL or
# displayId, read its full detail, add comments, and move it between stages —
# so the agent never has to re-derive the Ops plumbing each run.
#
# Env:   AWS_PROFILE=arcanum-prod-numa-demo, region us-east-1 (HQ stack).
# Read:  hq-ops GSI3  (GSI3PK=TID#<displayId>, GSI3SK=TICKET) -> ticket item incl. `id` (UUID).
# Write: invoke hq_ops-api with an API-Gateway-shaped event + userContext
#        (skips JWT auth; pattern mirrors lambdas/python/workspace-chat-tools/tools/ops.py).
#
# Usage:
#   ops-ticket.sh get        '<TASK-151 | https://hq.numa.arcanum.ai/ops?ticket=TASK-151>'
#   ops-ticket.sh comment    <ticket> '<p>HTML comment body</p>'
#   ops-ticket.sh move-stage <ticket> <todo|blocked|in-progress|merge-request|review|done>
#
# NOTE: `get` (GSI3 read) is verified. The write paths for comment/move-stage are
# best-effort against the documented invoke pattern — confirm the exact route/body
# against the numa-ops skill the first time, then lock them in here.
set -uo pipefail

PROFILE="arcanum-prod-numa-demo"; REGION="us-east-1"
OPS_TABLE="hq-ops"; OPS_FN="hq_ops-api"
BOARD_ID="81f2560d-617a-46a4-83dc-7608a6dafc37"
STAFF_SUB="54888428-d011-70f6-e4be-d8baf30500c3"
STAFF_EMAIL="nathan@arcanum.ai"; STAFF_NAME="Nathan Douglas"

declare -A STAGES=(
  [todo]="a5e99e77-3ec1-4c1f-8406-d056d2f395a3"
  [blocked]="70db7c9e-e1c4-414f-b791-4bc7a8f32ba5"
  [in-progress]="f837ddd7-bd62-406a-848f-b6679853fffe"
  [merge-request]="7c025f8a-cf04-42e4-a694-d5b8ef0b49f2"
  [review]="753fb749-fbaf-44aa-bcf9-1e214953d125"
  [done]="a4c9f394-b60c-4d88-aada-80395c808a18"
)

displayid() {  # extract TASK-151 from a share URL or accept a bare id
  local in="$1"
  if [[ "$in" == *"ticket="* ]]; then echo "${in##*ticket=}" | sed 's/[&#].*//'; else echo "$in"; fi
}

query_gsi3() {  # $1=displayId -> raw DynamoDB Items JSON
  AWS_PROFILE="$PROFILE" aws dynamodb query --region "$REGION" \
    --table-name "$OPS_TABLE" --index-name GSI3 \
    --key-condition-expression 'GSI3PK = :pk AND GSI3SK = :sk' \
    --expression-attribute-values "{\":pk\":{\"S\":\"TID#$1\"},\":sk\":{\"S\":\"TICKET\"}}" \
    --output json
}

resolve_uuid() {  # $1=displayId -> ticket UUID
  query_gsi3 "$1" | python3 -c 'import json,sys; i=json.load(sys.stdin)["Items"]; print(i[0]["id"]["S"]) if i else sys.exit("ticket not found")'
}

invoke_ops() {  # $1=method $2=path $3=body(json string) -> response payload
  local method="$1" path="$2" body="$3"
  local payload
  payload=$(python3 - "$method" "$path" "$body" <<'PY'
import json,sys
method,path,body=sys.argv[1],sys.argv[2],sys.argv[3]
print(json.dumps({
  "requestContext":{"http":{"method":method,"path":path}},
  "rawPath":path,
  "headers":{"content-type":"application/json"},
  "queryStringParameters":{},
  "userContext":{"sub":"%SUB%","email":"%EMAIL%","name":"%NAME%","groups":["admin"]},
  "body":body,
}))
PY
)
  payload="${payload//%SUB%/$STAFF_SUB}"; payload="${payload//%EMAIL%/$STAFF_EMAIL}"; payload="${payload//%NAME%/$STAFF_NAME}"
  local out; out="$(mktemp)"
  AWS_PROFILE="$PROFILE" aws lambda invoke --region "$REGION" \
    --function-name "$OPS_FN" --cli-binary-format raw-in-base64-out \
    --payload "$payload" "$out" >/dev/null
  cat "$out"; echo; rm -f "$out"
}

cmd="${1:?usage: ops-ticket.sh <get|comment|move-stage> ...}"; shift || true
case "$cmd" in
  get)
    did="$(displayid "${1:?need a ticket id/URL}")"
    query_gsi3 "$did" | python3 -c '
import json,sys
items=json.load(sys.stdin)["Items"]
if not items: sys.exit("ticket not found: '"$did"'")
def u(d):  # unwrap a DynamoDB-typed dict shallowly
    return {k:(list(v.values())[0]) for k,v in d.items()}
t=u(items[0])
for f in ("displayId","title","stageId","ticketTypeId","assigneeName","priority","id","workUnitId"):
    if f in t: print(f"{f:14}: {t[f]}")
print("-"*60)
print(t.get("description","(no description)"))
'
    ;;
  comment)
    uuid="$(resolve_uuid "$(displayid "${1:?need ticket}")")"; html="${2:?need HTML body}"
    body=$(python3 -c 'import json,sys; print(json.dumps({"body":sys.argv[1]}))' "$html")
    echo "Posting comment to ticket $uuid ..."
    invoke_ops POST "/api/ops/tickets/$uuid/comments" "$body"
    ;;
  move-stage)
    uuid="$(resolve_uuid "$(displayid "${1:?need ticket}")")"; key="${2:?need stage name}"
    stage="${STAGES[$key]:?unknown stage '$key' (todo|blocked|in-progress|merge-request|review|done)}"
    body=$(python3 -c 'import json,sys; print(json.dumps({"stageId":sys.argv[1]}))' "$stage")
    echo "Moving ticket $uuid -> $key ($stage) ..."
    invoke_ops PATCH "/api/ops/tickets/$uuid" "$body"
    ;;
  *) echo "unknown command: $cmd (get|comment|move-stage)"; exit 2 ;;
esac
