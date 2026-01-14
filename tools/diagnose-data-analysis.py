#!/usr/bin/env python3
"""
Diagnostic script for data analysis tool issues.

Usage:
    python tools/diagnose-data-analysis.py --client CLIENT_NAME --conversation CONVERSATION_ID --user USER_ID

Example:
    python tools/diagnose-data-analysis.py --client toms --conversation abc123 --user user-sub-id
"""

import argparse
import json
import os
import sys

import boto3
from boto3.dynamodb.types import TypeDeserializer

deserializer = TypeDeserializer()


def deserialize_item(item):
    return {k: deserializer.deserialize(v) for k, v in item.items()}


def check_chat_history_table(client_name, conversation_id, user_id, region):
    """Check if files exist in chat history."""
    print(f"\n{'='*60}")
    print("1. CHECKING CHAT HISTORY TABLE FOR FILES")
    print(f"{'='*60}")

    table_name = f"numa-{client_name}-chat-history"
    print(f"Table: {table_name}")
    print(f"Conversation ID: {conversation_id}")
    print(f"User ID: {user_id}")

    dynamodb = boto3.client("dynamodb", region_name=region)

    try:
        response = dynamodb.query(
            TableName=table_name,
            KeyConditionExpression="user_id = :u AND begins_with(sk, :c)",
            ExpressionAttributeValues={
                ":u": {"S": user_id},
                ":c": {"S": f"{conversation_id}#"},
            },
            Limit=100,
        )

        items = response.get("Items", [])
        print(f"\nFound {len(items)} items in conversation")

        file_items = []
        for item in items:
            parsed = deserialize_item(item)
            if parsed.get("message_type") == "file":
                file_items.append(parsed)

        print(f"Found {len(file_items)} file items")

        if file_items:
            print("\nFile details:")
            for i, f in enumerate(file_items, 1):
                file_info = f.get("fileInfo", {})
                print(f"\n  File {i}:")
                print(f"    fileName: {file_info.get('fileName')}")
                print(f"    fileType: {file_info.get('fileType')}")
                print(f"    s3Key: {file_info.get('s3Key')}")
                print(f"    s3Bucket: {file_info.get('s3Bucket')}")
                print(
                    f"    extractedContentS3Key: {file_info.get('extractedContentS3Key')}"
                )
        else:
            print("\n⚠️  No file items found in conversation!")
            print("   This means the file upload wasn't recorded in DynamoDB.")

        return file_items

    except Exception as e:
        print(f"\n❌ Error querying table: {e}")
        return []


def check_ssm_parameter(client_name, region):
    """Check if step function ARN is in SSM."""
    print(f"\n{'='*60}")
    print("2. CHECKING SSM PARAMETER FOR STEP FUNCTION ARN")
    print(f"{'='*60}")

    param_name = f"/numa/{client_name}/apps/data-analysis/step-function-arn"
    print(f"Parameter: {param_name}")

    ssm = boto3.client("ssm", region_name=region)

    try:
        response = ssm.get_parameter(Name=param_name)
        arn = response.get("Parameter", {}).get("Value")
        print(f"✅ Found ARN: {arn}")
        return arn
    except ssm.exceptions.ParameterNotFound:
        print(f"\n❌ Parameter not found!")
        print("   The data-analysis app may not be deployed for this client.")
        return None
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return None


def check_jobs_table(client_name, region):
    """Check if jobs table exists."""
    print(f"\n{'='*60}")
    print("3. CHECKING JOBS TABLE")
    print(f"{'='*60}")

    table_name = f"{client_name}-data-analysis-recent-jobs"
    print(f"Table: {table_name}")

    dynamodb = boto3.client("dynamodb", region_name=region)

    try:
        response = dynamodb.describe_table(TableName=table_name)
        status = response.get("Table", {}).get("TableStatus")
        print(f"✅ Table exists, status: {status}")
        return True
    except dynamodb.exceptions.ResourceNotFoundException:
        print(f"\n❌ Table not found!")
        print("   The data-analysis app may not be deployed with enableJobs=true.")
        return False
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False


def check_s3_file(bucket, key, region):
    """Check if file exists in S3."""
    print(f"\n{'='*60}")
    print("4. CHECKING S3 FILE")
    print(f"{'='*60}")

    print(f"Bucket: {bucket}")
    print(f"Key: {key}")

    s3 = boto3.client("s3", region_name=region)

    try:
        response = s3.head_object(Bucket=bucket, Key=key)
        size = response.get("ContentLength", 0)
        content_type = response.get("ContentType", "unknown")
        print(f"✅ File exists!")
        print(f"   Size: {size} bytes")
        print(f"   Content-Type: {content_type}")
        return True
    except s3.exceptions.ClientError as e:
        if e.response["Error"]["Code"] == "404":
            print(f"\n❌ File not found in S3!")
        else:
            print(f"\n❌ Error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Diagnose data analysis tool issues")
    parser.add_argument("--client", required=True, help="Client name (e.g., toms)")
    parser.add_argument("--conversation", required=True, help="Conversation ID")
    parser.add_argument("--user", required=True, help="User ID (Cognito sub)")
    parser.add_argument("--region", default="us-east-1", help="AWS region")

    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("DATA ANALYSIS DIAGNOSTIC TOOL")
    print("=" * 60)
    print(f"Client: {args.client}")
    print(f"Region: {args.region}")

    # Check chat history for files
    files = check_chat_history_table(
        args.client, args.conversation, args.user, args.region
    )

    # Check SSM parameter
    step_function_arn = check_ssm_parameter(args.client, args.region)

    # Check jobs table
    jobs_table_exists = check_jobs_table(args.client, args.region)

    # Check S3 files if we found any
    if files:
        for f in files:
            file_info = f.get("fileInfo", {})
            s3_key = file_info.get("s3Key")
            s3_bucket = file_info.get("s3Bucket")
            if s3_key and s3_bucket:
                check_s3_file(s3_bucket, s3_key, args.region)

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")

    issues = []
    if not files:
        issues.append("No files found in conversation - check file upload flow")
    if not step_function_arn:
        issues.append("SSM parameter missing - data-analysis app not deployed")
    if not jobs_table_exists:
        issues.append(
            "Jobs table missing - data-analysis app not deployed with enableJobs"
        )

    if issues:
        print("\n❌ Issues found:")
        for issue in issues:
            print(f"   - {issue}")
    else:
        print(
            "\n✅ All checks passed! The issue may be in the step function execution."
        )
        print("   Check CloudWatch logs for the data-analysis Lambda.")

    print()


if __name__ == "__main__":
    main()
