FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --verbose || npm install --verbose || npm install --verbose
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_REWRITE_API_URL=http://127.0.0.1:4010
ARG NEXT_PUBLIC_SC_HOST
ARG NEXT_PUBLIC_SC_PORT
ARG NEXT_PUBLIC_SC_SECURE
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_REWRITE_API_URL=$NEXT_REWRITE_API_URL
ENV NEXT_PUBLIC_SC_HOST=$NEXT_PUBLIC_SC_HOST
ENV NEXT_PUBLIC_SC_PORT=$NEXT_PUBLIC_SC_PORT
ENV NEXT_PUBLIC_SC_SECURE=$NEXT_PUBLIC_SC_SECURE

RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
