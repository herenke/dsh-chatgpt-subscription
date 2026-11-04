# dsh-chatgpt-subscription 评审交接文档

> **历史评审存档**：以下内容保留 2026-11-03 交接时的状态，并非当前缺陷清单。后续处理结论见 [REVIEW-RESOLUTION.md](REVIEW-RESOLUTION.md)，真实账号验证与 2026-11-04 用户确认可用的记录见 [VALIDATION.md](VALIDATION.md)。

> 目的：把一次针对本插件的完整评审（代码、DSH 宿主接口、OpenAI 官方协议、实测）整理成可执行工单，交给负责开发该功能的 agent。
> 评审日期：2026-11-03；评审基线：commit `9b56b93`（评审开始时工作区干净；该 commit 内容与 GitHub 下载 zip 完全一致）。
> **交接时状态**：本仓库工作区另有未提交改动（另一个 agent 正在开发 images / reasoning replay / web search，见 §0.1；交接时 `npm test` 55/55 通过）。本文件所有 `文件:行` 以基线 commit 为准；动手前先跑 `git diff` 对照当前工作树，避免重复劳动或覆盖别人未提交的改动。
> 评审环境：macOS，Node.js v22.23.3，DSH Desktop **0.2.1-rc.5**（`/Applications/DeepSeek Harness.app`，profile=`desktop`，`DSH_HOME=/Users/keyee/.dsh`）。
> 限制：**没有真实 ChatGPT 账号登录、没有消耗订阅额度**，所有涉及真实 OAuth/额度/工具循环的行为仍未验证（README/SECURITY/VALIDATION 中已如实声明）。

---

## 0. 一句话结论

协议层与安全设计基本正确（逐条对得上 OpenAI 官方文档），DSH 适配层在 0.2.1-rc.5 的接口上可加载（已实测），但**当前版本在你机器上装不上**（版本门禁写死 0.2.2-alpha.3），**即使绕过也会因口令环境变量缺失而不激活**；修好这两点后，仍有 3 个会在真实使用中稳定出问题：并发凭据锁、120s 总超时套住流式响应、缺少 contextWindow 导致自动压缩失效。

---

## 0.1 交接时的未提交改动（另一 agent 在改，勿重复/勿冲突）

基线 `9b56b93` 之后，工作区出现了一组未提交改动，主题是**新功能**（不是本评审的修复项）。交接时已核对：

| 文件 | 改动 | 评审意见 |
| --- | --- | --- |
| `src/index.js` | `apply` 放开 `webSearch: boolean` 配置，并向 adapter 传入 `ctx.get('attachments')` | 部分缓解 B2 的"拒绝一切配置"，但**没有解决 B2 核心**：Vault 仍在构造期要求口令，`apply` 仍会抛。B2 仍需按 §3 处理 |
| `src/adapter.js` | 构造加 `features`；新增 `imageRequestTarget`；listModels/resolveModel **去掉** `inputModalities: ['text']`，改为按目录 `input_modalities` 推断 | 注意语义变化：目录不返回 `input_modalities` 的模型将不再声明能力，DSH 不再把图片投影成文本，而新 `requestBody` 会把图片直接发给模型 → 需要确认目录一定返回该字段，或保留保守默认；否则文本模型收到图片会 400 |
| `src/images.js`（新） | 图片附件校验/尺寸限制/按需上传（依赖 `attachments.readImageRequest`），超限用 `IMAGE_OFFLOAD_REQUIRED` | 方向正确；限制常量（8MiB/20MiB/16 张/4096px）需与 OpenAI 实际限制核对；必须真实账号验证图片路径 |
| `src/replay.js`（新） | 把 `response.output`（含 `reasoning.encrypted_content`）随 `finish.replayState` 落库，历史 assistant 消息按"账号 + provider + model + 内容哈希"校验后整体回放 | **这正是 §8 里"工具循环 + reasoning 回放"风险的正确方向**；仍需真实账号多轮 function_call 验证；注意 replayState 必须是 lossless JSON、跨账号/模型/压缩后必须失效（当前用 hash 校验，方向对） |
| `src/protocol.js` | system→developer；function_call 增加 `namespace: 'dsh'`；tools 改为 `{type:'namespace', name:'dsh', tools:[...]}` 包装；**移除** `max_output_tokens`；新增 web_search 工具与来源引用 | **两处必须先核对**：① 官方 "Models and inference" 只展示基础推理，`type:'namespace'` / function_call 的 `namespace` 字段不在公开示例中——若未用真实账号验证，工具调用可能整体 400，务必实测后再依赖；② 移除 `max_output_tokens` 是行为变更：DSH 传入的 `maxTokens` 会被静默忽略，需要确认订阅路由确实拒绝该字段，并在 README/SECURITY 写明"本路由不强制输出上限" |
| `test/protocol.test.js` / 新增 `test/features.test.js` | 跟随改动 | 交接时 `npm test` 55/55 通过、`npm run check` 通过 |

