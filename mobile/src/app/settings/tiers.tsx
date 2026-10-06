import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { ErrorPanel } from '@/components/error-panel';
import { FieldError } from '@/components/field';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { useCreateParty, usePartyList, useUpdateParty } from '@/lib/queries';
import {
  buildPartyPayload,
  buildPartyUpdatePayload,
  partyFormSchema,
  type PartyFormValues,
} from '@/lib/settings';
import type { Party, PartyKind } from '@/lib/types';
import { useAuth } from '@/store/auth';

type Segment = { kind: PartyKind; label: string };

const SEGMENTS: Segment[] = [
  { kind: 'suppliers', label: 'Fournisseurs' },
  { kind: 'customers', label: 'Clients' },
  { kind: 'online-sellers', label: 'Vendeurs' },
];

const KIND_LABEL: Record<PartyKind, string> = {
  suppliers: 'Fournisseur',
  customers: 'Client',
  'online-sellers': 'Vendeur',
};

const inputClass =
  'h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900';

/* ════════════ Formulaire tiers ════════════ */

function PartyForm({
  kind,
  party,
  onDone,
}: {
  kind: PartyKind;
  party: Party | null;
  onDone: () => void;
}) {
  const createParty = useCreateParty();
  const updateParty = useUpdateParty();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PartyFormValues>({
    resolver: zodResolver(partyFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      name: party?.name ?? '',
      phone: party?.phone ?? '',
      address: party?.address ?? '',
      notes: party?.notes ?? '',
    },
  });

  const pending = createParty.isPending || updateParty.isPending;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (party) {
        await updateParty.mutateAsync({
          kind,
          id: party.id,
          body: buildPartyUpdatePayload(values),
        });
      } else {
        await createParty.mutateAsync({ kind, body: buildPartyPayload(values) });
      }
      onDone();
      toast.success(
        `${KIND_LABEL[kind]} ${party ? 'modifié' : 'créé'}`,
        values.name,
      );
    } catch (error) {
      toast.error('Tiers refusé', apiMessage(error));
    }
  });

  const toggleActive = async () => {
    if (!party) return;
    try {
      await updateParty.mutateAsync({
        kind,
        id: party.id,
        body: { active: !party.active },
      });
    } catch (error) {
      toast.error('Tiers refusé', apiMessage(error));
    }
  };

  return (
    <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
        {party ? 'Modifier le tiers' : 'Nouveau tiers'}
      </Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nom"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.name?.message} />
      <Controller
        control={control}
        name="phone"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            keyboardType="phone-pad"
            onChangeText={field.onChange}
            placeholder="Téléphone (optionnel)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value ?? ''}
          />
        )}
      />
      <FieldError message={errors.phone?.message} />
      <Controller
        control={control}
        name="address"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Adresse (optionnel)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value ?? ''}
          />
        )}
      />
      <FieldError message={errors.address?.message} />
      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <TextInput
            className={`${inputClass} py-2`}
            multiline
            onChangeText={field.onChange}
            placeholder="Notes (optionnel)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value ?? ''}
          />
        )}
      />
      <FieldError message={errors.notes?.message} />
      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            pending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={pending}
          onPress={() => void onSubmit()}>
          {pending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">{party ? 'Enregistrer' : 'Créer'}</Text>
          )}
        </Pressable>
        {party ? (
          <Pressable
            className={`h-10 items-center justify-center rounded-xl px-4 ${
              party.active ? 'bg-red-50' : 'bg-emerald-50'
            }`}
            disabled={updateParty.isPending}
            onPress={() => void toggleActive()}>
            <Text className={`font-medium ${party.active ? 'text-red-600' : 'text-emerald-700'}`}>
              {party.active ? 'Désactiver' : 'Réactiver'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
          onPress={onDone}>
          <Text className="font-medium text-slate-600">Fermer</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ════════════ Écran ════════════ */

export default function PartiesSettingsScreen() {
  const role = useAuth((state) => state.user?.role);
  const canManage = role === 'ADMIN' || role === 'MANAGER';

  const [kind, setKind] = useState<PartyKind>('suppliers');
  const [term, setTerm] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const parties = usePartyList(kind, term);
  const items = parties.data?.items ?? [];
  const selected = items.find((p) => p.id === selectedId) ?? null;

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled">
      <ScrollView
        horizontal
        contentContainerStyle={{ gap: 8 }}
        showsHorizontalScrollIndicator={false}>
        {SEGMENTS.map((segment) => (
          <Chip
            key={segment.kind}
            label={segment.label}
            selected={kind === segment.kind}
            onPress={() => {
              setKind(segment.kind);
              setSelectedId(null);
              setShowNew(false);
            }}
          />
        ))}
      </ScrollView>

      <TextInput
        className={inputClass}
        onChangeText={(value) => {
          setTerm(value);
          setSelectedId(null);
        }}
        placeholder="Rechercher par nom…"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={term}
      />

      {canManage ? (
        <View className="flex-row gap-2">
          <Pressable
            className={`h-10 flex-1 items-center justify-center rounded-xl ${
              showNew ? 'bg-slate-100' : 'bg-brand'
            }`}
            onPress={() => {
              setSelectedId(null);
              setShowNew((v) => !v);
            }}>
            <Text className={`font-semibold ${showNew ? 'text-slate-600' : 'text-white'}`}>
              {showNew ? 'Fermer' : 'Nouveau tiers'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showNew && canManage ? (
        <PartyForm kind={kind} party={null} onDone={() => setShowNew(false)} />
      ) : null}
      {selected && canManage ? (
        <PartyForm key={selected.id} kind={kind} party={selected} onDone={() => setSelectedId(null)} />
      ) : null}

      <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {parties.isPending ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : parties.isError ? (
          <ErrorPanel
            isRetrying={parties.isRefetching}
            message="Impossible de charger les tiers."
            onRetry={() => void parties.refetch()}
          />
        ) : items.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun tiers.</Text>
        ) : (
          items.map((party) => {
            const active = party.id === selectedId;
            return (
              <Pressable
                key={party.id}
                className={`flex-row items-center justify-between border-b border-slate-100 px-3 py-3 last:border-b-0 ${
                  active ? 'bg-sky-50' : ''
                }`}
                onPress={() => {
                  setShowNew(false);
                  setSelectedId(active ? null : party.id);
                }}>
                <View className="flex-1 pr-2">
                  <Text className="text-sm font-semibold text-slate-800" numberOfLines={1}>
                    {party.name}
                  </Text>
                  <Text className="text-xs text-slate-400">
                    {party.phone ?? party.address ?? '—'}
                  </Text>
                </View>
                {!party.active ? (
                  <Text className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    Inactif
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
