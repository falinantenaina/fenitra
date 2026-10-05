import { useLocalSearchParams } from 'expo-router';

import { DebtGroupsPage } from '@/components/debt-groups';

/** Dettes fournisseurs — ce que je dois payer (arrivages, trosa sinoa). */
export default function SuppliersDebtsScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  // La clé remet la page à zéro quand les paramètres changent : le raccourci
  // « Paiement fournisseur » applique son filtre sans effet de synchronisation.
  return (
    <DebtGroupsPage
      key={params.status ?? ''}
      direction="PAYABLE"
      emptyIcon="business-outline"
      emptyMessage="Aucune dette fournisseur."
      subtitle="Ce que je dois payer"
      title="Fournisseurs"
    />
  );
}
