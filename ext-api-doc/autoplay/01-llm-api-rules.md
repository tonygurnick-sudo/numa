---
api_name: AutoPlay
api_slug: autoplay
status: partially-wired — connector registered; Lead API is SOAP (SaveLead); Listing API coming soon
apis: Lead API = SOAP 1.1 (SaveLead, recovered from OSS); Listing API = REST inventory pull (coming soon, no public spec)
lead_api_endpoint_prod: https://lead-api.autoplay.co.nz/V2/LeadAPI.svc
lead_api_endpoint_test: https://lead-api.aptest.co.nz/LeadAPI.svc
lead_api_wsdl_prod: https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl
soap_operation: SaveLead → SaveLeadResult
transport: SOAP 1.1 over HTTPS — Content-Type `text/xml; charset=utf-8`, a `SOAPAction` HTTP header, POST. NOT JSON, NOT REST.
auth: per-dealer Key + Token live INSIDE the SOAP envelope (<API_KEY>/<API_TOKEN>), NOT an HTTP header; the connector's `request` op does NOT inject AutoPlay auth. Plus DealershipId(apid)/YardId(yardid).
auth_gate: the agent only receives api_key/api_token when the admin enabled BOTH `lead_api_enabled` AND `soap_token_passthrough` ("Authorise passing the API token to the agent"). If off, the agent CANNOT build the call — tell the user to enable it.
call_surface: HTTP via `numa integrations request` (connector=autoplay). See "Runtime constraints" — the generic request op is JSON-oriented; SOAP needs the raw-XML/SOAPAction path.
field_casing: SOAP element names are PascalCase (CustomerEmail, CustomerFirstName, …). [VERIFY WITH WSDL]
companions: 00=questionnaire (recovered facts + vendor asks), 01c=mutation-patterns (SaveLead worked example), 01d=SOAP fault + result handling, 03=connector-setup
confidence: Lead API surface RECOVERED from the open-source Subaru-NZ Drupal `autoplay` module (third-party, possibly stale, NOT vendor-confirmed). Listing API: no public spec. NOTHING here is live-validated. Tags: [RECOVERED]=from the OSS module; [VERIFY WITH WSDL]=fetch `?singleWsdl` to confirm exact element names/types; [INFERRED]=deduced; [UNKNOWN]=ask vendor. Trust a real response over this file; never claim live-confirmed behaviour.
---

# AutoPlay — API Rules

> **READ THIS FIRST: AutoPlay's Lead API is SOAP, not REST.** Everything below is the SOAP
> contract for one operation — **`SaveLead`** — recovered from a third-party open-source module.
> The vehicle-inventory **Listing API is "coming soon"** (no public REST spec yet). Do not invent
> endpoints, fields, or auth. Field names not confirmed from the recovered WSDL are tagged
> `[VERIFY WITH WSDL]` — fetch `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl` to
> confirm before relying on them.

## What this connector can do

- **Lead API — create a lead** via the SOAP operation **`SaveLead`** (→ `SaveLeadResult`). This is
  the only operation recovered. [RECOVERED]
- **Listing API — vehicle inventory pull: COMING SOON.** AutoPlay has not published a REST spec, so
  there is no inventory/media read surface today. If the user asks "what's in stock / which
  vehicles have no photos", tell them the Listing API isn't wired yet. [UNKNOWN]

## Auth — credentials live INSIDE the SOAP envelope (not an HTTP header)

This is the single most important difference from every other connector. AutoPlay's Lead API does
**not** use `Authorization: Bearer`, `X-API-Key`, or any HTTP auth header. The per-dealer
credentials are **XML elements inside the request body**:

```xml
<API_KEY>{api_key}</API_KEY>
<API_TOKEN>{api_token}</API_TOKEN>
```

plus the dealer's identity values, also in the body [RECOVERED]:

- **`DealershipId`** — the dealer's AutoPlay id (recovered as the `apid` value).
- **`YardId`** — the yard/lot id (recovered as the `yardid` value); a dealer can have several yards.

**Where the agent gets the credentials — the admin gate.** The `api_key` / `api_token` come from
the connector's **company config**, NOT from anything the agent knows by default. They are released
to the agent **only when the admin has enabled BOTH toggles** on the AutoPlay connector:

1. **`lead_api_enabled`** ("Lead API"), and
2. **`soap_token_passthrough`** ("Authorise passing the API token to the agent").

If either is off, the agent **cannot** build a SaveLead call. The backend fails closed and returns
an error like _"Not authorised: AutoPlay SOAP token passthrough is disabled."_ In that case **do not
guess or fabricate a key** — tell the user:

