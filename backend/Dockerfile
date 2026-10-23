# syntax=docker/dockerfile:1
FROM golang:1.27.2-alpine3.23 AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -o /out/server ./cmd/server

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates && addgroup -g 10001 app && adduser -D -u 10001 -G app app
WORKDIR /app
RUN mkdir -p data && chown app:app data
COPY --from=build --chown=app:app /out/server /app/server
COPY --chown=app:app backend/config.yaml /app/config.yaml
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -T 2 -O /dev/null "http://127.0.0.1:${APP_APP_PORT:-8080}/api/v1/health" || exit 1
ENTRYPOINT ["/app/server"]
