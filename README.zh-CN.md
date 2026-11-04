# DSH ChatGPT subscription

[English](README.md) | **简体中文**

使用 OpenAI 官方 **Sign in with ChatGPT**，让 DeepSeek Harness 的 agent 循环通过公共 Responses API 使用符合条件的 ChatGPT 订阅额度。独立实现；非 OpenAI 或 DeepSeek 官方插件。没有读取 Codex/ChatGPT 现有凭据，也不使用 `backend-api` 私有接口。

**状态：已可用，已通过 macOS 真实 ChatGPT 账号验证（更新于 2026-11-04）。** 插件已在 DSH Desktop 配置完成，用户已确认正在通过本插件进行实际对话。官方登录、按账号的模型目录、流式文本、带 reasoning 回放的函数工具往返、图片输入、令牌刷新、思考强度选择及可选托管网页搜索均已进行真实账号验证；设置 → 模型页面提供启用/禁用卡片。Windows/Linux 行为仍未验证；账号资格、可用模型与额度上限仍取决于 OpenAI 政策与具体账号。已测范围及剩余验证边界详见 [VALIDATION.md](VALIDATION.md)。

## 支持范围

- Node.js 22+；DSH 任意 **0.2.x**（`>=0.2.1-rc.5 <0.3.0`）。adapter 接口已在 0.2.1-rc.5、0.2.2-alpha.3、0.2.2-rc.1 上验证；其他 0.2.x 运行时仍会激活，只在日志中提示"未验证运行时"，不会因此被跳过。
- 按账号获取模型目录，不硬编码模型；文本对话、函数工具调用、工具结果、流式文本与用量统计。
- 多个账号/工作区注册、选择、重新授权、刷新、登出与会话撤销。
- 授权码 + PKCE S256、随机 state/nonce、JWKS RS256 验签、issuer/audience/expiry/nonce/subject 校验。
- 凭据采用 AES-256-GCM 加密，scrypt 派生密钥；目录 0700、文件 0600、原子替换、跨进程互斥锁。
- 固定 HTTPS 官方端点，拒绝 HTTP、自定义网关和重定向；无埋点、无自动付费兜底、无推理自动重试。

### 能力状态

| 能力 | 当前行为 |
| --- | --- |
| 文本与本地函数工具 | 已支持，函数工具分组在 `dsh` namespace 下。 |
| 图片输入 | 已支持用户附件及函数工具返回的图片，通过 DSH 附件服务读取。 |
| reasoning 原生重放 | 仅在账号、provider、模型及可见内容未变化时，重用成功响应中的原生输出与加密 reasoning。 |
| 思考强度（reasoning effort） | 按模型从目录的 `supported_reasoning_levels` 暴露为可选档位，并预选该模型目录默认值；只提供本路由接受的档位，目录额外标称的 `ultra` 会被过滤（路由返回 400）。 |
| 启用/禁用开关 | **设置 → 模型** 页底部的卡片可在不重启的情况下启用/禁用本 provider：禁用会注销 adapter，对话的模型选择器不再加载它（适合 `api.openai.com` 不通时）。选择保存在插件条目的 volatile `enabled` 字段。 |
| OpenAI 网页搜索 | 可选，配置 `webSearch: true`；实际可用性仍取决于模型、账号和工作区策略。 |
| 音频/视频输入及转录 | 官方文档中的这条订阅路线暂不支持。 |
| 其他托管工具 | 官方路线暂不支持图像生成、文件搜索、Code Interpreter、原生 computer use、托管 MCP/connectors 及 `tool_search`；DSH 本地工具是另一类能力。 |
| `temperature` 与 `stop` | 明确报错：订阅路线排除 temperature；Responses 没有原生 stop 序列字段。 |
| 输出 token 上限 | 路线不接受 `max_output_tokens`，因此不转发 `maxTokens`，**它不是实际生效的上限**。 |

以上区分依据[官方订阅预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)，不代表所有 OpenAI 模型或独立付费 API 的能力。插件没有配置其他计费端点。

图片使用 DSH 规范化后的 PNG/JPEG/WebP/非动画 GIF 附件，以内联 data URL 发送；插件不会下载任意图片 URL，也不会打开用户传入的路径。由宿主生成最长边不超过 4096 像素、单张编码目标 8 MiB 的预览；每次请求最多保留 16 个图片出现次数、20 MiB base64 图片数据。历史超限时通过 DSH 的机制卸载最旧图片，明确提供“图片已省略”的占位信息。宿主规范化可能改变格式和尺寸，缩小预览可能损失小字细节。宿主需提供 `attachments.readImageRequest`。

