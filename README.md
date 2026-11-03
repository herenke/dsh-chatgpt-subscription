# DSH ChatGPT subscription

**English** | [简体中文](README.zh-CN.md)

Use an eligible ChatGPT plan through OpenAI's official **Sign in with ChatGPT** flow while keeping DeepSeek Harness's agent loop. Inference uses the public Responses API. This is an independent project, not an official OpenAI or DeepSeek plugin. It does not read existing Codex/ChatGPT credentials or use private `backend-api` endpoints.

**Status: local development preview.** Offline security/protocol tests and mocked requests through the actual DSH LLM runtime have passed. The installed macOS DSH CLI has also loaded both the local directory and packed artifact using isolated profiles. Real account sign-in, subscription usage, installation into a user's normal DSH profile, and desktop rendering have not been tested. These results do not establish account eligibility or production readiness.

## Supported scope

- Node.js 22+ and DSH **0.2.1-rc.5** or **0.2.2-alpha.3**. Only these verified versions satisfy the compatibility gate.
- Account-specific model discovery instead of hardcoded models; text conversations, function tool calls/results, streaming text, and token usage.
- Multiple account/workspace registrations, account selection, reauthorization, refresh, sign-out, and renewable-session revocation.
- Authorization Code with PKCE S256, fresh state/nonce, JWKS RS256 signature verification, and issuer/audience/expiry/nonce/subject checks.
- AES-256-GCM encrypted credentials with a scrypt-derived key, owner-only Unix modes (0700 directory, 0600 file), atomic replacement, and a cross-process lock.
- Fixed official HTTPS endpoints; no HTTP, custom gateways, redirects, telemetry, automatic paid fallback, or automatic inference retries.

### Capability status

| Capability | Current behavior |
| --- | --- |
| Text and local function tools | Supported, with tools grouped under the `dsh` namespace. |
| Image input | Supported for user attachments and function-tool results through DSH's attachment service. |
| Native reasoning replay | Successful native output, including encrypted reasoning, is reused only for the same account, provider, model, and unchanged visible content. |
| OpenAI web search | Optional via `webSearch: true`; availability remains subject to model/account/workspace policy. |
| Audio/video input and transcription | Unavailable on the documented ChatGPT plan route. |
| Other hosted tools | Image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, and `tool_search` are excluded by the documented route. Local DSH tools remain separate. |
| `temperature` and `stop` | Rejected with an explicit error: this subscription route excludes temperature, and Responses has no native stop-sequence field. |
| Output-token cap | `maxTokens` is not forwarded because this route rejects `max_output_tokens`; it is **not an enforced cap**. |

These boundaries follow the [official subscription preview restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), not the capabilities of every OpenAI model or of the separate paid API. No alternative billing endpoint is configured.

Images use normalized PNG/JPEG/WebP/non-animated GIF attachments, encoded as inline data URLs. The plugin does not download arbitrary image URLs or open user-supplied paths. The host creates a request preview with at most 4096 pixels on either side and an 8 MiB encoded-byte target per image. Requests are limited to 16 retained image occurrences and 20 MiB of base64 image data; oversized histories signal DSH's oldest-image offload mechanism. Offloaded images are represented explicitly as omitted. Host normalization may change format/dimensions, and preview resizing can reduce small-text detail. The host must provide `attachments.readImageRequest`.

If the account catalog explicitly declares text-only input, DSH substitutes image placeholders. When the catalog omits modality metadata, the adapter leaves capability unknown and permits image submission; the selected model/API determines whether it is accepted. No model is assumed to support vision merely because it appears in the picker.

Encrypted reasoning remains opaque; the plugin does not decode it or fabricate hidden reasoning from visible text. Changed or compacted history falls back to visible text/tool history. Native replay is stored in the DSH session log, separately from the encrypted OAuth vault. Real subscription requests and long-running tool loops still need live validation.

## Development checks