> "AutoPlay's Lead API is SOAP, so the API token has to be embedded in the request. To let me
> create leads, an admin needs to enable both **Lead API** and **Authorise passing the API token to
> the agent** on the AutoPlay connector (Settings → Data Connectors)."

When the gate is open, the backend hands back exactly:
`{ connector, base_url, api_key, api_token, dealership_id, yard_id }`.

> ⚠️ **Treat the key/token as a company secret.** Never echo, log, or print them back to the user.
> They go into the envelope you POST and nowhere else.

## Transport — how to send a SaveLead

The request is a **SOAP 1.1 envelope POSTed over HTTPS** with these exact properties:

| Property       | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| Method         | `POST`                                                                                       |
| URL (prod)     | `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc`                                             |
| URL (test)     | `https://lead-api.aptest.co.nz/LeadAPI.svc`                                                  |
| `Content-Type` | `text/xml; charset=utf-8`                                                                    |
| `SOAPAction`   | the SaveLead action URI — e.g. `"http://tempuri.org/ILeadAPI/SaveLead"` `[VERIFY WITH WSDL]` |
| Body           | the SOAP envelope (XML string), NOT JSON                                                     |

- **`SOAPAction` is required** for SOAP 1.1. Its exact value comes from the WSDL's `<soap:operation
soapAction="…">` for `SaveLead` — `[VERIFY WITH WSDL]`. The `tempuri.org` namespace above is the
  WCF default and a placeholder; confirm against `?singleWsdl`.
- **No HTTP auth header.** Auth is in the envelope (above).
- The `request` path does **NOT** inject auth for AutoPlay — it is in the body, which the agent
  builds.

### ⚠️ Runtime constraints (be honest with the user)

Two things are not yet smooth on the generic connector path. Know them before you promise a working
lead:

1. **The generic `request` op JSON-encodes the body.** `numa integrations request` (→ `connect_request`)
   takes `--body` as **JSON** and the backend sends it as a JSON body with
   `Content-Type: application/json`. A SOAP envelope is a **raw XML string with
   `Content-Type: text/xml`** — passing XML through the JSON body path will JSON-quote it and send
   the wrong content type, which AutoPlay's SOAP endpoint will reject. **A raw-XML/text body path
   (or a dedicated SaveLead command) is required** for this to work end to end. If you try it and the
   request comes back as a SOAP fault or an HTML/400 error, this is the likely cause — surface it to
   the user rather than retrying blindly. `[VERIFY WITH WSDL / connector backend]`
2. **There is no `numa` CLI command yet to fetch the passthrough credentials.** The backend handler
   that releases `api_key`/`api_token` (gated on the two toggles) exists, but it is not currently
   exposed as a `numa integrations …` command. Until it is, the agent has no in-CLI way to obtain
   the key/token to build the envelope. If asked to create a lead today, explain that AutoPlay lead
   creation is **set up but not yet callable from chat** pending these two pieces, and point the
   user at an admin. Do **not** fabricate a key to "make it work."

When the raw-XML path and the credential command land, the call shape is:

```
numa integrations request autoplay POST "https://lead-api.autoplay.co.nz/V2/LeadAPI.svc" \
  --headers '{"Content-Type":"text/xml; charset=utf-8","SOAPAction":"http://tempuri.org/ILeadAPI/SaveLead"}' \
  --body '<the SOAP envelope as a raw XML string>' \
  -m "Create AutoPlay lead for Jane Smith"
```

(`--body` must carry the raw envelope, not JSON — see constraint 1. `[VERIFY WITH WSDL]`)

## SaveLead — the envelope (copy-pasteable skeleton)

Placeholders in `{…}`. The `<API_KEY>`, `<API_TOKEN>`, `<DealershipId>`, `<YardId>` come from the
connector config (via the admin gate). The customer fields come from the conversation.

> ⚠️ **Element names below are RECOVERED / INFERRED, not vendor-confirmed.** The recovered module
> sent the contact fields shown; the exact element names, casing, namespaces, and the full field
> list are **`[VERIFY WITH WSDL]`** — fetch `?singleWsdl` and mirror the real schema. Do not add
> fields that aren't in the WSDL.

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:SaveLead>
      <!-- Auth — per-dealer credentials, IN the body (not an HTTP header) -->
      <tem:API_KEY>{api_key}</tem:API_KEY>
      <tem:API_TOKEN>{api_token}</tem:API_TOKEN>

      <!-- Dealer identity -->
      <tem:DealershipId>{dealership_id}</tem:DealershipId>   <!-- apid -->
      <tem:YardId>{yard_id}</tem:YardId>                     <!-- yardid; omit/empty if single-yard -->

      <!-- Lead / customer details [RECOVERED contact fields; rest VERIFY WITH WSDL] -->
      <tem:CustomerFirstName>{first_name}</tem:CustomerFirstName>
      <tem:CustomerLastName>{last_name}</tem:CustomerLastName>
      <tem:CustomerEmail>{email}</tem:CustomerEmail>
      <tem:CustomerPhone>{phone}</tem:CustomerPhone>

      <!-- Vehicle-of-interest, source, message, etc. — names/shape [VERIFY WITH WSDL] -->
    </tem:SaveLead>
  </soap:Body>
</soap:Envelope>
```