**交接时仍未修复**（已在当前工作树逐项核对）：**B1、B2、H1、H2、H3、M1、M3、M4、M5、M6**。新功能改动不覆盖这些项（`src/auth.js`、`src/vault.js` 未改动）。

---

## 1. 环境事实（本仓库/宿主/依赖）

| 项 | 值 |
| --- | --- |
| 宿主 DSH 版本 | `0.2.1-rc.5`（Desktop App `Info.plist`、`dsh --version`、`@deepseek-ai/dsh-llm@0.2.1-rc.5` 均一致） |
| 插件声明目标 | `engines.dsh = 0.2.2-alpha.3`，`peerDependencies["@deepseek-ai/dsh-llm"] = 0.2.2-alpha.3` |
| npm 通道 | `next` → 0.2.1-rc.5（桌面 App 所在通道）；`alpha` → 0.2.2-alpha.3 |
| 运行 profile | `desktop`（已安装 `@local/dsh-jira-dashboard`） |
| 已装依赖副本 | 本仓库 `node_modules/@deepseek-ai/dsh-llm` 为 `0.2.2-alpha.3`（测试用） |
| 公开 URL | `https://github.com/herenke/dsh-chatgpt-subscription` 当前 404（私有或未推送），评审使用本机目录 |

已执行并全部通过：`npm test`（基线 33/33；交接时工作树 55/55）、`npm run check`。

---

## 2. 工单总览（按优先级）

| # | 优先级 | 问题 | 影响 | 主要位置 |
| --- | --- | --- | --- | --- |
| B1 | **P0** | `engines.dsh` 精确锁 0.2.2-alpha.3 | 安装/激活被拒，完全不可用 | `package.json` L8-11 |
| B2 | **P0** | `apply` 内构造 Vault 强依赖 `DSH_CHATGPT_VAULT_PASSWORD` | GUI 启动时插件不激活，provider 消失 | `src/index.js` L6、`src/adapter.js` L8、`src/vault.js` L7-11 |
| H1 | **P1** | Vault 锁 fail-closed + 每请求多次加锁/写盘 + refresh 锁内做网络 | 并发 LLM 调用随机 `Vault busy`，刷新期间全挂 | `src/vault.js` L45-61、`src/auth.js` L96-113、`src/adapter.js` L22-33 |
| H2 | **P1** | `officialFetch` 的 120s 总超时套住流式推理 body | 单次生成 >2 分钟被中断 | `src/auth.js` L63、L112-118 |
| H3 | **P1** | `resolveModel`/`prepareCall` 不返回 `context.contextWindow` | 自动压缩永久失效，长会话硬失败且无法触发 overflow 恢复 | `src/adapter.js` L16-21、`src/protocol.js` L115 |
| M1 | P2 | `providerRetryPolicy()` 形状不符合 `ResolvedRetryPolicy`（缺 `backoff`） | 目前 `maxRetries:0` 掩盖，开重试即坏 | `src/adapter.js` L9 |
| M2 | P2 | 每个请求都 `GET /models`（每个 picker/请求多次） | 延迟、放大 H1 锁冲突 | `src/adapter.js` L11-33 |
| M3 | P2 | 500/400 错误信息归一化过度，未映射 DSH 错误码 | 上下文溢出无法恢复；排障困难 | `src/protocol.js` L5、L99-107、L115 |
| M4 | P2 | `response.incomplete`（max_output_tokens）当失败处理 | 截断响应变成整轮错误 | `src/protocol.js` L102-103 |
| M5 | P2 | CLI 顶层 `catch` 吞掉全部错误细节 | 登录失败不可诊断 | `src/cli.js` L72 |
| M6 | P2 | 文档/安装命令与实际 profile 不符（`--profile web`） | 用户按 README 操作会建错 profile | `README.md` L36 |
| D1 | P2 | 仓库 URL 404 | 交付/发布阻塞 | — |

