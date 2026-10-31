# HC2026 IOC + 纯问数执行器多展厅回程配置说明

> 适用范围：`lianqiuhu-ioc-executor`、`lianqiuhu-data-agent-executor`
> 目标：与安防、设施、能耗、会议四个已验收执行器使用同一套多展厅配置规则。

## 一、统一配置结构

两个执行器都使用以下环境变量。展厅数量不写死，按 `HC_TOKEN_MAP` 动态展开。

```dotenv
HC_TOKEN_MAP=<A展厅Token>:HC-A7K9P2,<B展厅Token>:HC-B4M8Q1[,<C展厅Token>:HC-C6N3R5...]

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
```

变量名规则：`HC_HALL_` + 展厅 ID 转大写、非字母数字转 `_`。
例如 `HC-A7K9P2` → `HC_HALL_HC_A7K9P2_*`。

## 二、两种 Token 的区别

| 凭据 | 变量 | 用途 |
| --- | --- | --- |
| 入站 Token | `HC_TOKEN_MAP` 左侧 | 产品调用执行器时放在 `X-HC-Token`，用于识别展厅 |
| 回程 Token | `HC_HALL_*_INGRESS_TOKEN` | 执行器回程到 RUISI Ingress 时放在 `X-Auth-Token` |

两种 Token 不可混用，也不要互相替代。真实值由产品/运维签发，禁止提交 Git。

## 三、回程规则

- **IOC 执行器**：回程目标始终使用 RUISI 传入的 `context.callback` 原值（协议、主机、端口、路径、查询参数都不改写），`CALLBACK_ALLOWLIST` 或 `INGRESS_HOST/PORT` 只用于校验归属；与 9811796 已验收协议一致。
- **纯问数执行器**：回程目标固定为 `http://<INGRESS_HOST>:<INGRESS_PORT>/agent/send`。
- 回程请求体仍保持原有 RUISI 格式：

```json
{
  "agent": "<该展厅 AGENT>",
  "to": "<请求 context.reply_to；缺失时用该展厅 TO>",
  "body": "回答/播报文本",
  "groupchat": false
}
```

- IOC：`context.callback` 必须命中该展厅 `HC_HALL_*_CALLBACK_ALLOWLIST`（scheme + host + port + 路径；默认路径完全一致，条目以 `/` 结尾才按目录前缀放行）或 `HC_HALL_*_INGRESS_HOST/PORT`（host + 有效端口 + `/agent/send`），否则返回 403；命中后按 `context.callback` 原值回程。
- 请求中的 `agent`、`exhibitionId` 不能覆盖 Token 已确定的展厅配置。
- 回程配置不完整不会阻断执行器启动，也不会阻断普通 IOC 指令发布；完全没有任何可信回程配置时回程被安全拒绝（403），不会使用未验证的 callback。
- 缺少展厅级配置但存在旧全局 `INGRESS_HOST` / `INGRESS_PORT` / `INGRESS_TOKEN` 时，IOC 进入旧版兼容回程（Agent 取请求 `context.agent`），与早期已验证版本一致；建议尽快补齐展厅级配置。
- 回程 Token 只取本展厅配置；仅当展厅与全局 Ingress 指向同一目标（或只映射一个展厅）时才回退全局 `INGRESS_TOKEN`，多展厅不同入口之间不复用全局 Token。
- 不同展厅的 `AGENT` 与 `INGRESS_HOST:PORT` 重复只记录告警，不阻断启动；请按产品实际部署修正，避免串展厅。
- `TO` 可选：IOC 与纯问数都优先使用请求 `context.reply_to`，仅在其缺失时使用 `TO` 兜底。若产品需要固定接收方，请先确认是否会破坏按用户回复的业务语义。

## 四、IOC 执行器

配置文件：项目根目录 `.env`（已被 Git 忽略）。

新增/变更：

```dotenv
HC_TOKEN_MAP=...
HC_HALL_HC_A7K9P2_AGENT=...
HC_HALL_HC_A7K9P2_INGRESS_HOST=...
HC_HALL_HC_A7K9P2_INGRESS_PORT=...
HC_HALL_HC_A7K9P2_INGRESS_TOKEN=...
HC_HALL_HC_A7K9P2_TO=...
```

迁移说明：

