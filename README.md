# 练秋湖 IOC AI 执行器

Node.js HC 执行器：接收 RUISI-OSCA 的 HTTP 指令，统一校验并转换为练秋湖 IOC 前端 commands，再一次性发布到 MQTT；Narration 与动态问答通过按展厅隔离的 RUISI Ingress 回程播报。

```text
OSCA HTTP → 请求标准化 / HC Registry / Narration Runtime → 前端指令校验 → MQTT → IOC 前端
```

执行器不直接调用 Vue、IOC 页面、UE API、XMPP 或 TTS。

## 运行

要求 Node.js `>=18`。

```bash
npm install
npm test
npm start
```

HTTP 默认监听 `http://127.0.0.1:8008`。健康检查：

```text
GET /health
```

只有返回 `mqttConnected:true`、`status:"ready"` 才表示 MQTT 已连接。

## 配置

配置统一从项目根目录 `.env` 读取，生产由部署人员填写真实值；`.env` 已被 Git 忽略。

| 变量 | 说明 |
| --- | --- |
| `PORT` | HTTP 端口，默认 `8008` |
| `MQTT_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` / `MQTT_TOPIC` | 必填 MQTT 连接配置，`MQTT_URL` 必须为 `mqtts://` |
| `MQTT_QOS` | 当前仅支持 `0` |
| `MQTT_RETAIN` | 当前仅支持 `false` |
| `HC_TOKEN_MAP` | 必填。`X-HC-Token` 到 exhibitionId 的映射，格式 `token:exhibitionId[,token:exhibitionId...]`。同一展厅可配置多个 Token 做轮换 |
| `HC_HALL_<展厅>_AGENT` | 回程启用时必填。该展厅回程使用的可信 Agent；请求 `context.agent` 一律忽略 |
| `HC_HALL_<展厅>_INGRESS_HOST` | 可选。该展厅 RUISI 回程主机（仅主机名/IP，不带协议、端口或路径）；配置后作为可信回程入口 |
| `HC_HALL_<展厅>_INGRESS_PORT` | 可选。该展厅 RUISI 回程端口；与 `INGRESS_HOST` 成对配置 |
| `HC_HALL_<展厅>_CALLBACK_ALLOWLIST` | 可选。该展厅允许的回程白名单，逗号分隔的绝对 http(s) URL；沿用 9811796 已验收协议 |
| `HC_HALL_<展厅>_INGRESS_TOKEN` | 可选。该展厅回程 `X-Auth-Token`；缺省回退全局 `INGRESS_TOKEN` |
| `HC_HALL_<展厅>_TO` | 可选。该展厅接收方兜底 JID，仅当请求缺少 `context.reply_to` 时使用 |
| `RUISI_CALLBACK_TIMEOUT_MS` | 可选。回程超时，默认 `5000`ms |
| `HC_NARRATION_DURATION_SCALE` | 可选。Narration 时长倍率，默认 `1` |

变量名规则：`HC_HALL_` + 展厅 ID 转大写、非字母数字转 `_`。例如 `HC-A7K9P2` → `HC_HALL_HC_A7K9P2_*`。

### 展厅回程绑定

普通 IOC 指令只依赖 `HC_TOKEN_MAP`，**不依赖**任何回程配置：展厅回程未配置时执行器照常启动、照常发布 MQTT 指令。

