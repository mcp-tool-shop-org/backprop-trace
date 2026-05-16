# Ship Gate

> No repo is "done" until every applicable line is checked.
> Copy this into your repo root. Check items off per-release.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

---

## A. Security Baseline

- [ ] `[all]` SECURITY.md exists (report email, supported versions, response timeline)
- [ ] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required)
- [ ] `[all]` No secrets, tokens, or credentials in source or diagnostics output
- [ ] `[all]` No telemetry by default — state it explicitly even if obvious

### Default safety posture

- [ ] `[cli|mcp|desktop]` Dangerous actions (kill, delete, restart) require explicit `--allow-*` flag
- [ ] `[cli|mcp|desktop]` File operations constrained to known directories
- [ ] `[mcp]` Network egress off by default
- [ ] `[mcp]` Stack traces never exposed — structured error results only

## B. Error Handling

- [ ] `[all]` Errors follow the Structured Error Shape: `code`, `message`, `hint`, `cause?`, `retryable?`
- [ ] `[cli]` Exit codes: 0 ok · 1 user error · 2 runtime error · 3 partial success
- [ ] `[cli]` No raw stack traces without `--debug`
- [ ] `[mcp]` Tool errors return structured results — server never crashes on bad input
- [ ] `[mcp]` State/config corruption degrades gracefully (stale data over crash)
- [ ] `[desktop]` Errors shown as user-friendly messages — no raw exceptions in UI
- [ ] `[vscode]` Errors surface via VS Code notification API — no silent failures

## C. Operator Docs

- [ ] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions
- [ ] `[all]` CHANGELOG.md (Keep a Changelog format)
- [ ] `[all]` LICENSE file present and repo states support status
- [ ] `[cli]` `--help` output accurate for all commands and flags
- [ ] `[cli|mcp|desktop]` Logging levels defined: silent / normal / verbose / debug — secrets redacted at all levels
- [ ] `[mcp]` All tools documented with description + parameters
- [ ] `[complex]` HANDBOOK.md: daily ops, warn/critical response, recovery procedures

## D. Shipping Hygiene

- [ ] `[all]` `verify` script exists (test + build + smoke in one command)
- [ ] `[all]` Version in manifest matches git tag
- [ ] `[all]` Dependency scanning runs in CI (ecosystem-appropriate)
- [ ] `[all]` Automated dependency update mechanism exists
- [ ] `[npm]` `npm pack --dry-run` includes: dist/, README.md, CHANGELOG.md, LICENSE
- [ ] `[npm]` `engines.node` set · `[pypi]` `python_requires` set
- [ ] `[npm]` Lockfile committed · `[pypi]` Clean wheel + sdist build
- [ ] `[vsix]` `vsce package` produces clean .vsix with correct metadata
- [ ] `[desktop]` Installer/package builds and runs on stated platforms

## E. Identity (soft gate — does not block ship)

- [ ] `[all]` Logo in README header
- [ ] `[all]` Translations (polyglot-mcp, 8 languages)
- [ ] `[org]` Landing page (@mcptoolshop/site-theme)
- [ ] `[all]` GitHub repo metadata: description, homepage, topics

---

## Gate Rules

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification — don't leave it unchecked.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."

**Checking off:**
```
- [x] `[all]` SECURITY.md exists (2026-02-27)
```

**Skipping:**
```
- [ ] `[pypi]` SKIP: not a Python project
```
