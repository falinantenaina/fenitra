# Gestion Vente — API + application mobile

Gestion de boutique de chaussures : arrivages, stock par lots (FIFO), ventes, dettes
(client / vendeur en ligne / fournisseur / *trosa sinoa*), finances et pilotage
(bénéfice mangeable, vola miodina, journal financier, rapports PDF).

| | |
|---|---|
| **Backend** | `backend/` — Express + TypeScript strict + Prisma + PostgreSQL, auth JWT, RBAC, 109 routes REST |
| **Mobile** | `mobile/` — Expo SDK 57, Expo Router, NativeWind, TanStack Query, Zustand, Zod |
| **Spécification** | `docs/ANALYSE.md` (source de vérité métier), `docs/FORMULES.md` (formules), `docs/API.md` (contrat HTTP) |
| **Tests** | 202 tests backend (vitest + supertest), dont les **12 scénarios E2E** de `ANALYSE.md` §16 |

---

## 1. Prérequis

- **Node.js ≥ 20** (`backend/package.json#engines`) et npm
- **PostgreSQL ≥ 14** accessible en local
- Pour le mobile : un appareil/émulateur avec **Expo Go**, ou un développement build
- Pour un build Android : un compte [Expo](https://expo.dev) et `eas-cli` (voir §6)

---

## 2. Installation

### 2.1 Base de données

```sql
CREATE DATABASE fenitra;
CREATE DATABASE fenitra_test;   -- base des tests (réinitialisée à chaque `npm test`)
```

### 2.2 Backend

```bash
cd backend
npm install
cp .env.example .env            # puis renseigner DATABASE_URL / TEST_DATABASE_URL / les secrets JWT
npm run db:migrate              # première migration
npm run db:seed                 # rôles + admin@test.local / admin1234
npm run dev                     # http://localhost:4000  (tsx watch)
```

Variables importantes (`backend/.env.example`) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | base de développement |
| `TEST_DATABASE_URL` | base des tests — **réinitialisée à chaque `npm test`** |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `openssl rand -hex 64` |
| `OPENING_CASH_BALANCE`, `WORKING_RESERVE` | solde d'ouverture et réserve de rotation |

### 2.3 Mobile

```bash
cd mobile
npm install
cp .env.example .env
#   émulateur Android → EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api
#   émulateur iOS / navigateur → http://127.0.0.1:4000/api
#   appareil physique → IP LAN de la machine (http://192.168.x.x:4000/api)
npm start                       # Expo Router + NativeWind
```

> L'URL de l'API **et** le port (`backend/.env#PORT`) doivent correspondre.

---

## 3. Lancement

Terminal 1 :
```bash
cd backend && npm run dev       # API :4000
```
Terminal 2 :
```bash
cd mobile && npm start          # Expo :8081, puis `a` pour Android / `i` pour iOS
```

Comptes créés par `npm run db:seed` :

| Rôle | Email | Mot de passe |
|---|---|---|
| ADMIN | `admin@test.local` | `admin1234` |

---

## 4. Tests & qualité

```bash
# Backend — 202 tests, base de test réinitialisée à chaque run
cd backend
npm run typecheck               # tsc --noEmit
npm test                        # vitest run
npm run test:watch              # en surveillant

# Mobile
cd mobile
npm run typecheck               # tsc --noEmit
npm run lint                    # expo lint
```

> `npm test` lance `prisma migrate reset --force` sur `TEST_DATABASE_URL`.
> Définir `SKIP_DB_RESET=1` pour réutiliser l'état courant.

---

## 5. Recette de bout en bout (phase 7)

`mobile/scripts/recette.ts` rejoue les **12 scénarios métier** de `ANALYSE.md` §16
contre l'API « comme le ferait le mobile » (auth, arrivage, vente FIFO, dettes,
finances, rapports, intégrité).

```bash
# 1. API sur le port 4100 branchée sur la base de tests
cd backend
$env:PORT = 4100                                  # PowerShell — ou PORT=4100 en bash
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:reset                                  # base de tests propre + seed
npm run dev

# 2. Recette
cd ..\mobile
$env:API_URL = 'http://127.0.0.1:4100/api'
npx tsx scripts/recette.ts
```

