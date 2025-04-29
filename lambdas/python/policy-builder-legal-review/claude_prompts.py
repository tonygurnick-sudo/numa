LEGAL_REVIEW_PROMPT = """You are an expert in reviewing the legislative aspects of policy documents created by our team in the domain of {domain_area}. You have over 30 years experience providing legal advice within {domain_area}

One of our team members has created a policy document for {school_name} based on the following school context and requirements. They also customized the policies to reflect {school_name} context including their specific needs, values, and community goals.
Requirements:
--------------------------------
- The following principles and structures are based on our examplar set of policies that we are to adhere to:
Policy Principles:
{policy_principles}

Policy Structure:
{policy_structure_overview}
--------------------------------
School context:
{school_context}

Additional Comments:
{additional_comments}

Additional Instructions:
{default_additional_instructions}
{custom_additional_instructions}
--------------------------------

The policy documents created by our team have already been reviewed for clarity, relevance, completeness, alignment, and formatting and been deemed satisfactory.
However we need you legal expertise to review the document against legislative requirements to ensure that the policy is legally compliant and meets all relevant legal obligations.

Your job is to
- Ensure compliance with legislative requirements from the 'Board Assurance Statement' and 'Guidelines for Board Assurance Statement'.
Documents:
--------------------------------
Boad Assurance Statement: {board_assurance_statement}
--------------------------------
Guidelines for Board Assurance Statement: {guidelines_for_board_assurance_statement}
--------------------------------

Please review the attached policy document for {school_name} and provide detailed feedback on the following aspects:
- Compliance: Does the policy comply with all relevant legal obligations and legislative requirements?
- Alignment: Does the policy align with the 'Board Assurance Statement' and 'Guidelines for Board Assurance Statement'? If so, please highlight the relevant sections.
- Recommendations: Are there any recommendations for improving the policy to ensure legal compliance? Please highlight specific sections of the policy document where necessary and what change you would recommend instead of the current wording

We also want to make sure the policies reference relevant legislation under 'References' as a footnote to the policy in the format 'Number. section 123 of legislation: page of BAS'. E.g. '1. Section 127, Education and Training Act 2020: page 5 of Board Assurance Statement - Board objectives in governing schools'. To ensure readability, we will output legislation references as a seperate output that will be appended to the policy document rather then referenced through the policy.

To summarise, please review the policy document and give your feedback and recommendations (if any) for ensuring it meets legislative requirements. Provide detailed feedback on each aspect, highlighting specific sections of the policy document where necessary. If there are any possible improvements to strengthen legal and legislative requirements, highlight the specific sections of the policy document where necessary. If you believe the policy to be satisfactory, state that it is. Also please cite the relevant legislation for each requirement as 'Number. section 123 of legislation: page of BAS' for readability. Also add references for legal compliance already implemented in the policy document by our team.

We will give you 1 section at a time to review and update. Here is what our team created for the {policy_area_name} section of the policy document for review:
--------------------------------
Customerised Policy for {school_name} - {policy_area_name}:
{policy_area_name_policy}
--------------------------------
Your legal review:
"""

IMPLEMENT_LEGAL_REVIEW_PROMPT = """You are an expert at writing policy documents and implementing feedback from our legal team on possible updates. You have over 20 years experience in policy writing and implementation within {domain_area}.

Our legal team has reviewed the policy document created by our team for {school_name} and provided feedback on the following aspects:
- Compliance: Does the policy comply with all relevant legal obligations and legislative requirements?
- Alignment: Does the policy align with the 'Board Assurance Statement' and 'Guidelines for Board Assurance Statement'?
- Recommendations: Are there any recommendations for improving the policy to ensure legal compliance? Please highlight specific sections of the policy document where necessary and what change you would recommend instead of the current wording

The legal team has also provided references to the legislation for each requirement in the policy in the format 'Number. section 123 of legislation: page of BAS'. E.g. '1. Section 127, Education and Training Act 2020: page 5 of Board Assurance Statement - Board objectives in governing schools'.

Your job is to review the feedback provided by the legal team and make the necessary updates to the policy document to ensure it meets legislative requirements and is legally compliant. Please ensure that the policy is clear, relevant, complete, aligned, and formatted correctly. Also please add the references as a footnote (not throughout the policy) to the policy under the subheading 'References:' keeping the same formatting for references as provided.

We will give you 1 section at a time to review and update. Here is what our legal team provided for the {policy_area_name} section of the policy document for review:
--------------------------------
Legislation BAS: {board_assurance_statement}
--------------------------------
Legal Review for {school_name} - {policy_area_name}:
{policy_area_name_legal_review}
--------------------------------
Legal References:
{policy_area_name_legal_references}
--------------------------------
--------------------------------
Policies for {school_name} - {policy_area_name}:
{policy_area_name_policy}
--------------------------------

Please implement the changes as recommended from our legal team in their respective places, and add all references as a footnote to the end of the policy, leaving the formatting exactly as is for the references.
Please leave the rest of the document unchanged. Once you have made the changes, please return the updated policy document with the legal team's changes implemented and the references added at the end in the same format as provided.
"""
