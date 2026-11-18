# HireCraft: one image for the web app and the background worker.
#   web:     CMD ["npm", "run", "start"]        (default, port 4002)
#   worker:  CMD ["npm", "run", "worker"]
#   migrate: CMD ["npx", "prisma", "migrate", "deploy"]
#
# middleware.ts inlines environment variables when the app is built, so pass the
# public ones as build arguments:
#   docker build --build-arg APP_URL=https://app.example.com -t hirecraft .
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG APP_URL
ARG NEXTAUTH_URL
ARG INTERNAL_APP_URL
ARG PUBLIC_PORTAL_BASE_DOMAIN
ARG PORTAL_CNAME_TARGET
ARG FEATURE_CUSTOM_DOMAINS=true
ARG SECURITY_HEADERS_ENABLED=true
ENV APP_URL=$APP_URL \
    NEXTAUTH_URL=$NEXTAUTH_URL \
    INTERNAL_APP_URL=$INTERNAL_APP_URL \
    PUBLIC_PORTAL_BASE_DOMAIN=$PUBLIC_PORTAL_BASE_DOMAIN \
    PORTAL_CNAME_TARGET=$PORTAL_CNAME_TARGET \
    FEATURE_CUSTOM_DOMAINS=$FEATURE_CUSTOM_DOMAINS \
    NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate && npm run build-ci

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=4002
COPY --from=build /app /app
USER node
EXPOSE 4002
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:4002/api/health || exit 1
CMD ["npm", "run", "start"]
