# DSH ChatGPT subscription

**English** | [简体中文](README.zh-CN.md)

Use your ChatGPT subscription in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through OpenAI's official **Sign in with ChatGPT** flow. Keep DSH's agent loop, local tools, and conversation history while sending inference requests to the public Responses API.

This is an independent community project, not an official OpenAI or DeepSeek plugin. It does not read existing ChatGPT/Codex credentials or use private `backend-api` endpoints. Access requires an eligible account and remains subject to OpenAI's model availability, usage limits, and [subscription-route restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Features

- Account-scoped model discovery, streaming responses, and token usage reporting.
- Local function tools and account/model-scoped native reasoning replay.
- Image input through DSH's attachment service.
- Per-model reasoning effort selection from the account catalog.
- Optional OpenAI-hosted web search with source links.
- Multiple account/workspace registrations, account selection, token refresh, and sign-out.
- A persistent enable/disable switch in **Settings → Models**.
- Encrypted local credentials; no API key or separate paid-API fallback.

## Requirements

- Node.js **22 or later** and an installed DSH CLI.
- DSH `>=0.2.1-rc.5 <0.3.0-0`. Adapter integration has been tested with `0.2.1-rc.5`, `0.2.2-alpha.3`, and `0.2.2-rc.1`; other accepted versions log an unverified-runtime warning. The Settings card also requires the host's Models settings slot and configuration-form service.
- An eligible ChatGPT account and a local browser for authorization.
- Network access from the **DSH process** to `auth.openai.com` and `api.openai.com`. If a proxy or VPN is necessary in your environment, configure it before signing in or enabling the provider. This plugin does not configure a proxy.

Live-account testing has been performed on macOS. Windows/Linux integration has not been verified; Windows ACL protection is not implemented. See [Security](SECURITY.md) and [Testing](VALIDATION.md) for details.

## Installation

The project is installed from source; no npm package is published.

### 1. Get the source

```sh
git clone https://github.com/herenke/dsh-chatgpt-subscription.git
cd dsh-chatgpt-subscription
npm ci --ignore-scripts
```

Keep this directory available after installation. The commands below assume your terminal is in the repository root.

### 2. Set up credentials and sign in

For macOS/Linux, create a private passphrase file usable by both the CLI and GUI-launched DSH. Run this **once for a new vault**:

```sh
mkdir -p "$HOME/.config/dsh-chatgpt-subscription"
chmod 700 "$HOME/.config/dsh-chatgpt-subscription"
(umask 077; set -C; openssl rand -base64 32 > "$HOME/.config/dsh-chatgpt-subscription/passphrase")
node src/cli.js login
```

The command requires OpenSSL and refuses to overwrite an existing passphrase file. If you already have a vault, keep its original passphrase; generating a new one will not unlock it. The file contains the plaintext decryption secret and is **not a system keychain**. Do not commit or share it. See [Security](SECURITY.md) for the threat model.

The CLI opens the browser. Review the account, workspace, permissions, and usage limits on OpenAI's page. Credentials are saved in an encrypted vault at `~/.config/dsh-chatgpt-subscription/accounts.vault`.

Alternatively, supply `DSH_CHATGPT_VAULT_PASSWORD` (at least 16 characters) through your secret-management environment to both the CLI and DSH. GUI launches usually do not inherit terminal variables. Never place a literal passphrase in shell history, repository files, DSH configuration, or an issue report.

### 3. Install into your DSH profile

Choose **one** command for the profile you use. Fully quit the Desktop app before installing into its profile, then reopen it:

```sh
# Desktop app
dsh plugin --profile desktop add "file:$PWD"

# Or CLI/web profile
dsh plugin --profile web add "file:$PWD"
```

For CLI/web, launch the same profile with `dsh --profile web web`. If you use a custom profile, replace the profile name in both commands.

Select a model under **ChatGPT subscription** in the conversation model picker. Activating the plugin does not open a browser or sign in automatically. An unsigned-in provider reports a credential error when its models are requested.

## Enable or disable

Open **Settings → Models** and find the **ChatGPT subscription** card at the bottom of the page.

- **Enabled**: the provider is registered and its models can be loaded.
- **Disabled**: the adapter is unregistered, so the conversation model picker no longer loads this provider. Credentials are retained; disabling is not sign-out.

The switch persists and takes effect without restarting DSH. Reopen the model picker after changing it. Existing sessions using this provider must select another model before continuing while it is disabled. Disabling does not guarantee cancellation of requests already in progress.

If your network requires a proxy, leave the provider disabled until the proxy is ready to avoid model-loading errors.

## Account management

Run these commands from the repository root:

```sh
node src/cli.js accounts
node src/cli.js login --new
node src/cli.js login oaiapp_YOUR_SAVED_CLIENT_ID
node src/cli.js select oaiapp_YOUR_SAVED_CLIENT_ID
node src/cli.js logout
node src/cli.js logout oaiapp_YOUR_SAVED_CLIENT_ID
node src/cli.js usage
```

`accounts` marks the active registration with `*`. `login --new` adds an account/workspace; `login CLIENT_ID` reauthorizes an existing registration. After selection, reopen the model picker and choose a model available to that account. Account identity is displayed in CLI output and model descriptions, but OAuth tokens are not sent to the DSH frontend.

