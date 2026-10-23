# syntax=docker/dockerfile:1
FROM golang:1.27.2-alpine3.23 AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
ARG GO_TAGS=""
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -tags "$GO_TAGS" -o /out/server ./cmd/server

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates && addgroup -g 10001 app && adduser -D -u 10001 -G app app
WORKDIR /app
RUN mkdir -p data && chown app:app data
COPY --from=build --chown=app:app /out/server /app/server
COPY --chown=app:app backend/config.yaml /app/config.yaml
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/server"]
