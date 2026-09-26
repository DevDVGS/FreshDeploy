# Maintainer release checklist

This repository and npm package are **release candidates**, not a completed publication.

1. Confirm `npm whoami` returns `devdags` and verify the intended `@devdags/freshdeploy` package name before publishing. GitHub identity does not grant npm publishing permission.
2. Create the repository `DevDVGS/FreshDeploy` under the intended account. Check its visibility, license, default branch and CI permissions.
3. Run `npm ci`, `npm run check`, `npm test` and `npm run release:check` on Windows and Linux (CI checks both). Tests exercise the packed CLI installed offline into a separate project.
4. Run `npm pack --workspace @devdags/freshdeploy --pack-destination <output-directory>`; review the tarball contents, `package.json`, README and MIT license. Do not publish `node_modules`, credentials, local config or private reports.
5. Test `setup` in a clean React/Vite or Vue/Vite project, build, deploy and execute a **post-deploy** check. Next.js, Angular and HTML/PHP currently have generic CLI integration, not automatic widget installation.
6. Connect the inactive workflow example after the **actual** deployment and keep detailed reports as private CI artifacts. Publish only explicitly sanitized report metadata if the site is meant to display it.
7. Publish npm only after the authorized account confirms the scope. Publish a pre-release with `npm publish --workspace @devdags/freshdeploy --access public --tag beta`. Use the npm account's required authentication.
8. Tag source `v0.5.0-beta.1` and publish the GitHub **pre-release** matching the npm version. Do not call this stable until release testing is complete.

Local preview reports are deliberately sanitized sample data, not production reports. The bundled SSE server binds to loopback and is not a public production relay.
