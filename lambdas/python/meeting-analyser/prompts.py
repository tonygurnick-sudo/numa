TEMPLATE_OUTPUT_PROMPT = """The following are meeting notes and/or transcript from a meeting.
<Meeting notes or transcript>
{meeting_notes_and_or_transcript}
</Meeting notes or transcript>

Your task is to fill in the template below using information from the meeting notes/transcript.

<Template>
{template}
</Template>

Please also consider any additional context provided:
<Other Notes>
{other_notes}
</Other Notes>

FORMATTING INSTRUCTIONS:
- Follow the exact structure of the template
- Use clear markdown formatting with proper headings (# for main headings, ## for subheadings)
- Use bullet points (* item) for lists
- Keep the formatting simple and consistent
- Return ONLY the completed template with no additional text

Result:"""

MEETING_SUMMARY_PROMPT = """Create a concise summary of the following meeting transcript and/or notes.

<Meeting notes or transcript>
{meeting_notes_and_or_transcript}
</Meeting notes or transcript>

Please also consider any additional context provided:
<Other Notes>
{other_notes}
</Other Notes>

FORMATTING INSTRUCTIONS:
- Structure your summary with the following sections using markdown headings:
  # Meeting Summary
  ## Overview
  ## Key Discussion Points
  ## Decisions Made
  ## Action Items
  ## Additional Notes
  ## Attendees

- For each section:
  - Overview: Brief description of meeting purpose and context (1-2 sentences)
  - Key Discussion Points: Use bullet points (* item) for main topics discussed
  - Decisions Made: Use numbered list (1. decision) if any decisions were made
  - Action Items: Use bullet points (* person to do task by deadline) for assigned tasks
  - Additional Notes: Any other relevant information using bullet points
  - Attendees: Simple list of participants if names are present

- Keep formatting simple and consistent
- Use only markdown for formatting
- Return ONLY the meeting summary with no additional text

Return your output in markdown format."""

TOPIC_ANALYSIS_PROMPT = """Analyze the meeting notes and/or transcript to identify and summarize key topics discussed, structured in markdown format. Include:

Topic Summary: List each primary topic with a brief description of the main points covered.

Time Allocation: Estimate the time spent on each topic, if possible, based on cues in the transcript.

Recurring Themes: Identify any themes or issues that recurred throughout the discussion and their impact or significance.
Present each topic and theme as a numbered or bulleted list in markdown, making it easy to review at a glance.

<Meeting notes or transcript>
{meeting_notes_and_or_transcript}
</Meeting notes or transcript>

Please also take into consideration other notes if applicable.

<Other Notes>
{other_notes}
</Other Notes>

Return just the topic analysis and nothing else. Return your output in markdown format.
Topic Analysis:"""

ACTION_ITEMS_PROMPT = """Analyze the meeting notes and/or transcript and extract a concise list of key action items. If no specific action items are mentioned, generate potential next steps based on the discussion topics.

FORMATTING INSTRUCTIONS:
- Format each action item as a simple bullet point starting with "* " followed by the person's name and the action
- Include any deadline in the same bullet point
- Keep all action items in a flat, single-level list

Examples of correctly formatted action items:
"* John to prepare project timeline by next Friday"
"* Sarah to contact vendor regarding pricing"
"* Team to review documentation before next meeting"

<Meeting notes or transcript>
{meeting_notes_and_or_transcript}
</Meeting notes or transcript>

Please also take into consideration meeting context or other notes if applicable.

<Other Notes>
{other_notes}
</Other Notes>

Please output just the action items and nothing else. Return your output in markdown format with a simple flat list structure.
Action Items:"""

FOLLOW_UP_EMAILS_PROMPT = """Using the meeting notes and/or transcript and identified action items, draft personalised follow-up emails for each attendee. Structure the output in markdown format, covering:
- Email Greeting: A professional and courteous opening, addressing the attendee by name.
- Meeting Summary: Brief recap of key discussion points and decisions relevant to the attendee.
- Assigned Action Items: Bullet list of specific tasks assigned to the attendee, including deadlines and any collaborative requirements.
- Next Steps: Outline upcoming actions, expectations, or follow-up meetings, if any.
- Closing and Contact Information: Courteous closing statement with a contact for further questions or clarifications.

Each email should be clearly structured, ensuring the attendee has a concise and actionable summary of their responsibilities. If the action items don't specify a specific attendee etc, write generic emails that can be filled in by the user.

<Action Items>
{action_items}
</Action Items>

<Meeting Summary>
{summary}
</Meeting Summary>

Please also take into consideration meeting context or other notes if applicable.

<Other Notes>
{other_notes}
</Other Notes>

Please just return the follow up emails nothing else. Return your output in markdown format.
Emails:"""

PARTICIPANT_INSIGHTS_PROMPTS = """Analyze the meeting notes and/or transcript to provide:
- Key Contributions of each attendee
- Engagement Level
- Improvement Suggestions for future meetings

Use concise bullet points in markdown format.

<Meeting notes or transcript>
{meeting_notes_and_or_transcript}
</Meeting notes or transcript>

Please also take into consideration meeting context or other notes if applicable.

<Other Notes>
{other_notes}
</Other Notes>

Return just the participant insights and nothing else. Return your output in markdown format.
Participant Insights:"""
