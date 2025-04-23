# Procurement RFP Assessment

A Lambda function that analyzes procurement RFP submissions against reference criteria, providing assessments of eligibility and detailed evaluation of the proposal.

## Overview

This function processes uploaded documents through the following steps:

1. Takes application and RFP reference documents from an S3 bucket
2. Uses Claude 3 to perform an eligibility assessment
3. Uses Claude 3 to perform a comprehensive RFP assessment
4. Writes both results back to S3
