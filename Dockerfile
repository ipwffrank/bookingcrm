FROM node:22-slim

WORKDIR /app

RUN npm i -g pnpm@9.15.9

# Copy monorepo files
COPY glowos/package.json glowos/pnpm-workspace.yaml glowos/pnpm-lock.yaml ./glowos/
COPY glowos/packages/ ./glowos/packages/
COPY glowos/services/api/ ./glowos/services/api/
COPY glowos/apps/web/package.json ./glowos/apps/web/
COPY glowos/apps/dashboard/package.json ./glowos/apps/dashboard/

WORKDIR /app/glowos

# Install deps
RUN pnpm install --frozen-lockfile=false

# Build API
RUN pnpm --filter @glowos/api build

EXPOSE 3001

WORKDIR /app/glowos/services/api
CMD ["npx", "tsx", "src/index.ts"]
