FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY koleya ./koleya

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
