# Browser widget

The widget is optional and only displays a sanitized same-origin post-deploy report. Its panel stays open when status changes. Timestamp-only updates do not repaint it. English is the default; Spanish and a browser-only monitoring preset are available in Settings.

For standard React/Vite and Vue/Vite projects, `freshdeploy setup` copies the managed widget files and adds `prebuild` / `postbuild` hooks. `npm run build` automatically pins version/commit and stamps the public assets. Rerunning `setup` upgrades recognized official files, backs up earlier entry points and **keeps edited files**.

The client cannot change privileged server checks. Its setting controls only how often that browser polls; server intervals belong to the CLI. Optional SSE notifications can deliver a new report as soon as the monitor finishes. On disconnect, polling resumes.

For a custom integration, mount `mountFreshDeploy({ expectedVersion, expectedCommit, reportUrl, manifestUrl, pollIntervalMs, language, mode, sseUrl })` from the widget package. Only display it to visitors who may see version/commit and deployment status. Never publish detailed private reports.
