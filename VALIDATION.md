# Validation record

Date: 2026-11-03. Platform: macOS; Node.js 22.23.3.

- `npm test`: 33 passing tests, 0 failures. Includes real `@deepseek-ai/dsh-llm@0.2.2-alpha.3` / Cordis activation, adapter registration, discovery, streaming and disposal with synthetic mock transports.
- `npm run check`: all six JavaScript runtime modules parse successfully.
- `npm install --package-lock-only --ignore-scripts` / npm dependency audit: 0 reported vulnerabilities for this repository's locked development graph, which overrides Zod to 4.6.6. This does not certify the host DSH dependency graph; its default Zod 4.4.3 has a known upstream advisory, documented in README.
- `npm pack --dry-run --ignore-scripts --json`: 14 runtime/package files; no test fixtures, node_modules, local credentials or development files enter the hypothetical package. No package was published.

Security cases cover encrypted vault secrecy/integrity, wrong password, owner-only permissions, failed-transaction rollback, lock refusal, symlink refusal, fresh PKCE/state/nonce, reused client/host IDs, callback parameter ambiguity and identity confusion, malformed/wrong-state callbacks remaining live, constant plain-text error pages, valid-state denial, timeout/cancel, fixed endpoint and redirect policy, signed synthetic RS256 identity tokens and claim rejection, missing plan grants, rotating refresh tokens, reduced scopes, and malformed token-response redaction.

Protocol cases cover system/developer/text/tool history translation, unsupported input rejection, account-specific catalog order/visibility, fragmented UTF-8/CRLF SSE, malformed/truncated frames, text and parallel function-call blocks, disjoint token accounting, post-delta quota failure, incomplete/disconnected streams, unsupported output refusal, public endpoint/attribution/stream/store wire flags, HTTP failures without response-body reflection, and prepared-request invalidation following account change/logout.

No live OpenAI sign-in, actual subscription request, live refresh/revocation, full DSH desktop installation, visual metadata rendering, or production tool loop was performed. All test credentials and generated signing keys are synthetic. Real-world availability and eligibility remain unverified. No user DSH profile was modified and no production credential was generated.
