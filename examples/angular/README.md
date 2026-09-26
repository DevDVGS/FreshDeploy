# Angular

```bash
npm run build
# Adjust the path to the real folder containing index.html
freshdeploy stamp --out dist/my-app/browser --commit "$GITHUB_SHA"
# deploy the browser output
freshdeploy check --expected "$GITHUB_SHA"
```

For older Angular versions the output may be `dist/my-app` instead.
