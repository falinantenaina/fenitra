/**
 * Conventions de montants (§11 — Conventions).
 * Tous les montants sont des **entiers** en base (`Int`, A9) et sont exposés
 * par l'API en **string** décimale ("246.00") : jamais de flottant JSON,
 * donc aucune perte de précision côté client.
 */
export const money = (amount: number): string => amount.toFixed(2);

export const moneyOrNull = (amount: number | null | undefined): string | null =>
  amount === null || amount === undefined ? null : amount.toFixed(2);

/** Aperçu texte d'un montant pour les exports / logs. */
export const moneyLabel = (amount: number): string => `${money(amount)} Ar`;
