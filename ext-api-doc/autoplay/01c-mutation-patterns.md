---
api_name: AutoPlay
api_slug: autoplay
base_url: https://lead-api.autoplay.co.nz/V2/LeadAPI.svc (test: https://lead-api.aptest.co.nz/LeadAPI.svc)
transport: SOAP 1.1 over HTTPS — POST, Content-Type `text/xml; charset=utf-8`, a `SOAPAction` header
operation: SaveLead → SaveLeadResult (the only recovered write)
auth: per-dealer Key + Token IN the envelope (<API_KEY>/<API_TOKEN>) + DealershipId(apid)/YardId(yardid); released to the agent only when admin enabled `lead_api_enabled` + `soap_token_passthrough`
call_surface: HTTP via `numa integrations request` (connector=autoplay); SOAP needs the raw-XML/text body path (the generic op JSON-encodes — see 01)
companions: 01=api-rules, 01d=events+errors, 03=connector-setup, 00=questionnaire
confidence: SaveLead surface RECOVERED from the OSS Subaru-NZ Drupal `autoplay` module; possibly stale, NOT vendor-confirmed; NOT live-validated. [VERIFY WITH WSDL]=confirm exact element names/types/namespace at `?singleWsdl`; [RECOVERED]=from the OSS module; [UNKNOWN]=ask vendor. Do NOT invent fields beyond what's recovered.
---

# AutoPlay — Mutation Patterns (SaveLead)

The Lead API has **one recovered write: `SaveLead`** (create a lead). It is **SOAP**, so a "write"
means building and POSTing a SOAP 1.1 envelope — not a JSON body. Read `01-llm-api-rules.md` first
for the transport, the auth-in-the-envelope rule, and the admin gate.

> **Everything here is a SOAP contract recovered from a third-party module. It is not
> vendor-confirmed and not live-validated.** Element names, casing, the namespace, and the full
> field list are **`[VERIFY WITH WSDL]`** — fetch `https://lead-api.autoplay.co.nz/V2/LeadAPI.svc?singleWsdl`
> and mirror the real schema. **Do not add fields that aren't in the WSDL.**

## Write rules (read first)

1. **The only write is `SaveLead`.** No update, no delete, no other operation was recovered. If the
   user asks to update or delete a lead, say it isn't available (`[UNKNOWN]` whether the API even
   supports it — `[VERIFY WITH WSDL]`).
2. **Auth lives in the envelope.** `<API_KEY>`/`<API_TOKEN>` + `<DealershipId>`/`<YardId>` are XML
   elements, not HTTP headers. They come from the connector config via the admin passthrough gate.
   Never echo or log them.
3. **The admin gate must be open.** Both `lead_api_enabled` and `soap_token_passthrough` must be on,
   or the backend refuses to release the key/token (`soap_passthrough_disabled`). If denied, tell
   the user to ask an admin to enable both — do **not** fabricate a key.
4. **Mandatory transport bits:** `POST`, `Content-Type: text/xml; charset=utf-8`, and a `SOAPAction`
   header (the SaveLead action URI — `[VERIFY WITH WSDL]`).
5. **Confirm with the user before sending** — a lead is a real record pushed into the dealer's CRM.
   Echo the customer details you're about to submit.
6. **Non-idempotent.** Each successful `SaveLead` creates a lead. On an ambiguous failure (timeout,
   unparseable response) do **not** blind-retry — you may create a duplicate. See 01d.
7. **Runtime caveat (see 01):** the generic `request` op JSON-encodes `--body`, so a raw SOAP
   envelope can't go through it cleanly yet; a raw-XML/text body path (or a dedicated SaveLead
   command) is needed. If the call fails with a SOAP fault / wrong-content-type error, that's the
   likely cause — surface it, don't loop.

## SaveLead — fields

| Element                                  | Source                      | Notes                                                                |
| ---------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `API_KEY`                                | connector config (gated)    | per-dealer key, in the body [RECOVERED]                              |
| `API_TOKEN`                              | connector config (gated)    | per-dealer token, in the body [RECOVERED]                            |
| `DealershipId`                           | connector config (`apid`)   | dealer id [RECOVERED]; exact element name [VERIFY WITH WSDL]         |
| `YardId`                                 | connector config (`yardid`) | yard/lot id; optional/single-yard → omit or empty [RECOVERED/VERIFY] |
| `CustomerFirstName`                      | conversation                | [RECOVERED contact subset]                                           |
| `CustomerLastName`                       | conversation                | [RECOVERED]                                                          |
| `CustomerEmail`                          | conversation                | [RECOVERED]                                                          |
| `CustomerPhone`                          | conversation                | [RECOVERED]                                                          |
| vehicle of interest, source, comments, … | conversation                | **[UNKNOWN] names/shape — [VERIFY WITH WSDL]**; do not invent        |

