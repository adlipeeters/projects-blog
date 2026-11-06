"""Run the access matrix and recheck proof as a one-off ECS task, read its report from CloudWatch,
then wait for the recheck alarm: it must fire, because the proof sent it real drops."""

import json
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import boto3


def main() -> int:
    ecs = boto3.client("ecs")
    logs = boto3.client("logs")
    cloudwatch = boto3.client("cloudwatch")
    cluster = os.environ["ECS_CLUSTER"]
    log_group = os.environ["API_LOG_GROUP"]
    alarm = os.environ["RECHECK_ALARM"]

    started = ecs.run_task(
        cluster=cluster,
        taskDefinition=os.environ["EVAL_TASK_DEFINITION"],
        launchType="FARGATE",
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": os.environ["PRIVATE_SUBNET_IDS"].split(","),
                "securityGroups": [os.environ["APP_SECURITY_GROUP"]],
                "assignPublicIp": "DISABLED",
            }
        },
    )
    if started["failures"]:
        print(started["failures"])
        return 1
    task_arn = started["tasks"][0]["taskArn"]
    task_id = task_arn.rsplit("/", 1)[-1]
    print(f"task {task_id} started")

    ecs.get_waiter("tasks_stopped").wait(
        cluster=cluster, tasks=[task_arn], WaiterConfig={"Delay": 15, "MaxAttempts": 120}
    )
    container = ecs.describe_tasks(cluster=cluster, tasks=[task_arn])["tasks"][0]["containers"][0]
    print(f"exit code {container.get('exitCode')}: {container.get('reason', '')}")

    events = logs.get_log_events(
        logGroupName=log_group, logStreamName=f"eval/eval/{task_id}", startFromHead=False, limit=20
    )["events"]
    lines = [json.loads(e["message"]) for e in events if e["message"].startswith("{")]
    report = next((line for line in lines if "report" in line), None)
    if report is None:
        for event in events:
            print(event["message"][:300])
        return 1
    print(json.dumps(report, indent=2))

    results = Path("results")
    results.mkdir(exist_ok=True)
    (results / f"internal-{datetime.now(UTC):%Y%m%dT%H%M%S}.json").write_text(
        json.dumps(report, indent=2)
    )

    fired = False
    deadline = time.monotonic() + 420
    while time.monotonic() < deadline and not fired:
        state = cloudwatch.describe_alarms(AlarmNames=[alarm])["MetricAlarms"][0]["StateValue"]
        history = cloudwatch.describe_alarm_history(
            AlarmName=alarm,
            HistoryItemType="StateUpdate",
            StartDate=datetime.fromtimestamp(started["tasks"][0]["createdAt"].timestamp(), UTC),
            MaxRecords=10,
        )["AlarmHistoryItems"]
        fired = state == "ALARM" or any("to ALARM" in item["HistorySummary"] for item in history)
        if not fired:
            time.sleep(20)
    print(f"recheck alarm fired: {fired}")
    return 0 if report["ok"] and fired else 1


if __name__ == "__main__":
    sys.exit(main())
