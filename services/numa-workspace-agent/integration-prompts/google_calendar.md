# Google Calendar Integration Tips

All Google Calendar calls go through the `numa integrations` CLI. Action keys
follow `google_calendar-<name>` (`numa integrations pipedream-actions google_calendar`
lists them). Prop names below are verified against the live schemas — if unsure,
`numa integrations pipedream-props google_calendar <action>`.

## Auth key

Standard auth key is `googleCalendar` (camelCase); the proxy normalises it, so the
underscore form also works:

```json
{ "googleCalendar": { "authProvisionId": "auto" }, ... }
```

**One real exception — `respond-to-event`:** its schema names the auth prop `app`
(a different root, not just a casing variant), so pass
`{"app": {"authProvisionId": "auto"}}` for that action specifically.

## Multiple Connected Calendars (FEAT-019)

If the **Connected Integrations** section lists more than one `google_calendar` account, each is a separate Google account.

- `"authProvisionId": "auto"` resolves to ONE account (the oldest). Fine when context implies a single account.
- When the user references multiple accounts ("both calendars", "work + personal", "each account"), iterate — call once per account with the explicit `apn_xxx` as the `authProvisionId`.
- Separately, within one account `list-calendars` returns multiple calendars (primary, shared, holidays). Both layers can apply.

## Essential First Step — `get-current-user`

