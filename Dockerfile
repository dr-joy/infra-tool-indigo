# Task Manager — container chuẩn cho bản server dùng chung nhiều team.
# CR-20260913-nen-tang-da-nguoi-dung.md §10 lát 1 (FR-35/36/39): đóng gói container, cấu hình
# qua biến môi trường, ổ lưu trữ bền, health check. CHƯA đổi tính năng nghiệp vụ.
#
# ENABLE_LUYEN_DE=false (thêm ở Lát 4, xem server/app.ts): Luyện đề ở lại bản desktop, không lên
# server — bản container này KHÔNG mount router de-thi.
#
# 2 stage:
#  - builder: cần devDependencies (vite/tsc/tailwind) để `npm run build` ra dist/.
#  - runtime: chỉ cài dependencies production. Server chạy TRỰC TIẾP qua tsx (không bundle
#    esbuild như bản SEA desktop — tsx đã ở "dependencies", đơn giản hơn, không cần trùng lặp
#    logic bundle của scripts/build-sea.mjs cho một mục tiêu khác).
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/data \
    ENABLE_LUYEN_DE=false

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=builder /app/dist ./dist

# Ổ lưu trữ bền (FR-36): named/bind volume nên trỏ vào đây. Khai VOLUME làm lưới an toàn —
# quên mount tay vẫn còn volume vô danh giữ dữ liệu qua các lần recreate container, không mất
# trắng ngay (không thay thế việc hạ tầng cấp ổ bền thật, xem README).
VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
