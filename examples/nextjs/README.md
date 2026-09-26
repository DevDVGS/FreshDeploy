# Next.js

```bash
freshdeploy stamp --out public --commit "$GITHUB_SHA"
npm run build
# deploy using your usual Next.js hosting provider
freshdeploy check --expected "$GITHUB_SHA"
```

The public manifest is copied into the final deployment. Next-managed chunks are checked for availability from live HTML, not hashed from `.next`. The hosting provider must serve public assets as expected.