> 交接时状态（当前工作树已核对）：B1、B2、H1、H2、H3、M1、M3、M4、M5、M6 **仍未修复**；M2 未动。另有新功能未提交改动，见 §0.1——动手前先与在改的 agent 对齐分工，**不要覆盖未提交工作**。

**不要改的**：OpenAI 协议常量、验签/回调校验、端点白名单、`redirect:'error'`、加密与文件权限、原子写、日志不打印 token、`store:false`/`stream:true`、拒绝 endpoint 覆盖。详见 §7。

---

## 3. P0 阻断项

### B1. 版本门禁写死，本机装不上（已实测）

**证据（隔离 DSH_HOME，不碰用户 profile）：**

```sh
DSH_HOME=/tmp/dsh-review dsh plugin --profile probe add file:/Users/keyee/Projects/dsh-chatgpt-subscription
# dsh: installation rejected: Plugin dsh-chatgpt-subscription@0.1.0 is incompatible with dsh 0.2.1-rc.5:
#      requirements {"engines.dsh":"0.2.2-alpha.3"}. ... dsh: nothing was installed.
```

**宿主行为（已核对 `@deepseek-ai/dsh-plugin-manager` / `@deepseek-ai/dsh-app-boot` 0.2.1-rc.5 源码）：**
- 安装前预检：`evaluatePluginCompatibility(manifest, exemptions)` 不通过 → 直接拒绝，什么都不装；CLI 与 GUI `plugin_manager` 同一条路径。
- 启动时：`engines.dsh` 不满足且无豁免 → 该 bundle 被 skip（`profile.skippedBundles`）。
- **关键语义**：manifest 里**只要存在 `engines.dsh`，`peerDependencies` 就完全不参与兼容性判断**；因此当前只有 `engines.dsh` 一个门。
- 豁免是逐 `包名@版本` + 逐 `dsh 版本` 的显式授权（`dsh plugin allow-version ... --accept-risk` 或 GUI 插件管理器），风险提示为"可能崩溃或丢数据"。

**门禁其实过严（已 diff 验证）：** `@deepseek-ai/dsh-llm@0.2.1-rc.5` 对比 `0.2.2-alpha.3`：
- `LlmAdapter`、`providerInfo`、`providerRetryPolicy`、`listModels`、`resolveModel`、`prepareCall`、`stream`、`attributionHeaders` 的签名/语义完全一致；
- 差异只有新增的可选 `LlmModelInfo.badge`、新增 `llm/models-updated` 事件、`GenerateOptions.purpose` 的类型放宽；插件均未使用；
- 已用 mock ctx 在 0.2.1-rc.5 语义下实测 `apply` → 注册成功（`providerInfo` 校验、`registerAdapter` 校验通过）。

**修复（建议）：**

```json
"engines": { "node": ">=22", "dsh": ">=0.2.1-rc.5 <0.3.0" },
"peerDependencies": { "@deepseek-ai/dsh-llm": ">=0.2.1-rc.5 <0.3.0" }
```

