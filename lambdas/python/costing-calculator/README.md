# DecraShape & FourPlus Costing Calculator

This Lambda function automates the process of generating cost calculations for pre-meshed and plastered shapes. It replicates the calculation logic from the "DecraShape and FourPlus Costing Sheet" Excel workbook.

## Features

- Processes input parameters (measurements, material types, complexity)
- Replicates Excel formulas for accurate cost calculations
- Uses tiered pricing based on complexity (S, H, VH)
- Generates detailed costing breakdowns
- Supports natural language input processing

## Development

1. Install dependencies with Poetry
2. Run tests with `poetry run pytest`
3. Package for deployment with `poetry run lambda-build`

## Input Format

The function accepts inputs in the following format:

```json
{
  "job_id": "unique-job-id",
  "parameters": {
    "width": 500,
    "length": 800,
    "poly_type": "ACCA",
    "complexity": "S"
  },
  "output_path": "costing-calculator/job-123"
}
```

## Output Format

The function outputs a detailed costing breakdown in the following format:

```json
{
  "results": [
    {
      "input_reference": null,
      "outputs": [
        {
          "content_type": "application/json",
          "data": {
            "bucket": "bucket-name",
            "key": "costing-calculator/job-123/results.json"
          },
          "location": "S3",
          "title": "Cost Calculation Results"
        }
      ]
    }
  ]
}
```
