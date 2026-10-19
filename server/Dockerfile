FROM node:20-bullseye-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY src ./src
COPY test ./test

RUN npm ci --production=false --no-audit --no-fund

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000
CMD ["npm", "run", "dev"]
