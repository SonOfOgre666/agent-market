FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --verbose || npm install --verbose || npm install --verbose
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 8000
CMD ["node", "src/server.js"]
