-- Integrity checks (business rules from the specification)

-- A "trosa sinoa" debt is always money I owe => PAYABLE
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_trosa_is_payable"
  CHECK (type <> 'TROSA_SINOA' OR direction = 'PAYABLE');

-- The reason is mandatory and can not be blank
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_reason_not_blank"
  CHECK (btrim(reason) <> '');

-- Amounts must be coherent
ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_amounts_positive"
  CHECK ("initialAmount" > 0 AND "paidAmount" >= 0 AND "remainingAmount" >= 0);

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_paid_never_exceeds_initial"
  CHECK ("paidAmount" <= "initialAmount");

-- A lot can never ship more units than it contains
ALTER TABLE "StockLot"
  ADD CONSTRAINT "StockLot_quantities_positive"
  CHECK ("initialQty" > 0 AND "remainingQty" >= 0 AND "remainingQty" <= "initialQty");

ALTER TABLE "StockLot"
  ADD CONSTRAINT "StockLot_unit_cost_positive"
  CHECK ("unitCost" > 0);

-- An arrival line must be internally consistent
ALTER TABLE "ArrivalItem"
  ADD CONSTRAINT "ArrivalItem_quantity_positive"
  CHECK (quantity > 0 AND "unitCost" >= 0 AND "lineTotal" = quantity * "unitCost");

-- A historical sale keeps its own price
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_price_and_qty_positive"
  CHECK (quantity > 0 AND "unitPrice" >= 0 AND "lineTotal" = quantity * "unitPrice");

-- Sale amounts must stay coherent with the status
-- (a cancelled sale keeps its historical record untouched)
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

-- A payment always has a strictly positive amount and a single direction
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive"
  CHECK ("amount" > 0);

-- Journal: amount is signed only for reversals; a normal entry is never zero
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_nonzero"
  CHECK (amount <> 0);
