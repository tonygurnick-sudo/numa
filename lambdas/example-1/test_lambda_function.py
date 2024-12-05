# pylint: disable=protected-access
import unittest

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    def test_handler(self):
        lambda_function.handler({}, {})
