# 星载中继通道冗余配对复核

切除故障通道后，确认剩余设备能否两两配对接管冗余职责。浏览器中录入 **3–48 个唯一通道**
与**无向兼容边**，点击「复核配对」后：

- **可配对**：展示一组覆盖全部通道的配对（每对均为录入边，按通道标识升序稳定排序）；
- **不可配对**：展示阻止完整配对的通道集合 S（Tutte 屏障）、删除 S 后的每个奇数连通分量，
  并附带可凭原图逐项核对的清单，满足 **奇数分量数 > |S|** 的严格不等式。

计算在 **Web Worker** 中按**一般图（非二分图）**语义执行 **Edmonds 缩花（blossom）算法**。

## 输入校验（均给出明确中文反馈）

| 情形 | 反馈 |
| --- | --- |
| 自环（A — A） | 拒绝 |
| 重复边（含反向书写 B — A） | 拒绝 |
| 含未知端点的边 | 拒绝 |
| 通道数非偶数 / 少于 3 / 多于 48 / 标识重复 | 拒绝 |
| 空边图（无任何兼容边） | 拒绝 |

任何失败提交都会清空上一次通过的配对，绝不保留旧结果。

## 目录

```
src/
  matching.js   Edmonds 缩花 + Tutte-Berge 失败证书（Node/Worker 同构）
  parse.js      输入解析/校验、配对排序、证书独立复核（同构）
  worker.js     Web Worker 入口（importScripts 加载上述两份规则代码）
  app.js        主线程：仅做输入采集、Worker 调度与渲染
  index.html / styles.css
scripts/
  server.js     零依赖静态服务 + GET /health + POST /api/match（冒烟复用同一规则）
  build.js      构建：发布 src → dist 并做完整性断言
  smoke.js      单次 HTTP 冒烟（健康/静态/缩花成功/失败证书/非法输入），退出码结束
test/           node:test：n≤6 全图穷举 + 随机 fuzz + 解析 + Worker 集成（共 35 项）
compose.yaml    web（可配置宿主端口+健康检查）与 verify（单次校验）两个服务
Dockerfile
```

## 本地运行（无第三方依赖，Node ≥ 20）

```bash
npm run build
npm start                 # 默认 0.0.0.0:8080
PORT=8091 npm start       # 自定义端口
curl localhost:8080/health
```

一键校验（测试 + 构建 + HTTP 冒烟，以退出码结束）：

```bash
npm run verify
```

## Compose

```bash
# 可配置宿主端口：复制 .env.example 为 .env 后修改 HOST_PORT
docker compose up -d --build
# 访问 http://localhost:${HOST_PORT}，健康响应在 /health

# 单次校验服务：实际运行匹配规则测试、页面构建、本题输入的 HTTP 冒烟，
# 容器完成后以退出码结束（0 通过）
docker compose up --build verify
docker inspect relay-channel-matching-verify --format '{{.State.ExitCode}}'
```

## 失败证书为何可核对

Tutte 定理：图 G 有完美匹配，当且仅当对任意顶点集合 S 都有
`odd(G - S) ≤ |S|`（odd 为奇数连通分量数）。算法在最大匹配的匈牙利交错森林上取
**奇层顶点 S**，G−S 的每个奇分量恰好容纳一个无法增广的暴露根，故
`odd(G−S) = 暴露点数 = |S| + 缺额 > |S|`。

页面展示的核对项（`verifyCertificate`，仅凭原图与证书独立计算，不使用匹配过程数据）：

1. 各分量互不相交，且与 S 共同覆盖全部通道；
2. 每个分量可沿原图兼容边在内部连通；
3. 删除 S 后各分量之间不存在原图边；
4. 每个分量顶点数均为奇数；
5. 奇数分量数严格大于 |S|。
