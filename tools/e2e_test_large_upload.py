import json
import os
import urllib.request

import boto3

boto3.setup_default_session(profile_name="q-demo", region_name="us-east-1")


def run_test():
    print("🚀 Starting End-to-End NUMA-1183 Upload Test")

    file_size_bytes = int(3.6 * 1024 * 1024)
    filename = "test_large_file.txt"
    with open(filename, "wb") as f:
        f.write(b"x" * file_size_bytes)

    print(
        f"✅ Created dummy file {filename} of size {file_size_bytes / 1024 / 1024:.2f} MB"
    )

    lambda_client = boto3.client("lambda")

    # 1. Request Presigned URL
    payload_1 = {
        "tool": "add_to_kb",
        "allowed_kbs": ["company"],
        "user_sub": "945814d8-0011-70d6-bde2-e2ad52924d51",
        "params": {
            "filename": filename,
            "kb_id": "company",
            "kb_path": "",
            "size_bytes": file_size_bytes,
            "get_presigned_url": True,
            "finalize_upload": False,
        },
    }

    print("⏳ Invoking Lambda for Phase 1 (get_presigned_url)...")
    response_1 = lambda_client.invoke(
        FunctionName="arcanum-demo-greg_workspace_chat_tools",
        InvocationType="RequestResponse",
        Payload=json.dumps(payload_1),
    )
    result_1 = json.loads(response_1["Payload"].read().decode("utf-8"))

    if result_1.get("status") != "success":
        print("❌ FAILED: Lambda returned error. Full response:")
        print(json.dumps(result_1, indent=2))
        return

    presigned_url = result_1.get("result", {}).get("presigned_url")
    if not presigned_url:
        print("❌ FAILED: No presigned URL returned. Full response:")
        print(json.dumps(result_1, indent=2))
        return

    print("✅ Received Presigned URL. Streaming file to S3 via urllib...")

    with open(filename, "rb") as f:
        req = urllib.request.Request(presigned_url, data=f, method="PUT")
        req.add_header("Content-Type", "application/octet-stream")
        req.add_header("Content-Length", str(file_size_bytes))
        with urllib.request.urlopen(req) as response:
            if response.status != 200:
                print(f"❌ FAILED: Upload rejected by S3. Status: {response.status}")
                return

    print("✅ S3 Streaming Upload Successful!")

    # 3. Finalize Upload
    payload_3 = {
        "tool": "add_to_kb",
        "allowed_kbs": ["company"],
        "user_sub": "945814d8-0011-70d6-bde2-e2ad52924d51",
        "params": {
            "filename": filename,
            "kb_id": "company",
            "kb_path": "",
            "size_bytes": file_size_bytes,
            "get_presigned_url": False,
            "finalize_upload": True,
        },
    }

    print("⏳ Invoking Lambda for Phase 3 (finalize_upload)...")
    response_3 = lambda_client.invoke(
        FunctionName="arcanum-demo-greg_workspace_chat_tools",
        InvocationType="RequestResponse",
        Payload=json.dumps(payload_3),
    )
    result_3 = json.loads(response_3["Payload"].read().decode("utf-8"))

    if result_3.get("status") != "success":
        print("❌ FAILED: Lambda returned error. Full response:")
        print(json.dumps(result_3, indent=2))
        return

    final_result = result_3.get("result", {})
    if "recorded in KB" in final_result.get("message", ""):
        print("✅ Finalize Upload Successful!")
        print(f"🎉 Test passed! File URI: {final_result.get('s3_uri')}")
    else:
        print("❌ FAILED: Finalize upload returned unexpected response:")
        print(json.dumps(result_3, indent=2))


if __name__ == "__main__":
    run_test()
