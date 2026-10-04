import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

/**
 * Bloc « annuler » repliable : bouton rouge → saisie du motif (obligatoire,
 * 3 caractères minimum) → confirmation. Le parent démonte le composant quand
 * l'entité est déjà annulée.
 */
export function CancelPanel({
  label,
  hint,
  isPending = false,
  onConfirm,
}: {
  label: string;
  hint: string;
  isPending?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const ready = reason.trim().length >= 3 && !isPending;

  if (!open) {
    return (
      <Pressable
        className="h-11 flex-row items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50"
        onPress={() => setOpen(true)}>
        <Ionicons color="#DC2626" name="close-circle-outline" size={18} />
        <Text className="font-semibold text-red-600">{label}</Text>
      </Pressable>
    );
  }

  return (
    <View className="gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <Text className="text-xs leading-4 text-red-700">{hint}</Text>
      <TextInput
        className="min-h-[44px] rounded-xl border border-red-200 bg-white px-3 py-2 text-base text-slate-900"
        multiline
        onChangeText={setReason}
        placeholder="Motif d'annulation (3 caractères min.)"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={reason}
      />
      <View className="flex-row gap-2">
        <Pressable
          className="h-10 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white"
          disabled={isPending}
          onPress={() => {
            setOpen(false);
            setReason('');
          }}>
          <Text className="font-semibold text-slate-600">Retour</Text>
        </Pressable>
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            ready ? 'bg-red-600' : 'bg-slate-300'
          }`}
          disabled={!ready}
          onPress={() => {
            if (!ready) return;
            onConfirm(reason.trim());
          }}>
          {isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Confirmer</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
