import unittest

from costing_engine import (
    BaseCostingEngine,
    DecraShapeCostingEngine,
    PolyOnlyCostingEngine,
    get_costing_engine,
)

# pylint: disable=protected-access


class TestBaseCostingEngine(unittest.TestCase):
    """Tests for the BaseCostingEngine class."""

    def test_validate_parameters_required_params(self):
        """Test that validate_parameters checks for required parameters."""

        # Create a concrete subclass for testing the abstract base class
        class ConcreteEngine(BaseCostingEngine):
            def calculate_costs(self, parameters):
                return {}

        engine = ConcreteEngine()

        # Test missing width
        with self.assertRaises(ValueError):
            engine.validate_parameters({"length": 200})

        # Test missing length
        with self.assertRaises(ValueError):
            engine.validate_parameters({"width": 100})

    def test_validate_parameters_numeric_values(self):
        """Test that validate_parameters ensures parameters are numeric."""

        class ConcreteEngine(BaseCostingEngine):
            def calculate_costs(self, parameters):
                return {}

        engine = ConcreteEngine()

        # Test non-numeric width
        with self.assertRaises(ValueError):
            engine.validate_parameters({"width": "not-a-number", "length": 200})

        # Test non-numeric length
        with self.assertRaises(ValueError):
            engine.validate_parameters({"width": 100, "length": "not-a-number"})

        # Test negative values
        with self.assertRaises(ValueError):
            engine.validate_parameters({"width": -100, "length": 200})

    def test_validate_parameters_defaults(self):
        """Test that validate_parameters applies default values correctly."""

        class ConcreteEngine(BaseCostingEngine):
            def calculate_costs(self, parameters):
                return {}

        engine = ConcreteEngine()

        # Valid minimal parameters
        params = {"width": 100, "length": 200}
        validated = engine.validate_parameters(params)

        # Check defaults were applied
        self.assertEqual(validated["poly_type"], "ACCA")
        self.assertEqual(validated["complexity"], "S")
        self.assertEqual(validated["profit_margin"], 1.15)

    def test_validate_parameters_poly_type(self):
        """Test validation of poly_type parameter."""

        class ConcreteEngine(BaseCostingEngine):
            def calculate_costs(self, parameters):
                return {}

        engine = ConcreteEngine()

        # Test valid poly_type
        params = {"width": 100, "length": 200, "poly_type": "ACCA"}
        validated = engine.validate_parameters(params)
        self.assertEqual(validated["poly_type"], "ACCA")

        # Test invalid poly_type
        with self.assertRaises(ValueError):
            engine.validate_parameters(
                {"width": 100, "length": 200, "poly_type": "INVALID"}
            )

    def test_validate_parameters_complexity(self):
        """Test validation of complexity parameter."""

        class ConcreteEngine(BaseCostingEngine):
            def calculate_costs(self, parameters):
                return {}

        engine = ConcreteEngine()

        # Test valid complexity values
        for complexity in ["S", "H", "VH"]:
            params = {"width": 100, "length": 200, "complexity": complexity}
            validated = engine.validate_parameters(params)
            self.assertEqual(validated["complexity"], complexity)

        # Test invalid complexity
        with self.assertRaises(ValueError):
            engine.validate_parameters(
                {"width": 100, "length": 200, "complexity": "INVALID"}
            )


class TestDecraShapeCostingEngine(unittest.TestCase):
    """Tests for the DecraShapeCostingEngine class."""

    def test_calculate_costs_basic(self):
        """Test basic cost calculation with minimal parameters."""
        engine = DecraShapeCostingEngine()
        params = {
            "width": 100,
            "length": 200,
            "poly_type": "ACCA",
            "complexity": "S",
            "mesh_type": "standard",
        }

        result = engine.calculate_costs(params)

        # Check result structure
        self.assertIn("material_costs", result)
        self.assertIn("labor_costs", result)
        self.assertIn("subtotal", result)
        self.assertIn("total", result)
        self.assertIn("calculation_steps", result)

        self.assertTrue(result["total"] > 0)
        self.assertTrue(result["subtotal"] > 0)
        self.assertTrue(len(result["calculation_steps"]) > 0)

    def test_validate_mesh_type(self):
        """Test that mesh_type is validated."""
        engine = DecraShapeCostingEngine()

        # Valid mesh_type
        params = {"width": 100, "length": 200, "mesh_type": "premium"}
        result = engine.calculate_costs(params)
        self.assertEqual(result["input_parameters"]["mesh_type"], "premium")

        # Invalid mesh_type
        with self.assertRaises(ValueError):
            engine.calculate_costs(
                {"width": 100, "length": 200, "mesh_type": "invalid"}
            )

    def test_calculation_correctness(self):
        """Test that calculations give expected results for known inputs."""
        engine = DecraShapeCostingEngine()
        params = {
            "width": 100,  # 100mm
            "length": 200,  # 200mm
            "poly_type": "ACCA",
            "complexity": "S",
            "mesh_type": "standard",
            "profit_margin": 1.0,  # No profit margin for easier verification
        }

        result = engine.calculate_costs(params)

        # Volume should be (100 * 200 * 100) / 1,000,000,000 = 0.002 cubic meters
        self.assertAlmostEqual(result["calculations"]["volume_cubic_m"], 0.002)

        # Material cost should be volume * unit price (714 for ACCA/S)
        # 0.002 * 714 = 1.428
        self.assertAlmostEqual(result["material_costs"]["eps_material"], 0.002 * 714)

        # Surface area should be 2 * (width_m + length_m) * width_m
        # 2 * (0.1 + 0.2) * 0.1 = 0.06
        self.assertAlmostEqual(result["calculations"]["surface_area_sqm"], 0.06)

    def test_labor_hours_calculation(self):
        """Test that labor hours are calculated correctly based on complexity."""
        engine = DecraShapeCostingEngine()

        # Standard complexity
        hours_s = engine._calculate_labor_hours(0.1, 0.2, "S")
        # High complexity
        hours_h = engine._calculate_labor_hours(0.1, 0.2, "H")
        # Very high complexity
        hours_vh = engine._calculate_labor_hours(0.1, 0.2, "VH")

        # Base hours = width_m * length_m * 2 = 0.1 * 0.2 * 2 = 0.04
        self.assertAlmostEqual(hours_s, 0.04)
        # High complexity = base * 1.2 = 0.04 * 1.2 = 0.048
        self.assertAlmostEqual(hours_h, 0.048)
        # Very high complexity = base * 1.4 = 0.04 * 1.4 = 0.056
        self.assertAlmostEqual(hours_vh, 0.056)


