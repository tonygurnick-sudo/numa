TEMPLATE_OUTPUT_PROMPT = """The following are some meeting notes and/or transcript from a meeting.
<Meeting notes or transcript>
{meeting_notes_and_or_transcript}
<Meeting notes or transcript>

Use the meeting notes or transcript to create a structured output that follows the following template.

Template:
-----------------------------------
{template}
-----------------------------------

Output just the populated template and nothing else. Use subheadings and dot points as applicable. Return your output in markdown format.
Result:"""

MEETING_SUMMARY_PROMPT = """Analyse the meeting transcript and/or meeting notes and provide an organised, multi-bullet pointed summary of key discussion points and decisions. Structure the output in markdown format, clearly presenting:

Overview: A brief overview of the meeting’s purpose and key participants.

Key Discussion Points: Bullet points summarizing main topics, issues raised, and insights shared.

Decisions Made (if any): Numbered list of specific decisions agreed upon during the meeting.

Action Items (if any): Bullet points of actionable tasks assigned, including responsible parties and deadlines if mentioned.

Additional Notes: Any other relevant information, such as follow-up requirements or items for future discussion.

Format each section with headings, using markdown syntax for clarity.
Attendees: List all attendees to the meeting if names are present.

Meeting Transcript and/or Notes:
-----------------------------------
{meeting_notes_and_or_transcript}
-----------------------------------

Please also take into consideration meeting context or other notes if applicable.
Other Notes:
-----------------------------------
{other_notes}
-----------------------------------

Return just the meeting summary and nothing else. Return your output in markdown format."""

TOPIC_ANALYSIS_PROMPT = """Analyze the meeting notes and/or transcript to identify and summarize key topics discussed, structured in markdown format. Include:

Topic Summary: List each primary topic with a brief description of the main points covered.

Time Allocation: Estimate the time spent on each topic, if possible, based on cues in the transcript.

Recurring Themes: Identify any themes or issues that recurred throughout the discussion and their impact or significance.
Present each topic and theme as a numbered or bulleted list in markdown, making it easy to review at a glance.

Meeting Notes and/or Transcript:
-----------------------------------
{meeting_notes_and_or_transcript}
-----------------------------------

Please also take into consideration other notes if applicable.

Other Notes:
-----------------------------------
{other_notes}
-----------------------------------

Return just the topic analysis and nothing else. Return your output in markdown format.
Topic Analysis:"""

ACTION_ITEMS_PROMPT = """Analyze the meeting notes and/or transcript and extract a concise, bulleted list of key action items. If no specific action items, tasks, or deadlines are directly mentioned, generate a list of potential next steps or action items based on the discussion topics, but make sure they are explicitly stated as potential action items. Structure the output in markdown format, detailing:

- Action Description: Briefly describe each task or action item discussed or assigned.
- Assigned To: Indicate the individual(s) responsible for each action, if specified. If unclear, say assignee not specified.
- Deadline: Note any deadlines or timelines associated with each task, if mentioned. If unclear, say deadline not specified.

Ensure each action item is clearly outlined, using bullet points and markdown syntax to enhance readability. Keep the output short, concise and to relevant bullet points.

Meeting Notes and/or Transcript
-----------------------------------
{meeting_notes_and_or_transcript}
-----------------------------------

Please also take into consideration meeting context or other notes if applicable.

Other Notes:
-----------------------------------
{other_notes}
-----------------------------------

Please output just the action items and nothing else. Return your output in markdown format.
Action Items:"""

FOLLOW_UP_EMAILS_PROMPT = """Using the meeting notes and/or transcript and identified action items, draft personalised follow-up emails for each attendee. Structure the output in markdown format, covering:
- Email Greeting: A professional and courteous opening, addressing the attendee by name.
- Meeting Summary: Brief recap of key discussion points and decisions relevant to the attendee.
- Assigned Action Items: Bullet list of specific tasks assigned to the attendee, including deadlines and any collaborative requirements.
- Next Steps: Outline upcoming actions, expectations, or follow-up meetings, if any.
- Closing and Contact Information: Courteous closing statement with a contact for further questions or clarifications.

Each email should be clearly structured, ensuring the attendee has a concise and actionable summary of their responsibilities. If the action items don't specify a specific attendee etc, write generic emails that can be filled in by the user.

Action Items
-----------------------------------
{action_items}
-----------------------------------

Meeting Summary
-----------------------------------
{summary}
-----------------------------------

Please also take into consideration meeting context or other notes if applicable.

Other Notes
-----------------------------------
{other_notes}
-----------------------------------

Please just return the follow up emails nothing else. Return your output in markdown format.
Emails:"""

PARTICIPANT_INSIGHTS_PROMPTS = """Analyze the meeting notes and/or transcript to provide:
- Key Contributions of each attendee
- Engagement Level
- Improvement Suggestions for future meetings

Use concise bullet points in markdown format.

Meeting Notes and/or Transcript
-----------------------------------
{meeting_notes_and_or_transcript}
-----------------------------------

Please also take into consideration meeting context or other notes if applicable.

Other Notes
-----------------------------------
{other_notes}
-----------------------------------

Return just the participant insights and nothing else. Return your output in markdown format.
Participant Insights:"""
