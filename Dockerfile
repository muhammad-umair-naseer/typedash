FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=4000
ENV DATA_FILE=/data/typedash.json
# accounts, points and streaks live here — mount a volume so they survive redeploys
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:4000/healthz || exit 1
CMD ["node", "server/index.js"]
