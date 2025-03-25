# Key parking legislation and regulations for Victoria, Australia
PARKING_LEGISLATION = """
# Victorian Parking Legislation and Regulations

## Infringements Act 2006
The Infringements Act 2006 establishes the framework for the enforcement of infringement notices in Victoria, including parking infringements.

### Key Provisions:
- **Section 9**: Specifies requirements for the form and content of infringement notices
- **Section 22**: Outlines the process for internal review of infringement notices
- **Section 23**: Establishes grounds for cancellation including:
  - Contrary to law
  - Mistake of identity
  - Special circumstances
  - Exceptional circumstances
  - Person unaware of notice
  - Notice is invalid or defective
- **Section 25**: Permits withdrawal of infringement notices after review

## Road Safety Act 1986
The Road Safety Act 1986 contains provisions related to road usage and parking regulations.

### Key Provisions:
- **Section 77**: Powers of councils to make local laws regarding parking
- **Section 87**: Establishes owner onus for vehicle-related offenses, including parking
- **Section 90D**: Requirements for service of parking infringement notices
- **Section 90E**: Stipulates timeframes for payments and actions on parking infringements

## Road Safety Road Rules 2017
These rules detail specific parking regulations including prohibited locations, time restrictions, and special zones.

### Key Parking Rules:
- **Rule 167-170**: Stopping on clearways, transit/bus/tram lanes
- **Rule 171-175**: Stopping at or near intersections, crossings, and clearways
- **Rule 176-179**: Stopping on or near children's/pedestrian crossings
- **Rule 183-185**: Stopping in loading zones or permit zones
- **Rule 197-200**: Stopping on paths, dividing strips, and nature strips
- **Rule 201-203**: Stopping in bicycle lanes, tram lanes, and truck lanes
- **Rule 205-207**: Parking for longer than indicated or outside permitted hours
- **Rule 208-209**: Parking in parallel, angle, or center-of-road arrangements

## Local Government Act 1989
This act empowers councils to create and enforce local laws, including those related to parking management.

### Key Provisions:
- **Section 111**: Power to make local laws
- **Section 224**: Appointment of authorized officers for enforcement
- **Section 225**: Power to issue infringement notices

## Council Local Laws
Local councils have specific parking by-laws that may include:
- Residential parking permit schemes
- Time-limited parking zones
- Paid parking areas
- Special event parking restrictions
- Loading zones
- Accessible parking provisions
- Clearways and no-stopping zones

## Human Error Considerations
According to legal precedents and official guidelines:
- Errors in vehicle registration details on the infringement notice are grounds for cancellation
- Errors in location information that significantly misrepresent where the violation occurred may invalidate the notice
- Illegible or obscured signage may constitute grounds for cancellation
- Technical defects in the notice itself may render it invalid

## Common Invalid Excuses
The following are generally NOT considered valid grounds for cancellation:
- Claiming ignorance of parking rules
- Brief overstay of permitted time ("just a few minutes late")
- Not seeing the parking sign (unless the sign was demonstrably obscured or unclear)
- Running late for appointments
- Inability to find other parking
- Forgetting to display a valid permit (unless exceptional circumstances exist)
- First-time offense (without other mitigating factors)
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
- Use `## Key Facts` for the key facts section
- Use `## Vehicle Information` for vehicle details
- Use `## Time and Location` for chronology and location analysis
- Use `## Potential Human Errors` if any errors are detected (otherwise omit)
- Use `## Common Excuses` if any are identified (otherwise omit)
- Use `## Additional Details` for any other relevant information
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points

Provide a comprehensive yet concise analysis formatted in markdown. Do not include any introduction or conclusion - start directly with the markdown content.
"""

LEGISLATION_EVALUATION_PROMPT = """You are an expert in evaluating parking infringements against relevant legislation and regulations.

Here is the evidence analysis:
{evidence_analysis}

Here is the relevant parking legislation and regulations:
{legislation_content}

Please carefully evaluate the evidence against the parking legislation to determine compliance. Consider:
- Whether the vehicle was parked in accordance with relevant regulations
- If any exemptions might apply based on the evidence
- The clarity of parking signage or restrictions based on evidence
- Any mitigating circumstances that might be relevant
- Potential human errors in registration numbers or parking area identification
- Common excuses that do not justify cancellation

## Markdown Formatting Guidelines:
- Use `# Legislation Evaluation` as the main title
- Use `## Applicable Regulations` to list relevant laws and regulations
- Use `## Compliance Analysis` to analyze compliance with each regulation
- Use `## Potential Exemptions` to discuss possible exemptions (if any)
- Use `## Human Error Assessment` to evaluate any errors identified
- Use `## Excuse Evaluation` to assess any excuse patterns found
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points
- Use `>` for quoting specific legislation text

Provide a clear and structured evaluation formatted in markdown. Do not include any introduction or conclusion - start directly with the markdown content.
"""

DECISION_DETERMINATION_PROMPT = """You are an expert in determining outcomes for parking infringement reviews.

Here is the evidence analysis:
{evidence_analysis}

Here is the legislation evaluation:
{legislation_comparison}

Based on the evidence and legislation evaluation, you need to make a decision on whether the infringement should be upheld or cancelled, or if more information is needed.

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
- Use `## Decision` to clearly state the decision (UPHOLD, CANCEL, or NEED MORE INFO)
- Use `## Confidence Level` to indicate confidence (high, medium, or low)
- Use `## Rationale` to explain the reasoning behind the decision
- Use `## Primary Factors` to list the main factors that influenced the decision
- Use `## Secondary Factors` to list contributing factors (if any)
- Use `## Key Evidence` to highlight crucial evidence
- Use `## Applicable Legislation` to cite relevant legal references
- Use `## Additional Information Needed` if more information is required
- Use bullet points with `-` for listing items
- Use **bold** for emphasis on important points

Be direct and clear in your decision. Do not include any introduction or conclusion - start directly with the markdown content.
"""

RESPONSE_LETTER_PROMPT = """You are an expert in drafting professional response letters for parking infringement reviews.

Here are the details of the infringement:
{infringement_details}

Here is the decision determination:
{decision_determination}

Here is the evidence analysis:
{evidence_analysis}

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
- Includes contact information for further inquiries (phone and email)
- Closes with appropriate signature block (Regards, [Officer Name], Parking Services)

## Markdown Formatting Guidelines:
- Use `# Parking Infringement Review Response` as the main title
- Include the infringement number and vehicle registration at the top
- Use `## Re: Review of Parking Infringement Notice [Number]` as a subtitle
- Use `## Decision` to clearly state the decision
- Use `## Reason for Decision` to explain the rationale
- Use `## Next Steps` to outline what happens next
- Use bullet points with `-` for listing items or requirements
- Use **bold** for emphasis on important points and the decision outcome
- Format the letter with proper spacing between sections

The letter should be well-structured with clear paragraphs for each main point. Do not include any introduction or conclusion - start directly with the markdown content.
"""
