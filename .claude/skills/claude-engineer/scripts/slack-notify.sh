#!/usr/bin/env bash
# claude-engineer / slack-notify.sh
#
# Post an MR/ticket update to Slack as "Claude Engineer", with rendered image
# attachments. Slack won't let one message carry BOTH a custom username/icon AND
# file attachments, so we do:
#   1. an aliased header (chat.postMessage via slack-send-message) — username +
#      icon, the MR/ticket/dot-points; capture its ts.
#   2. the screenshots threaded under it, via the custom ~/slack-upload-files
#      Pipedream action (one reply, multiple attachments, filenames we control).
#
# Why ~/slack-upload-files (not the stock slack-upload-file): it posts ONE message
# with several files (native files.completeUploadExternal), sets each filename so
# attachments render even from a messy presigned URL, and — being a custom action,
# not a raw proxy_request — bypasses the media-upload guard. Source + publish notes:
# pipedream-components/slack/. Published dev+prod.
#
# Requires: numa CLI built + logged into <client> (Slack connected via Pipedream),
# and AWS creds for the client account (to presign the images).
#
# Usage:
#   slack-notify.sh --client nd-labs --aws-profile q-demo --region us-east-1 \
#     --to '<C…channel | U…user | D…dm>' --message '<slack mrkdwn header>' \
#     [--alias 'Claude Engineer'] [--icon ':claude-code:'] [--as-user] \
#     [--caption 'Screenshots:'] img1.png img2.png …
#
#   --to        channel (C…), DM (D…), or user id (U…; resolves to the self-DM)
#   --alias/--icon   post the header as this bot username + icon_emoji (channels &
#                    your self-DM only — NOT the Pipedream bot DM)
#   --as-user   post the header as the authed Slack user instead of a bot alias
#               (mutually exclusive with --alias)
set -uo pipefail

CLIENT=""; AWS_PROFILE_ARG=""; REGION="us-east-1"; TO=""; MESSAGE=""
ALIAS=""; ICON=""; AS_USER="false"; CAPTION=""
FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --client) CLIENT="$2"; shift 2;;
    --aws-profile) AWS_PROFILE_ARG="$2"; shift 2;;
    --region) REGION="$2"; shift 2;;
    --to) TO="$2"; shift 2;;
    --message) MESSAGE="$2"; shift 2;;
    --alias) ALIAS="$2"; shift 2;;
    --icon) ICON="$2"; shift 2;;
    --as-user) AS_USER="true"; shift;;
    --caption) CAPTION="$2"; shift 2;;
    -*) echo "unknown flag: $1" >&2; exit 2;;
    *) FILES+=("$1"); shift;;
  esac
done
: "${CLIENT:?--client required}"; : "${TO:?--to required}"; : "${MESSAGE:?--message required}"
export AWS_PROFILE="${AWS_PROFILE_ARG:-${AWS_PROFILE:-q-demo}}"
BUCKET="numa-${CLIENT}-outputs"
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)"
CLI="$ROOT/numa-cli/packages/cli/dist/cli/numa.js"
[[ -f "$CLI" ]] || { echo "numa CLI not built at $CLI (yarn build in numa-cli)"; exit 1; }

jget() { python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('result',{}).get('ret',{}) or {};print(r.get('$1',''))"; }

# ── 1. aliased header → capture conversation id + ts ──────────────────────────
hdr_props() {
  python3 - "$TO" "$MESSAGE" "$AS_USER" "$ALIAS" "$ICON" <<'PY'
import json,sys
to,msg,as_user,alias,icon = sys.argv[1:6]
p={"slack":{"authProvisionId":"auto"},"conversation":to,"text":msg,"mrkdwn":True,
   "include_sent_via_pipedream_flag":False}
if alias:
    p["username"]=alias
    if icon: p["icon_emoji"]=icon
elif as_user=="true":
    p["as_user"]=True
print(json.dumps(p))
PY
}
echo "→ posting header to $TO …"
OUT="$(node "$CLI" integrations pipedream-call slack slack-send-message --props "$(hdr_props)" -m "claude-engineer: header" 2>&1)"
CONV="$(printf '%s' "$OUT" | jget channel)"; TS="$(printf '%s' "$OUT" | jget ts)"
if [[ -z "$TS" ]]; then echo "header send failed:"; printf '%s\n' "$OUT" | head -5; exit 1; fi
echo "  header ts=$TS in $CONV"
[[ ${#FILES[@]} -eq 0 ]] && { echo "no files — header only."; exit 0; }

# ── 2. presign images, then upload them threaded under the header ─────────────
STAMP="$(date +%s)"; URLS=(); NAMES=()
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "  skip (not found): $f"; continue; }
  name="$(basename "$f")"
  key="_claude-engineer/slack/${STAMP}-${name}"
  ctype="$(python3 -c 'import mimetypes,sys;print(mimetypes.guess_type(sys.argv[1])[0] or "application/octet-stream")' "$f")"
  aws s3 cp "$f" "s3://$BUCKET/$key" --content-type "$ctype" --region "$REGION" >/dev/null 2>&1 \
    || { echo "  s3 upload failed: $f"; continue; }
  URLS+=("$(aws s3 presign "s3://$BUCKET/$key" --expires-in 3600 --region "$REGION")")
  NAMES+=("$name")
done
[[ ${#URLS[@]} -eq 0 ]] && { echo "no uploadable files."; exit 1; }

UP_PROPS="$(python3 - "$CONV" "$TS" "$CAPTION" "${URLS[@]}" "::SEP::" "${NAMES[@]}" <<'PY'
import json,sys
conv,ts,caption=sys.argv[1],sys.argv[2],sys.argv[3]
rest=sys.argv[4:]; sep=rest.index("::SEP::")
urls,names=rest[:sep],rest[sep+1:]
p={"slack":{"authProvisionId":"auto"},"conversation":conv,"threadTs":ts,
   "fileUrls":urls,"filenames":names}
if caption: p["initialComment"]=caption
print(json.dumps(p))
PY
)"
echo "→ uploading ${#URLS[@]} file(s) threaded under the header …"
OUT2="$(node "$CLI" integrations pipedream-call slack "~/slack-upload-files" --props "$UP_PROPS" -m "claude-engineer: screenshots" 2>&1)"
if [[ "$(printf '%s' "$OUT2" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status"))' 2>/dev/null)" == "success" ]]; then
  echo "  ✓ posted ${#URLS[@]} attachment(s)."
else
  echo "  ✗ upload failed:"; printf '%s\n' "$OUT2" | head -8
fi
