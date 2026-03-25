#!/usr/bin/env bash
# ------------------------------------------------------------------
# Numa Daily Cost Report — Single-Day Deep Dive
# Comprehensive breakdown of AWS spend for one specific day.
#
# Usage:
#   ./tools/cost-report.sh                  # defaults to yesterday
#   ./tools/cost-report.sh 2026-03-18       # specific date
#
# Requires: aws cli, python3, profiles: default, arcanum-q-deployer-prod, q-demo
# ------------------------------------------------------------------
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
MGMT_PROFILE="${AWS_MGMT_PROFILE:-default}"
DEPLOYER_PROFILE="${AWS_DEPLOYER_PROFILE:-arcanum-q-deployer-prod}"
DEMO_PROFILE="${AWS_DEMO_PROFILE:-q-demo}"
REGION="us-east-1"

# Target date (default: yesterday)
if [[ $# -ge 1 ]]; then
  TARGET_DATE="$1"
else
  TARGET_DATE=$(python3 -c "from datetime import datetime, timedelta; print((datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d'))")
fi

NEXT_DATE=$(python3 -c "from datetime import datetime, timedelta; d=datetime.strptime('$TARGET_DATE','%Y-%m-%d'); print((d+timedelta(days=1)).strftime('%Y-%m-%d'))")
DAY_OF_WEEK=$(python3 -c "from datetime import datetime; print(datetime.strptime('$TARGET_DATE','%Y-%m-%d').strftime('%A'))")

# Epoch millis for DynamoDB queries
START_TS=$(python3 -c "from datetime import datetime; print(int(datetime.strptime('$TARGET_DATE','%Y-%m-%d').timestamp()*1000))")
END_TS=$(python3 -c "from datetime import datetime; print(int(datetime.strptime('$NEXT_DATE','%Y-%m-%d').timestamp()*1000))")

# Known accounts as JSON (avoids bash associative array which needs bash 4+)
ACCOUNT_NAMES_JSON='{
  "442483608950": "Arcanum AI (mgmt)",
  "905418183804": "Q Demo Account",
  "458119850496": "arcanum-dev",
  "262893720581": "arcanum-prod",
  "619071323471": "arcanum-prod-numa-demo",
  "324037291751": "arcanum-dev-q-deployer",
  "207567759910": "arcanum-prod-q-deployer",
  "872515258482": "arcanum-dev-q-client",
  "826326270637": "arcanum-prod-images",
  "975186400848": "arcanum-dev-images",
  "063563181233": "arcanum-dev-pipedream",
  "965745962688": "arcanum-prod-pipedream",
  "978450690680": "arcanum-quota-sharing",
  "024697547528": "client001",
  "095683376841": "client002",
  "869176217217": "client003",
  "897729140796": "finops-commitments-30",
  "359959955456": "playinthegrey"
}'

acct_name() {
  python3 -c "import json; names=$ACCOUNT_NAMES_JSON; print(names.get('$1', '$1'))"
}

# Tracked models
MODELS=("us.anthropic.claude-sonnet-4-6" "us.anthropic.claude-opus-4-6-v1" "us.anthropic.claude-haiku-4-5-20251001-v1:0")

# Client accounts with workspace agents (add more as needed)
CLIENT_ACCOUNT_ARNS=(
  "arn:aws:iam::619071323471:role/ArcanumAIAccess"
)
CLIENT_CHAT_TABLES=(
  "numa-hq-chat-history"
  "numa-arcanum-prod-numa-demo-chat-history"
  "numa-arcanum-prod-trial-chat-history"
)

# ── Helpers ───────────────────────────────────────────────────────
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
YELLOW='\033[33m'
RED='\033[31m'
GREEN='\033[32m'
MAGENTA='\033[35m'
RESET='\033[0m'

header()  { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${RESET}\n"; }
subhead() { echo -e "${BOLD}$1${RESET}"; }

assume_role() {
  local role_arn="$1"
  eval $(AWS_PROFILE="$DEPLOYER_PROFILE" aws sts assume-role \
    --role-arn "$role_arn" \
    --role-session-name "cost-report-$$" \
    --region "$REGION" \
    --output json 2>/dev/null | python3 -c "
import json, sys
c = json.load(sys.stdin)['Credentials']
print(f'export AWS_ACCESS_KEY_ID={c[\"AccessKeyId\"]}')
print(f'export AWS_SECRET_ACCESS_KEY={c[\"SecretAccessKey\"]}')
print(f'export AWS_SESSION_TOKEN={c[\"SessionToken\"]}')
")
}

clear_assumed_role() {
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
}

# ── Report ────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║        Numa Daily Cost Report — Deep Dive           ║"
echo "║        Date: $TARGET_DATE ($DAY_OF_WEEK)              ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${RESET}"

# ── 1. Executive Summary ─────────────────────────────────────────
header "1. Executive Summary"

SUMMARY_JSON=$(AWS_PROFILE="$MGMT_PROFILE" aws ce get-cost-and-usage \
  --time-period "Start=$TARGET_DATE,End=$NEXT_DATE" \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=RECORD_TYPE \
  --region "$REGION" \
  --output json 2>/dev/null)

echo "$SUMMARY_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for day in data['ResultsByTime']:
    gross = 0
    credits = 0
    for g in day.get('Groups', []):
        cost = float(g['Metrics']['BlendedCost']['Amount'])
        rtype = g['Keys'][0]
        if rtype == 'Usage':
            gross = cost
        elif 'Credit' in rtype or 'Refund' in rtype or cost < 0:
            credits += cost
    net = gross + credits
    print(f'  Gross usage:    \${gross:>10.2f}')
    print(f'  Credits/other:  \${credits:>10.2f}')
    print(f'                  ────────────')
    print(f'  Net cost:       \${net:>10.2f}')
"

# ── 2. Budget Status ────────────────────────────────────────────
header "2. Budget Status"

MGMT_ACCOUNT=$(AWS_PROFILE="$MGMT_PROFILE" aws sts get-caller-identity --query Account --output text 2>/dev/null)
echo "Management account: $MGMT_ACCOUNT"

AWS_PROFILE="$MGMT_PROFILE" aws budgets describe-budgets \
  --account-id "$MGMT_ACCOUNT" \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for b in data.get('Budgets', []):
    name = b['BudgetName']
    limit = b['BudgetLimit']
    actual = b.get('CalculatedSpend', {}).get('ActualSpend', {})
    forecast = b.get('CalculatedSpend', {}).get('ForecastedSpend', {})
    ct = b.get('CostTypes', {})
    inc_credit = ct.get('IncludeCredit', True)

    actual_amt = float(actual.get('Amount', 0))
    limit_amt = float(limit.get('Amount', 0))
    forecast_amt = float(forecast.get('Amount', 0)) if forecast else 0
    pct = (actual_amt / limit_amt * 100) if limit_amt else 0

    status = '🟢' if pct < 80 else ('🟡' if pct < 100 else '🔴')
    credit_warn = '  ⚠️  IncludeCredit=false (gross costs, not net)' if not inc_credit else ''
    forecast_str = f'  forecast: \${forecast_amt:.2f}' if forecast_amt else ''

    print(f'{status} {name}')
    print(f'   Spend:    \${actual_amt:.2f} / \${limit_amt:.2f} ({pct:.0f}%) [{b[\"TimeUnit\"]}]{credit_warn}')
    if forecast_str:
        print(f'   Forecast: \${forecast_amt:.2f} ({forecast_amt/limit_amt*100:.0f}% of limit)')
    print()
"

# ── 3. Top Services ──────────────────────────────────────────────
header "3. Service Breakdown ($TARGET_DATE)"

AWS_PROFILE="$MGMT_PROFILE" aws ce get-cost-and-usage \
  --time-period "Start=$TARGET_DATE,End=$NEXT_DATE" \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}' \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for day in data['ResultsByTime']:
    services = sorted(day['Groups'], key=lambda x: float(x['Metrics']['BlendedCost']['Amount']), reverse=True)
    total = sum(float(s['Metrics']['BlendedCost']['Amount']) for s in services)
    print(f'  Total gross usage: \${total:.2f}')
    print()

    # Table header
    print(f'  {\"Service\":55s}  {\"Cost\":>10s}  {\"Share\":>6s}  Distribution')
    print(f'  {\"─\"*55}  {\"─\"*10}  {\"─\"*6}  {\"─\"*30}')

    for s in services:
        cost = float(s['Metrics']['BlendedCost']['Amount'])
        if cost > 0.01:
            pct = cost / total * 100 if total else 0
            bar = '█' * int(pct / 2)
            name = s['Keys'][0]
            # Shorten common prefixes
            name = name.replace(' (Amazon Bedrock Edition)', '')
            print(f'  {name:55s}  \${cost:>8.2f}  {pct:5.1f}%  {bar}')

    # Count services under threshold
    under_threshold = [s for s in services if 0 < float(s['Metrics']['BlendedCost']['Amount']) <= 0.01]
    if under_threshold:
        print(f'  ... plus {len(under_threshold)} services under \$0.01')
"

# ── 4. Credits & Adjustments ─────────────────────────────────────
header "4. Credits & Adjustments ($TARGET_DATE)"

echo "$SUMMARY_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for day in data['ResultsByTime']:
    groups = sorted(day['Groups'], key=lambda x: float(x['Metrics']['BlendedCost']['Amount']), reverse=True)
    for g in groups:
        cost = float(g['Metrics']['BlendedCost']['Amount'])
        rtype = g['Keys'][0]
        if abs(cost) > 0.01:
            indicator = '  ' if cost >= 0 else '💰'
            print(f'  {indicator} {rtype:35s} \${cost:>10.2f}')
    total = sum(float(g['Metrics']['BlendedCost']['Amount']) for g in groups)
    print(f'     {\"\":35s} ────────────')
    print(f'     {\"Net cost\":35s} \${total:>10.2f}')
"

# ── 5. Cost by Account ───────────────────────────────────────────
header "5. Cost by Linked Account ($TARGET_DATE)"

AWS_PROFILE="$MGMT_PROFILE" aws ce get-cost-and-usage \
  --time-period "Start=$TARGET_DATE,End=$NEXT_DATE" \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}' \
  --group-by Type=DIMENSION,Key=LINKED_ACCOUNT \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import json, sys

names = $ACCOUNT_NAMES_JSON

data = json.load(sys.stdin)
for day in data['ResultsByTime']:
    accounts = sorted(day['Groups'], key=lambda x: float(x['Metrics']['BlendedCost']['Amount']), reverse=True)
    total = sum(float(a['Metrics']['BlendedCost']['Amount']) for a in accounts)

    print(f'  {\"Account\":40s}  {\"Cost\":>10s}  {\"Share\":>6s}  Distribution')
    print(f'  {\"─\"*40}  {\"─\"*10}  {\"─\"*6}  {\"─\"*30}')

    for a in accounts:
        cost = float(a['Metrics']['BlendedCost']['Amount'])
        if cost > 0.10:
            acct_id = a['Keys'][0]
            name = names.get(acct_id, acct_id)
            pct = cost / total * 100 if total else 0
            bar = '█' * int(pct / 2)
            label = f'{name} ({acct_id})'
            print(f'  {label:40s}  \${cost:>8.2f}  {pct:5.1f}%  {bar}')

    under = [a for a in accounts if 0 < float(a['Metrics']['BlendedCost']['Amount']) <= 0.10]
    if under:
        under_total = sum(float(a['Metrics']['BlendedCost']['Amount']) for a in under)
        print(f'  {f\"... {len(under)} accounts under \$0.10\":40s}  \${under_total:>8.2f}')
"

# ── 6. Top Account Service Drill-Down ────────────────────────────
header "6. Per-Account Service Drill-Down ($TARGET_DATE)"

AWS_PROFILE="$MGMT_PROFILE" aws ce get-cost-and-usage \
  --time-period "Start=$TARGET_DATE,End=$NEXT_DATE" \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --filter '{"Dimensions":{"Key":"RECORD_TYPE","Values":["Usage"]}}' \
  --group-by Type=DIMENSION,Key=LINKED_ACCOUNT Type=DIMENSION,Key=SERVICE \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import json, sys
from collections import defaultdict

names = $ACCOUNT_NAMES_JSON

data = json.load(sys.stdin)
for day in data['ResultsByTime']:
    # Build account -> [(service, cost)] mapping
    accounts = defaultdict(list)
    for g in day.get('Groups', []):
        acct_id = g['Keys'][0]
        service = g['Keys'][1].replace(' (Amazon Bedrock Edition)', '')
        cost = float(g['Metrics']['BlendedCost']['Amount'])
        if cost > 0.01:
            accounts[acct_id].append((service, cost))

    # Sort accounts by total cost descending
    acct_totals = [(aid, sum(c for _, c in svcs), svcs) for aid, svcs in accounts.items()]
    acct_totals.sort(key=lambda x: x[1], reverse=True)

    for acct_id, total, services in acct_totals:
        if total < 0.50:
            continue
        name = names.get(acct_id, acct_id)
        print(f'  {name} ({acct_id}) — \${total:.2f}')

        services.sort(key=lambda x: x[1], reverse=True)
        for svc, cost in services[:8]:
            pct = cost / total * 100 if total else 0
            bar = '█' * max(1, int(pct / 5))
            print(f'    \${cost:>8.2f}  ({pct:4.1f}%)  {svc[:50]:50s} {bar}')
        if len(services) > 8:
            rest = sum(c for _, c in services[8:])
            print(f'    \${rest:>8.2f}          ... {len(services)-8} more services')
        print()
"

# ── 7. Bedrock Model Usage ───────────────────────────────────────
header "7. Bedrock Model Invocations & Tokens ($TARGET_DATE)"

echo "Checking accounts with workspace agents..."
echo ""

# Function to report model usage for an account
report_model_usage() {
  local label="$1"
  local found_any=false

  for model in "${MODELS[@]}"; do
    model_short=$(echo "$model" | sed 's/us\.anthropic\.//; s/global\.anthropic\.//')

    invocations=$(aws cloudwatch get-metric-statistics \
      --namespace AWS/Bedrock --metric-name Invocations \
      --start-time "${TARGET_DATE}T00:00:00Z" --end-time "${NEXT_DATE}T00:00:00Z" \
      --period 86400 --statistics Sum \
      --dimensions Name=ModelId,Value="$model" \
      --region "$REGION" --output json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for dp in d.get('Datapoints',[]): print(f'{dp[\"Sum\"]:.0f}')
" 2>/dev/null)

    if [[ -n "$invocations" && "$invocations" != "0" ]]; then
      found_any=true

      input_tokens=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Bedrock --metric-name InputTokenCount \
        --start-time "${TARGET_DATE}T00:00:00Z" --end-time "${NEXT_DATE}T00:00:00Z" \
        --period 86400 --statistics Sum \
        --dimensions Name=ModelId,Value="$model" \
        --region "$REGION" --output json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for dp in d.get('Datapoints',[]): print(f'{dp[\"Sum\"]:.0f}')
" 2>/dev/null)

      output_tokens=$(aws cloudwatch get-metric-statistics \
        --namespace AWS/Bedrock --metric-name OutputTokenCount \
        --start-time "${TARGET_DATE}T00:00:00Z" --end-time "${NEXT_DATE}T00:00:00Z" \
        --period 86400 --statistics Sum \
        --dimensions Name=ModelId,Value="$model" \
        --region "$REGION" --output json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for dp in d.get('Datapoints',[]): print(f'{dp[\"Sum\"]:.0f}')
" 2>/dev/null)

      # Format token counts with K/M suffixes
      python3 -c "
inv = ${invocations:-0}
inp = ${input_tokens:-0}
out = ${output_tokens:-0}

def fmt(n):
    if n >= 1_000_000: return f'{n/1_000_000:.1f}M'
    if n >= 1_000: return f'{n/1_000:.1f}K'
    return str(int(n))

print(f'  {\"$label\":25s}  {\"$model_short\":35s}')
print(f'    Invocations:    {inv:>8,}')
print(f'    Input tokens:   {fmt(inp):>8s}  ({inp:>12,.0f})')
print(f'    Output tokens:  {fmt(out):>8s}  ({out:>12,.0f})')
print(f'    Avg in/call:    {fmt(inp/inv) if inv else \"n/a\":>8s}')
print(f'    Avg out/call:   {fmt(out/inv) if inv else \"n/a\":>8s}')
print()
"
    fi
  done

  if [[ "$found_any" == "false" ]]; then
    echo "  $label: (no invocations)"
  fi
}

# Q Demo account (direct profile access)
(
  export AWS_PROFILE="$DEMO_PROFILE"
  report_model_usage "Q Demo (905418183804)"
)

# Client accounts via deployer assume-role
for role_arn in "${CLIENT_ACCOUNT_ARNS[@]}"; do
  acct_id=$(echo "$role_arn" | sed 's/.*::\([0-9]*\):.*/\1/')
  acct_label=$(acct_name "$acct_id")
  (
    assume_role "$role_arn"
    report_model_usage "$acct_label ($acct_id)"
  )
done

# ── 8. Hourly Invocation Heatmap ─────────────────────────────────
header "8. Hourly Invocation Heatmap ($TARGET_DATE)"

echo -e "${DIM}  Times are UTC. NZ is UTC+13.${RESET}"
echo ""

for model in "${MODELS[@]}"; do
  model_short=$(echo "$model" | sed 's/us\.anthropic\.//; s/global\.anthropic\.//')

  (
    assume_role "${CLIENT_ACCOUNT_ARNS[0]}"

    result=$(aws cloudwatch get-metric-statistics \
      --namespace AWS/Bedrock --metric-name Invocations \
      --start-time "${TARGET_DATE}T00:00:00Z" --end-time "${NEXT_DATE}T00:00:00Z" \
      --period 3600 --statistics Sum \
      --dimensions Name=ModelId,Value="$model" \
      --region "$REGION" --output json 2>/dev/null)

    echo "$result" | python3 -c "
import json, sys
data = json.load(sys.stdin)
dps = sorted(data.get('Datapoints', []), key=lambda x: x['Timestamp'])
if not dps:
    print(f'  $model_short: (no data)')
    print()
else:
    print(f'  $model_short')
    max_val = max(int(dp['Sum']) for dp in dps) or 1

    # Fill in missing hours
    hours = {}
    for dp in dps:
        h = int(dp['Timestamp'][11:13])
        hours[h] = int(dp['Sum'])

    for h in range(24):
        inv = hours.get(h, 0)
        bar_len = int(inv / max_val * 40) if max_val else 0
        bar = '█' * bar_len
        nz_h = (h + 13) % 24
        label = '░' if 6 <= nz_h <= 22 else ' '  # NZ business-ish hours
        print(f'    {h:02d}:00 (NZ {nz_h:02d}:00) {label} {inv:5d}  {bar}')
    print()
"
  )
done

# Also check Q Demo for hourly
(
  export AWS_PROFILE="$DEMO_PROFILE"

  for model in "${MODELS[@]}"; do
    model_short=$(echo "$model" | sed 's/us\.anthropic\.//; s/global\.anthropic\.//')

    result=$(aws cloudwatch get-metric-statistics \
      --namespace AWS/Bedrock --metric-name Invocations \
      --start-time "${TARGET_DATE}T00:00:00Z" --end-time "${NEXT_DATE}T00:00:00Z" \
      --period 3600 --statistics Sum \
      --dimensions Name=ModelId,Value="$model" \
      --region "$REGION" --output json 2>/dev/null)

    has_data=$(echo "$result" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print('yes' if data.get('Datapoints') else 'no')
")

    if [[ "$has_data" == "yes" ]]; then
      echo "$result" | python3 -c "
import json, sys
data = json.load(sys.stdin)
dps = sorted(data.get('Datapoints', []), key=lambda x: x['Timestamp'])
if dps:
    print(f'  Q Demo — $model_short')
    max_val = max(int(dp['Sum']) for dp in dps) or 1
    hours = {}
    for dp in dps:
        h = int(dp['Timestamp'][11:13])
        hours[h] = int(dp['Sum'])
    for h in range(24):
        inv = hours.get(h, 0)
        bar_len = int(inv / max_val * 40) if max_val else 0
        bar = '█' * bar_len
        nz_h = (h + 13) % 24
        label = '░' if 6 <= nz_h <= 22 else ' '
        print(f'    {h:02d}:00 (NZ {nz_h:02d}:00) {label} {inv:5d}  {bar}')
    print()
"
    fi
  done
)

# ── 9. AgentCore Runtime ─────────────────────────────────────────
header "9. AgentCore MicroVM Compute ($TARGET_DATE)"

AWS_PROFILE="$MGMT_PROFILE" aws ce get-cost-and-usage \
  --time-period "Start=$TARGET_DATE,End=$NEXT_DATE" \
  --granularity DAILY \
  --metrics "BlendedCost" "UsageQuantity" \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock AgentCore"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
found = False
total_cost = 0
for day in data['ResultsByTime']:
    for g in day.get('Groups', []):
        cost = float(g['Metrics']['BlendedCost']['Amount'])
        usage = float(g['Metrics']['UsageQuantity']['Amount'])
        if usage > 0:
            found = True
            total_cost += cost
            utype = g['Keys'][0]

            # Derive friendly units
            if 'vCPU' in utype:
                unit = 'vCPU-sec'
                # Convert to hours for readability
                hours = usage / 3600
                extra = f'  ({hours:.1f} vCPU-hours)'
            elif 'Memory' in utype:
                unit = 'MB-sec'
                gb_hours = usage / (1024 * 3600)
                extra = f'  ({gb_hours:.1f} GB-hours)'
            else:
                unit = 'units'
                extra = ''

            print(f'  {utype:55s}')
            print(f'    Usage: {usage:>12,.1f} {unit}{extra}')
            print(f'    Cost:  \${cost:.2f}')
            print()

if found:
    print(f'  Total AgentCore cost: \${total_cost:.2f}')
else:
    print('  (no AgentCore usage)')
"

# ── 10. Workspace Chat Activity ──────────────────────────────────
header "10. Workspace Chat Activity ($TARGET_DATE)"

(
  assume_role "${CLIENT_ACCOUNT_ARNS[0]}"

  # Get Cognito user pool and build user map
  POOL_ID=$(aws cognito-idp list-user-pools --max-results 10 --region "$REGION" --output json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for p in data.get('UserPools', []):
    print(p['Id'])
    break
")

  USER_MAP=$(aws cognito-idp list-users \
    --user-pool-id "$POOL_ID" \
    --region "$REGION" \
    --output json 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
m = {}
for u in data.get('Users', []):
    attrs = {a['Name']: a['Value'] for a in u.get('Attributes', [])}
    sub = attrs.get('sub', '')
    email = attrs.get('email', '')
    if sub and email:
        m[sub] = email
print(json.dumps(m))
")

  for table in "${CLIENT_CHAT_TABLES[@]}"; do
    subhead "  Table: $table"

    # Scan for meta records active on the target date
    aws dynamodb scan \
      --table-name "$table" \
      --region "$REGION" \
      --filter-expression "message_type = :mt AND (latestTimestamp BETWEEN :start AND :end OR #ts BETWEEN :start AND :end)" \
      --expression-attribute-names '{"#ts":"timestamp"}' \
      --expression-attribute-values "{\":mt\":{\"S\":\"meta\"},\":start\":{\"N\":\"$START_TS\"},\":end\":{\"N\":\"$END_TS\"}}" \
      --projection-expression "user_id, conversation_id, conversationName, latestTimestamp, agentTitle" \
      --output json 2>/dev/null | python3 -c "
import json, sys, datetime

user_map = json.loads('$USER_MAP')
data = json.load(sys.stdin)
items = data.get('Items', [])

if not items:
    print('    (no activity)')
    sys.exit(0)

users = {}
for item in items:
    uid = item.get('user_id', {}).get('S', 'unknown')
    name = item.get('conversationName', {}).get('S', '')
    agent = item.get('agentTitle', {}).get('S', '')
    ts = int(item.get('latestTimestamp', {}).get('N', '0'))
    email = user_map.get(uid, uid[:20])
    if email not in users:
        users[email] = []
    users[email].append({'name': name, 'agent': agent, 'ts': ts})

print(f'    Active conversations: {len(items)}')
print(f'    Unique users:         {len(users)}')
print()
for email, convos in sorted(users.items(), key=lambda x: len(x[1]), reverse=True):
    print(f'    {email} ({len(convos)} conversations)')
    for c in sorted(convos, key=lambda x: x['ts'], reverse=True)[:5]:
        ts_str = datetime.datetime.fromtimestamp(c['ts']/1000).strftime('%H:%M') if c['ts'] else '??:??'
        agent_info = f' [{c[\"agent\"]}]' if c['agent'] else ''
        print(f'      {ts_str} {c[\"name\"][:60]}{agent_info}')
    if len(convos) > 5:
        print(f'      ... and {len(convos)-5} more')
    print()
" 2>/dev/null || echo "    (scan failed or table not found)"
  done

  # Message count per user
  subhead "  Message counts by user (all HQ tables)"

  aws dynamodb scan \
    --table-name "numa-hq-chat-history" \
    --region "$REGION" \
    --filter-expression "#ts BETWEEN :start AND :end" \
    --expression-attribute-names '{"#ts":"timestamp"}' \
    --expression-attribute-values "{\":start\":{\"N\":\"$START_TS\"},\":end\":{\"N\":\"$END_TS\"}}" \
    --projection-expression "user_id" \
    --output json 2>/dev/null | python3 -c "
import json, sys

user_map = json.loads('$USER_MAP')
data = json.load(sys.stdin)
items = data.get('Items', [])

counts = {}
for item in items:
    uid = item.get('user_id', {}).get('S', 'unknown')
    email = user_map.get(uid, uid[:20])
    counts[email] = counts.get(email, 0) + 1

print(f'    Total messages: {len(items)}')
print()
for email, count in sorted(counts.items(), key=lambda x: x[1], reverse=True):
    bar = '█' * (count // 5)
    print(f'    {count:5d}  {email:35s} {bar}')
" 2>/dev/null || echo "    (scan failed)"
)

# ── 11. AI Services Cost Breakdown ───────────────────────────────
header "11. AI Services Cost Breakdown ($TARGET_DATE)"

AWS_PROFILE="$MGMT_PROFILE" aws ce get-cost-and-usage \
  --time-period "Start=$TARGET_DATE,End=$NEXT_DATE" \
  --granularity DAILY \
  --metrics "BlendedCost" \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Claude Sonnet 4.6 (Amazon Bedrock Edition)","Claude Opus 4.6 (Amazon Bedrock Edition)","Amazon Bedrock AgentCore","Claude Sonnet 4.5 (Amazon Bedrock Edition)","Claude 3.5 Sonnet (Amazon Bedrock Edition)","Claude Haiku 4.5 (Amazon Bedrock Edition)","Claude 3 Haiku (Amazon Bedrock Edition)","Claude Sonnet 4 (Amazon Bedrock Edition)","Amazon Bedrock"]}}' \
  --group-by Type=DIMENSION,Key=SERVICE \
  --region "$REGION" \
  --output json 2>/dev/null | python3 -c "
import json, sys

data = json.load(sys.stdin)
for day in data['ResultsByTime']:
    groups = day.get('Groups', [])
    costs = []
    for g in groups:
        service = g['Keys'][0].replace(' (Amazon Bedrock Edition)', '')
        cost = float(g['Metrics']['BlendedCost']['Amount'])
        if cost > 0.001:
            costs.append((service, cost))

    costs.sort(key=lambda x: x[1], reverse=True)
    total = sum(c for _, c in costs)

    if not costs:
        print('  (no AI service costs)')
    else:
        print(f'  Total AI spend: \${total:.2f}')
        print()
        max_cost = costs[0][1] if costs else 1
        for service, cost in costs:
            pct = cost / total * 100 if total else 0
            bar = '█' * max(1, int(cost / max_cost * 30))
            print(f'  \${cost:>8.2f}  ({pct:5.1f}%)  {service:45s} {bar}')
"

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Report complete for $TARGET_DATE ($DAY_OF_WEEK).${RESET}"
echo ""
echo -e "${DIM}To investigate further:${RESET}"
echo "  - Check specific user's conversations in DynamoDB"
echo "  - Review AgentCore vendedlogs in CloudWatch"
echo "  - Compare with another day: ./tools/cost-report.sh <date>"
echo ""
