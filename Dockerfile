# Playwright's image ships Chromium plus all its system libraries. Its version MUST match the
# `playwright` dependency in package.json (pinned exactly), or the bundled browser won't be found.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Node runs the TypeScript sources directly (type stripping), so there is no build step.
COPY src ./src

# Flyer uploads and failure screenshots are written here; mount volumes to keep them.
RUN mkdir -p uploads failures && chown pwuser:pwuser uploads failures
USER pwuser

EXPOSE 3000
CMD ["node", "src/server.ts"]
