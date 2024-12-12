REVIEW_POLICY_PROMPT = """You are an expert in reviewing policy documents created by our team in the domain of {domain_area}.
One of our team members has created a policy document for {school_name} based on the following school context and requirements. They based on the policy principles and structures provided and the exemplar set of policies. They also customized the policies to reflect {school_name} context including their specific needs, values, and community goals.
Requirements:
--------------------------------
- The following principles and structures are based on our examplar set of policies that we are to adhere to:
Policy Principles:
{policy_principles}

Policy Structure:
{policy_structure_overview}
--------------------------------
Examplar set of policies used to develop the policy:
--------------------------------
{exemplar_set_of_policies}
--------------------------------
School context:
{school_context}

Additional Comments:
{additional_comments}

Additional Instructions:
{default_additional_instructions}
{custom_additional_instructions}
--------------------------------

As the expert in reviewing policy documents, you have been asked to review the attached policy document for {school_name} and provide feedback on the following aspects:

- Clarity: Is the policy clear and easy to understand?
- Relevance: Does the policy address the needs and values of {school_name}? Has the policy been effectively customized to reflect {school_name} specific needs, values, and community goals?
- Completeness: Are there any gaps or missing information in the policy? Does it maintain the minimum level of detail provided in the exemplar set of policies?
- Alignment: Does the policy generally align with the principles and structures provided?
- Formatting: Is the policy formatted correctly and consistently? And is the markdown formatting correct?

Please update the policy document with your feedback and recommendations for improving the policy and an explanation on the changes you made (if any) on the customised policy. Provide detailed feedback on each aspect, highlighting specific sections of the policy document where necessary. If you believe the policy to be satisfactory, return it as is. If you believe the policy needs changes, please make the changes and return the updated policy document with changes implemented.

We will give you 1 section at a time to review and update. Here is what our team created for the {policy_area_name} section of the policy document for review:
--------------------------------
Customerised Policy for {school_name} - {policy_area_name}:
{policy_area_name_policy}
--------------------------------
Our employee has also provided an explanation of the policy and reasoning behind it:
--------------------------------
Explanation:
{policy_area_name_explanation}
--------------------------------
Your review:
"""
