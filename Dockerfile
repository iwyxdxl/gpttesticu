# ---- 构建前端 ----
FROM node:22-slim AS webbuild
WORKDIR /build
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY server/src/sanitize-policy.ts /server/src/sanitize-policy.ts
COPY server/src/assets/pelican-bike_gpt6astra_low.html /server/src/assets/pelican-bike_gpt6astra_low.html
RUN npm run build

# ---- 构建后端（仅编译 TS，无原生依赖）----
FROM node:22-slim AS serverbuild
WORKDIR /build
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- 运行时 ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY --from=serverbuild /build/node_modules ./node_modules
COPY --from=serverbuild /build/dist ./dist
COPY --from=webbuild /build/dist ./public
ENV PORT=8787 DB_PATH=/app/data/gpttest.db
VOLUME /app/data
EXPOSE 8787
CMD ["node", "dist/index.js"]
