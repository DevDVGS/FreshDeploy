# Monitoring

FreshDeploy checks deployed HTML, version and public SHA-256 assets from a **trusted process**, not from browser JavaScript. The widget only reads a sanitized public report. It does not claim a missing or stale report is verified.

## Presets

| Preset | Server checks | Widget polling | Use case |
| --- | ---: | ---: | --- |
| Local | 2 s | 1 s | Tiny local builds and testing |
| Production | 30 s | 10 s | Modest sites and normal hosting |
| Custom | 1–86400 s | 1–3600 s | Adjust to site size, rate limits and infrastructure |

Set project defaults once:

```bash
freshdeploy settings --profile local --language es
freshdeploy settings --profile production
freshdeploy settings --profile custom --interval 5 --widget-interval 3
```

The browser settings offer Local, Production and Custom, but **only change that browser's polling interval**. Changing server frequency requires permission to modify the trusted monitor configuration and restart it. Rebuild if you change the browser's *default* settings in the project. No simultaneous checks are started: the server interval begins after each check completes.

## Polling: works everywhere

Run `freshdeploy watch` locally or on a trusted server after building and stamping the files. The tool reads the URL, build version and public report location from `freshdeploy.config.json` / the manifest automatically. It must keep running for continuous monitoring. For purely static hosting, use a scheduled worker or post-deploy CI run to publish the latest public report—static files alone cannot continuously scan themselves.

## SSE: faster notification, optional

With a local app served at the URL configured during setup:

```bash
freshdeploy watch --live
```

The built-in endpoint binds to `127.0.0.1:4318`; choose the SSE endpoint for your widget before building:

```powershell
$env:VITE_FD_SSE_URL = 'http://127.0.0.1:4318/events'
npm.cmd run build
Remove-Item Env:\VITE_FD_SSE_URL
```

Or configure the endpoint once with `freshdeploy settings --sse-url ...` before building. The SSE stream sends a report only when its **meaningful results** change; lightweight heartbeats preserve the connection and the newest timestamped report is replayed to newly connected browsers. If the connection drops, the widget resumes polling. It stays open and does not reload the site.

SSE cannot make a server scan instantaneous. A large site may take longer than its chosen interval. The local listener is not a hosted relay: HTTPS production deployments require your compatible server/reverse proxy and an exact permitted browser origin. Do not expose the development listener directly to the Internet.

Private detailed reports belong outside the served directory. Publish only `.freshdeploy-report.json` created by `--public-report`; remember even that contains public version/commit data. A report older than the configured age becomes a warning.

## Terminal output

The monitor runs every configured interval but prints only changed outcomes (for example, `WARN → FAIL → WARN`). It continuously refreshes the timestamp in the public report and sends SSE only when meaningful results change. A failed check produces a warning report instead of leaving an old success visible. Detailed diagnostics remain available through `freshdeploy check --report ...`.