`logout` clears local tokens before attempting remote revocation. If revocation cannot be confirmed, disconnect the app in ChatGPT settings. Already dispatched requests are not cancelled across processes. Usage may be shared with ChatGPT/Codex; manage it at <https://chatgpt.com/settings/usage>.

## Configuration

Edit the `config` of the **existing** `chatgpt-subscription` plugin row; do not add a duplicate row. Use the DSH profile configuration editor or your profile's Cordis patch.

| Field | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Registers the provider; editable live through Settings → Models. |
| `webSearch` | `false` | Allows the model to use OpenAI-hosted `web_search`. |
| `passphraseFile` | Unset | Explicit owner-only passphrase file. |
| `vaultPath` | Unset | Custom encrypted-vault location. |
| `contextWindow` | Unset | Global context-capacity override in tokens. |
| `modelContextWindows` | `{}` | Context-capacity overrides keyed by model ID. |

```yaml
config:
  enabled: true
  webSearch: false
  # Optional: use these only when you need custom credential paths.
  # passphraseFile: ~/.config/dsh-chatgpt-subscription/passphrase
  # vaultPath: ~/.config/dsh-chatgpt-subscription/accounts.vault
```

Only `enabled` is live-editable. Reload the plugin or restart DSH after changing other fields. Endpoints and tokens cannot be configured here.

### Credential locations

Passphrase lookup order:

1. `config.passphraseFile`
2. `DSH_CHATGPT_VAULT_PASSWORD`
3. `DSH_CHATGPT_VAULT_PASSWORD_FILE`
4. `~/.config/dsh-chatgpt-subscription/passphrase`

An explicitly selected invalid source fails rather than falling back. Passphrase files must contain one line of at least 16 characters; a trailing newline is permitted. On Unix, use an owner-only directory and regular file (0700/0600); symlink passphrase files are rejected.

Vault lookup order is `config.vaultPath` → `DSH_CHATGPT_VAULT_PATH` → the default vault path. Custom paths must be absolute or start with `~/`. The CLI does not read the plugin row: when using custom GUI paths, provide matching `DSH_CHATGPT_VAULT_PASSWORD_FILE` and `DSH_CHATGPT_VAULT_PATH` to the CLI, and avoid conflicting password environment variables.

### Context capacity

Capacity precedence is `modelContextWindows[modelId]` → `contextWindow` → catalog `context_window` → a conservative **32768-token estimate**. Configure overrides only from the model's actual supported capacity. Model descriptions identify the source, and DSH uses the capacity for automatic compaction. The fallback is not a provider guarantee.

### Web search

Set `webSearch: true` to allow OpenAI-hosted search. Availability depends on the selected model and account/workspace policy. Search queries are processed by OpenAI; returned URL citations appear as source links. This option does not enable other hosted tools or switch billing routes.

## Limitations

- Audio/video, transcription, image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, and `tool_search` are not supported on this route. DSH local tools remain separate.
- `temperature` and nonempty `stop` sequences are rejected. `maxTokens` is not forwarded because the route rejects `max_output_tokens`; **no output-token cap is enforced by this plugin**.
- Reasoning effort choices come from the account catalog and are filtered to values accepted by the route. No hidden reasoning is decrypted or fabricated.
- Image input requires `attachments.readImageRequest`. The host normalizes PNG/JPEG/WebP/non-animated GIF input toward a 4096-pixel longest edge and an 8 MiB encoded-byte target per image. The adapter limits a request to 16 retained image occurrences and 20 MiB of base64 image data; oversized histories use DSH's image-offload mechanism. Resizing can reduce small-text detail.
- Native replay is bound to the account, provider, model, and unchanged visible content. Edited or compacted history falls back to visible text/tool history. Session logs contain conversation and replay data separately from the encrypted credential vault.
- No automatic inference retries, custom API endpoint, or automatic paid fallback is provided. Host-level retry/tool policies remain DSH's responsibility.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `OpenAI network request failed` | Ensure the DSH process can reach the official hosts; check DNS, firewall, and proxy/VPN configuration. Disable the provider while offline. |
| Missing credentials or cannot unlock vault | Use the same vault and original passphrase in CLI and DSH; check file ownership, permissions, and path overrides. |
| Provider missing after installation/upgrade | Check the active profile and supported DSH range, restart DSH, and inspect plugin activation logs. Do not bypass version requirements without reviewing compatibility. |
| Account/model unavailable | Sign in, confirm plan permission, select the intended registration, then reopen the model picker. Catalog results are cached for up to 60 seconds and invalidated on account/session/token changes. |
| `Vault busy` | Another process may be refreshing credentials. Wait; remove a stale lock only after stopping all plugin/CLI processes. See [Security](SECURITY.md). |
| Usage limit reached | Check OpenAI's usage page. The plugin does not purchase credits or switch to paid API billing. |

Do not regenerate the passphrase to recover a locked vault. If the original secret is lost, disconnect the application in ChatGPT and establish new local credentials.

## Development and security

- [Contributing](CONTRIBUTING.md): setup, checks, and change guidelines.
- [Testing](VALIDATION.md): automated coverage, compatibility matrix, and manual checks.
- [Security](SECURITY.md): credential handling, trust boundaries, and reporting.

Protocol references: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), and [stateless reasoning](https://developers.openai.com/api/docs/guides/reasoning).

## License

[MIT](LICENSE).
