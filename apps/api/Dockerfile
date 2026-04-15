FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm install --verbose || npm install --verbose || npm install --verbose
COPY . .

FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
RUN mkdir -p uploads logs && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
