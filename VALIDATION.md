# Validation record

Date: 2026-11-03. Platform: macOS; Node.js 22.23.3.

- `npm test`: 74 passing tests per version, 0 failures. Run separately against official `@deepseek-ai/dsh-llm@0.2.1-rc.5` and `@deepseek-ai/dsh-llm@0.2.2-alpha.3`. Includes real / Cordis activation, adapter registration, discovery, streaming and disposal with synthetic mock transports.
- `npm run check`: all nine JavaScript runtime modules parse successfully.
- `npm install --package-lock-only --ignore-scripts` / npm dependency audit: 0 reported vulnerabilities for this repository's locked development graph, which overrides Zod to 4.6.6. This does not certify the host DSH dependency graph; its default Zod 4.4.3 has a known upstream advisory, documented in README.
- `npm pack --dry-run --ignore-scripts --json`: 18 runtime/package files; no test fixtures, node_modules, local credentials or development files enter the hypothetical package. No package was published.

Security cases cover encrypted vault secrecy/integrity, wrong password, owner-only permissions, failed-transaction rollback, bounded lock waiting/cancellation, symlink refusal, fresh PKCE/state/nonce, reused client/host IDs, callback parameter ambiguity and identity confusion, malformed/wrong-state callbacks remaining live, constant plain-text error pages, valid-state denial, timeout/cancel, fixed endpoint and redirect policy, signed synthetic RS256 identity tokens and claim rejection, missing plan grants, rotating refresh tokens, reduced scopes, and malformed token-response redaction.

Protocol cases cover system/developer/text/tool history translation, unsupported input rejection, account-specific catalog order/visibility, fragmented UTF-8/CRLF SSE, malformed/truncated frames, text and parallel function-call blocks, disjoint token accounting, post-delta quota failure, incomplete/disconnected streams, unsupported output refusal, public endpoint/attribution/stream/store wire flags, HTTP failures without response-body reflection, and prepared-request invalidation following account change/logout.

Development validation performed no live OpenAI sign-in, subscription request, live refresh/revocation, full DSH desktop installation, visual metadata rendering, or production tool loop. All test credentials and generated signing keys are synthetic. That statement was superseded by the real-account verification below.

The extension adds user and function-result images (ordering, normalization targets, MIME/reference validation, deduplicated reads, offload/count/base64 budgets, cancellation and missing-service errors), native replay round trips through BlockAssembler, account/model/content isolation, subscription-specific parameter/tool-namespace regression tests, opt-in web search and safe source links, and real DSH runtime image forwarding/text-only projection. Both README languages have reciprocal links and are included in the package inventory.

The official subscription preview restrictions were checked on 2026-11-03: audio/video/transcription and several hosted tools are excluded; temperature and max_output_tokens are not accepted. No unsupported endpoint or paid API fallback was added. Live image acceptance, encrypted reasoning continuation and hosted web search were not tested with a real ChatGPT account.

## Review follow-up

The installed macOS DSH CLI reports `0.2.1-rc.5`. Local-directory and packed-tarball installation into temporary `DSH_HOME` web profiles passed without version exemptions. Actual `dsh --profile web --help` exited successfully with no plugin activation warning while vault-passphrase environment variables were removed. These checks prove host installation/activation, not successful live model discovery or GUI rendering. The temporary profiles were separate from normal Desktop/web profiles.

New regression cases cover 20 concurrent fresh requests without writes, 20 concurrent expired requests with one refresh, four independent Node processes consuming one rotating token, state access/logout during refresh I/O, stale-lock cancellation, unchanged ciphertext/mtime on reads, private GUI passphrase files and symlink refusal, no total inference deadline, bounded administrative calls, context-budget precedence, shared catalog discovery/token invalidation, normal token rotation versus new login identity, host-resolved retry policy, safe context/quota/incomplete errors, stage-only CLI diagnostics, and persisting a rotated credential despite caller cancellation after successful exchange. See [REVIEW-RESOLUTION.md](REVIEW-RESOLUTION.md) for reviewed suggestions and deliberate deviations.

## Real-account verification (2026-11-03, macOS)

