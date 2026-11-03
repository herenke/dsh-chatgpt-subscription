# Validation record

Date: 2026-11-03. Platform: macOS; Node.js 22.23.3.

- `npm test`: 55 passing tests, 0 failures. Includes real `@deepseek-ai/dsh-llm@0.2.2-alpha.3` / Cordis activation, adapter registration, discovery, streaming and disposal with synthetic mock transports.
- `npm run check`: all eight JavaScript runtime modules parse successfully.
- `npm install --package-lock-only --ignore-scripts` / npm dependency audit: 0 reported vulnerabilities for this repository's locked development graph, which overrides Zod to 4.6.6. This does not certify the host DSH dependency graph; its default Zod 4.4.3 has a known upstream advisory, documented in README.
- `npm pack --dry-run --ignore-scripts --json`: 17 runtime/package files; no test fixtures, node_modules, local credentials or development files enter the hypothetical package. No package was published.

Security cases cover encrypted vault secrecy/integrity, wrong password, owner-only permissions, failed-transaction rollback, lock refusal, symlink refusal, fresh PKCE/state/nonce, reused client/host IDs, callback parameter ambiguity and identity confusion, malformed/wrong-state callbacks remaining live, constant plain-text error pages, valid-state denial, timeout/cancel, fixed endpoint and redirect policy, signed synthetic RS256 identity tokens and claim rejection, missing plan grants, rotating refresh tokens, reduced scopes, and malformed token-response redaction.

Protocol cases cover system/developer/text/tool history translation, unsupported input rejection, account-specific catalog order/visibility, fragmented UTF-8/CRLF SSE, malformed/truncated frames, text and parallel function-call blocks, disjoint token accounting, post-delta quota failure, incomplete/disconnected streams, unsupported output refusal, public endpoint/attribution/stream/store wire flags, HTTP failures without response-body reflection, and prepared-request invalidation following account change/logout.

No live OpenAI sign-in, actual subscription request, live refresh/revocation, full DSH desktop installation, visual metadata rendering, or production tool loop was performed. All test credentials and generated signing keys are synthetic. Real-world availability and eligibility remain unverified. No user DSH profile was modified and no production credential was generated.

The extension adds user and function-result images (ordering, normalization targets, MIME/reference validation, deduplicated reads, offload/count/base64 budgets, cancellation and missing-service errors), native replay round trips through BlockAssembler, account/model/content isolation, subscription-specific parameter/tool-namespace regression tests, opt-in web search and safe source links, and real DSH runtime image forwarding/text-only projection. Both README languages have reciprocal links and are included in the package inventory.

The official subscription preview restrictions were checked on 2026-11-03: audio/video/transcription and several hosted tools are excluded; temperature and max_output_tokens are not accepted. No unsupported endpoint or paid API fallback was added. Live image acceptance, encrypted reasoning continuation and hosted web search were not tested with a real ChatGPT account.
