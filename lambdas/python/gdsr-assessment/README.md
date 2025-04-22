# GDSR Assessment

A Lambda function that analyses a single application document based on the Game Development Sector Rebate (GDSR) framework, providing assessments of compliance, gap analysis, and recommendations for improvement.

## Overview

This function processes uploaded documents through the following steps:

1. Takes a document from an S3 bucket
2. Uses Claude 3 to perform a GDSR assessment
3. Writes the results back to S3
