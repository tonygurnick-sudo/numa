TEMPLATE_GENERATION_PROMPT = """Create a professional, well-structured policy template based on the following input provided by the user: {policy_area}
{additional_instructions}

The policy should adhere to best practices in the relevant field and include the following sections, where applicable:
1. Introduction - Define the purpose and scope of the policy.
2. Objectives - Clearly outline the goals and what the policy intends to achieve.
3. Roles and Responsibilities - Specify the roles involved and their responsibilities in implementing the policy.
4. Guidelines and Procedures - Detail the steps, rules, or criteria that must be followed.
5. Compliance and Monitoring - Describe how adherence to the policy will be ensured and what monitoring mechanisms will be in place.
6. Review and Updates - Specify how often the policy will be reviewed and updated.
7. References - Include any relevant laws, standards, or resources referenced in the policy.

Ensure the tone is clear, professional, and accessible, making it easy to understand and apply. Use examples or illustrative content where relevant to enhance understanding.

If the input is too general or lacks specificity, infer common themes or requirements associated with the policy area and draft a generic version based on industry-standard templates. Highlight sections where the user should add tailored details for their specific context.

Return your response in markdown format using the following:
- # for main headings
- ## for subheadings
- Bullet points for lists
- Numbered lists for procedures
- > for important notes or callouts
"""

DRAFT_POLICY_PROMPT = """You are an expert at writing policy documents in the domain of {policy_area}. Generate a draft policy for the area {policy_area} based on the additional instructions {additional_instructions}

Use the example 'what good looks like' document (if provided) as well as the generated example/template to base your structure off. If a user provides a 'what good looks like' document, show preference to that over our own generated one.
"What good looks like" document:
{example_template}
Our generated examples:
{generated_template}

Use your knowledge of policy writing best practices to create a well-structured and comprehensive policy document. Customise the policy to reflect the specific needs outlined in the additional instructions.

Return your response in markdown format using:
- # for main headings (Policy Title)
- ## for major sections
- ### for subsections
- Bullet points for lists
- Numbered lists for procedures
- > for important notes or callouts
- Tables where appropriate for structured information
"""

LEGISLATIVE_REVIEW_PROMPT = """You are an expert in reviewing the legislative aspects of policy documents created by our team, and you have over 30 years experience providing legal advice.
One of our team has created a draft policy for {policy_area}.

We need your legal expertise to review the document against legislative requirements to ensure that the policy is legally compliant and meets all relevant legal obligations.

Please review the attached policy document and provide feedback on the following aspects:
- Compliance: Does the policy comply with all relevant legal obligations and legislative requirements?
- Recommendations: Are there any recommendations for improving or strengthening the policy to ensure legal compliance? Please highlight specific sections of the policy document where necessary and what change you would recommend instead of the current wording. If you believe the policy to be satisfactory, please state that it is.

Here is the draft policy:
{draft_policy}
Here is the legislation:
{legislation_content}

Please review the policy document and give feedback on compliance and recommendations (if any) for ensuring it meets legislative requirements. Provide detailed feedback and recommendations on each aspect, highlighting specific sections of the policy document where necessary. Please also provide example updated sections of the policy with the legal recommendations implemented.

Return your response in markdown format using:
- # for the review title
- ## for major sections (Compliance Analysis, Recommendations)
- ### for specific areas of review
- > for direct quotes from legislation
- Bullet points for findings
- Tables for comparison of current vs recommended text
"""
