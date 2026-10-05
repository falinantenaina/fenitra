# API — gestion-vente

Documentation de référence de l'API REST. Source de vérité du contrat : `backend/src/routes/index.ts`
(registre des montages) + `backend/src/modules/**/*.routes.ts` (109 routes).
La spécification métier complète reste `docs/ANALYSE.md` (§11 pour la liste d'origine,
§12 pour le plan, §16 pour les 12 scénarios).

- **Préfixe** : `/api` (sauf `GET /health`, à la racine du serveur)
- **Port par défaut** : `4000` (`PORT` dans `backend/.env`)
- **Stack** : Express 5 + TypeScript strict + Zod (validation) + Prisma/PostgreSQL

---

## 1. Authentification

Deux JWT signés par `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`.

| Élément | Valeur |
|---|---|
| En-tête | `Authorization: Bearer <accessToken>` |
| Durée de vie access | `JWT_ACCESS_TTL` (défaut `15m`) |
| Durée de vie refresh | `JWT_REFRESH_TTL` (défaut `30d`) |

```
POST /api/auth/login      { email, password } → { accessToken, refreshToken, user }
POST /api/auth/refresh    { refreshToken }     → { accessToken, refreshToken, user }   # rotation
POST /api/auth/logout     { refreshToken }     → 204                                  # révoque la session
POST /api/auth/logout-all                        → { revoked: n }                      # (auth) toutes les sessions
GET  /api/auth/me                                → PublicUser                          # (auth)
GET  /api/auth/sessions                          → [{ id, createdAt, lastUsedAt, ip, userAgent }]
```

La rotation invalide le refresh token précédent. Un changement de mot de passe
(`POST /users/me/password`, `POST /users/:id/password`) révoque **toutes** les sessions
de l'utilisateur ciblé.

### En-tête `Idempotency-Key`

Les écritures transactionnelles (`POST /arrivals`, `POST /sales`, `POST /debts/:id/payments`,
`POST /payments`) acceptent un en-tête `Idempotency-Key`. La clé est physique par
`userId` : rejouer la même requête avec la même clé renvoie le **même statut et le même corps**
sans ré-exécuter l'opération (`IDEMPOTENCY_REPLAY`), et deux utilisateurs peuvent porter
la même clé sans collision. Les enregistrements expirent après 30 jours ; une revendication
« pending » périmée (5 min) est reprisable.

### Format d'erreur

Toute erreur renvoie le même enveloppe :

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "field": "…" } } }
```

| HTTP | `code` | Origine |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod, `P2003`, `P2023`, `P2010`, `P2014` |
| 401 | `UNAUTHORIZED` | jeton absent/expiré, compte désactivé |
| 403 | `FORBIDDEN` | rôle insuffisant (RBAC) |
| 404 | `NOT_FOUND` | ressource absente, `P2025` |
| 409 | `CONFLICT` / `INSUFFICIENT_STOCK` / `IDEMPOTENCY_REPLAY` | unicité `P2002`, stock, rejouage |
| 422 | `BUSINESS_RULE_VIOLATION` | règles métier (ex. vente crédit sans tiers) |
| 500 | `INTERNAL_ERROR` | erreur inattendue (`X-Request-Id` en réponse) |

---

## 2. Conventions

- **Pagination** : `?page=1&limit=50` (`limit` ≤ 200, défaut 50). Réponse :
  `{ items: T[], total, page, limit, totalPages }`.
- **Recherche** : `?q=` (insensible à la casse), `?active=true|false`.
- **Dates** : ISO-8601 en entrée ; les bornes `from`/`to` sont coercées en `Date`.
- **Montants** : **strings** décimales (`"246.00"`) côté API, `Int` en base — jamais de flottant JSON.
- **Tri** : `sort` sur les listes concernées.
- **Toutes les routes sont sous `/api` sauf `GET /health`.**

---

## 3. RBAC

Trois rôles (table `Role`) : `ADMIN`, `MANAGER`, `CASHIER`.

| Garde | Rôles acceptés |
|---|---|
| *public* | aucun |
| `auth` | `ADMIN`, `MANAGER`, `CASHIER` |
| `manager` | `ADMIN`, `MANAGER` |
| `admin` | `ADMIN` |

Règle délibérée (§57) : **un caissier vend mais ne règle pas une dette d'autrui et
n'annule pas** — `POST /sales` et `POST /sales/:id/payments` sont ouverts à `auth`,
tandis que `POST /sales/:id/cancel`, `POST /debts/:id/payments` et `POST /debts/:id/cancel`
sont en `manager`.

---

## 4. Santé & index

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/health` | public | Santé du service (hors `/api`) : `{ status, env, time }` |
| GET | `/api/health` | public | Santé du service : `{ status, uptime, timestamp }` |
| GET | `/api/` | public | Catalogue des points d'entrée (`name`, `version`, `endpoints[]`) |

