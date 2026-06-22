# Microsoft Outlook Calendar Integration Tips

All Outlook Calendar calls go through the `numa integrations` CLI. The slug is
`microsoft_outlook_calendar`; action keys are `microsoft_outlook_calendar-<name>`
(`numa integrations pipedream-actions microsoft_outlook_calendar` lists them).
Prop names below are verified against the live schemas — if unsure,
`numa integrations pipedream-props microsoft_outlook_calendar <action>`.

## Auth key

Pass `"microsoftOutlook": {"authProvisionId": "auto"}` — it works for **every**
action. (A couple of schemas name the auth prop differently —
`get-current-user` → `microsoftOutlookCalendar`, `list-time-zone-options` →
`microsoft_outlook_calendar` — but the proxy normalises the key, so the common
`microsoftOutlook` is accepted everywhere. Verified. Don't bother tracking the
per-action variants.)

## Account-type caveat (personal vs M365)

Works with personal Microsoft accounts and M365/Exchange. **M365-only features**
fail on a personal account: `find-meeting-times` and cross-tenant `get-schedule`
return 401, and `isOnlineMeeting: true` yields `onlineMeetingProvider: "unknown"`
with a null `onlineMeeting` (Teams needs a business tenant). On a personal
account the connected address (e.g. `nathandouglassecond@gmail.com`) shows up as
an internal alias (`outlook_XXXX@outlook.com`) in organiser/attendee fields —
expected, doesn't affect anything.

## Establishing context

- `get-current-user` → `id`, `displayName`, `mail`, `userPrincipalName` (identify the account).
- `list-events` (or `get-event`) → event IDs for update/delete/RSVP.
- `list-time-zone-options` → the full timezone list (a dedicated action — faster than `pipedream-props-options` when you just need the list). Also resolvable via `pipedream-props-options ... timeZone`.

## Timezones use Windows format

The `timeZone` prop wants Windows-style names (`AUS Eastern Standard Time`,
`Pacific Standard Time`), **NOT** IANA (`Australia/Brisbane`). Pull the exact
value from `list-time-zone-options` / the `timeZone` props-options.

## DateTime format

ISO 8601 **without** a timezone suffix: `yyyy-MM-ddTHH:mm:ss` (e.g.
`2026-07-01T14:00:00`). The zone is set separately via the `timeZone` prop.

## Creating events — `attendees` is required

`create-calendar-event` requires `subject`, `start`, `end`, `timeZone`, **and
`attendees`** (all schema-required). For a personal event with no real guests,
pass the account owner's own email.

```bash
numa integrations pipedream-call microsoft_outlook_calendar microsoft_outlook_calendar-create-calendar-event \
  --props '{"microsoftOutlook":{"authProvisionId":"auto"},"subject":"Meeting","start":"2026-07-01T10:00:00","end":"2026-07-01T11:00:00","timeZone":"AUS Eastern Standard Time","attendees":["user@example.com"],"location":"Room A"}' \
  -m "Create calendar event"
```

`isOnlineMeeting: true` adds a Teams link (`onlineMeeting.joinUrl`) on M365 accounts.

## Recurring events — use the dedicated `recurrence*` props (not `expand`)

The schema exposes structured top-level props for recurrence — use these rather
than hand-rolling an `expand.recurrence` object:

| Prop                            | For                     | Notes                                                                                  |
| ------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `recurrencePatternType`         | all                     | `daily`/`weekly`/`absoluteMonthly`/`relativeMonthly`/`absoluteYearly`/`relativeYearly` |
| `recurrenceInterval`            | all                     | integer ≥ 1 (every 2 weeks → 2)                                                        |
| `recurrenceDaysOfWeek`          | weekly, relative\*      | array, e.g. `["monday"]`                                                               |
| `recurrenceFirstDayOfWeek`      | weekly                  | defaults `"sunday"`; set `"monday"` for business weeks                                 |
| `recurrenceDayOfMonth`          | absoluteMonthly/Yearly  | 1–31                                                                                   |
| `recurrenceMonth`               | absolute/relativeYearly | 1–12                                                                                   |
| `recurrenceIndex`               | relativeMonthly/Yearly  | `first`…`fourth`/`last` (default `first`)                                              |
| `recurrenceRangeType`           | all                     | `noEnd`/`endDate`/`numbered`                                                           |
| `recurrenceEndDate`             | endDate range           | `yyyy-MM-dd`                                                                           |
| `recurrenceNumberOfOccurrences` | numbered range          | integer ≥ 1                                                                            |

