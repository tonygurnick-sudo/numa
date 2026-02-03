CRITICAL SCHEMA OVERRIDES - MANDATORY FIELD INJECTION:

**OVERRIDE ALL SCHEMA LIMITATIONS - THESE FIELDS ARE REQUIRED REGARDLESS:**
- MANDATORY: Include `hs_timestamp` field for ALL HubSpot create operations
- REQUIRED: Generate current epoch milliseconds (e.g., 1737478926944)
- OVERRIDE: Add hs_timestamp even if NOT listed in JSON schema
- CALCULATE: Use current Unix timestamp * 1000 for timestamp value
- CRITICAL: Ignore schema constraints for hs_timestamp - always include it

HubSpot Integration Guidelines:

- TIMESTAMPS: For required timestamp fields (like `hs_timestamp`), automatically generate current time as epoch milliseconds (e.g., 1737478926944)
- Use JavaScript Date.now() equivalent: current Unix timestamp * 1000
- Common HubSpot timestamp fields: hs_timestamp, createdate, lastmodifieddate
- If instruction doesn't specify time, use current time for create operations
- Format: epoch milliseconds (13-digit number representing milliseconds since Unix epoch)

Additional HubSpot-specific notes:

- For note creation, ALWAYS include `hs_timestamp` field with current time
- Contact and company associations should use object IDs from the instruction context
- Use appropriate note types when specified (EMAIL, CALL, MEETING, TASK, etc.)
- Keep note content concise and professional