Le script sort en erreur dès le premier échec (`ÉCHEC #n — libellé`).
Couplé à `npm test` (backend), cela couvre la check-list §60.

---

## 6. Build Android (phase 8)

Le projet est en **Continuous Native Generation** : il n'y a **pas** de dossier `android/`
à créer à la main. `mobile/eas.json` définit trois profils :

| Profil | Sortie | Usage |
|---|---|---|
| `development` | **APK** + client de dev | développement sur appareil |
| `preview` | **APK** | installation directe (distrib. interne) |
| `production` | **AAB** | Google Play |

Identifiant Android : `mg.fenitra.gestionvente` (`mobile/app.json#expo.android.package`) —
à adapter avant publication.

### 6.1 Depuis EAS (recommandé)

```bash
cd mobile
npm install -g eas-cli          # ou npx eas-cli
eas login
eas build:configure             # vérifie eas.json

eas build --platform android --profile preview     # → .apk
eas build --platform android --profile production  # → .aab
```

Le lien de téléchargement de l'artefact s'affiche en fin de build ; `eas build:list`
liste les builds précédents.

### 6.2 Build local (sans le cloud)

```bash
cd mobile
npx eas-cli build --platform android --profile preview --local
```

Prérequis locaux : **JDK 17**, `ANDROID_HOME` pointant sur le SDK Android,
et les licences SDK acceptées (`sdkmanager --licenses`).
Sans ces outils, utilisez la build cloud (§6.1).

### 6.3 Sans EAS (`expo prebuild`)

```bash
cd mobile
npx expo prebuild --platform android     # génère android/ à partir de app.json + plugins
cd android && ./gradlew assembleRelease  # android/app/build/outputs/apk/release/*.apk
```

Vérifier `npx expo-doctor` avant toute build.

---

## 7. RBAC

`ADMIN`, `MANAGER`, `CASHIER` — encodé par `backend/src/middleware/auth.ts` et couvert par les tests :

| Ce que peut faire un **CASHIER** | Ce qui est refusé |
|---|---|
| Consulter le stock, les ventes, les dettes, les rapports | Régler une dette (`POST /debts/:id/payments`) |
| Créer une vente et en encaisser le paiement | Annuler une vente / un arrivage / une dette |
| Saisir un arrivage en lecture seule | Créer/modifier le catalogue et les tiers |
| Changer son propre mot de passe | Gérer les utilisateurs, les settings, les dépenses |

`MANAGER` hérite de tout sauf de la gestion des utilisateurs et des globales `adminOnly`
(`ADMIN` uniquement). Détail complet : `docs/API.md` §3.

---

## 8. Organisation du dépôt

```
├── backend/          API REST (src/modules/<domaine>/{routes,service,schemas}.ts)
│   ├── prisma/       schema.prisma, migrations/, seed.ts
│   └── tests/        *.test.ts + setup/{env,global}.ts
├── mobile/           app Expo
│   └── src/
│       ├── app/      écrans Expo Router (tabs/, sales/, arrivals/, settings/, …)
│       ├── lib/      queries.ts (React Query), api.ts, types.ts, status.ts
│       ├── components/  Section, Field, Chip, CancelPanel, ListFooter, …
│       └── store/    auth.ts (Zustand + SecureStore)
├── docs/             ANALYSE.md, FORMULES.md, API.md
└── README.md
```

Chaque étape de la reprise a été livrée dans un commit dédié
(`etape 1 …` à `etape 5 …`), sur la branche `main`.

---

## 9. Documentation

- **`docs/ANALYSE.md`** — analyse complète, ambiguïtés tranchées, schéma, formules, plan de phases, 12 scénarios
- **`docs/FORMULES.md`** — identités financières et leurs tests
- **`docs/API.md`** — contrat HTTP : auth, conventions, RBAC, 109 endpoints, codes d'erreur
- `backend/.env.example`, `mobile/.env.example` — configuration commentée
