FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_PRODUCTION=false
RUN npm i -g pnpm@9 next@16.1.1
EXPOSE 3002
CMD ["bash","-lc","if npm ci --include=dev; then :; else npm install --include=dev; fi; node server/assistant-ws.mjs"]
