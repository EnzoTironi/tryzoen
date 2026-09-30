FROM node:24.21.0-bookworm-slim
WORKDIR /semantic
COPY .output/server/semantic/ ./
USER node
EXPOSE 18130
CMD ["node", "--max-old-space-size=128", "service.mjs"]
