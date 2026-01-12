FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm i -g pnpm@9 next@16.1.1
EXPOSE 3002
CMD ["bash","-lc","npm install && next start -H 0.0.0.0 -p ${PORT:-3002}"]