```sh
cd ~/Projects/dsh-chatgpt-subscription
npm ci --ignore-scripts
npm test
npm run check
npm audit
npm pack --dry-run --ignore-scripts
```

There are no install/postinstall/prepare build scripts and no additional regular runtime dependencies. The host supplies `@deepseek-ai/dsh-llm`; the lockfile reproduces the development environment. No npm package has been published. `private: true` prevents accidental npm publication.

## Local use

Real sign-in must be completed by the user. Check `dsh --version` first. If the version differs, review interface compatibility rather than bypassing the version requirement. The following reference command adds the local bundle to your web profile; alternatively, use DSH's plugin manager. Installation changes that profile. Development probes used a separate temporary `DSH_HOME`, leaving normal user profiles unchanged.

```sh
# CLI/web usage:
dsh plugin --profile web add "file:$HOME/Projects/dsh-chatgpt-subscription"
# Desktop App: fully quit it first, install, then reopen it:
dsh plugin --profile desktop add "file:$HOME/Projects/dsh-chatgpt-subscription"
```

Choose the profile you actually use. After restarting, check that the provider registered; without sign-in, model discovery reports a missing-credential/sign-in error. Provider activation itself needs no passphrase and starts no authorization flow.

Set a strong passphrase in the **same terminal environment** used to launch both the CLI and DSH. On macOS's default zsh, read it without echoing it or placing its literal value in shell history:

```zsh
read -rs 'DSH_CHATGPT_VAULT_PASSWORD?Vault passphrase (16+ characters): '
export DSH_CHATGPT_VAULT_PASSWORD
printf '\n'
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login
# Launch DSH, with the local plugin configured, from the same terminal:
dsh web
```

Use a long, random, unique passphrase. The 16-character check is a minimum, not a guarantee of strength. Do not put it in the repository, `.env`, profile configuration, or chat. GUI-launched DSH generally does not inherit terminal variables; use the private-file option below or launch from the configured terminal. Keep the same passphrase across launches. If it is lost, the vault cannot be decrypted; disconnect the app in ChatGPT before establishing new local credentials. Default vault: `~/.config/dsh-chatgpt-subscription/accounts.vault`.

The CLI opens the system browser and prompts you to **Continue with ChatGPT**. Review the account, workspace, permissions, and usage limits on OpenAI's page. The plugin does not automatically enable credits or purchases. Authorization URLs may contain an `id_token_hint` sent only to OpenAI, so they are not printed. An account becomes active only after identity verification. The issued client ID is saved before the initial code exchange so registration can be reused if the one-time code expires.

```sh
node ~/Projects/dsh-chatgpt-subscription/src/cli.js accounts
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login --new
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js select oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js logout
node ~/Projects/dsh-chatgpt-subscription/src/cli.js usage
```

`accounts` marks the active account with `*`. After switching, refresh DSH's model list and choose a model available to that account under the `ChatGPT subscription` provider. Account details appear in model descriptions and the CLI; tokens are not sent to the DSH frontend. `logout` first clears local tokens, then attempts remote revocation outside the state lock while retaining client/account mappings and the host ID. If remote revocation is unconfirmed, it tells you to disconnect the app in ChatGPT settings.

Eligibility, model availability, plan usage, and credits depend on OpenAI's current policy and the actual authorization grant. Access is not guaranteed for every subscription. Usage may be shared with other ChatGPT/Codex usage. Limit errors do not trigger automatic retries or a switch to API billing. Manage usage at <https://chatgpt.com/settings/usage>.

## Desktop credentials and context settings

For GUI launches, create a private directory (0700) and a regular owner-only passphrase file (0600) outside the repository. The default file is `~/.config/dsh-chatgpt-subscription/passphrase`; put one strong passphrase on one line, optionally ending with a newline. The plugin does not create this file or generate a passphrase automatically. A file makes GUI startup practical, but stores the decryption secret on disk; it is **not a system keychain** and cannot protect against the same OS user reading both files.

