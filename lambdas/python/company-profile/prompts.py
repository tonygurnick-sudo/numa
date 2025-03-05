USER_PROFILE_PROMPT = (
    "You are an expert in building structured profiles. Based on the following inputs, generate a detailed JSON profile.\n\n"
    "About: {about}\n\n"
    "Contact Information: {contact_information}\n\n"
    "Accompanying Documentation: {file_content}\n\n"
    "The resulting JSON must adhere to the following schema:\n"
    "- profile_summary: A concise summary capturing the key aspects of the profile.\n"
    "- profile_details: An object containing at least 'name' and optionally 'email', 'phone' and 'address'.\n"
    "- about: A comprehensive biography or self-description.\n"
    "- document_analysis: Key insights extracted from the accompanying documentation.\n\n"
    "Ensure the JSON is valid and includes all the required keys."
)
