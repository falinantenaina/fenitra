import { useLocalSearchParams } from 'expo-router';

import { DebtGroupsPage } from '@/components/debt-groups';

/** Dettes clients — ce que les clients (et vendeurs en ligne) me doivent. */
export default function DebtsScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  // La clé remet la page à zéro quand les paramètres changent : le raccourci
  // « Paiement client » applique son filtre sans effet de synchronisation.
  return (
    <DebtGroupsPage
      key={params.status ?? ''}
      direction="RECEIVABLE"
      emptyIcon="people-outline"
      emptyMessage="Aucune dette client."
      subtitle="Ce que les clients me doivent"
      title="Dettes clients"
    />
  );
}
