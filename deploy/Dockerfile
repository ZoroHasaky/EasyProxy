# ---- frontend build ----
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=web /web/dist/ ./internal/web/dist/
COPY VERSION /src/VERSION
RUN CGO_ENABLED=0 go build -trimpath \
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
