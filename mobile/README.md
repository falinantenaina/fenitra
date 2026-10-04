# mobile — application Expo

Application mobile du projet **Gestion Vente** (voir le [README racine](../README.md)).

## Démarrage

```bash
npm install
cp .env.example .env     # EXPO_PUBLIC_API_URL vers l'API (voir README racine §2.3)
npm start                # Expo Router + NativeWind
```

L'API doit tourner au préalable (`cd ../backend && npm run dev`).

## Commandes

| Commande | Rôle |
|---|---|
| `npm start` | serveur de dev Expo |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `expo lint` |
| `npx expo-doctor` | santé des dépendances / de la config |
| `npx expo run:android` | développement build local (nécessite Android Studio) |

## Structure

```
src/
├── app/            écrans Expo Router (tabs/, sales/, arrivals/, stock/, finance/, settings/)
├── components/     Section, Field, Chip, CancelPanel, ListFooter, KpiCard, …
├── lib/            queries.ts (React Query), api.ts, types.ts, status.ts, sale.ts
├── providers/      QueryProvider
└── store/          auth.ts (Zustand + SecureStore)
```

## Build

Voir §6 du [README racine](../README.md) : `eas build --platform android --profile preview`
(prod. un **APK**) ou `--profile production` (prod. un **AAB**). Profils définis dans `eas.json`.

## Recette

`scripts/recette.ts` rejoue les 12 scénarios métier contre l'API — instructions dans
§5 du [README racine](../README.md).
