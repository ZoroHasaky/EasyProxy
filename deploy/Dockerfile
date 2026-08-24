# ---- frontend build ----
# 前端产物与 CPU 架构无关，固定在构建机上构建一次，避免 ARM64 QEMU 模拟。
FROM --platform=$BUILDPLATFORM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
# CGO 已禁用，可由构建机原生交叉编译目标架构，避免 ARM64 QEMU 模拟。
FROM --platform=$BUILDPLATFORM golang:1.27.0-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Vite 默认将产物输出到 /web/dist。
COPY --from=web /web/dist/ ./internal/web/dist/
COPY VERSION /src/VERSION
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
    -ldflags "-s -w -X main.version=$(cat VERSION)" \
    -o /out/easyproxy ./cmd/server

# ---- runtime ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/easyproxy /app/easyproxy
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/easyproxy
ENV EASYPROXY_DATA=/data
EXPOSE 8080 7890
ENTRYPOINT ["/app/entrypoint.sh"]
