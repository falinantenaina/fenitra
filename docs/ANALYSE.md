# ANALYSE DU PROJET — Application de gestion commerciale, stock & finances (vente de chaussures)

> **Phase 1 → Phase 4** du plan de développement.
> **Statut : VALIDÉ par l'utilisateur** (voir §14 — décisions A1 → A15). Le code peut démarrer par la Phase 2.

---

## 1. Analyse du projet

### 1.1 Nature de l'activité

Négoce de chaussures :

```
Argent (propre / trosa sinoa / caisse)
        │
        ▼
   ARRIVAGE (fournisseur) ──► CARTONS ──► LIGNES (modèle × pointure × qté × prix achat)
        │
        ▼
   LOTS D'ACHAT (StockLot)  ← historique de prix INALTÉRABLE
        │
        ▼
   VENTE (client OU vendeur en ligne) ──► SORTIE FIFO ──► COGS
        │
        ├──► ENCAISSÉ (recette)      ──► CAISSE
        └──► NON ENCAISSÉ (dette)    ──► créance
```

### 1.2 Lecture des règles du cahier des charges

| § | Règle | Conséquence technique |
|---|---|---|
| §2, §62 | Journal de mouvements comme source de vérité ; tout montant du dashboard est cliquable | Table `LedgerEntry` + agrégats + endpoint de drill-down |
| §14, §66 | Un nouvel arrivage ne **jamais** écrase un ancien prix | `StockLot` unitaire par ligne de carton, `unitCost` immuable |
| §16, §17 | FIFO + valorisation par lots | Allocation FIFO + `Σ remainingQty × unitCost` + cartons à ventiler |
| §19 | Le prix de vente d'une vente est figé | `SaleItem.unitPrice` copié à la création |
| §41→§46 | CA ≠ recettes ≠ bénéfice ≠ caisse ≠ stock ≠ dettes ≠ capital | Formules distinctes (§8 de ce document) |
| §28, §67 | Les vendeurs en ligne n'ont **aucun** module de dépenses/revenus/bénéfices | Entité limitée à achats + paiements + dettes |
| §30, §31, §68 | Toute dette a un **motif obligatoire**, généré puis modifiable | `Debt.reason` `NOT NULL` + service de génération |
| §34 | Argent propre : `engagé = injecté − récupéré` | `PersonalCapitalMovement` type IN/OUT |
| §35 | Financement mixte traçable | `FundingAllocation` par arrivage |
| §45 | Ne pas déduire arbitrairement du bénéfice net | Liste blanche de ce qui réduit le bénéfice (§8) |
| §47, §61, §69 | Jamais de suppression destructive | Statuts `CANCELLED/VOIDED`, écritures de contre-passation |
| §54 | Pas de `Float` | `Prisma.Decimal` + montants transmis en **string** dans l'API |
| §55 | Atomicité | `prisma.$transaction` sur vente / arrivage / paiement |
| §56 | Anti double soumission | `idempotencyKey` + contrainte unique + bouton désactivé |
| §65 | Priorités : intégrité > logique métier > traçabilité > stock > historique > sécurité > perf > UX > design | ordre des phases |

### 1.3 Périmètre

- **Single-tenant** : une activité, plusieurs utilisateurs (rôles).
- Pas de multi-entreprise, pas de multi-devises (à confirmer).
- Pas de module e-commerce côté vendeur en ligne.
- Pas de gestion de dépenses/ads/boost des vendeurs en ligne (§67, interdit).

---

## 2. Ambiguïtés identifiées (tranchées — voir §14)

| # | Ambiguïté | Impact | Proposition retenue (à valider) |
|---|---|---|---|
| **A1** ✅ | **Sens de « trosa sinoa »** : argent que je **dois** (dette) ou argent qu'on **me doit** (créance) ? | Identité financière, dashboard | **VALIDÉ : argent que JE DOIS → `direction = PAYABLE` (imposé pour ce type).** C'est une dette **manuelle**, distincte des dettes fournisseurs générées automatiquement par un arrivage. Elle entre dans **ARGENT À PAYER** |
| **A2** ✅ | **Traitement comptable du versement** (ex. « Mr Kely 2 Ar/jour ») : charge ou règlement de dette ? | Bénéfice net, identité comptable | **VALIDÉ : `DEBT_SETTLEMENT` par défaut.** Si la personne a une **dette payable ouverte** (type `TROSA_SINOA`), le versement la réduit et n'affecte pas le bénéfice. Sinon `CHARGE` (réduit le bénéfice net). Champ `Versement.treatment`, modifiable à la saisie |
| **A3** ✅ | **Formule exacte du bénéfice mangeable** (§7) : cumulée ou sur période ? réserve de rotation ? | Question centrale du dashboard | **VALIDÉ (§9), révisé le 07/10/2026** : plafond du retrait = **bénéfice net cumulé non sorti** = `max(0, vola − argent propre engagé)`, cumulé à date. L'ancienne borne `min(net cumulé, caisse − à payer − argent propre − réserve)` et la réserve de rotation sont **supprimées** : la caisse et les passifs ne bornent plus la sortie |
| **A4** ✅ | **Définition exacte du vola miodina** (§7 liste 4 éléments) : totaux ou sous-ensemble ? | Dashboard | **VALIDÉ (§10)** : `caisse + stock + créances − passifs` = `argent propre engagé + bénéfice net cumulé` |
| **A5** ✅ | **Que devient l'argent propre quand je sors de la caisse ?** Récupération de capital ou prise de bénéfice ? | Argent propre, bénéfice disponible | **VALIDÉ : deux opérations distinctes.** `PERSONAL_CAPITAL_OUT` (récupère mon capital, `K` diminue) et `PROFIT_DRAWING` (je sors du bénéfice, `K` inchangé) |
| **A6** ✅ | **Recettes** (§42) : inclut-on les règlements de dettes antérieures ? | Indicateur « recettes » | **Retenu : oui** — `Recettes = tous les encaissements issus des ventes (du moment + règlements)`. Sous-indicateur `ventes encaissées du moment` affiché à côté |
| **A7** | **Financement mixte** (§35) : comment relier « injection d'argent propre » → « arrivage » sans compter deux fois l'argent ? | Traçabilité §33 | Les **flux de caisse** restent la référence ; `FundingAllocation` est une **étiquette de reporting** sur l'arrivage. Si l'argent arrive directement de ma poche, on crée une `PersonalCapitalMovement` liée à l'arrivage **et** le paiement sort de la caisse (entrée + sortie, solde net nul, traçabilité complète) |
| **A8** | **Dépenses non payées** (achats à crédit) ? | Dettes | Non prévues par le §36 → **hors périmètre v1** ; une dépense est toujours réglée (sortie de caisse). À confirmer |
| **A9** ✅ | **Précision monétaire** : l'ariary admet-il des décimales ? | `Decimal(18,2)` vs `Decimal(18,0)` | **VALIDÉ : `Decimal(18,0)` — entiers uniquement.** Tous les montants sont des entiers ; validation Zod `int()` ; affichage formaté `2 000 Ar` |
| **A10** | **Prix de vente vendeur en ligne** (80) ≠ prix public (30) : prix libre par ligne de vente, ou listes de prix par canal ? | UX saisie | v1 : `ProductVariant.sellingPrice` = prix par défaut + **prix libre modifiable sur chaque ligne de vente**. Listes de prix = évolution possible |
| **A11** | **Retours, annulations, ajustements de stock** (casse/perte/vol) : non traités par le cahier des charges mais nécessaires pour ne jamais bloquer l'app. | Intégrité | Prévoir : `Sale.cancel()` (contre-passation), `StockMovement ADJUSTMENT/RETURN` — à valider |
| **A12** | **Versement récurrent** (2/jour) : planificateur automatique ou saisie manuelle ? | UX | v1 : saisie manuelle + vue « historique par personne » (§38). Planificateur = évolution |
| **A13** | **Timezone / bornes de période** | Filtres dashboard | `Indian/Antananarivo` (UTC+3), calculées côté serveur. *NB : `Africa/Antananarivo` est l'alias historique, rejeté par l'ICU récent de Node — on utilise le nom canonique* |
| **A14** ✅ | **Rôles / RBAC** exacts | Sécurité | `ADMIN`, `MANAGER`, `CASHIER` — **VALIDÉ** : le caissier vend (avec création / modification du client), saisit les dépenses (création / correction / suppression) et visualise le stock ; `403` sur dettes, versements, argent propre, trosa, arrivages, journal et rapports (portée détaillée dans `docs/API.md` §3) |
| **A15** | **Trosa sinoa** : doit-il apparaître dans « Dettes » du dashboard **et** dans une section séparée (§32) ? | Dashboard | Une seule table, deux vues (filtre par type) |

---

## 3. Architecture proposée

### 3.1 Structure du dépôt

```
gestion_vente/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   ├── seed.ts                  # rôles + admin UNIQUEMENT (base vierge)
│   │   ├── reference.ts             # pointures, catégories, modes — tests + démo
│   │   ├── demo.ts                  # données de démonstration (services métier)
│   │   └── seed-demo.ts             # `npm run db:seed:demo` (optionnel)
│   ├── src/
│   │   ├── index.ts                 # bootstrap Express
│   │   ├── app.ts                   # helmet, cors, routes, errorHandler
│   │   ├── config/                  # env, constants, period presets
│   │   ├── lib/prisma.ts            # client singleton
│   │   ├── lib/errors.ts            # AppError, codes métier
│   │   ├── middleware/
│   │   │   ├── auth.ts              # vérif JWT
│   │   │   ├── rbac.ts              # rôles/permissions
│   │   │   ├── validate.ts          # Zod (params, query, body)
│   │   │   ├── idempotency.ts
│   │   │   └── errorHandler.ts
│   │   ├── modules/
│   │   │   ├── auth/                # routes, controller, service, schemas
│   │   │   ├── users/
│   │   │   ├── catalog/             # products, sizes, variants
│   │   │   ├── parties/             # suppliers, customers, online sellers
│   │   │   ├── arrivals/            # arrivages + cartons + lots
│   │   │   ├── stock/               # lots, mouvements, valorisation, historique prix
│   │   │   ├── sales/               # ventes + allocation FIFO
│   │   │   ├── debts/               # dettes génériques + paiements
│   │   │   ├── payments/            # paiements (IN/OUT)
│   │   │   ├── expenses/
│   │   │   ├── versements/
│   │   │   ├── personal-capital/
│   │   │   ├── trosa-sinoa/
│   │   │   ├── ledger/              # journal financier
│   │   │   ├── dashboard/           # agrégats + drill-down
│   │   │   ├── reports/             # journalier, mensuel, PDF
│   │   │   └── settings/
│   │   ├── services/
│   │   │   ├── fifo.service.ts
│   │   │   ├── ledger.service.ts
│   │   │   ├── debt.service.ts
│   │   │   ├── metrics.service.ts   # CA, recettes, COGS, bénéfices, vola…
│   │   │   └── period.service.ts
│   │   └── types/
│   ├── tests/                       # Vitest — 12 scénarios obligatoires
│   ├── .env.example
│   └── package.json
│
├── mobile/
│   ├── app/                         # Expo Router
│   │   ├── (auth)/login.tsx
│   │   ├── (tabs)/
│   │   │   ├── index.tsx            # Dashboard
│   │   │   ├── ventes.tsx
│   │   │   ├── stock.tsx
│   │   │   ├── dettes.tsx
│   │   │   ├── finances.tsx
│   │   │   ├── rapports.tsx
│   │   │   └── parametres.tsx
│   │   ├── sale/new.tsx
│   │   ├── arrival/new.tsx          # saisie rapide carton
│   │   ├── arrival/[id].tsx
│   │   ├── sale/[id].tsx
│   │   ├── debt/[id].tsx
│   │   └── drilldown/[indicator].tsx
│   ├── src/
│   │   ├── api/                     # axios instance + endpoints typés
│   │   ├── queries/                 # React Query hooks par module
│   │   ├── stores/                  # Zustand : auth, ui, prefs, brouillons
│   │   ├── components/              # ui kit (cards, badges, table, filter…)
│   │   ├── features/                # logique métier affichée
│   │   ├── schemas/                 # Zod forms
│   │   ├── utils/                   # format Ar, dates, périodes
│   │   └── types/
│   ├── tailwind.config.js           # NativeWind
│   ├── .env.example
│   └── app.json
│
├── docs/
│   ├── ANALYSE.md                   # ce document
│   ├── FORMULES.md                  # règles financières validées
│   └── API.md
├── README.md
└── .env.example
```

### 3.2 Backend — couches

```
Route (Zod validate) → Controller (orchestration HTTP) → Service (règles métier + $transaction) → Prisma
                 ↘ middleware auth / rbac / idempotency / errorHandler
```

- **TypeScript strict** partout.
- Aucune règle métier dans les controllers/routes.
- Tout ce qui touche l'argent passe par `ledger.service.ts` (une seule porte d'entrée → garantit la traçabilité §62).

### 3.3 Frontend — état

