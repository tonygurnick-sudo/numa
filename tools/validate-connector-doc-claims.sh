#!/usr/bin/env bash
# Validates every mechanically-checkable claim in ext-api-doc/ that was
# added or "VERIFIED 2026-05-19" during this session.
#
# PASS  = claim is currently verifiable against the cited primary source
# FAIL  = claim no longer matches the primary source (doc drift OR I lied)
# SKIP  = needs auth / not externally checkable
#
# Usage: bash tools/validate-connector-doc-claims.sh

set -u
PASS=0; FAIL=0; SKIP=0

pass() { echo "  PASS  $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL  $*"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP  $*"; SKIP=$((SKIP+1)); }
hdr()  { echo; echo "=== $* ==="; }

# ── 1. FERGUS — OpenAPI spec endpoint claims ──────────────────────────────────
hdr "FERGUS — /jobs/{jobId}/finalise is PUT (not POST), /version shape, /company exists, /my-company doesn't"

curl -s --max-time 15 https://api.fergus.com/docs/json > /tmp/fergus-spec.json
if [ ! -s /tmp/fergus-spec.json ]; then
  fail "could not download api.fergus.com/docs/json"
else
  python3 - <<'PY' || true
import json, sys
s = json.load(open('/tmp/fergus-spec.json'))
checks = {
    '/jobs/{jobId}/finalise': ('put',  'PUT'),
    '/company':               ('get',  'GET'),
    '/version':               ('get',  'GET'),
}
for path, (verb, label) in checks.items():
    if path not in s['paths']:
        print(f"  FAIL  {path}: not present in spec")
        continue
    methods = [m for m in s['paths'][path] if m in ('get','put','post','patch','delete')]
    if verb in methods and len(methods) == 1:
        print(f"  PASS  {path}: only {label} (matches doc)")
    else:
        print(f"  FAIL  {path}: methods={methods}, expected only [{verb}]")
if '/my-company' in s['paths']:
    print("  FAIL  /my-company: present in spec (doc says it doesn't exist)")
else:
    print("  PASS  /my-company: not in spec (matches doc)")
# /version response shape
v = s['paths']['/version']['get']['responses']['200']['content']['application/json']['schema']
if v.get('properties', {}).get('message', {}).get('type') == 'string':
    print("  PASS  /version response shape: {message: string}")
else:
    print(f"  FAIL  /version response shape: {v}")
PY
fi

# ── 2. SIMPRO — auth.simpro.co does NOT exist; per-build URLs are real ────────
hdr "SIMPRO — auth.simpro.co NXDOMAIN; per-build URLs in official PHP SDK"

if [ -z "$(dig +short auth.simpro.co A)" ]; then
  pass "auth.simpro.co: no A record (NXDOMAIN — matches doc claim)"
else
  fail "auth.simpro.co: now resolves — doc claim may need re-checking"
fi

if gh api repos/simPRO-Software/simpro-restapi-php/contents/src/OAuth2/Provider.php 2>/dev/null \
    | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['content']).decode())" 2>/dev/null \
    | grep -qE "getBuildURL.*oauth2/token"; then
  pass "PHP SDK Provider.php uses {buildURL}/oauth2/token (matches doc)"
else
  fail "PHP SDK Provider.php pattern not found — verify doc claim manually"
fi

if gh api repos/simPRO-Software/simpro-restapi-php/contents/src/OAuth2/Provider.php 2>/dev/null \
    | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['content']).decode())" 2>/dev/null \
    | grep -qE "getBuildURL.*oauth2/login.*client_id"; then
  pass "PHP SDK Provider.php uses {buildURL}/oauth2/login?client_id= (matches doc)"
else
  fail "PHP SDK Provider.php login pattern not found"
fi

# ── 3. MYOB ACUMATICA — .myobadvanced.com is the real domain ──────────────────
hdr "MYOB ACUMATICA — *.myobadvanced.com is real, *.myob.com is not (for customer instances)"