`>=0.2.1-rc.5 <0.3.0` 同时满足 0.2.1-rc.5 与 0.2.2-alpha.3（semver `includePrerelease: true` 已核算）。

**验收：**
1. 不带豁免安装到隔离 DSH_HOME 成功；
2. 带豁免安装到隔离 DSH_HOME 也成功（豁免与范围可共存）；
3. 分别用 0.2.1-rc.5 与 0.2.2-alpha.3 两个 `@deepseek-ai/dsh-llm` 版本跑 `npm test` 全绿（当前测试图固定 alpha，见 §6）。

---

### B2. 激活时强依赖口令环境变量，GUI 启动必然不激活（已实测）

**现象/证据：**

```sh
DSH_HOME=/tmp/dsh-review dsh --profile probe --help        # 未设置 DSH_CHATGPT_VAULT_PASSWORD
# dsh: warning: 1 entry did not activate
# chatgpt-subscription (dsh-chatgpt-subscription): Error: Set DSH_CHATGPT_VAULT_PASSWORD to a private
#   passphrase of at least 16 characters in the CLI and DSH launch environment.
```

同一 profile **设置口令后启动：无激活告警**（插件加载并注册 provider）。说明白：崩溃点在 `apply` 里 `new ChatGPTAdapter()` → `new Vault()` → `password()` 抛错，而不是 boot 加载失败。

桌面 App 从 Finder 启动拿不到终端环境变量，因此用户永远看不到 `ChatGPT subscription`，只有一行易被忽略的 boot warning。

**修复（建议，按小到大）：**
1. **懒加载**（必须）：`ChatGPTAdapter` 不接收 `new Vault()`，改为首次使用时创建（或 getter 缓存）；`apply` 永远不抛。缺凭据时错误在 `listModels`/`resolveModel` 抛出，GUI 模型列表里能看到明确提示（"未登录 / 缺少 vault 口令"），而不是 provider 消失。
2. **口令来源扩展**（建议）：解析顺序 `config.passphraseFile` → `$DSH_CHATGPT_VAULT_PASSWORD` → 默认 `~/.config/dsh-chatgpt-subscription/passphrase`（0600 校验）→ keychain（后续）。给出可操作错误文案。
3. **放开配置**（建议）：当前 `apply` 明确拒绝任何 config（`src/index.js` L5），导致无法补配置。最小改法：不导出 `Config`，`apply` 接受并校验白名单字段（`passphraseFile`、`vaultPath`、`contextWindow`/`models`，见 H3）；若追求校验，导出原生 Schemastery `Config`（注意 DSH 要求 native Schemastery schema，否则 entry 会 `unsupported`）。
4. README 写清：桌面 App 必须从终端启动（或改用 `dsh web`），并给"如何确认插件已激活"的自检命令。

**验收：**
- 未设口令启动：无 `did not activate` 告警；模型选择器能看到 provider；选择时得到可操作错误；日志无 token。
- 设了口令 + 未登录：同样得到"先登录"的可操作错误（当前已有）。
- 设了口令 + 已登录：正常列出模型（需要真实账号，见 §8）。

---

## 4. P1 真实使用会踩的问题

### H1. 并发凭据锁：fail-closed + 锁内网络 + 每请求写盘（已实测复现）

**实测（直接调用 `Vault`）：**

```
first write OK
slow   fulfilled
fast   rejected: Vault busy. Retry after the other operation completes; ...
read-only transaction rewrote file: true
```

**根因：**
- `Vault.transaction`（`src/vault.js` L45-61）用 `mkdir` 做跨进程互斥，`EEXIST` 时**立即抛错**，不等待/不退避；
- `transaction` 即使只读也重写整个加密文件（L53-60）；
- `accessSession`（`src/auth.js` L96-113）把 **refresh 网络请求放在锁内**，最坏 120s；
- 一次 LLM 请求会多次触发：`prepareCall`→`accessSession`（一次）、dispatch 前校验（`src/adapter.js` L30，再一次）、`resolveModel`/`listModels`→`accessSession`（再各一次）；
- DSH 一个 turn 内会并发多个 LLM 调用（会话标题、compaction 摘要、子 agent、agent-team），锁冲突概率不低；刷新期间并发请求必然全部失败。

