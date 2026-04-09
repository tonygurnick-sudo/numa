# ClickUp Integration

When using ClickUp, follow these best practices:

- **Task Identification**: When updating or moving tasks, ensure you have the correct exact task ID. The ClickUp task ID is the alphanumeric string (e.g., `#abc123`) found in the URL.
- **Spaces and Folders**: Be aware of the hierarchy: Workspaces contain Spaces, which contain Folders, which contain Lists. Always verify you are pulling from the correct List ID when creating a task.
- **Custom Fields**: If setting custom fields on tasks, verify the custom field ID explicitly using the get custom fields endpoints first before mutating.
