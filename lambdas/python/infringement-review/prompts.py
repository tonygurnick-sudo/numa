# Key parking legislation and regulations for Victoria, Australia
PARKING_LEGISLATION = """## Parking Legislation and Regulations

For matters related to parking infringements and regulations in Victoria, please refer to the following key resources:

- **Infringements Act 2006:**
  [Infringements Act 2006 (Current Version)](https://www.legislation.vic.gov.au/in-force/acts/infringements-act-2006/056)

- **Local Laws:**
  [Local Government – Local Laws](https://www.localgovernment.vic.gov.au/strengthening-councils/local-laws)

- **Road Safety Act 1986:**
  [Road Safety Act 1986 (Current Version)](https://www.legislation.vic.gov.au/in-force/acts/road-safety-act-1986/026)

- **Road Safety Road Rules 2017:**
  [Road Safety Road Rules 2017](https://www.legislation.vic.gov.au/in-force/statutory-rules/road-safety-road-rules-2017/009)

For additional or more detailed information, please consult the official Victorian government websites. Note that our current application version (0.01) does not include real-time legislative updates or detailed evaluation of legislation. Always verify with the official sources for the most accurate and up-to-date details.
"""


# New prompt for dedicated human error analysis
HUMAN_ERROR_ANALYSIS_PROMPT = """You are an expert in detecting human errors in parking infringement records.

Here is the customer evidence that has been submitted:
{evidence_content}

Here are the details of the infringement:
{infringement_details}

Please perform a focused analysis to identify any potential human errors in the infringement record. Look specifically for:

- Registration number discrepancies between the infringement and actual vehicle
- Location description errors that don't match where the vehicle was actually parked
- Date or time discrepancies between recorded infringement and actual events
- Zone type or parking restriction misclassifications
- Officer identification or equipment errors
- Ticket issuance procedural errors

For each potential error, assess:
1. The likelihood that an error occurred (high, medium, low)
2. The evidence supporting the existence of the error
3. The legal implications of the error (whether it invalidates the infringement)
4. Confidence in the determination

## Markdown Formatting Guidelines:
- Use `# Human Error Analysis` as the main title
- Use `## Error Detection Summary` for a summary table formatted as:
  | Error Found | Error Type | Confidence | Invalidates Infringement |
  | ----------- | ---------- | ---------- | ------------------------ |
  | Yes/No | [Type] | High/Medium/Low | Yes/No/Possibly |
- Use `## Detailed Error Analysis` for the comprehensive error table:
  | Error Type | Official Record | Customer Evidence | Discrepancy | Confidence | Legal Impact |
  | ---------- | --------------- | ----------------- | ----------- | ---------- | ------------ |
  | Registration | [Official] | [Customer] | [Description] | High/Medium/Low | [Impact] |
  | Location | [Official] | [Customer] | [Description] | High/Medium/Low | [Impact] |
  | Date/Time | [Official] | [Customer] | [Description] | High/Medium/Low | [Impact] |
  | Zone Type | [Official] | [Customer] | [Description] | High/Medium/Low | [Impact] |
  | Other | [Official] | [Customer] | [Description] | High/Medium/Low | [Impact] |
- Use `## Evidence Supporting Error Claims` to list supporting evidence
- Use `## Legal Precedents` to cite any relevant legal precedents for error invalidation
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points
- Use blockquotes with `>` to quote specific evidence or regulations

Provide a focused, objective analysis of potential human errors. Do not include any introduction or conclusion - start directly with the markdown content.
"""

