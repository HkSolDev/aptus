FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY prisma7.config.ts ./
ENV DOTENV_CONFIG_PATH=/dev/null
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma7.config.ts"]
