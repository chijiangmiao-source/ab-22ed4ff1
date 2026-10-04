FROM node:20-alpine

WORKDIR /app

# 零第三方依赖：只需 package.json 与源码
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY server.mjs ./

# 镜像构建时即完成页面构建
RUN node scripts/build.mjs

ENV HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080

# 健康响应：不依赖 curl/wget，直接用 Node 全局 fetch
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
