import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { z } from 'zod';

const REFRESH_MS = 30_000;

/**
 * Instance id to AZ, from DescribeDBInstances, refreshed every 30 s (spec section 4). The AZ of an
 * instance only changes when S3 re-creates it, so a stale entry for half a minute is harmless. A
 * failed refresh keeps the previous map.
 */
export class InstanceAzs {
  private azs = new Map<string, string>();
  private readonly client: RDSClient;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    region: string,
    private readonly clusterId: string,
    private readonly onError: (error: unknown) => void,
  ) {
    this.client = new RDSClient({ region });
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  azOf(instance: string): string {
    return this.azs.get(instance) ?? 'unknown';
  }

  private async refresh(): Promise<void> {
    try {
      const result = await this.client.send(
        new DescribeDBInstancesCommand({
          Filters: [{ Name: 'db-cluster-id', Values: [this.clusterId] }],
        }),
      );
      const next = new Map<string, string>();
      for (const instance of result.DBInstances ?? []) {
        if (instance.DBInstanceIdentifier && instance.AvailabilityZone) {
          next.set(instance.DBInstanceIdentifier, instance.AvailabilityZone);
        }
      }
      this.azs = next;
    } catch (error) {
      this.onError(error);
    }
  }
}

export interface TaskIdentity {
  taskId: string;
  az: string;
}

const TaskMetadataSchema = z.object({ TaskARN: z.string(), AvailabilityZone: z.string() });

/** The task's own id and AZ from the ECS task metadata endpoint v4, or `local` outside ECS. */
export async function loadTaskIdentity(): Promise<TaskIdentity> {
  const uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!uri) return { taskId: 'local', az: 'local' };

  const response = await fetch(`${uri}/task`);
  const metadata = TaskMetadataSchema.parse(await response.json());
  return {
    taskId: metadata.TaskARN.split('/').at(-1) ?? metadata.TaskARN,
    az: metadata.AvailabilityZone,
  };
}
