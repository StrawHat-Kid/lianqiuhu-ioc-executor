# 练秋湖 IOC AI 执行器

Node.js HC 执行器接收 RUISI-OSCA 的 HTTP 指令，统一校验后转换为冻结的 IOC 前端 commands，并一次发布至 MQTT。

```text
OSCA HTTP → 请求标准化 / HC Registry / Narration Runtime → 前端指令校验 → MQTT → IOC 前端
```

执行器不直接调用 Vue、IOC 页面、UE API、XMPP 或 TTS。

## 启动

要求 Node.js `>=18`。

```bash
npm install
npm start
```

HTTP 默认监听 `http://127.0.0.1:8008`。启动后先检查：

```text
GET /health
```

只有返回 `mqttConnected:true`、`status:"ready"` 才表示 MQTT 已连接。

## 配置

实际运行配置统一由项目根目录 `.env` 提供；部署时应由部署人员保管真实 `.env`，不得把真实密码或 token 放入交付 ZIP。

| 变量 | 作用 |
| --- | --- |
| `PORT` | HTTP 端口，默认 `8008` |
| `MQTT_URL` / `MQTT_USERNAME` / `MQTT_PASSWORD` / `MQTT_TOPIC` | 必填 MQTT 配置 |
| `MQTT_QOS` | 当前仅支持 `0` |
| `MQTT_RETAIN` | 当前仅支持 `false` |
| `INGRESS_TOKEN` | 与 RUISI Ingress 共享的可选 secret；配置后 callback 添加 `X-Auth-Token` |
| `RUISI_CALLBACK_TIMEOUT_MS` | 可选；callback 超时，默认 `5000`ms |
| `HC_NARRATION_DURATION_SCALE` | 可选；所有讲解段时长倍率，默认 `1`；非法、零或负数回落 `1` |

本地开发 `.env` 的回程相关配置：

```dotenv
INGRESS_HOST=127.0.0.1
INGRESS_PORT=29876
INGRESS_TOKEN=replace-with-local-shared-token
RUISI_CALLBACK_TIMEOUT_MS=5000
HC_NARRATION_DURATION_SCALE=0.1
```

`INGRESS_HOST` 与 `INGRESS_PORT` 只供 `scripts/mock-ruisi-ingress.js`（以及未来 RUISI Ingress 服务）监听使用。Node callback 的目标地址始终来自请求中的 `context.callback`，不会拼接 host/port。`INGRESS_TOKEN` 是 Node 与 Ingress 共享的 secret；正式产品环境必须替换为产品提供的值。`HC_NARRATION_DURATION_SCALE=0.1` 仅用于本地快速联调，正式运行/演示前必须改回 `1`。

### Narration 时长调节

`HC_NARRATION_DURATION_SCALE` 是全局语音节奏倍率：`1` 使用 definition 原始时长，`0.8` 缩短 20%，`1.2` 延长 20%。如只有一段实际 TTS 偏快或偏慢，只调整 `src/narration/narration-definitions.js` 对应 segment 的 `durationMs`，不要为了单段修改全局倍率。

每条 Narration 可选配置 `prepareCommands`、`introDelayMs`，每个 segment 可选配置 `postGapMs`；未配置时分别按 `[]`、`0`、`0` 处理。`prepareCommands` 仅用于先切换 IOC 一级主题，随后等待 `introDelayMs`，才执行 `startCommands` 并发送第一段 callback。`HC_NARRATION_DURATION_SCALE` 只作用于 `durationMs`，不作用于 `introDelayMs`、`postGapMs` 或 `minimumIocHoldMs`。

园区基础底数讲解额外声明了 `minimumIocHoldMs`，用于保护 UE 园区漫游。其实际保持时间为 `max(durationMs × HC_NARRATION_DURATION_SCALE, minimumIocHoldMs) + postGapMs`；该最小 IOC 保持时间不受倍率影响。综合运行态势、安防实时态势、能源与能效实时态势不设置此下限，仍按 `durationMs × HC_NARRATION_DURATION_SCALE + postGapMs` 执行。

## `POST /api/commands`

接口同时支持 legacy array 与 context envelope。普通指令两种请求的 IOC 结果相同；context 不会写入 MQTT commands。

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
    "callback": "http://127.0.0.1:29876/agent/send",
    "timestamp": "2026-08-24T20:00:00Z"
  },
  "commands": [
    { "action": "启动园区AI安防智能体", "params": {} }
  ]
}
```

`context` 会被标准化为不可变副本：`agent`、`replyTo`、`groupchat`、`callback`、`timestamp`。如给出，`agent`、`reply_to`、`callback` 必须为非空字符串；callback 只允许 `http://` / `https://`；`groupchat` 缺失时为 `false`。

## Narration：必须使用 envelope

以下四条讲解必须提供可回程 context，至少有 `agent`、`reply_to`、`callback`。缺失时返回 HTTP 400 `narration callback unavailable`，且不会启动 IOC 讲解保持态。

| 正式 action | 前端 capability | 正常结束 |
| --- | --- | --- |
| `讲解园区基础信息` | `situation.parkOverviewNarration` | `cancel` |
| `讲解综合运行态势` | `situation.parkRealtimeNarration` | `finish` |
| `讲解安防实时态势` | `security.realtimeSituation` | `finish` |
| `讲解能源与能效实时态势` | `energy.realtimeSituation` | `finish` |

Narration `params` 仅支持 `language`：`zh` / `zh-CN` / `en` / `en-US`；省略默认 `zh-CN`，非法值返回 HTTP 400。