- 展厅身份只由 `X-HC-Token` 决定；请求 `context.exhibitionId`、Body `exhibitionId` 都会被忽略并记录告警。
- **回程目标始终使用 RUISI 传入的 `context.callback` 原值**（协议、主机、端口、路径、查询参数都不改写），与 9811796 已验证协议一致。
- `HC_HALL_*_CALLBACK_ALLOWLIST` 或 `HC_HALL_*_INGRESS_HOST/PORT` 只用于**校验** `context.callback` 是否属于该展厅；命中后按原值回程，未命中返回 403。
- `CALLBACK_ALLOWLIST` 必须同时匹配 scheme + host + port + 路径：默认要求路径完全一致；只有白名单条目显式以 `/` 结尾时才按目录前缀放行（`/agent/send` 不会放行 `/agent/send/x`）。`INGRESS_HOST/PORT` 匹配要求 host + 有效端口 + `/agent/send`。
- 展厅级配置缺失但存在旧版全局 `INGRESS_HOST` / `INGRESS_PORT` 时进入兼容模式：按全局入口校验，Agent 取请求 `context.agent`。
- 完全没有可信回程配置时回程**安全拒绝**（Narration / 动态问答返回 403），不会使用未验证的 callback；普通 IOC 指令始终不受影响。
- 回程 Token 取 `HC_HALL_*_INGRESS_TOKEN`。仅当该展厅与全局 `INGRESS_HOST/PORT` 是同一入口（或只映射一个展厅）时才回退全局 `INGRESS_TOKEN`，多展厅不同入口之间不复用全局 Token。
- 不同展厅的 `AGENT` 与回程入口重复只记录告警，不阻断启动；请按产品实际部署修正，避免串展厅。
- 旧版全局 `AGENT` 仅在 `HC_TOKEN_MAP` 只映射一个展厅时作为 Agent 兜底；多展厅模式不会用全局 Agent 覆盖展厅身份。

三个展厅的配置示例（`HC-A7K9P2` / `HC-B4M8Q1` / `HC-C6N3R5`，数量可按产品实际展厅动态增加）：

```dotenv
HC_TOKEN_MAP=<A展厅Token>:HC-A7K9P2,<B展厅Token>:HC-B4M8Q1,<C展厅Token>:HC-C6N3R5

HC_HALL_HC_A7K9P2_AGENT=<A展厅Agent>
HC_HALL_HC_A7K9P2_INGRESS_HOST=<A回程主机>
HC_HALL_HC_A7K9P2_INGRESS_PORT=<A回程端口>
HC_HALL_HC_A7K9P2_INGRESS_TOKEN=<A回程Token>
HC_HALL_HC_A7K9P2_TO=<A接收方JID>

HC_HALL_HC_B4M8Q1_AGENT=<B展厅Agent>
HC_HALL_HC_B4M8Q1_INGRESS_HOST=<B回程主机>
HC_HALL_HC_B4M8Q1_INGRESS_PORT=<B回程端口>
HC_HALL_HC_B4M8Q1_INGRESS_TOKEN=<B回程Token>
HC_HALL_HC_B4M8Q1_TO=<B接收方JID>

HC_HALL_HC_C6N3R5_AGENT=<C展厅Agent>
HC_HALL_HC_C6N3R5_INGRESS_HOST=<C回程主机>
HC_HALL_HC_C6N3R5_INGRESS_PORT=<C回程端口>
HC_HALL_HC_C6N3R5_INGRESS_TOKEN=<C回程Token>
HC_HALL_HC_C6N3R5_TO=<C接收方JID>
```

示例值仅表示结构，禁止把占位值作为生产参数。`example-*`、`REPLACE_WITH_*`、`change-me-*` 会被启动校验拒绝。

### 本地 mock

`INGRESS_HOST`、`INGRESS_PORT`、`INGRESS_TOKEN` 仍可供 `scripts/mock-ruisi-ingress.js` 本地联调使用；正式业务回程以各展厅 `HC_HALL_*` 配置为准。

## `POST /api/commands`

请求必须携带 `X-HC-Token`，与 `HC_TOKEN_MAP` 精确匹配。Token 缺失、格式错误或未映射时返回 HTTP 401 `{ "ok": false, "error": "unauthorized" }`，不发布任何 MQTT 消息。目标展厅只由 Token 映射决定，请求 `context.exhibitionId` 一律忽略。

接口同时支持 legacy array 与 context envelope；普通指令不要求 context。

### Legacy array

```json
[
  { "action": "启动园区AI安防智能体", "params": {} }
]
```

### Context envelope

```json
{
  "context": {
    "agent": "hc-agent",
    "reply_to": "user@example.com",
    "groupchat": false,
    "callback": "<RUISI实际回程地址，如 https://host:port/agent/send>",
    "timestamp": "2026-08-24T20:00:00Z"
  },
  "commands": [
    { "action": "讲解园区基础信息", "params": { "language": "zh-CN" } }
  ]
}
```

