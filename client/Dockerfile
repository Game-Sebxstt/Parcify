FROM node:24.11-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG PUBLIC_API_ORIGIN PUBLIC_COLLAB_ORIGIN PUBLIC_SITE_ORIGIN PUBLIC_STORAGE_ORIGIN PUBLIC_SENTRY_DSN
RUN node scripts/public-env-check.ts && npm run build
FROM caddy:2.10.2-alpine AS runtime
# Sin puertos privilegiados no hace falta la capability de la imagen base (falla con no-new-privileges).
RUN setcap -r /usr/bin/caddy \
  && addgroup -S -g 10001 web \
  && adduser -S -D -H -u 10001 -G web web \
  && mkdir -p /var/lib/caddy/config /var/lib/caddy/data \
  && chown -R web:web /var/lib/caddy
ENV XDG_CONFIG_HOME=/var/lib/caddy/config XDG_DATA_HOME=/var/lib/caddy/data
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist-meta/worker-csp.caddy /etc/caddy/worker-csp.caddy
COPY --from=build /app/dist /srv
USER web
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-8080}/" || exit 1