if [ -n "$(dig +short mgccivil.myobadvanced.com A)" ]; then
  pass "mgccivil.myobadvanced.com resolves (matches doc)"
else
  fail "mgccivil.myobadvanced.com does not resolve"
fi
if [ -z "$(dig +short mgccivil.myob.com A)" ]; then
  pass "mgccivil.myob.com has NO A record (matches doc — confirms .myob.com is wrong domain)"
else
  fail "mgccivil.myob.com resolves — doc claim that .myob.com is wrong may need re-checking"
fi

cert_subject=$(echo | openssl s_client -servername mgccivil.myobadvanced.com -connect mgccivil.myobadvanced.com:443 2>/dev/null | openssl x509 -noout -subject 2>/dev/null)
if echo "$cert_subject" | grep -q "myobadvanced.com"; then
  pass "TLS wildcard cert is for *.myobadvanced.com ($cert_subject)"
else
  fail "TLS cert subject unexpected: $cert_subject"
fi

# ── 4. MYOB ACUMATICA — client_id format {GUID}@{CompanyId} ──────────────────
hdr "MYOB ACUMATICA — client_id format requires @CompanyId suffix"

ruby_readme=$(gh api repos/fast-programmer/myob_acumatica/contents/README.md 2>/dev/null \
    | python3 -c "import sys,json,base64; print(base64.b64decode(json.load(sys.stdin)['content']).decode())" 2>/dev/null)
if echo "$ruby_readme" | grep -qE "MYOB_ACUMATICA_CLIENT_ID=.*@Company"; then
  pass "fast-programmer/myob_acumatica README shows CLIENT_ID=...@Company (matches doc)"
else
  fail "fast-programmer/myob_acumatica README does not show @Company suffix as expected"
fi

# ── 5. MYOB ACCOUNTRIGHT — endpoint variants from official .NET SDK ──────────
hdr "MYOB ACCOUNTRIGHT — Professional/TimeBilling/Miscellaneous variants exist in official SDK"

sale=$(gh api repos/myob-oss/AccountRight_Live_API_.Net_SDK/contents/MYOB.API.SDK/SDK/Services/Version2/Sale 2>/dev/null | grep -oE '"name":"[^"]+"')
for variant in ProfessionalInvoiceService TimeBillingInvoiceService MiscellaneousInvoiceService; do
  if echo "$sale" | grep -q "$variant"; then
    pass "official .NET SDK Sale/ has $variant.cs (matches doc)"
  else
    fail "official .NET SDK Sale/ missing $variant.cs"
  fi
done
purch=$(gh api repos/myob-oss/AccountRight_Live_API_.Net_SDK/contents/MYOB.API.SDK/SDK/Services/Version2/Purchase 2>/dev/null | grep -oE '"name":"[^"]+"')
if echo "$purch" | grep -q "ProfessionalBillService"; then
  pass "official .NET SDK Purchase/ has ProfessionalBillService.cs (matches doc)"
else
  fail "official .NET SDK Purchase/ missing ProfessionalBillService.cs"
fi
bank=$(gh api repos/myob-oss/AccountRight_Live_API_.Net_SDK/contents/MYOB.API.SDK/SDK/Services/Version2/Banking 2>/dev/null | grep -oE '"name":"[^"]+"')
if echo "$bank" | grep -q "BankAccountService"; then
  pass "official .NET SDK Banking/ has BankAccountService.cs (matches doc)"
else
  fail "official .NET SDK Banking/ missing BankAccountService.cs"
fi
contact=$(gh api repos/myob-oss/AccountRight_Live_API_.Net_SDK/contents/MYOB.API.SDK/SDK/Services/Version2/Contact 2>/dev/null | grep -oE '"name":"[^"]+"')
if echo "$contact" | grep -q "PersonalService"; then
  pass "official .NET SDK Contact/ has PersonalService.cs (matches doc)"
else
  fail "official .NET SDK Contact/ missing PersonalService.cs"
