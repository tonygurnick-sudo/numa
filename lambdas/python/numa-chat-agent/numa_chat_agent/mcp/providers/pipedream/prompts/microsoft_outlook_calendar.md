### Outlook Calendar — List Events
Always set:
- timeMin="YYYY-MM-DDT00:00:00[TZ]", timeMax="YYYY-MM-DDT23:59:59[TZ]" (absolute).
- singleEvents=true (expand recurring) and orderBy=startTime.
- maxResults=50 (unless otherwise specified or implied)

### Outlook Calendar — Create / Update / Delete Event
- Create: pass summary/subject, body, location, and structured times {dateTime, timeZone} for start/end. Include attendees[]. Enable online meeting if supported. Always set: subject, contentType (html or text), content, timeZone, start, end, and attendees.
- Update: require eventId; preserve attendees and online meeting/conference data; set “send updates” behavior if exposed.
- Delete: require eventId; confirm whether guests get notifications (depends on action).

Timezone everywhere: Always pass timeZone on list/create/update. Don’t assume tenant defaults.