请求成功立即返回 HTTP 202：

```json
{ "ok": true, "message": "narration accepted", "sessionId": "..." }
```

后台 session 按 definition 执行 `prepareCommands → introDelayMs → startCommands → IOC step → callback → duration wait → postGapMs`。全进程同时只保留一个 active Narration；新的 Narration 会 abort 旧 session，旧 session仅在已进入 IOC start 后执行自身 `cancel`，不得影响新 session。普通 IOC 指令（包括第三方 AI）不会自动抢占 Narration。

### HTTP 400 Narration 排障

如果功能5/6正常，而四条讲解 action 返回 HTTP 400，优先检查 RUISI/OSCA 是否已启用 `include_context: true`。Node 必须实际收到下列 envelope，不能只收到 `commands` 数组：

```json
{
  "context": {
    "agent": "...",
    "reply_to": "...",
    "groupchat": false,
    "callback": "http://.../agent/send"
  },
  "commands": [
    { "action": "讲解园区基础信息", "params": { "language": "zh-CN" } }
  ]
}
```

`context.agent`、`context.reply_to`、`context.callback` 任一缺失都会被拒绝为 HTTP 400；执行器不会伪造用户、拼接 callback 地址或允许 Narration 旧数组绕过回程校验。控制台会输出请求ID、请求体类型、context 解析结果与具体拒绝原因，便于按真实入站内容定位协议问题。

## 第三方 AI：普通 IOC 指令

以下 action 同时支持 legacy array 与 envelope，不要求 callback、language 或 Narration Session，也不会自动回消息。

| action | 前端 commands |
| --- | --- |
| `启动园区AI安防智能体` | `主题切换: 综合安防` → `security.thirdPartyAgent start` |
| `取消园区AI安防智能体` | `security.thirdPartyAgent cancel` |
| `启动园区AI能耗智能体` | `主题切换: 能源管理` → `energy.thirdPartyAgent start` |
| `取消园区AI能耗智能体` | `energy.thirdPartyAgent cancel` |

取消第三方 AI 不切换专题。

## RUISI callback

Narration 使用：

```text
POST context.callback
Content-Type: application/json
```

请求体：

```json
{
  "agent": "hc-agent",
  "to": "user@example.com",
  "body": "固定讲解文本",
  "groupchat": false
}
```

HTTP 200 **只表示最终文字已成功投递给 RUISI/XMPP Agent，不表示 TTS 已播放完成**。当前协议没有 `speech_finished` 或等价播放事件，因此第一版由 Node definition 的 duration 控制节奏。

callback 返回 4xx/5xx、network error 或 timeout 时会记录失败，但 session 仍按既定 duration 继续并完成 IOC cleanup；不会使进程产生 unhandled rejection。

## 旧 HC 兼容边界

既有中文 HC Registry 与现有直接前端 command 数组继续兼容。特别是：

- `启动园区总览` 仍映射 `situation.parkOverview`，不是 Narration；
- `启动园区实时运营情况` 仍映射 `situation.parkRealTimeOperation`，不是 Narration；
- 安防 Narration 不触发 `security.noHardHatAlert`、安全帽全流程或视频；
- 能源 Narration 不触发第三方 AI、光伏监测、AI 节能助手、能流分析、AI 算法或工单业务。

## 开发/联调工具

`scripts/` 下工具仅用于开发与产品联调，不参与生产 HTTP 路由：

```bash
node scripts/mock-ruisi-ingress.js
node scripts/send-test-command.js
node scripts/send-test-callback.js 'HC callback test'
```

`mock-ruisi-ingress.js` 读取 RUISI Ingress 协议配置：`INGRESS_HOST`（默认 `127.0.0.1`）、`INGRESS_PORT`（默认 `29876`）、`INGRESS_TOKEN`。配置非空 token 时，mock 必须收到同值的 `X-Auth-Token`，否则返回 401；未配置 token 时输出 `mock ingress auth disabled` 并允许本地无 token 联调。`send-test-callback.js` 读取 `INGRESS_TOKEN`，但 callback URL 继续由 `RUISI_CALLBACK_URL` 指定，以便测试任意地址。

根目录 `.env` 已配置后，本地联调只需分别运行：

```powershell
node scripts/mock-ruisi-ingress.js
```

```powershell
npm start
```

## 测试与交付

```bash
npm test
```

当前冻结基线预期为 `95 passed, 0 failed`。测试使用 MQTT/mock HTTP server，不依赖真实 RUISI ingress。

Git 仓库只包含 `.env.example`，不包含真实 `.env`。本地或产品部署时先复制 `.env.example` 为 `.env`，再由部署人员填写 MQTT、Token 等真实值；`.env` 不得提交到 Git。仓库不应包含 `node_modules`、运行日志、TTS 标定产物、Python 虚拟环境或 IDE 临时文件。

## 当前边界

产品 RUISI Ingress 未来还会配置 `INGRESS_HOST`、`INGRESS_PORT`、`INGRESS_TOKEN`。Node 正式业务只读取共享的 `INGRESS_TOKEN`；实际 callback URL 始终来自每次请求的 `context.callback`，不会由 `INGRESS_HOST` 与 `INGRESS_PORT` 拼接。尚未实现真实 RUISI `/agent/send`、真实 XMPP 回程与 TTS 播放完成事件。第一版 duration 仅是 HC 节奏配置；真实语速确认后可调整 `HC_NARRATION_DURATION_SCALE` 或 definition duration。
