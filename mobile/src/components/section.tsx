import { Text } from 'react-native';

/**
 * Titre de section d'écran : petites capitales grises, suivi optionnel d'un
 * compteur (`Ventes · 12`). Le `mt-5` par défaut respecte le rythme vertical
 * des écrans détail ; passez `className="mt-0"` pour l'annuler.
 */
export function Section({
  title,
  count,
  className,
}: {
  title: string;
  count?: number;
  className?: string;
}) {
  return (
    <Text
      className={`mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500${
        className ? ` ${className}` : ''
      }`}
    >
      {title}
      {typeof count === 'number' ? ` · ${count}` : ''}
    </Text>
  );
}