**修复（建议）：**
1. 进程内加 Promise 队列串行化 `transaction`（同一进程内请求排队，而不是互相报错）；
2. 跨进程保留 fail-closed 语义但有界重试（如 3 次、50-200ms 退避），错误信息保留"确认无进程后可删锁"；
3. refresh 改为两段式（避免长锁）：
   - 锁内：读 state，判断是否将过期；记录 `{clientId, refreshToken, subject, accessToken}`；
   - 释放锁 → 网络 refresh；
   - 再拿锁：重读 state；若 `accessToken` 已被其他请求/进程替换 → 直接使用新值（丢弃本次结果，避免二次消费旋转 refresh token）；否则原子写回（CAS）；
4. 只读路径（dispatch 前校验、CLI `accounts`）改用无锁 `read()` 或新加 `snapshot()`，**不写盘**；
5. dispatch 前校验改为比较 `clientId`+`subject`（或 refresh 链标识），不要比较 `accessToken` 精确值，否则别的进程正常轮换会被误判为"账号已切换"（`src/adapter.js` L30-31）。

**验收（可自动化）：**
- 20 个并发 `accessSession` / `prepareCall` 全部成功，无 `Vault busy`；
- 并发 + 模拟 refresh（可注入 fetcher 慢响应）时也全部成功；
- 只读操作后 vault 文件 `mtime` 不变；
- 保留 `test/security.test.js` 中"锁冲突报错"的跨进程语义测试（若修改锁语义，需同步更新该测试的意图）。

### H2. 120s 总超时套住流式推理（代码确认，实测需 mock）

`src/auth.js` L63：

```js
AbortSignal.any([init.signal, AbortSignal.timeout(120000)])
```

`AbortSignal.timeout` 覆盖整个 fetch 生命周期，**包括流式 body 的读取**。agent 写代码/长生成超过 2 分钟会被中断，错误被归一成 `OpenAI network request failed.`。这不是 DSH 的取消策略（DSH 通过 `options.signal` 控制）。

**修复（建议）：**
- `officialFetch(url, init, fetcher)` 增加可选 `timeoutMs`，默认**不对 `/responses` 加超时**，只依赖 `init.signal`；
- `TOKEN`/`REVOKE`/`JWKS` 保留 120s；`/models` 用较短超时（如 30s）；
- 把默认值导出为常量或参数，便于测试用 50ms 超时 + 慢 mock 断言"流式响应不被内部 deadline 中断"；
- 保持 `redirect:'error'` 与端点白名单不变。

**验收：** 单元测试：注入 `timeoutMs` 很小的 `officialFetch`，用慢速 SSE mock 断言 `/responses` 不被内部 timeout 中断；`/models` 超时仍报错。

### H3. 缺少 `context.contextWindow`：自动压缩失效 + 溢出无法恢复

`src/adapter.js` L16-21 的 `resolveModel` 返回里没有 `context`。DSH `compaction-basic` 每个 `agent/pre-step`：

```
compaction-basic: no context capacity for chatgpt-subscription/<model>; configure contextWindow on that adapter model
```

该错误被 catch 成 warn（每个 target 只告警一次）→ **自动压缩永久不执行**；长会话撞到模型上限后，`src/protocol.js` L115 把 400 归一成 `OpenAI inference failed (HTTP 400)`，DSH 认不出 `CONTEXT_WINDOW_EXCEEDED`，连 overflow 恢复（`agent/request-error` 分支）也进不去 → 会话直接坏。

