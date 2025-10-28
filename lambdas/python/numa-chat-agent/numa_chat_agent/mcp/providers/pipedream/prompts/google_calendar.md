- Whenever the client supplies a `timeZone` (or equivalent constraint/indication) use it verbatim for queries and event creation and use absolute timestamps in ISO-8601.
- Default list-style operations to `maxResults = 50` unless the user explicitly requests a different limit.
- Prefer concise time windows; if the user does not specify a range, keep queries within 30 days.

Create Event (Detailed, not quick event)
•	set summary, description, location, start={dateTime, timeZone}, end={dateTime, timeZone}.
•	Attendees: provide attendees=[{email, optional: true}].
•	Meet link: if supported, enable the prop to create a Google Meet (or ensure the action’s “conference/Meet” option is on).
•	Notifications: set sendUpdates="all" when you want email notifications to attendees.
•	Recurrence: if exposed, use standard RRULE patterns; otherwise create series explicitly.
•	Visibility: set to private when sensitive.
- For quick events, add params as usual.

Update Event
	•	Requires: eventId (and calendarId if not primary).
	•	Safe updates: When changing times, keep attendees and (if present) conferenceData to preserve the Meet link.
	•	Notify: set sendUpdates="all" if participants should receive changes.
