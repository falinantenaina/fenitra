import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

/** Bloc de saisie : label en petites capitales au-dessus du contrôle. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mt-5 gap-1.5">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Text>
      {children}
    </View>
  );
}

function Message({ className, message }: { className: string; message?: string }) {
  if (!message) return null;
  return <Text className={className}>{message}</Text>;
}

/** Message d'erreur collé au contrôle (marge haute). */
export function FieldError({ message }: { message?: string }) {
  return <Message className="mt-1 text-xs text-red-600" message={message} />;
}

/** Message d'erreur sans marge — dans un `Field` à `gap` explicite. */
export function ErrorText({ message }: { message?: string }) {
  return <Message className="text-xs text-red-600" message={message} />;
}
