import '../global.css';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';

import { QueryProvider } from '@/providers/query-provider';
import { useAuth } from '@/store/auth';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
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
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
          <Stack.Screen
            name="arrival/new"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Nouvel arrivage' }}
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
            name="finance/expense"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Nouvelle dépense' }}
          />
          <Stack.Screen
            name="finance/versement"
            options={{ headerShown: true, headerBackTitle: 'Retour', title: 'Nouveau versement' }}
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
            name="finance/trosa"
            options={{
              headerShown: true,
              headerBackTitle: 'Retour',
              title: 'Nouvelle trosa sinoa',
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
        <StatusBar style="auto" />
      </ThemeProvider>
    </QueryProvider>
  );
}
