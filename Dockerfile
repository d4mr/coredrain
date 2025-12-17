# Use official Bun image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies into temp directory for caching
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Copy node_modules from temp directory and copy source
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Run the app
USER bun
EXPOSE 9464
EXPOSE 9465
ENTRYPOINT ["bun", "run", "src/main.ts"]
