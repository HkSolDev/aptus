FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

# Frontend build does not need Prisma generation or backend credentials.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY next.config.ts tsconfig.next.json ./
COPY app ./app
COPY components ./components
COPY frontend/types.ts ./frontend/types.ts
COPY public/css ./public/css

# Next serializes API rewrites at build time; use the stable private API alias.
ARG BACKEND_INTERNAL_URL=http://aptus-api:8080
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm next:build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/how-it-works').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
