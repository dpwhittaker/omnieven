FROM node:22-alpine AS client
WORKDIR /src/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# postinstall would try to install the client; skip it in the runtime image.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
COPY tabs ./tabs
COPY docs ./docs
COPY --from=client /src/client/dist ./client/dist
VOLUME ["/app/data", "/app/tabs"]
EXPOSE 7788
HEALTHCHECK CMD wget -qO- http://127.0.0.1:7788/healthz || exit 1
CMD ["node", "server/index.js"]
