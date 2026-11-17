FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
COPY postcss.config.js tailwind.config.js ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24 AS runtime
ENV API_UPSTREAM=http://api:3001 NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
