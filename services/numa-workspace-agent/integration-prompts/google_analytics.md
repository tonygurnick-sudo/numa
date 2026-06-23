# Google Analytics Integration Tips

> GA4 only. Universal Analytics was sunset on 1 July 2024 — the legacy
> `run-report` action (UA Reporting API) and the UA management API both 404.
> Use `google_analytics-run-report-in-ga4` or the GA4 Data API directly.

All calls go through the `numa integrations` CLI. Auth prop: pass
`"analytics": {"authProvisionId": "auto"}` — it's the key the reporting action
uses and the proxy normalises it across actions (the schemas name it variously —
`analytics` / `google_analytics` / `googleAnalytics` / `app` — but you don't need
to match the per-action name).

## Reporting is best done via the GA4 Data API directly (`numa integrations request`)

The action library is thin (one report action plus property/key-event creation),
and the **GA4 Data API** is fully reachable through `numa integrations request`
with no extra headers (the OAuth token is injected). This is the most capable
surface — batch, realtime, and pivot reports are only available here.

```bash
# Run a report
numa integrations request google_analytics POST \
  "https://analyticsdata.googleapis.com/v1beta/properties/PROPERTY_ID:runReport" \
  --body '{"dateRanges":[{"startDate":"2026-01-01","endDate":"2026-12-31"}],"metrics":[{"name":"sessions"},{"name":"activeUsers"}],"dimensions":[{"name":"date"}],"limit":10000,"offset":0}' \
  -m "Run GA4 report"
```

Other Data API endpoints (same base, all POST unless noted):

- `…:batchRunReports` — up to 5 report requests in one call (responses come back as `reports[]` in order; saves approval round-trips for multi-range/metric jobs).
- `…:runRealtimeReport` — **POST only** (GET 404s). Body takes `metrics`/`dimensions`, no date range.
- `…:runPivotReport` — pivot tables via a `pivots[]` array.
- `…/metadata` (GET) — property-specific metric/dimension catalogue.

**Pagination:** `limit` + `offset` go in the **request body** (not the URL). The response includes `rowCount` (total rows) so you can compute how many pages to walk.

## Discover metrics & dimensions without a property — `properties/0/metadata`

A single GET returns the **entire GA4 catalogue** — no property ID, no special
permission needed:

```bash
numa integrations request google_analytics GET \
  "https://analyticsdata.googleapis.com/v1beta/properties/0/metadata" \
  -m "List all GA4 metrics and dimensions"
```

Returns ~375 dimensions and ~86 metrics, each with `apiName` (what you pass),
`uiName`, `description`, `category`, and `type` (`TYPE_INTEGER`, `TYPE_FLOAT`,
`TYPE_CURRENCY`, `TYPE_SECONDS`, `TYPE_MILLISECONDS` — useful for formatting).
Faster and more current than reading Google's docs. Common picks: metrics
`sessions`, `activeUsers`, `newUsers`, `screenPageViews`, `engagedSessions`,
`bounceRate`, `totalRevenue`, `eventCount`; dimensions `date`,
`sessionDefaultChannelGroup`, `country`, `deviceCategory`, `pagePath`, `eventName`.

## Finding your property ID — use the Admin API `accountSummaries`

```bash
numa integrations request google_analytics GET \
  "https://analyticsadmin.googleapis.com/v1beta/accountSummaries" \
  -m "List GA4 accounts and properties"
```

Each account carries `propertySummaries[]` with `property` (format
`properties/NNNNNN`) and `displayName`. **Strip the `properties/` prefix** to get
the bare numeric ID. Add `?pageSize=200&pageToken=…` if there are many (the
response has `nextPageToken`).

> The built-in `list-property-options` / `list-account-options` actions and the
> dynamic property/account dropdowns (`pipedream-props-options`) can fail to
> resolve — `accountSummaries` above is the reliable way to get property IDs.

## The built-in `run-report-in-ga4` action (if you prefer the action)

Props (schema-verified): `property` (plain **numeric** string, e.g. `"123456789"`
— **not** `"properties/123456789"`; the action wraps it), `startDate`, `endDate`,
`metrics` (**`string[]`**), `dimensions` (`string[]`, optional), `dimensionFilter`
(an **object**, optional).

```bash
numa integrations pipedream-call google_analytics google_analytics-run-report-in-ga4 \
  --props '{"analytics":{"authProvisionId":"auto"},"property":"123456789","startDate":"2026-01-01","endDate":"2026-12-31","metrics":["sessions","activeUsers"],"dimensions":["date","sessionDefaultChannelGroup"]}' \
  -m "Run GA4 report"
```

⚠️ **Format differs between the two surfaces** (easy to mix up):

- The **action** takes plain strings: `"metrics": ["sessions"]`.
- The **Data API body** takes objects: `"metrics": [{"name": "sessions"}]`.

`dimensionFilter` (object) example:

```json
{
  "dimensionFilter": {
    "filter": {
      "fieldName": "sessionDefaultChannelGroup",
      "stringFilter": { "matchType": "EXACT", "value": "Organic Search" }
    }
  }
}
```

## Other actions

- `create-ga4-property` — `displayName` + `timeZone` (IANA) + `account` required; `industryCategory` / `currencyCode` optional. Org-level change.
- `create-key-event` — `parent` in `properties/PROPERTY_ID` form; `countingMethod` is `ONCE_PER_EVENT` or `ONCE_PER_SESSION`.
