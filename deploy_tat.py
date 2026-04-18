#!/usr/bin/env python3
"""Deploy frontend/app/results/page.tsx to remote server via Tencent Cloud TAT API."""

import hashlib, hmac, json, time, urllib.request, base64, datetime, zlib, sys, os

# 从环境变量读取，勿将密钥写入仓库。示例：TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY / TAT_INSTANCE_ID
SECRET_ID = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
SECRET_KEY = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")
INSTANCE_ID = os.environ.get("TAT_INSTANCE_ID", "")
REGION = os.environ.get("TENCENTCLOUD_REGION", "ap-beijing")


def _require_credentials() -> None:
    missing = [
        name
        for name, val in (
            ("TENCENTCLOUD_SECRET_ID", SECRET_ID),
            ("TENCENTCLOUD_SECRET_KEY", SECRET_KEY),
            ("TAT_INSTANCE_ID", INSTANCE_ID),
        )
        if not val
    ]
    if missing:
        print(
            "缺少环境变量: " + ", ".join(missing) + "\n"
            "请设置腾讯云 SecretId、SecretKey 与 TAT 实例 ID 后再运行 deploy_tat.py。",
            file=sys.stderr,
        )
        sys.exit(1)

def tat_call(action, payload):
    service = "tat"
    host = "tat.tencentcloudapi.com"
    endpoint = f"https://{host}"
    algorithm = "TC3-HMAC-SHA256"
    timestamp = int(time.time())
    date = datetime.datetime.utcfromtimestamp(timestamp).strftime("%Y-%m-%d")

    http_request_method = "POST"
    canonical_uri = "/"
    canonical_querystring = ""
    ct = "application/json; charset=utf-8"
    payload_str = json.dumps(payload)
    canonical_headers = f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
    canonical_request = f"{http_request_method}\n{canonical_uri}\n{canonical_querystring}\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"

    credential_scope = f"{date}/{service}/tc3_request"
    hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_canonical}"

    def sign(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    secret_date = sign(("TC3" + SECRET_KEY).encode("utf-8"), date)
    secret_service = sign(secret_date, service)
    secret_signing = sign(secret_service, "tc3_request")
    signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = f"{algorithm} Credential={SECRET_ID}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"

    headers = {
        "Authorization": authorization,
        "Content-Type": ct,
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Timestamp": str(timestamp),
        "X-TC-Version": "2020-10-28",
        "X-TC-Region": REGION,
    }

    req = urllib.request.Request(endpoint, data=payload_str.encode("utf-8"), headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


_require_credentials()

# Step 1: Read the local file
file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "app", "results", "page.tsx")
print(f"Reading: {file_path}")
with open(file_path, "rb") as f:
    file_content = f.read()
print(f"File size: {len(file_content)} bytes")

# Step 2: Compress and base64 encode the file content
compressed = zlib.compress(file_content, 9)
file_b64 = base64.b64encode(compressed).decode("ascii")
print(f"Compressed: {len(compressed)} bytes, base64: {len(file_b64)} chars")

# Step 3: Build the bash script
bash_script = f'''#!/bin/bash
set -e
echo "=== Deploying page.tsx ==="

# Decode and decompress the file
echo "{file_b64}" | base64 -d | python3 -c "
import sys, zlib
data = sys.stdin.buffer.read()
sys.stdout.buffer.write(zlib.decompress(data))
" > /app/frontend/app/results/page.tsx

echo "File written: $(wc -c < /app/frontend/app/results/page.tsx) bytes, $(wc -l < /app/frontend/app/results/page.tsx) lines"

echo "=== Running npm build ==="
cd /app/frontend && npm run build 2>&1 | tail -30

echo "=== Restarting frontend ==="
sudo -u ubuntu pm2 restart gaokao-frontend
sleep 5

echo "=== Health check ==="
curl -s http://localhost:3000/ -o /dev/null -w "status=%{{http_code}}\\n"
echo "=== Done ==="
'''

# Step 4: Base64 encode the bash script
script_b64 = base64.b64encode(bash_script.encode("utf-8")).decode("ascii")
print(f"Bash script base64: {len(script_b64)} chars")

# Step 5: Call RunCommand
print("\n=== Calling RunCommand ===")
run_result = tat_call("RunCommand", {
    "CommandType": "SHELL",
    "Content": script_b64,
    "InstanceIds": [INSTANCE_ID],
    "Timeout": 300,
    "SaveCommand": False,
    "CommandName": "deploy-results-page",
    "Username": "root",
})

print(json.dumps(run_result, indent=2))

if "Response" not in run_result or "InvocationId" not in run_result.get("Response", {}):
    print("ERROR: RunCommand failed!")
    sys.exit(1)

invocation_id = run_result["Response"]["InvocationId"]
print(f"\nInvocation ID: {invocation_id}")

# Step 6: Poll DescribeInvocations until complete
print("\n=== Polling for completion ===")
while True:
    time.sleep(10)
    desc = tat_call("DescribeInvocations", {
        "InvocationIds": [invocation_id],
    })

    invocation = desc["Response"]["InvocationSet"][0]
    status = invocation["InvocationStatus"]
    print(f"  Status: {status}")

    if status not in ("RUNNING", "PENDING"):
        break

print(f"Final status: {status}")

# Step 7: Get output via DescribeInvocationTasks
print("\n=== Getting output ===")
tasks = tat_call("DescribeInvocationTasks", {
    "InvocationTaskIds": [],
    "Filters": [{"Name": "invocation-id", "Values": [invocation_id]}],
    "HideOutput": False,
})

for task in tasks["Response"]["InvocationTaskSet"]:
    print(f"Task ID: {task['InvocationTaskId']}")
    print(f"Task Status: {task['TaskStatus']}")
    result = task.get("TaskResult", {})
    print(f"Exit Code: {result.get('ExitCode', 'N/A')}")
    output = result.get("Output", "")
    if output:
        decoded = base64.b64decode(output).decode("utf-8", errors="replace")
        print(f"--- Output ---\n{decoded}\n--- End ---")
    else:
        print("(no output)")

print("\nDeployment complete.")
