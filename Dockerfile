FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/app /data/claude/projects

COPY package.json package-lock.json .npmrc ./
RUN npm install

COPY . .

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=53681
ENV HOSTNAME=0.0.0.0
ENV CLAUDE_PROJECTS_DIR=/data/claude/projects
ENV DATABASE_PATH=/data/app/find-that-session.db
ENV TRANSFORMERS_CACHE=/data/app/models

EXPOSE 53681
# Bind 0.0.0.0 so docker-compose port publishing works (local npm run dev stays on 127.0.0.1).
CMD ["npx", "next", "dev", "--hostname", "0.0.0.0", "--port", "53681"]
