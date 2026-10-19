# Publication de Couteau Suisse

Le code source de la branche `main` est la source de publication.

Cloudflare Workers Builds et GitHub Actions exécutent les tests avant de publier :

```sh
node tests/stripe-payment.test.mjs && node tests/gps-routing.test.mjs
npx wrangler deploy --config wrangler.toml
```

Ne pas décompresser `CarPlay-TELEPHONE-GITHUB-CLOUDFLARE-V5.zip` pendant la compilation : ce fichier de distribution est généré après le commit et pourrait remplacer le code courant par la version précédente.

`gps-legacy-redirect.mjs` renvoie l'ancien domaine GPS vers l'accueil de Couteau Suisse. `stable-proxy.mjs` utilise le service `CORE` courant, sans verrouiller une ancienne version.
