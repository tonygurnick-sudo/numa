---
api_name: AutoPlay
api_slug: autoplay
base_url: https://lead-api.autoplay.co.nz/V2/LeadAPI.svc (test: https://lead-api.aptest.co.nz/LeadAPI.svc)
transport: SOAP 1.1 over HTTPS — errors arrive as `<soap:Fault>` in the body (often HTTP 500) OR as a failure inside a 200 `SaveLeadResult`
operation: SaveLead → SaveLeadResult
call_surface: HTTP via `numa integrations request` (connector=autoplay)
events: NONE recovered — no webhooks/callbacks for the Lead API; Listing API (the inventory read) is coming soon
companions: 01=api-rules, 01c=mutation-patterns, 03=connector-setup, 00=questionnaire
confidence: SOAP shapes are GENERIC SOAP 1.1 conventions; AutoPlay-specific result/fault fields are RECOVERED-or-INFERRED and NOT vendor-confirmed, NOT live-validated. [VERIFY WITH WSDL]=confirm exact element names at `?singleWsdl`; [INFERRED]=standard SOAP behaviour assumed; [UNKNOWN]=ask vendor. Trust a real response over this file.
---

# AutoPlay — Event & Error Handling (SOAP)

The Lead API is **SOAP 1.1**, so errors take two distinct shapes: a **`<soap:Fault>`** (the
request itself was rejected) or a **failure reported inside a 200 `SaveLeadResult`** (the request
was understood but the lead wasn't saved). Treat them differently. Read `01-llm-api-rules.md` for
transport + auth.

> **The success/failure field names inside `SaveLeadResult` are NOT vendor-confirmed.** They are
> `[VERIFY WITH WSDL]`. The SOAP-fault structure below is standard SOAP 1.1 and reliable; the
> AutoPlay-specific result fields are not. Quote what the live response actually carries; never
> assert a field the WSDL hasn't confirmed.

## Events / webhooks

**None recovered.** The Lead API is a fire-and-forget create (`SaveLead`); no callback, webhook, or
event subscription was found in the OSS module. There is no "tell me when a lead is contacted"
surface. The **Listing API** (inventory/media) — which is where any change-feed would more likely
live — is **coming soon** (no public spec). For now, AutoPlay is push-only (you create leads); there
is nothing to poll or subscribe to. `[UNKNOWN]` whether the vendor offers events at all.

## Two failure shapes

### 1. SOAP Fault — the request was rejected

Returned when the envelope is malformed, the operation/`SOAPAction` is wrong, auth in the body is
bad, or the server errored. Usually carried with **HTTP 500** (SOAP 1.1 convention) but the body is
the source of truth:

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>{human-readable reason}</faultstring>
      <detail>{optional structured detail}</detail>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>
```

- **`<faultcode>`** — `soap:Client` (your request is wrong — bad envelope, bad auth, bad ids) vs
  `soap:Server` (AutoPlay-side error). [INFERRED — standard SOAP 1.1]
- **`<faultstring>`** — the human-readable reason. **Quote it verbatim** to the user.
- **`<detail>`** — optional; may carry field-level info. Shape is `[VERIFY WITH WSDL]`.
- **Action:** a `soap:Client` fault is **your** problem — fix the envelope/auth/ids and try once
  more; do **not** blind-retry an unchanged request (it fails identically). A `soap:Server` fault is
  AutoPlay-side — report and stop.

### 2. Failure inside a 200 `SaveLeadResult`

The call was understood but the lead wasn't saved (validation, bad dealer/yard id, missing required
field). The HTTP status is **200** and the body is a normal SOAP response wrapping `SaveLeadResult`:

```xml
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SaveLeadResponse xmlns="http://tempuri.org/">
      <SaveLeadResult>
        <!-- shape [VERIFY WITH WSDL]: typically a success/status flag,
             a message, and possibly a created lead id -->
        <Success>false</Success>            <!-- field name [VERIFY WITH WSDL] -->
        <Message>{why it failed}</Message>  <!-- field name [VERIFY WITH WSDL] -->
      </SaveLeadResult>
    </SaveLeadResponse>
  </soap:Body>
</soap:Envelope>
```

- **A 200 does NOT guarantee the lead was saved.** Always inspect `SaveLeadResult` for a
  success/status flag before telling the user it worked. `[VERIFY WITH WSDL]` for the exact flag and
  message element names — they are **not confirmed**.
- On a failure result, **quote the message** and offer to fix the inputs (e.g. a bad/empty
  `DealershipId`, a malformed email). Do not auto-retry — a retry without changing the inputs fails
  the same way, and a retry of an _ambiguous_ outcome risks a duplicate lead.

## What a success looks like

A 200 response whose `SaveLeadResult` reports success — likely a success/status flag = true and
possibly a created lead id. The **exact success indicator (and whether a lead id is returned) is
`[VERIFY WITH WSDL]`.** Only confirm success to the user when the result clearly says so; otherwise
treat the outcome as **unknown** (below).

## Status / outcome playbook

| Outcome                                  | What it means                                          | Action                                                                                   |
| ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| 200 + `SaveLeadResult` success           | lead created                                           | confirm to the user (quote any returned lead id) [VERIFY WITH WSDL for the success flag] |
| 200 + `SaveLeadResult` failure           | understood but not saved (validation, bad ids)         | quote the message; fix inputs; **don't** blind-retry                                     |
| `<soap:Fault>` `soap:Client` (often 500) | malformed envelope / bad auth / wrong `SOAPAction`/ids | fix the envelope/auth/ids; retry once with the fix; not before                           |
| `<soap:Fault>` `soap:Server` (500)       | AutoPlay-side error                                    | report `<faultstring>`; stop; retry once after a pause at most                           |
| `soap_passthrough_disabled` (no call)    | admin gate off — no key/token released                 | tell the user to enable **Lead API** + **passthrough**; don't fabricate a key            |
| HTTP 400 / non-SOAP / HTML response      | wrong `Content-Type`, JSON-encoded body, or bad URL    | likely the JSON-body runtime caveat (01) — fix the request shape, don't loop             |
| 401 / 403 (HTTP)                         | unexpected for body-auth SOAP                          | recheck the URL/host; this API doesn't use HTTP auth — `[UNKNOWN]` if seen, escalate     |
| Timeout / unparseable response           | outcome ambiguous                                      | treat as **unknown** — do NOT auto-retry (duplicate risk); tell the user                 |

## Auth-failure handling (specific to the body-auth model)

AutoPlay auth is **inside the envelope**, so an auth failure surfaces as a **`<soap:Fault>` or a
failure `SaveLeadResult`**, not an HTTP 401/403. If you get a fault that reads like "invalid
key/token" or "unauthorised dealer":

1. **Do not** treat it as an OAuth-style reconnect — there's no token to refresh; the key/token come
   from the connector config.
2. The likely fix is **admin-side**: the API Key/Token in the AutoPlay connector config is wrong or
   stale, or the dealer/yard id doesn't match. Tell the user an admin should re-check the AutoPlay
   connector's **API Key, Token, Dealership ID and Yard ID** (Settings → Data Connectors), sourced
   from AutoPlay's **Settings → Company Settings → API Management**.
3. If the credentials were never released at all (`soap_passthrough_disabled`), that's the **toggle
   gate**, not a credential problem — see 01.

## Idempotency & retry discipline

- `SaveLead` is **non-idempotent** — every successful call creates a lead. There is **no
  idempotency key** recovered. `[UNKNOWN]`
- **Never auto-retry an ambiguous outcome** (timeout, unparseable body): you cannot tell whether the
  lead landed, and a retry duplicates it. Report "outcome unknown — please check AutoPlay" and let
  the user decide.
- Only retry on a **clear, corrected** `soap:Client` fault (you fixed the envelope/auth/ids) — once.
- There is **no read/search operation** to verify after the fact (only `SaveLead` was recovered), so
  `SaveLeadResult` is your sole confirmation signal. Don't claim success without it.

## Triage order

1. **No call made / `soap_passthrough_disabled`** → admin toggle gate (01). Not an API error.
2. **400 / non-SOAP / HTML / JSON-content-type rejection** → the request-shape runtime caveat (01) —
   the body went out as JSON instead of raw `text/xml`. Fix the shape, don't loop.
3. **`<soap:Fault>`** → read `faultcode`/`faultstring`: `soap:Client` = fix your request;
   `soap:Server` = AutoPlay-side, report and stop.
4. **200 + failure `SaveLeadResult`** → validation/ids — quote the message, fix inputs.
5. **Timeout/ambiguous** → outcome unknown, no auto-retry.
