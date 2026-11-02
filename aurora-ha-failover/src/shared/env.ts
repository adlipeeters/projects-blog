import { z } from 'zod';

// Everything the web and prober tasks read from their environment, parsed once at startup so a
// missing variable fails the task on boot instead of on the first request (spec section 3).
const EnvSchema = z.object({
  AWS_REGION: z.string().default('eu-central-1'),
  PORT: z.coerce.number().int().positive().default(8080),

  CLUSTER_ID: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_SECRET_ARN: z.string().startsWith('arn:aws:secretsmanager:'),
  WRITER_HOST: z.string().min(1),
  READER_HOST: z.string().min(1),

  // Direct connections verify the instance certificate against the RDS CA bundle baked into the
  // image. The proxy's certificate chains to Amazon Root CA, which Node already trusts.
  DB_CA_PATH: z.string().default('certs/global-bundle.pem'),

  // Empty until milestone M2 creates the proxy.
  PROXY_WRITER_HOST: z.string().optional(),
  PROXY_READER_HOST: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
