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
  "microsoftOutlook": {"authProvisionId": "auto"},
  "subject": "Meeting Title",
  "start": "2026-02-04T14:00:00",
  "end": "2026-02-04T15:00:00",
  "timeZone": "E. Australia Standard Time",
  "attendees": ["user@example.com"],
  "location": "Conference Room A"
}
```

## Teams Meetings Auto-Generate
Set `isOnlineMeeting: true` to automatically create a Teams meeting link. The response includes `onlineMeeting.joinUrl` and the meeting details are appended to the event body.

## `get-schedule` Cross-Tenant Limitation
The `get-schedule` action works for the user's own calendar and same-tenant users, but fails for cross-tenant/external users with a `FederatedCrossForest` timeout error. This is a Microsoft Graph API limitation — cross-tenant queries require Azure AD federation between organizations, which most personal/small business accounts don't have configured. The `findMeetingTimes` API has the same limitation.

## `search-people` vs `search-contacts`
- `search-people`: Returns "relevant people" based on communication patterns — these are implicit contacts from email/meeting history, ranked by relevance score
- `search-contacts`: Returns saved contacts from the Contacts folder only

Use `search-people` to find recent collaborators; use `search-contacts` for explicitly saved contacts.

## `list-events` Supports OData
Use `orderBy` (e.g., `start/dateTime`) and `maxResults` to control results. The `filter` parameter also works for date range queries.

## Event IDs Are Required for Updates/Deletes
Get the event `id` (long base64 string) from `list-events` or `create-calendar-event` response, then pass it to `update-calendar-event` or `delete-calendar-event`.

## Recurring Events Have Separate Actions
Use `update-recurring-event-instance` and `delete-recurring-event-instance` to modify single occurrences of a recurring event without affecting the series.
