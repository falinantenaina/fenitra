import '../../global.css';

import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ToastHost } from '@/components/toast';
import { UpdateBanner } from '@/components/update-banner';
import { QueryProvider } from '@/providers/query-provider';
import { useAuth } from '@/store/auth';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const hydrate = useAuth((state) => state.hydrate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void hydrate().finally(() => {
      if (!alive) return;
      setReady(true);
      void SplashScreen.hideAsync();
    });
    return () => {
      alive = false;
    };
  }, [hydrate]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator color="#208AEF" size="large" />
      </View>
    );
  }

  return (
    <QueryProvider>
      <ThemeProvider value={DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
          <Stack.Screen
            name="arrival/new"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Nouvel arrivage' }}
          />
          <Stack.Screen
            name="arrival/edit"
            options={{
              headerShown: true,
              headerBackTitle: 'Retour',
              title: "Modifier l'arrivage",
            }}
          />
          <Stack.Screen
            name="sale/new"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Nouvelle vente' }}
          />
          <Stack.Screen
            name="stock/lot"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Détail du lot' }}
          />
          <Stack.Screen
            name="stock/adjust"
            options={{
              headerShown: true,
              headerBackTitle: 'Retour',
              title: 'Ajuster le stock',
            }}
          />
          <Stack.Screen
            name="dettes/[id]"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Détail de la dette' }}
          />
          <Stack.Screen
            name="sales/[id]"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Détail de la vente' }}
          />
          <Stack.Screen name="arrivals" options={{ headerShown: false }} />
          <Stack.Screen
            name="finance/expense"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Nouvelle dépense' }}
          />
          <Stack.Screen
            name="finance/capital"
            options={{
              headerShown: true,
              headerBackTitle: 'Retour',
              title: 'Argent propre',
            }}
          />
          <Stack.Screen
            name="finance/dette-fournisseur"
            options={{
              headerShown: true,
              headerBackTitle: 'Retour',
              title: 'Nouvelle dette fournisseur',
            }}
          />
          <Stack.Screen
            name="reports/index"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Rapports' }}
          />
          <Stack.Screen
            name="settings/index"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Paramètres' }}
          />
          <Stack.Screen
            name="settings/catalogue"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Catalogue' }}
          />
          <Stack.Screen
            name="settings/tiers"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Tiers' }}
          />
          <Stack.Screen
            name="settings/categories"
            options={{
              headerShown: true,
              headerBackTitle: 'Retour',
              title: 'Catégories & paiement',
            }}
          />
          <Stack.Screen
            name="settings/users"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Utilisateurs' }}
          />
          <Stack.Screen
            name="settings/general"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Général' }}
          />
        </Stack>
        <UpdateBanner />
        <ToastHost />
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryProvider>
  );
}
