# Popote — repas, recettes et courses sur iPhone

Popote est une application web installable sur l'écran d'accueil de l'iPhone (PWA).
Elle fonctionne **entièrement hors ligne**, **sans compte, sans serveur personnel et sans abonnement**.
Toutes les données restent sur l'iPhone (IndexedDB).

Internet n'est utilisé que lorsque vous le demandez : recherche d'un produit par code-barres et
bouton « Actualiser les prix ».

---

## 1. Choix techniques

### Pourquoi une web app et pas une app SwiftUI ?

Une app SwiftUI ne s'installe sur iPhone qu'en passant par un Mac avec Xcode. Il y a ensuite deux options :
- avec un identifiant Apple gratuit, l'app expire au bout de **7 jours** et doit être réinstallée depuis le Mac ;
- sinon, il faut le programme Apple Developer, à **99 €/an**.

Cela contredisait vos priorités 1 et 2 : une app utilisable dans le temps, sans abonnement, sans dépendre d'un ordinateur.
L'environnement de développement disponible (Linux, sans Xcode) ne permettait pas non plus de compiler ni de tester une app Swift.

La web app installable a été choisie parce qu'elle :
- s'installe depuis Safari, avec une icône sur l'écran d'accueil, et ne périme jamais ;
- fonctionne hors ligne grâce à un *service worker* qui met toute l'application en cache ;
- stocke les données dans IndexedDB, avec des transactions et sans limite pratique pour une bibliothèque de recettes ;
- a pu être **réellement testée** ici : 35 tests de calcul et de persistance, et 42 vérifications de bout en bout dans un navigateur.

| Compromis | Conséquence | Parade prévue |
|---|---|---|
| Il faut une URL HTTPS pour l'installation | Hébergement statique gratuit (GitHub Pages) des **fichiers de l'app uniquement** : aucune donnée n'y transite, aucun code ne s'y exécute | Après installation, l'app fonctionne même si l'hébergement disparaît |
| Les données sont liées à l'URL d'installation | Changer d'URL donne une app vide | Sauvegarde/restauration JSON en un geste |
| Supprimer l'icône efface les données | Comme pour toute app | Rappel de sauvegarde automatique (tous les 14 jours par défaut) |
| iOS n'expose pas `BarcodeDetector` | Le scan passe par la bibliothèque ZXing embarquée (MIT, hors ligne) | Saisie manuelle du code toujours possible |
| Pas de notifications ni de widgets | Non nécessaires au cahier des charges | — |

Sur l'éviction des données par Safari : la limite de 7 jours de WebKit pour le stockage ne s'applique pas aux web apps ajoutées à l'écran d'accueil.
L'app demande en plus un stockage persistant (`navigator.storage.persist()`) et affiche le statut obtenu dans Réglages.
La sauvegarde régulière reste la vraie garantie.

### Stack

- HTML, CSS et JavaScript natifs (modules ES), **sans étape de build et sans dépendance réseau** à l'exécution.
- IndexedDB : 9 magasins (recettes, ingrédients, produits, stock, semaines, articles de courses, mouvements de stock, photos, réglages). Les écritures liées passent par une transaction unique.
- Service worker en cache d'abord. Les mises à jour de l'app ne touchent jamais IndexedDB, et les migrations de schéma sont uniquement additives.
- Noyau de calcul pur (`js/core/`), testé sous Node.

```
index.html, manifest.webmanifest, sw.js   coque de l'app, installation, hors ligne
css/app.css                              interface (clair/sombre, tailles iPhone)
js/core/units.js        unités et conversions exactes (g, kg, ml, cl, l, pièces…)
js/core/costing.js      prix, statut des prix, coût des recettes et des lignes
js/core/packaging.js    combinaison optimale de conditionnements (programmation dynamique)
js/core/shopping.js     besoins, stock, synchronisation de la liste, budget
js/core/stock.js        déduction / annulation de stock après un repas
js/core/priceupdate.js  choix d'un relevé Open Prices, règles de mise à jour
js/core/importexport.js CSV/JSON : analyse, validation, sauvegarde
js/core/week.js, budget.js  semaines ISO, récapitulatif hebdomadaire
js/db.js, js/store.js   persistance IndexedDB et opérations métier
js/prices.js            accès Open Prices / Open Food Facts
js/ui/…                 écrans (Accueil, Recettes, Planning, Courses, Stock, Produits, Réglages)
vendor/zxing.min.js     lecteur de code-barres (MIT)
test/                   tests Node (calculs, persistance) et Playwright (bout en bout)
exemples/               fichiers d'import d'exemple
tools/stamp-sw.mjs      régénère la liste de cache du service worker
```

