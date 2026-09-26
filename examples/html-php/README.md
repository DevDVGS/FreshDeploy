# HTML / PHP

```bash
# Execute only against the directory served publicly, not your PHP source tree
freshdeploy stamp --out public --version 1.0.0 --commit "$GITHUB_SHA"
# upload the public directory, including .freshdeploy.json
freshdeploy check --expected "$GITHUB_SHA"
```

Server-side PHP output can have variable HTML. The manifest covers static public assets only. For a PHP project without a separate `public/` directory, set an explicit safe document root. No existing PHP files are rewritten.