Passphrase precedence: plugin `config.passphraseFile`, then `DSH_CHATGPT_VAULT_PASSWORD`, then `DSH_CHATGPT_VAULT_PASSWORD_FILE`, then the default private file. An explicitly configured invalid source fails instead of silently falling back. Paths must be absolute or start with `~/`; passphrase-file symlinks are rejected. The CLI uses the same default file, or the two environment variables. If you configure custom paths for Desktop, set `DSH_CHATGPT_VAULT_PASSWORD_FILE` and `DSH_CHATGPT_VAULT_PATH` to matching paths when running the CLI. Never put a literal passphrase in DSH configuration.

Optional fields in the existing plugin row:

```yaml
config:
  passphraseFile: ~/.config/dsh-chatgpt-subscription/passphrase
  vaultPath: ~/.config/dsh-chatgpt-subscription/accounts.vault
  contextWindow: 32768
  modelContextWindows:
    YOUR_MODEL_SLUG: 32768
```

Use the model's actual supported capacity when setting these example values. Capacity precedence is per-model override → configured global default → catalog `context_window` → **32768-token estimate**. The fallback is a conservative budget, not a provider capacity guarantee. Model descriptions identify its source. DSH receives the context budget for automatic compaction; context-overflow responses use its recoverable error code. No output-token cap is promised.

The model catalog is cached for 60 seconds with shared in-flight discovery, invalidated by account/session/token changes. Ordinary credential reads do not write or lock the vault. Refreshes serialize across processes under a separate refresh lock; network I/O does not hold the state-write lock. Contended locks wait up to 130 seconds and are never automatically stolen. Streaming inference has no internal total deadline and follows DSH's cancellation signal; model metadata has a 30-second deadline, and token/revocation/JWKS requests have a 120-second deadline. An incomplete response reports a reason and is never treated as a completed tool call.

## Optional web search

Web search is disabled by default. Set this plugin's DSH configuration to:

```yaml
config:
  webSearch: true
```

This is the `config` of the existing `chatgpt-subscription` plugin row, not a second plugin entry. It allows the model to use OpenAI-hosted `web_search` on this route. Search queries are handled by OpenAI's hosted tool and remain subject to account policy and usage limits. Returned URL citations are shown as source links. Unsupported or unavailable search fails normally; it does not switch billing routes or turn on other hosted tools. Omit the field or set it to `false` to disable it. No API URL or token can be configured here.

## Security boundaries and dependencies

See [SECURITY.md](SECURITY.md). Encryption protects credentials at rest; it does not protect against malware running as the same OS user, process environment/memory access, or untrusted DSH plugins. POSIX modes do not replace NTFS ACLs on Windows. Windows/Linux permission and browser behavior remain unverified; validation was performed on macOS.

The pinned DSH version depends on Zod 4.4.3, affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), a memory-exhaustion issue when validating oversized collections. This repository's development graph pins Zod 4.6.6 through root `overrides`; its recorded audit reported zero vulnerabilities. **Installing this plugin does not apply its overrides to the host DSH dependency graph.** Host maintainers must assess and update that dependency before production installation. This repository's audit is not an audit of the entire DSH host.

## Implementation references

Reviewed on 2026-11-03:

- [Official registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Official accounts, sessions, and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Official image inputs](https://developers.openai.com/api/docs/guides/images-vision)
- [Official stateless reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [Official model discovery and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI's public OIDC metadata](https://auth.openai.com/.well-known/openid-configuration)
- DSH source snapshot [`8bd073392eef6f54e921a093b95076248eb08cbb`](https://github.com/deepseek-ai/deepseek-harness/tree/8bd073392eef6f54e921a093b95076248eb08cbb), particularly the interfaces in `packages/llm/llm/src`. Compatibility tests use both official npm packages `@deepseek-ai/dsh-llm@0.2.1-rc.5` and `@deepseek-ai/dsh-llm@0.2.2-alpha.3`.

No source was copied from the previously reviewed community plugin. This project does not need that project's credentials or client identity. Protocol facts and interfaces come from the official sources above.
