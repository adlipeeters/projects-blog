# syntax=docker/dockerfile:1

# The load harness, for arm64 Fargate. Build it with:
#
#   docker build --platform linux/arm64 -f test/load/Dockerfile -t dropzone-load .
#
# The build stage bundles drop.ts and everything it imports into one file, so the runtime image
# carries no node_modules and no package manager. That keeps the image small enough that pulling it
# is not part of what the run measures.
FROM node:22-slim AS build

WORKDIR /src

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts

# schema/ is here because keys.ts reads tables.json: index and shard counts come from the schema,
# never from a literal, and that holds for the harness too.
COPY tsconfig.json ./
COPY schema ./schema
COPY src ./src
COPY test/load ./test/load

# CommonJS, like the handler bundles. An ESM bundle of the AWS SDK fails at startup: its CJS build
# calls require("node:https") at runtime, and esbuild's ESM output has no require to give it.
RUN pnpm exec esbuild test/load/drop.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=cjs \
  --sourcemap=linked \
  --outfile=/out/drop.cjs

FROM node:22-slim

WORKDIR /app

COPY --from=build /out/ ./

# Powertools is built for Lambda. In a container its metrics have nowhere to go, and flushing a
# batch of EMF to stdout every hundred attempts would bury the run's own output.
ENV POWERTOOLS_METRICS_DISABLED=true \
    POWERTOOLS_LOG_LEVEL=ERROR \
    NODE_ENV=production

USER node

ENTRYPOINT ["node", "/app/drop.cjs"]
