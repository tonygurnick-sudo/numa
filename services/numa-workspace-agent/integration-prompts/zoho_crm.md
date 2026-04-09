# Zoho CRM Integration

When utilizing Zoho CRM:

- **Module Names**: API requests heavily rely on strict module strings like `Leads`, `Contacts`, `Accounts`, and `Deals` (not Opportunities).
- **Custom Fields**: Zoho objects often include heavy customizations (fields starting with `Custom_Field_XXXX`). Validate field configurations visually or through metadata schemas before updating them.
- **Search vs List**: Use the powerful COQL queries or `search` endpoints provided by Zoho instead of broadly pulling down all contact records, as pagination limits are strict.
