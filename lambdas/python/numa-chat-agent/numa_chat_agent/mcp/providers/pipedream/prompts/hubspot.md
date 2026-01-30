HubSpot Integration Guidelines:

- TIMESTAMPS: For required timestamp fields (like `hs_timestamp`), automatically generate current time as epoch milliseconds (e.g., 1737478926944)
- Use JavaScript Date.now() equivalent: current Unix timestamp * 1000
- Common HubSpot timestamp fields: hs_timestamp, createdate, lastmodifieddate
- If instruction doesn't specify time, use current time for create operations
- Format: epoch milliseconds (13-digit number representing milliseconds since Unix epoch)

Additional HubSpot-specific notes:

- For note creation, always include `hs_timestamp` field with current time
- Contact and company associations should use object IDs from the instruction context
- Use appropriate note types when specified (EMAIL, CALL, MEETING, TASK, etc.)
- Keep note content concise and professional
