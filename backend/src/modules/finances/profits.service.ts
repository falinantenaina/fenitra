import { prisma } from '../../lib/prisma';
import { money } from '../../lib/money';
import type { CreateGainInput } from './profits.schemas';

export const DEFAULT_GAIN_DESCRIPTION = 'Bénéfice hors stock';

/**
 * A16 — POST /profits : une seule écriture au journal, `kind = SALE` — le
 * bénéfice rejoint donc le CA, l'argent reçu, le brut et le net sans toucher
 * aux formules. `cashDelta = montant` : l'achat hors stock puis la vente font
 * un mouvement net de caisse égal au bénéfice, l'identité comptable (§8.3)
 * reste exacte. Aucune `Sale`, aucun `SaleItem`, aucun lot : le stock n'est
 * pas concerné et la marge à recevoir (§41) ignore cette écriture.
 */
export async function createGain(input: CreateGainInput, userId: string | null) {
  const entry = await prisma.ledgerEntry.create({
    data: {
      kind: 'SALE',
      amount: input.amount,
      cashDelta: input.amount,
      description: input.description ?? DEFAULT_GAIN_DESCRIPTION,
      userId,
    },
  });

  return {
    id: entry.id,
    date: entry.date,
    kind: entry.kind,
    amount: money(entry.amount),
    cashDelta: money(entry.cashDelta),
    description: entry.description,
  };
}
