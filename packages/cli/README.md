# FreshDeploy CLI

Minimal post-deployment verification for modern web projects. Node.js 20+, no third-party runtime dependencies.

```bash
npx @devdags/freshdeploy setup
npm run build
# deploy using your existing workflow
npx @devdags/freshdeploy check
```

`setup` automatically mounts a widget and build hooks for standard React/Vite and Vue/Vite projects. Next.js, Angular and HTML/PHP use framework detection and explicit build-output configuration. A successful build **does not** prove the deployed site is current; run `check` after deployment.

For live local monitoring: `npx @devdags/freshdeploy watch --live`. The optional SSE stream requires a compatible running endpoint; polling requires no extra server. Never publish a private report.

[Integration](docs/integration.md) · [Monitoring](docs/automatic-monitoring.md) · [Security](docs/security.md) · [Español](docs/quick-start-es.md)

Source preview: not yet published to npm. Package scope availability and ownership must be checked before release. MIT license.
