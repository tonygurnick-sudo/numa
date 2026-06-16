# Microsoft Outlook Calendar Integration Tips

## Establishing Context

Before performing Calendar operations, establish context:

- Use `list-events` with `maxResults` to see existing events and get event IDs
- Use `configure_props` for `timeZone` to resolve available timezone values (returns Windows format, not IANA)

## Timezones Use Windows Format

The `configure_props` for `timeZone` returns Windows-style timezone names (e.g., `E. Australia Standard Time`, `Pacific Standard Time`), **NOT** IANA format (`Australia/Brisbane`). Use the exact value from `configure_props`.

## DateTime Format

Use ISO 8601 without timezone suffix: `yyyy-MM-ddTHH:mm:ss` (e.g., `2026-02-04T14:00:00`). The timezone is specified separately via the `timeZone` prop.

## Creating Events — `attendees` is Required

The `create-calendar-event` action requires `attendees` even for personal events. Use the organizer's email if no other attendees:

```json
{
  "microsoftOutlook": { "authProvisionId": "auto" },
  "subject": "Meeting Title",
  "start": "2026-02-04T14:00:00",
  "end": "2026-02-04T15:00:00",
  "timeZone": "E. Australia Standard Time",
  "attendees": ["user@example.com"],
  "location": "Conference Room A"
}
```

## Teams Meetings Auto-Generate

Set `isOnlineMeeting: true` to automatically create a Teams meeting link. The response includes `onlineMeeting.joinUrl` and the meeting details are appended to the event body. Business accounts show `onlineMeetingProvider: "teamsForBusiness"`.

## Creating Recurring Events

Use the `expand` prop with a `recurrence` object to create recurring events:

```json
{
  "microsoftOutlook": { "authProvisionId": "auto" },
  "subject": "Weekly Standup",
  "start": "2026-02-09T10:00:00",
  "end": "2026-02-09T11:00:00",
  "timeZone": "E. Australia Standard Time",
  "attendees": ["user@example.com"],
  "expand": {
    "recurrence": {
      "pattern": { "type": "weekly", "interval": 1, "daysOfWeek": ["monday"] },
      "range": { "type": "endDate", "startDate": "2026-02-09", "endDate": "2026-03-09" }
    }
  }
}
```

Pattern types: `daily`, `weekly`, `absoluteMonthly`, `relativeMonthly`, `absoluteYearly`, `relativeYearly`.

## Updating Recurring Event Instances

To modify a single occurrence of a recurring series:

- Use `configure_props` with `recurringEventId`, `startDateTime`, and `endDateTime` to get available `instanceId` values
- Pass the resolved `instanceId` to `update-recurring-event-instance` or `delete-recurring-event-instance`
- The `startDateTime` and `endDateTime` define the date range to search for instances (use ISO 8601 with Z suffix, e.g., `2026-02-09T00:00:00Z`)

## `get-schedule` Cross-Tenant Limitation

The `get-schedule` action works for the user's own calendar and same-tenant users, but fails for cross-tenant/external users with a `FederatedCrossForest` timeout error. This is a Microsoft Graph API limitation — cross-tenant queries require Azure AD federation between organizations, which most personal/small business accounts don't have configured. The `findMeetingTimes` API has the same limitation.

## `search-people` vs `search-contacts`

- `search-people`: Returns "relevant people" based on communication patterns and business relationships. For business accounts, this includes organizational directory users.
- `search-contacts`: Returns saved contacts from the Contacts folder only

Use `search-people` to find recent collaborators; use `search-contacts` for explicitly saved contacts.

## `list-events` Supports OData

Use `orderBy` (e.g., `start/dateTime`) and `maxResults` to control results. The `filter` parameter also works for date range queries.

## Pagination — Follow `@odata.nextLink`, Never Iterate `$skip`

For bulk calendar fetches (e.g. a full year of `calendarView`), use `proxy_request` against the raw Graph endpoint and follow `@odata.nextLink` until it's absent.

- **Never re-walk a date window from `$skip=0`.** If you discover you need an extra `$select` field after starting, that's expensive — decide the full `$select` set up front (e.g. `subject,start,end,attendees,organizer,location,isOnlineMeeting`) before issuing the first page.
- **Never iterate `$skip=0, 100, 200, ...` manually.** Use `@odata.nextLink` instead.
- **Built-in actions (`list-events`, etc.) strip pagination tokens** — `@odata.nextLink` does not survive `run_action`. Use `proxy_request` for multi-page fetches.
- For `calendarView` specifically: query `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=...&endDateTime=...&$select=...&$top=200` and then follow the `@odata.nextLink` from each response.

## Summing Meeting Time — All-Day Events ≈ 0h

When totalling time ("how many meeting-hours this week?"), treat all-day events, out-of-office, and "working location" entries as ≈0h, not 24h — one all-day event otherwise swamps the total. State the convention you used; sub-15-minute slots are usually buffers, not meetings. Always bound a time query on BOTH ends (`startDateTime` AND `endDateTime` for `calendarView`) — never leave the end open, or recurring events expand far into the future.

## Event IDs Are Required for Updates/Deletes

Get the event `id` (long base64 string) from `list-events` or `create-calendar-event` response, then pass it to `update-calendar-event` or `delete-calendar-event`.

## Recurring Events Have Separate Actions

Use `update-recurring-event-instance` and `delete-recurring-event-instance` to modify single occurrences of a recurring event without affecting the series. Deleting the series master (`delete-calendar-event` on the original event ID) deletes all instances.
