-- ═══════════════════════════════════════════════════════════════
-- Contraintes d'intégrité métier (priorité 1 du cahier des charges)
-- ═══════════════════════════════════════════════════════════════

-- §30 / §68 — une dette TROSA_SINOA est TOUJOURS une dette que je paie (PAYABLE)
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_trosa_is_payable"
  CHECK (type <> 'TROSA_SINOA' OR direction = 'PAYABLE');

-- §31 / §68 — le motif est obligatoire et ne peut pas être vide
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_reason_not_blank"
  CHECK (btrim(reason) <> '');

-- Montants cohérents
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_amounts_positive"
  CHECK ("initialAmount" > 0 AND "paidAmount" >= 0 AND "remainingAmount" >= 0);

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_paid_never_exceeds_initial"
  CHECK ("paidAmount" <= "initialAmount");

-- §15 / §17 — un lot ne peut pas sortir plus que ce qu'il contient
ALTER TABLE "StockLot"
  ADD CONSTRAINT "StockLot_quantities_positive"
  CHECK ("initialQty" > 0 AND "remainingQty" >= 0 AND "remainingQty" <= "initialQty");

ALTER TABLE "StockLot"
  ADD CONSTRAINT "StockLot_unit_cost_positive"
  CHECK ("unitCost" > 0);

-- §9-§12 — une ligne d'arrivage est cohérente
ALTER TABLE "ArrivalItem"
  ADD CONSTRAINT "ArrivalItem_quantity_positive"
  CHECK (quantity > 0 AND "unitCost" >= 0 AND "lineTotal" = quantity * "unitCost");

-- §19 — une vente historique conserve son prix
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_price_and_qty_positive"
  CHECK (quantity > 0 AND "unitPrice" >= 0 AND "lineTotal" = quantity * "unitPrice");

-- §24 — statuts de vente cohérents avec les montants
-- (une vente annulée échappe au contrôle : son historique est conservé tel quel)
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_amounts_consistent"
  CHECK (
    status = 'CANCELLED'
    OR (
      "totalAmount" >= 0
      AND "paidAmount" >= 0
      AND "remainingAmount" >= 0
      AND "paidAmount" <= "totalAmount"
      AND "remainingAmount" = "totalAmount" - "paidAmount"
    )
  );

-- Un paiement est toujours d'un seul sens et d'un montant strictement positif
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive"
  CHECK ("amount" > 0);

-- Le journal : `amount` et `cashDelta` sont signés uniquement pour les
-- contre-passations ; les écritures normales portent un montant strictement positif.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_nonzero"
  CHECK (amount <> 0);