Performed with a personal ChatGPT account on the installed DSH 0.2.1-rc.5 Desktop runtime. The account email and all tokens are deliberately not recorded here; no credential, vault passphrase or authorization URL was written to the repository.

- Sign-in: official **Sign in with ChatGPT** completed end to end via the CLI (new dynamic client registration, issued `client_id` retained, ID token verified, granted scopes include `chatgpt.tokens.use.direct`). The encrypted vault was written owner-only and contains no plaintext token or email.
- Model discovery: 8 account-scoped models returned, each advertising `text` and `image` modalities; the catalog also returns `context_window`, which the adapter uses for compaction capacity (e.g. 272000 for the tested model rather than the conservative fallback).
- Streaming inference: `gpt-5.6-luna` returned the requested text with `finish: stop` and disjoint token usage through the real `LlmRuntime`.
- Tool loop: a function tool was declared, the model returned a `function_call`, and after a `function_call_output` plus the stored `replayState` the model answered using the tool result.
- Image input: a 64x64 PNG was accepted and correctly described, with image-specific token usage.
- **Defect found only by real-account testing:** the ChatGPT-plan gateway streams `event:`/`data:` SSE frames with **no `Content-Type` header**, so the previous strict `text/event-stream` check rejected every real inference. `src/protocol.js` now rejects only an explicitly declared non-SSE type (an explicit `application/json` error body still fails), and two regression cases cover the header-less stream and the explicit non-SSE rejection.
- Token refresh: forcing the stored expiry to the past triggered one real refresh-token exchange. A fresh access token was issued, the **rotating refresh token and new expiry were persisted**, identity/client stayed stable, and the refreshed token listed the same 8 models. No reauthorization was needed.
- Hosted web search (opt-in `webSearch: true`): the request carried `tools: [{ "type": "web_search" }]`, the gateway emitted `response.web_search_call.*` events, the answer contained inline citations, and no local tool-call block was produced. Real search usage showed a large cached input count.
- **Second defect found only with a real account:** for hosted-search responses the gateway sends `response.completed.response.output` as an **empty array** and delivers citations as `response.output_text.annotation.added` events, so the previous source-list extraction added nothing. `src/protocol.js` now also collects `url_citation` annotations from those events (http/https only, unsafe schemes dropped, title sanitized), and the real run appends a `Sources:` list. One regression case covers the empty-`output` shape.
- Reasoning effort: catalog `supported_reasoning_levels` are exposed as selectable efforts (per model, with the catalog default preselected). The catalog advertises `ultra` for some models but the real route answers HTTP 400 `invalid_value` listing `none/minimal/low/medium/high/xhigh/max`, so only route-accepted levels are offered. Real runs sent `reasoning.effort` for the selected level and showed the expected token accounting (`low` produced 0 reasoning tokens, `high` produced 10 on the same prompt); the DSH runtime rejects an unknown effort with `UNSUPPORTED_REASONING_EFFORT` before dispatch. `npm test` is 80 passing on 0.2.1-rc.5.
- Still unverified: live revocation (would invalidate the working session), image upload through the real DSH attachment service, replay of a hosted web-search turn, long-running tool loops, and visual inspection of the desktop model picker. The Desktop app was left running with the pre-fix module loaded; a restart loads the fixed module.

## DSH 0.2.2-rc.1 upgrade (2026-11-04)

- Upgrading the installed Desktop runtime from `0.2.1-rc.5` to `0.2.2-rc.1` made the provider disappear: `engines.dsh` enumerated only `0.2.1-rc.5` and `0.2.2-alpha.3`, so the bundle layer was skipped while the profile entry, `node_modules` link and encrypted vault stayed intact.
- `@deepseek-ai/dsh-llm@0.2.2-rc.1` was diffed against `0.2.1-rc.5`: the only changes are the additive `LlmModelInfo.badge`, the `llm/models-updated` event and a `GenerateOptions.purpose` type relaxation. Every API this adapter uses is unchanged.
- `engines.dsh` and the `@deepseek-ai/dsh-llm` peer now also accept `0.2.2-rc.1`. The full 80-test suite passes against `@deepseek-ai/dsh-llm@0.2.2-rc.1` with `@deepseek-ai/cordis@4.1.0` in a temporary install; the repository's pinned dev dependency stays at `0.2.1-rc.5` because the rc.1 package requires cordis 4.1.0 and changing it would re-resolve the dev graph.
- A local-directory install into an isolated `DSH_HOME` with the `0.2.2-rc.1` CLI passed the install preflight and booted with no plugin activation warning. The same bundle then loaded in the running Desktop `desktop` profile and its row reported `fiberPhase: active`.
- Related, not caused by this plugin: `@deepseek-ai/dsh-subagent-codex@0.2.1-rc.5` in the same profile is reported as `incompatible-version` by the new runtime and needs its own upgrade.

