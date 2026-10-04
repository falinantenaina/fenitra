import { Stack } from 'expo-router';

/** Pile « Arrivages » : liste + détail, avec en-tête natif. */
export default function ArrivalsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: 'Retour',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0F172A',
      }}>
      <Stack.Screen name="list" options={{ title: 'Arrivages' }} />

      <Stack.Screen name="[id]" options={{ title: "Détail de l'arrivage" }} />
    </Stack>
  );
}

// Regen
