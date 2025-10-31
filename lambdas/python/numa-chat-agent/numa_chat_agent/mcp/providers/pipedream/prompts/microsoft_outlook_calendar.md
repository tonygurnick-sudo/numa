### Outlook Calendar — List Events
CRITICAL PARAMETER REQUIREMENTS:
- MUST use StartDateTime and EndDateTime as separate query parameters (not filter)
- Format: StartDateTime="YYYY-MM-DDTHH:mm:ss.sssZ", EndDateTime="YYYY-MM-DDTHH:mm:ss.sssZ" (ISO 8601 with Z suffix)
- DO NOT use filter parameter for date ranges
- DO NOT construct OData filter expressions like "start/dateTime ge '...' and end/dateTime le '...'"

Always set:
- StartDateTime and EndDateTime (absolute, ISO 8601 format with Z suffix)
- maxResults=50 (unless otherwise specified)
- includeRecurring=true (expand recurring events)
- orderBy="start/dateTime asc" (if supported)
- $select=id,subject,start,end,organizer,location (to limit payload)
- Prefer header: outlook.timezone="[user's timezone]" (e.g., "Australia/Brisbane")

### Outlook Calendar — Create / Update / Delete Event
- Create: pass summary/subject, body, location, and structured times {dateTime, timeZone} for start/end. Include attendees[]. Enable online meeting if supported. Always set: subject, contentType (html or text), content, timeZone, start, end, and attendees.
- Update: require eventId; preserve attendees and online meeting/conference data; set “send updates” behavior if exposed.
- Delete: require eventId; confirm whether guests get notifications (depends on action).

Timezone everywhere: Always pass timeZone on list/create/update. Don’t assume tenant defaults.

Payload optimization:
- Use $select to limit returned fields and reduce response size
- Set $top parameter to reasonable limits (50 for lists)
- Exclude problematic fields: allowedOnlineMeetingProviders, defaultOnlineMeetingProvider
- Prefer /calendarView over /events when possible for date-range queries
