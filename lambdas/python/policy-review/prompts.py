INITIAL_ANALYSIS_PROMPT = """You are an expert at understanding policy documents and running an initial analysis to understand the context of a document.
Here is a policy document uploaded by our user:
{policy_content}

Based on the keywords, structure, content and additional context here:
{policy_context}

Please return the following:
- title
- classification
- description
- considerations for review

Please just return the title, classification, description and considerations for review:"""

POLICY_REVIEW_PROMPT = """You are an expert at reviewing policy documents.

Here is a policy document:
{policy_content}

Our team has also provided following for your consideration when reviewing the document:
Classification and description:
{initial_analysis}

Review the policy document and provide a detailed analysis and recommendations covering the following aspects:

Analysis:
1. Summary of the key points and objectives of the policy
2. Evaluation of the clarity, comprehensiveness and enforceability of the policy
3. Identification of any potential gaps, ambiguities or areas that need improvement

Recommendations
A list of recommendations for enhancing or revising the policy to make it more effective

Legislative Compliance and Recommendations Review (if applicable):
The user may have also uploaded relevant legislation to review against here as well
{legislation_content}
If legislation is provided, please review the policy document and give feedback on the following aspects:
- Compliance: Does the policy comply with all relevant legal obligations and legislative requirements?
- Recommendations: Are there any recommendations for improving or strengthening the policy to ensure legal compliance? Please highlight specific sections of the policy document where necessary and what change you would recommend instead of the current wording. If you believe the policy to be satisfactory, please state that it is.
Provide detailed feedback and recommendations on each aspect, highlighting specific sections of the policy document where necessary. If not legislation provided to review against the policy, say 'Not Applicable'.

Please output your review with clear headings and dot points for the analysis and recommendations. If the policy is satisfactory, please indicate that no further changes are needed."""

RECOMMENDED_UPDATES_PROMPT = """Here is a policy document:
{policy_content}

Here is a review of the policy that contains the recommended changes for enhancement:
{policy_review}

Based on the recommended changes from the policy review, please generate some updates for the policy document based on the recommendation. This could be either updating/changing an existing section/point or adding a new section point. Please be specific when necessary, and also specify which section to update, or if creating a new section, whether that is under an existing subsection or not. Please don't re-generate the policy, but instead output a list of updates to the policy. If Legislative Compliance and Recommendations Review is provided, output this as a seperate list of recommendations."""

UPDATED_POLICY_PROMPT = """You are an expert at writing policies and updating policies based on feedback.

Here is a policy document:
{policy_content}

Here are the recommended updates for the policy based on a review from our team:
{recommended_updates}

The user has requested us to update their policy based on the recommendations. Please regenerate the entire policy with the policy updates implemented. Please output your changes in markdown format, and try to maintain the original format and styling of the policy document. If a section/sub section contains no changes or updates, just return '<no updates>' for that section to save time."""
