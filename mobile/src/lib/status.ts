import type { ArrivalStatus, SaleStatus } from '@/lib/types';

export interface StatusStyle {
  label: string;
  className: string;
  text: string;
}

/** Statuts de vente (`SaleStatus`) → libellé + couleurs. */
export const SALE_STATUS: Record<SaleStatus, StatusStyle> = {
  PAID: { label: 'Réglée', className: 'bg-emerald-50', text: 'text-emerald-700' },
  PARTIAL: { label: 'Partielle', className: 'bg-sky-50', text: 'text-sky-700' },
  UNPAID: { label: 'Impayée', className: 'bg-amber-50', text: 'text-amber-700' },
  CANCELLED: { label: 'Annulée', className: 'bg-slate-100', text: 'text-slate-500' },
};

/** Statuts d'arrivage (`ArrivalStatus`) → libellé + couleurs. */
export const ARRIVAL_STATUS: Record<ArrivalStatus, StatusStyle> = {
  DRAFT: { label: 'Brouillon', className: 'bg-slate-100', text: 'text-slate-500' },
  RECEIVED: { label: 'Reçu', className: 'bg-emerald-50', text: 'text-emerald-700' },
  CANCELLED: { label: 'Annulé', className: 'bg-slate-100', text: 'text-slate-500' },
};