- The `tem:`/`tempuri.org` namespace and the wrapping element name (`SaveLead`) are the WCF defaults
  and are **`[VERIFY WITH WSDL]`** — the live WSDL's `targetNamespace` may differ.
- `<API_KEY>`/`<API_TOKEN>` element names are **`[RECOVERED]`** from the OSS module.
- `<DealershipId>`/`<YardId>` map to the recovered `apid`/`yardid` — **`[VERIFY WITH WSDL]`** that
  these are the live element names (and whether they're nested under a customer/lead complex type).
- Customer contact fields (`CustomerFirstName`, `CustomerLastName`, `CustomerEmail`,
  `CustomerPhone`) are the recovered subset; the full field reference (vehicle of interest, source,
  comments, consent flags, …) is **`[UNKNOWN]` — `[VERIFY WITH WSDL]`**.

## Critical gotchas

1. **SOAP, not REST.** No JSON, no query params, no REST resource paths. One operation: `SaveLead`.
2. **Auth is in the body, not a header.** `<API_KEY>`/`<API_TOKEN>` inside the envelope. The `request`
   op does not inject AutoPlay auth.
3. **Two admin toggles gate the credentials.** Both `lead_api_enabled` and `soap_token_passthrough`
   must be on, or the agent can't get the key/token. Fail closed — tell the user, don't guess.
4. **`SOAPAction` + `Content-Type: text/xml; charset=utf-8` are mandatory.** A SOAP 1.1 POST without
   them will be rejected.
5. **Listing API is coming soon.** No inventory read today. Don't promise stock/photo queries.
6. **Test vs prod hosts differ** — and the test WSDL was recovered WITHOUT the `/V2/` segment
   (`https://lead-api.aptest.co.nz/LeadAPI.svc`) while prod has it. `[VERIFY WITH WSDL]`
7. **Nothing here is live-validated.** All field names tagged `[VERIFY WITH WSDL]` must be confirmed
   against `?singleWsdl` before you rely on them. Never claim the call succeeded unless you got a
   real `SaveLeadResult` back.
8. **Non-idempotent.** Each successful `SaveLead` creates a lead. Don't blind-retry on an ambiguous
   failure (see 01d) — you may create duplicates.

## Errors (full detail in 01d)

- **`<soap:Fault>`** in the response body = the request was malformed or rejected (bad auth, bad
  envelope, wrong `SOAPAction`). Read `<faultstring>` — don't retry an unchanged request.
- **A 200 with a `SaveLeadResult`** that reports failure (e.g. a status/success flag = false) = the
  call was understood but the lead wasn't saved (validation, bad ids). Exact success/failure field
  names are **`[VERIFY WITH WSDL]`**.
- **Auth-disabled error** (`soap_passthrough_disabled`) = the admin gate is off — see Auth above.

## Example (intended, once the raw-XML path + credential command exist)

"Create an AutoPlay lead for Jane Smith, jane@example.com, 021 123 4567, interested in a Subaru
Outback":

1. Obtain credentials via the (future) passthrough command → `{api_key, api_token, dealership_id,
yard_id}`. If denied → tell the user to enable both toggles; stop.
2. Build the SaveLead envelope (skeleton above), filling auth + dealer ids from step 1 and the
   customer fields from the request.
3. `POST` it to `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc` with `Content-Type: text/xml;
charset=utf-8` and the `SaveLead` `SOAPAction`.
4. Parse `SaveLeadResult`: success → confirm to the user; `<soap:Fault>` or a failure result →
   report `<faultstring>` / the result message verbatim, do not blind-retry.

Worked example with a populated envelope: `01c-mutation-patterns.md`. Fault/result handling:
`01d-event-and-error-handling.md`.
