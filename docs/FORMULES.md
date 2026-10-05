# FORMULES FINANCIÈRES — règles validées

> Source de vérité pour l'implémentation (`src/services/metrics/`).
> Analyse complète : [`docs/ANALYSE.md`](./ANALYSE.md) §8, §9, §10, §14.

---

## 0. Convention d'écriture du journal

Tout montant affiché sur le dashboard est une **agrégation d'écritures** du journal
financier (`LedgerEntry`), des **dettes** (`Debt`) ou des **lots** (`StockLot`).
Aucune valeur n'est saisie ni calculée « à la main ».

| Champ | Règle |
|---|---|
| `amount` | toujours > 0 pour une opération normale ; **négatif** pour une contre-passation (annulation) |
| `cashDelta` | impact caisse ; `0` pour les écritures non monétaires (COGS) |
| `kind` | détermine l'indicateur auquel l'écriture participe |

**Contre-passation** : on n'insère pas `kind = REVERSAL`, on réinsère le `kind`
d'origine avec `amount` et `cashDelta` négatifs + `reference = 'ANNULATION …'`.
Ainsi `Σ amount WHERE kind='SALE'` reste exact sans condition supplémentaire.

### Kind → indicateur

| `kind` | signification | cashDelta | indicateur |
|---|---|---|---|
| `SALE` | vente (total), la part payée sort en caisse | +payé | CA, recettes, caisse |
| `COGS` | coût des lots sortis | 0 | COGS |
| `CUSTOMER_PAYMENT` | règlement d'une dette client | + | recettes, caisse |
| `ONLINE_SELLER_PAYMENT` | règlement d'un vendeur en ligne | + | recettes, caisse |
| `SUPPLIER_PAYMENT` | paiement fournisseur | − | caisse |
| `EXPENSE` | dépense (charge) | − | dépenses, caisse |
| `VERSEMENT` | versement traité en **CHARGE** | − | versements, caisse |
| `TROSA_REPAY` | versement traité en **DEBT_SETTLEMENT** ou paiement trosa | − | caisse, dettes |
| `TROSA_BORROW` | création d'une dette trosa sinoa (**encaissement**) | + | caisse, dettes |
| `PERSONAL_CAPITAL_IN` | injection d'argent propre | + | argent propre, caisse |
| `PERSONAL_CAPITAL_OUT` | récupération de mon capital | − | argent propre, caisse |
| `PROFIT_DRAWING` | je sors du bénéfice | − | caisse, bénéfice sorti |
| `OTHER` | divers | ± | caisse |

---

## 1. Flux — sur une PÉRIODE

```
CA           = Σ amount            WHERE kind = 'SALE'
COGS         = Σ amount            WHERE kind = 'COGS'
RECETTES     = Σ cashDelta         WHERE cashDelta > 0
               AND kind IN ('SALE','CUSTOMER_PAYMENT','ONLINE_SELLER_PAYMENT')
  ↳ dont encaissé à la vente = Σ cashDelta WHERE cashDelta > 0 AND kind = 'SALE'
DÉPENSES     = Σ amount            WHERE kind = 'EXPENSE'
VERSEMENTS   = Σ amount            WHERE kind = 'VERSEMENT'          (charges uniquement)
RETRAITS     = Σ amount            WHERE kind = 'PROFIT_DRAWING'

BÉNÉFICE BRUT = CA − COGS                                          (§44)
BÉNÉFICE NET  = BÉNÉFICE BRUT − DÉPENSES − VERSEMENTS(charges)     (§45)
```

**Ne réduit JAMAIS le bénéfice net** (§45) :

- le remboursement d'une dette fournisseur (déjà comptabilisé en COGS) ;
- la récupération d'argent propre ;
- le retrait de capital ;
- le retrait de bénéfice (`PROFIT_DRAWING`) ;
- le règlement d'une trosa sinoa (`TROSA_REPAY`).

---

## 2. États — À une DATE (cumulé jusqu'à `to`)

```
CAISSE          = soldeInitial + Σ cashDelta WHERE date < to                (§46)
VALEUR DU STOCK  = Σ (quantitéRestanteLot(T) × unitCost)                    (§17)
                    quantitéRestanteLot(T) = initialQty + Σ delta (date < T, type <> 'IN')
DETTES CLIENTS   = Σ remainingAmount WHERE type = 'CUSTOMER'
DETTES VENDEURS  = Σ remainingAmount WHERE type = 'ONLINE_SELLER'
DETTES FOURN.    = Σ remainingAmount WHERE type = 'SUPPLIER'
TROSA SINOA      = Σ remainingAmount WHERE type = 'TROSA_SINOA'  (toujours PAYABLE)

ARGENT À RECEVOIR (G) = DETTES CLIENTS + DETTES VENDEURS
ARGENT À PAYER   (H)  = DETTES FOURNISSEURS + TROSA SINOA

ARGENT PROPRE ENGAGÉ (K) = Σ PERSONAL_CAPITAL_IN − Σ PERSONAL_CAPITAL_OUT   (§34)
```

`remainingAmount` est recalculé **à la date** à partir de
`initialAmount − Σ paiements (date < T)` — un règlement reçu après la période
ne diminue donc pas l'état affiché pour cette période.

---

## 3. Identité comptable (contrôle d'intégrité)

