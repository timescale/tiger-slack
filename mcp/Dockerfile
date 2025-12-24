FROM oven/bun:1.3.5

WORKDIR /app

COPY package.json bun.lock ./
RUN bun ci --production

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

CMD ["bun", "run", "src/index.ts", "http"]