## Compatibility policy change (2026-11-04)

- The manifest gate changed from an enumerated list to the verified 0.2.x range `>=0.2.1-rc.5 <0.3.0-0` (the `-0` upper bound excludes 0.3.0 prereleases). A DSH upgrade previously made the plugin disappear from the running profile without any user-visible error; a range gate keeps a newer 0.2.x runtime usable.
- Activation still reports compatibility explicitly: `src/compat.js` resolves the loaded `@deepseek-ai/dsh-llm` package version and logs `dsh-chatgpt-subscription: @deepseek-ai/dsh-llm <version> is outside the verified set (0.2.1-rc.5, 0.2.2-alpha.3, 0.2.2-rc.1); ... behavior on this runtime is unverified.` when the runtime is outside the tested set, while verified versions stay silent. The static adapter imports fail loudly if a future runtime removes an API the plugin uses.
- Verification: `npm test` is 82 passing on the pinned dev dependency; the same suite passes against `@deepseek-ai/dsh-llm@0.2.2-rc.1` with `@deepseek-ai/cordis@4.1.0` in a temporary graph; a local-directory install into an isolated `DSH_HOME` with the 0.2.2-rc.1 CLI passes the preflight and boots with no activation warning; the running Desktop profile keeps the plugin row `fiberPhase: active`.

## Provider visibility and enable/disable switch (2026-11-04)

- The plugin now ships a Client half (`client.js`) that registers a card in the `settings.models.footer` slot of **Settings → Models**. The card shows the provider name, its enabled state, and a switch; it writes the plugin row's volatile `enabled` field through the DSH settings form service (`configForms.get("chatgpt-subscription").set("enabled", …)`).
- The Host exports a Schemastery `Config` whose `enabled` field is volatile. Activation registers the adapter only while enabled, and a `loader/volatile-update` listener registers/unregisters it live, so disabling stops the chat model picker from loading the provider (for example before a proxy is running) without restarting DSH. Other fields (`webSearch`, `passphraseFile`, `vaultPath`, `contextWindow`, `modelContextWindows`) stay non-volatile load-time configuration.
- Tests: `npm test` is 86 passing, including the Config defaults, disabled activation leaving the provider unregistered, live unregister/re-register on volatile updates, and a fake Client module loader asserting the footer card registration and its settings-entry lookup.
- A local-directory install into an isolated `DSH_HOME` with the 0.2.2-rc.1 CLI still passes the preflight and boots with no activation warning, and `npm pack --dry-run` includes `client.js` (20 files).
- At implementation time, the card's visual rendering and the live switch in the running Desktop app had not been verified; the bundle's new Client half required an app restart. See the subsequent user confirmation below; a complete real-UI disable/re-enable round trip remains unverified.

## User confirmation and availability status (2026-11-04)

- The user confirmed that the GPT subscription was configured and was being used for the current conversation in DSH Desktop. The session runtime also identifies the active provider/model as `chatgpt-subscription/gpt-6.1-sol`.
- The bilingual README status is now **available for use**, replacing the obsolete local-preview label. This is confirmation of real Desktop conversation use, not a claim of npm publication, verification on Windows/Linux, or exhaustive production certification.
- Remaining limits above still apply: live revocation, real attachment-service upload, hosted-search replay, long-running tool loops, and a complete real-UI enable/disable round trip have not been independently verified.