class TestPolyOnlyCostingEngine(unittest.TestCase):
    """Tests for the PolyOnlyCostingEngine class."""

    def test_calculate_costs_basic(self):
        """Test basic cost calculation with minimal parameters."""
        engine = PolyOnlyCostingEngine()
        params = {
            "width": 100,
            "length": 200,
            "poly_type": "ACCA",
            "complexity": "S",
        }

        result = engine.calculate_costs(params)

        # Check result structure
        self.assertIn("material_costs", result)
        self.assertIn("labor_costs", result)
        self.assertIn("subtotal", result)
        self.assertIn("total", result)
        self.assertIn("calculation_steps", result)

        # Verify calculations are performed
        self.assertTrue(result["total"] > 0)
        self.assertTrue(result["subtotal"] > 0)
        self.assertTrue(len(result["calculation_steps"]) > 0)

        # Verify poly_only model specific fields
        self.assertIn("machine_hours", result["calculations"])
        self.assertIn("machine_time", result["labor_costs"])
        self.assertTrue(result["input_parameters"]["poly_only"])

        # Verify no mesh or plaster costs for poly_only
        self.assertNotIn("mesh", result["material_costs"])
        self.assertNotIn("plaster", result["material_costs"])

    def test_calculation_correctness(self):
        """Test that calculations give expected results for known inputs."""
        engine = PolyOnlyCostingEngine()
        params = {
            "width": 100,  # 100mm
            "length": 200,  # 200mm
            "poly_type": "ACCA",
            "complexity": "S",
            "profit_margin": 1.0,  # No profit margin for easier verification
        }

        result = engine.calculate_costs(params)

        # Volume should be (100 * 200 * 100) / 1,000,000,000 = 0.002 cubic meters
        self.assertAlmostEqual(result["calculations"]["volume_cubic_m"], 0.002)

        # Material cost should be volume * unit price (650 for ACCA/S in 3d-2d-poly)
        # 0.002 * 650 = 1.3
        self.assertAlmostEqual(result["material_costs"]["poly_material"], 0.002 * 650)

        # Misc cost should be 3% of material cost (not 5% like DecraShape)
        self.assertAlmostEqual(
            result["material_costs"]["miscellaneous"],
            result["material_costs"]["poly_material"] * 0.03,
        )

    def test_labor_and_machine_hours(self):
        """Test labor and machine hours calculations based on complexity."""
        engine = PolyOnlyCostingEngine()

        # Test labor hours
        # Base hours = width_m * length_m * 1.5 = 0.1 * 0.2 * 1.5 = 0.03
        self.assertAlmostEqual(engine._calculate_labor_hours(0.1, 0.2, "S"), 0.03)
        # High complexity = base * 1.25 = 0.03 * 1.25 = 0.0375
        self.assertAlmostEqual(engine._calculate_labor_hours(0.1, 0.2, "H"), 0.0375)
        # Very high complexity = base * 1.5 = 0.03 * 1.5 = 0.045
        self.assertAlmostEqual(engine._calculate_labor_hours(0.1, 0.2, "VH"), 0.045)

        # Test machine hours
        # Base hours = width_m * length_m * 0.8 = 0.1 * 0.2 * 0.8 = 0.016
        self.assertAlmostEqual(engine._calculate_machine_hours(0.1, 0.2, "S"), 0.016)
        # High complexity = base * 1.3 = 0.016 * 1.3 = 0.0208
        self.assertAlmostEqual(engine._calculate_machine_hours(0.1, 0.2, "H"), 0.0208)
        # Very high complexity = base * 1.6 = 0.016 * 1.6 = 0.0256
        self.assertAlmostEqual(engine._calculate_machine_hours(0.1, 0.2, "VH"), 0.0256)


class TestCostingEngineFactory(unittest.TestCase):
    """Tests for the costing engine factory function."""

    def test_get_costing_engine_valid_models(self):
        """Test that correct engines are returned for valid models."""
        # Test DecraShape engine
        engine = get_costing_engine("decrashape")
        self.assertIsInstance(engine, DecraShapeCostingEngine)

        # Test PolyOnly engine
        engine = get_costing_engine("3d-2d-poly")
        self.assertIsInstance(engine, PolyOnlyCostingEngine)

    def test_get_costing_engine_invalid_model(self):
        """Test error handling for invalid model names."""
        with self.assertRaises(ValueError):
            get_costing_engine("invalid-model")


if __name__ == "__main__":
    unittest.main()
