PARAMETER_EXTRACTION_TOOL = {
    "name": "extract_parameters",
    "description": "Extract structured parameters for costing calculations from user input",
    "input_schema": {
        "type": "object",
        "properties": {
            "width": {"type": "number", "description": "Width in millimeters"},
            "length": {"type": "number", "description": "Length in millimeters"},
            "poly_type": {
                "type": "string",
                "enum": ["ACCA", "ACCB", "ACCC", "ACCD", "ACCE", "ACCF"],
                "description": "Type of polystyrene material",
            },
            "complexity": {
                "type": "string",
                "enum": ["S", "H", "VH"],
                "description": "Complexity level: S=Standard, H=High, VH=Very High",
            },
            "mesh_type": {
                "type": "string",
                "enum": ["standard", "premium"],
                "description": "Type of mesh to use (for DecraShape model)",
            },
            "costing_model": {
                "type": "string",
                "enum": ["decrashape", "3d-2d-poly"],
                "description": "The costing model to use for calculations",
            },
            "profit_margin": {
                "type": "number",
                "description": "Profit margin multiplier (e.g., 1.15 for 15% margin)",
            },
            "notes": {
                "type": "string",
                "description": "Any additional notes or requirements extracted from the input",
            },
        },
        "required": ["width", "length", "poly_type", "complexity", "costing_model"],
    },
}