---

## 2. Prix des supermarchés : ce qui a été vérifié et retenu

**Colruyt**
- Aucune API publique.
- Les outils tiers qui récupèrent ses prix interrogent l'API interne du site via des proxys résidentiels belges pour éviter les blocages.
- C'est précisément le scraper fragile qui contourne des protections, exclu par le cahier des charges. Il n'est donc **pas intégré**.

**Intermarché Belgique**
- Aucune API ni aucun flux public de prix trouvé.

**Variation des prix**
- Colruyt aligne ses prix sur la concurrence locale : ils varient d'un magasin à l'autre.
- Une enquête RTBF a relevé un panier d'environ 30 produits plus cher d'environ 23 € à Ans qu'à Tongres.
- Les prix en ligne (Collect&Go) peuvent aussi différer des prix en magasin.
- Un « prix Colruyt » unique reste donc une estimation.

**Source retenue : Open Prices (Open Food Facts)**
- Base ouverte de prix réellement relevés en magasin, sous licence ODbL.
- API REST publique, **sans clé** : aucune clé secrète n'est intégrée dans l'app.
- Chaque relevé est lié à un code-barres, une date et un magasin (enseigne, ville, pays).

Popote :
1. cherche les relevés du code-barres, en euros ;
2. garde ceux de la Belgique et privilégie l'enseigne du produit (Colruyt, Intermarché…). À défaut, elle prend un relevé d'une autre enseigne belge et le signale ;
3. prend le plus récent. Elle **ne remplace jamais** un prix plus récent par un relevé plus ancien, ni un prix manuel (sauf si vous l'autorisez) ;
4. enregistre la source, la date, le magasin, la mention « promo » et un historique.

Les fiches produit (nom, marque, contenance) viennent d'Open Food Facts.

**Limite honnête** : la couverture belge d'Open Prices dépend des contributeurs. Beaucoup de produits n'auront aucun relevé.
D'où le **système hybride** :
- prix manuel par produit ou par ingrédient ;
- import d'un catalogue CSV (`exemples/catalogue-prix.csv`), par exemple recopié depuis vos tickets.

Tous les calculs fonctionnent sans aucun prix en ligne.

---

## 3. Installation sur l'iPhone (une seule fois, environ 10 minutes)

L'app doit être servie en HTTPS une première fois. GitHub Pages est gratuit et ne sert que des fichiers statiques.

1. Créez un compte gratuit sur <https://github.com> si nécessaire.
2. Créez un dépôt, par exemple `popote` (*New repository*, public : GitHub Pages gratuit exige un dépôt public ; le dépôt ne contient que le code, **jamais vos données**).
3. *Add file → Upload files* : glissez **tout le contenu** du dossier `popote/` (dont `index.html`, `sw.js`, `.nojekyll`, `css/`, `js/`, `icons/`, `vendor/`), puis *Commit*.
4. *Settings → Pages* : *Source* = « Deploy from a branch », branche `main`, dossier `/ (root)`, *Save*. Après 1 à 2 minutes, l'adresse s'affiche, par exemple `https://votre-nom.github.io/popote/`.
5. Sur l'iPhone, ouvrez cette adresse **dans Safari**, attendez le chargement, touchez **Partager** (carré avec flèche), puis **« Sur l'écran d'accueil »**, puis **Ajouter**.
6. Lancez Popote **depuis l'icône**, pas depuis Safari : l'app installée a son propre stockage.
7. Mettez l'iPhone en mode Avion et rouvrez l'app : tout doit fonctionner. Elle est prête.

Alternative sans GitHub : n'importe quel hébergeur statique HTTPS gratuit (Netlify Drop, Cloudflare Pages) en déposant le dossier.

**À ne pas faire** : changer d'adresse d'hébergement ou supprimer l'icône sans avoir fait une sauvegarde.

### Mises à jour de l'application

Remplacez les fichiers dans le dépôt. Si vous avez modifié le code, lancez d'abord `node tools/stamp-sw.mjs`.
À la prochaine ouverture en ligne, l'app propose « Mettre à jour ». Vos données sont conservées.

---

## 4. Sauvegarde et restauration

- **Sauvegarder** : Réglages → « Sauvegarder toutes les données » → « Enregistrer dans Fichiers ».
  - Choisissez iCloud Drive pour une copie hors de l'iPhone.
  - Le fichier `popote-sauvegarde-AAAA-MM-JJ.json` contient tout : recettes avec photos, ingrédients, produits et prix, stock, semaines, listes et cases cochées, réglages.
- **Restaurer** : Réglages → « Restaurer une sauvegarde » → choisir le fichier.
  - Le fichier est validé avant import : application, version et références entre recettes et ingrédients.
  - La restauration **remplace** les données actuelles en une seule transaction.
- **Changer d'iPhone ou d'URL** : sauvegardez sur l'ancien, installez sur le nouveau, puis restaurez.
- **Limites** :
  - pas de sauvegarde automatique dans le cloud (choix « aucun service cloud obligatoire ») ;
  - un rappel s'affiche sur l'accueil si la dernière sauvegarde date de plus de 14 jours (réglable).

Autres imports et exports :
- recettes en CSV ou JSON, avec validation ligne par ligne et liste des erreurs avant confirmation ;
- export des recettes en CSV ;
- catalogue de produits en CSV, à l'import comme à l'export ;
- modèles téléchargeables depuis l'app.

---

## 5. Fonctionnalités opérationnelles (implémentées et vérifiées)

Vérifiées par tests automatisés (✔ = test dédié) ou par parcours dans le navigateur.

**Recettes**
- Bibliothèque en cartes : photo, nom, durée, portions, coût total, coût par personne, catégorie, mention « prix manquant ».
- Recherche par nom ou ingrédient, filtres par catégorie et durée maximale, tri par nom, prix, rapidité ou date.
- Modifier, dupliquer, supprimer.
- Une recette déjà planifiée est archivée plutôt que supprimée : l'historique des semaines passées reste lisible.

**Formulaire « Ajouter un repas »**
- Photo depuis l'appareil photo ou la photothèque, redimensionnée et stockée localement.
- Étapes, notes, ingrédients facultatifs.
- Ajout rapide de plusieurs ingrédients avec Entrée ✔.
- Un ingrédient existant est réutilisé par son nom ✔ ; « oignon rouge » et « oignon jaune » restent distincts ✔.

**Coûts**
- Coût par ingrédient, part en %, coût par portion.
- Recalcul selon les portions sans modifier la recette (tests A ✔ et B ✔).
- Total signalé « partiel » ou « ≥ » si un prix manque (test F ✔).

**Ingrédients et produits**
- Plusieurs produits par ingrédient, produit privilégié, prix manuel de secours.
- Correspondance facultative pièce ↔ poids (1 oignon ≈ 150 g), signalée comme estimation ✔.

**Conditionnements** (test E ✔)
- Combinaison optimale de paquets entiers : vente au détail, lots minimaux, produits indisponibles exclus.
- Affichage séparé du coût consommé, du montant en caisse, du surplus et des prix inconnus.

**Planning**
- Navigation entre les semaines passées, en cours et futures (semaines ISO).
- Sélection rapide, ou attribution par jour et par moment (midi, soir).
- Un même repas plusieurs fois, portions par repas, déplacer, remplacer, retirer (avec « Annuler »).
- Copier la semaine précédente.
- Récapitulatif permanent : coût, repas, préparation, cuisson (test I ✔).

**Liste de courses**
- Générée et regroupée par ingrédient et par unité compatible (test C ✔).
- Conversions exactes uniquement (test M ✔) ; les unités non convertibles restent sur des lignes séparées ✔.
- Classée par rayon. Grandes cases à cocher enregistrées immédiatement.
- Article coché barré et grisé ; filtres « À acheter » / « Tout afficher » ; rayons repliables et masquables ; progression « 8 articles sur 15 achetés ».
- Tout cocher, réinitialiser les cases.

**Articles manuels** (test J ✔)
- « + Ajouter un article » : le nom suffit, le rayon est deviné (« Papier toilette » va dans Entretien et hygiène).
- Quantité, unité, prix et note facultatifs.
- Modifier, dupliquer, supprimer, changer de rayon.
- Jamais supprimés par un recalcul, une actualisation de prix ou le stock.

**Synchronisation planning ↔ liste** (test L ✔)
- Les cases cochées, notes, quantités ajustées et rayons déplacés sont conservés.
- Un article coché ou modifié qui n'est plus nécessaire n'est jamais supprimé en silence : il est signalé, et vous choisissez de le garder ou de le supprimer.
- Un changement de quantité après coche est signalé.
- Un article retiré à la main ne revient pas tout seul et reste récupérable.

**Budget de la liste** (test K ✔)
- Total, montant coché, reste à payer.
- Repas et achats complémentaires séparés, nombre d'articles sans prix (jamais comptés comme gratuits).
- Coût consommé, surplus des conditionnements, valeur du stock utilisé.

**Historique**
- Une liste par semaine, consultable ensuite. Les semaines passées ne sont plus recalculées automatiquement.

**Stock**
- Placard virtuel avec quantité, unité, péremption et produit associé.
- Déduit des besoins (test D ✔) ; désactivable.
- Déduction facultative après un repas, une seule fois, et annulable ✔.

**Prix**
- Recherche par code-barres (scan ou saisie), puis Open Food Facts pour la fiche et Open Prices pour le prix.
- « Actualiser les prix » sans toucher à la liste ✔ ; erreurs réseau signalées sans blocage ✔.
- Statuts Vérifié, Ancien (seuil réglable), Manuel, Indisponible ; date de dernière actualisation.
- Bouton « Tester l'accès aux prix en ligne ».

**Hors ligne et persistance**
- Démarrage, recettes, planning, stock et courses fonctionnent sans réseau (test G ✔).
- Tout est conservé après fermeture complète, y compris les cases et les filtres (test H ✔).
- Réouverture sur l'écran des courses ou du planning si l'app a été fermée par iOS.

**Interface**
- Français, euros avec deux décimales (calculs en pleine précision, arrondi à l'affichage).
- Mode clair et sombre, écrans vides explicatifs.
- Exemples marqués « Exemple » (prix fictifs), supprimables.

## 6. Limitations connues (à lire)

- **Non testé sur un iPhone réel depuis cet environnement.** Les tests de bout en bout tournent dans Chromium. Safari/WebKit n'a pas pu être installé ici. Les comportements propres à iOS restent à vérifier à la première utilisation : installation, appareil photo, scan, feuille de partage « Enregistrer dans Fichiers ». Le code n'utilise que des API prises en charge par Safari iOS 16.4 et plus.
- **Accès réel à l'API Open Prices non vérifié.** Ce bac à sable bloque le réseau vers ce domaine. La logique de prix a été testée avec des réponses simulées. Si l'API refuse les appels depuis une web app (en-têtes CORS), la recherche affichera « Réseau indisponible ou accès refusé » et le reste de l'app fonctionnera normalement. Vérifiez avec Produits → menu → « Tester l'accès aux prix en ligne ».
- La couverture des prix belges dans Open Prices est partielle. Comptez sur les prix manuels et l'import CSV pour une partie du catalogue.
- Les prix Colruyt et Intermarché ne sont pas récupérés directement : il n'existe pas d'accès autorisé. C'est un choix délibéré.
- Le scan de code-barres dépend de la caméra et de l'éclairage. La saisie manuelle reste disponible.
- Pas de synchronisation entre appareils (aucun cloud par conception). Le transfert se fait par sauvegarde et restauration.
- Les conversions cuillère ↔ ml et pièce ↔ poids ne sont jamais automatiques. La seconde n'est possible que si vous la déclarez sur l'ingrédient.

---

## 7. Tests

```bash
npm install                       # installe fake-indexeddb (tests uniquement)
npm test                          # 35 tests : calculs A–M, conditionnements, stock, import/export, persistance
python3 -m http.server 8080 &     # sert l'app localement
pip install playwright && python3 -m playwright install chromium
python3 test/e2e.py               # 42 vérifications de bout en bout (G, H, J, K, L, hors ligne, sauvegarde)
```

## 8. Modèle de données (résumé)

| Objet | Champs principaux |
|---|---|
| Recette | id, name, description, servings, prepMin, cookMin, category, photoId, items[{ingredientId, qty, unit, optional}], steps[], notes, deletedAt |
| Ingrédient | id, name, category (rayon), defaultUnit, productIds[], preferredProductId, manualPrice{price, qty, unit}, unitWeight{qty, unit} |
| Produit | id, name, brand, store, barcode, category, packQty, packUnit, packPrice, soldByWeight, lot, available, priceDate, priceSource, priceNote, priceHistory[], url, zone, autoUpdate, lastCheckedAt |
| Stock | id, ingredientId, qty, unit, expiry, productId |
| Semaine | id (« 2026-W44 »), entries[{id, recipeId, servings, day, slot, cooked, stockDeducted}] |
| Article de courses | id, weekId, origin (auto/manuel), key, ingredientId, needBase, stockBase, toBuyBase, qtyOverride, checked, note, price, removed, orphan, changedAfterCheck, categoryOverridden |
| Mouvement de stock | id, weekId, entryId, stockId, ingredientId, dim, qtyBase |

Les déductions de stock sont rattachées à la semaine et au repas. Les repas déjà cuisinés n'augmentent donc pas les besoins de leur propre semaine, et une double déduction est impossible.
test
