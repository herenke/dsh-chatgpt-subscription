# Historical review scope

This document summarizes the initial review of the early implementation on 2026-11-03. It is retained for traceability, not as a current defect list or installation guide. The original development-session instructions, machine-specific paths, and transient environment notes have been removed.

For current behavior, see the [README](README.md). For dispositions and deviations, see [Review resolution](REVIEW-RESOLUTION.md). For test scope, see [Testing](VALIDATION.md).

## Review areas

| ID | Original concern | Acceptance objective |
| --- | --- | --- |
| B1 | An exact DSH version gate excluded the installed runtime. | Install and activate on supported versions without a compatibility exemption. |
| B2 | Vault creation during activation required a terminal-only passphrase environment. | Activate without credentials; load credentials only when used, with a GUI-compatible secret source. |
| H1 | Vault contention and refresh-token rotation could disrupt concurrent requests. | Read without rewriting; serialize rotating refreshes across processes; keep network I/O outside the state-write lock. |
| H2 | An administrative timeout also limited streaming inference. | Use bounded administrative requests and caller cancellation for inference. |
| H3 | Missing context metadata prevented host compaction from using model capacity. | Supply capacity with documented precedence and typed context-overflow errors. |
| M1 | Retry-policy output needed verification against the host contract. | Use the host-resolved shape and keep automatic inference retries disabled. |
| M2 | Repeated model discovery added latency and amplified contention. | Share in-flight discovery and cache by account/session/token. |
| M3 | Overly generic errors prevented useful host recovery. | Map known context/quota/auth failures without reflecting sensitive response bodies. |
| M4 | Incomplete responses needed explicit handling. | Never execute partial tool calls or persist a successful replay for incomplete output. |
| M5 | CLI errors lacked safe diagnostic context. | Report the failing stage and allowlisted codes without secrets. |
| M6 | Installation instructions did not distinguish profiles. | Document Desktop/web profiles, credential setup, and restart requirements. |
| D1 | Repository distribution/access needed clarification. | Provide a public source-installation path. |

## Review constraints

The review required preserving fixed official endpoints, redirect rejection, PKCE and identity verification, encrypted atomic credential writes, permission checks, `store:false`, and `stream:true`. It did not authorize importing another application's credentials, endpoint overrides, or paid fallback.

Initial testing used synthetic credentials. Subsequent live integration is recorded separately in [Testing](VALIDATION.md); early unverified statements must not be treated as the current coverage assessment.