---

## 5. Utilisateurs

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/users` | admin | Liste des utilisateurs |
| POST | `/api/users` | admin | Création (`email`, `name`, `password`, `role`) |
| PATCH | `/api/users/:id` | admin | Mise à jour (`name`, `role`, `active`) |
| POST | `/api/users/:id/password` | admin | Réinitialisation par un administrateur → 204 |
| POST | `/api/users/me/password` | auth | Changement par soi-même (`currentPassword`, `newPassword`) → 204 |
| GET | `/api/users/roles` | manager | Noms des rôles |

---

## 6. Catalogue

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/products` | auth | Liste des produits |
| POST | `/api/products` | manager | Création |
| GET/PUT/DELETE | `/api/products/:id` | auth / manager / manager | Détail, mise à jour, suppression |
| POST | `/api/products/:id/variants` | manager | Pointures **du modèle** par `sizeValues[]` : valeurs inconnues créées à la volée, doublons ignorés, pointure désactivée **réactivée** |
| GET | `/api/sizes` | auth | Liste des pointures |
| POST | `/api/sizes` | manager | Création |
| PUT/DELETE | `/api/sizes/:id` | manager | Mise à jour, suppression |
| GET | `/api/variants` | auth | Liste des variantes (produit × pointure) — champ `stock` (paires dispo) et filtre `inStock=true` pour la recherche de vente |
| POST | `/api/variants` | manager | Création |
| GET/PUT | `/api/variants/:id` | auth / manager | Détail, mise à jour |
| PUT | `/api/variants/:id/price` | manager | Changement de prix de vente (→ historique) |
| GET | `/api/variants/:id/price-history` | auth | Historique des **prix d'achat** (§18) |

---

## 7. Tiers

Chaque famille expose `GET|POST /`, `GET|PUT|DELETE /:id` et `GET /:id/summary`
(arrivages, paiements, dette courante).

| Méthode | Chemin | Garde |
|---|---|---|
| GET | `/api/suppliers`, `/api/customers`, `/api/online-sellers` | auth |
| GET | `/api/{suppliers,customers,online-sellers}/:id` et `/:id/summary` | auth |
| POST/PUT/DELETE | `/api/{suppliers,customers,online-sellers}[/:id]` | manager |

---

