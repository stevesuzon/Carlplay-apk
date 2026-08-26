CORRECTION IMPORTANTE
Le générateur n'écrit plus directement dans D1.
Il envoie maintenant les créations/renouvellements/déblocages à l'API officielle de l'application:
https://carplay-telephone.appli-suzon.workers.dev

Cela garantit que le hash CODE_PEPPER, les dates d'expiration et les appareils sont gérés exactement comme l'application.

Les caractères 0, 1, O et I sont automatiquement remplacés pour rester compatibles.
Les codes ont 6 caractères et le générateur ajoute automatiquement au moins 2 lettres.
