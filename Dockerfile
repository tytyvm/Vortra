# Single-service image: Next.js app + Prisma (Postgres).
# Build:  docker build -t vortra .
# Run:    docker run -p 3000:3000 --env-file .env vortra   (DATABASE_URL must be postgresql://...)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Production uses Postgres: switch the schema provider, then generate the client and build.
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma \
 && npx prisma generate \
 && npx next build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# Sync the schema to the database, then start. (For stricter change control, use prisma migrate; see README.)
CMD ["sh", "-c", "npx prisma db push && npx next start -p ${PORT}"]
