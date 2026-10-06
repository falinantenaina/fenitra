import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

export interface SelectOption {
  id: string;
  label: string;
}

interface SelectFieldProps {
  placeholder: string;
  title?: string;
  value: string;
  valueLabel?: string;
  options: SelectOption[];
  loading?: boolean;
  compact?: boolean;
  error?: string | null;
  hint?: string | null;
  emptyText?: string;
  onSearch?: (term: string) => void;
  onCreate?: (term: string) => Promise<void>;
  createVerb?: string;
  createPending?: boolean;
  createDisabled?: boolean;
  minCreateLength?: number;
  onRename?: (next: string, current: string) => Promise<void>;
  renameTitle?: string;
  onSelect: (id: string) => void;
}

export function SelectField({
  placeholder,
  title,
  value,
  valueLabel,
  options,
  loading = false,
  compact = false,
  error,
  hint,
  emptyText,
  onSearch,
  onCreate,
  createVerb = 'Créer',
  createPending = false,
  createDisabled = false,
  minCreateLength = 2,
  onRename,
  renameTitle = 'Renommer',
  onSelect,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [renameCurrent, setRenameCurrent] = useState('');
  const [renaming, setRenaming] = useState(false);

  const term = query.trim();
  const lower = term.toLowerCase();
  const filtered = options.filter((option) => option.label.toLowerCase().includes(lower));
  const exactMatch = filtered.some((option) => option.label.trim().toLowerCase() === lower);
  const canCreate =
    onCreate !== undefined &&
    term.length >= minCreateLength &&
    !exactMatch &&
    !createPending &&
    !createDisabled;
  const selectedLabel = options.find((option) => option.id === value)?.label ?? valueLabel ?? '';
  const canRename = onRename !== undefined && selectedLabel !== '';

  const search = (text: string) => {
    setQuery(text);
    onSearch?.(text);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
    onSearch?.('');
  };

  const select = (id: string) => {
    onSelect(id);
    close();
  };

  const create = async () => {
    if (!canCreate || !onCreate) return;
    await onCreate(term);
    close();
  };

  const openRename = () => {
    setRenameCurrent(selectedLabel);
    setRenameText(selectedLabel);
    setRenameOpen(true);
  };

  const closeRename = () => {
    setRenameOpen(false);
    setRenameText('');
    setRenameCurrent('');
  };

  const rename = async () => {
    const next = renameText.trim();
    if (!onRename || !next || next === renameCurrent) return;
    setRenaming(true);
    try {
      await onRename(next, renameCurrent);
      closeRename();
    } finally {
      setRenaming(false);
    }
  };

  const renameDisabled = !renameText.trim() || renameText.trim() === renameCurrent;

  return (
    <View className="gap-1.5">
      <View
        className={`flex-row items-center gap-1 border border-slate-300 bg-white ${
          compact ? 'h-10 px-3' : 'h-11 px-3'
        } ${open ? 'border-brand' : ''}`}>
        <Pressable
          accessibilityLabel={selectedLabel || placeholder}
          accessibilityRole="button"
          className="flex-1 flex-row items-center justify-between gap-2"
          onPress={() => setOpen(true)}>
          <Text
            className={`flex-1 ${compact ? 'text-sm' : 'text-base'} ${
              selectedLabel ? 'text-slate-900' : 'text-slate-400'
            }`}
            numberOfLines={1}>
            {selectedLabel || placeholder}
          </Text>
          <Ionicons color="#64748B" name="chevron-down" size={16} />
        </Pressable>
        {canRename ? (
          <Pressable
            accessibilityLabel={`Renommer ${selectedLabel}`}
            accessibilityRole="button"
            className="h-8 w-7 items-center justify-center"
            onPress={openRename}>
            <Ionicons color="#64748B" name="pencil-outline" size={16} />
          </Pressable>
        ) : null}
      </View>

      {hint ? (
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-xs font-semibold text-emerald-600">{hint}</Text>
          {canRename ? (
            <Pressable accessibilityRole="button" onPress={openRename}>
              <Text className="text-xs font-semibold text-brand">Renommer</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? <Text className="text-xs text-red-600">{error}</Text> : null}

      <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
        <View className="flex-1 items-center justify-center bg-slate-900/50 px-6">
          <View className="w-full gap-3 rounded-2xl bg-white p-5">
            <Text className="text-base font-bold text-slate-900">{title ?? placeholder}</Text>

            <View className="flex-row items-center gap-2">
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
                onChangeText={search}
                placeholder="Rechercher…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={query}
              />
              {query ? (
                <Pressable
                  accessibilityLabel="Effacer la recherche"
                  className="h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white"
                  onPress={() => search('')}>
                  <Ionicons color="#64748B" name="close" size={16} />
                </Pressable>
              ) : null}
            </View>

            {loading ? (
              <ActivityIndicator color="#208AEF" />
            ) : (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={{ maxHeight: 320 }}
                contentContainerStyle={{ gap: 4 }}>
                {filtered.length === 0 ? (
                  <Text className="py-2 text-sm text-slate-500">
                    {emptyText ?? 'Aucune valeur trouvée.'}
                  </Text>
                ) : (
                  filtered.map((option) => {
                    const active = option.id === value;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        className={`flex-row items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${
                          active ? 'border-brand bg-brand/10' : 'border-slate-200 bg-white'
                        }`}
                        key={option.id}
                        onPress={() => select(option.id)}>
                        <Text
                          className={`flex-1 text-sm ${
                            active ? 'font-semibold text-brand' : 'text-slate-700'
                          }`}
                          numberOfLines={1}>
                          {option.label}
                        </Text>
                        {active ? <Ionicons color="#208AEF" name="checkmark" size={16} /> : null}
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            )}

            {canCreate ? (
              <Pressable
                className="flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-brand bg-brand/5 px-3 py-2"
                disabled={createPending}
                onPress={() => void create()}>
                <Ionicons color="#208AEF" name="add" size={15} />
                <Text className="text-sm font-semibold text-brand">
                  {createPending ? 'Création…' : `${createVerb} « ${term} »`}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              className="h-10 items-center justify-center rounded-xl bg-slate-100"
              onPress={close}>
              <Text className="text-sm font-medium text-slate-700">Fermer</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" onRequestClose={closeRename} transparent visible={renameOpen}>
        <View className="flex-1 items-center justify-center bg-slate-900/50 px-6">
          <View className="w-full gap-3 rounded-2xl bg-white p-5">
            <Text className="text-base font-bold text-slate-900">{renameTitle}</Text>
            <TextInput
              autoCorrect={false}
              className="h-11 rounded-xl border border-slate-300 px-4 text-base text-slate-900"
              onChangeText={setRenameText}
              placeholder="Nouveau nom"
              placeholderTextColor="#94A3B8"
              selectionColor="#208AEF"
              value={renameText}
            />
            <View className="mt-1 flex-row justify-end gap-2">
              <Pressable
                accessibilityRole="button"
                className="h-10 items-center justify-center rounded-xl px-4"
                disabled={renaming}
                onPress={closeRename}>
                <Text className="text-sm font-semibold text-slate-600">Annuler</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className={`h-10 min-w-[96px] items-center justify-center rounded-xl px-4 ${
                  renameDisabled || renaming ? 'bg-slate-300' : 'bg-brand'
                }`}
                disabled={renameDisabled || renaming}
                onPress={() => void rename()}>
                {renaming ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Renommer</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
