CARPLAY TRAVAILLE — VERSION CLOUDFLARE

1. Déployez le projet sur le Worker carplay-telephone.
2. Reliez la base D1 existante avec le nom de liaison DB.
3. La table de schema.sql doit exister dans cette base.
4. Ajoutez deux secrets au nouveau Worker : CODE_PEPPER et ADMIN_SECRET.

Création d'un abonnement (appel réservé au propriétaire) :
Ouvrez /admin.html sur votre domaine pour utiliser la page simple de création.

La méthode technique ci-dessous reste également disponible :
POST /api/admin/subscriptions
Authorization: Bearer VOTRE_ADMIN_SECRET
Content-Type: application/json

{"code":"428195","days":365}

Pour un abonnement à vie :
{"code":"428195","lifetime":true}

Chaque code accepte un autoradio et un téléphone. Un iPhone et un téléphone
Android sont tous les deux comptés comme le téléphone autorisé.
