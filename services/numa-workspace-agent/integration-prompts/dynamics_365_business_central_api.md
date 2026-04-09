# Dynamics 365 Business Central API Integration

When working with Dynamics 365 Business Central:

- **Companies**: Many endpoints require a specific `Company ID`. Ensure you determine the active company environment first.
- **Resource IDs**: Items, Vendors, Customers, and financial entries rely strongly on Unique IDs in OData endpoints. Avoid guessing numeric IDs.
- **Immutability**: Be aware that posted invoices and certain ledger entries are immutable. Verify invoice status before attempting to apply any modification actions.