**修复（建议）：**
1. `resolveModel` 与 `prepareCall` 返回 `context: { contextWindow }`（整数、>0）。来源优先级：config 的 per-model 映射 > 模型目录字段（若 OpenAI 返回）> 文档化默认值（默认值必须写进 README，不能让用户猜）；
2. 同时返回 `defaultMaxTokens`（可选）有助于 compaction 预留 completion tokens；
3. 映射错误码：用 `@deepseek-ai/dsh-llm` 的 `isContextWindowExceededError(detail)` + `LlmError` + `CONTEXT_WINDOW_EXCEEDED_CODE` 把 400 报成可恢复错误；额度类 `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable` 至少保留 code（见 M3）；
4. 在 `listModels` 的 description 或 README 说明上下文窗口来源，避免用户误判。

**验收：**
- `resolveModel` 返回合法 `context`（新增断言）；
- 启动后不再出现 `no context capacity` 告警；
- 模拟 context-length 400（mock fetcher）→ 得到 `CONTEXT_WINDOW_EXCEEDED`，且 DSH 走 overflow 恢复路径。

---

## 5. P2 改进项

- **M1 重试策略形状**：`src/adapter.js` L9 返回扁平的 `initialDelayMs/maxDelayMs/jitterRatio`，契约要求 `backoff: { initialDelayMs, maxDelayMs, jitterRatio }`。当前 `maxRetries: 0` 使 `backoff` 不被读取，属潜在炸弹。修：

```js
providerRetryPolicy() {
  return { mode: 'normal', maxRetries: 0, retryableCodes: ['SERVER'],
           backoff: { initialDelayMs: 500, maxDelayMs: 1000, jitterRatio: 0 } };
}
```
  并加形状断言（对照 `ResolvedRetryPolicy`）。

- **M2 目录缓存**：`prepareCall`/`resolveModel` 每次都 `GET /models` 并 `accessSession`；按 `clientId + accessToken` 缓存 60s，显著降低延迟与 H1 冲突面。注意账号切换时要失效。
- **M3 错误信息**：HTTP 状态错误目前丢弃 provider 错误体（安全考虑合理），但可只提取 `error.code`/`error.type` 做映射，不打印原文；`response.failed` 的未知 code 目前被吞成 `OpenAI response failed.`，建议附上 code（code 非敏感）。
- **M4 `response.incomplete`**：`response.incomplete`（如 `max_output_tokens`）目前直接抛错。建议区分：截断可考虑 `finish: { kind: 'max-tokens' }`（`FinishReasonMap` 支持），或至少给出明确可诊断错误。
- **M5 CLI 诊断**：`src/cli.js` L72 把所有异常吞成一句通用文案。建议按阶段包装（回调/交换/验签/scope/网络），只输出脱敏 code 与阶段，绝不打印 token/URL。
- **M6 文档与安装路径**：README L32-36 写 `--profile web`，本机实际 profile 是 `desktop`；给出两套路径（`dsh web` 场景 vs Desktop App 场景）与重启要求（安装后需重启 App 才加载新 bundle）。
- **D1 仓库可访问性**：GitHub URL 404，确认私有/未推送后再对外交付。
- 其它（低优先，评审已记录但不阻塞）：`responseChunks` 对空文本块、并行 tool call、usage 一致性校验较严，真实账号验证时留意误报；tool 结果 `isError` 未透传；模型 description 含用户 email（隐私展示，建议明确取舍）。

---

## 6. 测试与验证计划（交给实现 agent）

### 6.1 需要新增/调整的自动化测试