| Besoin | Outil |
|---|---|
| Données serveur, cache, mutations, invalidation | **TanStack Query** |
| Auth locale (token, user, rôles), UI globale, préférences, **brouillons de saisie** (carton en cours) | **Zustand** |
| Appels HTTP centralisés (baseURL, timeout, JWT, refresh, erreurs) | **Axios instance** |
| Formulaires + validation | **React Hook Form + Zod** |
| Token | **Expo SecureStore** |
| Graphiques | `react-native-gifted-charts` (pur JS) + `react-native-svg`, installés par `npx expo install` : **les deux sont dans Expo Go**, aucune native à compiler — choix tranché à l'étape 7 (l'alternative `victory-native` exige `@shopify/react-native-skia`) |

### 3.4 Flux de données d'un chiffre du dashboard

```
GET /api/dashboard?from&to
   → metrics.service.ts agrège LedgerEntry / Debt / StockLot
   → retourne { value, breakdown[], drilldownKey }
GET /api/dashboard/:indicator/transactions?from&to   ← drill-down (§62)
   → liste exacte des écritures / comptes composant le montant
```

Aucune valeur n'est saisie manuellement ni « inventée » : tout est agrégé.

---

## 4. Schéma Prisma proposé (draft — sera figé en Phase 3)

```prisma
generator client { provider = "prisma-client-js" }
datasource db   { provider = "postgresql", url = env("DATABASE_URL") }

// ───────────────────────── ENUMS ─────────────────────────
enum RoleName            { ADMIN MANAGER CASHIER }
enum PaymentDirection    { IN OUT }
enum PaymentPartyType    { CUSTOMER ONLINE_SELLER SUPPLIER TROSA_SINOA SELF OTHER }
enum SaleStatus          { PAID PARTIAL UNPAID CANCELLED }
enum ArrivalStatus       { RECEIVED CANCELLED }
enum DebtType            { CUSTOMER ONLINE_SELLER SUPPLIER TROSA_SINOA }
enum DebtDirection       { RECEIVABLE PAYABLE }
enum DebtOrigin          { SALE ARRIVAL MANUAL }
enum DebtStatus          { OPEN PARTIAL PAID CANCELLED }
enum StockMovementType   { IN OUT ADJUSTMENT RETURN REVERSAL }
enum CapitalMovementType { IN OUT }
enum VersementTreatment  { CHARGE DEBT_SETTLEMENT }
enum FundingSource       { OWN_CAPITAL TROSA_SINOA SALES_CASH SUPPLIER_CREDIT }
enum LedgerKind {
  SALE
  COGS
  CUSTOMER_PAYMENT
  ONLINE_SELLER_PAYMENT
  SUPPLIER_PAYMENT
  EXPENSE
  VERSEMENT
  PERSONAL_CAPITAL_IN
  PERSONAL_CAPITAL_OUT
  PROFIT_DRAWING
  TROSA_BORROW
  TROSA_REPAY
  OTHER
  REVERSAL
}

// ───────────────────────── UTILISATEURS ─────────────────────────
model Role {
  id    String   @id @default(cuid())
  name  RoleName @unique
  users User[]
}

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  passwordHash String
  roleId       String
  role         Role      @relation(fields: [roleId], references: [id])
  active       Boolean   @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  sales        Sale[]
  ledger       LedgerEntry[]
  @@index([roleId])
}

// ───────────────────────── CATALOGUE ─────────────────────────
model Size {
  id       String           @id @default(cuid())
  value    Int              // 36, 37 … 42
  label    String?
  order    Int              @default(0)
  variants ProductVariant[]
  @@unique([value])
}

model Product {
  id          String           @id @default(cuid())
  name        String           // « Samba »
  slug        String           @unique
  description String?
  imageUrl    String?
  active      Boolean          @default(true)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  variants    ProductVariant[]
  @@index([name])
}

model ProductVariant {
  id           String       @id @default(cuid())
  productId    String
  product      Product      @relation(fields: [productId], references: [id])
  sizeId       String
  size         Size         @relation(fields: [sizeId], references: [id])
  sku          String?      @unique
  sellingPrice Decimal      @db.Decimal(18, 0)   // prix de VENTE actuel (modifiable)
  active       Boolean      @default(true)
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  lots         StockLot[]
  saleItems    SaleItem[]
  arrivalItems ArrivalItem[]
  @@unique([productId, sizeId])
}
```

> Le **prix d'achat n'apparaît PAS ici** (§8) : il vit dans `StockLot.unitCost` / `ArrivalItem.unitCost`.

```prisma
// ───────────────────────── PARTIES TIERS ─────────────────────────
model Supplier {
  id        String   @id @default(cuid())
  name      String
  phone     String?
  address   String?
  notes     String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  arrivals  Arrival[]
  debts     Debt[]
  payments  Payment[]
  @@index([name])
}

model Customer {
  id        String   @id @default(cuid())
  name      String
  phone     String?
  address   String?
  notes     String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  sales     Sale[]
  debts     Debt[]
  payments  Payment[]
  @@index([name])
}

model OnlineSeller {
  id        String   @id @default(cuid())
  name      String
  phone     String?
  address   String?
  notes     String?
  status    String   @default("ACTIVE")   // ACTIVE / INACTIVE
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  sales     Sale[]
  debts     Debt[]
  payments  Payment[]
  @@index([name])
}
```

> **Aucun champ** de type dépense / boost / pub / bénéfice / CA sur `OnlineSeller` (§28, §67).

```prisma
// ───────────────────────── ARRIVAGES / CARTONS / LOTS ─────────────────────────
model Arrival {
  id           String              @id @default(cuid())
  reference    String              @unique     // « ARR-0001 »
  supplierId   String
  supplier     Supplier            @relation(fields: [supplierId], references: [id])
  date         DateTime            @default(now())
  notes        String?
  status       ArrivalStatus       @default(RECEIVED)
  totalCost    Decimal             @db.Decimal(18, 0)
  paidAmount   Decimal             @default(0) @db.Decimal(18, 0)
  unpaidAmount Decimal             @default(0) @db.Decimal(18, 0)
  createdById  String?
  cancelledAt  DateTime?
  cancelReason String?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  cartons      ArrivalCarton[]
  lots         StockLot[]
  debt         Debt?
  payments     Payment[]
  fundings     FundingAllocation[]
  @@index([supplierId, date])
  @@index([date])
}

model ArrivalCarton {
  id         String        @id @default(cuid())
  reference  String        // « Carton 1 »
  arrivalId  String
  arrival    Arrival       @relation(fields: [arrivalId], references: [id], onDelete: Cascade)
  date       DateTime      @default(now())
  notes      String?
  totalCost  Decimal       @default(0) @db.Decimal(18, 0)
  totalQty   Int           @default(0)
  createdAt  DateTime      @default(now())
  items      ArrivalItem[]
  lots       StockLot[]
  @@unique([arrivalId, reference])
}

model ArrivalItem {
  id           String         @id @default(cuid())
  cartonId     String
  carton       ArrivalCarton  @relation(fields: [cartonId], references: [id], onDelete: Cascade)
  variantId    String
  variant      ProductVariant @relation(fields: [variantId], references: [id])
  quantity     Int
  unitCost     Decimal        @db.Decimal(18, 0)   // prix d'achat de CETTE ligne
  lineTotal    Decimal        @db.Decimal(18, 0)   // quantity × unitCost
  createdAt    DateTime       @default(now())
  stockLots    StockLot[]
  @@index([cartonId])
  @@index([variantId])
}

model StockLot {
  id           String         @id @default(cuid())
  code         String         @unique              // « LOT-0001 »
  arrivalId    String
  arrival      Arrival        @relation(fields: [arrivalId], references: [id])
  cartonId     String
  carton       ArrivalCarton  @relation(fields: [cartonId], references: [id])
  arrivalItemId String
  arrivalItem  ArrivalItem    @relation(fields: [arrivalItemId], references: [id])
  supplierId   String
  variantId    String
  variant      ProductVariant @relation(fields: [variantId], references: [id])
  sizeId       String
  initialQty   Int
  remainingQty Int
  unitCost     Decimal        @db.Decimal(18, 0)   // ← IMMUABLE (§14, §66)
  totalCost    Decimal        @db.Decimal(18, 0)   // initialQty × unitCost
  entryDate    DateTime
  status       String         @default("OPEN")     // OPEN | DEPLETED | CANCELLED
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  movements    StockMovement[]
  saleAllocs   SaleItemLot[]
  @@index([variantId, remainingQty, entryDate])
  @@index([arrivalId])
}

model StockMovement {
  id        String            @id @default(cuid())
  lotId     String?
  lot       StockLot?         @relation(fields: [lotId], references: [id])
  variantId String
  type      StockMovementType
  quantity  Int               // toujours > 0 ; le signe est porté par type
  unitCost  Decimal?          @db.Decimal(18, 0)
  refType   String?           // SALE | ARRIVAL | ADJUSTMENT | CANCEL
  refId     String?
  date      DateTime          @default(now())
  notes     String?
  userId    String?
  createdAt DateTime          @default(now())
  @@index([variantId, date])
  @@index([refType, refId])
}

model FundingAllocation {
  id        String        @id @default(cuid())
  arrivalId String
  arrival   Arrival       @relation(fields: [arrivalId], references: [id], onDelete: Cascade)
  source    FundingSource
  amount    Decimal       @db.Decimal(18, 0)
  notes     String?
  createdAt DateTime      @default(now())
  @@index([arrivalId])
}
```

```prisma
// ───────────────────────── VENTES ─────────────────────────
model Sale {
  id              String          @id @default(cuid())
  reference       String          @unique          // « VTE-0001 »
  date            DateTime        @default(now())
  customerId      String?
  customer        Customer?       @relation(fields: [customerId], references: [id])
  onlineSellerId  String?
  onlineSeller    OnlineSeller?   @relation(fields: [onlineSellerId], references: [id])
  status          SaleStatus      @default(UNPAID)
  totalAmount     Decimal         @db.Decimal(18, 0)
  paidAmount      Decimal         @default(0) @db.Decimal(18, 0)
  remainingAmount Decimal         @default(0) @db.Decimal(18, 0)
  cogs            Decimal         @default(0) @db.Decimal(18, 0)
  margin          Decimal         @default(0) @db.Decimal(18, 0)
  paymentMethod   String?
  notes           String?
  createdById     String?
  cancelledAt     DateTime?
  cancelReason    String?
  idempotencyKey  String?         @unique
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  items           SaleItem[]
  payments        Payment[]
  debt            Debt?
  @@index([date])
  @@index([customerId])
  @@index([onlineSellerId])
  @@index([status])
}

model SaleItem {
  id         String         @id @default(cuid())
  saleId     String
  sale       Sale           @relation(fields: [saleId], references: [id], onDelete: Cascade)
  variantId  String
  variant    ProductVariant @relation(fields: [variantId], references: [id])
  sizeId     String
  quantity   Int
  unitPrice  Decimal        @db.Decimal(18, 0)   // prix de VENTE figé (§19)
  lineTotal  Decimal        @db.Decimal(18, 0)
  unitCost   Decimal?       @db.Decimal(18, 0)   // coût moyen résolu (reporting)
  cogs       Decimal        @default(0) @db.Decimal(18, 0)
  lots       SaleItemLot[]
  @@index([saleId])
  @@index([variantId])
}

model SaleItemLot {
  id         String   @id @default(cuid())
  saleItemId String
  saleItem   SaleItem @relation(fields: [saleItemId], references: [id], onDelete: Cascade)
  lotId      String
  lot        StockLot @relation(fields: [lotId], references: [id])
  quantity   Int
  unitCost   Decimal  @db.Decimal(18, 0)
  @@index([lotId])
}
```

```prisma
// ───────────────────────── DETTES & PAIEMENTS ─────────────────────────
model Debt {
  id              String       @id @default(cuid())
  type            DebtType
  direction       DebtDirection
  origin          DebtOrigin
  saleId          String?      @unique           // lien 1-1 vers la vente
  arrivalId       String?      @unique           // lien 1-1 vers l'arrivage
  customerId      String?
  customer        Customer?    @relation(fields: [customerId], references: [id])
  onlineSellerId  String?
  onlineSeller    OnlineSeller? @relation(fields: [onlineSellerId], references: [id])
  supplierId      String?
  supplier        Supplier?    @relation(fields: [supplierId], references: [id])
  partyName       String?                     // obligatoire si type = TROSA_SINOA
  reason          String                      // MOTIF OBLIGATOIRE (§31, §68)
  initialAmount   Decimal      @db.Decimal(18, 0)
  paidAmount      Decimal      @default(0) @db.Decimal(18, 0)
  remainingAmount Decimal      @db.Decimal(18, 0)
  date            DateTime     @default(now())
  dueDate         DateTime?
  status          DebtStatus   @default(OPEN)
  cancelledAt     DateTime?
  cancelReason    String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  payments        Payment[]
  @@index([type, status])
  @@index([customerId])
  @@index([onlineSellerId])
  @@index([supplierId])
  @@index([saleId])
  @@index([arrivalId])
  @@index([date])
}

model Payment {
  id             String            @id @default(cuid())
  reference      String?           @unique       // « PAY-0001 »
  date           DateTime          @default(now())
  amount         Decimal           @db.Decimal(18, 0)
  direction      PaymentDirection
  partyType      PaymentPartyType
  partyId        String?                           // customerId / supplierId / …
  debtId         String?
  debt           Debt?             @relation(fields: [debtId], references: [id])
  saleId         String?
  sale           Sale?             @relation(fields: [saleId], references: [id])
  arrivalId      String?
  arrival        Arrival?          @relation(fields: [arrivalId], references: [id])
  method         String?                           // CASH | MOBILE_MONEY | …
  notes          String?
  userId         String?
  idempotencyKey String?           @unique
  createdAt      DateTime          @default(now())
  @@index([debtId])
  @@index([partyType, partyId])
  @@index([date])
}
```

