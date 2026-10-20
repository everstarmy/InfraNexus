.PHONY: help dev-backend dev-frontend build-backend build-frontend test tidy install-frontend

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
