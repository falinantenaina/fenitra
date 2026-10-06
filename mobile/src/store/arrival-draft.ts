import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ArrivalFormValues } from '@/lib/arrival';

interface ArrivalDraftState {
  values: ArrivalFormValues | null;
  /** Dernière frappe, affichée dans la proposition de reprise. */
  savedAt: number | null;
  save: (values: ArrivalFormValues) => void;
  clear: () => void;
}

/**
 * Brouillon de saisie d'arrivage : les cartons en cours (modèle, quantité,
 * montant, pointures) sont écrits sur le disque et surviennent donc à la
 * fermeture de l'app, pas seulement à une navigation. Au retour sur l'écran,
 * le brouillon est proposé (reprendre ou repartir de zéro), jamais imposé.
 */
export const useArrivalDraft = create<ArrivalDraftState>()(
  persist(
    (set) => ({
      values: null,
      savedAt: null,
      save: (values) => set({ values, savedAt: Date.now() }),
      clear: () => set({ values: null, savedAt: null }),
    }),
    {
      name: 'arrival-draft-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ values: state.values, savedAt: state.savedAt }),
    },
  ),
);
