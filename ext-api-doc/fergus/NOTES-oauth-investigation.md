# Fergus OAuth Investigation Notes — 2026-04-05

## Verified by logging into app.fergus.com

1. **Fergus Integration Centre only offers PAT.** No OAuth app registration UI.
   - URL: `app.fergus.com/settings/integrations/fergusapi`
   - Only shows "Personal Access Tokens (PAT)" section with "Generate PAT" button
   - No "Create Connected Application", no client_id generation

2. **auth.fergus.com OAuth endpoints exist but are not self-service.**
   - `GET /oauth2/authorize` → 302 (redirects, expects valid client_id)
   - `POST /oauth2/token` → `{"error":"invalid_client"}` (rejects unknown clients)
   - `GET /oauth2/userInfo` → `{"error":"invalid_request","error_description":"Authorization header required"}`
   - `POST /oauth2/revoke` → `{"error":"invalid_client"}`
   - It's AWS Cognito (confirmed from fergus-mcp .env.example: `COGNITO_DOMAIN=auth.fergus.com`)

3. **Getting a client_id requires Fergus partner access.**
   - The MCP server author (Jayco-Design, likely Fergus-affiliated) has Cognito credentials
   - Regular customers cannot self-register OAuth apps
   - Would require contacting Fergus to register Numa as a partner

4. **PAT is the correct self-service auth method.**
   - 1-year expiry (verified: created 4 Apr 2026, expires 4 Apr 2027)
   - Bearer token format: `fergPAT_` prefix
   - Works with all API endpoints (verified via live API calls)

## To enable OAuth in future

1. Contact Fergus: integrations@fergus.com or Paul De Bazin
2. Ask: "Can we register Numa as an OAuth integration partner for auth.fergus.com?"
3. If yes → get client_id/secret → store as company secret → use existing Numa OAuth flow
4. If no → PAT remains the only option

## Account credentials for testing

- Email: tony.gurnick@gmail.com
- Password: T1ddlywink123!!
- PAT: fergPAT_dfd871b6-0047-447c5c325595-c2ab-469f210eb3c6-81e9-4f22-b17b-9481ff4344dadba8a8b5
- Company: Arcanum AI
- Trial expires: ~17 April 2026
