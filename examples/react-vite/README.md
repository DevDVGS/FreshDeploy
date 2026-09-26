# React + Vite

Build and stamp **before** deploying; check the live site **after** deployment:

```sh
VITE_FD_VERSION=1.0.2 npm run build
freshdeploy stamp --out dist --version 1.0.2 --commit "$GITHUB_SHA"
# Deploy dist/ including .freshdeploy.json
freshdeploy check --expected "$GITHUB_SHA" \
  --report freshdeploy-report.json \
  --public-report .freshdeploy-report.json
# Publish the sanitized .freshdeploy-report.json to the same origin separately.
```

For automatic widget integration and build hooks, run `npx @devdags/freshdeploy setup` from the app root once the package is published. The widget is bundled inside the CLI distribution; `@devdags/freshdeploy-widget` is an internal workspace, **not** a separately published dependency. For local source testing, run `node <FreshDeploy-folder>/packages/cli/bin/freshdeploy.js setup`.
