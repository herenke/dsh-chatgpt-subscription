# Review resolution

Reviewed 2026-11-03 against the supplied handoff, the installed DSH 0.2.1-rc.5 runtime and official 0.2.2-alpha.3 LLM package. Original reviewer notes remain a local input rather than a package/publication artifact.

| Item | Decision and implementation |
| --- | --- |
| B1 version gate | Confirmed. Version 0.2.0 accepts exactly the two verified DSH versions. A broad future prerelease range would claim untested compatibility. No exemption was used. |
| B2 GUI activation | Confirmed. Vault loading is lazy; activation registers the provider without a passphrase. Added strictly validated optional passphrase-file/vault/context settings and owner-only file loading. |
| H1 credential contention | Confirmed. Read-only snapshots, change-only writes, bounded state-lock waiting, stable login identity and cross-process refresh serialization added. The suggested unlocked refresh followed by CAS alone could still consume a rotating token twice: a separate refresh mutex prevents that race while keeping network I/O outside the state lock. Logout clears local credentials before remote I/O; discarded rotated credentials are revoked best-effort. |
| H2 long streams | Confirmed. Responses follows caller cancellation without an internal total deadline; administrative endpoints remain bounded. |
| H3 compaction capacity | Confirmed. Both resolved and prepared models expose context capacity: per-model override, global override, catalog, then documented 32768-token estimate. Overflow maps to the host recovery code. Actual model capacity must still be checked. |
| M1 retry-policy shape | The suggested nested return shape does not match either inspected ResolvedRetryPolicy contract. The adapter now delegates to the host resolveRetryPolicy helper and tests its actual resolved output. Automatic inference retries remain disabled. |
| M2 catalog cache | Added 60-second account/session/token-scoped cache with shared in-flight discovery. |
| M3 safe errors | Known provider context/quota/auth codes map to typed host errors; raw provider bodies and arbitrary codes are never echoed. |
| M4 incomplete responses | Kept strict failure semantics, adding a typed reason. Truncated output must not execute a partial tool call or save a successful native replay. |
| M5 CLI diagnostics | Added safe stage and allowlisted code diagnostics without raw exception text, URLs or token data. |
| M6 documentation | Both README languages document Desktop/web profiles, restart, GUI credentials, optional configuration and validation limits. |
| D1 repository access | Previously resolved: repository is public and the authorized GitHub App is scoped to this repository. |

Protocol endpoints, JWT/callback checks, redirect refusal, encrypted atomic writes, permission checks and store:false/stream:true remain enforced. No endpoint override, hidden paid fallback, real account login or real credential generation was introduced.

Validation: 74 tests passed separately for each supported LLM package version; syntax checks, root dependency audit and package inventory passed. The installed macOS CLI loaded the local directory and packed artifact using isolated temporary profiles without a version exemption or credential environment. Real subscription inference, live refresh/revocation, GUI rendering and Windows/Linux behavior remain unverified.
