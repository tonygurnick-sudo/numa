import unittest


class DummyTest(unittest.TestCase):
    def test_dummy(self):
        always_true = True
        self.assertTrue(always_true)
