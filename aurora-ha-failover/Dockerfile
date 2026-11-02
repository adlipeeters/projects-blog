# One image, two entrypoints: the web app now, the prober from M2 (spec section 2).

FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && rm -rf /root/.cache /root/.local/share/pnpm

# Direct connections verify the instance certificate against this bundle (spec section 3).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem certs/global-bundle.pem

COPY --from=build /app/dist ./dist
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "dist/src/web/server.js"]
