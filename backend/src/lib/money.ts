/**
 * Conventions de montants (§11 — Conventions).
 * Tous les montants sont des **entiers** en base (`Int`, A9) et sont exposés
 * par l'API en **string** décimale ("246.00") : jamais de flottant JSON,
 * donc aucune perte de précision côté client.
 */
export const money = (amount: number): string => amount.toFixed(2);