Call it first for scheduling work. Returns `primaryCalendar` (`id` = the real
calendar address, e.g. `nathan@arcanum.ai`; `timeZone` = the user's IANA zone),
`calendars[]` (accessible calendars + access roles + colorIds), `settings[]`, and
the full `colors` palette. Use its `timeZone` to build correct datetimes —
**don't** rely on `get-date-time` for the offset (see below).

## ⚠️ `get-date-time` — timezone fields are broken

`get-date-time` returns malformed `timezoneOffset` and `rfc3339` fields — a float
where the offset should be (e.g. `timezoneOffset: "+00:0.0101"`,
`rfc3339: "...+00:0.0101"`). **Don't use those two fields.** Safe fields:
`date`, `time`, `timestamp` (epoch ms), `isoString` (UTC). For a zone-correct
datetime, take the IANA zone from `get-current-user` and build the offset yourself.

## Datetime format

RFC3339 with a mandatory timezone offset for timed events; bare `yyyy-mm-dd` for all-day:

```
2026-06-30T10:00:00+10:00   Brisbane / AEST     2026-06-30T10:00:00+12:00  Auckland / NZST
2026-06-30T10:00:00Z        UTC                 2026-06-30                  all-day
```

## Event IDs — never truncate

Event IDs from `list-events` with `singleEvents: true` are **per-instance** IDs for
recurring events, formatted `<baseId>_<utcDateTimeZ>` (e.g.
`v2i7khf1onfl202vlalj3mephe_20260621T220000Z`). The **full** string is required for
`get-event` / `update-event` / `delete-event` / `respond-to-event` — slicing it
(even to "clean it up") returns 404. Always pass the complete `id` from the list result.

For instance-series operations (`list-event-instances`, `update-event-instance`,
`update-following-instances`) you need the **recurring base ID** — read it from the
`recurringEventId` field on any instance (present in `get-event` / the raw API), then
pass it as `eventId`.

## `attendees` prop type differs by action (easy to get wrong)

| Action                                                      | `attendees` type             |
| ----------------------------------------------------------- | ---------------------------- |
| `create-event`                                              | `string[]` (array of emails) |
| `update-event`, `quick-add-event`, `add-attendees-to-event` | `string` (comma-separated)   |

Check the schema before constructing it — passing the wrong shape silently fails.

## `list-events`

Props: `calendarId` (defaults `"primary"`), `timeMin`/`timeMax`, `singleEvents`,
`orderBy`, `maxResults`, `q`, `eventTypes`.

- **Always set BOTH `timeMin` AND `timeMax`.** Omitting `timeMax` with `singleEvents: true` expands recurring events far into the future — one bench pulled **14,481 events out to 2056** in a single call (28 wasted turns). Bound every query on both ends.
- `orderBy: "startTime"` requires `singleEvents: true`.
- `maxResults` default 250, max 2500/page. **`pipedream-call` strips `nextPageToken`** — for >2500 or multi-page, use `numa integrations request` (below) and follow the token.
- `eventTypes` filters by `"default"` / `"focusTime"` / `"outOfOffice"` / `"workingLocation"`.
- **All-day / working-location / OOO events have ~0 duration** and use `start.date`, not `start.dateTime`. When summing meeting-hours, treat them as ≈0h (not 24h) — one all-day event otherwise swamps the total (models have reported 1,560h vs 4.5h for the same week). Filter with `eventTypes: ["default"]` and/or check for `start.dateTime` presence. State the convention you used.

## `query-free-busy-calendars` — `calendarId` is an ARRAY

```json
{ "calendarId": ["primary"] } // ✓     {"calendarId": "primary"}   // ✗ fails
```

`timeMin`/`timeMax` required. Returns `{calendars: {<calId>: {busy: [{start, end}]}}}` — gaps between busy slots are free time. Works cross-org (privacy-respecting) — the right tool for "find free time with [person]", not `list-events`.

## `create-event`

Props: `summary` (title), `eventStartDate`/`eventEndDate` (RFC3339, or `yyyy-mm-dd`
for all-day), `location`, `description`, `attendees` (**string[]**), `colorId`,
`timeZone`, `sendUpdates`, `createMeetRoom`, `visibility`, and recurrence
(`repeatFrequency`, `repeatInterval`, `repeatSpecificDays`, `repeatUntil`, `repeatTimes`).

- `sendUpdates`: `"all"` notifies attendees, `"none"` stays silent. Use `"none"` for tests.
- `createMeetRoom: true` adds a Google Meet link (`hangoutLink` + `conferenceData`). Default to it for meetings unless the user says in-person/no-video.
- `repeatSpecificDays` (`"MO","TU",…`) needs `repeatFrequency: "WEEKLY"`.

## `quick-add-event`

`text` accepts natural language ("Standup tomorrow 9am") — Google parses date/time/zone. `attendees` here is a **string**.

## `update-event`

`eventId` (full ID) + the fields to patch; omitted fields are preserved. `attendees` is a **string** here. `sendUpdates: "none"` for silent edits.

## `respond-to-event`

**Auth prop is `app`** (not `googleCalendar`). Identify the event by `eventId`
(exact) or `eventName` (fuzzy — first matching upcoming; `eventId` wins if both
given). `responseStatus`: `"accepted"` / `"declined"` / `"tentative"`.

## `update-event-instance` / `update-following-instances`

Both take the recurring base `eventId` plus the specific instance. `update-event-instance` changes one occurrence; `update-following-instances` splits the series at that instance (earlier ones untouched, that point forward updated). Use carefully on series you own.

## Resolving attendee emails

If the user names someone without an email, `list-events` with `q: "Tony"` and pull the address from the matching event's `attendees` rather than guessing. If no match, ask.

## Dynamic props (`pipedream-props-options`) — all three work

```bash
numa integrations pipedream-props-options google_calendar google_calendar-list-events calendarId \
  --google_calendar '{"authProvisionId":"auto"}' -m "List calendars"
```

- `calendarId` → the user's accessible calendars (id + summary). Or pass `"primary"` / the calendar's email directly.
- `colorId` → the 11 event colours (values `"1"`–`"11"`, with names). The standalone `google_calendar-list-color-id-options` action returns the same.
- `timeZone` → the full IANA list (~597 zones).

## Direct API (`numa integrations request google_calendar`)

No special headers needed. Use for pagination beyond one page or fields the actions don't surface (`recurringEventId`, etc.). Follow `nextPageToken` with `&pageToken=<token>`:

```bash
numa integrations request google_calendar GET \
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&timeMin=2026-01-01T00:00:00Z&timeMax=2026-12-31T00:00:00Z&maxResults=2500" \
  -m "Fetch events"
```

## Google Meet transcription

Can't be enabled via the Calendar API — users enable it per-meeting or set it as default in the Workspace admin console.
