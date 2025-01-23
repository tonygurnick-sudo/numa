PERSONAL_FINANCE_TOOLS = [
    {
        "name": "print_data",
        "description": "Prints the relevant financial data such as loan information, amounts, rates, insurances, fees and agent fees.",
        "input_schema": {
            "type": "object",
            "properties": {
                "data": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "The name of the field to extract.",
                            },
                            "value": {
                                "type": "string",
                                "description": "The value of the field to extract.",
                            },
                            "description": {
                                "type": "string",
                                "description": "A detailed description of the field to extract. Include as much information as possible.",
                            },
                            "classification": {
                                "enum": [
                                    "interest_rate",
                                    "interest_on_loan",
                                    "loan_limit",
                                    "loan_balance",
                                    "location_of_property",
                                    "rental_income",
                                    "other_rental_income",
                                    "total_rental_income",
                                    "borrowing_costs",
                                    "body_corporate_fees",
                                    "council_rates",
                                    "cleaning",
                                    "depreciation",
                                    "agent_fees",
                                    "insurance",
                                    "land_tax",
                                    "repairs",
                                    "capital_works_deduction",
                                    "water_rates",
                                    "sundry_income_and_expenses",
                                    "sundry_postage",
                                    "sundry",
                                    "sundry_gst_on_fees",
                                    "total_rental_expenses",
                                    "possible_deduction",
                                    "other",
                                ],
                                "default": "other",
                                "description": "Classification of the financial item",
                            },
                            "page_number": {
                                "type": "integer",
                                "minimum": 1,
                                "description": "The page number of the field to extract.",
                            },
                        },
                        "required": [
                            "name",
                            "value",
                            "description",
                            "classification",
                            "page_number",
                        ],
                    },
                }
            },
            "required": ["data"],
        },
    }
]
