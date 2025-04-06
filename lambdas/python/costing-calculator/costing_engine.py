"""
Costing engine module for calculating costs for custom shapes.
This module contains the core calculation logic that replicates the formulas
from the DecraShape and 3D-2D-Poly Costing Sheets.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List

# Constants
GST_RATE = 0.15  # 15% GST
DEFAULT_PROFIT_MARGIN = 1.15  # 15% profit margin

# Model-specific supporting data
SUPPORTING_DATA: Dict[str, Dict[str, Any]] = {
    "decrashape": {
        # EPS Pricing per m3 (Updated July 2018)
        "pricing_codes": {
            "ACCA": {"S": 714, "H": 785, "VH": 877},
            "ACCB": {"S": 729, "H": 801, "VH": 896},
            "ACCC": {"S": 740, "H": 814, "VH": 911},
            "ACCD": {"S": 751, "H": 826, "VH": 924},
            "ACCE": {"S": 761, "H": 837, "VH": 937},
            "ACCF": {"S": 775, "H": 853, "VH": 954},
        },
        "mesh_rates": {"standard": 14.5, "premium": 18.2},
        "labor_rates": {"standard": 45, "complex": 55},
    },
    "3d-2d-poly": {
        # 3D-2D Poly pricing data
        "pricing_codes": {
            "ACCA": {"S": 650, "H": 780, "VH": 870},
            "ACCB": {"S": 680, "H": 800, "VH": 890},
            "ACCC": {"S": 700, "H": 820, "VH": 910},
            "ACCD": {"S": 720, "H": 840, "VH": 930},
            "ACCE": {"S": 740, "H": 860, "VH": 950},
            "ACCF": {"S": 760, "H": 880, "VH": 970},
        },
        "labor_rates": {"S": 40, "H": 50, "VH": 60},
        "machine_rates": {"standard": 35, "high_precision": 45},
    },
}


class BaseCostingEngine(ABC):
    """Base class for all costing engines."""

    @abstractmethod
    def calculate_costs(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate costs based on input parameters."""

    def validate_parameters(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate and normalise parameters.
        Returns a copy of parameters with any defaults applied.
        """
        # Make a copy to avoid modifying the original
        validated = parameters.copy()

        # Validate common required parameters
        for param in ["width", "length"]:
            if param not in validated:
                raise ValueError(f"Missing required parameter: {param}")

            # Ensure numeric values
            try:
                validated[param] = float(validated[param])
                if validated[param] <= 0:
                    raise ValueError(f"Parameter {param} must be positive")
            except (ValueError, TypeError) as exc:
                raise ValueError(
                    f"Parameter {param} must be a positive number"
                ) from exc

        # Validate poly_type
        if "poly_type" not in validated:
            validated["poly_type"] = "ACCA"  # Default to ACCA
        elif validated["poly_type"] not in [
            "ACCA",
            "ACCB",
            "ACCC",
            "ACCD",
            "ACCE",
            "ACCF",
        ]:
            raise ValueError(
                f"Invalid poly_type: {validated['poly_type']}. Must be one of: ACCA, ACCB, ACCC, ACCD, ACCE, ACCF"
            )

        # Set default complexity if not provided or validate
        if "complexity" not in validated:
            validated["complexity"] = "S"  # Default to Standard
        elif validated["complexity"] not in ["S", "H", "VH"]:
            raise ValueError("Complexity must be one of: S, H, VH")

        # Set default profit margin if not provided
        if "profit_margin" not in validated:
            validated["profit_margin"] = DEFAULT_PROFIT_MARGIN

        return validated


class DecraShapeCostingEngine(BaseCostingEngine):
    """Implementation of the DecraShape costing model."""

    def calculate_costs(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculate costs based on input parameters.
        This function implements the core business logic from the DecraShape Excel sheet.
        """
        # Initialise calculation steps for detailed tracking
        calculation_steps: List[Dict[str, Any]] = []

        # Validate and normalise parameters
        params = self.validate_parameters(parameters)
        calculation_steps.append(
            {
                "step": "Parameter Validation",
                "description": "Validated and normalised input parameters",
                "inputs": parameters,
                "outputs": params,
            }
        )

        # Additional DecraShape-specific validation
        if "mesh_type" not in params:
            params["mesh_type"] = "standard"  # Default to standard mesh
        elif params["mesh_type"] not in ["standard", "premium"]:
            raise ValueError("Mesh type must be one of: standard, premium")

        # Get supporting data
        supporting_data = SUPPORTING_DATA["decrashape"]
        calculation_steps.append(
            {
                "step": "Data Selection",
                "description": "Selected pricing data for DecraShape model",
                "pricing_data": supporting_data["pricing_codes"][params["poly_type"]],
            }
        )

        # Ensure model type is set correctly
        params["costing_model"] = "decrashape"

        # Calculate dimensions
        width_mm = float(params["width"])
        length_mm = float(params["length"])
        width_m = width_mm / 1000
        length_m = length_mm / 1000
        calculation_steps.append(
            {
                "step": "Dimension Conversion",
                "description": "Converted dimensions from millimeters to meters",
                "width_mm": width_mm,
                "length_mm": length_mm,
                "width_m": width_m,
                "length_m": length_m,
            }
        )

        # Calculate volume in cubic meters (mm³ to m³)
        volume_cubic_m = (width_mm * length_mm * width_mm) / 1000000000
        calculation_steps.append(
            {
                "step": "Volume Calculation",
                "description": "Calculated volume in cubic meters",
                "formula": "volume_cubic_m = (width_mm * length_mm * width_mm) / 1,000,000,000",
                "calculation": f"({width_mm} * {length_mm} * {width_mm}) / 1,000,000,000 = {volume_cubic_m}",
                "result": volume_cubic_m,
            }
        )

        # Get material unit price based on poly_type and complexity
        material_unit_price = supporting_data["pricing_codes"][params["poly_type"]][
            params["complexity"]
        ]
        calculation_steps.append(
            {
                "step": "Material Unit Price",
                "description": f"Selected material unit price for {params['poly_type']} material with {params['complexity']} complexity",
                "material_type": params["poly_type"],
                "complexity": params["complexity"],
                "unit_price": material_unit_price,
            }
        )

        # Calculate material cost
        material_cost = volume_cubic_m * material_unit_price
        calculation_steps.append(
            {
                "step": "Material Cost Calculation",
                "description": "Calculated material cost based on volume and unit price",
                "formula": "material_cost = volume_cubic_m * material_unit_price",
                "calculation": f"{volume_cubic_m} * {material_unit_price} = {material_cost}",
                "result": material_cost,
            }
        )

        # Calculate surface area (for mesh and plaster)
        perimeter = 2 * (width_m + length_m)
        surface_area = perimeter * width_m  # In square meters
        calculation_steps.append(
            {
                "step": "Surface Area Calculation",
                "description": "Calculated surface area for mesh and plaster",
                "perimeter_formula": "perimeter = 2 * (width_m + length_m)",
                "perimeter_calculation": f"2 * ({width_m} + {length_m}) = {perimeter}",
                "surface_area_formula": "surface_area = perimeter * width_m",
                "surface_area_calculation": f"{perimeter} * {width_m} = {surface_area}",
                "result": surface_area,
            }
        )

        # Calculate mesh cost
        mesh_rate = supporting_data["mesh_rates"][params["mesh_type"]]
        mesh_cost = surface_area * mesh_rate
        calculation_steps.append(
            {
                "step": "Mesh Cost Calculation",
                "description": f"Calculated mesh cost using {params['mesh_type']} mesh",
                "mesh_type": params["mesh_type"],
                "mesh_rate": mesh_rate,
                "formula": "mesh_cost = surface_area * mesh_rate",
                "calculation": f"{surface_area} * {mesh_rate} = {mesh_cost}",
                "result": mesh_cost,
            }
        )

        # Calculate plaster cost
        plaster_rate = 18.00  # Fixed rate of $18 per square meter
        plaster_cost = surface_area * plaster_rate
        calculation_steps.append(
            {
                "step": "Plaster Cost Calculation",
                "description": "Calculated plaster cost using fixed rate",
                "plaster_rate": plaster_rate,
                "formula": "plaster_cost = surface_area * plaster_rate",
                "calculation": f"{surface_area} * {plaster_rate} = {plaster_cost}",
                "result": plaster_cost,
            }
        )

        # Calculate labor costs based on complexity
        labor_rate = supporting_data["labor_rates"][
            "complex" if params["complexity"] in ["H", "VH"] else "standard"
        ]
        labor_hours = self._calculate_labor_hours(
            width_m, length_m, params["complexity"]
        )
        labor_cost = labor_hours * labor_rate
        calculation_steps.append(
            {
                "step": "Labor Cost Calculation",
                "description": "Calculated labor cost based on hours and rate",
                "complexity": params["complexity"],
                "labor_rate": labor_rate,
                "labor_hours": labor_hours,
                "formula": "labor_cost = labor_hours * labor_rate",
                "calculation": f"{labor_hours} * {labor_rate} = {labor_cost}",
                "result": labor_cost,
            }
        )

        # Calculate miscellaneous costs
        misc_cost = material_cost * 0.05  # 5% of material cost
        calculation_steps.append(
            {
                "step": "Miscellaneous Cost Calculation",
                "description": "Calculated miscellaneous costs as 5% of material cost",
                "formula": "misc_cost = material_cost * 0.05",
                "calculation": f"{material_cost} * 0.05 = {misc_cost}",
                "result": misc_cost,
            }
        )

        # Calculate subtotal
        subtotal = material_cost + mesh_cost + plaster_cost + labor_cost + misc_cost
        calculation_steps.append(
            {
                "step": "Subtotal Calculation",
                "description": "Calculated subtotal by summing all costs",
                "formula": "subtotal = material_cost + mesh_cost + plaster_cost + labor_cost + misc_cost",
                "calculation": f"{material_cost} + {mesh_cost} + {plaster_cost} + {labor_cost} + {misc_cost} = {subtotal}",
                "result": subtotal,
            }
        )

        # Apply profit margin
        profit_margin = params.get("profit_margin", DEFAULT_PROFIT_MARGIN)
        final_price = subtotal * profit_margin
        profit_amount = final_price - subtotal
        calculation_steps.append(
            {
                "step": "Profit Margin Application",
                "description": f"Applied profit margin multiplier of {profit_margin}",
                "profit_margin": profit_margin,
                "formula": "final_price = subtotal * profit_margin",
                "calculation": f"{subtotal} * {profit_margin} = {final_price}",
                "profit_amount": profit_amount,
                "result": final_price,
            }
        )

        # Calculate GST
        gst = final_price * GST_RATE
        calculation_steps.append(
            {
                "step": "GST Calculation",
                "description": f"Calculated GST at {GST_RATE * 100}%",
                "gst_rate": GST_RATE,
                "formula": "gst = final_price * GST_RATE",
                "calculation": f"{final_price} * {GST_RATE} = {gst}",
                "result": gst,
            }
        )

        # Calculate total
        total = final_price + gst
        calculation_steps.append(
            {
                "step": "Total Price Calculation",
                "description": "Calculated total price including GST",
                "formula": "total = final_price + gst",
                "calculation": f"{final_price} + {gst} = {total}",
                "result": total,
            }
        )

        # Calculate per meter price
        per_meter_price = total / length_m if length_m > 0 else 0
        calculation_steps.append(
            {
                "step": "Per Meter Price Calculation",
                "description": "Calculated price per meter of length",
                "formula": "per_meter_price = total / length_m",
                "calculation": f"{total} / {length_m} = {per_meter_price}",
                "result": per_meter_price,
            }
        )

        # Compile results
        return {
            "input_parameters": params,
            "calculations": {
                "volume_cubic_m": volume_cubic_m,
                "surface_area_sqm": surface_area,
                "labor_hours": labor_hours,
            },
            "material_costs": {
                "eps_material": material_cost,
                "mesh": mesh_cost,
                "plaster": plaster_cost,
                "miscellaneous": misc_cost,
            },
            "labor_costs": {"labor": labor_cost},
            "subtotal": subtotal,
            "profit_factor": profit_margin,
            "selling_price": final_price,
            "gst": gst,
            "total": total,
            "per_meter_price": per_meter_price,
            "calculation_steps": calculation_steps,
        }

    def _calculate_labor_hours(
        self, width_m: float, length_m: float, complexity: str
    ) -> float:
        """
        Calculate labor hours based on dimensions and complexity.
        This replicates the labor hour calculation from the DecraShape Excel sheet.
        """
        base_hours = width_m * length_m * 2  # Base calculation

        # Apply complexity factors
        if complexity == "S":
            return base_hours
        elif complexity == "H":
            return base_hours * 1.2  # 20% more time for high complexity
        elif complexity == "VH":
            return base_hours * 1.4  # 40% more time for very high complexity

        return base_hours  # Default


class PolyOnlyCostingEngine(BaseCostingEngine):
    """Implementation of the 3D-2D-Poly costing model."""

    def calculate_costs(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculate costs based on input parameters.
        This function implements the core business logic from the 3D-2D-Poly Excel sheet.
        """
        # Initialise calculation steps for detailed tracking
        calculation_steps: List[Dict[str, Any]] = []

        # Validate and normalise parameters
        params = self.validate_parameters(parameters)
        calculation_steps.append(
            {
                "step": "Parameter Validation",
                "description": "Validated and normalised input parameters",
                "inputs": parameters,
                "outputs": params,
            }
        )

        # Set poly_only to true for this engine
        params["poly_only"] = True

        # Ensure model type is set correctly
        params["costing_model"] = "3d-2d-poly"

        # Get supporting data
        supporting_data = SUPPORTING_DATA["3d-2d-poly"]
        calculation_steps.append(
            {
                "step": "Data Selection",
                "description": "Selected pricing data for 3D-2D-Poly model",
                "pricing_data": supporting_data["pricing_codes"][params["poly_type"]],
            }
        )

        # Calculate dimensions
        width_mm = float(params["width"])
        length_mm = float(params["length"])
        width_m = width_mm / 1000
        length_m = length_mm / 1000
        calculation_steps.append(
            {
                "step": "Dimension Conversion",
                "description": "Converted dimensions from millimeters to meters",
                "width_mm": width_mm,
                "length_mm": length_mm,
                "width_m": width_m,
                "length_m": length_m,
            }
        )

        # Calculate volume in cubic meters (mm³ to m³)
        volume_cubic_m = (width_mm * length_mm * width_mm) / 1000000000
        calculation_steps.append(
            {
                "step": "Volume Calculation",
                "description": "Calculated volume in cubic meters",
                "formula": "volume_cubic_m = (width_mm * length_mm * width_mm) / 1,000,000,000",
                "calculation": f"({width_mm} * {length_mm} * {width_mm}) / 1,000,000,000 = {volume_cubic_m}",
                "result": volume_cubic_m,
            }
        )

        # Get material unit price based on poly_type and complexity
        material_unit_price = supporting_data["pricing_codes"][params["poly_type"]][
            params["complexity"]
        ]
        calculation_steps.append(
            {
                "step": "Material Unit Price",
                "description": f"Selected material unit price for {params['poly_type']} material with {params['complexity']} complexity",
                "material_type": params["poly_type"],
                "complexity": params["complexity"],
                "unit_price": material_unit_price,
            }
        )

        # Calculate material cost
        material_cost = volume_cubic_m * material_unit_price
        calculation_steps.append(
            {
                "step": "Material Cost Calculation",
                "description": "Calculated material cost based on volume and unit price",
                "formula": "material_cost = volume_cubic_m * material_unit_price",
                "calculation": f"{volume_cubic_m} * {material_unit_price} = {material_cost}",
                "result": material_cost,
            }
        )

        # Calculate surface area
        perimeter = 2 * (width_m + length_m)
        surface_area = perimeter * width_m  # In square meters
        calculation_steps.append(
            {
                "step": "Surface Area Calculation",
                "description": "Calculated surface area for reference",
                "perimeter_formula": "perimeter = 2 * (width_m + length_m)",
                "perimeter_calculation": f"2 * ({width_m} + {length_m}) = {perimeter}",
                "surface_area_formula": "surface_area = perimeter * width_m",
                "surface_area_calculation": f"{perimeter} * {width_m} = {surface_area}",
                "result": surface_area,
            }
        )

        # For PolyOnly, we don't include mesh and plaster costs
        mesh_cost = 0
        plaster_cost = 0
        calculation_steps.append(
            {
                "step": "Mesh and Plaster",
                "description": "Poly-only model does not include mesh or plaster costs",
                "mesh_cost": mesh_cost,
                "plaster_cost": plaster_cost,
            }
        )

        # Calculate labor costs based on complexity
        labor_rate = supporting_data["labor_rates"].get(
            params["complexity"], supporting_data["labor_rates"]["S"]
        )
        labor_hours = self._calculate_labor_hours(
            width_m, length_m, params["complexity"]
        )
        labor_cost = labor_hours * labor_rate
        calculation_steps.append(
            {
                "step": "Labor Cost Calculation",
                "description": "Calculated labor cost based on hours and rate",
                "complexity": params["complexity"],
                "labor_rate": labor_rate,
                "labor_hours": labor_hours,
                "formula": "labor_cost = labor_hours * labor_rate",
                "calculation": f"{labor_hours} * {labor_rate} = {labor_cost}",
                "result": labor_cost,
            }
        )

        # Machine time cost - specific to 3D-2D-Poly
        machine_hours = self._calculate_machine_hours(
            width_m, length_m, params["complexity"]
        )
        machine_rate = supporting_data.get("machine_rates", {}).get("standard", 35)
        machine_cost = machine_hours * machine_rate
        calculation_steps.append(
            {
                "step": "Machine Cost Calculation",
                "description": "Calculated machine time cost (specific to 3D-2D-Poly)",
                "machine_rate": machine_rate,
                "machine_hours": machine_hours,
                "formula": "machine_cost = machine_hours * machine_rate",
                "calculation": f"{machine_hours} * {machine_rate} = {machine_cost}",
                "result": machine_cost,
            }
        )

        # Calculate miscellaneous costs
        misc_cost = material_cost * 0.03  # 3% for Poly Only
        calculation_steps.append(
            {
                "step": "Miscellaneous Cost Calculation",
                "description": "Calculated miscellaneous costs as 3% of material cost (for Poly Only)",
                "formula": "misc_cost = material_cost * 0.03",
                "calculation": f"{material_cost} * 0.03 = {misc_cost}",
                "result": misc_cost,
            }
        )

        # Calculate subtotal
        subtotal = material_cost + labor_cost + machine_cost + misc_cost
        calculation_steps.append(
            {
                "step": "Subtotal Calculation",
                "description": "Calculated subtotal by summing all costs",
                "formula": "subtotal = material_cost + labor_cost + machine_cost + misc_cost",
                "calculation": f"{material_cost} + {labor_cost} + {machine_cost} + {misc_cost} = {subtotal}",
                "result": subtotal,
            }
        )

        # Apply profit margin
        profit_margin = params.get("profit_margin", DEFAULT_PROFIT_MARGIN)
        final_price = subtotal * profit_margin
        profit_amount = final_price - subtotal
        calculation_steps.append(
            {
                "step": "Profit Margin Application",
                "description": f"Applied profit margin multiplier of {profit_margin}",
                "profit_margin": profit_margin,
                "formula": "final_price = subtotal * profit_margin",
                "calculation": f"{subtotal} * {profit_margin} = {final_price}",
                "profit_amount": profit_amount,
                "result": final_price,
            }
        )

        # Calculate GST
        gst = final_price * GST_RATE
        calculation_steps.append(
            {
                "step": "GST Calculation",
                "description": f"Calculated GST at {GST_RATE * 100}%",
                "gst_rate": GST_RATE,
                "formula": "gst = final_price * GST_RATE",
                "calculation": f"{final_price} * {GST_RATE} = {gst}",
                "result": gst,
            }
        )

        # Calculate total
        total = final_price + gst
        calculation_steps.append(
            {
                "step": "Total Price Calculation",
                "description": "Calculated total price including GST",
                "formula": "total = final_price + gst",
                "calculation": f"{final_price} + {gst} = {total}",
                "result": total,
            }
        )

        # Calculate per meter price
        per_meter_price = total / length_m if length_m > 0 else 0
        calculation_steps.append(
            {
                "step": "Per Meter Price Calculation",
                "description": "Calculated price per meter of length",
                "formula": "per_meter_price = total / length_m",
                "calculation": f"{total} / {length_m} = {per_meter_price}",
                "result": per_meter_price,
            }
        )

        # Compile results
        return {
            "input_parameters": params,
            "calculations": {
                "volume_cubic_m": volume_cubic_m,
                "surface_area_sqm": surface_area,
                "labor_hours": labor_hours,
                "machine_hours": machine_hours,
            },
            "material_costs": {
                "poly_material": material_cost,
                "miscellaneous": misc_cost,
            },
            "labor_costs": {"labor": labor_cost, "machine_time": machine_cost},
            "subtotal": subtotal,
            "profit_factor": profit_margin,
            "selling_price": final_price,
            "gst": gst,
            "total": total,
            "per_meter_price": per_meter_price,
            "calculation_steps": calculation_steps,
        }

    def _calculate_labor_hours(
        self, width_m: float, length_m: float, complexity: str
    ) -> float:
        """
        Calculate labor hours based on dimensions and complexity.
        This uses a different formula for the 3D-2D-Poly sheet.
        """
        # Poly Only typically requires less labor as there's no mesh/plaster
        base_hours = width_m * length_m * 1.5  # 25% less than DecraShape

        # Apply complexity factors
        if complexity == "S":
            return base_hours
        elif complexity == "H":
            return base_hours * 1.25  # 25% more time for high complexity
        elif complexity == "VH":
            return base_hours * 1.5  # 50% more time for very high complexity

        return base_hours  # Default

    def _calculate_machine_hours(
        self, width_m: float, length_m: float, complexity: str
    ) -> float:
        """
        Calculate machine time hours - this is specific to the Poly Only process.
        """
        # Base machine time calculation
        base_hours = width_m * length_m * 0.8  # Machine is faster than manual labor

        # Apply complexity factors
        if complexity == "S":
            return base_hours
        elif complexity == "H":
            return base_hours * 1.3  # 30% more time for high complexity
        elif complexity == "VH":
            return base_hours * 1.6  # 60% more time for very high complexity

        return base_hours  # Default


def get_costing_engine(costing_model: str) -> BaseCostingEngine:
    """Factory function to get the appropriate costing engine."""
    engines = {
        "decrashape": DecraShapeCostingEngine(),
        "3d-2d-poly": PolyOnlyCostingEngine(),
    }

    if costing_model not in engines:
        raise ValueError(
            f"Unsupported costing model: {costing_model}. Supported models: {', '.join(engines.keys())}"
        )

    return engines[costing_model]
