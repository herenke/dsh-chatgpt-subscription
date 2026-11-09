# Testing and compatibility

This document describes test coverage and reproducible checks. It is not a certification of security, platform support, account eligibility, or service availability.

## Automated checks

Run from the repository root with Node.js 22+:

```sh
npm ci --ignore-scripts
npm test
npm run check
npm audit
npm pack --dry-run --ignore-scripts
```

The latest recorded run on 2026-11-09 used macOS and Node.js 22.23.3: **93 tests passed**, syntax checks and package inventory passed, and the locked development graph reported zero audit vulnerabilities. Audit results are time-dependent and do not cover the host's separately installed dependencies.

### Coverage

| Area | Automated coverage |
| --- | --- |
| OAuth | Fresh PKCE/state/nonce; callback ambiguity, identity and claim checks; synthetic RS256 signatures; denied/cancelled/timed-out attempts; actual-grant enforcement. |
| Vault | Encryption and integrity; wrong passphrase; ownership/permissions and symlink refusal; atomic writes; rollback; read-only access without writes; bounded locks; concurrent and cross-process refresh-token rotation. |
| HTTP and errors | Official endpoint allowlist; redirect refusal; administrative deadlines; caller cancellation; no inference total deadline; redacted diagnostics; typed context/quota errors. |
| Responses | Message/tool translation; fragmented SSE; absent Content-Type; explicit non-SSE rejection; parallel calls; disjoint token usage; failed/incomplete/disconnected streams; text and tool arguments delivered only in the `done` event, while non-extending or repeated completions still fail closed. |
| Models | Account catalog filtering/order; cache invalidation; context precedence; accepted reasoning efforts; host rejection of unsupported effort before dispatch. |
| Prompt cache | Opaque session identity derived from the DSH session, stable across a session, distinct for auxiliary calls, and omitted when the caller supplies none; forwarded through the real runtime. |
| Images and replay | Attachment/reference validation; normalization targets and budgets; offload; real DSH runtime projection; replay binding to identity/model/content; successful replay persistence only. |
| Web search | Opt-in request flag; citation extraction from final output and annotation events; disallowed URL schemes; no hosted-call dispatch as a local function. |
| Plugin lifecycle | Cordis activation/disposal; credential-lazy activation; disabled startup; live registration changes on volatile updates. |
| Client module | Models footer-slot registration, locale registration, and configuration-form lookup using a synthetic module loader. This is not a browser interaction test. |

No live OpenAI credentials are needed by the automated suite. Test keys, tokens, and identities are synthetic.

## Compatibility matrix

The manifest accepts DSH `>=0.2.1-rc.5 <0.3.0-0`. The upper bound excludes 0.3.0 prereleases. Accepted but untested adapter-package versions produce a runtime warning rather than being silently skipped.

| DSH LLM package | Recorded checks |
| --- | --- |
| `0.2.1-rc.5` | Locked development dependency; current 93-test suite. Local-directory and tarball installation/activation probes; live LLM runtime integration. |
| `0.2.2-alpha.3` | Earlier 74-test suite and adapter-contract checks. The complete current suite has not been rerun on this version. |
| `0.2.2-rc.1` | Earlier 82-test suite with Cordis 4.1.0 in a temporary dependency graph; isolated installation/activation and Desktop conversation use. A Windows 11 run on 2026-11-06 (host DSH 0.2.2-rc.1, Node.js 24.16.0) reported 70 of 74 tests passing, with the same four POSIX-only failures as the 0.2.1-rc.5 baseline on that machine. The full current 93-test suite has not been rerun on this version. |

The adapter contract and the Client settings integration are separate compatibility surfaces. Client behavior also depends on `settings.models.footer`, `configForms`, and locale services. Windows/Linux permission, browser, and Desktop integration are not verified; Windows ACL enforcement is not implemented.

## Live integration scope

Live-account checks on macOS during 2026-11-03–04 covered:

- Official browser sign-in, dynamic registration, ID-token validation, encrypted credential persistence, and account-scoped model discovery.
- Streaming text and usage through the real DSH LLM runtime.
- One local function-tool round trip with native reasoning replay.
- One inline PNG image request. This does not establish real DSH attachment-upload integration.
- Refresh-token rotation and persistence, followed by model discovery without reauthorization.
- Per-model reasoning metadata and requests with selected effort levels; filtering a catalog-advertised effort rejected by the route.
- Opt-in hosted web search, annotation-event citations, and an appended source list.
- Wire-level cache behavior: identical requests without a conversation identity reuse no cached prefix, while a stable `session_id` reuses about 99% of it; this is why the adapter now forwards the DSH session identity. Cached-token accounting itself is read from the streamed usage.
- Use of the configured provider for a Desktop conversation on DSH 0.2.2-rc.1.

Live checks found two wire-format differences now covered by regression tests: SSE responses without Content-Type, and search citations delivered as annotation events while final `output` is empty. These are compatibility observations, not guarantees for every model/account.

### Remaining manual checks

The following are not established by the recorded live checks:

- Complete GUI disable/re-enable and persistence round trip, including picker behavior while offline.
- Live remote revocation; testing it invalidates the working session.
- Image upload through the real DSH attachment service.
- Replay after a hosted web-search turn.
- Long-running tool loops, actual context compaction/overflow recovery, and quota recovery under real account limits.
- Cross-platform integration and sustained or production-scale reliability.

## Integration checklist

For a release or compatibility change:

1. Run the automated checks from a clean dependency install.
2. Test installation from a local directory and a packed artifact in an isolated `DSH_HOME`/profile. Check activation without a credential environment; activation should not require sign-in.
3. Verify that the intended runtime resolves its own peer dependencies, not an accidental development copy.
4. With an authorized test account, sign in and confirm the model list, streaming text, local tool round trip, and selected reasoning effort.
5. Open Settings → Models. Disable the provider, reopen the picker, and confirm it does not load the provider. Re-enable, verify persistence after restart, and restore the original state.
6. Test optional image/search paths only when relevant. Record which paths actually used host services and which used injected fixtures.
7. Review the package inventory and sanitize any evidence before sharing it.

Use only an account authorized for testing. Live requests may consume subscription usage. Do not commit credentials, passphrases, account identifiers, or unredacted authorization/network traces.
