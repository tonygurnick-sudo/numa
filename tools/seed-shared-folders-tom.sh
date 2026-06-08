#!/usr/bin/env bash
#
# seed-shared-folders-tom.sh — seed shared KB folders owned by other users and
# shared WITH tom.wiltshire@arcanum.ai (as viewer/editor, never owner), so the
# "Leave folder" flow (FEAT-219) can be tested. One-off dev helper.
#
# Usage: AWS_PROFILE=q-demo bash tools/seed-shared-folders-tom.sh
#
# Idempotent: stable KB ids, so re-running overwrites the same records/objects.
set -euo pipefail

CLIENT="arcanum-demo-tom"
REGION="us-east-1"
BUCKET="numa-${CLIENT}-data"
TABLE="numa-${CLIENT}-knowledge-bases"
TENANT_PK="TENANT#${CLIENT}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

TOM="8458a428-3001-706b-caab-3b76207c65fb" # tom.wiltshire@arcanum.ai (the member, not owner)

# name | stable-kb-id | owner-sub | owner-label | tom-role
FOLDERS=(
  "Marketing Assets|22222222-0001-4219-8aaa-000000000001|f4183448-50f1-702e-34dd-08cd0371710a|Connor|VIEWER"
  "Sales Playbook|22222222-0002-4219-8aaa-000000000002|046834e8-e0a1-70a2-15ff-1f4bfe9f7317|Jayson|EDITOR"
  "Engineering RFCs|22222222-0003-4219-8aaa-000000000003|f448b418-8011-70e9-1756-5e8af4dd1e87|Nathan|EDITOR"
  "Product Roadmap|22222222-0004-4219-8aaa-000000000004|04f82418-a081-703e-db7c-2d5f86a43b48|Ian|VIEWER"
  "Customer Contracts|22222222-0005-4219-8aaa-000000000005|a498e408-3011-701e-d0a1-98cb67b34d8f|Pras|VIEWER"
  "Design System|22222222-0006-4219-8aaa-000000000006|94183498-d051-70ee-845e-f69a57ba8caa|Greg|EDITOR"
  "Leadership Notes|22222222-0007-4219-8aaa-000000000007|84c884c8-1041-7069-8dd4-988de0b02f37|Asa|VIEWER"
)

ROOT="$(mktemp -d /tmp/numa-shared.XXXXXX)"
trap 'rm -rf "$ROOT"' EXIT
mk() { mkdir -p "$(dirname "$1")"; printf '%b\n' "$2" > "$1"; }

put_kb() {
  local kb_id="$1" name="$2" prefix="$3" owner="$4" viewers_json="$5" editors_json="$6"
  aws dynamodb put-item --table-name "$TABLE" --region "$REGION" --item "{
    \"PK\":{\"S\":\"${TENANT_PK}\"},
    \"SK\":{\"S\":\"KB#${kb_id}\"},
    \"kb_id\":{\"S\":\"${kb_id}\"},
    \"kb_name\":{\"S\":\"${name}\"},
    \"s3_prefix\":{\"S\":\"${prefix}\"},
    \"is_default\":{\"BOOL\":false},
    \"viewers\":${viewers_json},
    \"editors\":${editors_json},
    \"personas\":{\"L\":[]},
    \"industries\":{\"L\":[]},
    \"created_by\":{\"S\":\"${owner}\"},
    \"created_at\":{\"S\":\"${NOW}\"},
    \"updated_at\":{\"S\":\"${NOW}\"},
    \"status\":{\"S\":\"ACTIVE\"}
  }"
}

put_membership() {
  local kb_id="$1" name="$2" user="$3" role="$4"
  aws dynamodb put-item --table-name "$TABLE" --region "$REGION" --item "{
    \"PK\":{\"S\":\"${TENANT_PK}\"},
    \"SK\":{\"S\":\"KBMEM#${kb_id}#USER#${user}\"},
    \"GSI1PK\":{\"S\":\"USER#${user}\"},
    \"GSI1SK\":{\"S\":\"KB#${kb_id}\"},
    \"kb_id\":{\"S\":\"${kb_id}\"},
    \"kb_name\":{\"S\":\"${name}\"},
    \"role\":{\"S\":\"${role}\"}
  }"
}

for spec in "${FOLDERS[@]}"; do
  IFS='|' read -r NAME KB_ID OWNER OWNER_LABEL TOM_ROLE <<< "$spec"
  PREFIX="documents/kb-${KB_ID}/"
  echo "→ ${NAME} (owner ${OWNER_LABEL}, tom=${TOM_ROLE})"

  # viewers always include owner + tom; editors include tom only when EDITOR.
  VIEWERS="{\"SS\":[\"${OWNER}\",\"${TOM}\"]}"
  if [ "$TOM_ROLE" = "EDITOR" ]; then
    EDITORS="{\"SS\":[\"${OWNER}\",\"${TOM}\"]}"
  else
    EDITORS="{\"SS\":[\"${OWNER}\"]}"
  fi

  put_kb "$KB_ID" "$NAME" "$PREFIX" "$OWNER" "$VIEWERS" "$EDITORS"
  put_membership "$KB_ID" "$NAME" "$OWNER" "OWNER"
  put_membership "$KB_ID" "$NAME" "$TOM" "$TOM_ROLE"

  # A little content so the folder isn't empty.
  D="$ROOT/$KB_ID"
  mk "$D/README.md"          "# ${NAME}\n\nShared by ${OWNER_LABEL}. You are a ${TOM_ROLE} on this folder."
  mk "$D/overview.md"        "# ${NAME} — Overview\n\nThis is test content for the shared folder \"${NAME}\"."
  mk "$D/Docs/getting-started.md" "# Getting Started\n\nNotes for ${NAME}."
  mk "$D/Docs/faq.md"        "# FAQ\n\nQ: Can I leave this folder?\nA: Yes — that's what we're testing."
  aws s3 cp "$D" "s3://${BUCKET}/${PREFIX}" --recursive --region "$REGION" --only-show-errors
done

echo "Done. Seeded ${#FOLDERS[@]} shared folders for tom.wiltshire@arcanum.ai."