1. **版本矩阵**：当前测试图固定 `@deepseek-ai/dsh-llm@0.2.2-alpha.3`。默认应改为宿主实际版本 `0.2.1-rc.5`（devDependency 或 CI 显式安装），并保留 0.2.2-alpha.3 的 job。注意 `node_modules` 里现有安装是 alpha（本机）。
2. **激活不依赖 env**：`test/runtime.test.js` L51-66 目前先设置 env；新增用例：不设 env 时 `apply` 成功、`listProviders()` 含 provider、`listModels` 报可操作错误。
3. **并发/锁**：并发 `transaction`/`accessSession` 全部成功；只读不写盘；跨进程仍 fail-closed（更新 `test/security.test.js` 相应意图）。
4. **流式超时**：可注入 timeout 的 `officialFetch` 测试（见 H2 验收）。
5. **context metadata**：`resolveModel` 返回合法 `context`；非法值被拒（DSH `normalizeModelInfo` 会校验 `contextWindow` 是正整数）。
6. **重试策略形状**：对照 `ResolvedRetryPolicy`。
7. **错误码映射**：mock 400 context-length → `CONTEXT_WINDOW_EXCEEDED`。

### 6.2 用隔离 DSH_HOME 做端到端冒烟（不碰用户 profile）

```sh
rm -rf /tmp/dsh-review
DSH_HOME=/tmp/dsh-review dsh plugin --profile probe add file:/Users/keyee/Projects/dsh-chatgpt-subscription
DSH_HOME=/tmp/dsh-review dsh --profile probe --dump-config | grep -n -A2 chatgpt
DSH_HOME=/tmp/dsh-review dsh --profile probe --help          # 期望：无 "entry did not activate"
DSH_HOME=/tmp/dsh-review DSH_CHATGPT_VAULT_PASSWORD=... dsh --profile probe --help
```

> 注意：`file:` 安装是软链，运行时 import 会命中本仓库 `node_modules`。若计划发布，请额外用 `npm pack` 产物安装一次，验证 peer 解析（DSH 有 runtime package resolution，但需实测确认）。

### 6.3 真实账号人工清单（自动化不了，必须由人做）

- [ ] `node src/cli.js login` 完整走通（新注册 + 回调带 client_id + 验签 + scope）；
- [ ] `accounts` / `select` / 重新授权 / `logout`（撤销确认与否的文案）；
- [ ] 模型目录非空、顺序保持、picker 中显示；
- [ ] 纯文本对话；
- [ ] **多轮工具循环**（这是最大未验证风险：`store:false` 且不回放 reasoning items 时，推理模型可能要求 `include:["reasoning.encrypted_content"]` 并回放 reasoning；交接时未提交的 `src/replay.js` 已按这个方向实现，仍需真实账号验证；若仍 400，按 replay 链继续排查）；
- [ ] 单次响应 >2 分钟（验证 H2 修复）；
- [ ] 长会话触发自动压缩（验证 H3）；
- [ ] 触发额度错误，确认文案与错误码；
- [ ] 并发场景：同一 turn 内子 agent / 标题生成同时请求（验证 H1 修复）。

---

## 7. 明确不要改的部分（已验证正确，回归时重点保护）

1. **OpenAI 协议常量与流程**（与官方文档逐条一致，见 §9）：
   - 端点：`auth.openai.com/api/accounts/authorize`、`/api/accounts/oauth/token`、`/api/accounts/oauth/revoke`、`/.well-known/jwks.json`、`api.openai.com/v1/models`、`/v1/responses`；
   - 参数：`client_id=dynamic_agent_client` + `ext_agent_host_id` + `agent_name_hint`（仅首次）、`id_token_hint`（重新授权）、`resource=https://api.openai.com/v1`、scope 组合、`code_challenge_method=S256`；
   - 回调：可缺省 `client_id`（重新授权）但新注册必须有；state 校验先于 code 交换；错误回调不消费 attempt；
   - refresh：`grant_type=refresh_token` + `client_id` + `resource`，**不带 scope**；旋转 refresh token 与 scopes 一起写回；
   - revoke：`token` + `token_type_hint=refresh_token` + `client_id`，200 即成功（含已失效 token）；
   - 模型目录：过滤 `visibility === "list"`，使用 `slug` / `display_name`，保持服务端顺序；
   - 推理：`store:false`、`stream:true`，仅 `response.completed` 视为成功，处理 `response.failed` 的 `subscription_sharing_usage_limit_exceeded` / `subscription_sharing_usage_unavailable`，拒绝 `response.incomplete`。