`context` 会被标准化为不可变副本（`agent`、`replyTo`、`groupchat`、`callback`、`timestamp`）。`agent`、`reply_to`、`callback` 必须为非空字符串；`callback` 允许 `http://` 或 `https://`，且必须与会话展厅可信回程配置一致；`groupchat` 缺失时为 `false`。

## MQTT 单站信封

执行器使用统一 Topic 发布 UTF-8 JSON 信封，所有指令共用：

```json
{
  "exhibitionId": "HC-A7K9P2",
  "commands": [
    { "action": "主题切换", "params": { "主题名称": "综合安防" } }
  ]
}
```

- `exhibitionId` 来自 Token 映射，不由请求指定。
- QoS 0、retain false 保持不变。
- 前端在调用 Dispatcher 之前应再次校验 `exhibitionId` 与 `commands`。

## Narration 与动态问答

Narration 必须使用 envelope 并提供可回程的 context（`agent`、`reply_to`、`callback`）。执行器会按展厅配置覆盖可信 Agent、原样使用 RUISI 回程地址并携带该展厅回程 Token。

| 中文 action | 前端 capability | 结束时动作 |
| --- | --- | --- |
| `讲解园区基础信息` | `situation.parkOverviewNarration` | `cancel` |
| `讲解综合运行态势` | `situation.parkRealtimeNarration` | `finish` |
| `讲解安防实时态势` | `security.realtimeSituation` | `finish` |
| `讲解能源能效实时态势` | `energy.realtimeSituation` | `finish` |

- `params` 仅支持 `language`：`zh` / `zh-CN` / `en` / `en-US`，缺省 `zh-CN`。
- 成功返回 HTTP 202：`{ "ok": true, "message": "narration accepted", "sessionId": "..." }`。
- 同一展厅同时只有一个 active Narration，新会话会抢占同展厅旧会话；不同展厅互不影响。
- 动态问答使用相同的展厅回程绑定；Agent、Ingress Host/Port/Token 均来自当前展厅。

## RUISI callback 协议

```text
POST <RUISI context.callback 原值，如 http(s)://host:port/agent/send>
Content-Type: application/json
X-Auth-Token: <HC_HALL_展厅_INGRESS_TOKEN，缺省回退全局 INGRESS_TOKEN>
```

```json
{
  "agent": "<该展厅 HC_HALL_*_AGENT>",
  "to": "user@example.com",
  "body": "固定播报文本",
  "groupchat": false
}
```

HTTP 200 只表示消息已投递给 RUISI/XMPP Agent，不代表 TTS 已播放完成。callback 4xx/5xx、网络异常或超时时记录失败，Narration 仍按既定 duration 继续并执行 IOC cleanup。

## 本地工具

```bash
node scripts/mock-ruisi-ingress.js
node scripts/send-test-command.js
node scripts/send-test-callback.js 'HC callback test'
```

`mock-ruisi-ingress.js` 读取 `INGRESS_HOST`（默认 `127.0.0.1`）、`INGRESS_PORT`（默认 `29876`）、`INGRESS_TOKEN`；配置非空 token 时必须收到同值 `X-Auth-Token`。`send-test-callback.js` 的 callback URL 仍由 `RUISI_CALLBACK_URL` 指定，便于测试任意地址。

## 测试

```bash
npm test
```

当前 `npm test` 共 193 项，全部使用本地 MQTT/mock HTTP server，不依赖真实 RUISI Ingress。多展厅用例见 `test/multi-hall.test.js`，回程协议回归见 `test/hall-binding.test.js`。

## 仓库与边界

Git 仓库只提交 `.env.example`，不提交真实 `.env`、`node_modules`、运行日志、TTS 标定物、Python 虚拟环境或 IDE 临时文件。真实 Token 由产品/运维签发，禁止写入源码、README、`.env.example` 或 Postman 集合。

产品未提供真实 RUISI Ingress 时，本地可运行 mock；真实回程隔离仍需部署环境验收。
