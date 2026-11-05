# Contributing

Bug reports, documentation fixes, and focused pull requests are welcome. Use [GitHub issues](https://github.com/herenke/dsh-chatgpt-subscription/issues) for non-sensitive reports; follow [Security](SECURITY.md) for vulnerabilities.

## Development setup

Requirements: Node.js 22+, npm, and Git. DSH is needed for installation/UI integration checks, but the automated suite uses the locked development dependencies and synthetic credentials.

```sh
git clone https://github.com/herenke/dsh-chatgpt-subscription.git
cd dsh-chatgpt-subscription
npm ci --ignore-scripts
npm test
npm run check
npm audit
npm pack --dry-run --ignore-scripts
```

There are no install/postinstall/prepare scripts or build step. The browser artifact is authored directly in `client.js`. The package is private and not published to npm; source installation is documented in the README.

The host supplies the `@deepseek-ai/dsh-llm` and `@deepseek-ai/schemastery` peer contracts. The lockfile reproduces the development graph, not every host installation. Do not assume root dependency overrides also affect users' DSH installations.

## Change guidelines

- Keep changes focused and add regression tests for behavior changes.
- Preserve the official-endpoint allowlist, redirect rejection, PKCE/identity checks, encrypted atomic credential writes, account isolation, and cancellation behavior.
- Do not introduce token logging, plaintext credential storage, endpoint overrides, paid fallback, or automatic purchases.
- Treat provider output and citations as untrusted. Tool authorization belongs to DSH.
- Update both README languages for user-facing changes. Keep implementation/test details out of the README's introduction.
- Document actual compatibility and test scope. Passing synthetic tests does not prove live-account or UI behavior.
- Keep the package manifest and lockfile synchronized. Review the package inventory before distributing an artifact.

## Integration checks

See [Testing](VALIDATION.md) for the compatibility matrix and manual checklist. Use an isolated DSH profile/home for installation probes rather than modifying a normal profile. UI integration needs the host's settings services and slots, not just the LLM adapter API.

Restart the affected DSH process after changing source or adding a Client module unless the host's development tooling explicitly supports that change live. Toggle behavior must be tested separately from module loading.

Live tests use a contributor's own eligible account, may consume subscription usage, and must be run deliberately. Do not request or share account tokens, passphrases, or authorization URLs. Never commit a vault, a passphrase file, environment dumps, or unredacted logs.

## Reporting bugs

Include:

- Repository commit and DSH, Node.js, and OS versions.
- Installation method and affected profile name, without private filesystem details.
- Minimal reproduction, expected result, and actual result.
- Sanitized error stage/code and relevant configuration with secrets removed.
- Whether network access to the official hosts is available from the DSH process.

Do not attach the credential vault even though it is encrypted. Replace account identifiers and conversation data in screenshots/logs as appropriate.

## License

Contributions are made under the project's [MIT license](LICENSE).