## 8. Arrivages & stock

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/arrivals` | auth | Liste (`from`, `to`, `supplierId`, `status` = `RECEIVED|CANCELLED`, `unventilated`, `q`, `page`) — chaque ligne porte `toVentilate` (cartons sans pointures) |
| POST | `/api/arrivals` | manager | Transaction complète — cartons = **modèle + quantité + montant** (+ `sizes` pointures connues) → lots le cas échéant (sinon « à ventiler »), dette fournisseur, financements, ledger. Prix unitaire déduit : `floor(totalCost / totalQty)` |
| GET | `/api/arrivals/reference-preview` | auth | Prochaine référence `ARR-xxxx` |
| GET | `/api/arrivals/:id` | auth | Cartons (+ `ventilated`, `transitValue`, `transitQty`) + lots + dette + paiements + financements |
| POST | `/api/arrivals/:id/ventilate` | manager | **Ventilation** : `[{ cartonId, lines: [{ sizeId, quantity }] }]` — prix unitaire **imposé** `floor(totalCost / totalQty)`, somme des quantités exacte (sinon 422) → lignes + lots + mouvement `IN`, **zéro écriture comptable** (idempotent) |
| POST | `/api/arrivals/:id/cancel` | manager | `{ reason }` → contre-passation (écritures `ARRIVAL` **et** `DEBT`) — cartons encore à ventiler : simple retrait, transit retiré de la valorisation |
| GET | `/api/stock/summary` | auth | Quantité + valeur (`variantId`, `from`, `to`) — inclut les **cartons à ventiler** (hors filtre `variantId`, qui porte sur des pointures) |
| GET | `/api/stock/by-product` | auth | **Stock groupé par modèle** (`q`, `status`, `page`) : `{ productId, name, quantity, value, lots }` — une ligne par modèle, le détail par pointure reste `/stock/lots?productId=` |
| GET | `/api/stock/lots` | auth | Lots (`productId`, `variantId`, `supplierId`, `status`, `q`, `page`) |
| GET | `/api/stock/lots/:id/movements` | auth | Mouvements d'un lot — le `lot` expose `variantId` (→ `GET /variants/:id/price-history`, §18) |
| GET | `/api/stock/movements` | auth | Mouvements (`from`, `to`, `type`) |
| POST | `/api/stock/adjustments` | manager | Casse/perte (`variantId`, `qty`, `reason`) |

> Les règlements de la dette fournisseur passent par `POST /api/debts/:id/payments`
> sur la dette générée à la création de l'arrivage.
>
> `payment.amount` accepte `0` : rien n'est réglé, la totalité devient une dette fournisseur
> `OPEN` (aucun `Payment`, aucune écriture de caisse). Un règlement partiel
> (`0 < amount < total`) ouvre une dette `PARTIAL`. Sans bloc `payment`, comportement
> identique à `amount: 0`. Ce qui est réglé sort **toujours de la caisse**
> (`SUPPLIER_PAYMENT`, `cashDelta = -amount`) ; le solde reste dû au fournisseur.
> L'application n'envoie **plus** de bloc `funding` : plus de choix de source de
> financement (ni emprunt, ni crédit fournisseur). Le champ reste accepté côté API —
> `FundingAllocation` est une simple **étiquette de reporting** (§ ANALYSE A7), sans
> aucun mouvement de caisse.

---

## 9. Ventes

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/sales` | auth | Liste (`from`, `to`, `customerId`, `onlineSellerId`, `status`, `page`) |
| POST | `/api/sales` | auth | Transaction FIFO (lots → `SaleItemLot` → COGS → dette si crédit) |
| GET | `/api/sales/reference-preview` | auth | Prochaine référence `VTE-xxxx` |
| GET | `/api/sales/:id` | auth | Détail complet (§49) |
| POST | `/api/sales/:id/payments` | auth | Paiement partiel/total → `UNPAID`/`PARTIAL`/`PAID` |
| POST | `/api/sales/:id/cancel` | manager | `{ reason }` → restaure les lots, contre-passe `SALE` et `DEBT` |

`POST /sales` refuse une vente à crédit sans tiers (422) — miroir de la règle métier A7.

---

