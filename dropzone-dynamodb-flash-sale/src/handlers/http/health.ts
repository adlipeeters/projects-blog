/**
 * `GET /health`. No dependencies, no table access.
 *
 * It exists so milestone M0 can prove the whole path works: esbuild bundle, Lambda, IAM role, log
 * group, HTTP API route, stage. Everything after this reuses that path.
 */

import { env } from '../../shared/env.js';
import { httpRoute, ok } from '../../shared/http.js';

export const handler = httpRoute('health', () =>
  Promise.resolve(
    ok({
      status: 'ok',
      stage: env().STAGE,
      version: env().SERVICE_VERSION,
      checkedAt: new Date().toISOString(),
    }),
  ),
);
