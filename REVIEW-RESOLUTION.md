# Historical review resolution

Disposition of the [initial review](REVIEW-HANDOFF.md), with follow-up through 2026-11-04. This is an engineering decision record, not the current user guide. Current compatibility and verification limits are maintained in [Testing](VALIDATION.md).

| ID | Disposition |
| --- | --- |
| B1 — version gate | Changed to `>=0.2.1-rc.5 <0.3.0-0` after an enumerated gate caused a compatible Desktop upgrade to skip the bundle. Adapter versions outside the tested set log a warning. This is an acceptance policy, not proof of every version in the range. |
| B2 — GUI activation | Credential loading is lazy. Optional owner-only passphrase files support GUI launches. Activation itself requires no sign-in or passphrase. |
| H1 — credential contention | Added read-only snapshots, change-only writes, bounded locks, stable login identity, and a separate cross-process refresh lock. A compare-and-swap prevents stale refresh results from restoring signed-out/replaced credentials. CAS without refresh serialization was rejected because it can consume a rotating token twice. |
| H2 — streaming deadline | Removed the internal inference total deadline; administrative calls remain bounded. Streaming follows host cancellation. |
| H3 — context capacity | Resolved/prepared model metadata supplies per-model override → global override → catalog → 32768-token estimate. Known context-overflow errors map to the host recovery code. Live compaction/recovery is not established by metadata tests alone. |
| M1 — retry policy | Delegated policy normalization to the host's `resolveRetryPolicy` helper and tested the resolved result instead of manually assuming its shape. Automatic inference retries remain disabled. |
| M2 — model discovery | Added a 60-second account/session/token-scoped cache and shared in-flight discovery. |
| M3 — safe errors | Known provider errors map to typed host failures. Raw bodies and arbitrary codes are not echoed. |
| M4 — incomplete output | Retained failure semantics with a typed reason. Truncation must not execute a partial tool call or persist successful native replay. |
| M5 — CLI diagnostics | Added stage-specific diagnostics and allowlisted codes without raw exception messages, URLs, or tokens. |
| M6 — documentation | Added profile-specific source installation, GUI-compatible credential setup, configuration reference, and troubleshooting. |
| D1 — distribution | Documented public repository source installation. The package remains private to prevent accidental npm publication. |

## Subsequent integration fixes

- Accept absent SSE Content-Type while continuing to reject an explicitly incompatible type.
- Collect hosted-search citations from annotation events when final response output is empty.
- Expose catalog reasoning efforts filtered to values accepted by the route.
- Add the Models settings card and a volatile `enabled` field; disabling unregisters the adapter without deleting credentials.

The fixed-endpoint, authorization, encryption, account-isolation, and no-paid-fallback boundaries remain in place. See [Security](SECURITY.md) for the current threat model and [Testing](VALIDATION.md) for what has and has not been exercised.
