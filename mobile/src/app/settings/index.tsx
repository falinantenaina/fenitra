import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '@/store/auth';

interface Entry {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  href: Href;
  adminOnly?: boolean;
}

const ENTRIES: Entry[] = [
  {
    key: 'catalogue',
    icon: 'pricetags-outline',
    title: 'Catalogue',
    subtitle: 'Modèles, pointures et produits inactifs',
    href: '/settings/catalogue',
  },
  {
    key: 'tiers',
    icon: 'people-outline',
    title: 'Tiers',
    subtitle: 'Fournisseurs, clients, vendeurs en ligne',
    href: '/settings/tiers',
  },
  {
    key: 'categories',
    icon: 'list-outline',
    title: 'Catégories & modes de paiement',
    subtitle: 'Dépenses, encaissements et règlements',
    href: '/settings/categories',
  },
  {
    key: 'users',
    icon: 'shield-outline',
    title: 'Utilisateurs & rôles',
    subtitle: 'Comptes, rôles et mots de passe',
    href: '/settings/users',
    adminOnly: true,
  },
  {
    key: 'general',
    icon: 'options-outline',
    title: 'Général',
    subtitle: 'Réglages de l’application et mot de passe',
    href: '/settings/general',
  },
];

export default function SettingsScreen() {
  const user = useAuth((state) => state.user);
  const role = user?.role;
  const entries = ENTRIES.filter((entry) => !entry.adminOnly || role === 'ADMIN');

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      <View className="gap-1">
        <Text className="text-sm text-slate-500">{user?.name}</Text>
        <Text className="text-xs uppercase tracking-wide text-slate-400">
          {role === 'ADMIN' ? 'Administrateur' : role === 'MANAGER' ? 'Gestionnaire' : 'Caisse'}
        </Text>
      </View>

      <View className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {entries.map((entry, index) => (
          <Pressable
            key={entry.key}
            className={`flex-row items-center gap-3 px-4 py-4 ${
              index > 0 ? 'border-t border-slate-100' : ''
            }`}
            onPress={() => router.push(entry.href)}>
            <View className="h-9 w-9 items-center justify-center rounded-full bg-slate-100">
              <Ionicons color="#334155" name={entry.icon} size={18} />
            </View>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-slate-800">{entry.title}</Text>
              <Text className="text-xs text-slate-400">{entry.subtitle}</Text>
            </View>
            <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
          </Pressable>
        ))}
      </View>

      <Text className="mt-4 text-xs text-slate-400">
        Les actions de modification sont réservées aux comptes ADMIN et MANAGER.
      </Text>
    </ScrollView>
  );
}
