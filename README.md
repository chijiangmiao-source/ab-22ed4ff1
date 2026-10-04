# 星载中继通道冗余配对复核

切除故障通道后，对剩余设备做**一般图（非二分图）完美匹配**复核：

- 存在完美匹配 → 展示一组覆盖全部通道的配对；
- 不存在 → 展示 **Tutte 失败证书**：一个移除集合 S，移除后图的奇数连通分量数
  `q(S) 严格大于 |S|`，每个奇分量与其通向 S 的边都可对照原图逐项核对。

匹配计算在 **Web Worker** 中按 **Edmonds 缩花（blossom）** 算法执行，
成功配对按通道标识稳定排序；零第三方运行时依赖（Node ≥ 20 内置模块）。

## 目录结构

```
src/matching.js   Edmonds 缩花 + Gallai-Edmonds/Tutte 证书（纯函数，浏览器/Worker/Node 共用）
src/worker.js     Web Worker（浏览器用 self.onmessage，Node 测试用 worker_threads）
src/app.js        页面逻辑：录入、校验反馈、Worker 调度、结果渲染
src/index.html    页面结构
src/styles.css    样式
server.mjs        零依赖 HTTP 服务：静态页面 + /healthz + POST /api/match
scripts/build.mjs 页面构建（语法检查 + 输出 dist/ + 清单）
scripts/smoke.mjs HTTP 冒烟（一次性启动服务，跑完即退，退出码表达结果）
test/             node:test 规则测试（含 400 幅随机图 vs 指数级暴力枚举对照、Worker 实测）
compose.yaml      web（常驻）+ verify（单次）两个服务
```

## 本地运行（不使用 Docker）

```bash
npm run build     # 页面构建 -> dist/
npm start         # 启动，默认 0.0.0.0:8080
# 可配置宿主端口：
HOST=0.0.0.0 PORT=9090 npm start
```

健康检查：`curl http://127.0.0.1:8080/healthz`

也可直接调用接口（页面本身的计算全部在浏览器 Worker 内完成，此接口仅供冒烟/集成）：

```bash
curl -s -X POST http://127.0.0.1:8080/api/match \
  -H 'Content-Type: application/json' \
  -d '{"channels":"C01\nC02\nC03\nC04","edges":"C01 C02\nC03 C04"}'
```

## Docker Compose

宿主端口可通过环境变量配置（容器内固定 8080）：

```bash
HOST_PORT=9090 docker compose up --build web
# 浏览器访问 http://localhost:9090
```

或使用 `.env`（参考 `.env.example`）：

```bash
cp .env.example .env   # 可修改 HOST_PORT
docker compose up --build web
```

`web` 服务带容器健康检查（轮询 `/healthz`）。

### verify 单次服务

实际依次运行 **匹配规则测试 → 页面构建 → 本题输入的 HTTP 冒烟**，
全部通过以退出码 0 结束，任何失败为非 0：

```bash
docker compose build verify && docker compose run --rm verify
# 检查退出码：
echo $?
```

冒烟覆盖：健康响应；静态资源（含 `worker.js` 引入匹配模块）；
含奇环可配对输入（成功、排序稳定）；无法完整配对输入
（`S=[HUB]`、3 个奇分量、`3 > 1`、跨边均可在原图核对）；
自环/重复边/未知端点/奇数通道数/空边图反馈；路径穿越与 405 防护。

## 本地 verify（与容器内一致）

```bash
npm run verify    # = npm run test && npm run build && npm run smoke
echo $?           # 0
```

## 输入规则

- 通道标识每行一个，数量 3–48 且必须为偶数，须唯一；
- 兼容边每行两个标识，空白 / `--` / 英文或中文逗号分隔；
- 自环、重复边（含 `a b` 与 `b a`）、未知端点、奇数通道数、少于 3 / 多于 48、
  空边图均给出明确错误反馈；
- 任何失败/非法提交都会清空结果区，**不会保留上一次通过的配对**。

## 失败证书为何可核对

证书基于 Gallai-Edmonds 分解构造（在某一最大匹配上做多源缩花交替 BFS 得到 D 集，
取 `S = N(D)\D`），但证书展示与算法内部状态完全无关：

1. 奇分量是对 **移除 S 后的原图** 独立做连通分量计算得到的；
2. 每个奇分量大小为奇数，且它们恰好穷尽 G−S 的全部奇连通分量；
3. 列出的每条“通向 S 的边”都真实存在于原图，且分量到 S 的原图边被完整列出；
4. 页面展示 `q(S) = 奇分量数 > |S|`，由 Tutte 定理即知无完美匹配。

测试中的 `independentlyVerifyCertificate` 不使用匹配实现的任何内部数据，
仅凭原图与证书 JSON 重算 BFS 分量、双向核对跨边并验证严格不等式；
随机测试中 400 幅一般图的 Edmonds 结果还与指数级暴力枚举做了大小对照。
