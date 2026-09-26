# Integration

FreshDeploy separates **stamp** (before deployment) from **check** (after deployment). A successful build alone does not prove that the expected version was published.

1. After the npm release, run `npx @devdags/freshdeploy setup` from the project root once (or pass `--url https://your-site.example/` to skip its URL prompt). During source testing use the local `packages/cli/bin/freshdeploy.js` path.
2. For React/Vite and Vue/Vite, the installed `prebuild` / `postbuild` hooks generate `.freshdeploy.json` automatically with `npm run build`. For other frameworks, stamp the **public build output** at the documented lifecycle step.
3. Deploy that output, including the manifest.
4. Run `freshdeploy check --expected "$GITHUB_SHA" --report freshdeploy-report.json` only after the deployment succeeds.

The installed project's `freshdeploy.config.json` is read on later runs, so the URL is not re-entered. Set `FD_URL` to override it in CI. Provide `FD_EXPECTED` (or `--expected`) to verify the published version. If `--expected` is omitted, the CLI uses the local stamped manifest when available. If neither is present, freshness cannot be established and the report warns rather than claiming success.

## Build adapters

| Project | When to stamp | Example |
|---|---|---|
| React + Vite | After `vite build` | `npm run build` (auto stamp after setup) |
| Vue + Vite | After `vite build` | `npm run build` (auto stamp after setup) |
| Next.js | **Before** `next build` | `freshdeploy stamp --out public` |
| Angular | After build | `freshdeploy stamp --out dist/my-app/browser` (adjust to `angular.json`) |
| HTML / PHP | Before uploading public files | `freshdeploy stamp --out public` (your actual document root) |

Next.js note: the pre-build stamp covers `public/` assets, not Next-managed chunk hashes. The live HTML's same-origin links are checked for availability; version checks use the served manifest. For non-static Next deployments, verify that your hosting actually serves `public/.freshdeploy.json`.

Angular output paths vary by builder and version; inspect the actual directory containing `index.html`. For PHP, never stamp your private source folder. `stamp` deliberately excludes `.env`, hidden files, PHP, and symlinks, but the target still must be the directory you publish.

## GitHub Actions

`setup` (or `init`) writes **`docs/freshdeploy-workflow.example.yml`**, an inactive template. Nothing runs on GitHub until you explicitly connect it to your actual deployment. This workflow listens for a successful `deployment_status` event and uses the deployment URL and SHA provided by GitHub. **Not every hosting provider emits that event.** If it doesn't, add the following step **after** your real upload/deploy step instead:

```yaml
- name: Verify published build
  env:
    FD_URL: ${{ vars.PRODUCTION_URL }}
    FD_EXPECTED: ${{ github.sha }}
  run: |
    npm exec --yes --package=@devdags/freshdeploy@0.5.0-beta.1 -- freshdeploy check --report freshdeploy-report.json
```

Publish the package first or adapt the command to use your own local checkout. The npm tarball is self-contained; the public CLI does not require separate core/widget package releases. The workflow is a starter template, not a universal connection to every provider. Configure deployment permissions and environment protection separately as needed.

The generated workflow uploads `freshdeploy-report.json` as a GitHub artifact; the CLI exits with code 1 on warnings/failures so CI can flag it. `--json` prints machine-readable JSON; `--report` writes a full local JSON report. `--public-report` writes a sanitized, browser-readable report to a path you choose. You must upload that report separately after the check; the CLI does not publish files.

## Comparison and limits

```bash
freshdeploy check --expected "$GITHUB_SHA" --previous previous.freshdeploy.json
freshdeploy check --max-assets 100 --report report.json
```

`--previous` accepts an earlier **manifest**, not an earlier report. It lists added, changed and removed files by hash. Store earlier manifests as pipeline artifacts if you need cross-run comparisons. By default, a bounded subset of at most 25 same-origin resources is checked; the report says how many were skipped. Raise the limit for larger sites. This is a fast deployment smoke test, not a full crawler.

For subdirectory deployments, configure a trailing-slash URL such as `https://example.com/app/` so the manifest is resolved at `/app/.freshdeploy.json`.

## Optional live status widget

The browser widget requires a build-time pinned version/commit and a same-origin post-deploy summary. Create the latter only with `--public-report` and publish it at `/.freshdeploy-report.json` (or your configured subpath) **after** the deployment check, including when the check reports an issue. It never uploads itself. It displays a warning if the report is missing, malformed, or belongs to an older version. Read [Widget](widget.md) for code and privacy details.
