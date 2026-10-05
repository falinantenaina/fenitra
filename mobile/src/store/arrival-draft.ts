import { create } from 'zustand';

import type { ArrivalFormValues } from '@/lib/arrival';

/**
 * Brouillon de saisie d'arrivage : les cartons en cours (modèle, quantité,
 * montant, pointures) sont conservés si l'utilisateur quitte l'écran (onglet,
 * appel entrant…) et reposés au retour.
 */
interface ArrivalDraftState {
  values: ArrivalFormValues | null;
  save: (values: ArrivalFormValues) => void;
  clear: () => void;
}

export const useArrivalDraft = create<ArrivalDraftState>()((set) => ({
  values: null,
  save: (values) => set({ values }),
  clear: () => set({ values: null }),
}));
