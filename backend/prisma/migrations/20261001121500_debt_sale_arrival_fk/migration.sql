-- Debt: split the shared origin pointer into two dedicated columns.
--
-- `originId` was mapped by BOTH `Debt -> Sale` and `Debt -> Arrival`, which
-- produced two foreign keys on the same column: a value had to exist in
-- `Sale` and in `Arrival` at the same time, so no insert could ever succeed.
--
-- `origin` (SALE / ARRIVAL / MANUAL) stays the discriminator.

ALTER TABLE "Debt" DROP CONSTRAINT IF EXISTS "Debt_originId_sale_fkey";
ALTER TABLE "Debt" DROP CONSTRAINT IF EXISTS "Debt_originId_arrival_fkey";

-- Dropping the column also drops `Debt_originId_key` and `Debt_originId_idx`.
ALTER TABLE "Debt" DROP COLUMN "originId";

ALTER TABLE "Debt" ADD COLUMN "saleId" TEXT;
ALTER TABLE "Debt" ADD COLUMN "arrivalId" TEXT;

CREATE UNIQUE INDEX "Debt_saleId_key" ON "Debt"("saleId");
CREATE UNIQUE INDEX "Debt_arrivalId_key" ON "Debt"("arrivalId");
CREATE INDEX "Debt_saleId_idx" ON "Debt"("saleId");
CREATE INDEX "Debt_arrivalId_idx" ON "Debt"("arrivalId");

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Debt"
  ADD CONSTRAINT "Debt_arrivalId_fkey"
  FOREIGN KEY ("arrivalId") REFERENCES "Arrival"("id") ON DELETE SET NULL ON UPDATE CASCADE;
