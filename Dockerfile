FROM node:24-alpine AS client
WORKDIR /src/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
COPY shared/ ../shared/
RUN npm run build

# Node >= 22.18 runs the TypeScript server directly (type stripping); no build.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY demo ./demo
COPY docs ./docs
COPY --from=client /src/client/dist ./client/dist
# apps/ is seeded from demo/ on first start when the mounted volume is empty
VOLUME ["/app/data", "/app/apps"]
EXPOSE 7788
HEALTHCHECK CMD wget -qO- http://127.0.0.1:7788/healthz || exit 1
CMD ["node", "server/index.ts"]
