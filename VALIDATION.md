# Validation record

Date: 2026-11-03. Platform: macOS; Node.js 22.23.3.

- `npm test`: 74 passing tests per version, 0 failures. Run separately against official `@deepseek-ai/dsh-llm@0.2.1-rc.5` and `@deepseek-ai/dsh-llm@0.2.2-alpha.3`. Includes real / Cordis activation, adapter registration, discovery, streaming and disposal with synthetic mock transports.
- `npm run check`: all nine JavaScript runtime modules parse successfully.
- `npm install --package-lock-only --ignore-scripts` / npm dependency audit: 0 reported vulnerabilities for this repository's locked development graph, which overrides Zod to 4.6.6. This does not certify the host DSH dependency graph; its default Zod 4.4.3 has a known upstream advisory, documented in README.
- `npm pack --dry-run --ignore-scripts --json`: 18 runtime/package files; no test fixtures, node_modules, local credentials or development files enter the hypothetical package. No package was published.

Security cases cover encrypted vault secrecy/integrity, wrong password, owner-only permissions, failed-transaction rollback, bounded lock waiting/cancellation, symlink refusal, fresh PKCE/state/nonce, reused client/host IDs, callback parameter ambiguity and identity confusion, malformed/wrong-state callbacks remaining live, constant plain-text error pages, valid-state denial, timeout/cancel, fixed endpoint and redirect policy, signed synthetic RS256 identity tokens and claim rejection, missing plan grants, rotating refresh tokens, reduced scopes, and malformed token-response redaction.

Protocol cases cover system/developer/text/tool history translation, unsupported input rejection, account-specific catalog order/visibility, fragmented UTF-8/CRLF SSE, malformed/truncated frames, text and parallel function-call blocks, disjoint token accounting, post-delta quota failure, incomplete/disconnected streams, unsupported output refusal, public endpoint/attribution/stream/store wire flags, HTTP failures without response-body reflection, and prepared-request invalidation following account change/logout.

No live OpenAI sign-in, actual subscription request, live refresh/revocation, full DSH desktop installation, visual metadata rendering, or production tool loop was performed. All test credentials and generated signing keys are synthetic. Real-world availability and eligibility remain unverified. No normal user DSH profile was modified and no production credential was generated.

The extension adds user and function-result images (ordering, normalization targets, MIME/reference validation, deduplicated reads, offload/count/base64 budgets, cancellation and missing-service errors), native replay round trips through BlockAssembler, account/model/content isolation, subscription-specific parameter/tool-namespace regression tests, opt-in web search and safe source links, and real DSH runtime image forwarding/text-only projection. Both README languages have reciprocal links and are included in the package inventory.

The official subscription preview restrictions were checked on 2026-11-03: audio/video/transcription and several hosted tools are excluded; temperature and max_output_tokens are not accepted. No unsupported endpoint or paid API fallback was added. Live image acceptance, encrypted reasoning continuation and hosted web search were not tested with a real ChatGPT account.

## Review follow-up

The installed macOS DSH CLI reports `0.2.1-rc.5`. Local-directory and packed-tarball installation into temporary `DSH_HOME` web profiles passed without version exemptions. Actual `dsh --profile web --help` exited successfully with no plugin activation warning while vault-passphrase environment variables were removed. These checks prove host installation/activation, not successful live model discovery or GUI rendering. The temporary profiles were separate from normal Desktop/web profiles.

## Local follow-up: DSH 0.2.2-rc.1 on Windows

Date: 2026-11-06. Platform: Windows 11; Node.js 24.16.0 (host DSH 0.2.2-rc.1, bundled Node 24.21.0).

- Version gate: `engines.dsh` and the `@deepseek-ai/dsh-llm` peer range now include `0.2.2-rc.1`, so installation into the desktop profile no longer needs a version exemption. Package version bumped to 0.2.1 to distinguish this local fork.
- API surface: `@deepseek-ai/dsh-llm@0.2.2-rc.1` differs from 0.2.1-rc.5 only by an optional `LlmModelBadge` on discovered models, a widened `GenerateOptions.purpose`, and a new `llm/models-updated` event. `LlmAdapter`, `LlmError`, `isContextWindowExceededError`, `attributionHeaders`, `resolveRetryPolicy` and the image offload helpers are unchanged.
- `npm test` against 0.2.2-rc.1: 74 tests, 70 pass, 4 fail; against 0.2.1-rc.5 on the same machine: the same 74/70/4 result. The four failures are Windows-only POSIX expectations (owner-only `0700`/`0600` modes and unprivileged `symlink` creation returning `EPERM`), not version regressions. The 20-concurrent-expired-session case was observed to fail once on Windows timing and pass on rerun.
- `npm run check`: passes for all nine modules.
- Not performed: live ChatGPT sign-in, real subscription inference, and desktop GUI rendering.

New regression cases cover 20 concurrent fresh requests without writes, 20 concurrent expired requests with one refresh, four independent Node processes consuming one rotating token, state access/logout during refresh I/O, stale-lock cancellation, unchanged ciphertext/mtime on reads, private GUI passphrase files and symlink refusal, no total inference deadline, bounded administrative calls, context-budget precedence, shared catalog discovery/token invalidation, normal token rotation versus new login identity, host-resolved retry policy, safe context/quota/incomplete errors, stage-only CLI diagnostics, and persisting a rotated credential despite caller cancellation after successful exchange. See [REVIEW-RESOLUTION.md](REVIEW-RESOLUTION.md) for reviewed suggestions and deliberate deviations.