```bash
numa integrations pipedream-call microsoft_outlook_calendar microsoft_outlook_calendar-create-calendar-event \
  --props '{"microsoftOutlook":{"authProvisionId":"auto"},"subject":"Weekly Standup","start":"2026-07-13T10:00:00","end":"2026-07-13T10:30:00","timeZone":"AUS Eastern Standard Time","attendees":["user@example.com"],"recurrencePatternType":"weekly","recurrenceInterval":1,"recurrenceDaysOfWeek":["monday"],"recurrenceFirstDayOfWeek":"monday","recurrenceRangeType":"numbered","recurrenceNumberOfOccurrences":4}' \
  -m "Create weekly recurring event"
```

The response has `type: "seriesMaster"`. Note: the API **shifts the first
occurrence** to the first date matching the pattern — a weekly-Monday series
given a Wednesday `start` begins on the following Monday, not the date you passed.

## Updating / deleting recurring instances

`update-recurring-event-instance` / `delete-recurring-event-instance` change a
single occurrence (series master untouched). They need the specific instance ID
— **get it from the Graph `/instances` endpoint** (the reliable path; the
`instanceId` props-options resolver doesn't return usable values):

```bash
numa integrations request microsoft_outlook_calendar GET \
  "https://graph.microsoft.com/v1.0/me/events/{SERIES_MASTER_ID}/instances?startDateTime=2026-07-01T00:00:00Z&endDateTime=2026-07-31T23:59:59Z&\$select=id,subject,start,end,type" \
  -m "List instances of a recurring series"
```

Pass the instance `id` as `instanceId`. A successfully updated instance flips its
`type` from `"occurrence"` to `"exception"`. Deleting the series master
(`delete-calendar-event` on the original event ID) removes all instances.

## `get-event` vs `list-events`

- `get-event` (`eventId`, optional `select`) returns the **full** event — body, full attendees with RSVP status, recurrence. Use it (with `select` to trim fields) when you need complete data on one event.
- `list-events` props: `filter`, `orderBy`, `maxResults`, `includeRecurring`, `startDateTime`, `endDateTime`.
  - `includeRecurring: false` (default) hits `/me/events` — a recurring series shows as a single `seriesMaster`, not expanded.
  - `includeRecurring: true` hits `/me/calendarView` — each occurrence is its own result; **`startDateTime` + `endDateTime` are required**. Use this to find e.g. "next Monday's standup".

## `update-calendar-event` — include `timeZone` when changing start/end

Updating non-time fields (subject, location) without `timeZone` is fine. When you
change `start`/`end`, **always include `timeZone`** — omitting it stores/returns
the times in UTC, silently shifting the event for other-zone users. (The event
`id` is stable across updates — unlike Outlook _mail_ message IDs, which rotate on move.)

## RSVP actions — `accept-event` / `decline-event` / `tentatively-accept-event`

- Only valid when you're an **attendee**, not the organiser. On a self-organised event Graph returns `ErrorInvalidRequest: You can't respond to this meeting because you're the meeting organizer.`
- `comment` requires `sendResponse: true` — `comment` with `sendResponse: false` → `ErrorInvalidParameter: 'SendResponse' must be true when 'Comment' is not null`.
- `proposedNewTime` is a **JSON string** (valid only with `allowNewTimeProposals: true` and `sendResponse: true`).

## `search-people` vs `search-contacts`

- `search-people` → "relevant people" from communication history (org directory on M365; limited on personal).
- `search-contacts` → saved Contacts-folder entries only.

## `get-schedule` / `find-meeting-times` (M365)

`get-schedule` returns the user's own free/busy but fails for cross-tenant/external
attendees on personal accounts. `find-meeting-times` returns 401 on personal
accounts and, despite `attendees` reading optional, throws a `ConfigurationError`
unless you pass at least one attendee. Both need M365/Exchange to be useful.

## Pagination — follow `@odata.nextLink`, never iterate `$skip`

Built-in actions strip pagination tokens (`@odata.nextLink` doesn't survive a
`pipedream-call`). For bulk fetches use `numa integrations request` against the
Graph endpoint and follow the returned `@odata.nextLink` verbatim until absent:

```bash
numa integrations request microsoft_outlook_calendar GET \
  'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2026-01-01T00:00:00Z&endDateTime=2026-12-31T23:59:59Z&\$select=subject,start,end,attendees,organizer,location,isOnlineMeeting&$top=200' \
  -m "Fetch a year of calendar events"
```

Decide the full `$select` set up front (re-walking with different fields doubles the cost). Never hand-iterate `$skip`.

## Summing meeting time — all-day events ≈ 0h

When totalling meeting-hours, treat all-day events, out-of-office, and
working-location entries as ≈0h (not 24h) — one all-day event otherwise swamps
the total. Always bound `calendarView` on BOTH ends (`startDateTime` AND
`endDateTime`); an open end expands recurring events far into the future. State
the convention you used; sub-15-minute slots are usually buffers, not meetings.