```prisma
// ───────────────────────── FINANCES ─────────────────────────
model ExpenseCategory {
  id       String    @id @default(cuid())
  name     String    @unique
  icon     String?
  order    Int       @default(0)
  active   Boolean   @default(true)
  expenses Expense[]
}

model Expense {
  id          String          @id @default(cuid())
  categoryId  String
  category    ExpenseCategory @relation(fields: [categoryId], references: [id])
  amount      Decimal         @db.Decimal(18, 0)
  date        DateTime        @default(now())
  description String
  method      String?
  reference   String?
  notes       String?
  userId      String?
  createdAt   DateTime        @default(now())
  @@index([categoryId, date])
  @@index([date])
}

model Versement {
  id          String              @id @default(cuid())
  personName  String
  amount      Decimal             @db.Decimal(18, 0)
  date        DateTime            @default(now())
  motif       String
  method      String?
  comment     String?
  treatment   VersementTreatment  @default(CHARGE)
  debtId      String?             // si règlement d'une dette (TROSA_SINOA créancier)
  userId      String?
  createdAt   DateTime            @default(now())
  @@index([personName, date])
  @@index([date])
}

model PersonalCapitalMovement {
  id              String              @id @default(cuid())
  type            CapitalMovementType // IN = injection, OUT = récupération (§34)
  amount          Decimal             @db.Decimal(18, 0)
  date            DateTime            @default(now())
  motif           String
  destinationType String?             // ARRIVAL | EXPENSE | CASH
  destinationId   String?
  reference       String?
  comment         String?
  userId          String?
  createdAt       DateTime            @default(now())
  @@index([type, date])
  @@index([date])
}

model LedgerEntry {
  id          String     @id @default(cuid())
  seq         BigInt     @unique @default(autoincrement())
  date        DateTime   @default(now())
  kind        LedgerKind
  amount      Decimal    @db.Decimal(18, 0)   // montant de l'écriture (toujours > 0)
  cashDelta   Decimal    @db.Decimal(18, 0)   // impact caisse (peut être 0)
  description String
  reference   String?
  refType     String?    // SALE | DEBT | PAYMENT | ARRIVAL | EXPENSE | …
  refId       String?
  saleId      String?
  debtId      String?
  paymentId   String?
  arrivalId   String?
  expenseId   String?
  userId      String?
  createdAt   DateTime   @default(now())
  @@index([date])
  @@index([kind, date])
  @@index([refType, refId])
}

model IdempotencyRecord {
  key        String   @id
  userId     String?
  endpoint   String
  statusCode Int
  body       Json
  createdAt  DateTime @default(now())
}

model Setting {
  key   String @id
  value Json
}
```

---

## 5. Relations entre les tables (schéma relationnel)

```
Role 1 ──── * User

Product 1 ──── * ProductVariant * ──── 1 Size

Supplier 1 ──── * Arrival 1 ──── * ArrivalCarton 1 ──── * ArrivalItem
    │                  │                    │                   │
    │                  │                    └───────────────────┤
    │                  │                                        ▼
    │                  └────────────── * StockLot * ──── 1 ProductVariant
    │                                        │
    │                                        ├── 1 ──── * StockMovement
    │                                        └── 1 ──── * SaleItemLot * ──── 1 SaleItem * ──── 1 Sale
    │                                                                          │
    ├── * Debt (SUPPLIER) ◄── origin=ARRIVAL                                   │
    └── * Payment (OUT)                                                        │
                                                                               │
Customer   1 ──── * Sale ──────────────────────────────────────────────────────┘
              │      └── * Payment (IN) ; 1 ──── Debt (CUSTOMER)
              └── * Debt (CUSTOMER)

OnlineSeller 1 ──── * Sale ── * Payment ; 1 ──── Debt (ONLINE_SELLER)
                              ⚠ AUCUNE table de dépenses/revenus/bénéfices

Debt 1 ──── * Payment                       (type ∈ CUSTOMER|ONLINE_SELLER|SUPPLIER|TROSA_SINOA)

ExpenseCategory 1 ──── * Expense
Versement            (autonome, debtId nullable)
PersonalCapitalMovement (autonome, destination polymorphe)
LedgerEntry           (références polymorphes vers Sale/Debt/Payment/Arrival/Expense)
FundingAllocation * ──── 1 Arrival
IdempotencyRecord, Setting (autonomes)
```

**Clés étrangères** : toutes présentes ci-dessus.
**Contraintes uniques utiles** :
`Arrival.reference`, `Sale.reference`, `StockLot.code`, `Payment.reference`, `Payment.idempotencyKey`, `Sale.idempotencyKey`, `ProductVariant(productId,sizeId)`, `Size.value`, `ArrivalCarton(arrivalId,reference)`, `Setting.key`, `LedgerEntry.seq`.
**Index** : posés sur toutes les clés de filtrage (dates, types, tiers).

---

## 6. Stratégie de gestion des lots

1. **Un lot = une ligne de carton** (`ArrivalItem`) → `StockLot` créé atomiquement lors de l'enregistrement de l'arrivage.
2. Le `unitCost` du lot est **écrit une seule fois** et **jamais modifié** (§14, §66). Toute correction passe par :
   - une **annulation** de l'arrivage (si stock intacte) → écritures `REVERSAL`, ou
   - un **mouvement d'ajustement** (si le stock a déjà bougé).
3. `remainingQty` est le seul champ mutable du lot, **uniquement** via `fifo.service` ou un ajustement.
4. **Valeur du stock = `Σ (remainingQty × unitCost)`** — jamais `quantité totale × prix d'achat actuel` (§17).
5. **Historique des prix** = `SELECT unitCost, entryDate, supplier, arrival.reference FROM StockLot WHERE variantId = ? ORDER BY entryDate` (§18) — lecture directe des lots, pas d'historique parallèle à maintenir.
6. Chaque variation de `remainingQty` génère un `StockMovement` (IN/OUT/ADJUSTMENT/RETURN/REVERSAL) → piste d'audit complète.

---

## 7. Stratégie FIFO

**Règle par défaut : FIFO** (§16), applicable globalement, surchargeable par vente (choix manuel du lot).

```
allocateFIFO(tx, variantId, qtyRequested):
  lots = SELECT * FROM StockLot
         WHERE variantId = ? AND remainingQty > 0 AND status = 'OPEN'
         ORDER BY entryDate ASC, createdAt ASC, id ASC      -- déterministe
         FOR UPDATE                                          -- verrou anti-survente

  remaining = qtyRequested
  allocations = []
  for lot in lots:
     take = min(remaining, lot.remainingQty)
     if take > 0:
        allocations.push({ lotId: lot.id, quantity: take, unitCost: lot.unitCost })
        lot.remainingQty -= take
        remaining -= take
     if remaining == 0: break

  if remaining > 0 → throw INSUFFICIENT_STOCK (HTTP 409)
                     (option : autoriser la vente en rupture via flag `allowBackorder`)

  cogs = Σ (take × lot.unitCost)
```

**Application (Test 4)** : lots `10×20` puis `8×23`, vente de 12 → `10×20 + 2×23` → **COGS = 246**.

- Tout se passe dans la **même transaction Prisma** que la vente.
- Isolation : `prisma.$transaction(fn, { isolationLevel: 'Serializable' })` **ou** verrouillage `SELECT … FOR UPDATE` par `variantId` (via `$queryRaw`), pour éviter deux ventes simultanées de puisent le même lot.
- **Retour/annulation de vente** : on restitue les quantités **dans les mêmes lots** (`SaleItemLot`), jamais FIFO inversé générique.

---

## 8. Formules financières

> Toutes les formules sont calculées **depuis le journal (`LedgerEntry`), les dettes (`Debt`) et les lots (`StockLot`)** — jamais saisies à la main.
> Notation : `PERIODE` = filtre demandé (jour, 7 j, mois, année…) ; `À DATE` = état cumulé jusqu'à la fin de la période.

### 8.1 Flux (sur PÉRIODE)

| Indicateur | Formule | Source |
|---|---|---|
| **CA** | `Σ amount WHERE kind = 'SALE'` | `LedgerEntry` |
| **COGS** | `Σ amount WHERE kind = 'COGS'` | `LedgerEntry` |
| **Bénéfice brut** | `CA − COGS` | calcul |
| **Recettes (encaissements)** | `Σ cashDelta WHERE cashDelta > 0 AND kind ∈ {SALE, CUSTOMER_PAYMENT, ONLINE_SELLER_PAYMENT}` | `LedgerEntry` |
| ↳ dont *ventes encaissées du moment* | `Σ cashDelta WHERE kind = 'SALE' AND cashDelta > 0` | sous-indicateur |
| **Dépenses** | `Σ amount WHERE kind = 'EXPENSE'` | `LedgerEntry` |
| **Versements (charges)** | `Σ amount WHERE kind = 'VERSEMENT' AND treatment = 'CHARGE'` | `LedgerEntry` |
| **Bénéfice net** | `Bénéfice brut − Dépenses − Versements(charges)` | calcul |
| **Sorties de caisse** | `Σ −cashDelta WHERE cashDelta < 0` | `LedgerEntry` |

**Ce qui NE réduit JAMAIS le bénéfice net** (§45) : paiement de dette fournisseur, récupération d'argent propre, remboursement de capital, retrait de bénéfice, remboursement de dette par versement.

### 8.2 États (À DATE)

| Indicateur | Formule | Source |
|---|---|---|
| **Caisse** | `soldeInitial + Σ cashDelta` (toutes écritures, toutes périodes) | `LedgerEntry` |
| **Valeur du stock** | `Σ (StockLot.remainingQty × StockLot.unitCost)` + `Σ (ArrivalCarton.totalCost − Σ ArrivalItem.lineTotal)` hors arrivages annulés | `StockLot`, `ArrivalCarton` |
| **Dettes clients** | `Σ remainingAmount WHERE type='CUSTOMER' AND status ≠ 'PAID'` | `Debt` |
| **Dettes vendeurs en ligne** | `Σ remainingAmount WHERE type='ONLINE_SELLER'` | `Debt` |
| **Dettes fournisseurs** | `Σ remainingAmount WHERE type='SUPPLIER'` | `Debt` |
| **Trosa sinoa** | `Σ remainingAmount WHERE type='TROSA_SINOA' AND direction='RECEIVABLE'` (créance) / `'PAYABLE'` (dette) | `Debt` |
| **Argent à recevoir** | dettes clients + dettes vendeurs + trosa (créance) | `Debt` |
| **Argent à payer** | dettes fournisseurs + trosa (dette) | `Debt` |
| **Argent propre engagé (K)** | `Σ capital IN − Σ capital OUT` | `PersonalCapitalMovement` |
| **Quantité stock** | `Σ StockLot.remainingQty` + `Σ (ArrivalCarton.totalQty − Σ ArrivalItem.quantity)` hors arrivages annulés | `StockLot`, `ArrivalCarton` |

### 8.3 Agrégats dérivés (identité comptable)

Soit :

```
CAISSE  (F) = soldeInitial + Σ cashDelta
STOCK   (I) = Σ (remainingQty × unitCost)
CREANCES(G) = Argent à recevoir
PASSIFS (H) = Argent à payer
CAPITAL (K) = Argent propre engagé
```

**Identité fondamentale** (démontrée, vérifiable dans les tests) :

```
F + I + G − H = K + (CA − COGS − Dépenses − Versements_charges)
```

d'où :

| Indicateur | Formule |
|---|---|
| **Vola miodina** | `CAISSE + STOCK + CREANCES − PASSIFS` |
| **Bénéfice net cumulé** | `VOLA_MIODINA − ARGENT_PROPRE_ENGAGE` |
| *(contrôle)* | `= CA_cumulé − COGS_cumulé − Dépenses − Versements_charges` |

Chaque terme est directement traçable → conforme à §62.

### 8.4 Exemple chiffré (validation des formules)

| Étape | F (caisse) | I (stock) | G (créances) | H (passifs) | K (capital) | CA | COGS | Dép. | Bénéfice net |
|---|---|---|---|---|---|---|---|---|---|
| Injection 100 | 100 | 0 | 0 | 0 | 100 | 0 | 0 | 0 | 0 |
| Achat stock 100 | 0 | 100 | 0 | 0 | 100 | 0 | 0 | 0 | 0 |
| Vente 120 payée | 120 | 0 | 0 | 0 | 100 | 120 | 100 | 0 | **20** |
| Vola = 120+0−0 = 120 = K(100) + 20 ✓ | | | | | | | | | |