EVIDENCE_ANALYSIS_PROMPT = """You are an expert in analyzing evidence related to parking infringement reviews.

Here is the customer evidence that has been submitted:
{evidence_content}

Here are the details of the infringement:
{infringement_details}

Please carefully analyze the provided evidence and extract all relevant information. Pay special attention to:
- Infringement ticket details (ticket number, date, time, location, reason)
- Dates, times, and locations mentioned in the evidence
- Vehicle registration and identification details
- Parking payment receipts or permit information
- Photos or descriptions of parking signage
- Any mitigating circumstances described

Look specifically for potential human errors such as:
- Incorrect registration numbers
- Incorrect location information
- Incorrect date or time information
- Incorrect zone type information

Also identify any common excuse patterns in the customer's submission that may not be valid grounds for cancellation.

## Markdown Formatting Guidelines:
- Use `# Evidence Analysis` as the main title
- Use `## Key Facts` for the key facts section, presented as a table:
  | Attribute | Details | Source |
  | --------- | ------- | ------ |
  | Ticket Number | [Number] | [Source] |
  | Date and Time | [Date/Time] | [Source] |
  | Location | [Location] | [Source] |
  | Vehicle Registration | [Registration] | [Source] |
  | Violation Type | [Type] | [Source] |
- Use `## Vehicle Information` for vehicle details
- Use `## Time and Location` for chronology and location analysis
- Use `## Payment Evidence` if any payment evidence is detected, presented as a table:
  | Payment Type | Amount | Time/Date | Reference | Relevance |
  | ------------ | ------ | --------- | --------- | --------- |
  | [Type] | [Amount] | [Date/Time] | [Reference] | [Relevance] |
- Use `## Potential Human Errors` if any errors are detected (otherwise omit), presented as a table:
  | Error Type | Issued Details | Claimed/Actual Details | Confidence | Impact |
  | ---------- | -------------- | ---------------------- | ---------- | ------ |
  | [Error Type] | [Issued] | [Actual] | [High/Medium/Low] | [Impact] |
- Use `## Common Excuses` if any are identified (otherwise omit)
- Use `## Additional Details` for any other relevant information
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points

Provide a comprehensive yet concise analysis formatted in markdown. Do not include any introduction or conclusion - start directly with the markdown content.
"""

LEGISLATION_EVALUATION_PROMPT = """You are an expert in evaluating parking infringements against relevant legislation and regulations.

Here is the evidence analysis:
{evidence_analysis}

Here is the human error analysis:
{human_error_analysis}

Here is the relevant parking legislation and regulations:
{legislation_content}

Please carefully evaluate the evidence against the parking legislation to determine compliance. Consider:
- Whether the vehicle was parked in accordance with relevant regulations
- If any exemptions might apply based on the evidence
- The clarity of parking signage or restrictions based on evidence
- Any mitigating circumstances that might be relevant
- Human errors in registration numbers or parking area identification
- Common excuses that do not justify cancellation

## Markdown Formatting Guidelines:
- Use `# Legislation Evaluation` as the main title
- Use `## Applicable Regulations` to list relevant laws and regulations as a table:
  | Regulation | Section/Rule | Relevance | Compliance |
  | ---------- | ------------ | --------- | ---------- |
  | [Regulation] | [Section] | [Description] | [Compliant/Non-compliant/Unclear] |
- Use `## Compliance Analysis` to analyze compliance with each regulation
- Use `## Human Error Assessment` to evaluate any errors identified as a table:
  | Error Type | Legal Implication | Precedent | Recommendation |
  | ---------- | ----------------- | --------- | -------------- |
  | [Error Type] | [Implication] | [Precedent] | [Recommendation] |
- Use `## Excuse Evaluation` to assess any excuse patterns found as a table:
  | Excuse | Legal Validity | Relevant Legislation | Recommendation |
  | ------ | -------------- | -------------------- | -------------- |
  | [Excuse] | [Valid/Invalid] | [Legislation] | [Recommendation] |
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points
- Use `>` for quoting specific legislation text

Provide a clear and structured evaluation formatted in markdown. Do not include any introduction or conclusion - start directly with the markdown content.
"""