账号模型目录明确声明仅文本时，DSH 会把图片投影为占位文字；目录未提供模态信息时，插件保留“未知”，允许提交图片，由模型/API 决定是否接受。模型出现在列表中不等于保证支持视觉。

加密 reasoning 保持不透明，不解密，也不从可见文字伪造隐藏推理。历史内容编辑或压缩后，回退为可见文本/工具历史。原生重放状态保存在 DSH 会话日志中，与加密 OAuth 凭据库分开。长期工具循环与账号相关的额度上限仍需持续实测。

## 开发验证

```sh
cd ~/Projects/dsh-chatgpt-subscription
npm ci --ignore-scripts
npm test
npm run check
npm audit
npm pack --dry-run --ignore-scripts
```

没有 install/postinstall/prepare 构建脚本，无新增常规运行时依赖；运行时使用宿主提供的 `@deepseek-ai/dsh-llm`。锁文件用于复现实验环境。未发布 npm 包，`private: true` 防止误发布。

## 本地使用（需用户自己完成真实登录）

先核对 `dsh --version`；不匹配时先评估接口差异，不要通过版本豁免强行加载。为用户自己的 web profile 安装本地目录的参考命令如下；也可在 DSH 插件管理器添加本地 bundle。安装会改变该 profile；开发验证只使用临时 `DSH_HOME`，没有修改日常用户配置。

```sh
# CLI/web 使用：
dsh plugin --profile web add "file:$HOME/Projects/dsh-chatgpt-subscription"
# Desktop App：先完全退出应用，安装后重新打开：
dsh plugin --profile desktop add "file:$HOME/Projects/dsh-chatgpt-subscription"
```

选择实际使用的 profile。重启后核对 provider 已注册；未登录时模型发现会提示缺少凭据或需要登录。激活插件本身不需要口令，也不会自动打开授权页面。

在启动 CLI 和 DSH 的**同一个终端环境**设置强口令。macOS 默认 zsh 可隐藏读取，避免把口令字面量写入 shell 历史：

```zsh
read -rs 'DSH_CHATGPT_VAULT_PASSWORD?Vault passphrase (16+ characters): '
export DSH_CHATGPT_VAULT_PASSWORD
printf '\n'
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login
# 同一终端启动已配置好本地插件的 DSH：
dsh web
```

请使用随机且足够长的独立口令；16 字符只是最低检查，不能保证口令强度。不要把口令写进仓库、`.env`、profile 配置或聊天。GUI 启动的 DSH 通常不会继承终端变量，可使用下述私有口令文件，或从上述终端启动。口令必须保持一致；遗忘后无法解密，需在 ChatGPT 撤销连接后重新建立本地凭据。默认凭据位置：`~/.config/dsh-chatgpt-subscription/accounts.vault`。

CLI 会打开系统浏览器，提示 **Continue with ChatGPT**。在 OpenAI 页面核对账号、工作区、授权项与额度设置；插件不会自动开启 credits 或自动购买。授权地址可能带有仅发给 OpenAI 的 `id_token_hint`，因此不输出到终端。只在真实身份验证完成后激活账号；初次注册返回的 client ID 会先保存，以便授权码过期后重试。

```sh
node ~/Projects/dsh-chatgpt-subscription/src/cli.js accounts
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login --new
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js select oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js logout
node ~/Projects/dsh-chatgpt-subscription/src/cli.js usage
```

`accounts` 中 `*` 表示当前账号；切换后刷新 DSH 模型列表，选择 `ChatGPT subscription` provider 下该账号可见的模型。账号信息显示在模型说明及 CLI 中，不把令牌发给 DSH 前端。`logout` 先清除本地令牌，再在状态锁之外尝试远程撤销，保留 client/account 映射与 host ID；撤销未确认时明确提示到 ChatGPT 设置中断开连接。

账号 eligibility、模型、额度和 credits 可用性取决于 OpenAI 当前政策及实际授权返回，不保证每个订阅可用。额度与 ChatGPT/Codex 其他用量可能共享；遇到限额不自动重试，不自动切到 API 账单。管理额度：<https://chatgpt.com/settings/usage>。

## 桌面口令与上下文配置

GUI 启动可使用仓库之外的私有目录（0700）和仅本人可读写的普通口令文件（0600）。默认文件为 `~/.config/dsh-chatgpt-subscription/passphrase`，内容为单行强口令，可带一个结尾换行。插件不会自动创建该文件或生成口令。文件方案方便 GUI 启动，但解密秘密也保存在磁盘上，**不是系统钥匙串**，无法防御同一系统用户同时读取两份文件。

