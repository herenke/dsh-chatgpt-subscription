# DSH ChatGPT subscription

**English** | [简体中文](README.zh-CN.md)

Use an eligible ChatGPT plan through OpenAI's official **Sign in with ChatGPT** flow while keeping DeepSeek Harness's agent loop. Inference uses the public Responses API. This is an independent project, not an official OpenAI or DeepSeek plugin. It does not read existing Codex/ChatGPT credentials or use private `backend-api` endpoints.

**Status: local development preview.** Offline security/protocol tests and mocked requests through the actual DSH LLM runtime have passed. Real account sign-in, subscription usage, installation into a user's DSH profile, and desktop rendering have not been tested. These results do not establish account eligibility or production readiness.

## Supported scope

- Node.js 22+ and DSH **0.2.2-alpha.3**, with an exact DSH version requirement.
- Account-specific model discovery instead of hardcoded models; text conversations, function tool calls/results, streaming text, and token usage.
- Multiple account/workspace registrations, account selection, reauthorization, refresh, sign-out, and renewable-session revocation.
- Authorization Code with PKCE S256, fresh state/nonce, JWKS RS256 signature verification, and issuer/audience/expiry/nonce/subject checks.
- AES-256-GCM encrypted credentials with a scrypt-derived key, owner-only Unix modes (0700 directory, 0600 file), atomic replacement, and a cross-process lock.
- Fixed official HTTPS endpoints; no HTTP, custom gateways, redirects, telemetry, automatic paid fallback, or automatic inference retries.

The plugin currently declares text input only to DSH. Image attachment loading and Responses image-input conversion have not been implemented, so this version cannot perform visual analysis of images. **This is a limitation of the initial plugin implementation, not a claim that ChatGPT subscriptions or every available model support only text.** DSH may project attachments for text-only models; that is not vision support. Adding images requires model-capability checks, attachment transport, and tests.

Audio, OpenAI-hosted tools, native reasoning-state replay, stop sequences, and temperature are also unsupported. Unsupported input fails explicitly. Reasoning summaries are not emitted to DSH, and historical reasoning text is not fabricated into native model reasoning. Tool loops requiring long reasoning still need live validation.

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

Real sign-in must be completed by the user. Check `dsh --version` first. If the version differs, review interface compatibility rather than bypassing the version requirement. The following reference command adds the local bundle to your web profile; alternatively, use DSH's plugin manager. Installation changes that profile and was not performed during development.

```sh
dsh plugin --profile web add "file:$HOME/Projects/dsh-chatgpt-subscription"
```

Set a strong passphrase in the **same terminal environment** used to launch both the CLI and DSH. On macOS's default zsh, read it without echoing it or placing its literal value in shell history:

```zsh
read -rs 'DSH_CHATGPT_VAULT_PASSWORD?Vault passphrase (16+ characters): '
export DSH_CHATGPT_VAULT_PASSWORD
printf '\n'
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login
# Launch DSH, with the local plugin configured, from the same terminal:
dsh web
```

Use a long, random, unique passphrase. The 16-character check is a minimum, not a guarantee of strength. Do not put it in the repository, `.env`, profile configuration, or chat. GUI-launched DSH generally does not inherit terminal variables; this version requires launching it from the configured terminal. Keep the same passphrase across launches. If it is lost, the vault cannot be decrypted; disconnect the app in ChatGPT before establishing new local credentials. Default vault: `~/.config/dsh-chatgpt-subscription/accounts.vault`.

The CLI opens the system browser and prompts you to **Continue with ChatGPT**. Review the account, workspace, permissions, and usage limits on OpenAI's page. The plugin does not automatically enable credits or purchases. Authorization URLs may contain an `id_token_hint` sent only to OpenAI, so they are not printed. An account becomes active only after identity verification. The issued client ID is saved before the initial code exchange so registration can be reused if the one-time code expires.

```sh
node ~/Projects/dsh-chatgpt-subscription/src/cli.js accounts
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login --new
node ~/Projects/dsh-chatgpt-subscription/src/cli.js login oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js select oaiapp_YOUR_SAVED_CLIENT_ID
node ~/Projects/dsh-chatgpt-subscription/src/cli.js logout
node ~/Projects/dsh-chatgpt-subscription/src/cli.js usage
```

`accounts` marks the active account with `*`. After switching, refresh DSH's model list and choose a model available to that account under the `ChatGPT subscription` provider. Account details appear in model descriptions and the CLI; tokens are not sent to the DSH frontend. `logout` attempts to revoke the refresh token, then clears local tokens while retaining client/account mappings and the host ID. If remote revocation is unconfirmed, it tells you to disconnect the app in ChatGPT settings.

Eligibility, model availability, plan usage, and credits depend on OpenAI's current policy and the actual authorization grant. Access is not guaranteed for every subscription. Usage may be shared with other ChatGPT/Codex usage. Limit errors do not trigger automatic retries or a switch to API billing. Manage usage at <https://chatgpt.com/settings/usage>.

## Security boundaries and dependencies

See [SECURITY.md](SECURITY.md). Encryption protects credentials at rest; it does not protect against malware running as the same OS user, process environment/memory access, or untrusted DSH plugins. POSIX modes do not replace NTFS ACLs on Windows. Windows/Linux permission and browser behavior remain unverified; validation was performed on macOS.

The pinned DSH version depends on Zod 4.4.3, affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), a memory-exhaustion issue when validating oversized collections. This repository's development graph pins Zod 4.6.6 through root `overrides`; its recorded audit reported zero vulnerabilities. **Installing this plugin does not apply its overrides to the host DSH dependency graph.** Host maintainers must assess and update that dependency before production installation. This repository's audit is not an audit of the entire DSH host.

## Implementation references

Reviewed on 2026-11-03:

- [Official registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Official accounts, sessions, and refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Official model discovery and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI's public OIDC metadata](https://auth.openai.com/.well-known/openid-configuration)
- DSH source snapshot [`8bd073392eef6f54e921a093b95076248eb08cbb`](https://github.com/deepseek-ai/deepseek-harness/tree/8bd073392eef6f54e921a093b95076248eb08cbb), particularly the interfaces in `packages/llm/llm/src`. Compatibility tests use the official npm package `@deepseek-ai/dsh-llm@0.2.2-alpha.3`.

No source was copied from the previously reviewed community plugin. This project does not need that project's credentials or client identity. Protocol facts and interfaces come from the official sources above.
