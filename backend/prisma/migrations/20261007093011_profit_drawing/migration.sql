-- CreateTable
CREATE TABLE "ProfitDrawing" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfitDrawing_date_idx" ON "ProfitDrawing"("date");

-- AddForeignKey
ALTER TABLE "ProfitDrawing" ADD CONSTRAINT "ProfitDrawing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
