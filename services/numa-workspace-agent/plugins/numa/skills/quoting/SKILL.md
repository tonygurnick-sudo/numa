# Quoting Skill

Use this skill when the user asks you to create, review, or manage quotes.

## When to Use

- Creating a new quote from a request, RFQ, or email
- Updating or revising an existing quote
- Looking up pricing or product information for quoting
- Generating quote documents from templates

## Quote Generation Workflow

### 1. Gather Requirements

Read the user's request carefully. Sources of quote requirements include:

- Direct user prompt (e.g., "Quote 50 units of Widget A at standard pricing")
- Uploaded files (RFQs, specs, emails saved as files)
- Email integration (read incoming quote requests)

### 2. Look Up Pricing and Products

Use the knowledge base to find:

- Product names, SKUs, and descriptions
- Current unit prices and volume discounts
- Minimum order quantities
- Lead times and availability

```
Use the numa_tool with operation "knowledge_base" to search for product and pricing data.
```

### 3. Check Templates

Look in `/workdir/app-workspace/` for:

- Quote templates (`.md`, `.html`, `.csv`)
- Pricing sheets (`.xlsx`, `.csv`)
- Terms and conditions documents
- Company information and branding

### 4. Calculate Totals

For each line item, calculate:

- Line total = quantity x unit price
- Apply any discounts
- Subtotal = sum of all line totals
- Tax/GST if applicable
- Grand total

Use Python for calculations to ensure accuracy:

```python
import pandas as pd

items = pd.DataFrame([
    {"description": "Widget A", "qty": 50, "unit_price": 12.50},
    {"description": "Widget B", "qty": 25, "unit_price": 8.75},
])
items["total"] = items["qty"] * items["unit_price"]
subtotal = items["total"].sum()
gst = subtotal * 0.15  # NZ GST
grand_total = subtotal + gst
```

### 5. Generate Quote Document

Output a professional quote document to `/workdir/outputs/quote.md` with:

```markdown
# Quote [Q-XXXX]

**Date:** [today's date]
**Valid Until:** [date + 30 days]
**Prepared For:** [customer name/company]
**Prepared By:** [from context or company info]

---

## Line Items

| #   | Description | Qty | Unit Price | Total   |
| --- | ----------- | --- | ---------- | ------- |
| 1   | Widget A    | 50  | $12.50     | $625.00 |
| 2   | Widget B    | 25  | $8.75      | $218.75 |

---

|               |         |
| ------------- | ------- |
| **Subtotal**  | $843.75 |
| **GST (15%)** | $126.56 |
| **Total**     | $970.31 |

---

## Terms & Conditions

- Payment due within 30 days of invoice
- Prices valid for 30 days from quote date
- [Additional terms from template/workspace]
```

### 6. Reference in Response

Always reference generated files in your response:

```
Here's the quote I've prepared:

- Complete quote document <file:quote.md>
- Line item breakdown <file:line_items.csv>
```

## Integration with Email

When email integrations are connected:

### Reading Quote Requests

Use `run_action` with Gmail or Outlook to read incoming emails containing RFQs.

### Sending Quotes

After the quote is generated and reviewed (via follow-up), the user can
ask you to send it. Use `run_action` to send the quote as an email attachment.

## Tips

- Always show currency (e.g., NZD $1,234.56)
- Round all prices to 2 decimal places
- If pricing data is missing, clearly note assumptions
- Include a validity period on every quote
- Number quotes sequentially if possible (check workspace for last used number)
