export const APP_NAME = 'gestion-vente-api';

/** Prefixes de référence auto-incrémentées (table Sequence). */
export const SEQUENCES = {
  ARRIVAL: 'arrival',
  CARTON: 'carton',
  SALE: 'sale',
  PAYMENT: 'payment',
} as const;

export const DEBT_REASON_TEMPLATES = {
  /** Achat de 1 Samba pointure 42 — non payé */
  saleUnpaid: (label: string) => `Achat de ${label} — non payé`,
  /** Achat de 2 chaussures Samba — paiement partiel */
  salePartial: (label: string) => `Achat de ${label} — paiement partiel`,
  /** Arrivage ARR-0005 — non payé */
  arrivalUnpaid: (reference: string) => `Arrivage ${reference} — non payé`,
  /** Arrivage ARR-0005 — paiement partiel */
  arrivalPartial: (reference: string) => `Arrivage ${reference} — paiement partiel`,
} as const;

/** Montant maximum défendu (garde-fou contre les saisies aberrantes). */
export const MAX_AMOUNT = 1_000_000_000_000;

export const STATUSES = {
  OPEN: 'OPEN',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export const LOT_STATUS = {
  OPEN: 'OPEN',
  DEPLETED: 'DEPLETED',
  CANCELLED: 'CANCELLED',
} as const;