- `HC_HALL_*_CALLBACK_ALLOWLIST` 继续有效（9811796 已验收协议），支持 https；默认要求路径完全一致，条目以 `/` 结尾才按目录前缀放行。`INGRESS_HOST` + `INGRESS_PORT` 作为另一种可信入口写法，二者可任选其一。
- 展厅级 `HC_HALL_*` 缺失时按字段回退到全局 `INGRESS_HOST` / `INGRESS_PORT`（旧版兼容），Agent 取请求 `context.agent`；全局 `INGRESS_TOKEN` 仅在同一 Ingress 目标或单展厅时回退。
- 完全没有可信回程配置时进程仍可启动并发布普通指令，但回程业务返回 403，不使用未验证 callback；`/health` 的 `hallBinding` 会显示 `bound` / `isolated` / `legacy` / `allowlist` / `unverified` / `invalid` 数量。
- `INGRESS_HOST` / `INGRESS_PORT` 仍可供本地 `scripts/mock-ruisi-ingress.js` 使用。
- MQTT 单 Topic、消息信封 `exhibitionId`（`{ "exhibitionId": "...", "commands": [...] }`）、Narration、动态问答等业务行为不变。

## 五、纯问数执行器

配置文件：

- `config.json`：服务、模型、知识库、上传、会话（不含展厅配置，已被 Git 忽略）。
- 项目根目录 `.env`：多展厅 `HC_TOKEN_MAP` 与 `HC_HALL_*`（已被 Git 忽略）。

启动时 `main.py` 通过 `python-dotenv` 加载 `.env`，已存在的进程环境变量优先。依赖中已加入 `python-dotenv`，`start-executor.bat` 会随 `requirements.txt` 安装。

迁移说明：

- 旧 `config.json` 的 `exhibitions.token_map`、`exhibitions.halls`、`exhibitions.halls.*.callback_token`、`callback_allowlist`、`callback.token` 已停用并忽略；如仍存在，启动日志会告警。
- 请从 `config.json` 删除旧 `exhibitions` / `callback` 段，避免两套可信配置源。
- 模型服务已切换为与本机 OpenCode 一致的 OpenAI-compatible 服务：连接参数使用环境变量 `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY`（或 `config.json` 的 `llm` 段）。旧 `deepseek` 段不再提供连接参数，只继承 `system_prompt` 等业务字段。
- `LLM_API_KEY` 使用部署环境独立签发的 Key，不复用 OpenCode 的登录凭据或内部认证文件；缺失时问答返回明确配置错误，不会回退 DeepSeek。
- 纯问数业务、Prompt、知识库检索、上下文、会话隔离与回程 Body 格式不变。

## 六、两个执行器需要的实际参数

请产品提供每个展厅：

1. 入站 `X-HC-Token`（每展厅一个，可轮换）。
2. 展厅 ID（`exhibitionId`，如 `HC-A7K9P2`）。
3. 回程 `AGENT`。
4. 回程 `INGRESS_HOST`（主机名或 IP，不带协议/端口/路径）。
5. 回程 `INGRESS_PORT`。
6. 回程 `INGRESS_TOKEN`。
7. 可选：接收方 `TO`（JID），仅在请求缺少 `reply_to` 时使用。
8. 执行器对外可达地址与端口（IOC 默认 8008，纯问数默认 18034，以实际配置为准）。

## 七、部署后验证

1. 启动日志应显示展厅数量与每个展厅的 Agent / Ingress Host / Port（不显示 Token）。
2. 分别用 A/B/C 入站 Token 调用一次普通业务：
   - 响应使用正确的展览身份；
   - 回程服务只收到本展厅 Agent、回程 Token 和正文；
   - 其他展厅回程服务无请求。
3. 使用 A Token + B callback：IOC 应 403；纯问数业务可执行但不向 B 回程。
4. 删除某展厅回程变量后重启：IOC 应继续启动，普通指令正常，回程按降级策略工作并记录告警；纯问数应启动失败并指出缺失变量名。
5. 原有业务回归：IOC 普通指令 / Narration / 动态问答，纯问数 AI 智能问答 / 会话重置。

## 八、仍需真实部署验证的风险

- 产品实际 RUISI Ingress 的协议/路径：IOC 已恢复为按 `context.callback` 原值回程，http/https 和自定义路径都不再被改写；纯问数仍与四个已验收执行器一致使用 `http://host:port/agent/send`。
- 产品是否要求多展厅共享同一回程 Host:Port；当前共享只告警，不阻断启动。
- `context.callback` 必须由 RUISI 提供；IOC 在“无任何可信配置”时会安全拒绝回程，因此每个展厅至少需要配置 `CALLBACK_ALLOWLIST` 或 `INGRESS_HOST/PORT` 才能启用 Narration / 动态问答。
- 真实 TTS 完成事件当前不可用，IOC Narration 仍按 duration 控制节奏。
- 纯问数模型、知识库与真实回程服务的连通性需部署环境实测。