> The recovered module sent the four `Customer*` contact fields plus the auth + dealer ids. The
> rest of the `SaveLead` request (vehicle of interest, lead source, free-text comment, consent
> flags, etc.) is **not confirmed** — get the field list from the WSDL before populating it.

## Pattern — create a lead (worked example)

User: _"Log a lead for Jane Smith — jane.smith@example.com, 021 123 4567, interested in a 2021
Subaru Outback, came from our website."_

### Step 1 — get the credentials (gated)

Fetch the per-dealer Key/Token + ids through the passthrough path. If the admin gate is closed the
backend returns `soap_passthrough_disabled` → tell the user to enable **Lead API** +
**Authorise passing the API token to the agent**, and stop. On success you have
`{api_key, api_token, dealership_id, yard_id}`.

### Step 2 — build the envelope (placeholders filled from steps above)

```xml
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
    xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:tem="http://tempuri.org/">
  <soap:Body>
    <tem:SaveLead>
      <tem:API_KEY>AP-LIVE-xxxxxxxx</tem:API_KEY>
      <tem:API_TOKEN>tok-yyyyyyyyyyyy</tem:API_TOKEN>
      <tem:DealershipId>1234</tem:DealershipId>
      <tem:YardId>1</tem:YardId>
      <tem:CustomerFirstName>Jane</tem:CustomerFirstName>
      <tem:CustomerLastName>Smith</tem:CustomerLastName>
      <tem:CustomerEmail>jane.smith@example.com</tem:CustomerEmail>
      <tem:CustomerPhone>021 123 4567</tem:CustomerPhone>
      <!-- Vehicle-of-interest "2021 Subaru Outback" and source "Website" would go here,
           but their element names are [VERIFY WITH WSDL] — do not invent. -->
    </tem:SaveLead>
  </soap:Body>
</soap:Envelope>
```

- The `tem:` / `http://tempuri.org/` namespace and the `SaveLead` wrapper name are WCF defaults and
  **`[VERIFY WITH WSDL]`** — the live `targetNamespace` may differ.
- Real values shown for illustration; the key/token here are dummies.

### Step 3 — POST it

```
numa integrations request autoplay POST "https://lead-api.autoplay.co.nz/V2/LeadAPI.svc" \
  --headers '{"Content-Type":"text/xml; charset=utf-8","SOAPAction":"http://tempuri.org/ILeadAPI/SaveLead"}' \
  --body '<the raw envelope from step 2>' \
  -m "Create AutoPlay lead for Jane Smith"
```

- `SOAPAction` value is **`[VERIFY WITH WSDL]`** (from `<soap:operation soapAction="…">`).
- `--body` must carry the **raw XML**, not JSON — see the runtime caveat (rule 7 + 01).
- Use the **test** host `https://lead-api.aptest.co.nz/LeadAPI.svc` first if you have test creds.

### Step 4 — read `SaveLeadResult`

- **`<soap:Fault>`** → malformed/rejected request (bad auth, bad envelope, wrong `SOAPAction`). Read
  `<faultstring>`, report it verbatim, **don't retry unchanged**.
- **200 with `SaveLeadResult`** → inspect the result for a success/failure flag and any lead id /
  message. Exact field names inside `SaveLeadResult` are **`[VERIFY WITH WSDL]`** — quote whatever
  the response actually carries; never claim a specific field that the WSDL hasn't confirmed.
- Confirm to the user only on a genuine success result. On failure, surface the message and offer to
  fix the inputs (see 01d).

## What you CANNOT do

| Wish                               | Reality                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| Update or delete a lead            | Not recovered — only `SaveLead` (create). `[UNKNOWN]` whether the API supports it.     |
| Read / search existing leads       | No read operation recovered. `[UNKNOWN]`                                               |
| Pull vehicle inventory / listings  | Listing API is **coming soon** — no REST spec yet. `[UNKNOWN]`                         |
| Send SaveLead as JSON              | It's SOAP — must be a `text/xml` envelope with a `SOAPAction` header.                  |
| Get the key/token without the gate | Backend fails closed unless both admin toggles are on. Tell the user; don't fabricate. |

## Post-write verification

`SaveLead` returns `SaveLeadResult` — there is no separate "GET the lead" to confirm (no read
operation recovered). Your only confirmation is the result payload itself. If you cannot parse a
clear success out of `SaveLeadResult`, report the raw result/`<faultstring>` to the user and treat
the outcome as **unknown** — do not assert the lead was created, and do not auto-retry (duplicate
risk). `[VERIFY WITH WSDL]` for the exact success indicator.
