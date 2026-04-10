# Dynamics 365 Sales Integration

When accessing Microsoft Dynamics 365 Sales:

- **Entity Names**: Ensure you are using the correct Entity set names (usually pluralized versions like `accounts`, `contacts`, `opportunities`) when calling the Dataverse OData endpoints.
- **Filtering**: Use standard OData `$filter` queries to efficiently pinpoint exact records rather than fetching the entire list of leads or opportunities.
- **Ownership**: Check the ownership of opportunities and accounts before summarizing. Many records might belong to specific Sales team members.
