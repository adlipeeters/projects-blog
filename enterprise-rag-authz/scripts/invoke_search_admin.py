"""Invoke the search admin Lambda and print its report. Exits non-zero on a failed check."""

import json
import os
import sys

import boto3
from botocore.config import Config


def main() -> int:
    client = boto3.client("lambda", config=Config(read_timeout=130, retries={"max_attempts": 0}))
    response = client.invoke(
        FunctionName=os.environ["SEARCH_ADMIN_FUNCTION"],
        Payload=json.dumps({"action": sys.argv[1]}),
    )
    report = json.loads(response["Payload"].read())
    print(json.dumps(report, indent=2))
    return 1 if "FunctionError" in response or not report.get("ok") else 0


if __name__ == "__main__":
    sys.exit(main())
