import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs, router } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useAuth } from '@/store/auth';

export default function TabsLayout() {
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  // §57 / A14 — le caissier n'a accès qu'à la vente, aux dépenses et au stock :
  // on masque les onglets et raccourcis des écrans qui lui sont fermés.
  const isCashier = user?.role === 'CASHIER';

  if (status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#208AEF" size="large" />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#208AEF',
        tabBarInactiveTintColor: '#60646C',
        headerTitle: user ? `${user.name}` : 'Gestion des ventes',
        // §51 — Rapports et Paramètres accessibles d'un geste depuis chaque onglet.
        headerRight: () =>
          isCashier ? null : (
            <View className="flex-row items-center gap-1 pr-3">
              <Pressable
                accessibilityLabel="Rapports et journal"
                accessibilityRole="button"
                className="p-2"
                onPress={() => router.push('/reports')}>
                <Ionicons color="#334155" name="document-text-outline" size={20} />
              </Pressable>
              <Pressable
                accessibilityLabel="Paramètres"
                accessibilityRole="button"
                className="p-2"
                onPress={() => router.push('/settings')}>
                <Ionicons color="#334155" name="settings-outline" size={20} />
              </Pressable>
            </View>
          ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="home-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="stock"
        options={{
          title: 'Stock',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="cube-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="ventes"
        options={{
          title: 'Ventes',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="cart-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="dettes"
        options={{
          ...(isCashier ? { href: null } : {}),
          title: 'Dettes',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="people-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="fournisseurs"
        options={{
          ...(isCashier ? { href: null } : {}),
          title: 'Fournisseurs',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="business-outline" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="finances"
        options={{
          title: 'Finances',
          tabBarIcon: ({ color, size }) => (
            <Ionicons color={color} name="wallet-outline" size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
