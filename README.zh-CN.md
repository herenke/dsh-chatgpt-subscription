# DSH ChatGPT subscription

[English](README.md) | **简体中文**

通过 OpenAI 官方 **Sign in with ChatGPT**，在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 中使用 ChatGPT 订阅。保留 DSH 的 agent 循环、本地工具和会话历史，推理请求通过公共 Responses API 发送。

这是独立社区项目，非 OpenAI 或 DeepSeek 官方插件。插件不会读取 ChatGPT/Codex 现有凭据，也不使用 `backend-api` 私有接口。使用需具备资格的账号，并受 OpenAI 的模型可用性、用量限制及[订阅路线限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)约束。

## 功能

- 按账号获取模型目录、流式响应和 token 用量统计。
- 本地函数工具，以及按账号和模型隔离的原生 reasoning 回放。
- 通过 DSH 附件服务输入图片。
- 根据账号目录选择各模型的思考强度。
- 可选 OpenAI 托管网页搜索，附来源链接。
- 多账号/工作区注册、账号切换、令牌刷新与登出。
- **设置 → 模型** 中的持久化启用/禁用开关。
- 本地加密凭据，无需 API key，不自动回退到独立付费 API。

## 环境要求

- Node.js **22 或更高版本**，以及已安装的 DSH CLI。
- DSH `>=0.2.1-rc.5 <0.3.0-0`。adapter 集成已在 `0.2.1-rc.5`、`0.2.2-alpha.3` 和 `0.2.2-rc.1` 测试；范围内其他版本会记录未验证运行时告警。设置卡片还依赖宿主的模型设置扩展位及配置表单服务。
- 具备资格的 ChatGPT 账号，以及用于授权的本地浏览器。
- **DSH 进程**能访问 `auth.openai.com` 和 `api.openai.com`。如果所在网络需要代理或 VPN，请在登录或启用 provider 前配置好；插件本身不配置代理。

真实账号测试平台为 macOS。Windows/Linux 集成尚未验证；未实现 Windows ACL 保护。详见[安全说明](SECURITY.md)和[测试说明](VALIDATION.md)。

## 安装

目前从源码安装，尚未发布 npm 包。

### 1. 获取源码

```sh
git clone https://github.com/herenke/dsh-chatgpt-subscription.git
cd dsh-chatgpt-subscription
npm ci --ignore-scripts
```

安装后请保留此目录。以下命令均假设终端位于仓库根目录。

### 2. 准备凭据并登录

macOS/Linux 可创建 CLI 与 GUI 启动的 DSH 共用的私有口令文件。仅为**新凭据库执行一次**：

```sh
mkdir -p "$HOME/.config/dsh-chatgpt-subscription"
chmod 700 "$HOME/.config/dsh-chatgpt-subscription"
(umask 077; set -C; openssl rand -base64 32 > "$HOME/.config/dsh-chatgpt-subscription/passphrase")
node src/cli.js login
```

命令需要 OpenSSL，且拒绝覆盖已有口令文件。已有凭据库必须继续使用原口令；生成新口令无法解锁旧库。此文件包含明文解密秘密，**不是系统钥匙串**，请勿提交或分享。威胁模型详见[安全说明](SECURITY.md)。

CLI 会打开浏览器，请在 OpenAI 页面核对账号、工作区、授权项及用量限制。凭据加密保存在 `~/.config/dsh-chatgpt-subscription/accounts.vault`。

也可以通过秘密管理环境向 CLI 与 DSH 同时提供 `DSH_CHATGPT_VAULT_PASSWORD`（至少 16 字符）。GUI 启动通常不会继承终端环境变量。不要把口令字面量写入 shell 历史、仓库文件、DSH 配置或 issue。

### 3. 安装到 DSH profile

按实际使用的 profile **选择一条**命令。安装到 Desktop profile 前请完全退出桌面应用，完成后重新打开：

```sh
# 桌面应用
dsh plugin --profile desktop add "file:$PWD"

# 或 CLI/web profile
dsh plugin --profile web add "file:$PWD"
```

CLI/web 使用 `dsh --profile web web` 启动相同 profile。自定义 profile 请同步替换安装和启动命令中的名称。

在对话模型选择器中选择 **ChatGPT subscription** 下的模型。激活插件不会自动打开浏览器或登录；未登录时，加载该 provider 的模型会提示凭据错误。

## 启用与禁用

打开 **设置 → 模型**，在页面底部找到 **ChatGPT 订阅** 卡片。

- **启用**：注册 provider，可加载其模型。
- **禁用**：注销 adapter，对话模型选择器不再加载该 provider。凭据会保留；禁用不等于登出。

开关持久化保存，无需重启 DSH 即可生效。切换后重新打开模型选择器；已有会话若使用该 provider，禁用期间需改选其他模型才能继续。禁用不保证取消已经发出的请求。

如果网络依赖代理，可在代理就绪前保持禁用，避免模型加载报错。

## 账号管理

在仓库根目录运行：

```sh
node src/cli.js accounts
node src/cli.js login --new
node src/cli.js login oaiapp_YOUR_SAVED_CLIENT_ID
node src/cli.js select oaiapp_YOUR_SAVED_CLIENT_ID
node src/cli.js logout
node src/cli.js logout oaiapp_YOUR_SAVED_CLIENT_ID
node src/cli.js usage
```

`accounts` 用 `*` 标记当前注册。`login --new` 添加账号/工作区；`login CLIENT_ID` 重新授权已有注册。切换后重新打开模型选择器，选择该账号可用的模型。账号身份会显示在 CLI 输出和模型说明中，但 OAuth token 不会发送到 DSH 前端。