---

## 9. Stratégie de calcul du BÉNÉFICE DISPONIBLE

**Règle (A3, révisée le 07/10/2026)** : le bénéfice disponible est un **état cumulé à date**, pas un flux de période. Il répond à la question *« combien puis-je retirer maintenant ? »* — et la réponse est **tout le bénéfice net qui n'a pas encore été sorti**.

```
BÉNÉFICE_DISPONIBLE = max(0, BÉNÉFICE_NET_CUMULÉ_NON_SORTI)
                     = max(0, VOLA − ARGENT_PROPRE_ENGAGÉ)
```

- `max(0, ...)` : on ne retire jamais **moins que zéro** — tant que le bénéfice net non sorti est nul ou négatif, il n'y a rien à sortir.
- **Seul l'argent propre (K) est soustrait** : il n'est pas du bénéfice mais du capital (§34). Les retraits déjà effectués diminuent aussi le disponible (ils sortent de la caisse) — d'où l'invariant §45 `total réalisé = sorti + non sorti`.
- **Révision A3** : l'ancienne règle `min(net cumulé, caisse − passifs − argent propre − réserve)` plafonnait le retrait à l'excédent de caisse — une vente à crédit ou du stock non vendu affichait « 0 » alors que le bénéfice était bien gagné. La caisse, les passifs et la réserve ne bornent plus la sortie : un retrait peut descendre la caisse sous les passifs, l'identité comptable (§8.3) reste vérifiée. Le paramètre `WORKING_RESERVE` (réserve de rotation) est **supprimé**.

**Vérifications :**

| Situation | CAISSE | K | Net non sorti | Disponible |
|---|---|---|---|---|
| Vente intégralement payée (ex. §8.4) | 120 | 100 | 20 | 20 ✓ |
| Stock à moitié vendu, tout encaissé | 75 | 100 | 25 | 25 ✓ (le stock ne bloque pas) |
| Vente à crédit, jamais encaissée | 60 | 100 | 20 | 20 ✓ (le client ne bloque pas) |
| Tout encaissé après règlement du client | 120 | 100 | 20 | 20 ✓ |
| Retrait de 20 déjà effectué | 100 | 100 | 0 | 0 ✓ |

**Ne jamais** déclarer la totalité de la caisse comme bénéfice (§7) — c'est précisément ce que soustrait `ARGENT_PROPRE_ENGAGÉ` : le disponible se calcule sur le vola, pas sur la caisse seule.

**Bénéfice net sur période** reste affiché séparément (indicateur d'activité), il n'est pas égal au disponible (qui est cumulé).

---

## 10. Stratégie de calcul du VOLA MIODINA

**Définition VALIDÉE (A4)** : le vola miodina est **tout le capital qui tourne dans l'activité**, c'est-à-dire l'argent effectivement immobilisé dans le cycle d'exploitation.

```
VOLA_MIODINA = CAISSE + VALEUR_DU_STOCK + ARGENT_A_RECEVOIR − ARGENT_A_PAYER
```

L'identité §8.3 démontre que :

```
VOLA_MIODINA = ARGENT_PROPRE_ENGAGÉ + BÉNÉFICE_NET_CUMULÉ
```

**Lecture opérationnelle** (conforme à §7) :

| Composante | Présente dans la formule ? |
|---|---|
| Capital engagé (`ARGENT_PROPRE_ENGAGÉ`) | ✔ terme 1 de l'identité |
| Argent nécessaire pour renouveler les marchandises (`STOCK`) | ✔ terme 2 |
| Argent propre encore engagé | ✔ idem terme 1 |
| Fond de fonctionnement (`CAISSE` + `CREANCES` − `PASSIFS`) | ✔ termes 1, 3, 4 |
| Bénéfice non sorti | ✔ terme 2 de l'identité |

**À distinguer clairement sur le dashboard :**

```
┌─ CAISSE ........................ liquidité réelle
├─ ARGENT À RECEVOIR ............. créances
├─ ARGENT À PAYER ................ passifs
├─ VALEUR DU STOCK ............... marchandise
├─ VOLA MIODINA .................. total des fonds en circulation
│     = argent propre engagé + bénéfice net cumulé
├─ ARGENT PROPRE ENGAGÉ .......... ma part (pas un bénéfice)
└─ BÉNÉFICE MANGEABLE ............ ce que je peux réellement sortir
```

**Ne jamais** confondre vola miodina, caisse et bénéfice (§46).

---

## 11. Endpoints API (REST, préfixe `/api`)

### Auth & utilisateurs
```
POST   /auth/login                     { email, password } → { accessToken, refreshToken, user }
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
GET    /users                 (ADMIN)      POST /users        PUT /users/:id     DELETE /users/:id (soft)
GET    /roles
```

### Catalogue
```
GET|POST /products            GET|PUT|DELETE /products/:id
POST     /products/:id/variants { sizeValues[] }            ← pointures DU MODÈLE (saisie rapide)
GET|POST /sizes               GET|PUT|DELETE /sizes/:id
GET|POST /variants            GET|PUT /variants/:id
PUT      /variants/:id/price  { sellingPrice }             ← historique vente figé ailleurs
GET      /variants/:id/price-history                        ← historique PRIX D'ACHAT (§18)
```

### Tiers
```
GET|POST /suppliers           GET|PUT|DELETE /suppliers/:id
                             GET /suppliers/:id/summary    ← arrivages, paiements, dette
GET|POST /customers           GET|PUT|DELETE /customers/:id
                             GET /customers/:id/summary
GET|POST /online-sellers      GET|PUT|DELETE /online-sellers/:id
                             GET /online-sellers/:id/summary
```

### Arrivages, cartons, lots
```
GET    /arrivals?from&to&supplierId&status&unventilated&q&page
POST   /arrivals                           ← transaction complète, pointures facultatives (§55)
GET    /arrivals/:id                       ← cartons + lignes + lots + dette + paiements + financements
POST   /arrivals/:id/ventilate             ← répartit les pointures d'un carton (prix unitaire imposé)
POST   /arrivals/:id/cancel                { reason } → contre-passation (pointures inconnues : simple retrait)
POST   /arrivals/:id/payments              → règlement de dette fournisseur
GET    /arrivals/reference-preview

GET    /stock/summary?variantId&from&to    ← quantité + valeur (§17)
GET    /stock/lots?variantId&status&page   ← liste des lots
GET    /stock/lots/:id/movements
GET    /stock/movements?from&to&type
POST   /stock/adjustments                  { variantId, qty, reason } (casse/perte)
```

### Ventes
```
GET    /sales?from&to&customerId&onlineSellerId&status&page
POST   /sales                              ← transaction FIFO complète (§55)
GET    /sales/:id                          ← détail complet (§49)
POST   /sales/:id/payments                 ← paiement partiel/total
POST   /sales/:id/cancel                   { reason } → restaure les lots
GET    /sales/reference-preview
```

### Dettes & paiements
```
GET    /debts?type&status&partyId&from&to&q&page
POST   /debts                              ← création manuelle (motif obligatoire)
GET    /debts/:id                          ← détail + historique paiements (§50)
POST   /debts/:id/payments                 ← paiement multiple partiel
POST   /debts/:id/cancel                   { reason }
GET    /debts/summary                      ← totals par type (dashboard)
GET    /payments?direction&partyType&from&to
POST   /payments
```

### Finances
```
GET|POST|PUT|DELETE /expenses
GET|POST|PUT        /expense-categories     PUT /expense-categories/:id { active:false } = désactivation
GET|POST|PUT|DELETE /versements
GET    /versements/summary?personName&period
GET|POST|PUT|DELETE /personal-capital
GET    /personal-capital/:id/destinations  ← où est allé l'argent (§33)
GET|POST|GET|DELETE /profit-drawings       ← retrait de bénéfice, plafond = bénéfice net non sorti
GET|POST|PUT|DELETE /trosa-sinoa            (débts filtrés type=TROSA_SINOA)
```

### Journal, dashboard, rapports
```
GET    /ledger?from&to&kind&refType&q&page  ← journal financier central (§39)
GET    /ledger/summary

GET    /dashboard?period=today|yesterday|7d|week|month|prevMonth|year|custom&from&to
       → { activity:{ca, sales, receipts, cogs, grossProfit, expenses, netProfit},
           money:{cash, receivables, payable, workingCapital, personalCapitalEngaged, disposableProfit},
           debts:{customer, onlineSeller, supplier, trosaSinoa},
           stock:{quantity, value, availableItems, soldItems},
           meta:{ period, currency } }

GET    /dashboard/:indicator/transactions?period&from&to     ← DÉRILLAGE (§62)
       indicator ∈ ca | receipts | cogs | grossProfit | expenses | netProfit
                 | cash | receivables | payable | workingCapital | personalCapital
                 | debtCustomer | debtOnlineSeller | debtSupplier | debtTrosa | stockValue

GET    /reports/daily?date=
GET    /reports/monthly?year&month=          ← inclut top produits, bénéfice/produit, dépenses/catégorie
GET    /reports/export.pdf?type=daily|monthly&date|year&month
```

### Divers
```
GET|PUT /settings
POST   /idempotency/:key/verify              (ou header `Idempotency-Key`)
GET    /health
```

**Conventions** : pagination `page`/`limit`, tris `sort`, dates ISO-8601, montants renvoyés en **string** (`"246.00"`) pour éviter toute perte de précision flottante.

---

## 12. Plan de développement par étapes

| Phase | Contenu | Points de contrôle / tests | ⏹ Commit |
|---|---|---|---|
| **1** Analyse | Ce document : analyse, ambiguïtés | Revue utilisateur | ✔ |
| **2** Architecture | Structure des dossiers, couches, conventions, `.env.example` | Revue | ✔ |
| **3** Schéma Prisma | `schema.prisma` complet + 1ʳᵉ migration + seed minimal | `prisma validate`, `migrate dev`, `db pull` | ✔ |
| **4** Formules financières | `docs/FORMULES.md` validé + unit tests purs de `metrics.service` | Tests des identités §8.3 | ✔ |
| **5a** Backend — socle | Express + TS strict, helmet/cors, error handler, Prisma, Zod, auth JWT (login/refresh/logout/me), RBAC, seed utilisateurs | Tests : login, mauvais mdp, refresh, RBAC | ✔ |
| **5b** Backend — référentiels | products/sizes/variants, suppliers/customers/online-sellers, expense-categories, settings | Tests CRUD + validation Zod | ✔ |
| **5c** Backend — arrivages & stock | Arrivage transactionnel (cartons → lignes → lots → mouvements → dette fournisseur → paiement → ledger), valorisation, historique prix | **Tests 1, 2, 3, 8, 9** | ✔ |
| **5d** Backend — ventes | Vente transactionnelle FIFO, `SaleItemLot`, COGS, statuts, dettes clients/vendeurs, paiements | **Tests 4, 5, 6, 10** | ✔ |
| **5e** Backend — dettes & paiements | Dette générique, paiements multiples, motifs auto, contre-passation | **Test 7** | ✔ |
| **5f** Backend — finances | dépenses, versements, argent propre, trosa sinoa, financement mixte, journal | **Tests 11, 12** | ✔ |
| **5g** Backend — dashboard & rapports | `metrics.service`, drill-down par indicateur, rapports journalier/mensuel, export PDF | Test : chaque indicateur = somme de sa liste de transactions | ✔ |
| **5h** Backend — seed & tests E2E | Données de test réalistes (§59), suite des 12 scénarios complète, couverture | `npm test` vert | ✔ |
| **6a** Mobile — socle | Expo + Expo Router + TS strict + NativeWind, Axios instance, React Query, Zustand, SecureStore, écran login, navigation onglets | Build dev OK | ✔ |
| **6b** Mobile — dashboard | Cartes, KPI, filtres de période, drill-down cliquable | Comparaison avec l'API | ✔ |
| **6c** Mobile — arrivage | **Saisie rapide carton** (§12) : grille pointure/quantité/prix, « appliquer le prix à plusieurs pointures », copier un prix, multi-cartons | Ergonomie sur 7 pointures × N modèles | ✔ |
| **6d** Mobile — ventes | Création rapide, détail vente (§49), paiements | — | ✔ |
| **6e** Mobile — stock / dettes / finances | Lots, historique prix, dettes + détail (§50), dépenses, versements, argent propre, trosa | — | ✔ |
| **6f** Mobile — rapports & paramètres | Rapports, export PDF, gestion catalogue/tiers/catégories/utilisateurs | — | ✔ |
| **7** Tests | Recette des 12 scénarios de bout en bout (API + UI), tests d'intégrité (rollback), tests d'anti-double-soumission | Check-list §60 validée | ✔ |
| **8** Build | `eas build` / `expo prebuild` → **APK** (+ **AAB**), instructions dans le README | APK installable | ✔ |

**Règle de progression** : après chaque phase → explication, fichiers importants, tests lancés, erreurs corrigées, cohérence métier vérifiée. **Aucune phase suivante tant que la précédente n'est pas verte.**

---

## 13. Livrables finaux attendus

- `/backend` : code TS strict, `schema.prisma`, migrations, seed, API REST, validation, auth, tests, `.env.example`
- `/mobile` : app Expo (Expo Router), code TS, validation, auth, `.env.example`
- `docs/ANALYSE.md`, `docs/FORMULES.md`, `docs/API.md`
- `README.md` : installation, lancement, build Android (APK/AAB)

**Politique du seed** (choix explicite) : `npm run db:seed` ne crée **que** les
rôles et `admin@test.local` — la base part vierge, aucune donnée métier, pour
tout tester depuis l'interface. `prisma/reference.ts` (pointures 36-44, 6
catégories de dépenses, 4 modes de paiement) est appelé par la suite de tests
(`tests/setup/global.ts`) et par `npm run db:seed:demo`, qui ajoute les données
de démonstration de `prisma/demo.ts` si l'on veut une base remplie.

