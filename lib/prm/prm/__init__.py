"""
AWS Partner Revenue Measurement (PRM) Helper

Provides boto3 client and resource factories with PRM User-Agent tracking.
"""

from .prm import PRM_UA, PRODUCT_CODE, client, resource

__all__ = ["PRODUCT_CODE", "PRM_UA", "client", "resource"]