`logout` 先清除本地 token，再尝试远程撤销；撤销未确认时，请到 ChatGPT 设置中断开应用连接。登出不会跨进程取消已发出的请求。用量可能与 ChatGPT/Codex 共享，管理入口：<https://chatgpt.com/settings/usage>。

## 配置

修改**已有** `chatgpt-subscription` 插件条目的 `config`，不要重复添加条目。可使用 DSH profile 配置编辑器或 profile 的 Cordis patch。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 注册 provider；可在设置 → 模型中实时修改。 |
| `webSearch` | `false` | 允许模型使用 OpenAI 托管 `web_search`。 |
| `passphraseFile` | 未设置 | 显式指定仅本人可读写的口令文件。 |
| `vaultPath` | 未设置 | 自定义加密凭据库位置。 |
| `contextWindow` | 未设置 | 全局上下文容量覆盖值，单位为 token。 |
| `modelContextWindows` | `{}` | 按模型 ID 设置上下文容量覆盖值。 |

```yaml
config:
  enabled: true
  webSearch: false
  # 可选：仅在需要自定义凭据路径时设置。
  # passphraseFile: ~/.config/dsh-chatgpt-subscription/passphrase
  # vaultPath: ~/.config/dsh-chatgpt-subscription/accounts.vault
```

仅 `enabled` 支持实时修改。其他字段修改后请重新加载插件或重启 DSH。此处不能配置端点或 token。

### 凭据位置

口令查找优先级：

1. `config.passphraseFile`
2. `DSH_CHATGPT_VAULT_PASSWORD`
3. `DSH_CHATGPT_VAULT_PASSWORD_FILE`
4. `~/.config/dsh-chatgpt-subscription/passphrase`

显式选中的来源无效时会报错，不会继续回退。口令文件必须包含至少 16 字符的单行口令，可带一个结尾换行。Unix 下请使用仅本人可访问的目录和普通文件（0700/0600）；拒绝软链接口令文件。

凭据库查找优先级为 `config.vaultPath` → `DSH_CHATGPT_VAULT_PATH` → 默认凭据库路径。自定义路径必须为绝对路径或以 `~/` 开头。CLI 不读取插件条目：GUI 使用自定义路径时，需向 CLI 提供对应的 `DSH_CHATGPT_VAULT_PASSWORD_FILE`、`DSH_CHATGPT_VAULT_PATH`，并避免相冲突的口令环境变量。

### 上下文容量

优先级为 `modelContextWindows[modelId]` → `contextWindow` → 目录的 `context_window` → 保守的 **32768 token 估计值**。只应根据模型实际支持的容量设置覆盖值。模型说明会标注来源，DSH 将其用于自动压缩；回退估计不是服务端容量保证。

### 网页搜索

设置 `webSearch: true` 可允许 OpenAI 托管搜索，实际可用性取决于所选模型和账号/工作区策略。查询由 OpenAI 处理，返回的 URL 引用显示为来源链接。此选项不会开放其他托管工具，也不会切换计费路线。

## 限制

- 此路线不支持音频/视频、转录、图像生成、文件搜索、Code Interpreter、原生 computer use、托管 MCP/connectors 及 `tool_search`。DSH 本地工具是独立能力。
- 拒绝 `temperature` 和非空 `stop` 序列。由于路线拒绝 `max_output_tokens`，不会转发 `maxTokens`；**插件不强制限制输出 token 数量**。
- 思考强度来自账号目录，并过滤为路线可接受的值。不会解密或伪造隐藏推理。
- 图片输入需要 `attachments.readImageRequest`。宿主将 PNG/JPEG/WebP/非动画 GIF 向最长边 4096 像素、单张编码数据 8 MiB 的目标规范化。adapter 每次请求最多保留 16 次图片出现、20 MiB base64 图片数据；超限历史通过 DSH 的图片卸载机制处理。缩放可能损失小字细节。
- 原生回放绑定账号、provider、模型及未变化的可见内容；编辑或压缩历史后回退为可见文本/工具历史。会话日志包含对话与回放数据，独立于加密凭据库。
- 不提供推理自动重试、自定义 API 端点或自动付费兜底。宿主级重试和工具策略由 DSH 负责。

## 故障排查

| 现象 | 检查方法 |
| --- | --- |
| `OpenAI network request failed` | 确认 DSH 进程可访问官方主机，检查 DNS、防火墙及代理/VPN；离线时禁用 provider。 |
| 缺少凭据或无法解锁 | 确认 CLI 与 DSH 使用同一凭据库及原口令，检查所有者、权限和路径覆盖。 |
| 安装/升级后 provider 消失 | 检查当前 profile、DSH 支持范围，重启 DSH 并检查插件激活日志；不要未经兼容性审查绕过版本要求。 |
| 账号/模型不可用 | 登录并确认订阅权限，选择正确注册，再重新打开模型选择器。模型目录最多缓存 60 秒，账号/会话/token 变化时失效。 |
| `Vault busy` | 其他进程可能正在刷新，先等待；只有停止全部插件/CLI 进程后才能清理残留锁。详见[安全说明](SECURITY.md)。 |
| 达到用量限制 | 查看 OpenAI 用量页面；插件不会购买 credits 或切换到付费 API 账单。 |

不要通过重新生成口令修复无法解锁的凭据库。原口令丢失时，请在 ChatGPT 断开应用连接，再建立新的本地凭据。

## 开发与安全

- [贡献指南](CONTRIBUTING.md)：开发环境、检查及变更要求。
- [测试说明](VALIDATION.md)：自动化覆盖、兼容性矩阵和手工检查。
- [安全说明](SECURITY.md)：凭据处理、信任边界与报告方式。

协议参考：[登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[无状态 reasoning](https://developers.openai.com/api/docs/guides/reasoning)。

## 许可证

[MIT](LICENSE)。
