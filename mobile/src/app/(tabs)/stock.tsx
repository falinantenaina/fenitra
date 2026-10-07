import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { ErrorPanel } from '@/components/error-panel';
import { ListFooter } from '@/components/list-footer';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import {
  useArrivals,
  useLots,
  useProductVariants,
  useRecentMovements,
  useStockByProduct,
  useStockSummary,
  useUpdateVariant,
} from '@/lib/queries';
import type { LotItem, ProductStockItem, StockMovementFeedItem, VariantSearchItem } from '@/lib/types';
import { useRefresh } from '@/lib/use-refresh';
import { useAuth } from '@/store/auth';

const STATUS_FILTERS = [
  { key: '', label: 'Tous' },
  { key: 'OPEN', label: 'Ouverts' },
  { key: 'CLOSED', label: 'Clôturés' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['key'];

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-xl bg-slate-50 px-3 py-2.5">
      <Text className="text-xs text-slate-500">{label}</Text>
      <Text className="text-sm font-bold text-slate-900">{value}</Text>
    </View>
  );
}

function openLot(lot: LotItem) {
  router.push({
    pathname: '/stock/lot',
    params: {
      id: lot.id,
      code: lot.code,
      product: lot.variant.product.name,
      size: lot.variant.size.label || `${lot.variant.size.value}`,
      supplier: lot.supplier?.name ?? '',
      arrival: lot.arrival?.reference ?? '',
      entryDate: lot.entryDate,
    },
  });
}

function LotRow({
  lot,
  onPress,
  canManage,
}: {
  lot: LotItem;
  onPress: () => void;
  /** §A11 — prix d'achat et valeur réservés aux gestionnaires. */
  canManage: boolean;
}) {
  const size = lot.variant.size.label || `${lot.variant.size.value}`;
  const open = lot.status === 'OPEN';

  return (
    <Pressable
      className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
      onPress={onPress}>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-800">
          {lot.variant.product.name} · {size}
        </Text>
        <Text className="text-xs text-slate-400">
          {lot.code}
          {lot.supplier ? ` · ${lot.supplier.name}` : ''}
          {lot.arrival ? ` · ${lot.arrival.reference}` : ''}
        </Text>
        <Text className="text-xs text-slate-400">
          {canManage ? `Achat ${formatMoney(lot.unitCost)} · ` : ''}
          restant {lot.remainingQty}/{lot.initialQty}
        </Text>
      </View>
      <View className="items-end">
        {canManage ? (
          <Text className="text-sm font-semibold text-slate-800">{formatMoney(lot.value)}</Text>
        ) : null}
        <Text className={`text-xs ${open ? 'text-emerald-600' : 'text-slate-400'}`}>
          {open ? 'Ouvert' : 'Clôturé'}
        </Text>
      </View>
    </Pressable>
  );
}

