# HC2026 多展厅本地联调说明（执行器 + MQTT 信封）

> 适用范围：本地测试环境（执行器 `WEB后端\lianqiuhu-ioc-executor`）。
> 本说明只验证执行器鉴权、Token → exhibitionId 映射与 MQTT 信封，不代表双前端隔离已验收。
> 仓库中的环境文件只保留 `REPLACE_WITH_HALL_*_TOKEN` 占位符；导入后请在 Postman 本地环境中填写产品签发的真实 Token，禁止把真实值写回文件或提交 Git。

## 1. Postman 导入步骤

1. 打开 Postman → Import。
2. 依次导入同目录下两个文件：
   - `HC2026-Multi-Exhibition-Local.postman_collection.json`
   - `HC2026-Multi-Exhibition-Local.postman_environment.json`
3. 在右上角环境选择器中选择 `HC2026 Multi-Exhibition Local`，把 `tokenA/tokenB/tokenC` 的占位符替换为本地测试 Token（只在本机环境副本中填写）。
4. 集合内所有请求均通过变量引用，不在请求里硬编码 Token。
5. 需要一次覆盖 IOC / 安防 / 设施 / 能耗 / 会议 / 纯问数时，导入 `HC2026-All-Executors.postman_collection.json` 与同名环境；所有服务地址和 Token 均为变量，默认地址为本地端口。

## 2. 确认执行器端口与 MQTT 连接

1. 端口来自执行器本地 `.env` 的 `PORT`（当前为 `8008`），如已修改请同步环境变量 `baseUrl`。
2. 启动执行器后执行集合中的 `04 健康检查`：
   - `mqttConnected: true` 且 `status: "ready"`：MQTT 已连接，可继续联调。
   - `status: "mqtt_unavailable"`：执行器 HTTP 可用但 MQTT 未连接，此时业务请求会返回 503 且不会发布消息。
3. 不要把 MQTT 用户名/密码写入 Postman 环境或集合。

## 3. MQTTX 应订阅的 Topic

- 打开执行器 `.env`，读取 `MQTT_TOPIC`（例如历史上使用的 `lianqiuhu/ioc/demo/commands`，以实际值为准）。
- MQTTX 新建连接后订阅该 Topic，QoS 0、retain false，使用运维提供的订阅凭据。
- 该 Topic 必须与执行器 `MQTT_TOPIC` 完全一致；统一 Topic 方案下所有展厅前端也订阅同一 Topic。

## 4. 先订阅再发送

1. 在 MQTTX 中先完成订阅并确认状态为已连接/已订阅。
2. 再在 Postman 中发送命令。
3. MQTT 使用 QoS 0 且 retain=false：**订阅之前或断线期间的消息不会补发**，未收到不代表执行器失败，需重发验证。

## 5. Token → exhibitionId 映射（本地测试）

| 请求使用 | exhibitionId（MQTT 信封中必须出现） |
| --- | --- |
| `tokenA` | `HC-A7K9P2` |
| `tokenB` | `HC-B4M8Q1` |
| `tokenC` | `HC-C6N3R5` |

真实 Token 只保存在本地 `.env` 与本机 Postman 环境副本中；仓库内的环境文件只有占位符，不得写入源码、README 或 `.env.example`，也不得提交真实值。
判定标准：MQTTX 收到的每条业务信封都必须形如：

```json
{ "exhibitionId": "HC-A7K9P2", "commands": [ ... ] }
```

## 6. 未知或缺失 Token

- `02 鉴权失败` 两个请求应返回 HTTP 401 `{ "ok": false, "error": "unauthorized" }`。
- 在 MQTTX 中观察整个请求窗口：**不得出现任何业务消息**。
- 若 401 请求后仍收到信封，或缺失 Token 请求返回 200，即判定失败。

## 7. 请求 Body 不能覆盖展厅 ID

- 接口入站格式为：顶层数组 `[...]` 或 `{ "context": {...}, "commands": [...] }`。
- 顶层 `exhibitionId` **不是受支持字段**：可随信封一起发送，但执行器会忽略并记录 `忽略请求体中的exhibitionId` 告警。
- `03 伪造展厅` 使用 A Token + Body 中的 `HC-B4M8Q1`：
  - 预期 HTTP 200；
  - MQTTX 信封必须是 `HC-A7K9P2`，**不得出现 `HC-B4M8Q1`**；
  - 执行器日志应出现忽略告警。
- Postman 无法读取 MQTT 内容，该项必须由 MQTTX 判定，不得仅凭 200 判为通过。

## 8. Narration 并行观察（按展厅隔离）

1. 发送 `Narration A`：预期 202；MQTTX 依次看到 `exhibitionId=HC-A7K9P2` 的 prepare/start 信封，数十秒后出现终态清理信封。
2. 在 A 未结束时发送 `Narration B`：预期 202；MQTTX 看到 `HC-B4M8Q1` 的 prepare/start。
   - **通过标准**：A 的会话不出现 cancel 信封且继续运行；两端信封 exhibitionId 不交叉。
3. 在 A 仍进行时再次发送 `Narration A`：同一展厅新会话抢占旧会话，MQTTX 应先看到 `HC-A7K9P2` 的清理信封，再看到新的 prepare；B 完全不受影响。
4. Narration 请求的 `context.callback` 为占位地址（`http://127.0.0.1:29876/agent/send`）；回调不可达不会阻断会话与 MQTT 信封。

## 9. 本轮能力边界（必须遵守）

1. 本轮仅验证**执行器与 MQTT 信封**；不得据此宣称前端隔离已验收。
2. 前端 gate 现状（2026-10-27 核验）：`WEB前端\lianqiuhu-ioc` 与 `WEB前端\lianqiuhu-ioc-b` 的 `src/services/park-ai/parkAiExhibitionMessageGate.js` 均为同一实现，`useParkAiRuntime.js` 已在 Dispatcher 之前做 `exhibitionId` 过滤；A 的 `dist/config.js` 已包含 `exhibitionId: 'HC-A7K9P2'`，B 目前没有 `dist`，部署前必须重新构建。`lianqiuhu-ioc-prune` 没有 gate，不得接入该广播 Topic。
3. 统一 Topic 是**广播 + 前端过滤**架构：MQTT 层所有订阅者都能收到全部展厅消息，它不等于 MQTT 层面的展厅保密或防伪造隔离。
4. 正式环境 Token 由产品/运维签发；仓库文件只保留占位符，真实 Token 不得写入前端配置、源码或本目录文件。
