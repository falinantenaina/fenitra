import { Ionicons } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { parseSizeExpression } from "@/components/size-picker";
import { SelectField } from "@/components/select-field";
import { toast } from "@/components/toast";
import { apiMessage } from "@/lib/api";
import {
  arrivalFormSchema,
  arrivalToForm,
  buildArrivalPayload,
  buildUpdateArrivalPayload,
  cartonTotals,
  cartonsToVentilate,
  draftHasContent,
  formTotals,
  listedQuantity,
  listedSizes,
  todayISO,
  unitCostOf,
  type ArrivalFormValues,
  type CartonDraft,
} from "@/lib/arrival";
import { formatDateTime, formatMoney } from "@/lib/format";
import {
  useArrival,
  useCreateArrival,
  useCreateParty,
  useCreateProduct,
  useCreateSize,
  usePaymentMethods,
  useProductSearch,
  useProducts,
  useSizeList,
  useSuppliers,
  useUpdateArrival,
} from "@/lib/queries";
import type { ProductListItem, SizeListItem } from "@/lib/types";
import { useArrivalDraft } from "@/store/arrival-draft";

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`rounded-full border px-3 py-1.5 ${
        active ? "border-brand bg-brand" : "border-slate-200 bg-white"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-sm ${active ? "font-semibold text-white" : "text-slate-600"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sizeLabel = (size: SizeListItem): string => size.label || `${size.value}`;

/** Ligne de pointure listée : quantité éditable + retrait. */
function SizeRow({
  size,
  quantity,
  onChange,
  onRemove,
}: {
  size: SizeListItem;
  quantity: number;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  // Brouillon local du champ : effacer pour retaper (« 1 » → « 2 ») ne doit
  // jamais retirer la ligne — seule une quantité réellement tapée est retenue.
  const [text, setText] = useState(quantity ? String(quantity) : "");

  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <Text className="w-12 text-sm font-bold text-slate-800">
        {sizeLabel(size)}
      </Text>
      <TextInput
        className="h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm text-slate-900"
        keyboardType="numeric"
        onChangeText={(raw) => {
          const digits = raw.replace(/[^0-9]/g, "");
          setText(digits);
          // Champ vidé en cours de saisie : on attend la nouvelle valeur.
          if (digits !== "") onChange(Number(digits));
        }}
        onEndEditing={() => setText(quantity ? String(quantity) : "")}
        placeholder="0"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={text}
      />
      <Text className="text-xs text-slate-400">paire(s)</Text>
      <Pressable
        accessibilityLabel={`Retirer la pointure ${sizeLabel(size)}`}
        className="ml-auto h-7 w-7 items-center justify-center rounded-md bg-red-50"
        onPress={onRemove}
      >
        <Ionicons color="#DC2626" name="close" size={14} />
      </Pressable>
    </View>
  );
}

interface CartonCardProps {
  index: number;
  carton: CartonDraft;
  products: ProductListItem[] | undefined;
  productsPending: boolean;
  onPatch: (patch: Partial<CartonDraft>) => void;
  onRemove: () => void;
  removable: boolean;
}

function CartonCard({
  index,
  carton,
  products,
  productsPending,
  onPatch,
  onRemove,
  removable,
}: CartonCardProps) {
  // Recherche de modèle avec création à la volée.
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdModel, setCreatedModel] = useState<string | null>(null);
  const results = useProductSearch(debounced);
  const createProduct = useCreateProduct();

  // Dictionnaire des pointures — le serveur créera les variantes au besoin.
  const sizes = useSizeList();
  const createSize = useCreateSize();

  // Saisie des pointures de CE carton (facultatif) : `43`, `36,40`, `36-40`.
  const [sizeExpr, setSizeExpr] = useState("");
  const [addingSize, setAddingSize] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const term = debounced.trim();
  const searching = term.length > 0;
  const selected =
    (products ?? []).find((p) => p.id === carton.activeProductId) ??
    (results.data?.items ?? []).find((p) => p.id === carton.activeProductId);
  const shown = searching ? (results.data?.items ?? []) : (products ?? []);

  const createModel = async (name: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const product = await createProduct.mutateAsync({ name });
      onPatch({ activeProductId: product.id });
      setCreatedModel(product.name);
      setSearch("");
      setDebounced("");
    } catch (error) {
      toast.error("Création refusée", apiMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const totals = cartonTotals(carton);
  const unitCost = unitCostOf(carton);
  const listed = listedQuantity(carton);
  const rows = listedSizes(carton);
  const dictionary = sizes.data?.items ?? [];
  const sumComplete = listed > 0 && listed === carton.quantity;

  // Libellés des pointures listées (dictionnaire `GET /sizes`).
  const sizeById = new Map<string, SizeListItem>();
  dictionary.forEach((size) => sizeById.set(size.id, size));

  const setSizeQuantity = (sizeId: string, quantity: number) =>
    onPatch({ sizes: { ...carton.sizes, [sizeId]: quantity } });

  /**
   * Ajoute des pointures **à ce carton uniquement** : `43`, `36,40`, `36-40`.
   * Une valeur inexistante est créée dans le dictionnaire (requis par le
   * serveur), le reste du modèle n'est pas modifié.
   */
  const addSizeLines = async () => {
    const values = parseSizeExpression(sizeExpr);
    if (values.length === 0) {
      toast.error(
        "Pointure invalide",
        "Ex. 43, 36-40 ou 36,40 (valeurs 1 à 100).",
      );
      return;
    }
    setAddingSize(true);
    try {
      const known = new Map(dictionary.map((size) => [size.value, size]));
      for (const value of values) {
        if (known.has(value)) continue;
        try {
          known.set(
            value,
            await createSize.mutateAsync({ value, label: `${value}` }),
          );
        } catch (error) {
          // Doublon concurrent : la pointure existe déjà côté serveur.
          const fresh = await sizes.refetch();
          const size = (fresh.data?.items ?? []).find(
            (candidate) => candidate.value === value,
          );
          if (!size) throw error;
          known.set(value, size);
        }
      }

      const next = { ...carton.sizes };
      values.forEach((value) => {
        const size = known.get(value);
        // Ligne absente ou retirée (quantité 0) : (ré)activée à 1.
        if (size && !(next[size.id] > 0)) next[size.id] = 1;
      });
      onPatch({ sizes: next });
      setSizeExpr("");
    } catch (error) {
      toast.error("Pointure refusée", apiMessage(error));
    } finally {
      setAddingSize(false);
    }
  };

  return (
    <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-slate-900">
          Carton {index + 1}
        </Text>
        <View className="flex-row items-center gap-3">
          <Text className="text-xs text-slate-400">
            {totals.quantity} p. · {formatMoney(totals.cost)}
          </Text>
          {removable ? (
            <Pressable
              accessibilityLabel={`Supprimer le carton ${index + 1}`}
              className="h-7 w-7 items-center justify-center rounded-md bg-red-50"
              onPress={onRemove}
            >
              <Ionicons color="#DC2626" name="trash-outline" size={15} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Étape 1 — le modèle */}
      <View>
        <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          1 · Modèle
        </Text>
        <SelectField
          compact
          createPending={creating}
          createDisabled={searching && results.isPending}
          emptyText={
            searching ? "Aucun modèle trouvé." : "Aucun modèle actif — créez-en un d'abord."
          }
          hint={createdModel ? `Modèle « ${createdModel} » créé et sélectionné.` : null}
          loading={productsPending || (searching && results.isPending)}
          options={shown.map((product) => ({ id: product.id, label: product.name }))}
          placeholder="Rechercher ou créer un modèle…"
          title="Modèle"
          value={carton.activeProductId ?? ""}
          valueLabel={selected?.name}
          onCreate={createModel}
          onSearch={(text) => {
            setSearch(text);
            setCreatedModel(null);
          }}
          onSelect={(id) => {
            onPatch({ activeProductId: id });
            setSearch("");
            setDebounced("");
            setCreatedModel(null);
          }}
        />
      </View>

      {/* Étape 2 — quantité et montant du carton */}
      <View className="gap-3">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          2 · Quantité et montant
        </Text>
        <View className="gap-1.5">
          <Text className="text-xs font-semibold text-slate-500">
            Quantités
          </Text>
          <TextInput
            className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
            keyboardType="numeric"
            onChangeText={(raw) =>
              onPatch({ quantity: Number(raw.replace(/[^0-9]/g, "")) || 0 })
            }
            placeholder="0"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={carton.quantity ? String(carton.quantity) : ""}
          />
        </View>

        <View className="gap-1.5">
          <Text className="text-xs font-semibold text-slate-500">
            Montant du carton (Ar)
          </Text>
          <TextInput
            className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
            keyboardType="numeric"
            onChangeText={(raw) =>
              onPatch({ amount: Number(raw.replace(/[^0-9]/g, "")) || 0 })
            }
            placeholder="0"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={carton.amount ? String(carton.amount) : ""}
          />
          <Text className="text-xs text-slate-400">
            Prix d&apos;achat de la paire :{" "}
            {unitCost > 0 ? `${formatMoney(unitCost)} / paire` : "—"} (montant ÷
            quantité, imposé partout).
          </Text>
        </View>

        <View className="gap-1.5">
          <Text className="text-xs font-semibold text-slate-500">
            Prix de vente par paire (facultatif)
          </Text>
          <TextInput
            className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
            keyboardType="numeric"
            onChangeText={(raw) =>
              onPatch({ sellingPrice: Number(raw.replace(/[^0-9]/g, "")) || 0 })
            }
            placeholder="0"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={carton.sellingPrice ? String(carton.sellingPrice) : ""}
          />
          <Text className="text-xs text-slate-400">
            Appliqué aux pointures créées à l&apos;arrivage — modifiable ensuite
            depuis Stock.
          </Text>
        </View>
      </View>

      {/* Étape 3 — pointures, quand on les connaît */}
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          3 · Pointures (facultatif)
        </Text>

        <View className="flex-row items-center gap-2">
          <TextInput
            className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
            keyboardType="numbers-and-punctuation"
            onChangeText={setSizeExpr}
            onSubmitEditing={() => void addSizeLines()}
            placeholder="Ex. 43, 36-40 ou 36,40"
            placeholderTextColor="#94A3B8"
            returnKeyType="done"
            selectionColor="#208AEF"
            value={sizeExpr}
          />
          <Pressable
            accessibilityLabel="Ajouter les pointures saisies"
            className="h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white"
            disabled={!sizeExpr.trim() || addingSize}
            onPress={() => void addSizeLines()}
          >
            {addingSize ? (
              <ActivityIndicator color="#208AEF" />
            ) : (
              <Ionicons
                color={sizeExpr.trim() ? "#208AEF" : "#CBD5E1"}
                name="add"
                size={18}
              />
            )}
          </Pressable>
        </View>

        {rows.length > 0 ? (
          <View className="gap-2">
            {rows.map((row) => {
              const size = sizeById.get(row.sizeId);
              if (!size) return null;
              return (
                <SizeRow
                  key={row.sizeId}
                  onChange={(quantity) => setSizeQuantity(row.sizeId, quantity)}
                  onRemove={() => setSizeQuantity(row.sizeId, 0)}
                  quantity={row.quantity}
                  size={size}
                />
              );
            })}
          </View>
        ) : null}

        {rows.length > 0 ? (
          <Text
            className={`text-xs ${sumComplete ? "text-emerald-600" : "text-red-600"}`}
          >
            Pointures : {listed} / {carton.quantity} paires
            {sumComplete
              ? " — somme exacte."
              : " — complétez pour égaler la quantité du carton."}
          </Text>
        ) : null}
      </View>

      <TextInput
        className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
        onChangeText={(notes) => onPatch({ notes })}
        placeholder="Notes du carton (facultatif)"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={carton.notes ?? ""}
      />
    </View>
  );
}

/** Premier message d'erreur (Zod / superRefine) parmi les champs. */
function firstErrorMessage(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  for (const value of Object.values(record)) {
    const found = firstErrorMessage(value);
    if (found) return found;
  }
  return null;
}

const emptyCarton = (productId = ""): CartonDraft => ({
  reference: "",
  activeProductId: productId,
  quantity: 0,
  amount: 0,
  sizes: {},
});

const emptyForm = (): ArrivalFormValues => ({
  supplierId: "",
  date: todayISO(),
  notes: "",
  cartons: [emptyCarton()],
  payment: { enabled: false, amount: 0, method: undefined },
});

export default function NewArrivalScreen() {
  return <ArrivalFormScreen />;
}

/** Saisie d'un arrivage : création (`editId` nul) ou modification (`PATCH`). */
export function ArrivalFormScreen({ editId = null }: { editId?: string | null }) {
  const suppliers = useSuppliers();
  const products = useProducts();
  const sizes = useSizeList();
  const methods = usePaymentMethods();
  const createArrival = useCreateArrival();
  const updateArrival = useUpdateArrival();
  const createParty = useCreateParty();
  const arrival = useArrival(editId);
  const editing = Boolean(editId);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [supplierNotice, setSupplierNotice] = useState<string | null>(null);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  /** Récapitulatif à confirmer avant l'envoi, voir `onReview`. */
  const [review, setReview] = useState<ArrivalFormValues | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<{
    values: ArrivalFormValues;
    savedAt: number | null;
  } | null>(null);
  /** L'arrivage à modifier est-il déjà chargé dans le formulaire ? */
  const [loaded, setLoaded] = useState(false);

  const {
    control,
    getValues,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ArrivalFormValues>({
    resolver: zodResolver(arrivalFormSchema),
    defaultValues: emptyForm(),
    mode: "onSubmit",
  });

  const { append, remove, fields } = useFieldArray({
    control,
    name: "cartons",
  });

  // Brouillon : proposé (jamais imposé) une fois le stockage hydraté.
  // En modification, la saisie vient de l'arrivage — aucun brouillon.
  useEffect(() => {
    if (editId) return;
    const propose = () => {
      const saved = useArrivalDraft.getState().values;
      if (saved && draftHasContent(saved)) {
        setDraftPrompt({ values: saved, savedAt: useArrivalDraft.getState().savedAt });
      }
    };
    if (useArrivalDraft.persist.hasHydrated()) {
      propose();
      return;
    }
    return useArrivalDraft.persist.onFinishHydration(() => propose());
  }, [editId]);

  useEffect(() => {
    if (editId) return;
    const subscription = watch((formValues) => {
      if (!formValues) return;
      // Saisie vide : rien à reprendre au prochain lancement.
      if (draftHasContent(formValues as ArrivalFormValues)) {
        useArrivalDraft.getState().save(formValues as ArrivalFormValues);
      } else {
        useArrivalDraft.getState().clear();
      }
    });
    return () => subscription.unsubscribe();
  }, [watch, editId]);

  // Édition : le formulaire est prérempli depuis l'arrivage enregistré.
  useEffect(() => {
    if (!editId || !arrival.data || loaded) return;
    reset(arrivalToForm(arrival.data));
    setLoaded(true);
  }, [editId, arrival.data, loaded, reset]);

  const values = watch();
  const supplierId = values.supplierId;

  // Pré-remplissage : premier fournisseur / premier modèle actif.
  useEffect(() => {
    if (!supplierId && suppliers.data?.length) {
      setValue("supplierId", suppliers.data[0]!.id);
    }
  }, [supplierId, suppliers.data, setValue]);

  useEffect(() => {
    const first = products.data?.[0];
    if (!first) return;
    getValues("cartons").forEach((carton, index) => {
      if (!carton.activeProductId) {
        setValue(
          `cartons.${index}.activeProductId` as FieldPath<ArrivalFormValues>,
          first.id as never,
        );
      }
    });
  }, [products.data, getValues, setValue]);

  const totals = formTotals(values);
  const formError = firstErrorMessage(errors) ?? submitError;
  const pending = isSubmitting || createArrival.isPending || updateArrival.isPending;

  // Libellés lisibles du récapitulatif (modèle, pointure, fournisseur).
  const productNames = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const sizeLabels = new Map(
    (sizes.data?.items ?? []).map((s) => [s.id, s.label || String(s.value)]),
  );
  const supplierNames = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]));

  const patchCarton = (index: number, patch: Partial<CartonDraft>) => {
    (Object.keys(patch) as (keyof CartonDraft)[]).forEach((key) => {
      setValue(
        `cartons.${index}.${key}` as unknown as FieldPath<ArrivalFormValues>,
        patch[key] as never,
        { shouldDirty: true },
      );
    });
  };

  const togglePayment = () => {
    const next = !values.payment.enabled;
    setValue("payment.enabled", next);
    if (next) setValue("payment.amount", totals.cost);
  };

  const supplierList = suppliers.data ?? [];

  const createSupplier = async (name: string) => {
    if (creatingSupplier) return;
    setCreatingSupplier(true);
    try {
      const supplier = await createParty.mutateAsync({
        kind: "suppliers",
        body: { name },
      });
      setValue("supplierId", supplier.id);
      setSupplierNotice(name);
    } catch (error) {
      toast.error("Création refusée", apiMessage(error));
    } finally {
      setCreatingSupplier(false);
    }
  };

  /** Valide puis ouvre le récapitulatif — rien n'est envoyé avant confirmation. */
  const onReview = handleSubmit((formValues) => {
    setSubmitError(null);
    setReview(formValues);
  });

  const confirmArrival = async (formValues: ArrivalFormValues) => {
    if (createArrival.isPending || updateArrival.isPending) return;
    setSubmitError(null);
    try {
      if (editId) {
        const updated = await updateArrival.mutateAsync({
          id: editId,
          body: buildUpdateArrivalPayload(formValues),
        });
        setReview(null);
        toast.success(
          "Arrivage modifié",
          `${updated.reference} — ${updated.totalQty} pièce(s), ${formatMoney(updated.totalCost)}`,
        );
        router.back();
        return;
      }

      const created = await createArrival.mutateAsync(buildArrivalPayload(formValues));
      useArrivalDraft.getState().clear();
      const toVentilate = cartonsToVentilate(formValues);
      setReview(null);
      toast.success(
        "Arrivage enregistré",
        `${created.reference} — ${created.totalQty} pièce(s), ${formatMoney(created.totalCost)}` +
          (toVentilate > 0 ? ` · ${toVentilate} carton(s) à ventiler` : ""),
      );
      router.back();
    } catch (error) {
      // On reste sur le récapitulatif : l'erreur s'affiche à côté du bouton.
      setSubmitError(apiMessage(error));
    }
  };

  // Modification : l'arrivage doit d'abord être lisible (ou rechargé).
  if (editing && (arrival.isPending || !loaded)) {
    return <ActivityIndicator className="mt-10 self-center" color="#208AEF" />;
  }

  if (editing && (arrival.isError || !arrival.data)) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-slate-50 px-6">
        <Ionicons color="#CBD5E1" name="alert-circle-outline" size={32} />
        <Text className="text-sm text-slate-500">Impossible de charger cet arrivage.</Text>
        <Pressable
          accessibilityRole="button"
          className="rounded-lg bg-slate-100 px-4 py-2"
          disabled={arrival.isRefetching}
          onPress={() => void arrival.refetch()}>
          <Text className="text-sm font-medium text-slate-700">Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {formError ? (
          <View className="rounded-xl bg-red-50 px-3 py-2.5">
            <Text className="text-sm text-red-600">{formError}</Text>
          </View>
        ) : null}

        {editing ? (
          <View className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <Text className="text-xs leading-5 text-slate-500">
              {`Modification de l'arrivage — refusée si le stock a déjà bougé (vente, ajustement, retour), si la dette a reçu un versement ou si l'arrivage est financé.`}
            </Text>
          </View>
        ) : null}

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fournisseur
            </Text>
            <SelectField
              compact
              createPending={creatingSupplier}
              emptyText={
                supplierList.length === 0 ? "Aucun fournisseur actif." : "Aucun fournisseur trouvé."
              }
              error={errors.supplierId ? errors.supplierId.message : null}
              hint={
                supplierNotice ? `Fournisseur « ${supplierNotice} » créé et sélectionné.` : null
              }
              loading={suppliers.isPending}
              options={supplierList.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
              placeholder="Rechercher ou créer un fournisseur…"
              title="Fournisseur"
              value={supplierId}
              valueLabel={supplierList.find((supplier) => supplier.id === supplierId)?.name}
              onCreate={createSupplier}
              onSelect={(id) => {
                setValue("supplierId", id);
                setSupplierNotice(null);
              }}
            />
          </View>

          <View className="flex-row items-end gap-3">
            <View className="flex-1 gap-1.5">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Date (AAAA-MM-JJ)
              </Text>
              <TextInput
                autoCapitalize="none"
                className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
                keyboardType="numbers-and-punctuation"
                onChangeText={(date) => setValue("date", date.trim())}
                placeholder="2026-10-02"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={values.date}
              />
            </View>
            <Pressable
              className="h-11 items-center justify-center rounded-xl bg-slate-100 px-4"
              onPress={() => setValue("date", todayISO())}
            >
              <Text className="text-sm font-medium text-slate-700">
                Aujourd&apos;hui
              </Text>
            </Pressable>
          </View>
          {errors.date ? (
            <Text className="text-xs text-red-600">{errors.date.message}</Text>
          ) : null}

          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </Text>
            <TextInput
              className="min-h-16 rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900"
              multiline
              onChangeText={(notes) => setValue("notes", notes)}
              placeholder="Conteneur, référence fournisseur…"
              placeholderTextColor="#94A3B8"
              selectionColor="#208AEF"
              value={values.notes ?? ""}
            />
          </View>
        </View>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cartons — modèle, quantité, montant (+ pointures si connues)
          </Text>

          {fields.map((field, index) => {
            const carton = values.cartons[index];
            if (!carton) return null;
            return (
              <CartonCard
                carton={carton}
                index={index}
                key={field.id}
                onPatch={(patch) => patchCarton(index, patch)}
                onRemove={() => remove(index)}
                products={products.data}
                productsPending={products.isPending}
                removable={fields.length > 1}
              />
            );
          })}

          <Pressable
            className="h-11 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-brand bg-brand/5"
            onPress={() => append(emptyCarton(products.data?.[0]?.id ?? ""))}
          >
            <Ionicons color="#208AEF" name="add" size={18} />
            <Text className="font-semibold text-brand">Ajouter un carton</Text>
          </Pressable>
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <Pressable
            className="flex-row items-center justify-between"
            onPress={togglePayment}
          >
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-slate-900">
                Réglé au fournisseur
              </Text>
              <Text className="text-xs text-slate-500">
                Payé en totalité ou en partie — le reste reste dû au fournisseur
              </Text>
            </View>
            <Ionicons
              color={values.payment.enabled ? "#16A34A" : "#CBD5E1"}
              name={
                values.payment.enabled ? "checkbox-outline" : "square-outline"
              }
              size={24}
            />
          </Pressable>

          {values.payment.enabled ? (
            <View className="gap-3 border-t border-slate-100 pt-3">
              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Montant réglé (Ar)
                </Text>
                <TextInput
                  className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
                  keyboardType="numeric"
                  onChangeText={(raw) =>
                    setValue(
                      "payment.amount",
                      Number(raw.replace(/[^0-9]/g, "")) || 0,
                    )
                  }
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  selectionColor="#208AEF"
                  value={
                    values.payment.amount ? String(values.payment.amount) : ""
                  }
                />
                <Text className="text-xs text-slate-400">
                  Total de l&apos;arrivage : {formatMoney(totals.cost)} — solde
                  fournisseur :{" "}
                  {formatMoney(
                    Math.max(0, totals.cost - values.payment.amount),
                  )}
                  {values.payment.amount === 0
                    ? " (tout reste dû : dette fournisseur ouverte)"
                    : ""}
                </Text>
                <Pressable
                  className="self-start rounded-lg bg-brand/10 px-3 py-1.5"
                  onPress={() => setValue("payment.amount", totals.cost)}
                >
                  <Text className="text-sm font-medium text-brand">
                    Payer tout ({formatMoney(totals.cost)})
                  </Text>
                </Pressable>
              </View>

              {/* Rien de réglé (0 Ar) : aucun mode de paiement à choisir. */}
              {values.payment.amount > 0 ? (
                <View className="gap-1.5">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mode de paiement
                  </Text>
                  <ScrollView
                    contentContainerStyle={{ gap: 8 }}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {(methods.data ?? []).map((method) => (
                      <Chip
                        active={values.payment.method === method.name}
                        key={method.id}
                        label={method.name}
                        onPress={() =>
                          setValue(
                            "payment.method",
                            values.payment.method === method.name
                              ? undefined
                              : method.name,
                          )
                        }
                      />
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {errors.payment?.amount ? (
                <Text className="text-xs text-red-600">
                  {errors.payment.amount.message}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View className="gap-3 border-t border-slate-200 bg-white px-4 py-3">
        {formError ? (
          <View className="rounded-xl bg-red-50 px-3 py-2">
            <Text className="text-xs leading-5 text-red-600">{formError}</Text>
          </View>
        ) : null}
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-slate-500">
            {`${totals.quantity} pièce(s) · ${values.cartons.length} carton(s)`}
          </Text>
          <Text className="text-lg font-bold text-slate-900">
            {formatMoney(totals.cost)}
          </Text>
        </View>
        <Pressable
          className={`h-12 items-center justify-center rounded-xl ${
            pending ? "bg-slate-400" : "bg-brand"
          }`}
          disabled={pending}
          onPress={() => void onReview()}
        >
          {pending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-white">
              {editing
                ? "Enregistrer les modifications"
                : "Enregistrer l'arrivage"}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Brouillon précédent : repris ou abandonné, jamais imposé. */}
      <Modal
        animationType="fade"
        onRequestClose={() => setDraftPrompt(null)}
        transparent
        visible={draftPrompt !== null}
      >
        {draftPrompt ? (
          <View className="flex-1 justify-center bg-black/50 px-6">
            <View className="gap-3 rounded-2xl bg-white p-5">
              <Text className="text-base font-semibold text-slate-900">
                Reprendre le brouillon ?
              </Text>
              <View className="gap-1">
                <Text className="text-sm text-slate-500">
                  {`${draftPrompt.values.cartons.length} carton(s) · ${formTotals(draftPrompt.values).quantity} pièce(s) · ${formatMoney(formTotals(draftPrompt.values).cost)}`}
                </Text>
                {draftPrompt.savedAt ? (
                  <Text className="text-xs text-slate-400">
                    {`Dernière frappe : ${formatDateTime(new Date(draftPrompt.savedAt).toISOString())}`}
                  </Text>
                ) : null}
              </View>
              <Pressable
                className="h-11 items-center justify-center rounded-xl bg-brand"
                onPress={() => {
                  reset(draftPrompt.values);
                  setDraftPrompt(null);
                }}
              >
                <Text className="text-sm font-semibold text-white">Reprendre</Text>
              </Pressable>
              <Pressable
                className="h-11 items-center justify-center rounded-xl bg-slate-100"
                onPress={() => {
                  useArrivalDraft.getState().clear();
                  reset(emptyForm());
                  setDraftPrompt(null);
                }}
              >
                <Text className="text-sm font-semibold text-slate-700">Repartir de zéro</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Récapitulatif : le serveur n'est touché qu'après « Confirmer ». */}
      <Modal
        animationType="fade"
        onRequestClose={() => setReview(null)}
        transparent
        visible={review !== null}
      >
        {review ? (
          <View className="flex-1 justify-center bg-black/50 px-5">
            <View className="gap-3 rounded-2xl bg-white p-5">
              <Text className="text-base font-semibold text-slate-900">
                {editing
                  ? "Vérifier avant de modifier"
                  : "Vérifier avant d'enregistrer"}
              </Text>
              <ScrollView className="max-h-72 gap-2" nestedScrollEnabled>
                {review.cartons.map((carton, index) => {
                  const lines = listedSizes(carton);
                  return (
                    <View
                      key={index}
                      className="gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <Text className="text-sm font-semibold text-slate-900">
                        {productNames.get(carton.activeProductId) ?? carton.activeProductId}
                      </Text>
                      <Text className="text-xs text-slate-500">
                        {`${carton.quantity} paire(s) · ${formatMoney(carton.amount)} · prix unitaire ${formatMoney(unitCostOf(carton))}`}
                      </Text>
                      <Text className="text-xs text-slate-500">
                        {lines.length === 0
                          ? "Pointures : à ventiler après réception"
                          : `Pointures : ${lines
                              .map((line) => `${sizeLabels.get(line.sizeId) ?? "?"} ×${line.quantity}`)
                              .join(", ")}`}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
              <View className="gap-1 rounded-xl bg-slate-50 p-3">
                <View className="flex-row justify-between">
                  <Text className="text-sm text-slate-500">Total</Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMoney(formTotals(review).cost)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-slate-500">Réglé</Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMoney(review.payment.enabled ? review.payment.amount : 0)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-sm text-slate-500">Reste dû au fournisseur</Text>
                  <Text className="text-sm font-semibold text-slate-900">
                    {formatMoney(
                      formTotals(review).cost -
                        (review.payment.enabled ? review.payment.amount : 0),
                    )}
                  </Text>
                </View>
                <Text className="text-xs text-slate-400">
                  {`${review.date} · ${supplierNames.get(review.supplierId) ?? ""}`}
                </Text>
              </View>
              {formError ? (
                <Text className="text-xs leading-5 text-red-600">{formError}</Text>
              ) : null}
              <View className="flex-row gap-2">
                <Pressable
                  className="h-11 flex-1 items-center justify-center rounded-xl bg-slate-100"
                  disabled={pending}
                  onPress={() => setReview(null)}
                >
                  <Text className="text-sm font-semibold text-slate-700">Retour</Text>
                </Pressable>
                <Pressable
                  className={`h-11 flex-1 items-center justify-center rounded-xl ${
                    pending ? "bg-slate-400" : "bg-brand"
                  }`}
                  disabled={pending}
                  onPress={() => void confirmArrival(review)}
                >
                  {pending ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="text-sm font-semibold text-white">Confirmer</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </KeyboardAvoidingView>
  );
}
