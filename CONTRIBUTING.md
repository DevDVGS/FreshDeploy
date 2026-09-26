# Contributing

Issues and small, focused pull requests are welcome. Please explain the problem, add a regression test where possible, and run:

```bash
npm ci
npm run check
npm test
```

Keep the core framework-agnostic. Adapters should avoid rewriting existing project files. Do not add dependencies without a clear reason. Never submit keys, credentials, `.env` files, or production user data.

MIT license. Please be respectful and keep discussions technical and constructive.
