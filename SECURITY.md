# Security policy

## Reporting a vulnerability

Do not post credentials or exploit details in a public issue. Use GitHub's **Report a vulnerability** option on this repository if it is available. If private reporting is unavailable, open a minimal issue asking the maintainer for a private contact channel, without including exploit details or sensitive material. No response-time commitment or security certification is provided.

Never include a vault, passphrase file, access/refresh/ID token, authorization URL, full callback URL, unredacted network trace, or token response in a report. Provide the affected commit, DSH/Node/OS versions, impact, and a reproduction using synthetic credentials where possible. Only the current repository revision is maintained; no separate security backport branches are defined.

If credentials may be compromised, disconnect the application in ChatGPT settings, stop untrusted processes, and reauthorize only from a trusted environment. Changing the local vault passphrase alone does not revoke an exposed OAuth token.

## Trust boundaries

This plugin is a local public OAuth client, not an OAuth proxy or hosted service. Explicit CLI `login` opens a browser; provider activation does not sign in, create a registration, or import another application's credentials.

- OpenAI receives identity/authorization requests, model-discovery requests, and inference data. Inference includes conversation text, tool declarations/results, retained image data, and eligible native replay. Optional hosted web search is processed by OpenAI.
- DSH and its loaded plugins share the local trust boundary. They may access process memory, environment variables, credentials, attachments, and conversation data. Install only trusted plugins.
- Account identity appears in CLI output and model descriptions sent to the DSH frontend. OAuth tokens are not intentionally exposed through those surfaces.
- Conversation and native replay data are stored in DSH session logs separately from the encrypted OAuth vault. Treat logs, exports, screenshots, and backups as sensitive.
- `store:false` is sent for inference; it is not a guarantee about OpenAI's logging or retention policies. Review the applicable service policies before sending sensitive data.

## Credential protection

The vault uses AES-256-GCM with a fresh 16-byte salt and 12-byte IV per write, and a scrypt-derived 256-bit key. The encrypted payload includes tokens, account mappings, and the installation host ID. Key buffers are cleared after encryption/decryption; JavaScript strings, environment variables, and decrypted objects cannot be reliably zeroized.

On Unix, the immediate vault directory and file require owner-only access (normally 0700/0600), matching ownership, and non-symlink paths. Writes use exclusive temporary files, file `fsync`, and atomic rename. Ordinary reads do not rewrite the vault. Separate cross-process locks serialize state changes and refresh-token rotation, with bounded waiting and cancellation. Refresh network I/O does not hold the state lock.

Passphrase environment variables and files are bootstrap mechanisms, **not a system keychain**. A passphrase file contains the plaintext decryption secret. Anyone able to read both it and the vault can decrypt the credentials. This design does not protect against same-user malware, debuggers, process inspection, untrusted DSH code, all ancestor-path races, or compromised OS accounts. Windows ACL enforcement is not implemented.

### Lock and recovery handling

A process crash can leave encrypted temporary files or lock directories. Never remove a lock while another CLI/plugin process may be using the vault. Stop all such processes, confirm the exact configured vault path, and only then remove a stale `<vault-path>.lock` or `<vault-path>.refresh.lock` directory.

A filesystem failure after refresh-token rotation can require reauthorization. Atomic file replacement does not guarantee directory metadata durability across power loss. Back up credentials only to protected storage; retain the matching passphrase separately according to your threat model. If the original passphrase is lost, the vault cannot be recovered by generating a new one.

## Authorization and network controls

- Each authorization attempt uses fresh state, nonce, and PKCE S256 material. The callback listener binds to `127.0.0.1` on an ephemeral port and validates method, path, Host, state, and callback parameters. Invalid callbacks do not consume the attempt; responses are constant plain text.
- ID tokens use RS256 verification against the fixed official JWKS endpoint, with issuer, audience/authorized party, time, nonce, and subject checks. JWT-supplied key URLs are not fetched. Requested scopes do not substitute for actual granted permissions.
- Only fixed official authorization, token, revocation, JWKS, models, and Responses endpoints are used. Request redirects are rejected; TLS uses Node defaults. There is no configurable API base URL or certificate bypass.
- Passphrases and refresh tokens are not sent to inference. Token endpoint bodies and JWTs are not intentionally logged. Error diagnostics expose a stage and allowlisted code rather than arbitrary response bodies.
- Administrative requests have bounded deadlines: model discovery 30 seconds, token/revocation/JWKS requests 120 seconds, and the browser callback wait 180 seconds. The callback wait is not a total deadline for all sign-in stages. Inference streaming relies on DSH caller cancellation rather than an internal total deadline.
- New requests recheck the active identity. Logout clears local tokens before attempting remote revocation. Account switches, new login sessions, and local logout invalidate prepared but undispatched requests; ordinary token rotation does not. Logout, disable, and account selection do not cancel all requests already dispatched across processes. Remote revocation may fail or take time.

## Model and tool data

Only a completed, internally consistent response is treated as successful. Failed, incomplete, disconnected, or malformed streams do not commit successful replay or execute a partial tool call through the adapter. Inference retries and paid fallback are not implemented by this plugin; host policy remains separate.

Images are read through the mounted DSH attachment service, not arbitrary paths or URLs. The host owns attachment integrity checks and decoding/normalization; the adapter checks references, supported MIME signatures, request metadata, budgets, and cancellation. Image data leaves the machine as part of an inference request.

Successful native replay can include opaque encrypted reasoning and is bound to account/client identity, provider/model, and visible-content digests. The plugin does not decrypt reasoning. Edited or compacted history falls back to visible history.

Hosted search is opt-in. Source links are restricted to HTTP(S) and formatted as Markdown; these links and model output are untrusted content, not an endorsement. DSH is responsible for tool authorization, prompt-injection defenses, rendering safety, and host-level execution policy. Local tools can have effects beyond the inference request.

## Dependencies and verification limits

The development lockfile overrides Zod to 4.6.6. The pinned development DSH dependency otherwise pulls Zod 4.4.3, affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Installing this plugin does **not** apply root overrides to the host's dependency graph. Host maintainers must audit and update their own dependencies; a clean repository audit does not certify the DSH installation.

Automated fixtures use synthetic tokens and signing keys. Live-account integration has been exercised separately on macOS without storing real credentials in the repository. Testing is not a security audit or platform certification. See [Testing](VALIDATION.md) for coverage and remaining limits.
