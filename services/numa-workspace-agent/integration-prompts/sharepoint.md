# SharePoint Integration Tips

## Critical Limitation: Business Accounts Only

The SharePoint integration **only works with Microsoft 365 business/organizational accounts**. Personal Microsoft accounts (MSA) are not supported and will fail with:
> "This API is not supported for MSA accounts"
**Actions affected:** All site operations (`list-sites`, `search-sites`, `get-site`), search operations (`search-files`, `search-and-filter-files`), and `configure_props` for `siteId` (returns empty arrays).
**Reason:** Personal accounts have OneDrive, not SharePoint. SharePoint is a Microsoft 365 business product.
---
*Note from Arcanum: More tips coming after testing...*
