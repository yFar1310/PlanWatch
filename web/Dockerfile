# web/Dockerfile
FROM node:20-bullseye-slim
WORKDIR /app

# 1) deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# 2) code + TOUTES les configs nécessaires à Tailwind/Vite
COPY index.html ./
COPY vite.config.ts tsconfig.json ./
COPY tailwind.config.ts postcss.config.js ./   
COPY src ./src

ENV HOST=0.0.0.0
ENV PORT=5173
EXPOSE 5173
CMD ["npm","run","dev","--","--host","0.0.0.0"]
