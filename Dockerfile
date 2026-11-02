# AURIS all-in-one image: Mini App + API + bot webhook on one port.
FROM node:22-bookworm-slim AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/mini-app/package.json apps/mini-app/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @auris/shared build \
 && pnpm --filter @auris/api build \
 && pnpm --filter @auris/bot build \
 && pnpm --filter @auris/mini-app build \
 && pnpm --filter @auris/server build
# Drop dev dependencies, keep build output.
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim
# ffmpeg: converts Слух recordings (iOS AAC / Android Opus / Telegram voice) and renders demo audio.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/tmp/auris
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
