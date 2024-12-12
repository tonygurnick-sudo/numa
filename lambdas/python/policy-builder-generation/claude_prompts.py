INITIAL_POLICY_PROMPT = """You are an expert in writing policy documents created by our team in the domain of {domain_area}.
Create a policy document for {school_name} based on the following instructions:

- The following principles and structures are based on our examplar set of policies that we are to adhere to:
Policy Principles:
{policy_principles}


Policy Structure:
{policy_structure_overview}

--------------------------------
- Here is the examplar set of policies to use as a reference, maintaining the minimum level of detail provided. This is our starting point for the policy and is an examplar of the level of detail required.
--------------------------------
Exemplar set of policies: {exemplar_set_of_policies}
--------------------------------
- Develop a set of policies for {school_name} based on the following four categories of policies based on the structure provided:

{categories_and_descriptions}


- Customize the policies to reflect {school_name} specific needs, values, and community goals.
School context:
{school_context}

Additional Comments:
{additional_comments}

Additional Instructions:
{default_additional_instructions}
{custom_additional_instructions}

Please develop one set of policies at a time in markdown format. Please start with {policy_area_name}. Explicitely just return in markdown for {policy_area_name}.
"""