```
CAISSE + STOCK + CRÉANCES − PASSIFS
  = ARGENT PROPRE ENGAGÉ + (CA − COGS − DÉPENSES − VERSEMENTS_CHARGES − RETRAITS_BÉNÉFICE)
```

Chaque dashboard expose `integrity.identityDelta` qui **doit être `0`**.
Un delta non nul signifie qu'un flux n'a pas été journalisé : c'est un bug,
pas un écart toléré.

---

## 4. VOLA MIODINA (§10 — validé A4)

```
VOLA MIODINA = CAISSE + STOCK + CRÉANCES − PASSIFS
```

Par l'identité : `VOLA MIODINA = ARGENT PROPRE ENGAGÉ + BÉNÉFICE NET NON SORTI`.

Ce n'est **ni** la caisse, **ni** le bénéfice :

```
┌─ CAISSE ................. liquidité réelle
├─ ARGENT À RECEVOIR ...... créances
├─ ARGENT À PAYER ......... passifs
├─ VALEUR DU STOCK ........ marchandise
├─ VOLA MIODINA ........... fonds en circulation (= K + bénéfice non sorti)
├─ ARGENT PROPRE ENGAGÉ ... ma part (ce n'est PAS un bénéfice)
└─ BÉNÉFICE MANGEABLE ..... ce que je peux réellement sortir
```

---

## 5. BÉNÉFICE MANGEABLE (§9 — validé A3)

```
SURPLUS_CASH = CAISSE − ARGENT À PAYER − ARGENT PROPRE ENGAGÉ − RÉSERVE

BÉNÉFICE MANGEABLE = max(0, min(BÉNÉFICE NET CUMULÉ, SURPLUS_CASH))
```

- **`min`** → on ne mange jamais plus que le bénéfice réellement réalisé ;
- **`max(0)`** → on ne mange jamais la caisse des autres ni l'argent pas encore encaissé ;
- **`RÉSERVE`** (`WORKING_RESERVE`, défaut `0`) → argent à garder pour renouveler les marchandises ;
- **`BÉNÉFICE NET CUMULÉ`** = `VOLA MIODINA − ARGENT PROPRE ENGAGÉ`.

Jamais toute la caisse n'est considérée comme du bénéfice (§7).

> **Note d'implémentation.** Par l'identité du §3 on démontre que
> `bénéfice net cumulé − surplus = stock + créances + retraits + réserve ≥ 0`,
> donc `min(...)` est en pratique égal au surplus de caisse. Il est **conservé
> comme garde-fou** : si une donnée est un jour importée sans passer par le
> journal, le bénéfice affiché restera plafonné au disponible réel.

### Vérifications

| Situation | caisse | K | net cumulé | mangeable |
|---|---|---|---|---|
| Vente 120 payée après injection 100 | 120 | 100 | 20 | `min(20, 20) = 20` |
| Stock à moitié vendu, tout encaissé | 75 | 100 | 25 | `min(25, −25) → 0` |
| Vente à crédit, non encaissée | 60 | 100 | 20 | `min(20, −40) → 0` |
| Client réglé ensuite | 120 | 100 | 20 | `20` |

---

## 6. Règles de stock (§14-§17, §66)

1. **Un lot = une ligne de carton.** `StockLot.unitCost` est écrit une fois et
   **n'est jamais modifié**.
2. Un nouvel arrivage **n'écrase jamais** un ancien prix : les lots coexistent.
3. **Sortie FIFO** par `variantId`, tri `entryDate, createdAt, id`, verrou `FOR UPDATE`.
   COGS = `Σ (quantité sortie × unitCost du lot)`.
4. **Valorisation** = `Σ (remainingQty × unitCost)` — jamais
   `quantité totale × prix d'achat actuel`.
   + **Cartons à ventiler** : `Σ (ArrivalCarton.totalCost − Σ ArrivalItem.lineTotal)`
   et `Σ (ArrivalCarton.totalQty − Σ ArrivalItem.quantity)`, hors arrivages
   annulés. Un arrivage enregistré sans pointures pèse donc déjà dans le stock
   (son paiement ayant bougé la caisse et la dette) ; la ventilation ne fait que
   déplacer ce montant vers des lots — le résidu tombe à 0 (ou à l'arrondi
   `floor(montant / quantité)`), d'où **aucun double comptage**.
5. **Historique des prix** = lecture directe des `StockLot` du variant, triés par `entryDate`.
6. Chaque variation de `remainingQty` génère un `StockMovement` (`delta` signé).

---

## 7. Dettes (§30, §31, §68)

```
Dette = MONTANT TOTAL − MONTANT PAYÉ
```

- **Motif obligatoire** (`Debt.reason NOT NULL`), généré automatiquement :
  - `"Achat de {label} — non payé"` / `"Achat de {label} — paiement partiel"`
  - `"Arrivage {reference} — non payé"` / `"Arrivage {reference} — paiement partiel"`
- `TROSA_SINOA` impose `direction = PAYABLE` et **encaisse** à la création
  (`LedgerKind.TROSA_BORROW`) — c'est ce qui préserve l'identité du §3.
- Paiements multiples supportés ; `status = PAID` quand `remainingAmount = 0`.

---

## 8. Précision monétaire (A9)

**Entiers uniquement** (`Decimal(18,0)` / `Int` en Prisma). Tous les montants sont
des ariary entiers. Aucun `Float`, aucun `Double`.
