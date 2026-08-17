# 练秋湖 IOC AI 执行器（第一阶段）

独立、轻量的 Node.js 执行器。正式 OSCA 请求为中文 HC 语义指令数组：执行器先严格校验并通过 HC Registry 展开成前端完整指令数组，再校验并一次发布到 MQTT Broker。

```text
HC 中文语义 JSON → HTTP POST → HC 语义校验 / Registry Translator → 前端指令校验 → MQTT publish → MQTT Broker
```

执行器不调用 IOC 页面或 UE API；多条展开后的前端指令仍作为一个数组一次发布，不会拆分发送。HC 业务语义只在执行器 Registry 中集中定义，前端继续复用既有 capability、operation 与 Scenario 实现。

## Git 与分支

GitHub 仓库：`StrawHat-Kid/lianqiuhu-ioc-executor`（Private）。

- `master`：稳定部署分支，产品部署环境使用。
- `develop`：日常开发分支；新功能和修改先在此完成，人工及联调验证通过后再合并到 `master`。

## 快速启动

要求：Node.js `>=18`。仓库未声明固定 npm 版本。

```bash
npm install
npm start
```

实际入口为 `src/server.js`。项目不需要 build 或编译，也不要求 PM2、nodemon 或其它全局安装工具。

部署时从稳定分支拉取后，检查 `.env`，再安装并启动：

```bash
git pull origin master
npm install
npm start
```

## 配置

当前仓库没有 `.env.example`。`.env` 已被 Git 跟踪并提交到 Private 仓库，供部署人员查看和配置。

`.env` 包含 MQTT 地址、用户名和密码等敏感配置，因此仓库必须保持 Private，不能直接改为 Public；文档中也不得回显真实用户名或密码。

| 变量 | 作用 |
| --- | --- |
| `PORT` | HTTP 服务端口，默认 `8008` |
| `MQTT_URL` | MQTT TLS Broker 地址，必须使用 `mqtts://` |
| `MQTT_USERNAME` | MQTT 用户名 |
| `MQTT_PASSWORD` | MQTT 密码 |
| `MQTT_TOPIC` | MQTT 发布 Topic |
| `MQTT_QOS` | MQTT QoS，当前仅支持 `0` |
| `MQTT_RETAIN` | retain，当前仅支持 `false` |

除 `PORT` 外，MQTT 配置缺失会导致启动时的配置校验失败。

## HTTP 接口

默认地址：`http://127.0.0.1:8008`。

### `GET /health`

`/health` 始终返回 HTTP 200；部署验收必须重点检查 `mqttConnected` 和 `status`。HTTP 服务正常不等于 MQTT 已连接。

MQTT 已连接：

```json
{"ok":true,"mqttConnected":true,"status":"ready"}
```

MQTT 未连接：

```json
{"ok":true,"mqttConnected":false,"status":"mqtt_unavailable"}
```

### `POST /api/commands`

正式 OSCA 请求应使用 `Content-Type: application/json`，请求体顶层必须为非空数组：

```json
[
  {
    "action": "启动园区实时运营情况",
    "params": { "command": "start" }
  }
]
```

- `action` 必须完整、精确命中 HC Registry；首批白名单为“启动/取消园区实时运营情况”和“启动/取消AI节能助手”。
- `启动XXX` 只能搭配 `params.command: "start"`；`取消XXX` 只能搭配 `params.command: "cancel"`。缺失、大小写错误和其它值均拒绝。
- 中文 HC 指令不会原样发布。执行器展开后会再次按前端 dispatcher 的 action/params 入口校验，再一次性 MQTT publish。
- 为避免打断既有开发和自动化调用，现有完整前端 JSON 数组仍兼容；仅接受已知前端 action（主题切换、三类环境效果、`executeCapability`、`executeOperation`）。旧的无前缀 HC 业务名称不属于此前端协议，返回 400。

结果状态码：成功为 200；请求校验失败为 400；MQTT 未连接为 503；MQTT publish 失败为 500。

## MQTT 行为

Node.js 执行器连接可访问的 `mqtts://` MQTT Broker。当前联调使用 EMQX Cloud，但源码不依赖特定 MQTT 云厂商；这与前端可能使用的 MQTT over WSS 无关。

- QoS：`0`
- retain：`false`
- `queueQoSZero`：`false`
- 自动重连：`reconnectPeriod = 1000ms`

MQTT 未连接时，HTTP 指令直接返回 503；断线期间的待执行控制指令不会缓存，重连后也不会补发旧的 QoS 0 指令。

## 验收与测试

最小部署验收：启动后请求 `GET /health`，确认 `mqttConnected:true` 且 `status:ready`。

正式验收脚本：

```bash
node scripts/send-test-command.js
```

该脚本会真实调用 `http://127.0.0.1:8008/api/commands`，并触发 HTTP → MQTT publish；会输出 HTTP 状态和响应 JSON，非 2xx 时以非零状态码退出。

自动化测试：

```bash
npm test
```

自动化测试使用 MQTT Publisher mock，不连接真实 Broker。

## 当前边界

本阶段不负责 Vue 前端、IOC 页面或 UE API 调用、正式指令集、HTTP 鉴权、ACK、消息缓存、去重、重试、Docker/PM2/systemd 部署等能力，也不会补充 `request_id`、时间戳或终端标识等业务字段。
