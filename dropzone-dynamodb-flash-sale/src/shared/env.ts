/**
 * Environment variables, validated once at cold start.
 *
 * A missing table name must fail loudly on the first invocation, not produce an undefined
 * `TableName` deep inside a request.
 */

import { z } from 'zod';

const envSchema = z.object({
  STAGE: z.string().min(1).default('dev'),
  SERVICE_NAME: z.string().min(1).default('dropzone'),
  SERVICE_VERSION: z.string().min(1).default('dev'),
  AWS_REGION: z.string().min(1).default('eu-central-1'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

/** Tests only: forget the parsed environment so a new one can be read. */
export function resetEnvCache(): void {
  cached = undefined;
}
