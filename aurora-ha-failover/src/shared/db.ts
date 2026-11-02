import { readFileSync } from 'node:fs';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';
import { z } from 'zod';
import type { Env } from './env.js';

export type Via = 'direct' | 'proxy';

export interface Credentials {
  user: string;
  password: string;
}

// The RDS-managed secret holds exactly these two keys.
const SecretSchema = z.object({ username: z.string(), password: z.string() });

export async function loadCredentials(env: Env): Promise<Credentials> {
  const client = new SecretsManagerClient({ region: env.AWS_REGION });
  const result = await client.send(new GetSecretValueCommand({ SecretId: env.DB_SECRET_ARN }));
  const secret = SecretSchema.parse(JSON.parse(result.SecretString ?? '{}'));
  return { user: secret.username, password: secret.password };
}

export interface Hosts {
  writer: string;
  reader: string;
}

export function hostsFor(env: Env, via: Via): Hosts | undefined {
  if (via === 'direct') return { writer: env.WRITER_HOST, reader: env.READER_HOST };
  if (env.PROXY_WRITER_HOST && env.PROXY_READER_HOST) {
    return { writer: env.PROXY_WRITER_HOST, reader: env.PROXY_READER_HOST };
  }
  return undefined;
}

/**
 * Everything a connection needs except the host. Passing `ca` replaces Node's trust store rather
 * than adding to it, so only direct connections get the RDS bundle.
 */
export function connectionBase(env: Env, credentials: Credentials, via: Via): pg.ClientConfig {
  const ssl =
    via === 'direct'
      ? { ca: readFileSync(env.DB_CA_PATH, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: true };

  return {
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: credentials.user,
    password: credentials.password,
    ssl,
  };
}
