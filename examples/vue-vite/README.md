# Vue + Vite

```bash
npm run build
freshdeploy stamp --out dist --commit "$GITHUB_SHA"
# upload dist/ including .freshdeploy.json
freshdeploy check --expected "$GITHUB_SHA"
```

The widget is vanilla JavaScript and can be mounted from a Vue component or normal script.
