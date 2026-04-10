# Microsoft SQL Server Integration

When interacting with MS SQL Server:

- **Determine Schema**: Before making queries, use schema-listing tools to find the correct table names, exact column names, and data types to prevent execution errors.
- **Limit Rows**: Always apply `TOP (N)` or implement pagination when returning broad datasets to avoid overwhelming the context window limit with excessive rows.
- **Read-Only vs Mutation**: Assume `SELECT` operations by default. Verify with the user before executing `UPDATE`, `INSERT`, or `DELETE` statements or modifying any schema tables to prevent unintended data loss.
