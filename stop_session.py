# stop_session.py
import boto3

boto3.setup_default_session(profile_name="q-demo")
client = boto3.client("bedrock-agentcore", region_name="us-east-1")

response = client.stop_runtime_session(
    agentRuntimeArn="arn:aws:bedrock-agentcore:us-east-1:905418183804:runtime/numa_nd_labs_workspace_chat-906kHBDVXe",
    runtimeSessionId="user-f4088468-1051-7091-5229-8f49cc9cf34a",
)

print(response)