## 10. Dettes & paiements

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/debts` | auth | Liste (`type`, `direction`, `status`, `partyId`, `partyName`, `from`, `to`, `q`, `page`) |
| GET | `/api/debts/summary` | auth | Totaux par type (dashboard) |
| GET | `/api/debts/by-party` | auth | **Dettes groupées par tiers** (`type`, `direction`, `status`, `page`) : une ligne par personne — `{ key, party: { id, name }, type, direction, count, statusCounts, initialAmount, remainingAmount }`, le détail restant `/debts?partyId=` (ou `partyName` pour une trosa sinoa) |
| POST | `/api/debts` | manager | Création manuelle (motif obligatoire) |
| GET | `/api/debts/:id` | auth | Détail + historique des paiements (§50) |
| POST | `/api/debts/:id/payments` | manager | Paiement multiple partiel |
| POST | `/api/debts/:id/cancel` | manager | `{ reason }` — uniquement pour les dettes d'`origin = MANUAL` |
| GET | `/api/payments` | auth | Paiements (`direction`, `partyType`, `from`, `to`) |
| POST | `/api/payments` | manager | Création de paiement |

---

## 11. Finances

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET/POST | `/api/expenses` | auth / manager | Liste et création (toujours réglée → caisse −amount) |
| GET | `/api/expenses/summary` | auth | Agrégats par catégorie |
| GET/PUT/DELETE | `/api/expenses/:id` | auth / manager / manager | Détail, mise à jour, suppression |
| GET/POST | `/api/expense-categories` | auth / manager | Catégories |
| PUT | `/api/expense-categories/:id` | manager | `{ active: false }` = désactivation |
| GET/POST | `/api/versements` | auth / manager | Versements (charge ou remboursement, détection automatique A2) — `period`, `from`/`to`, `personName`, `treatment` |
| GET | `/api/versements/summary` | auth | §38 historique par personne : `items[] { personName, count, amount, charge, debtSettlement, lastDate }`, `totalAmount`, `totalCount` |
| GET/PUT/DELETE | `/api/versements/:id` | auth / manager / manager | CRUD |
| GET | `/api/personal-capital` | auth | Argent propre (distinct du bénéfice, A5) |
| POST | `/api/personal-capital` | manager | Dépôt |
| GET | `/api/personal-capital/:id` | auth | Détail |
| GET | `/api/personal-capital/:id/destinations` | auth | Où est allé l'argent (§33) |
| PUT/DELETE | `/api/personal-capital/:id` | manager | Mise à jour, suppression |
| GET | `/api/trosa-sinoa` | auth | Dettes filtrées `type = TROSA_SINOA` |
| POST | `/api/trosa-sinoa` | manager | Création |
| GET/PUT | `/api/trosa-sinoa/:id` | auth / manager | Détail, mise à jour |
| POST | `/api/trosa-sinoa/:id/payments` | manager | Remboursement |
| DELETE | `/api/trosa-sinoa/:id` | manager | Suppression |
| GET/POST | `/api/payment-methods` | auth / manager | Méthodes de paiement |
| PATCH | `/api/payment-methods/:id` | manager | Mise à jour |

`GET /versements` et `GET /versements/summary` partagent les filtres de
période du dashboard (§38) : `period=today|yesterday|last7d|week|month|prevMonth|year`
est **résolu côté serveur** (borne de fin exclusive), `period=custom` impose
`from` et `to` (sans eux la requête répond `400`). Sans `period`, `from`/`to`
bruts restent acceptés et la borne de fin y est **incluse**.

---

## 12. Journal, dashboard, rapports

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/ledger` | auth | Journal financier central (§39) : `from`, `to`, `kind`, `refType`, `cash`, `q`, `page` |
| GET | `/api/ledger/summary` | auth | Agrégats du journal |
| GET | `/api/dashboard` | auth | `period=today\|yesterday\|7d\|week\|month\|prevMonth\|year\|custom` |
| GET | `/api/dashboard/indicators` | auth | Liste des indicateurs exposés |
| GET | `/api/dashboard/:indicator/transactions` | auth | Dérillage (§62) : la liste de transactions derrière un indicateur |
| GET | `/api/reports/daily` | auth | Rapport journalier (`date`) : §48 — `paymentsReceived`, `paymentsSupplier`, `newDebts` |
| GET | `/api/reports/monthly` | auth | Rapport mensuel (`year`, `month`) : §48 — stock, dettes par type, `bestSellers`, `versementsByPerson` |
| GET | `/api/reports/export.pdf` | auth | Export PDF (`type=daily\|monthly`), mêmes rubriques que les rapports |
| GET | `/api/reports/series` | auth | Série journalière (§3, graphiques) : `period`/`from`/`to` + `metric=ca\|receipts\|outflow` |

`/dashboard` renvoie :

```json
{
  "period":    { "key", "from", "to", "label" },
  "activity":  { "salesCount", "ca", "receipts", "collectedAtSale", "cogs", "grossProfit", "expenses", "versementCharges", "netProfit", "cashOutflow" },
  "money":     { "cash", "cashAtStart", "cashDelta", "receivables", "payable", "workingCapital", "volaMiodina", "personalCapitalEngaged", "personalCapitalIn", "personalCapitalOut", "profitDrawings", "disposableProfit" },
  "debts":     { "customer", "onlineSeller", "supplier", "trosaSinoa", "total" },
  "stock":     { "quantity", "value", "availableItems", "soldItems" },
  "integrity": { "identityDelta", "ok" },
  "meta":      { "period", "currency" }
}
```

Indicateurs acceptés par `/:indicator/transactions` (21, listés par
`GET /dashboard/indicators`) :

| Source | Indicateurs |
|---|---|
| Journal sur la **période** (`scope: "period"`) | `ca`, `cogs`, `grossProfit`, `netProfit`, `receipts`, `expenses`, `versements`, `cash` |
| Journal **cumulé jusqu'à la date de fin** (`scope: "toDate"`) | `cashBalance`, `capital`, `profitDrawings` |
| Dettes ouvertes à la date de fin (`scope: "toDate"`) | `receivables`, `payables`, `debtsCustomer`, `debtsOnlineSeller`, `debtsSupplier`, `debtsTrosa`, `debtsTotal` |
| Lots encore garnis (`scope: "toDate"`) | `stockValue` |
| Composites (`scope: "toDate"`) | `vola`, `disposableProfit` |

La réponse porte `scope` : `period` = écritures de la fenêtre demandée,
`toDate` = état cumulé (les stocks ne se décomposent pas en flux de période).
Dans les deux cas `total` est **garanti égal** à la valeur affichée au
dashboard (§62, contrôle §16).

