FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3940
ENV DATA_DIR=/data

EXPOSE 3940
CMD ["node", "server.js"]