---

## 14. Décisions validées (Phase 1 CLOSE)

### 14.1 Décisions explicites de l'utilisateur

| # | Décision |
|---|---|
| **A1** | **TROSA SINOA = argent que JE DOIS.** `Debt.direction = PAYABLE` **imposé** pour `type = TROSA_SINOA`. C'est une dette **manuelle**, distincte des dettes fournisseurs générées automatiquement par un arrivage. Elle entre dans **ARGENT À PAYER** et dans la section séparée §32 |
| **A2** | **Versement → `DEBT_SETTLEMENT` par défaut.** Si la personne a une dette **payable** ouverte (`TROSA_SINOA`), le versement la réduit et n'affecte pas le bénéfice. Sinon → `CHARGE` (réduit le bénéfice net). Le type est choisi/modifiable à la saisie |
| **A3** | **Bénéfice disponible = `max(0, bénéfice net cumulé non sorti)` = `max(0, vola − argent propre engagé)`**, cumulé à date — plafond d'un retrait, indépendant de la caisse et des passifs (révisé le 07/10/2026 ; l'ancienne règle à l'excédent de caisse et la `réserve` sont supprimées) |
| **A4** | **Vola miodina = `caisse + stock + créances − passifs`** (= `argent propre engagé + bénéfice net cumulé`) |
| **A5** | **Deux opérations distinctes** : `PERSONAL_CAPITAL_OUT` (récupération de capital, `K` diminue) et `PROFIT_DRAWING` (retrait de bénéfice, `K` inchangé) |
| **A9** | **`Decimal(18, 0)` — montants entiers uniquement** (ariary sans décimale) |

### 14.2 Défauts retenus sur les ambiguïtés non bloquantes

| # | Défaut retenu |
|---|---|
| **A6** | `Recettes` = **tous** les encaissements issus des ventes (du moment **+** règlements de dettes antérieures). Sous-indicateur `ventes encaissées du moment` affiché à côté |
| **A7** | Les **flux de caisse** restent la référence ; `FundingAllocation` est une **étiquette de reporting** sur l'arrivage. Une injection d'argent propre liée à un arrivage crée une `PersonalCapitalMovement` (la somme entre en caisse) puis le paiement de l'arrivage sort de la caisse → traçabilité §33 sans double comptage |
| **A8** | Une dépense est **toujours réglée** (sortie de caisse). Pas de « dette dépense » en v1 |
| **A10** | `ProductVariant.sellingPrice` = prix par défaut, **prix libre modifiable sur chaque ligne de vente** (couvre le prix vendeur en ligne). Listes de prix = évolution |
| **A11** | **Prévus** : `POST /sales/:id/cancel` (contre-passation, restaure les mêmes lots) et `POST /stock/adjustments` (casse/perte/vol) |
| **A12** | Versement à la **saisie manuelle** en v1 + vue historique par personne (§38) |
| **A13** | Timezone **`Indian/Antananarivo` (UTC+3)**, bornes de période calculées **côté serveur** |
| **A14** | Rôles `ADMIN` / `MANAGER` / `CASHIER` — portée du caissier : **vente (création / modification du client comprises), dépenses (création / correction / suppression) et stock en lecture** ; les lectures financières de gestion (dettes, versements, argent propre, trosa, arrivages, journal, rapports) passent en `manager`, le dashboard et les catégories de dépense restent ouverts |
| **A15** | **Une seule table `Debt`** — vue dashboard (§6) + vue section séparée (§32) |

### 14.3 Règles dérivées imposées par ces décisions

1. **Créer une dette `TROSA_SINOA` ⇒ encaissement** : écriture `LedgerKind.TROSA_BORROW` avec `cashDelta = +montant` (j'ai bien reçu l'argent). C'est ce qui **préserve l'identité comptable** du §8.3 — une dette créée sans contrepartie casserait l'équation.
2. **Règlement d'une trosa sinoa** (versement `DEBT_SETTLEMENT` ou paiement) ⇒ `LedgerKind.TROSA_REPAY` avec `cashDelta = −montant`.
3. **Retrait de bénéfice** ⇒ `LedgerKind.PROFIT_DRAWING` avec `cashDelta = −montant`, sans toucher à `K`.
4. **`PASSIFS (H)` = dettes fournisseurs + trosa sinoa (payable).**
5. Toute dette `TROSA_SINOA` a `direction = PAYABLE` (contrainte validée par Zod + service).

---

## 15. Prochaine étape

Phase 1 **terminée et commitée**. Ensuite, dans l'ordre :

- **Phase 2** — architecture : arborescence, conventions de code, `tsconfig`, `.env.example`, Couches Express.
- **Phase 3** — `backend/prisma/schema.prisma` complet (validé par `prisma validate`) + migration initiale + seed minimal.
- **Phase 4** — `docs/FORMULES.md` + tests unitaires purs des formules et de l'identité §8.3.

---

## 16. Les 12 scénarios E2E (Phases 5h et 7)

> Reconstitués depuis le plan de phases (§12), qui attribue les tests aux
> phases : **1, 2, 3, 8, 9** → arrivages/stock ; **4, 5, 6, 10** → ventes ;
> **7** → dettes ; **11, 12** → finances. Chaque scénario est joué de bout en
> bout dans `backend/tests/e2e.test.ts`, dans son propre contexte, sans
> dépendre d'une autre suite.

