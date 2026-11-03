# DSH ChatGPT subscription

[English](README.md) | **简体中文**

使用 OpenAI 官方 **Sign in with ChatGPT**，让 DeepSeek Harness 的 agent 循环通过公共 Responses API 使用符合条件的 ChatGPT 订阅额度。独立实现；非 OpenAI 或 DeepSeek 官方插件。没有读取 Codex/ChatGPT 现有凭据，也不使用 `backend-api` 私有接口。

**状态：本地开发预览。** 已完成离线协议、安全和实际 DSH LLM 运行时的模拟请求测试；尚未用真实账号登录、消耗订阅额度、安装进用户 DSH，或验证桌面界面。不能据此宣称可用额度或生产可用。

## 支持范围

- Node.js 22+；DSH **0.2.2-alpha.3**，精确版本门禁。
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
| OpenAI 网页搜索 | 可选，配置 `webSearch: true`；实际可用性仍取决于模型、账号和工作区策略。 |
| 音频/视频输入及转录 | 官方文档中的这条订阅路线暂不支持。 |
| 其他托管工具 | 官方路线暂不支持图像生成、文件搜索、Code Interpreter、原生 computer use、托管 MCP/connectors 及 `tool_search`；DSH 本地工具是另一类能力。 |
| `temperature` 与 `stop` | 明确报错：订阅路线排除 temperature；Responses 没有原生 stop 序列字段。 |
| 输出 token 上限 | 路线不接受 `max_output_tokens`，因此不转发 `maxTokens`，**它不是实际生效的上限**。 |

以上区分依据[官方订阅预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)，不代表所有 OpenAI 模型或独立付费 API 的能力。插件没有配置其他计费端点。

图片使用 DSH 规范化后的 PNG/JPEG/WebP/非动画 GIF 附件，以内联 data URL 发送；插件不会下载任意图片 URL，也不会打开用户传入的路径。由宿主生成最长边不超过 4096 像素、单张编码目标 8 MiB 的预览；每次请求最多保留 16 个图片出现次数、20 MiB base64 图片数据。历史超限时通过 DSH 的机制卸载最旧图片，明确提供“图片已省略”的占位信息。宿主规范化可能改变格式和尺寸，缩小预览可能损失小字细节。宿主需提供 `attachments.readImageRequest`。

账号模型目录明确声明仅文本时，DSH 会把图片投影为占位文字；目录未提供模态信息时，插件保留“未知”，允许提交图片，由模型/API 决定是否接受。模型出现在列表中不等于保证支持视觉。

加密 reasoning 保持不透明，不解密，也不从可见文字伪造隐藏推理。历史内容编辑或压缩后，回退为可见文本/工具历史。原生重放状态保存在 DSH 会话日志中，与加密 OAuth 凭据库分开。真实订阅请求和长期工具循环仍需实测。

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

先核对 `dsh --version`；不匹配时先评估接口差异，不要通过版本豁免强行加载。为用户自己的 web profile 安装本地目录的参考命令如下；也可在 DSH 插件管理器添加本地 bundle。安装会改变该 profile，本次开发没有执行此步骤。

```sh
dsh plugin --profile web add "file:$HOME/Projects/dsh-chatgpt-subscription"
```

在启动 CLI 和 DSH 的**同一个终端环境**设置强口令。macOS 默认 zsh 可隐藏读取，避免把口令字面量写入 shell 历史：

```zsh
read -rs 'DSH_CHATGPT_VAULT_PASSWORD?Vault passphrase (16+ characters): '
export DSH_CHATGPT_VAULT_PASSWORD
printf '\n'
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login
# 同一终端启动已配置好本地插件的 DSH：
dsh web
```

请使用随机且足够长的独立口令；16 字符只是最低检查，不能保证口令强度。不要把口令写进仓库、`.env`、profile 配置或聊天。GUI 启动的 DSH 通常不会继承终端变量，此版本需要从上述终端启动。口令必须保持一致；遗忘后无法解密，需在 ChatGPT 撤销连接后重新建立本地凭据。默认凭据位置：`~/.config/dsh-chatgpt-subscription/accounts.vault`。

CLI 会打开系统浏览器，提示 **Continue with ChatGPT**。在 OpenAI 页面核对账号、工作区、授权项与额度设置；插件不会自动开启 credits 或自动购买。授权地址可能带有仅发给 OpenAI 的 `id_token_hint`，因此不输出到终端。只在真实身份验证完成后激活账号；初次注册返回的 client ID 会先保存，以便授权码过期后重试。

```sh
node ~/Projects/dsh-chatgpt-subscription/src/cli.js accounts
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login --new
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js select oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js logout
node ~/Projects/dsh-chatgpt-subscription/src/cli.js usage
```

`accounts` 中 `*` 表示当前账号；切换后刷新 DSH 模型列表，选择 `ChatGPT subscription` provider 下该账号可见的模型。账号信息显示在模型说明及 CLI 中，不把令牌发给 DSH 前端。`logout` 会尝试撤销 refresh token，然后清除本地令牌，保留 client/account 映射与 host ID；撤销未确认时明确提示到 ChatGPT 设置中断开连接。

账号 eligibility、模型、额度和 credits 可用性取决于 OpenAI 当前政策及实际授权返回，不保证每个订阅可用。额度与 ChatGPT/Codex 其他用量可能共享；遇到限额不自动重试，不自动切到 API 账单。管理额度：<https://chatgpt.com/settings/usage>。

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
- DSH 官方源码快照 [`8bd073392eef6f54e921a093b95076248eb08cbb`](https://github.com/deepseek-ai/deepseek-harness/tree/8bd073392eef6f54e921a093b95076248eb08cbb)，重点核对 `packages/llm/llm/src` 接口；实际兼容测试使用 npm 官方包 `@deepseek-ai/dsh-llm@0.2.2-alpha.3`。

该项目未复制此前审查的社区插件源码，不需要该社区项目的凭据或客户端身份。协议事实和接口来自上述官方来源。
