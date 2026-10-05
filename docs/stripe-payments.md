# Paiement Couteau Suisse : 30 € pour 365 jours

Paiement unique via Stripe Checkout, sans abonnement ni renouvellement automatique. Checkout propose Apple Pay aux appareils et cartes compatibles. Les cartes sont traitées chez Stripe.

## Activation sur le Worker carplay-telephone

1. Terminer l’activation du compte Stripe et utiliser le mode réel.
2. Cloudflare → Workers & Pages → carplay-telephone → Settings → Variables and Secrets : ajouter **STRIPE_SECRET_KEY**, de type **Secret**, avec la clé Stripe réelle commençant par sk_live_ ou rk_live_ (avec les autorisations Checkout nécessaires). Ne jamais mettre cette clé dans GitHub, le navigateur ou une conversation.
3. Dans Stripe → Workbench → Webhooks, créer une destination pour les événements de **votre compte**, avec des événements snapshot : checkout.session.completed et checkout.session.async_payment_succeeded.
4. URL de destination : https://carplay-telephone.appli-suzon.workers.dev/api/stripe-webhook
5. Ajouter son secret de signature whsec_… dans Cloudflare, de type Secret, sous **STRIPE_WEBHOOK_SECRET**.
6. Conserver le secret CODE_PEPPER existant : ne pas le remplacer. Les e-mails utilisent la configuration Brevo existante.
7. Déployer la nouvelle configuration de secrets. GET /api/payment-config doit retourner configured:true. Le bouton de paiement s’affiche alors dans Réglages → Abonnement et sur l’écran d’accès payant.

## Comportement

Le tarif, la durée et le produit sont définis sur le serveur. L’achat exige un compte dont l’e-mail a été confirmé sur l’appareil. Le code de six caractères est créé seulement pour une session réelle payée de 30 EUR correspondant à une commande de cette application. Un paiement test ne crée pas d’accès réel.

Le code est affiché sur la page de retour, accessible avec le jeton enregistré sur l’appareil ayant commencé le paiement. Si Safari et la PWA ne partagent pas leur stockage, le code reste disponible dans l’e-mail envoyé au titulaire. Il s’active ensuite dans Réglages → Abonnement. Le code est réservé au nom, prénom et e-mail de l’acheteur. Les jours payés restants sont conservés à l’activation, et les 365 jours ne s’ajoutent qu’une seule fois.

Le webhook est signé et les créations concurrentes de code sont atomiques dans D1. Les échecs d’e-mail sont repris lors des passages horaires du serveur. Les remboursements restent à gérer dans Stripe et l’administration des codes existante.

## Validation

node tests/stripe-payment.test.mjs

Tests avec Stripe simulé et SQLite : tarif fixe, inscription confirmée, nouvelle tentative, paiements non payés/test/montant incorrect, confirmations concurrentes, signature altérée, consultation avec jeton, e-mail unique, propriétaire du code, activation et renouvellement avec conservation des jours. Aucun paiement réel n’a été réalisé par ces tests. Les premières opérations réelles sont à vérifier après configuration des secrets.

Références : https://docs.stripe.com/webhooks et https://developers.cloudflare.com/workers/configuration/secrets/
