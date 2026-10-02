import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { useLotMovements } from '@/lib/queries';
import type { LotMovementItem } from '@/lib/types';

const TYPE_LABELS: Record<string, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
  RETURN: 'Retour',
  ADJUSTMENT: 'Ajustement',
  REVERSAL: 'Contre-passation',
};

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View className="w-1/2 gap-0.5 px-1 py-1.5">
      <Text className="text-xs text-slate-400">{label}</Text>
      <Text className="text-sm font-medium text-slate-800">{value}</Text>
    </View>
  );
}

function MovementRow({ movement }: { movement: LotMovementItem }) {
  const positive = movement.delta > 0;

  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
      <View className="flex-1">
        <Text className="text-sm font-medium text-slate-800">
          {TYPE_LABELS[movement.type] ?? movement.type} ·{' '}
          <Text className={positive ? 'text-emerald-600' : 'text-red-600'}>
            {positive ? '+' : ''}
            {movement.delta}
          </Text>
        </Text>
        <Text className="text-xs text-slate-400">
          {formatDateTime(movement.date)}
          {movement.refType ? ` · ${movement.refType}` : ''}
          {movement.user ? ` · ${movement.user.name}` : ''}
        </Text>
        {movement.notes ? <Text className="text-xs text-slate-400">{movement.notes}</Text> : null}
      </View>
      <Text className="text-xs font-semibold text-slate-600">
        {formatMoney(movement.unitCost)}
      </Text>
    </View>
  );
}

/** `useLocalSearchParams` peut renvoyer un tableau — on garde la première valeur. */
function pick(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function LotScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    code?: string;
    product?: string;
    supplier?: string;
    arrival?: string;
    entryDate?: string;
  }>();
  const id = pick(params.id) || null;
  const { data, isPending, error } = useLotMovements(id);

  const code = data?.lot.code ?? pick(params.code);
  const product = pick(params.product);

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ gap: 14, padding: 16 }}>
      {isPending ? (
        <ActivityIndicator className="py-8" color="#208AEF" />
      ) : error ? (
        <Text className="text-sm text-red-600">Impossible de charger ce lot.</Text>
      ) : data ? (
        <>
          <View className="gap-1 rounded-xl border border-slate-200 bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-slate-900">{code}</Text>
              <View
                className={`rounded-full px-2.5 py-1 ${
                  data.lot.status === 'OPEN' ? 'bg-emerald-50' : 'bg-slate-100'
                }`}>
                <Text
                  className={`text-xs font-semibold ${
                    data.lot.status === 'OPEN' ? 'text-emerald-700' : 'text-slate-500'
                  }`}>
                  {data.lot.status === 'OPEN' ? 'Ouvert' : 'Clôturé'}
                </Text>
              </View>
            </View>
            {product ? <Text className="text-sm text-slate-700">{product}</Text> : null}

            <View className="-mx-1 mt-2 flex-row flex-wrap">
              <Info label="Quantité initiale" value={formatQuantity(data.lot.initialQty)} />
              <Info label="Restant" value={formatQuantity(data.lot.remainingQty)} />
              <Info label="Prix d'achat" value={formatMoney(data.lot.unitCost)} />
              <Info
                label="Valeur restante"
                value={formatMoney(data.lot.remainingQty * Number(data.lot.unitCost))}
              />
              <Info label="Entrée" value={formatDateTime(pick(params.entryDate))} />
              <Info label="Fournisseur" value={pick(params.supplier) || '—'} />
              <Info label="Arrivage" value={pick(params.arrival) || '—'} />
            </View>
          </View>

          <View>
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Mouvements du lot · {data.items.length}
            </Text>
            <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {data.items.length === 0 ? (
                <Text className="px-3 py-4 text-sm text-slate-400">Aucun mouvement.</Text>
              ) : (
                data.items.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))
              )}
            </View>
          </View>

          <View className="flex-row items-start gap-2 rounded-xl bg-slate-100 px-3 py-2.5">
            <Ionicons color="#64748B" name="shield-checkmark-outline" size={16} />
            <Text className="flex-1 text-xs text-slate-500">
              Chaque mouvement est tracé : entrée d&apos;arrivage, sortie de vente FIFO, retour ou
              ajustement de casse.
            </Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
