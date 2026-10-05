-- Un carton = un modèle, avec ventilation des pointures possible plus tard.
ALTER TABLE "ArrivalCarton" ADD COLUMN "productId" TEXT;
ALTER TABLE "ArrivalCarton" ADD COLUMN "ventilatedAt" TIMESTAMP(3);

-- Reprise : le modèle d'un carton vient de sa première ligne.
UPDATE "ArrivalCarton" c SET "productId" = (
  SELECT v."productId" FROM "ArrivalItem" i
  JOIN "ProductVariant" v ON v."id" = i."variantId"
  WHERE i."cartonId" = c."id" LIMIT 1
) WHERE c."productId" IS NULL;

-- Les brouillons (aucune ligne, aucun modèle) sont supprimés : plus de statut DRAFT.
DELETE FROM "Arrival" WHERE "status" = 'DRAFT';
DELETE FROM "ArrivalCarton" WHERE "productId" IS NULL;

ALTER TABLE "ArrivalCarton" ALTER COLUMN "productId" SET NOT NULL;

-- Un carton déjà ligné l'était à l'enregistrement : il est réputé ventilé.
UPDATE "ArrivalCarton" SET "ventilatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP)
WHERE EXISTS (SELECT 1 FROM "ArrivalItem" i WHERE i."cartonId" = "ArrivalCarton"."id");

ALTER TABLE "ArrivalCarton" ADD CONSTRAINT "ArrivalCarton_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ArrivalCarton_productId_idx" ON "ArrivalCarton"("productId");

-- Le statut DRAFT n'est plus écrit ni accepté (PostgreSQL ne sait pas
-- supprimer une valeur d'un enum : on recrée le type).
ALTER TYPE "ArrivalStatus" RENAME TO "ArrivalStatus_old";
CREATE TYPE "ArrivalStatus" AS ENUM ('RECEIVED', 'CANCELLED');
ALTER TABLE "Arrival" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Arrival" ALTER COLUMN "status" TYPE "ArrivalStatus"
  USING "status"::text::"ArrivalStatus";
ALTER TABLE "Arrival" ALTER COLUMN "status" SET DEFAULT 'RECEIVED'::"ArrivalStatus";
DROP TYPE "ArrivalStatus_old";
