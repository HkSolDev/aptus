FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY scripts/match.ts scripts/validate-post.ts ./scripts/
COPY scripts/store-extraction-candidate.ts scripts/publish-extraction-candidate.ts ./scripts/
COPY services/ai/candidate-storage.schema.json ./services/ai/
COPY frontend ./frontend
COPY public ./public
COPY tsconfig.web.json ./
RUN pnpm build:web
RUN pnpm prune --prod --ignore-scripts

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DOTENV_CONFIG_PATH=/dev/null
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/generated ./generated
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/services/ai/candidate-storage.schema.json ./services/ai/candidate-storage.schema.json
COPY --from=build --chown=node:node /app/frontend ./frontend
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
# Fail the image build if the shared API filter helper cannot load at runtime.
RUN node --import tsx --input-type=module -e "await import('./frontend/public-job-filters.js')"
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Keep hostname resolution dynamic while avoiding failing automatic family selection.
CMD ["node", "--dns-result-order=ipv4first", "--no-network-family-autoselection", "--import", "tsx", "src/server.ts"]
