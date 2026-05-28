# Google Calendar Integration

## Multiple Connected Calendars (FEAT-019)

If the **Connected Integrations** section above lists more than one account under `google_calendar`, each one is a separate Google account with its own calendars.

- `"authProvisionId": "auto"` resolves to ONE account (the oldest). Fine for "what's on my calendar?" when context implies a single account.
- When the user references multiple accounts ("both calendars", "my work + personal calendar", "from each account"), iterate by calling `run_action` once per account with the explicit `apn_xxx` from the multi-account list.
- Note: within a single Google account, `list-calendars` returns multiple calendars (primary, shared, etc.). This is separate from the multi-account roster — both layers may apply.

## Essential First Step

Always call `get-current-user` first to obtain primary calendar ID, timezone, accessible calendars, and color palettes. This saves time and prevents timezone issues.

## Auth Structure

Auth key is `googleCalendar` (camelCase):

```json
{ "googleCalendar": { "authProvisionId": "auto" }, "...other_params": "..." }
```

## Critical Gotchas

- **Date/time format:** RFC3339 with timezone offset required: `2026-02-10T14:00:00+10:00`
- **`query-free-busy-calendars`:** `calendarId` is an **ARRAY**, not a string:
  ```json
  {"calendarId": ["primary"]}   // Correct
  {"calendarId": "primary"}     // Wrong
  ```
- **`orderBy="startTime"`:** Requires `singleEvents: true` or it will fail.
- **`maxResults` default:** 250 events. Max 2500. For larger pulls, use `proxy_request` against `https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` and follow `nextPageToken` (pass it back as `pageToken=...`) until it's absent. Built-in `list-events` strips `nextPageToken`, so it can't be paginated past one page. Never re-walk a date range from the start with different params — decide your full field set up front.

## Resolving Attendee Emails

If the user refers to someone by name without providing their email, use `list-events` with the `q` parameter to search past events (e.g., `q: "Tony"`). Extract the correct email from the `attendees` list in matching events rather than guessing the address format. If no match is found, ask the user for the email directly.

## When to Use What

- **"Find free time with [person]"** → `query-free-busy-calendars` with their email in the array
  - Shows busy/free only (privacy-respecting)
  - Works cross-org
  - Returns timezone-aware results
  - Don't use `list-events` for this
- **"Schedule a meeting"** → `create-event` with attendees array
- **"Quick meeting tomorrow at 2pm"** → `quick-add-event` with natural language
- **"Meeting with video"** → `create-event` with `createMeetRoom: true` (generates Meet link automatically)
- **"When am I free?"** → `list-events` then calculate gaps
- **Creating meetings** → Default to `createMeetRoom: true` unless user explicitly says no video/in-person only
  - Automatically generates Google Meet link
  - Adds dial-in details to `conferenceData`

## Key Parameters

- `calendarId`: Defaults to `"primary"` if omitted
- `sendUpdates`: Use `"none"` for testing, `"all"` to notify attendees
- `createMeetRoom: true`: Returns `hangoutLink` and full `conferenceData` with dial-in
- `timeZone`: Supports IANA timezones, get from `get-current-user`

## Dynamic Props (`configure_props`)

Three props support remote options:

- `calendarId`: User's accessible calendars
- `colorId`: Event color IDs (1-11)
- `timeZone`: Full IANA timezone list

## Example: Check Availability

```json
{
  "googleCalendar": { "authProvisionId": "auto" },
  "calendarId": ["colleague@company.com"],
  "timeMin": "2026-02-03T09:00:00+10:00",
  "timeMax": "2026-02-03T17:00:00+10:00",
  "timeZone": "Australia/Brisbane"
}
```

Returns busy blocks. Gaps = free time.

## Note on Transcription

Google Meet transcription cannot be enabled via the Calendar API. Users must:

- Enable it manually in each meeting, or
- Set as default in Google Workspace admin console settings