function MovementRow({ movement }: { movement: StockMovementFeedItem }) {
  const size = movement.variant.size.value;
  const positive = movement.delta > 0;

  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
      <View className="flex-1">
        <Text className="text-sm font-medium text-slate-800">
          {movement.variant.product.name} · {size}
        </Text>
        <Text className="text-xs text-slate-400">
          {movement.lot.code} · {movement.refType ?? '—'} · {formatDateTime(movement.date)}
        </Text>
      </View>
      <Text
        className={`text-sm font-semibold ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
        {positive ? '+' : ''}
        {movement.delta}
      </Text>
    </View>
  );
}

/** Détail d'un modèle : ses lots, pointure par pointure (clic sur le modèle). */
function ModelLots({ productId, status }: { productId: string; status: StatusFilter }) {
  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const lots = useLots({ productId, status });
  const variants = useProductVariants(productId);
  const updateVariant = useUpdateVariant();
  const [edited, setEdited] = useState<VariantSearchItem | null>(null);
  const [priceText, setPriceText] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  function openPrice(variant: VariantSearchItem) {
    setPriceText(String(Number(variant.sellingPrice.replace(/[^0-9]/g, '')) || 0));
    setPriceError(null);
    setEdited(variant);
  }

  function savePrice() {
    if (!edited) return;
    const sellingPrice = Number(priceText.replace(/[^0-9]/g, ''));
    if (sellingPrice < 1) {
      setPriceError('Prix de vente invalide.');
      return;
    }
    updateVariant.mutate(
      { id: edited.id, body: { sellingPrice } },
      {
        onSuccess: () => setEdited(null),
        onError: () => setPriceError('Enregistrement impossible — réessayez.'),
      },
    );
  }

  return (
    <View className="border-t border-slate-100 bg-slate-50 pt-3">
      <Text className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Lots · {lots.total}
      </Text>
      <View className="mt-2 overflow-hidden bg-white">
        {lots.isPending ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : lots.isError ? (
          <ErrorPanel
            isRetrying={lots.isRefetching}
            message="Impossible de charger les lots."
            onRetry={() => void lots.refetch()}
          />
        ) : lots.items.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun lot pour ce modèle.</Text>
        ) : (
          lots.items.map((lot) => (
            <LotRow key={lot.id} lot={lot} canManage={canManage} onPress={() => openLot(lot)} />
          ))
        )}
      </View>
      <ListFooter
        fetchNextPage={() => void lots.fetchNextPage()}
        hasMore={lots.hasMore}
        isFetchingNextPage={lots.isFetchingNextPage}
        shown={lots.items.length}
        total={lots.total}
      />

      <Text className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Prix de vente · {variants.data?.length ?? 0}
      </Text>
      <View className="mt-2 overflow-hidden bg-white">
        {variants.isPending ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : variants.isError ? (
          <ErrorPanel
            isRetrying={variants.isRefetching}
            message="Impossible de charger les prix de vente."
            onRetry={() => void variants.refetch()}
          />
        ) : (variants.data ?? []).length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">
            Aucune pointure à vendre pour ce modèle.
          </Text>
        ) : (
          (variants.data ?? []).map((variant) => (
            <Pressable
              accessibilityLabel={`Prix de vente pointure ${variant.size.label || variant.size.value}`}
              className="flex-row items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              disabled={!canManage}
              key={variant.id}
              onPress={() => openPrice(variant)}>
              <Text className="w-14 text-sm font-semibold text-slate-800">
                {variant.size.label || variant.size.value}
              </Text>
              <Text className="flex-1 text-xs text-slate-400">
                {formatQuantity(variant.stock)} en stock
              </Text>
              <Text className="text-sm font-bold text-slate-900">
                {formatMoney(variant.sellingPrice)}
              </Text>
              {canManage ? <Ionicons color="#94A3B8" name="pencil" size={14} /> : null}
            </Pressable>
          ))
        )}
      </View>
      {canManage && !variants.isPending && (variants.data ?? []).length > 0 ? (
        <Text className="px-3 pb-1 pt-2 text-xs text-slate-400">
          Touchez une pointure pour corriger son prix de vente.
        </Text>
      ) : null}

      {edited ? (
        <Modal animationType="fade" onRequestClose={() => setEdited(null)} transparent visible>
          <View className="flex-1 items-center justify-center bg-slate-900/50 px-6">
            <View className="w-full gap-3 rounded-2xl bg-white p-4">
              <Text className="text-sm font-bold text-slate-900">
                Prix de vente — {edited.product.name}{' '}
                {edited.size.label || edited.size.value}
              </Text>
              <TextInput
                className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
                keyboardType="numeric"
                onChangeText={setPriceText}
                placeholder="0"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={priceText}
              />
              {priceError ? <Text className="text-xs text-red-600">{priceError}</Text> : null}
              <View className="flex-row gap-2">
                <Pressable
                  className="h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white"
                  onPress={() => setEdited(null)}>
                  <Text className="font-semibold text-slate-700">Annuler</Text>
                </Pressable>
                <Pressable
                  className="h-11 flex-1 items-center justify-center rounded-xl bg-brand"
                  disabled={updateVariant.isPending}
                  onPress={savePrice}>
                  {updateVariant.isPending ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="font-semibold text-white">Enregistrer</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/** Une ligne par modèle — le clic ouvre le détail de ses pointures. */
function ModelRow({
  model,
  expanded,
  status,
  onPress,
}: {
  model: ProductStockItem;
  expanded: boolean;
  status: StatusFilter;
  onPress: () => void;
}) {
  // §A11 — la valorisation du modèle est réservée aux gestionnaires.
  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <View className="border-b border-slate-100 last:border-b-0">
      <Pressable className="flex-row items-center gap-3 px-3 py-3" onPress={onPress}>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-slate-800">{model.name}</Text>
          <Text className="text-xs text-slate-400">
            {formatQuantity(model.lots)} lot(s)
            {canManage ? ` · ${formatMoney(model.value)}` : ''}
          </Text>
        </View>
        <Text className="text-sm font-bold text-slate-900">
          {formatQuantity(model.quantity)} disponibles
        </Text>
        <Ionicons
          color={expanded ? '#208AEF' : '#CBD5E1'}
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={16}
        />
      </Pressable>
      {expanded ? <ModelLots productId={model.productId} status={status} /> : null}
    </View>
  );
}

export default function StockScreen() {
  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const summary = useStockSummary(null);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const models = useStockByProduct({ q: debounced, status });
  const movements = useRecentMovements();
  // Cartons dont les pointures ne sont pas encore réparties (stock « à ventiler »).
  const unventilated = useArrivals({ unventilated: true }, canManage);
  const { onRefresh, refreshing } = useRefresh(async () => {
    await Promise.all([
      summary.refetch(),
      models.refetch(),
      movements.refetch(),
      ...(canManage ? [unventilated.refetch()] : []),
    ]);
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ gap: 14, padding: 16 }}
        refreshControl={
          <RefreshControl colors={['#208AEF']} onRefresh={onRefresh} refreshing={refreshing} />
        }>
        <Text className="text-xl font-bold text-slate-900">Stock</Text>

        {/* Résumé global — §A11 : la valorisation est réservée aux gestionnaires. */}
        <View className="flex-row gap-2">
          <SummaryCard label="Quantité" value={formatQuantity(summary.data?.quantity)} />
          {canManage ? (
            <SummaryCard label="Valorisation" value={formatMoney(summary.data?.value)} />
          ) : null}
          <SummaryCard label="Lots" value={formatQuantity(summary.data?.lots)} />
        </View>

        {/* Cartons à ventiler */}
        {canManage && unventilated.total > 0 ? (
          <Pressable
            className="flex-row items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
            onPress={() => router.push('/arrivals/list')}>
            <Ionicons color="#D97706" name="cube-outline" size={18} />
            <Text className="flex-1 text-xs text-amber-800">
              {unventilated.total} arrivage(s) avec des pointures à répartir — la valorisation les
              compte déjà.
            </Text>
            <Ionicons color="#D97706" name="chevron-forward" size={16} />
          </Pressable>
        ) : null}

        {/* Actions */}
        {canManage ? (
          <View className="flex-row gap-2">
            <Pressable
              className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand"
              onPress={() => router.push('/arrival/new')}>
              <Ionicons color="#ffffff" name="add" size={18} />
              <Text className="font-semibold text-white">Arrivage</Text>
            </Pressable>
            <Pressable
              className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white"
              onPress={() => router.push('/stock/adjust')}>
              <Ionicons color="#334155" name="warning-outline" size={18} />
              <Text className="font-semibold text-slate-700">Ajuster</Text>
            </Pressable>
          </View>
        ) : (
          <View className="rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="text-xs text-slate-500">
              La saisie d&apos;arrivage et les ajustements sont réservés aux gestionnaires et
              administrateurs.
            </Text>
          </View>
        )}

        {/* Historique des arrivages */}
        {canManage ? (
          <Pressable
            className="h-11 flex-row items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3"
            onPress={() => router.push('/arrivals/list')}>
            <View className="flex-row items-center gap-2">
              <Ionicons color="#334155" name="cube-outline" size={18} />
              <Text className="font-semibold text-slate-700">Historique des arrivages</Text>
            </View>
            <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
          </Pressable>
        ) : null}

        {/* Recherche de lots */}
        <View className="flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
          <Ionicons color="#94A3B8" name="search" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="h-11 flex-1 text-base text-slate-900"
            onChangeText={setTerm}
            placeholder="Modèle, fournisseur…"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={term}
          />
        </View>

        <View className="flex-row gap-2">
          {STATUS_FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              selected={status === filter.key}
              onPress={() => setStatus(filter.key)}
            />
          ))}
        </View>

        {/* Modèles : une ligne par modèle, détail des pointures au clic */}
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Modèles · {models.total}
          </Text>
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {models.isPending ? (
              <ActivityIndicator className="py-4" color="#208AEF" />
            ) : models.isError ? (
              <ErrorPanel
                isRetrying={models.isRefetching}
                message="Impossible de charger les modèles."
                onRetry={() => void models.refetch()}
              />
            ) : models.items.length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucun modèle trouvé.</Text>
            ) : (
              models.items.map((model) => (
                <ModelRow
                  expanded={expanded === model.productId}
                  key={model.productId}
                  model={model}
                  onPress={() =>
                    setExpanded((current) => (current === model.productId ? null : model.productId))
                  }
                  status={status}
                />
              ))
            )}
          </View>
          <ListFooter
            fetchNextPage={() => void models.fetchNextPage()}
            hasMore={models.hasMore}
            isFetchingNextPage={models.isFetchingNextPage}
            shown={models.items.length}
            total={models.total}
          />
        </View>

        {/* Mouvements récents */}
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Mouvements récents
          </Text>
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {movements.isPending ? (
              <ActivityIndicator className="py-4" color="#208AEF" />
            ) : movements.isError ? (
              <ErrorPanel
                isRetrying={movements.isRefetching}
                message="Impossible de charger les mouvements."
                onRetry={() => void movements.refetch()}
              />
            ) : (movements.data?.items ?? []).length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucun mouvement.</Text>
            ) : (
              (movements.data?.items ?? []).map((movement) => (
                <MovementRow key={movement.id} movement={movement} />
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
