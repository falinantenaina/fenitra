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
| §16, §17 | FIFO + valorisation par lots | Allocation FIFO + `Σ remainingQty × unitCost` |
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
| **A3** ✅ | **Formule exacte du bénéfice mangeable** (§7) : cumulée ou sur période ? réserve de rotation ? | Question centrale du dashboard | **VALIDÉ (§9)** : `max(0, min(net cumulé, caisse − à payer − argent propre engagé − réserve))`, cumulé à date, réserve paramétrable défaut `0` |
| **A4** ✅ | **Définition exacte du vola miodina** (§7 liste 4 éléments) : totaux ou sous-ensemble ? | Dashboard | **VALIDÉ (§10)** : `caisse + stock + créances − passifs` = `argent propre engagé + bénéfice net cumulé` |
| **A5** ✅ | **Que devient l'argent propre quand je sors de la caisse ?** Récupération de capital ou prise de bénéfice ? | Argent propre, bénéfice mangeable | **VALIDÉ : deux opérations distinctes.** `PERSONAL_CAPITAL_OUT` (récupère mon capital, `K` diminue) et `PROFIT_DRAWING` (je sors du bénéfice, `K` inchangé) |
| **A6** ✅ | **Recettes** (§42) : inclut-on les règlements de dettes antérieures ? | Indicateur « recettes » | **Retenu : oui** — `Recettes = tous les encaissements issus des ventes (du moment + règlements)`. Sous-indicateur `ventes encaissées du moment` affiché à côté |
| **A7** | **Financement mixte** (§35) : comment relier « injection d'argent propre » → « arrivage » sans compter deux fois l'argent ? | Traçabilité §33 | Les **flux de caisse** restent la référence ; `FundingAllocation` est une **étiquette de reporting** sur l'arrivage. Si l'argent arrive directement de ma poche, on crée une `PersonalCapitalMovement` liée à l'arrivage **et** le paiement sort de la caisse (entrée + sortie, solde net nul, traçabilité complète) |
| **A8** | **Dépenses non payées** (achats à crédit) ? | Dettes | Non prévues par le §36 → **hors périmètre v1** ; une dépense est toujours réglée (sortie de caisse). À confirmer |
| **A9** ✅ | **Précision monétaire** : l'ariary admet-il des décimales ? | `Decimal(18,2)` vs `Decimal(18,0)` | **VALIDÉ : `Decimal(18,0)` — entiers uniquement.** Tous les montants sont des entiers ; validation Zod `int()` ; affichage formaté `2 000 Ar` |
| **A10** | **Prix de vente vendeur en ligne** (80) ≠ prix public (30) : prix libre par ligne de vente, ou listes de prix par canal ? | UX saisie | v1 : `ProductVariant.sellingPrice` = prix par défaut + **prix libre modifiable sur chaque ligne de vente**. Listes de prix = évolution possible |
| **A11** | **Retours, annulations, ajustements de stock** (casse/perte/vol) : non traités par le cahier des charges mais nécessaires pour ne jamais bloquer l'app. | Intégrité | Prévoir : `Sale.cancel()` (contre-passation), `StockMovement ADJUSTMENT/RETURN` — à valider |
| **A12** | **Versement récurrent** (2/jour) : planificateur automatique ou saisie manuelle ? | UX | v1 : saisie manuelle + vue « historique par personne » (§38). Planificateur = évolution |
| **A13** | **Timezone / bornes de période** | Filtres dashboard | `Indian/Antananarivo` (UTC+3), calculées côté serveur. *NB : `Africa/Antananarivo` est l'alias historique, rejeté par l'ICU récent de Node — on utilise le nom canonique* |
| **A14** | **Rôles / RBAC** exacts | Sécurité | `ADMIN`, `MANAGER`, `CASHIER` — à ajuster |
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
│   │   └── seed.ts
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
| Graphiques | `react-native-svg` + lib compatible Expo (ex. `victory-native` ou `react-native-gifted-charts`) |

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
enum ArrivalStatus       { DRAFT RECEIVED CANCELLED }
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
| **Valeur du stock** | `Σ (StockLot.remainingQty × StockLot.unitCost)` | `StockLot` |
| **Dettes clients** | `Σ remainingAmount WHERE type='CUSTOMER' AND status ≠ 'PAID'` | `Debt` |
| **Dettes vendeurs en ligne** | `Σ remainingAmount WHERE type='ONLINE_SELLER'` | `Debt` |
| **Dettes fournisseurs** | `Σ remainingAmount WHERE type='SUPPLIER'` | `Debt` |
| **Trosa sinoa** | `Σ remainingAmount WHERE type='TROSA_SINOA' AND direction='RECEIVABLE'` (créance) / `'PAYABLE'` (dette) | `Debt` |
| **Argent à recevoir** | dettes clients + dettes vendeurs + trosa (créance) | `Debt` |
| **Argent à payer** | dettes fournisseurs + trosa (dette) | `Debt` |
| **Argent propre engagé (K)** | `Σ capital IN − Σ capital OUT` | `PersonalCapitalMovement` |
| **Quantité stock** | `Σ StockLot.remainingQty` | `StockLot` |

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

