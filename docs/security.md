# Limits and security

- Verifies a configured HTTP(S) site; it does not discover deployment targets or configure third-party hosting credentials.
- Checks same-origin HTML resources and eligible manifest assets only. Excludes third-party CDNs, dynamically loaded routes, and API behavior.
- Detects possible HTML caching risks, not the private cache state of every visitor.
- Browser widget is opt-in and must be gated by the host app if only administrators should see it.
- `stamp` reads files from the specified public output directory and never follows symlinks. Do not aim it at sensitive/private project folders.
- `check` downloads resources (default: up to 25, maximum 6 MB each; 10-second request timeout). Set `--max-assets` to increase count, with caution on large production sites.
- Do not run verification on arbitrary untrusted URLs inside a privileged internal network; the CLI makes network requests to configured sites.
- This release is an MVP. It is not a security scanner, uptime guarantee, comprehensive crawler, or substitute for end-to-end tests.

- The full `--report` JSON may contain resource URLs and detailed errors: keep it as a CI artifact. Only publish the explicit sanitized `--public-report` output, and only if public metadata is acceptable.
- A same-origin public report is operational status, not an authenticated attestation. It must be published after verification; stale or missing reports are reported as warnings, never successes.

- Optional SSE is a transport for sanitized reports, not an authentication or integrity mechanism. Its development server listens only on loopback, requires an exact allowed browser origin, and must not be exposed directly on the public Internet.
- Publicly displayed version/commit metadata may reveal deployment details; gate the widget behind your own authentication if necessary.
- The browser cannot alter the trusted monitor's check interval or skip SHA-256 checks.
