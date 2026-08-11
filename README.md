# 练秋湖 IOC AI 执行器（第一阶段）

这是一个独立、轻量的 Node.js 执行器：接收 OSCA 发来的 HTTP JSON 指令数组，完成基础校验后，将该数组原样发布到 EMQX Cloud MQTT Topic。

## 职责与边界

已确定职责：HTTP 接收、指令结构校验、MQTT TLS 长连接/自动重连、以 QoS 0 且 `retain=false` 发布。

本阶段不负责 OSCA 核心或 YAML、Vue 前端和前端指令映射、EMQX Cloud 实例/ACL、正式指令集、HTTP 鉴权、ACK、消息缓存、去重、重试、Docker/PM2/systemd 部署。不会补充 `request_id`、时间戳或终端标识等业务字段。

## 安装与配置

需要 Node.js 18 或更高版本。

Windows PowerShell：

```powershell
npm install
Copy-Item .env.example .env
```

Windows CMD：

```cmd
npm install
copy .env.example .env
```

编辑 `.env`，填写实际 MQTT TLS 连接信息。`.env` 已被 Git 忽略，不能提交。必须配置 `MQTT_URL`、`MQTT_USERNAME`、`MQTT_PASSWORD`、`MQTT_TOPIC`；启动仅接受 `MQTT_QOS=0`、`MQTT_RETAIN=false`，其他值会明确失败。

```bash
npm start
```

日志只记录 MQTT 的协议、主机和端口，不记录 URL 中可能出现的凭据，也不会输出密码。

## 接口

`GET /health` 始终显示 HTTP 服务状态，并以 `mqttConnected` 明确 MQTT 是否已连上。MQTT 断开时示例：

```json
{"ok":true,"mqttConnected":false,"status":"mqtt_unavailable"}
```

`POST /api/commands` 仅接受非空 JSON 数组；每项必须是普通对象，有非空字符串 `action`；若有 `params`，也必须为普通对象。任一项不合法即返回 400，且不会发布。

合法请求会直接执行 `JSON.stringify(原始数组)` 后一次发布，缺失的 `params` 不会自动补充。MQTT 未连接返回 503；MQTT.js 发布回调报错返回 500；只有回调成功后才返回 200。

当前 Topic 由 `MQTT_TOPIC` 配置，示例值为 `lianqiuhu/ioc/demo/commands`。发布参数固定 `qos: 0`、`retain: false`。执行器显式关闭 MQTT.js 的 QoS 0 断线排队，连接断开期间的指令不会在重连后补发。

## 请求示例

常规 curl：

```bash
curl -X POST http://127.0.0.1:8008/api/commands -H "Content-Type: application/json" -d '[{"action":"主题切换","params":{"主题名称":"综合安防"}}]'
```

Windows PowerShell：

```powershell
$body = @(@{ action = '主题切换'; params = @{ '主题名称' = '综合安防' } }) | ConvertTo-Json -Depth 4
Invoke-RestMethod -Uri 'http://127.0.0.1:8008/api/commands' -Method Post -ContentType 'application/json' -Body $body
```

也可模拟 OSCA 调用（仅通过 HTTP，不直接调用 MQTT）：

```bash
node scripts/send-test-command.js
```

脚本会输出 HTTP 状态和响应 JSON；请求或非 2xx 响应会以非零状态码退出。

## 自动化测试

```bash
npm test
```

测试使用 Node.js 内置 `node:test` 和注入的 MQTT Publisher mock，不连接真实 Broker。覆盖健康状态、全部结构校验、原样发布、QoS/retain 固定值、未连接、发布失败、成功和多指令单次发布。

## 常见错误排查

- 启动时报缺失环境变量：复制 `.env.example` 为 `.env` 并填写全部 MQTT 配置。
- 启动时报 QoS 或 retain 错误：第一阶段只能使用 `0` 和 `false`。
- 健康检查显示 `mqttConnected:false`：核对 Broker 地址、TLS 端口、用户名密码、网络与 EMQX ACL。
- 指令返回 400：请求顶层必须是非空数组，且每项需要非空 `action`。
- 指令返回 503：HTTP 服务正常，但 MQTT 尚未连接；不会伪造发布成功。

## 当前限制与待确认事项

HTTP 鉴权方式、OSCA 最终请求格式/请求头/超时和部署位置、正式 HTTP 地址端口、正式指令集及参数定义、EMQX 正式实例与 ACL、环境与终端区分、ACK/去重/缓存/重试/串行策略及部署方式，均仍等待产品部确认；本轮未实现，也未自行假设。