## 9. Stratégie de calcul du BÉNÉFICE MANGEABLE

**Règle VALIDÉE (A3)** : le bénéfice mangeable est un **état cumulé à date**, pas un flux de période. Il répond à la question *« combien puis-je réellement sortir maintenant ? »*.

```
SURPLUS_CASH = CAISSE − PASSIFS (argent à payer) − ARGENT_PROPRE_ENGAGÉ − RÉSERVE

BÉNÉFICE_MANGEABLE = max(0, min(BÉNÉFICE_NET_CUMULÉ, SURPLUS_CASH))
```

- `min(...)` : on ne mange jamais **plus** que le bénéfice réellement réalisé.
- `max(0, ...)` : on ne mange jamais **moins que zéro** — si `SURPLUS_CASH < 0`, l'argent propre n'est pas encore récupéré et il ne reste rien à manger.
- **`RÉSERVE`** = argent qui doit rester pour renouveler les marchandises (§7 « argent nécessaire pour renouveler les marchandises »). **Défaut `0`**, paramétrable dans *Paramètres financiers*. Si vous fixez une règle (ex. « garder 1 valeur de stock en caisse »), elle sera appliquée ici.

**Vérifications :**

| Situation | CAISSE | K | Net | Mangeable |
|---|---|---|---|---|
| Vente intégralement payée (ex. §8.4) | 120 | 100 | 20 | `min(20, 120−0−100) = 20` ✓ |
| Stock à moitié vendu, tout encaissé | 75 | 100 | 25 | `min(25, −25) → 0` ✓ (mon argent est encore dans le stock) |
| Vente à crédit, jamais encaissée | 60 | 100 | 20 | `min(20, −40) → 0` ✓ (l'argent est chez le client) |
| Tout encaissé après règlement du client | 120 | 100 | 20 | 20 ✓ |

**Ne jamais** déclarer la totalité de la caisse comme bénéfice (§7) — c'est précisément ce que soustrait `ARGENT_PROPRE_ENGAGÉ` et `PASSIFS`.

**Bénéfice net sur période** reste affiché séparément (indicateur d'activité), il n'est pas égal au mangeable.

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
GET    /arrivals?from&to&supplierId&page
POST   /arrivals                           ← transaction complète (§55)
GET    /arrivals/:id                       ← cartons + lignes + lots + dette + paiements + financements
POST   /arrivals/:id/cancel                { reason } → contre-passation
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

---

## 14. Décisions validées (Phase 1 CLOSE)

### 14.1 Décisions explicites de l'utilisateur

| # | Décision |
|---|---|
| **A1** | **TROSA SINOA = argent que JE DOIS.** `Debt.direction = PAYABLE` **imposé** pour `type = TROSA_SINOA`. C'est une dette **manuelle**, distincte des dettes fournisseurs générées automatiquement par un arrivage. Elle entre dans **ARGENT À PAYER** et dans la section séparée §32 |
| **A2** | **Versement → `DEBT_SETTLEMENT` par défaut.** Si la personne a une dette **payable** ouverte (`TROSA_SINOA`), le versement la réduit et n'affecte pas le bénéfice. Sinon → `CHARGE` (réduit le bénéfice net). Le type est choisi/modifiable à la saisie |
| **A3** | **Bénéfice mangeable = `max(0, min(bénéfice net cumulé, caisse − à payer − argent propre engagé − réserve))`**, cumulé à date, `réserve` paramétrable défaut `0` |
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
| **A14** | Rôles `ADMIN` / `MANAGER` / `CASHIER` |
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
sur la valeur affichée. Contrôlé par `backend/tests/reports.test.ts` pour
`ca`, `cogs`, `grossProfit`, `netProfit`, `receipts`, `expenses`, `versements`
et `cash` ; `capital` et `profitDrawings` sont affichés en cumulé au dashboard
sans équivalent de période.

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
`last7d`, `week`, `month`, `prevMonth`, `year`) → `GET /api/dashboard?period=`,
puis trois groupes de cartes :

| Section | Cartes | Dérillable |
|---|---|---|
| Activité de la période | CA, bénéfice brut, bénéfice net, recettes, dépenses, versements | ✔ (indicateurs de période) |
| Situation à la date | caisse, variation de caisse, vola miodina, créances, passifs, bénéfice disponible | variation de caisse ✔ |
| Stock et dettes | stock (pièces + valeur), dettes totales, trosa sinoa, argent propre | — (états, pas des indicateurs) |

Une bannière affiche `integrity.ok` (écart d'identité doit être `0`).

**Dérillage** : le tap sur une carte ouvre `components/drilldown-modal.tsx`
(`GET /dashboard/:indicator/transactions?period=`) : total de l'indicateur,
puis la liste des écritures (date, description, `kind`, référence, montant et
impact caisse). Le total affiché est **garanti égal** à la valeur de la carte
(§16).

**Fichiers** : `src/lib/types.ts` (contrat API), `src/lib/format.ts`
(`formatMoney` « 1 245 000 Ar », `formatQuantity`, `formatDateTime` — sans
dépendre d'`Intl`), `src/lib/queries.ts` (React Query `useDashboard`,
`useDrilldown`), `src/components/{period-tabs,kpi-card,drilldown-modal}.tsx`.

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
2. **Cartons multipliables** (React Hook Form `useFieldArray`, 1 à 50) : chips des
   modèles (`GET /products?active=true`) ; au changement de modèle la grille se
   recharge depuis `GET /products/:id` (variantes triées par pointure).
   **Grille contrôlée pointure × quantité × prix d'achat** avec copier/coller
   d'une ligne et sous-total par carton.
3. **Paiement** (montant + modes `GET /payment-methods`) et **financement**
   (`OWN_CAPITAL`, `TROSA_SINOA`, `SALES_CASH`, `SUPPLIER_CREDIT` + montant).

**Validation avant envoi** (`arrivalFormSchema`, Zod + `zodResolver`,
`mode: onSubmit`) : au moins un carton, carton non vide, prix d'achat requis sur
chaque ligne chiffrée, paiement ≥ 1 et ≤ total, financement ≥ 1. Le pied
d'écran collant affiche le total (pièces + Ar) et le bouton d'enregistrement.

**Transformation** (`src/lib/arrival.ts::buildArrivalPayload`) : les items sont
saisis en *record* `variantId → {quantity, unitCost}` (accès O(1) dans la grille)
puis convertis en tableau, lignes à quantité 0 exclues ; référence absente →
`Carton N`. Envoi `POST /arrivals` avec un en-tête `Idempotency-Key` généré
**par tentative** (un double tap ne crée jamais deux arrivages). Succès →
invalidation `arrivals`/`dashboard`/`stock`/`debts`, `Alert`, retour en arrière.

**Brouillon** : `src/store/arrival-draft.ts` (Zustand `save`/`clear`), restauré à
l'ouverture et sauvegardé à chaque changement (`watch`), vidé après une écriture
réussie. Survite à une perte de focus, pas au redémarrage (pas de persistance
disque).

**Prix groupé** : `src/components/price-bulk-modal.tsx` — « Appliquer un prix
d'achat » pré-sélectionne les lignes déjà chiffrées, coche/décoche Tout/Aucun,
applique le prix **sans toucher aux quantités**. La sélection est un état dérivé
(`manual ?? automatic`) : aucun `setState` dans un effet.

**Décision** : `activeProductId` / `usedProductIds` ne sont que de la navigation
de grille — ils ne quittent jamais l'écran, le payload ne contient que ce que
`createArrivalSchema` accepte.

**Points de contrôle validés (6c)** : `npx tsc --noEmit`, `npx expo lint`
(1 avertissement React Compiler sur `watch`, non bloquant) et
`npx expo export --platform android` verts. **Contrat réel** exécuté contre
l'API (base de tests, port 4100) : 21/21 — payload du formulaire, rejets Zod
(paiement > total, carton vide, prix manquant), `POST /arrivals → 201`
(`totalQty = 4`, `totalCost = "106000.00"`, `paidAmount = "50000.00"`, 2 cartons),
rejou d'idempotence (même `id`), `integrity.identityDelta = 0`, dérillage
`ca → 200`. Suite backend : 178 tests / 12 fichiers verts sur **3 exécutions
consécutives** — le test §62 a été isolé dans une fenêtre close en 2099 pour
supprimer la course avec les autres fichiers qui écrivent « aujourd'hui ».

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
règlement (§50), puis dépenses, versements, argent propre et trosa sinoa.

**Onglet Stock** — résumé global `GET /stock/summary` (sans `variantId` :
quantité, valorisation, nombre de lots), recherche de lots débouncée et
filtres de statut sur `GET /stock/lots?q=&status=`, flux
`GET /stock/movements?limit=8`, boutons « Arrivage » et « Ajuster » réservés
ADMIN/MANAGER. Le tap sur un lot ouvre `/stock/lot` (`GET /stock/lots/:id/movements`
: entrées d'arrivage, sorties FIFO, retours, ajustements, avec l'auteur).

**`/stock/adjust`** — même recherche d'article que la vente (debounce 300 ms),
stepper de quantité, motif, date, et aperçu de la valeur retirée calculé sur
la valorisation moyenne du résumé. Garde-fou côté client (`quantité ≤ stock`)
complété par le `409` du serveur ; `POST /stock/adjustments` renvoie
`lostValue`, `allocations` FIFO et `expenseId` (la casse devient une dépense).

**Onglet Dettes** — croisement de filtres (type : clients / vendeurs /
fournisseurs / trosa ; statut : ouvertes / partielles / réglées) sur
`GET /debts?type=&status=`, reste dû et montant initial par ligne, total de
la liste affichée. `/dettes/[id]` : en-tête avec statut et échéance,
règlement (ADMIN/MANAGER, bouton « Solde » en un tap, modes de paiement
de `GET /payment-methods`) vers `POST /debts/:id/payments`, puis les trois
listes du détail : `payments[]`, `versements[]` liés (A2) et `history[]`
(écritures du journal).

**Onglet Finances** — quatre segments : Dépenses (`GET /expenses`),
Versements (`GET /versements`), Argent propre (`GET /personal-capital`) et
Trosa (`GET /debts?type=TROSA_SINOA`, tappable → détail de la dette). Le
bouton « Nouveau », réservé aux gestionnaires, route vers les quatre
formulaires `finance/expense`, `finance/versement`, `finance/capital`,
`finance/trosa`.

**Rappels métier affichés à l'écran** : A8 (une dépense est toujours réglée →
caisse −`amount` immédiat), A2 (le versement détecte lui-même un
remboursement de trosa ouverte, sinon une dépense), A5 (argent propre = ni
bénéfice, ni trosa), A1 (la trosa sinoa est un passif : la caisse monte à la
création). Après création d'une trosa, l'écran se redirige sur le détail de
la dette.

**Validation** (`src/lib/finance.ts`, Zod + `zodResolver`, `mode: onSubmit`) :
montants entiers en ariary, dates `AAAA-MM-JJ`, motifs bornés ; les builders
(`buildAdjustPayload`, `buildExpensePayload`, `buildVersementPayload`,
`buildCapitalPayload`, `buildTrosaPayload`, `buildDebtPaymentPayload`)
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
