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

当前插件只向 DSH 声明文本输入能力，尚未实现图片附件读取和 Responses 图片输入转换，因此不能进行图片视觉分析。**这是本插件首版的实现范围，不代表 ChatGPT 订阅或所有可用模型只支持文本。** DSH 会按文本能力投影附件，这不等同于视觉支持。图片支持仍需模型能力核对、附件传输实现及测试。当前也不支持音频、OpenAI 托管工具、reasoning 原生状态重放、stop 序列及 temperature；不支持的输入明确报错。推理摘要不向 DSH 输出，历史推理文本不伪造为模型原生 reasoning。需要长推理的工具链可靠性仍须真实环境验证。

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

## 安全边界与依赖

详见 [SECURITY.md](SECURITY.md)。加密保护静态凭据文件，无法防御同一用户权限下恶意代码、读取进程环境/内存的攻击者或不可信 DSH 插件。Windows 的 POSIX mode 不能代替 NTFS ACL，未验证 Windows/Linux 的权限和浏览器行为；本轮验证平台是 macOS。

DSH 的固定版本依赖 Zod 4.4.3，命中 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)（大集合验证内存耗尽）。本仓库开发依赖图通过 root `overrides` 固定 Zod 4.6.6，审计为 0；**作为插件安装时，依赖包的 overrides 不会修复宿主 DSH 的依赖图**。正式安装前需要宿主维护者评估并升级该依赖；不要把本仓库 `npm audit` 结果当作整个 DSH 的审计。

## 实现依据

核对日期：2026-11-03。

- [官方注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [官方账号、会话和刷新](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [官方模型发现与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI OIDC 公共元数据](https://auth.openai.com/.well-known/openid-configuration)
- DSH 官方源码快照 [`8bd073392eef6f54e921a093b95076248eb08cbb`](https://github.com/deepseek-ai/deepseek-harness/tree/8bd073392eef6f54e921a093b95076248eb08cbb)，重点核对 `packages/llm/llm/src` 接口；实际兼容测试使用 npm 官方包 `@deepseek-ai/dsh-llm@0.2.2-alpha.3`。

该项目未复制此前审查的社区插件源码，不需要该社区项目的凭据或客户端身份。协议事实和接口来自上述官方来源。