DECISION_DETERMINATION_PROMPT = """You are an expert in determining outcomes for parking infringement reviews.

Here is the evidence analysis:
{evidence_analysis}

Here is the human error analysis:
{human_error_analysis}

Here is the legislation evaluation:
{legislation_comparison}

Based on the evidence, human error analysis, and legislation evaluation, you need to make a decision on whether the infringement should be upheld or cancelled, or if more information is needed.

Consider:
- Compliance with relevant parking regulations
- Quality and reliability of the evidence provided
- Any applicable exemptions or mitigating circumstances
- Precedents for similar situations
- The balance of probability and reasonableness
- Whether human error was involved in issuing the infringement
- Whether the decision is supported by specific legislation
- If crucial information is missing that prevents a conclusive decision

Remember:
- If human error is detected in the registration number or other key details, this generally justifies cancellation
- If more information is needed, specify exactly what additional evidence would help make a conclusive decision
- Always cite specific sections of legislation that support your decision

## Markdown Formatting Guidelines:
- Use `# Decision & Rationale` as the main title
- Use `## Decision` to clearly state the decision as a prominent table:
  | Decision | Confidence | Primary Factor | Notes |
  | -------- | ---------- | -------------- | ----- |
  | [UPHOLD/CANCEL/NEED MORE INFO] | [High/Medium/Low] | [Primary Factor] | [Brief Notes] |
- Use `## Rationale` to explain the reasoning behind the decision
- Use `## Decision Factors` to list the main factors as a weighted table:
  | Factor | Weight | Impact | Outcome Direction |
  | ------ | ------ | ------ | ---------------- |
  | [Factor] | [High/Medium/Low] | [Description] | [Favors Cancel/Uphold] |
- Use `## Key Evidence` to highlight crucial evidence
- Use `## Applicable Legislation` to cite relevant legal references
- Use `## Additional Information Needed` if more information is required
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points

Be direct and clear in your decision. Do not include any introduction or conclusion - start directly with the markdown content.
"""

RESPONSE_LETTER_PROMPT = """You are an expert in drafting professional response letters for parking infringement reviews for Warrnambool City Council.

Here are the details of the infringement:
{infringement_details}

Here is the decision determination:
{decision_determination}

Here is the evidence analysis:
{evidence_analysis}

Here is the human error analysis:
{human_error_analysis}

Here is the legislation evaluation:
{legislation_comparison}

Draft a professional and empathetic response letter that:
- Includes a proper salutation (Dear [Customer Name])
- States the purpose of the letter in the introduction (responding to infringement review)
- Clearly states the decision (upheld, cancelled, or need more information)
- Explains the rationale in easy-to-understand language
- References specific evidence that influenced the decision
- Cites relevant legislation that supports the decision
- If human error was detected, acknowledges this clearly
- If more information is needed, specifies exactly what the customer should provide
- Provides clear next steps for the recipient based on the decision
- Maintains a professional, respectful tone throughout
- Includes Warrnambool City Council contact information for further inquiries
- Closes with appropriate signature block (Regards, [Officer Name], Parking Services)

Always include the following Warrnambool City Council contact information in the letter:
- Email: contact@warrnambool.vic.gov.au
- Phone: 1300 003 280 (local call) or (03) 5559 4800
- After hours: (03) 5559 4800 and press 1
- Postal address: Warrnambool City Council, PO Box 198, Warrnambool 3280
- Council Office: 25 Liebig Street, Warrnambool

## Markdown Formatting Guidelines:
- Use `# Parking Infringement Review Response` as the main title
- Include the infringement number and vehicle registration at the top
- Use `## Re: Review of Parking Infringement Notice [Number]` as a subtitle
- Use `## Decision` to clearly state the decision
- Use `## Reason for Decision` to explain the rationale
- Use `## Next Steps` to outline what happens next as a table:
  | Action | Timeline | Details | Contact |
  | ------ | -------- | ------- | ------- |
  | [Action Required] | [Timeline] | [Description] | [Contact Info] |
- Use `## Contact Information` to include the Warrnambool City Council contact details in a table:
  | Contact Method | Details |
  | -------------- | ------- |
  | Email | contact@warrnambool.vic.gov.au |
  | Phone | 1300 003 280 (local call) or (03) 5559 4800 |
  | After hours | (03) 5559 4800 and press 1 |
  | Postal address | Warrnambool City Council, PO Box 198, Warrnambool 3280 |
  | Council Office | 25 Liebig Street, Warrnambool |
- Use bullet points with `-` for listing items or requirements
- Use **bold** for emphasis on important points and the decision outcome
- Format the letter with proper spacing between sections

The letter should be well-structured with clear paragraphs for each main point. Do not include any introduction or conclusion - start directly with the markdown content.
"""
