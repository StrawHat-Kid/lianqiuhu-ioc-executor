# HC2026 多展厅 IOC 执行器本地测试说明

> 适用目录：`WEB后端\lianqiuhu-ioc-executor`
> 本说明只验证执行器鉴权、Token→exhibitionId 映射、按展厅回程绑定与 MQTT 信封，不验证双前端各展厅最终接收。

仓库内环境文件只包含 `REPLACE_WITH_HALL_*_TOKEN` 与本地占位 callback。真实 Token 只能在 Postman 本地环境填写，禁止写入文件或提交 Git。

## 1. 导入

1. Postman → Import。
2. 选择同目录：
   - `HC2026-Multi-Exhibition-Local.postman_collection.json`
   - `HC2026-Multi-Exhibition-Local.postman_environment.json`
3. 右上角环境选择 `HC2026 Multi-Exhibition Local`，把 `tokenA/tokenB/tokenC` 换成该展厅入站 Token（只在本机环境保存）。
4. 根据执行器 `.env` 的实际配置，核对：
   - `baseUrl`（默认 `http://localhost:8008`）
   - `iocCallbackA/B/C` 必须命中各展厅的 `HC_HALL_*_CALLBACK_ALLOWLIST`，或等于 `HC_HALL_*_INGRESS_HOST/INGRESS_PORT` + `/agent/send`（http/https 均可）
5. 需要一次覆盖 IOC / 安防 / 设施 / 能耗 / 会议 / 纯问数时，导入 `HC2026-All-Executors.postman_collection.json` 与 `HC2026-All-Executors.postman_environment.json`，使用同一套 Token 填写。

## 2. 执行器前置检查

1. 端口以执行器 `.env` 的 `PORT` 为准（默认 `8008`），不同则同步修改 `baseUrl`。
2. 运行 `04 健康检查`：
   - `mqttConnected:true`、`status:"ready"`：MQTT 已连接，可继续。
   - `status:"mqtt_unavailable"`：HTTP 可用但 MQTT 未连接，业务请求会返回 503。
3. 多展厅启动前置：每个 `HC_TOKEN_MAP` 展厅建议配置 `AGENT` + `CALLBACK_ALLOWLIST`（或 `INGRESS_HOST` + `INGRESS_PORT`）+ `INGRESS_TOKEN`；缺失不会阻断启动和普通指令，但该展厅回程会返回 403 并记录告警。
4. 不同展厅的 `AGENT` 与可信回程入口重复只告警，不阻断启动。

## 3. 展厅配置对照

| 本地变量 | 执行器配置 |
| --- | --- |
| `tokenA` | `HC_TOKEN_MAP` 中 `HC-A7K9P2` 对应 Token |
| `tokenB` | `HC_TOKEN_MAP` 中 `HC-B4M8Q1` 对应 Token |
| `tokenC` | `HC_TOKEN_MAP` 中 `HC-C6N3R5` 对应 Token |
| `iocCallbackA` | 命中 A 展厅 `HC_HALL_HC_A7K9P2_CALLBACK_ALLOWLIST`，或等于其 `INGRESS_HOST:INGRESS_PORT/agent/send` |
| `iocCallbackB` | 命中 B 展厅 `HC_HALL_HC_B4M8Q1_CALLBACK_ALLOWLIST`，或等于其 `INGRESS_HOST:INGRESS_PORT/agent/send` |
| `iocCallbackC` | 命中 C 展厅 `HC_HALL_HC_C6N3R5_CALLBACK_ALLOWLIST`，或等于其 `INGRESS_HOST:INGRESS_PORT/agent/send` |

## 4. 用例与判定

1. `01 有效 Token 普通命令`：A/B/C 分别返回 200；MQTTX 收到的每个信封 `exhibitionId` 分别为 `HC-A7K9P2` / `HC-B4M8Q1` / `HC-C6N3R5`。
2. `02 鉴权失败`：缺少 Token、未知 Token 均返回 401 `{ "ok": false, "error": "unauthorized" }`，MQTT 无任何业务消息。
3. `03 伪造展厅`：A Token + Body `HC-B4M8Q1` 预期 200；MQTTX 信封仍为 `HC-A7K9P2`，执行器日志记录忽略告警。
4. `04 健康检查`：无需 Token，返回 200。
5. `05 Narration`：
   - A 使用 `iocCallbackA`，B 使用 `iocCallbackB`；预期 202。
   - MQTTX 只观察到各自 `exhibitionId` 的 prepare/start/终态信封。
   - 两个展厅 Narration 可并行，互不 cancel。
6. `06 回程隔离`：A Token + B callback 预期 403，Body 错误为 `callback target is not allowed for this exhibition`，MQTT 无消息。

## 5. 与真实部署的差异

- 本地 callback 占位地址不可达时，Narration 仍会按 duration 继续并完成 IOC cleanup，只是回程投递失败。
- 真实部署时 callback 由 RUISI 传入，回程 Token 由产品提供；执行器只接受命中 `CALLBACK_ALLOWLIST` 或与 `INGRESS_HOST`、`INGRESS_PORT`、`/agent/send` 一致的 callback，并按原值回程。
- 统一 Topic 为广播 + 前端过滤架构，MQTT 上的所有在线前端都能收到全部展厅消息，隔离由 `exhibitionId` 保证。
