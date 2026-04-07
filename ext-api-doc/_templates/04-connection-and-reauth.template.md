# {{API_NAME}} — Connection & Reauthorization Guide

> Complete setup instructions for connecting Numa to {{API_NAME}}.
> Auth type: {{AUTH_TYPE}} (OAuth 2.0 / PAT — pick one, not both)
> Goal: enough detail that Numa could automate connector setup via script.

---

## Auth Type: {{AUTH_TYPE}}

<!-- DELETE the section that doesn't apply (OAuth OR PAT). One per API. -->

---

## Option A: OAuth 2.0

### 1. Create the OAuth Application in {{API_NAME}}

Step-by-step instructions for creating the OAuth client/app in the vendor's admin console.

1. Log in to {{API_NAME}} admin panel at `{{ADMIN_URL}}`
2. Navigate to: {{EXACT_MENU_PATH}} (e.g. Settings > API > OAuth Applications)
3. Click "{{CREATE_BUTTON_LABEL}}"
4. Fill in:
   | Field | Value | Notes |
   |-------|-------|-------|
   | App Name | `Numa Integration` | |
   | Redirect URI | `{{REDIRECT_URI}}` | Must match exactly |
   | Scopes | `{{REQUIRED_SCOPES}}` | Minimum required |
   | {{OTHER_FIELDS}} | {{VALUES}} | |
5. Save and copy:
   - **Client ID**: `{{format/pattern}}`
   - **Client Secret**: `{{format/pattern}}` (shown once — copy immediately)

### 2. OAuth Flow

| Property          | Value                |
| ----------------- | -------------------- |
| Grant type        | `authorization_code` |
| Authorization URL | `{{AUTH_URL}}`       |
| Token URL         | `{{TOKEN_URL}}`      |
| Redirect URI      | `{{REDIRECT_URI}}`   |
| Scopes            | `{{SCOPES}}`         |
| PKCE required?    | {{YES/NO}}           |

#### Authorization Request

```http
GET {{AUTH_URL}}?
  response_type=code&
  client_id={{CLIENT_ID}}&
  redirect_uri={{REDIRECT_URI}}&
  scope={{SCOPES}}&
  state={{RANDOM_STATE}}
```

#### Token Exchange

```http
POST {{TOKEN_URL}}
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
code={{AUTH_CODE}}&
redirect_uri={{REDIRECT_URI}}&
client_id={{CLIENT_ID}}&
client_secret={{CLIENT_SECRET}}
```

#### Token Response

```json
{
  "access_token": "{{example}}",
  "token_type": "Bearer",
  "expires_in": {{SECONDS}},
  "refresh_token": "{{example}}"
}
```

### 3. Token Refresh

```http
POST {{TOKEN_URL}}
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&
refresh_token={{REFRESH_TOKEN}}&
client_id={{CLIENT_ID}}&
client_secret={{CLIENT_SECRET}}
```

| Property                | Value                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Access token lifetime   | {{DURATION}}                                                         |
| Refresh token lifetime  | {{DURATION}}                                                         |
| Refresh token rotation? | {{YES/NO — does refresh return a new refresh token?}}                |
| Re-consent required?    | {{WHEN — e.g. "never", "after 90 days inactive", "on scope change"}} |

### 4. Token Revocation

```http
POST {{REVOKE_URL}}
Content-Type: application/x-www-form-urlencoded

token={{ACCESS_OR_REFRESH_TOKEN}}&
client_id={{CLIENT_ID}}&
client_secret={{CLIENT_SECRET}}
```

### 5. Reauthorization Triggers

When to prompt the user to reauthorize:

| Trigger               | Detection               | Action                      |
| --------------------- | ----------------------- | --------------------------- |
| Access token expired  | 401 response            | Refresh using refresh token |
| Refresh token expired | Refresh returns 401     | Full re-consent flow        |
| Scopes changed        | {{HOW_DETECTED}}        | Full re-consent flow        |
| User revoked access   | 401/403 + refresh fails | Full re-consent flow        |

---

## Option B: Personal Access Token (PAT)

### 1. Generate a PAT in {{API_NAME}}

Step-by-step instructions:

1. Log in to {{API_NAME}} at `{{APP_URL}}`
2. Navigate to: {{EXACT_MENU_PATH}} (e.g. User Settings > API Access > Personal Access Tokens)
3. Click "{{CREATE_BUTTON_LABEL}}"
4. Fill in:
   | Field | Value | Notes |
   |-------|-------|-------|
   | Token name | `Numa Integration` | For identification |
   | Expiry | {{MAX_LIFETIME}} | Maximum allowed |
   | Scopes/permissions | {{REQUIRED_SCOPES}} | If applicable |
5. Click "Create" / "Generate"
6. **Copy the token immediately** — it is shown only once

### 2. Token Format

| Property           | Value                                              |
| ------------------ | -------------------------------------------------- |
| Header             | `Authorization: Bearer {{PAT}}`                    |
| Token format       | {{FORMAT — e.g. "JWT", "opaque string", "base64"}} |
| Max lifetime       | {{DURATION}}                                       |
| Scopes/permissions | {{INHERITED_FROM_USER / CONFIGURABLE}}             |

### 3. Token Refresh / Rotation

| Property           | Value                                         |
| ------------------ | --------------------------------------------- |
| Refresh mechanism  | {{NONE / API endpoint / manual regeneration}} |
| Can extend expiry? | {{YES/NO}}                                    |
| Rotation strategy  | {{DESCRIPTION}}                               |

If no refresh mechanism:

- Track creation date
- Warn user at {{N}} days before expiry
- On 401 response: prompt user to generate a new PAT
- Old PAT cannot be recovered — must create new

### 4. Programmatic PAT Management (if available)

```http
# List existing PATs
{{METHOD}} {{ENDPOINT}}

# Create new PAT
{{METHOD}} {{ENDPOINT}}

# Revoke PAT
{{METHOD}} {{ENDPOINT}}
```

If no API for PAT management: user must manage tokens manually through the web UI.

### 5. Reauthorization Triggers

| Trigger                  | Detection    | Action                                          |
| ------------------------ | ------------ | ----------------------------------------------- |
| PAT expired              | 401 response | Prompt user to generate new PAT in {{API_NAME}} |
| PAT revoked              | 401 response | Prompt user to generate new PAT                 |
| Insufficient permissions | 403 response | Check user role in {{API_NAME}}                 |

---

## Numa Connector Wiring

### Credentials to Store

| Key       | Type     | Description     |
| --------- | -------- | --------------- |
| {{KEY_1}} | {{TYPE}} | {{DESCRIPTION}} |
| {{KEY_2}} | {{TYPE}} | {{DESCRIPTION}} |

### Test Connection Sequence

```
1. {{STEP_1 — e.g. "GET /health (no auth) — verify server reachable"}}
2. {{STEP_2 — e.g. "GET /api/v1/me (with auth) — verify credentials valid"}}
```

### Auto-Reconnect Logic

```
on 401 response:
  if auth_type == "oauth":
    try refresh_token()
    if refresh fails:
      trigger re-consent flow
  if auth_type == "pat":
    notify user "PAT expired — generate new token in {{API_NAME}}"
    disable connector until new PAT provided
```
