# Веб-версия «Истории железных дорог России». Контекст сборки — корень репозитория:
#   docker build -f koleya/web/Dockerfile .
FROM node:20-alpine

WORKDIR /app

COPY koleya/web/package.json ./package.json
RUN npm install --omit=dev

COPY koleya ./koleya

ENV NODE_ENV=production

CMD ["node", "koleya/web/server.js"]