口令来源优先级：插件 `config.passphraseFile` → `DSH_CHATGPT_VAULT_PASSWORD` → `DSH_CHATGPT_VAULT_PASSWORD_FILE` → 默认私有文件。显式指定的来源无效时直接报错，不静默换来源。路径必须为绝对路径或以 `~/` 开头，拒绝口令文件软链接。CLI 使用相同默认文件或上述环境变量；若 Desktop 配置了自定义路径，运行 CLI 时用 `DSH_CHATGPT_VAULT_PASSWORD_FILE`、`DSH_CHATGPT_VAULT_PATH` 指向同一位置。不要在 DSH 配置中写入口令本身。

现有插件条目可选配置示例：

```yaml
config:
  enabled: true
  passphraseFile: ~/.config/dsh-chatgpt-subscription/passphrase
  vaultPath: ~/.config/dsh-chatgpt-subscription/accounts.vault
  contextWindow: 32768
  modelContextWindows:
    YOUR_MODEL_SLUG: 32768
```

示例数值应按所选模型实际容量调整。容量来源依次为：单模型覆盖 → 全局配置 → 模型目录的 `context_window` → **32768 token 估计值**。回退值只是保守预算，不代表服务端容量保证；模型说明会标注来源。DSH 可据此自动压缩上下文；服务端上下文溢出会映射为可恢复错误码。这里没有承诺输出 token 上限。

模型目录缓存 60 秒，并发发现共享请求；账号、登录会话或 token 变化时失效。普通凭据读取不加锁、不写盘；刷新使用独立的跨进程刷新锁，网络请求不占用状态写锁。锁竞争最多等待 130 秒，绝不自动抢占。流式推理不设内部总时长上限，由 DSH 的取消信号控制；模型目录超时 30 秒，token/撤销/JWKS 请求超时 120 秒。不完整响应会报告原因，不会被当成已完成的工具调用。

## 启用或禁用（设置 → 模型）

打开 **设置 → 模型**，页面底部有 **ChatGPT 订阅** 卡片，开关会即时注册或注销本 provider。`api.openai.com` 不通时（例如还没开代理）先禁用：对话的模型选择器就不会再查询或显示该 provider；代理就绪后再打开。禁用后，正在使用该模型的会话需要改选其他模型。开关通过 DSH 设置文档写入插件条目的 volatile `enabled` 字段，无需重启。也可以在 `cordis.patch.yml` 的 `config.enabled` 里直接设置。

## 可选网页搜索

默认关闭网页搜索。在现有 `chatgpt-subscription` 插件条目的 DSH 配置中设置：

```yaml
config:
  webSearch: true
```

这是现有插件条目的 `config`，不是另加一个插件条目。开启后模型可调用 OpenAI 托管的 `web_search`，搜索查询由其托管工具处理，仍受账号策略和用量限制约束。返回的 URL 引用显示为来源链接。搜索不受支持或不可用时正常报错，不切换计费路线，也不开放其他托管工具。省略该字段或设为 `false` 即关闭；此处不能配置 API 地址或令牌。

## 安全边界与依赖

详见 [SECURITY.md](SECURITY.md)。加密保护静态凭据文件，无法防御同一用户权限下恶意代码、读取进程环境/内存的攻击者或不可信 DSH 插件。Windows 的 POSIX mode 不能代替 NTFS ACL，未验证 Windows/Linux 的权限和浏览器行为；本轮验证平台是 macOS。

DSH 的固定版本依赖 Zod 4.4.3，命中 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)（大集合验证内存耗尽）。本仓库开发依赖图通过 root `overrides` 固定 Zod 4.6.6，审计为 0；**作为插件安装时，依赖包的 overrides 不会修复宿主 DSH 的依赖图**。正式安装前需要宿主维护者评估并升级该依赖；不要把本仓库 `npm audit` 结果当作整个 DSH 的审计。

## 实现依据

核对日期：2026-11-03。

- [官方注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [官方账号、会话和刷新](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [官方图片输入](https://developers.openai.com/api/docs/guides/images-vision)
- [官方无状态 reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [官方模型发现与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI OIDC 公共元数据](https://auth.openai.com/.well-known/openid-configuration)
- DSH 官方源码快照 [`8bd073392eef6f54e921a093b95076248eb08cbb`](https://github.com/deepseek-ai/deepseek-harness/tree/8bd073392eef6f54e921a093b95076248eb08cbb)，重点核对 `packages/llm/llm/src` 接口；兼容测试分别使用 npm 官方包 `@deepseek-ai/dsh-llm@0.2.1-rc.5` 和 `@deepseek-ai/dsh-llm@0.2.2-alpha.3`。

该项目未复制此前审查的社区插件源码，不需要该社区项目的凭据或客户端身份。协议事实和接口来自上述官方来源。
