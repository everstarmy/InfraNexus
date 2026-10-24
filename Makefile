.PHONY: help dev-backend dev-frontend build-backend build-frontend test tidy install-frontend docker-build docker-up docker-down

help:
	@echo "InfraNexus 开发运维命令一览:"
	@echo "  make dev-backend     - 启动 GoFiber v3 后端开发服务"
	@echo "  make dev-frontend    - 启动 Vite React 前端开发服务器"
	@echo "  make install-frontend- 安装前端 npm 依赖包"
	@echo "  make build-backend   - 编译 Go 后端二进制程序"
	@echo "  make build-frontend  - 构建前端生产 Bundle"
	@echo "  make test            - 运行后端自动化单测"
	@echo "  make tidy            - 整理并同步后端 Go 依赖"

dev-backend:
	cd backend && go run cmd/server/main.go

dev-frontend:
	cd frontend && npm run dev

install-frontend:
	cd frontend && npm install

build-backend:
	cd backend && go build -o bin/server cmd/server/main.go

build-frontend:
	cd frontend && npm run build

test:
	cd backend && go test -v ./...

tidy:
	cd backend && go mod tidy

# Both Dockerfiles use the repository root as their build context.
docker-build:
	docker build -f backend/Dockerfile -t infranexus/backend:local .
	docker build -f frontend/Dockerfile -t infranexus/frontend:local .

docker-up:
	docker compose up -d --build --wait

docker-down:
	docker compose down

.PHONY: check check-backend check-frontend check-integration
check: check-backend check-frontend

check-backend:
	go -C backend test -race -count=1 -p=1 ./...
	go -C backend vet ./...
	@test -z "$$(gofmt -l $$(git ls-files 'backend/*.go' 'backend/**/*.go'))"

check-frontend:
	npm --prefix frontend run lint
	npm --prefix frontend run typecheck
	npm --prefix frontend test
	npm --prefix frontend run build

check-integration:
	@test -n "$$INFRANEXUS_TEST_POSTGRES_DSN" || (echo 'Set an isolated disposable PostgreSQL DSN'; exit 1)
	@test -n "$$INFRANEXUS_TEST_REDIS_ADDR" || (echo 'Set an isolated disposable Redis address'; exit 1)
	go -C backend test -race -count=1 -p=1 ./...
	npm --prefix frontend run test:e2e
	npm --prefix frontend run test:integration