| # | Scénario | Phase | Ce qui doit être vérifié |
|---|---|---|---|
| **1** | **Arrivage complet réglé d'emblée** | 5c | Cartons → lignes → `StockLot` (FIFO) → `StockMovement` → paiement intégral → écriture `SUPPLIER_PAYMENT`, dette fournisseur `PAID`, stock et valeur à jour, `reference` `ARR-####` |
| **2** | **Arrivage à crédit partiel** | 5c | Paiement partiel, `Debt` fournisseur `PARTIAL` avec `remainingAmount` exact, écritures `SUPPLIER_PAYMENT` pour la part réglée, identité comptable préservée |
| **3** | **Annulation d'un arrivage** | 5c | Lots `CANCELLED` (exclus de la valorisation), dette `CANCELLED`, **contre-passation** de toutes les écritures positives (`amount` et `cashDelta` inversés, kind identique), stock inchangé |
| **4** | **Vente FIFO** | 5d | Allocation `entryDate ASC`, `SaleItemLot` figé par lot, `COGS` = coût réel des lots sortis, `margin` = CA − COGS, écritures `SALE` (`cashDelta` = part encaissée) et `COGS` (`cashDelta` = 0) |
| **5** | **Annulation d'une vente** | 5d | Quantités restituées **dans les mêmes lots**, `StockMovement` de type `RETURN`, dette `CANCELLED`, chaque écriture positive de la vente contre-passée, `Σ amount WHERE kind='SALE'` redevenu exact |
| **6** | **Vente à crédit** | 5d | Dette client / vendeur en ligne ouverte, **motif auto** (`Achat de … — non payé`), `SaleStatus = UNPAID`, aucun encaissement au journal côté recettes |
| **7** | **Dettes génériques & paiements multiples** | 5e | `POST /debts` (motif obligatoire généré, **contrepartie de caisse** pour l'identité), règlements successifs `OPEN → PARTIAL → PAID`, refus du trop-perçu, refus d'annuler une dette née d'une vente |
| **8** | **Valorisation du stock à la date + prix d'achat** | 5c | `quantitéRestanteLot(T)` exclut les `IN` postérieurs à `T` et les lots `CANCELLED`, historique des prix d'achat par variante (`/variants/:id/price-history`) |
| **9** | **Lots & mouvements (FIFO verrouillé)** | 5c | Tri `entryDate ASC, createdAt ASC, id ASC` sous `FOR UPDATE`, historique complet par lot (`/stock/lots/:id/movements`), ajustement de perte → `Expense` + écriture `EXPENSE` `cashDelta = 0` |
| **10** | **Règlements de vente** | 5d | Paiement partiel puis solde, dette synchronisée, écritures `CUSTOMER_PAYMENT` / `ONLINE_SELLER_PAYMENT` avec `cashDelta = +montant`, `SaleStatus` `UNPAID → PARTIAL → PAID` |
| **11** | **Dépenses & versements (A2)** | 5f | Dépense toujours réglée (`cashDelta = −montant`), correction/suppression par contre-passation ; versement **auto** `DEBT_SETTLEMENT` si une trosa est ouverte (écriture `TROSA_REPAY`, hors bénéfice), sinon `CHARGE` (écriture `VERSEMENT`, réduit le bénéfice) |
| **12** | **Argent propre, trosa sinoa & financement mixte (A7)** | 5f | `PERSONAL_CAPITAL_IN/OUT` ⇔ `K`, trosa `PAYABLE` avec encaissement `TROSA_BORROW` (A1), traçabilité d'une injection liée à un arrivage (`/personal-capital/:id/destinations`), **double comptage impossible** |

**Point de contrôle transverse** (Phase 5g) : pour chaque indicateur du
dashboard, `GET /dashboard/:indicator/transactions` doit sommer exactement à
l'affichage de l'indicateur, et `integrity.identityDelta` doit être `0`.

Le total du dérillage est calculé **par indicateur** (`total()` dans
`src/services/metrics/index.ts`) : les indicateurs dérivés ont besoin de signes
par `kind` (`netProfit = CA − CMGP − dépenses − versements`, argent propre =
injections − récupérations), sinon la somme brute des `amount` ne retombe pas
sur la valeur affichée. Contrôlé par `backend/tests/reports.test.ts` :

- **indicateurs de période** — `ca`, `cogs`, `grossProfit`, `netProfit`,
  `receipts`, `expenses`, `versements`, `cash` : comparaison directe à la
  valeur affichée dans une fenêtre close en 2099 ;
- **indicateurs d'état** — `cashBalance`, `capital`, `profitDrawings`,
  `receivables`, `payables`, `debtsCustomer`, `debtsOnlineSeller`,
  `debtsSupplier`, `debtsTrosa`, `debtsTotal`, `stockValue`, `vola`,
  `disposableProfit` : cumulés jusqu'à la date de fin, ils captent aussi les
  écritures des autres fichiers de test — la lecture est donc encadrée de deux
  lectures du dashboard (le total doit retomber sur l'une des deux) ;
- **bénéfice disponible** : test pur sur les deux branches de la décomposition
  (bénéfice net non sorti, plancher à 0), qui ne sont pas toutes
  atteignables avec des données d'exécution réelles.


### Concurrence — quatre pièges détectés en exécution parallèle

Les fichiers de tests partagent une base et tournent en parallèle ; après
correctifs : **10 exécutions consécutives vertes (178 tests / 12 fichiers)**.

1. **Le dashboard n'était pas un instantané.** `buildDashboard` lançait ses
   trois lectures (`loadActivity`, `loadBalance`, `loadActivity` cumulée) en
   `Promise.all` **sans transaction** : une écriture concurrente entre deux
   d'entre elles fabriquait un `identityDelta` fictif (`70000`, `-20000`,
   `246000`…) et un `integrity.ok = false` en production comme en test.
   Correctif : transaction `RepeatableRead` — les trois lectures partagent le
   même instantané PostgreSQL (`src/services/metrics/index.ts::buildDashboard`
   et le paramètre `db` de `queries.ts`).
2. **Test §62** : la comparaison dashboard/dérillage se faisait dans une période
   ouverte à toutes les écritures du jour → fenêtre fermée en **2099** remplie
   par ce seul fichier (voir §19).
3. **E2E-08** : la frontière « 1 seconde avant la vente » tombait entre la vente
   annulée et sa contre-passation selon la vitesse de machine (quantité 12 ou
   2). Frontière déterministe : `to = date de la vente`, le filtre strict
   `date < at` exclut toujours la propre sortie de la vente.
4. **Prévisualisation de référence** partagée entre les fichiers
   (`/arrivals/reference-preview`, `/sales/reference-preview`) : deux appels
   consécutifs peuvent différer si une autre suite crée entre les deux. On
   vérifie alors qu'un document porte **déjà** cette référence — sinon c'est la
   prévisualisation qui l'aurait consommée.


---

## 17. Mobile — socle (Phase 6a)

**Stack** : Expo SDK 57 · Expo Router (routes dans `src/app/`) · TypeScript
strict · NativeWind 4.2.7 + Tailwind 3.4 (className) · Axios · React Query ·
Zustand · `expo-secure-store`.

**Arborescence**

```
mobile/
├── babel.config.js       # babel-preset-expo + jsxImportSource nativewind + nativewind/babel
├── metro.config.js       # withNativeWind(config, { input: './global.css' })
├── tailwind.config.js    # preset nativewind, contenu = ./src/**/*.{ts,tsx}
├── global.css            # @tailwind base/components/utilities (input Metro)
├── .env.example          # EXPO_PUBLIC_API_URL (défaut : http://10.0.2.2:4000/api)
└── src/
    ├── app/_layout.tsx       # hydratation de la session puis Stack (tabs | login)
    ├── app/login.tsx         # formulaire email/mot de passe
    ├── app/(tabs)/_layout.tsx# garde : signedOut → /login ; 5 onglets
    ├── app/(tabs)/{index,stock,ventes,dettes,finances}.tsx
    ├── lib/api.ts            # instance Axios, Bearer, refresh 401, apiMessage()
    ├── store/auth.ts         # Zustand : hydrate/login/logout/signOut
    └── providers/query-provider.tsx
```

**Authentification** : jetons dans SecureStore (`gv_access_token`,
`gv_refresh_token`) ; `hydrate()` relit les jetons et appelle `GET /auth/me` ;
l'intercepteur Axios tente un `POST /auth/refresh` unique sur un 401
(config `__retried`), sinon `signOut()` local. Les handlers sont injectés par
`store/auth.ts` pour éviter les dépendances circulaires.

**Points de contrôle validés (6a)** : `npx tsc --noEmit` propre ·
`npx expo lint` sans erreur · `npx expo-doctor` 21/21 ·
`npx expo export --platform android` (bundle Hermes généré) · contrat API
vérifié à la main : `GET /api/health` → `{status, uptime, timestamp}`,
`POST /api/auth/login` → `{accessToken, refreshToken, user}`, `GET /api/auth/me`
sans jeton → 401.

---

## 18. Mobile — tableau de bord (Phase 6b)

**Écran** `(tabs)/index.tsx` : filtre de période (`today`, `yesterday`,
`last7d`, `week`, `month`, `prevMonth`, `year`, `custom`) → `GET /api/dashboard?period=`,
puis trois groupes de cartes :

| Section | Cartes | Dérillable |
|---|---|---|
| Activité de la période | CA, bénéfice brut, bénéfice net, coût des marchandises, recettes, dépenses, versements | ✔ (indicateurs de période) |
| Situation à la date | caisse, variation de caisse, vola miodina, créances (à recevoir), dettes à payer, bénéfice disponible, argent propre, bénéfice sorti | ✔ tous (états cumulés) |
| Stock et dettes | stock (valeur + pièces), disponibles, vendus, dettes clients, fournisseurs | ✔ tous, sauf « vendus » (compteur d'unités) |

Les cartes de dettes affichent leur sens : « à recevoir » (clients, vendeurs
en ligne regroupés avec les clients) ou « à payer » (fournisseurs, avec la
trosa sinoa regroupée dedans). Le total mélangé « Dettes totales » a disparu :
les totaux sont « Créances (à recevoir) » et « Dettes à payer ». Le
regroupement est **à l'affichage uniquement** — le type (`CUSTOMER`,
`ONLINE_SELLER`, `SUPPLIER`, `TROSA_SINOA`) reste stocké en base.

Le filtre `components/period-tabs.tsx` expose les sept presets **plus un
éditeur « Personnalisé »** (`Du` / `Au`, champ `AAAA-MM-JJ` réutilisant
`components/date-field.tsx`, extrait de l'écran Rapports). Une période
personnalisée n'est émise **qu'après validation** — format, date réelle
(`2026-02-31` refusé) et ordre chronologique — car `period=custom` sans
`from`/`to` fait échouer la requête. Les bornes voyagent jusqu'à
`useDashboard` et `useDrilldown`, donc le dérillage reste calé sur ce que
l'utilisateur voit.

Une bannière affiche `integrity.ok` (écart d'identité doit être `0`).

**Dérillage** : le tap sur une carte ouvre `components/drilldown-modal.tsx`
(`GET /dashboard/:indicator/transactions?period=`) : total de l'indicateur,
puis la liste des écritures (date, description, `kind`, référence, montant et
impact caisse). Le total affiché est **garanti égal** à la valeur de la carte
(§16).

Deux portées coexistent, signalées par `scope` dans la réponse et reprises dans
le sous-titre de la modale :

- `period` — écritures de la fenêtre demandée (tous les indicateurs
  d'activité) ;
- `toDate` — état **cumulé jusqu'à la fin de la période** : caisse, argent
  propre, bénéfice sorti, dettes, stock, vola, bénéfice disponible. Ces
  grandeurs sont des stocks, pas des flux : les limiter à la fenêtre afficherait
  un total sans rapport avec la carte.

Les indicateurs composites (`vola`, `disposableProfit`) ne lisent pas le
journal en clair mais **les composantes du dashboard** : écritures de caisse
(+ solde initial), lots, créances, passifs en négatif et argent propre. Le
bénéfice disponible reprend exactement `vola − argent propre` (plancher à 0 :
une ligne « règle » l'explique), sinon son total ne retomberait jamais sur la
carte (§9).


**Navigation et actions rapides (§51, étape 6)** : les sept destinations du
§51 se atteignent d'un geste. Les cinq onglets (Accueil, Ventes, Stock,
Dettes, Finances) sont complétés par deux boutons d'en-tête (`headerRight`
du layout des onglets) qui ouvrent **Rapports & journal** et **Paramètres**
depuis n'importe quel onglet — les anciens boutons en pied d'accueil ont été
retirés.

L'accueil affiche une grille **« Actions rapides »** juste sous la bannière
d'intégrité, avec les actions du cahier dans son ordre : Vente,
Dépense, Arrivage, Paiement client, Paiement fournisseur, Argent
propre. Elles mènent à `/sale/new`, `/finance/expense`,
`/arrival/new` et `/finance/capital` ; les deux
paiements ouvrent l'onglet Dettes avec `?type=CUSTOMER|SUPPLIER&status=OPEN`
(`GET /debts` filtre déjà sur ces deux paramètres). La vente est visible par
tous les rôles (le caissier vend), les autres n'apparaissent que pour
ADMIN/MANAGER — le backend refuse de toute façon (`managerOrAdmin`).
L'action **Versement** a été retirée de l'interface : elle faisait double
emploi avec le paiement fournisseur (règlement d'une dette) — les endpoints
`/versements`, leur historique et les indicateurs de rapports restent en place.

`dettes.tsx` lit `type`/`status` depuis l'URL : le corps de l'écran est
monté avec une `key` dépendant des paramètres, ce qui réinitialise les chips
quand un raccourci change de filtre — pas d'effet de synchronisation (lint
`react-hooks/set-state-in-effect`).

**Étape 6 — contrôles** : `npx tsc --noEmit` et `npx expo lint` verts
(1 avertissement connu), backend non touché (`npm test` toujours à **207
tests / 15 fichiers**).

**Graphique de période (§3, étape 7)** : la stack impose une « bibliothèque de
graphiques compatible React Native ». Le choix est tranché à l'étape 7 :
`react-native-gifted-charts` (pur JS) posé sur `react-native-svg`, les deux
compatibles Expo Go — aucun build native n'est nécessaire.

`src/components/series-chart.tsx` affiche la **tendance journalière** sous les
cartes d'activité du dashboard : trois pastilles (`CA`, `Recettes`, `Sorties`),
le total de la période, un graphique en barres défilable horizontalement
(libellés de l'axe éclaircis : jour du mois jusqu'à 45 points, numéro de mois
au-delà) et des états vide / chargement / erreur explicites. La bibliothèque
lit `Platform.constants.reactNativeVersion` dès son chargement, or
`react-native-web` n'expose pas `constants` (erreur « Cannot read properties of
undefined ») : le module n'est donc `require` que sur natif
(`Platform.OS === 'web'` → `null`) et le navigateur reçoit des barres minimales
en `View` (`WebBars`). Aucun chiffre n'est
calculé côté mobile : `GET /reports/series` renvoie les points, remplis à `0`
par le serveur, sur les mêmes prédicats que le dashboard.

**Étape 7 — contrôles** : backend `npm run typecheck` + `npm test` à **209
tests / 15 fichiers** (dont deux tests `/reports/series` : remplissage à 0,
recoupement des totaux des 3 métriques avec le dashboard, 400 sur les
paramètres) ; mobile `npx tsc --noEmit` + `npx expo lint` verts (1
avertissement connu) et `npx expo export --platform android` (bundle Hermes).

**Fichiers** : `src/lib/types.ts` (contrat API), `src/lib/format.ts`
(`formatMoney` « 1 245 000 Ar », `formatQuantity`, `formatDateTime` — sans
dépendre d'`Intl`), `src/lib/queries.ts` (React Query `useDashboard`,
`useDrilldown`, `useSeries`), `src/components/{period-tabs,kpi-card,drilldown-modal,series-chart}.tsx`.

**Points de contrôle validés (6b)** : `npx tsc --noEmit`, `npx expo lint`,
`npx expo export --platform android` verts ; script de vérification contre une
API réelle (seed de démo) : format des 17 champs de cartes sur 4 périodes,
`integrity.ok` à `0`, et total du dérillage = valeur affichée pour les 8
indicateurs de période.

## 19. Mobile — saisie rapide d'arrivage (Phase 6c)

**Route** `src/app/arrival/new.tsx` (en-tête déclaré dans `src/app/_layout.tsx`),
point d'entrée : bouton « Nouvel arrivage » sur l'onglet Stock, affiché aux
rôles `ADMIN`/`MANAGER` seulement (le backend impose `managerOrAdmin` → 403).

**Une écran, trois sections** :

1. **En-tête** : fournisseur (chips `GET /suppliers?active=true`), date
   `AAAA-MM-JJ` saisie en locale (le serveur applique `Indian/Antananarivo`),
   notes libres.
2. **Cartons multipliables** (React Hook Form `useFieldArray`, 1 à 50) — un
   carton est un conteneur dont on connaît **le modèle, la quantité de paires
   et le montant total** ; les pointures se listent ensuite **si on les
   connaît** :
   - **Modèle** : champ de recherche (debounce 300 ms →
     `GET /products?active=true&q=`) au-dessus des chips des modèles actifs.
     Quand le terme saisi ne correspond à aucun modèle, le bouton **« Créer »**
     pose le produit (`POST /products`, sans pointure). Un carton porte un seul
     modèle — il n'y a plus ni grille de variantes, ni multi-modèles.
   - **Quantité (paires)** et **Montant (Ar)** : le prix d'achat de la paire
     s'affiche en direct (`montant ÷ quantité`, arrondi inférieur) et **n'est
     jamais saisi** — c'est la règle unique, côté client comme côté serveur.
   - **Pointures (facultatif)** : chips issues du dictionnaire `GET /sizes`
     (A14 : `label || value`) → lignes `pointure · quantité` éditables avec
     retrait ; le compteur affiche `listées / annoncées` (vert quand la somme
     est exacte, rouge sinon). Aucune pointure → le carton part **« à
     ventiler »** et se ventile depuis le détail de l'arrivage. Les variantes
     sont créées côté serveur au moment de la ventilation.
3. **Paiement** (montant + modes `GET /payment-methods`, solde fournisseur
   affiché en direct : `total − réglé`) et **financement**
   (`OWN_CAPITAL`, `TROSA_SINOA`, `SALES_CASH`, `SUPPLIER_CREDIT` + montant).
   Non coché → crédit intégral chez le fournisseur ; coché partiel → le reste
   reste dû (dette `PARTIAL`).

**Validation avant envoi** (`arrivalFormSchema`, Zod + `zodResolver`,
`mode: onSubmit`) : au moins un carton, **modèle requis**, quantité ≥ 1,
montant ≥ quantité, pointures listées → **somme exacte** (même règle que le
serveur), paiement ≥ 1 et ≤ total, financement ≥ 1. Le pied
d'écran collant affiche le total (pièces + Ar) et le bouton d'enregistrement.

**Transformation** (`src/lib/arrival.ts::buildArrivalPayload`) : chaque carton
devient `{ reference, productId, totalQty, totalCost, sizes? }` — les pointures
sont un *record* `sizeId → quantité` converti en tableau (lignes à quantité 0
exclues, accès O(1) à la saisie), absent du payload quand aucune n'est listée ;
référence absente → `Carton N`. Envoi `POST /arrivals` avec un en-tête
`Idempotency-Key` généré **par tentative** (un double tap ne crée jamais deux
arrivages). Succès → invalidation `arrivals`/`dashboard`/`stock`/`debts`,
`Alert` (avec le nombre de cartons à ventiler), retour en arrière.

**Brouillon de saisie** : `src/store/arrival-draft.ts` (Zustand `save`/`clear`),
restauré à l'ouverture et sauvegardé à chaque changement (`watch`), vidé après
une écriture réussie. Survite à une perte de focus, pas au redémarrage (pas de
persistance disque) — il ne concerne que le formulaire, jamais le statut d'un
arrivage (il n'y en a plus).

**Pointures connues ou non — un seul modèle de saisie** : le carton part
toujours avec `productId`, `totalQty` et `totalCost`, **plus** `sizes` quand on
a listé les pointures. `POST /arrivals` enregistre **directement en `RECEIVED`**
avec ses effets complets (dette, paiement, écriture `SUPPLIER_PAYMENT`) :
- `sizes` fournies → `ventilatedAt` posé, variante créée/réactivée par pointure,
  `ArrivalItem`, lot et mouvement `IN` — **aucune écriture comptable** ;
- sinon → **aucun lot** : le carton existe comme « à ventiler ». Sa valeur
  (`totalCost − Σ lineTotal`) et sa quantité entrent dans la valorisation
  `GET /stock/summary` et dans l'identité comptable (§6.4 de
  `docs/FORMULES.md`) : quand les pointures sont réparties, le résidu tombe à
  zéro (ou à l'arrondi `floor(montant / quantité)`) — jamais de double
  comptage, aucune porte au calendrier.

**Ventilation** : la liste des arrivages affiche un badge ambre **« À ventiler
(n) »** (`ArrivalRow.toVentilate` compté par le serveur) et un filtre dédié
(`GET /arrivals?unventilated=true`) ; le détail (`arrivals/[id]`) montre les
cartons concernés et un bandeau ambre → « Ventiler les pointures » ouvre
`/arrival/ventilate` : chips du dictionnaire des pointures, quantités par
pointure, compteur `saisies / annoncées` par carton, bouton actif uniquement
quand **chaque** somme est exacte. Soumission `POST /arrivals/:id/ventilate`
(manager, idempotent). Le **prix unitaire n'est pas saisi** : il vaut
`floor(totalCost / totalQty)` et la **somme des quantités doit être
exactement celle du carton** (sinon 422, transaction annulée). Chaque pointure
devient une variante du modèle (créée ou réactivée), un lot et un mouvement
`IN` — **zéro écriture comptable** : la caisse et la dette datent de
l'enregistrement de l'arrivage. L'onglet Stock signale aussi les arrivages en
attente.

**Annulation** : un arrivage dont les cartons sont encore à ventiler
s'annule sans contre-passation de stock (aucun lot), le transit disparaît de la
valorisation ; son journal (paiement éventuel) est contre-passé normalement.

**Ce qui a disparu** : la grille « pointure × quantité × prix d'achat », le
copier/coller de prix et le prix groupé (`src/components/size-grid.tsx` et
`src/components/price-bulk-modal.tsx` supprimés), le choix de mode par carton
et les cartons multi-modèles (`usedProductIds`) — le prix unitaire étant
imposé (`montant ÷ quantité`), il n'y a plus rien à saisir par pointure que la
quantité.

**Décision** : `activeProductId` n'est que de la navigation — le payload ne
contient que ce que `createArrivalSchema` accepte.

**Points de contrôle validés (6c, réaligné sur la saisie unique)** :
`npx tsc --noEmit`, `npx expo lint` (1 avertissement React Compiler sur
`watch`, non bloquant) et `npx expo export --platform android` verts ; suite
backend **222 tests / 15 fichiers verts**. Fumée contre l'API dev :4000 —
carton **avec** `sizes` → `ventilated: true`, lot au prix déduit (`30000.00`),
transit `0.00` ; carton **sans** `sizes` → `ventilated: false`, 0 lot, transit
`90007.00` → ventilation → lot `18001.00` + résidu d'arrondi `2.00`, rejeu de
la même ventilation → 422 « déjà ventilé », `?unventilated=true` → 200.

---

## 20. Mobile — saisie rapide d'une vente (Phase 6d)

**Route** `src/app/sale/new.tsx` (en-tête déclaré dans `src/app/_layout.tsx`),
point d'entrée : bouton « Nouvelle vente » sur l'onglet Ventes — tous les rôles,
le backend n'exige que `requireAuth` sur `POST /sales`.

**Parcours en un écran** :

1. **Recherche** `GET /variants?active=true&q=` (nom de modèle ou SKU),
   debouncée à 300 ms ; le tap sur un résultat ajoute la pointure au panier —
   ou incrémente la quantité si elle y figure déjà — avec le prix par défaut
   `sellingPrice`.
2. **Panier** (`useFieldArray`) : steppers de quantité, **prix libre par ligne**
   (A10), suppression, sous-total par ligne, et disponibilité réelle
   (`GET /stock/summary?variantId=`) avec alerte rouge si la quantité demandée
   dépasse le stock. Le serveur reste l'arbitre : `409 INSUFFICIENT_STOCK`.
3. **Client** : chips « Comptoir » (aucun `customerId`) ou liste
   `GET /customers?active=true`.
4. **Règlement** : `TOTAL` → objet `payment` égal au total ; `PARTIEL` →
   montant saisi (≥ 1 et ≤ total) ; `CRÉDIT` → **aucun** objet `payment` (la
   vente ouvre une dette client). Modes de paiement via
   `GET /payment-methods`.
5. **Notes** libres, puis pied d'écran collant : total, nombre d'articles,
   bouton « Enregistrer ».

**Validation** (`src/lib/sale.ts::saleFormSchema`, Zod + `zodResolver`,
`mode: onSubmit`) : panier non vide, total strictement positif (une ligne
**offerte** passe si une autre ligne porte un prix ; seul un total nul est
refusé — comme le serveur en `400`), règlement partiel borné au total.

**Envoi** : `buildSalePayload` — les libellés d'affichage (`productName`,
`sizeLabel`) ne quittent pas l'écran — vers `POST /sales` avec un
`Idempotency-Key` **par tentative** ; succès → invalidation
`sales`/`dashboard`/`stock`/`debts`, `Alert` avec la référence créée puis
retour en arrière.

**Points de contrôle validés (6d)** : `npx tsc --noEmit`, `npx expo lint`
(1 avertissement React Compiler connu, non bloquant) et
`npx expo export --platform android` verts. **Contrat réel** contre l'API (base
de tests, port 4100) : **26/26** — `POST /sales → 201` réglé
(`paidAmount = total`, `remainingAmount = 0`, stock diminué d'une unité),
crédit (sans `payment`, `paidAmount = 0`, reste dû = total), rejets
(règlement > total, panier vide, total nul côté formulaire **et** `400` côté
serveur), `409 INSUFFICIENT_STOCK`, rejou d'idempotence (même `id`),
`integrity.identityDelta = 0`. Suite backend : **10 exécutions consécutives
à 178 tests / 12 fichiers** après les correctifs de concurrence de §16.

---

## 21. Mobile — stock, dettes et finances (Phase 6e)

**But (plan §12, 6e)** : connecter les trois derniers onglets à l'API —
lots / valorisation / mouvements / ajustements, dettes avec détail et
règlement (§50), puis dépenses, versements, argent propre et dettes
fournisseurs.

**Onglet Stock** — résumé global `GET /stock/summary` (sans `variantId` :
quantité, valorisation, nombre de lots), recherche de lots débouncée et
filtres de statut sur `GET /stock/lots?q=&status=`, flux
`GET /stock/movements?limit=8`, boutons « Arrivage » et « Ajuster » réservés
ADMIN/MANAGER. Un bandeau ambre signale les arrivages ayant encore des
**cartons à ventiler** (`GET /arrivals?unventilated=true`) : leur valeur est
déjà comptée dans la résumé. Le tap sur un lot ouvre `/stock/lot` (`GET /stock/lots/:id/movements`
: entrées d'arrivage, sorties FIFO, retours, ajustements, avec l'auteur).

**Étape 5 — historique des prix d'achat (§18)** : le détail du lot affiche
aussi, sous l'en-tête, la section « Prix d'achat · historique » alimentée par
`GET /variants/:id/price-history` — le `lot` du premier appel expose
désormais `variantId` (champ ajouté à la réponse, seule extension backend de
l'étape), puis `useVariantPriceHistory` charge les lignes de carton
d'arrivage les plus récentes en premier : référence du carton, quantité,
date et arrivage, prix d'achat unitaire figé à vie, total de ligne, et
l'écart avec l'entrée précédente coloré (rouge si le prix a monté, vert s'il
a baissé). La section ne s'affiche que si la variante est connue.

**`/stock/adjust`** — même recherche d'article que la vente (debounce 300 ms),
stepper de quantité, motif, date, et aperçu de la valeur retirée calculé sur
la valorisation moyenne du résumé. Garde-fou côté client (`quantité ≤ stock`)
complété par le `409` du serveur ; `POST /stock/adjustments` renvoie
`lostValue`, `allocations` FIFO et `expenseId` (la casse devient une dépense).

**Onglet Dettes** — croisement de filtres (**direction** : Toutes /
Clients (à recevoir) / Fournisseurs (à payer) ; statut : ouvertes /
partielles / réglées) sur `GET /debts?direction=&status=`, reste dû et montant
initial par ligne, total de la liste affichée. Les vendeurs en ligne sont
affichés comme des **clients** et la trosa sinoa comme une **dette
fournisseur** (regroupement à l'affichage, type inchangé en base). Filtres,
lignes, détail et cartes du tableau de bord portent le **sens** de l'écriture :
« à recevoir » pour les clients, « à payer » pour les fournisseurs ; le bouton
de règlement dit « Encaisser » sur une créance et « Décaisser » sur une dette,
selon `direction`. `/dettes/[id]` : en-tête avec statut et échéance,
règlement (ADMIN/MANAGER, bouton « Solde » en un tap, modes de paiement
de `GET /payment-methods`) vers `POST /debts/:id/payments`, puis les trois
listes du détail : `payments[]`, `versements[]` liés (A2) et `history[]`
(écritures du journal).

**Onglet Finances** — trois segments : Dépenses (`GET /expenses`),
Argent propre (`GET /personal-capital`) et
Dettes à payer (`GET /debts?direction=PAYABLE`, tappable → détail de la
dette). Le bouton « Nouveau », réservé aux gestionnaires, route vers les
trois formulaires `finance/expense`, `finance/capital`,
`finance/dette-fournisseur`. Le segment **Versements** et l'écran
`finance/versement` ont été retirés de l'interface (redondance avec le
paiement fournisseur) : `POST/GET /versements` et les écrans de rapports
« Versements » / « Versements par personne » restent servis par le backend.

**Segment Versements (§38, étape 4 — retiré de l'interface, conserve ici comme
historique)** — en haut les mêmes filtres de période
que le tableau de bord (`PeriodTabs` : presets + plage personnalisée validée,
`period` résolu côté serveur, période par défaut « Mois »), puis le bloc
**« Par personne »** alimenté par `GET /versements/summary` : nombre de
versements, ventilation dépense (`charge`) / remboursement
(`debtSettlement`), dernier versement et total. Tapper une personne restreint
la liste dessous à elle seul (pastille « Filtré : … — retirer »), laquelle
part `GET /versements?period=&personName=`. Le résumé, lui, reste groupé par
personne pour que l'on puisse changer de filtre d'un tap à l'autre.

**Étape 4 — contrôles** : `period` ajouté à `versementListQuery` (même
vocabulaire que le dashboard, `custom` exige `from`/`to` sous peine de `400`),
une seule fonction `resolveRange` sert aux deux routes et résout désormais
aussi `custom` — la borne de fin, devenue exclusive, n'abandonne plus la
dernière journée. `GET /versements/summary` réutilise le même schéma.
Backend `npm run typecheck` + `npm test` verts (**207 tests / 15 fichiers**,
dont un test §38 : versement du 31/07/2099 à midi retrouvé par `custom`,
`today` qui exclut l'écriture lointaine, `400` sans bornes). Mobile
`npx tsc --noEmit` + `npx expo lint` verts (1 avertissement connu).

**Étape 5 — contrôles** : backend `npm run typecheck` + `npm test` verts
(**207 tests / 15 fichiers**, cinq passes consécutives) — `variantId` ajouté
au `lot` de `GET /stock/lots/:id/movements` et asserté dans
`arrivals.test.ts`. Le test « dérille les indicateurs d'état vers leurs
composantes (§62) » accepte aussi l'intervalle balayé par ses deux lectures :
les soldes cumulés changent en continu parce que quinze suites écrivent en
parallèle, et l'égalité stricte partait en échec dans un essai sur deux. Le
dérillage reste encadré de deux lectures et retombe sur l'une d'elles dès
qu'aucune écriture n'a eu lieu pendant le bracket.

**Rappels métier affichés à l'écran** : A8 (une dépense est toujours réglée →
caisse −`amount` immédiat), A2 (le versement règle une dette à payer choisie,
sinon c'est une charge), A5 (argent propre = ni bénéfice, ni dette), A1 (une
dette fournisseur est un passif : la caisse monte à la création). Après
création d'une dette fournisseur, l'écran se redirige sur le détail de la
dette.

**Validation** (`src/lib/finance.ts`, Zod + `zodResolver`, `mode: onSubmit`) :
montants entiers en ariary, dates `AAAA-MM-JJ`, motifs bornés ; les builders
(`buildAdjustPayload`, `buildExpensePayload`,
`buildCapitalPayload`, `buildSupplierDebtPayload`, `buildDebtPaymentPayload`)
n'envoient que les champs renseignés. Le composant `Chip` partagé
(`src/components/chip.tsx`) remplace la copie locale de la vente.

**Points de contrôle validés (6e)** : `npx tsc --noEmit`, `npx expo lint`
(1 avertissement React Compiler connu) et `npx expo export --platform
android` verts. **Contrat réel** contre l'API (base de tests, port 4100) :
**64/64** — résumé/lots/mouvements, arrivage de 2 unités puis ajustement de 1
(`stock +2 puis −1`, `lostValue > 0`, dépense de casse présente dans
`GET /expenses`), dette client `OPEN → PARTIAL → PAID` avec deux paiements
visibles dans `GET /payments?debtId=`, trosa `PAYABLE` puis règlement
partiel, **A2 vérifié** (`treatment = DEBT_SETTLEMENT` et `debtId` retrouvé),
dépense/versements/argent propre créés et retrouvés dans leurs listes,
`401` sans jeton, et `integrity.identityDelta = 0` après l'ensemble du
parcours.

---

## 22. Mobile — rapports et journal financier (Phase 6f-a)

**But (plan §12, 6f)** : donner à l'application les écrans de restitution
prévus en §39/§63 — rapport journalier, rapport mensuel et journal des
écritures — avec export PDF partageable.

**Écran `/reports`** (`src/app/reports/index.tsx`, accessible depuis un
bouton « Rapports & journal » sur l'accueil) : trois segments —

- **Journalier** : date (`AAAA-MM-JJ`, « Aujourd'hui ») → `GET /reports/daily?date=` ;
- **Mensuel** : année + mois → `GET /reports/monthly?year=&month=` ;
- **Journal** : plage `from/to` → `GET /ledger?from=&to=&limit=50` et
  `GET /ledger/summary?from=&to=` (totaux, ventilation `byKind`, écritures
  avec `seq`, `kind`, `amount`, `cashDelta`, `description`).

**Vue de rapport** (`ReportBodyView`, `DailyReport | MonthlyReport`) : bandeau
d'intégrité (`integrity.ok`, `identityDelta`), puis les rubriques du **§48** :

- **Journalier (11 champs)** : ventes, chiffre d'affaires, recettes, coût des
  marchandises, dépenses, versements, bénéfice brut, bénéfice net, caisse,
  **paiements reçus**, **paiements fournisseurs**, **nouvelles dettes** ;
- **Mensuel (18 champs)** : les neuf métriques d'activité (ventes, CA,
  recettes, COGS, dépenses, versements, brut, net, caisse), la section
  « Situation en fin de mois » (quantité et valeur du stock, clients à
  recevoir [clients + vendeurs en ligne], fournisseurs à payer [fournisseurs
  + trosa sinoa], argent propre engagé), les
  « Produits les plus vendus » (quantité, bénéfice `margin`, chiffre
  d'affaires) et les « Versements par personne » (`person`, `count`, `amount`).

Puis le détail commun : ventes de la période (≤ 10, tappable → détail de la
vente), le classement des articles — journalier sur `topProducts` (meilleures
ventes, par chiffre d'affaires), mensuel sur `bestSellers` (par quantité, huit
premiers) — et les dépenses par catégorie. Les montants sont affichés via
`formatMoney` (le formatage reste tolérant `string | number`).

**Champs §48 côté backend** : `buildReport` retourne désormais
`{ report, dashboard }` (le dashboard sert à alimenter le mensuel sans être
sérialisé), et `dailyReport` / `monthlyReport` complètent le socle commun par
`dailyExtras` (paiements reçus / fournisseurs, nouvelles dettes) et
`monthlyExtras` (stock, dettes par type, versements par personne) :

- `paymentsReceived` = écritures `CUSTOMER_PAYMENT` + `ONLINE_SELLER_PAYMENT`
  de la fenêtre, `paymentsSupplier` = `SUPPLIER_PAYMENT` (le journal §39 est la
  source ; les encaissements effectués au moment de la vente sont déjà dans
  « recettes ») ;
- `newDebts` = `remainingAmount + règlements journalisés depuis l'ouverture`
  des dettes **ouvertes** sur la période (`date ∈ fenêtre`, `cancelledAt` nul),
  en écartant les écritures `refType = ARRIVAL` : on mesure ce qui est devenu
  dû, pas l'acompte versé à l'arrivée, si bien que le chiffre reste stable
  quand un client rembourse (§69) ;
- `bestSellers` = copie de `topProducts` retriée par quantité décroissante ;
  `size` peut porter `label: null` (champ Prisma nullable) ;
- le constructeur PDF, dont les lignes sont partagées entre les deux types,
  affiche le bloc « Paiements reçus / fournisseurs / nouvelles dettes »
  journalier, et le mensuel affiche `SITUATION EN FIN DE MOIS`,
  `VERSEMENTS PAR PERSONNE`, `PRODUITS LES PLUS VENDUS (benefice par produit)`
  et `CHIFFRE D AFFAIRES PAR PRODUIT`.

**Export PDF** (`src/lib/report.ts`) : bouton « Exporter en PDF » →
`GET /reports/export.pdf?…` récupéré en `arraybuffer` (`api.get<ArrayBuffer>`),
écrit dans le cache via `File`/`Paths` (`expo-file-system`) puis
`Sharing.shareAsync` (`expo-sharing`, plugin ajouté à `app.json`) —
`isAvailableAsync` est vérifié avant le partage, sinon `Alert`. Le type de
rapport exporté suit l'onglet actif ; l'échec réseau ou un partage
indisponible remonte une `Alert` sans casser l'écran.

**Correctif backend annexe (§11)** : `/reports/daily`, `/reports/monthly` et
`?download=json` renvoyaient `activity` / `money` en **nombres bruts** alors
que la convention du §11 impose des montants en string décimale. Les helpers
`presentActivity` / `presentMoney` (extraits de `presentDashboard`) sont
désormais appliqués dans `buildReport` : les rapports exposent exactement la
même forme que `GET /dashboard` (`payable`, `workingCapital`, `ca: "355000.00"`),
le constructeur du PDF utilise directement ces chaînes. Trois assertions
régression ajoutées à `tests/reports.test.ts` (journalier + mensuel).

**Points de contrôle validés (6f-a)** : `npx expo export --platform
android` (types routés régénérés), `npx tsc --noEmit`, `npx expo lint`
(0 erreur, 1 avertissement connu) verts ; `npm run typecheck` et `npm test`
backend verts (**178 tests / 12 fichiers**). **Contrat réel** contre l'API
(base de tests, port 4100) : **38/38** — rapport quotidien et mensuel
(`type`, `label`, `activity`, `money`, `integrity.identityDelta = 0`,
ventes avec lignes), journal paginé + résumé `byKind`, export PDF quotidien
et mensuel (statut 200, `application/pdf`, signature `%PDF`, nom
`rapport-*.pdf`), `?download=json` (nom + rapport inclus), `401` sans
jeton et `400` pour un `type` d'export inconnu.

**Points de contrôle validés (étape 3, §48)** : backend `npm run typecheck`
et `npm test` verts (**206 tests / 15 fichiers**, deux passes consécutives) —
`tests/reports.test.ts` compte 16 tests, dont les deux grilles §48 : les 11
champs journaliers sont posés sur un jour isolé (`2099-06-20`) avec une vente
à crédit, une dépense, un versement et deux règlements de dettes —
`paymentsReceived` et `paymentsSupplier` sont **recoupés avec
`/ledger/summary`**, `newDebts` est figé à `40000.00` alors que la dette ne
pèse plus que 35 000 (preuve que l'acompte est bien écarté), et le mensuel
contrôle le classement de `bestSellers` contre les lignes de ventes du même
rapport ; le PDF mensuel est relu octet par octet et ses rubriques
contrôlées (`VERSEMENTS PAR PERSONNE`, `PRODUITS LES PLUS VENDUS`), le
journalier appelé via `exportReportPdf` affichant `Caisse`, `Paiements recus`,
`Paiements fournisseurs` et `Nouvelles dettes`.
Mobile `npx tsc --noEmit` et `npx expo lint` verts (1 avertissement connu).

---

## 23. Mobile — paramètres et administration (Phase 6f-b)

**But (plan §12, 6f)** : exposer depuis l'application les écrans de
paramétrage du cahier — catalogue, tiers, catégories/modes de paiement,
utilisateurs et réglages généraux — avec les mêmes règles RBAC (A14) que
l'API.

**Point d'entrée** : bouton « Paramètres » (`settings-outline`) sur
l'accueil, au-dessus de « Rapports & journal ». `src/app/settings/index.tsx`
liste les sections ; la ligne « Utilisateurs & rôles » n'apparaît que pour
un `ADMIN`, et chaque écran rappelle que l'écriture est réservée à
ADMIN/MANAGER (les boutons sont masqués pour un `CASHIER`).

**`/settings/catalogue`** — deux sections. **« Valeurs de pointures »** :
le dictionnaire `GET /sizes` (création `POST /sizes`, suppression
`DELETE /sizes/:id` avec le `409` « pointure utilisée » affiché comme aide) —
il ne sert plus qu'à alimenter les sélecteurs, les pointures d'un modèle se
gèrent sur le modèle. **Produits** (`GET /products?q=` sans filtre d'actif,
création `POST /products`, `PUT /products/:id` pour renommer, activer ou
désactiver — jamais de suppression définitive, l'historique reste lisible) :
un modèle sélectionné ouvre le panneau **« Pointures du modèle »**
(`GET /products/:id` → `variants[]`) qui liste ses pointures avec le **prix
de vente saisi par pointure** (`PUT /variants/:id { sellingPrice }`),
l'ajout via `SizePicker` (`POST /products/:id/variants`, saisie libre `43`,
`36,40` ou plage `36-40` ; une valeur inconnue est créée dans le dictionnaire
avec `label = valeur`) et le masquage `PUT /variants/:id
{ active:false }` — la pointure quitte la grille mais garde ses lots, ventes
et prix d'achat ; la remettre active se fait par un simple réajout. Le
libellé de `Size` restant optionnel, l'interface affiche `label || value`.

**`/settings/tiers`** — trois segments Fournisseurs / Clients / Vendeurs
en ligne sur `GET|POST|PUT /suppliers|customers|online-sellers`, recherche
par nom, création et édition (nom, téléphone, adresse, notes) puis
activation/désactivation (`DELETE` = désactivation côté serveur, `PUT
{active:false}` pour le reste). Le corps d'édition envoie `null` pour
effacer un champ texte.

**`/settings/categories`** — deux sections : catégories de dépenses
(`POST`, `PUT /expense-categories/:id` avec `active`, jamais de suppression
selon §36) et modes de paiement (`POST`, `PATCH /payment-methods/:id`).
Les deux listes affichent aussi les éléments inactifs, contrairement aux
listes de saisie qui ne montrent que les éléments `active`.

**`/settings/users`** (ADMIN) — `GET /users`, création (`POST /users`,
mot de passe ≥ 8 caractères), édition nom/rôle (`PATCH /users/:id`),
activation/désactivation, réinitialisation de mot de passe
(`POST /users/:id/password`). Les rôles viennent de `GET /users/roles`
avec repli `ADMIN | MANAGER | CASHIER`.

**`/settings/general`** — changement de son propre mot de passe
(`POST /users/me/password`, contrôle de confirmation côté Zod) : le serveur
révoque les sessions, l'écran déconnecte puis renvoie vers `/login` ;
et réglages clé/valeur (`GET|PUT /settings`, fusion des clés absentes,
aucune suppression possible).

**Validation** (`src/lib/settings.ts`) : schémas Zod + `zodResolver`,
`mode: onSubmit`, builders (`buildProductPayload`, `buildPartyPayload`,
`buildUserPayload`, `buildSettingsPayload`…) qui n'envoient que les champs
renseignés et convertissent une valeur vidée en `null`.

**Points de contrôle validés (6f-b)** : `npx expo export --platform
android` (types routés), `npx tsc --noEmit` et `npx expo lint` verts
(0 erreur, 1 avertissement React Compiler connu sur `arrival/new`). Le
backend n'a pas été modifié (178 tests / 12 fichiers verts). **Contrat
réel** contre l'API (base de tests, port 4100) : **47/47** — réglages
(fusion des clés, `400` sur un envoi vide), catégorie (`201`, `409` sur
doublon, désactivation/réactivation), mode de paiement (`201`, `PATCH`),
produit (`201`, recherche, désactivation), pointures (`201`, `409` sur
pointure utilisée, `204` sur pointure libre), tiers (`201`, `PUT` avec
`phone: null`, `204` de désactivation et exclusion des listes actives),
vendeur en ligne (`status` porté), utilisateurs (`201`, `409` doublon,
`400` mot de passe court, `403` pour MANAGER/CASHIER sur `GET /users`,
`409` d'auto-désactivation d'un admin, `409`/`204` sur le changement de
son propre mot de passe puis reconnexion, `401` au login d'un compte
désactivé), `401` sans jeton et `integrity.ok = true` après l'ensemble.
