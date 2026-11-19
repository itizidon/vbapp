# Build from repository root. Dedicated CPU worker; does not expose an HTTP port.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY prisma ./prisma
COPY src ./src
COPY tsconfig*.json nest-cli.json ./
RUN pnpm build
FROM python:3.12-slim-bookworm
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY video-worker/requirements.lock /app/video-worker/requirements.lock
RUN python3 -m venv /app/.venv-video && /app/.venv-video/bin/pip install --no-cache-dir -r /app/video-worker/requirements.lock
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY video-worker ./video-worker
RUN /app/.venv-video/bin/python video-worker/install-model.py && chown -R node:node /app
ENV VIDEO_PYTHON=/app/.venv-video/bin/python VIDEO_FFMPEG=/usr/bin/ffmpeg VIDEO_FFPROBE=/usr/bin/ffprobe
USER node
CMD ["node","dist/src/training/motion-worker.js","watch","--execute"]
