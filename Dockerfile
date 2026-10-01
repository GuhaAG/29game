# Single-stage is enough: no native modules, one runtime dependency.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.client.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY locales ./locales
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Images are deployed behind a platform proxy that terminates TLS, so honour its
# X-Forwarded-Proto. Set TRUST_PROXY=0 if you expose this container directly.
ENV TRUST_PROXY=1
# Rooms live in memory, so the container holds every game it is serving.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/locales ./locales
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server/index.js"]