2. **安全不变量**：PKCE/state/nonce 每次新生成；JWKS RS256 + iss/aud/azp/exp/iat/nbf/nonce/sub 校验；固定端点白名单与 `redirect:'error'`；AES-256-GCM + scrypt + 每次新 salt/IV + 原子 rename + 0700/0600 + 拒绝符号链接；跨进程锁；日志/错误不打印 token、Authorization URL、回调 URL；CLI 不输出 token；拒绝 endpoint 覆盖（不要为了"方便"加自定义 baseURL）。
3. **工具链**：`npm test`（基线 33 用例；交接时工作树 55 用例全绿）与 `npm run check` 必须保持通过；新增用例不得削弱现有安全用例的意图。

---

## 8. 已知无法在开发环境验证的事项（如实声明，不要写成"已验证"）

- 真实 ChatGPT 登录、订阅 eligibility、额度/credits 与共享限制；
- token 实际形状/旋转、真实 `id_token` claim 组合；
- 工具循环与长推理的可靠性（尤其是 reasoning 回放问题，见 §6.3）；交接时未提交的 `src/replay.js` 已实现 `encrypted_content` 回放方向，但**尚未真实验证**，不要写成"已验证"；
- 桌面 App 的视觉呈现（provider 分组、模型描述展示）；
- Windows ACL / 非 macOS 权限与浏览器行为（当前仅 macOS 验证）。

---

## 9. 参考依据

- OpenAI 官方文档（评审时逐条核对，2026-11-03）：
  - [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
  - [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
  - [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
  - [OIDC 元数据](https://auth.openai.com/.well-known/openid-configuration)
- DSH 宿主源码（本机安装 0.2.1-rc.5）：
  - `@deepseek-ai/dsh-app-boot`：`evaluatePluginCompatibility`（`engines.dsh` 独占判定、豁免键为 `包名@版本` + 精确 runtime 版本）、runtime package resolution；
  - `@deepseek-ai/dsh-plugin-manager`：安装前预检拒绝、`pluginCompatibilityWarning`；
  - `@deepseek-ai/dsh-llm`：`LlmAdapter` 契约、`normalizeModelInfo` 校验（provider/id/name 必填，`context.contextWindow` 正整数）、`ResolvedRetryPolicy`（`backoff` 嵌套）、`FinishReasonMap`（`max-tokens`）、`LlmError(message, code, {status, cause})`、`isContextWindowExceededError` / `isQuotaExceededError`、`attributionHeaders()` 返回 `user-agent`；
  - `@deepseek-ai/dsh-compaction-basic`：`agent/pre-step` 依赖 `resolveModelInfo().context.contextWindow`，缺失则 warn 并跳过；
  - `@deepseek-ai/dsh-agent-loop`：不传 `temperature`/`stop`（因此当前 `requestBody` 的拒绝逻辑不会被触发，但也别依赖它）。
- 本仓库：`README.md`、`SECURITY.md`、`VALIDATION.md`（既有声明需随修复同步更新，尤其是"精确版本门禁""120 秒总超时""插件拒绝一切配置"等表述）。

---

## 10. 建议的提交顺序

1. **PR-1（解锁）**：B1 版本范围 + B2 懒加载 Vault（+ 可选口令文件）+ README 安装/启动说明；验收：隔离 DSH_HOME 下未设口令也能激活，装上后能登录列模型。
2. **PR-2（可用性）**：H1 锁串行化/CAS/只读不写盘 + H2 超时拆分；验收：并发与长流测试。
3. **PR-3（长会话）**：H3 contextWindow + 错误码映射 + M1 形状修复；验收：compaction 告警消失、overflow 恢复路径可触发。
4. **PR-4（打磨）**：M2-M6、D1、文档更新、测试矩阵与真实账号清单执行记录回填 `VALIDATION.md`。
