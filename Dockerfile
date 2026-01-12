FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["bash","-lc","npm install --omit=dev && npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