`/reports/daily` et `/reports/monthly` partagent le socle `period`, `activity`,
`money`, `integrity`, `sales`, `topProducts`, `bestSellers`,
`expensesByCategory`, puis ajoutent les rubriques du **§48** :

| §48 | Journalier (`type: "daily"`) | Mensuel (`type: "monthly"`) |
|---|---|---|
| Activité | `activity.{ca,receipts,cogs,expenses,versementCharges,grossProfit,netProfit}` | idem |
| Caisse | `money.cash` | `money.cash` |
| Encaissements / décaissements | `paymentsReceived`, `paymentsSupplier` | — |
| Nouvelles dettes | `newDebts` | — |
| Stock et dettes | — | `stock.{quantity,value}`, `debts.{customer,onlineSeller,supplier,trosaSinoa}` |
| Argent propre engagé | — | `money.personalCapitalEngaged` |
| Produits | `topProducts` (par chiffre d'affaires) | `bestSellers` (par quantité) + `topProducts` ; `margin` = bénéfice par produit |
| Dépenses par catégorie | `expensesByCategory` | `expensesByCategory` |
| Versements par personne | — | `versementsByPerson[] = { person, count, amount }` |

- `paymentsReceived` / `paymentsSupplier` : écritures `CUSTOMER_PAYMENT`,
  `ONLINE_SELLER_PAYMENT` / `SUPPLIER_PAYMENT` de la fenêtre — le journal est la source.
- `newDebts` : ce qui est **devenu dû** sur la période,
  `remainingAmount + règlements journalisés depuis l'ouverture` (stable dans le
  temps, §69). L'acompte versé à l'ouverture d'un arrivage (`refType = ARRIVAL`)
  est écarté : on mesure la dette créée, pas l'argent déjà sorti.
- Les rapports sont aussi exportés en PDF avec exactement ces rubriques.

`/reports/series` découpe un indicateur de flux en jours pour les graphiques :

```json
{
  "metric": "ca",
  "label": "Chiffre d'affaires",
  "period": "Mois actuel (octobre 2026)",
  "total": "60000.00",
  "points": [{ "date": "2026-10-01", "value": "0.00" }],
  "meta": { "period": "month", "from": "…", "to": "…", "timezone": "Indian/Antananarivo", "currency": "MGA" }
}
```

- `metric` : `ca` = `Σ amount(kind = 'SALE')` signé, `receipts` = cash entrant des
  ventes et règlements, `outflow` = -cash sortant — **mêmes prédicats** que
  `activity.ca`, `activity.receipts`, `activity.cashOutflow` : la somme des
  `points` retombe exactement sur la valeur du dashboard pour la même période.
- Jours civils de la timezone de l'entreprise (`meta.timezone`), remplis à `0.00` ;
  `period=custom` exige `from`/`to` (400), au-delà de 400 jours → 400.


---

## 13. Paramètres

| Méthode | Chemin | Garde | Description |
|---|---|---|---|
| GET | `/api/settings` | auth | Paires clé/valeur |
| PUT | `/api/settings` | manager | Fusion : seules les paires envoyées sont modifiées |

---

## 14. Écarts par rapport à `ANALYSE.md` §11

Le contrat réellement implémenté diffère de la liste d'origine aux endroits suivants
(l'implémentation fait foi) :

| §11 | Implémenté |
|---|---|
| `POST /arrivals/:id/payments` | absent — les règlements fournisseur passent par `POST /debts/:id/payments` |
| `DELETE /users/:id` | absent — la suppression est douce via `PATCH /users/:id { active: false }` |
| `DELETE /expense-categories/:id` | absent — désactivation via `PUT /expense-categories/:id { active: false }` |
| `POST /idempotency/:key/verify` | absent — l'idempotence est portée par l'en-tête `Idempotency-Key` |
| — | ajouté : `GET /api/dashboard/indicators`, `GET /api/auth/sessions`, `POST /api/auth/logout-all`, `GET /api/users/roles`, `POST /api/users/me/password`, `POST /api/users/:id/password`, `GET /api/` |

---

## 15. Vérifier le contrat

- `backend/tests/*.test.ts` — 202 tests (vitest + supertest), dont `routes.test.ts`
  qui couvre les routes de surface (`/health`, `/api/`, sessions, rôles, mots de passe).
- `backend/tests/e2e.test.ts` — les 12 scénarios métier de `ANALYSE.md` §16.
- `mobile/scripts/recette.ts` — rejoue les mêmes 12 scénarios contre l'API « comme le ferait le mobile ».
