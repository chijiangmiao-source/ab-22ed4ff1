# 零第三方依赖：仅使用 Node 20 内置 http / 测试运行器
FROM node:20-alpine

WORKDIR /app

# 先拷贝清单（虽无第三方依赖，保持分层习惯）
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test

# 构建期产出 dist/，镜像启动即直接提供服务
RUN node scripts/build.js

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

CMD ["node", "scripts/server.js"]