fi
tb=$(gh api repos/myob-oss/AccountRight_Live_API_.Net_SDK/contents/MYOB.API.SDK/SDK/Services/Version2/TimeBilling 2>/dev/null | grep -oE '"name":"[^"]+"')
for variant in ActivityService ActivitySlipService; do
  if echo "$tb" | grep -q "$variant"; then
    pass "official .NET SDK TimeBilling/ has $variant.cs (matches doc)"
  else
    fail "official .NET SDK TimeBilling/ missing $variant.cs"
  fi
done
payroll=$(gh api repos/myob-oss/AccountRight_Live_API_.Net_SDK/contents/MYOB.API.SDK/SDK/Services/Version2/Payroll 2>/dev/null | grep -oE '"name":"[^"]+"')
if echo "$payroll" | grep -q "TimesheetService"; then
  pass "official .NET SDK Payroll/ has TimesheetService.cs (matches doc)"
else
  fail "official .NET SDK Payroll/ missing TimesheetService.cs"
fi

# ── 6. 12d SYNERGY — fabricated vs real endpoints ────────────────────────────
hdr "12d SYNERGY — /auth/tokens & /users/current fabricated; getPersonalAccessTokens & delete-pat exist; /swagger is the UI"

probe() {
  local method="$1" path="$2" expect="$3" desc="$4"
  local got=$(curl -s -X "$method" --max-time 30 -o /dev/null -w "%{http_code}" "https://synergy.12dsynergycloud.com$path")
  if [ "$got" = "$expect" ]; then
    pass "$method $path -> $got ($desc)"
  else
    fail "$method $path -> $got (expected $expect — $desc)"
  fi
}
probe GET /api/v1/auth/tokens                   404 "fabricated, should 404"
probe GET /api/v1/users/current                 404 "fabricated, should 404"
probe GET /api/v1/auth/getPersonalAccessTokens  401 "real endpoint, should 401 unauthenticated"
probe GET /swagger                              200 "Swagger UI, should serve HTML"
probe GET /api-docs/api/v1                      404 "spec JSON behind auth on public demo"

# ── 7. NETSUITE — OAuth URLs match Oracle docs ───────────────────────────────
hdr "NETSUITE — authorize at *.app.netsuite.com, token at *.suitetalk.api.netsuite.com"

skip "Oracle docs at https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081944642.html"
skip "  — confirm: authorize URL is https://<accountID>.app.netsuite.com/app/login/oauth2/authorize.nl"
skip "  — confirm: scopes are restlets / rest_webservices / suite_analytics / mcp (and mcp is exclusive)"
skip "  — confirm: code_verifier 43-128 chars, code_challenge_method must be S256, state 22-1024 chars"
skip "Oracle docs at https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_158081952044.html"
skip "  — confirm: token URL is https://<accountID>.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token"
skip "  — confirm: access_token lifetime 3600s, refresh confidential=7d (reusable), public=2d (rotates one-time)"

# ── 8. ZOHO CRM — Canada region special case, page_token caps ────────────────
hdr "ZOHO — Canada uses accounts.zohocloud.ca (not .ca); page_token cap 100k / 24h"

skip "Visit https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html"
skip "  — confirm: Canada accounts host is accounts.zohocloud.ca (not accounts.zoho.ca)"
skip "Visit https://www.zoho.com/crm/developer/docs/api/v8/get-records.html"
skip "  — confirm: 'fetch up to 100,000 records' and 'valid only for 24 hours' for page_token"

# ── Summary ──────────────────────────────────────────────────────────────────
echo
echo "============================================================"
echo "  RESULTS:  $PASS pass  |  $FAIL fail  |  $SKIP skip (manual)"
echo "============================================================"
echo
echo "Pass = primary source confirms the doc claim today."
echo "Fail = primary source contradicts the doc claim (drift OR hallucination)."
echo "Skip = needs you to visit a URL or an auth-walled source manually."
echo
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
