# نستخدم صورة رسمية من Playwright عشان المتصفحات تكون جاهزة
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

WORKDIR /app

# نسخ ملفات التعريف وتنزيل المكاتب
COPY package*.json ./
RUN npm install

# نسخ باقي الكود
COPY . .

# تجهيز التايب سكريبت (اختياري لو حبيت تعمل Build)
# RUN npm run build

# المتغيرات الأساسية (ممكن تتغير وقت التشغيل)
ENV NODE_ENV=production






















# FROM node:20-alpine AS builder

# WORKDIR /app

# # Install dependencies first (layer caching)
# COPY package.json package-lock.json* ./
# RUN npm ci --production=false

# # Build TypeScript
# COPY tsconfig.json ./
# COPY src/ ./src/
# RUN npm run build

# # --- Production Stage ---
# FROM node:20-alpine AS runtime

# WORKDIR /app

# # Install production dependencies only
# COPY package.json package-lock.json* ./
# RUN npm ci --production && npm cache clean --force

# # Copy compiled JavaScript from builder
# COPY --from=builder /app/dist ./dist

# # Non-root user for security
# RUN addgroup -g 1001 chaimera && \
#     adduser -u 1001 -G chaimera -s /bin/sh -D chaimera
# USER chaimera

# # Health check (Phase 2+: replace with HTTP health endpoint)
# HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
#   CMD node -e "process.exit(0)"

# ENV NODE_ENV=production
# ENV PROCESS_MODE=listener

# ENTRYPOINT ["node", "dist/index.js"]
