import { describe, expect, it } from 'vitest';
import { resolvePeriod, toZonedParts, zonedToUtc } from '../src/services/period.service';

/** 1 octobre 2026 10:00 UTC = 13:00 à Antananarivo (UTC+3) */
const NOW = new Date('2026-10-01T10:00:00.000Z');

const iso = (d: Date) => d.toISOString();

describe('conversion timezone (Indian/Antananarivo, UTC+3)', () => {
  it('zonedToUtc produit le bon instant UTC', () => {
    expect(iso(zonedToUtc(2026, 10, 1))).toBe('2026-09-30T21:00:00.000Z');
  });

  it('toZonedParts décompose dans la timezone du business', () => {
    const p = toZonedParts(NOW);
    expect(p).toMatchObject({ year: 2026, month: 10, day: 1, hours: 13 });
  });
});

describe('filtres de période du dashboard (§6)', () => {
  it('today', () => {
    const p = resolvePeriod('today', NOW);
    expect(iso(p.from)).toBe('2026-09-30T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-10-01T21:00:00.000Z');
  });

  it('yesterday', () => {
    const p = resolvePeriod('yesterday', NOW);
    expect(iso(p.from)).toBe('2026-09-29T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-09-30T21:00:00.000Z');
  });

  it('last7d couvre 7 jours calendaires', () => {
    const p = resolvePeriod('last7d', NOW);
    expect(iso(p.from)).toBe('2026-09-24T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-10-01T21:00:00.000Z');
  });

  it('week commence le lundi', () => {
    // 1 octobre 2026 est un jeudi → lundi = 28 septembre
    const p = resolvePeriod('week', NOW);
    expect(iso(p.from)).toBe('2026-09-27T21:00:00.000Z');
    expect(toZonedParts(p.from).weekday).toBe(1); // lundi
  });

  it('month', () => {
    const p = resolvePeriod('month', NOW);
    expect(iso(p.from)).toBe('2026-09-30T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-10-01T21:00:00.000Z');
  });

  it('prevMonth gère le passage d\'année', () => {
    const p = resolvePeriod('prevMonth', NOW);
    expect(iso(p.from)).toBe('2026-08-31T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-09-30T21:00:00.000Z');

    const jan = resolvePeriod('prevMonth', new Date('2026-01-15T10:00:00.000Z'));
    expect(iso(jan.from)).toBe('2025-11-30T21:00:00.000Z');
    expect(iso(jan.to)).toBe('2025-12-31T21:00:00.000Z');
  });

  it('year', () => {
    const p = resolvePeriod('year', NOW);
    expect(iso(p.from)).toBe('2025-12-31T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-10-01T21:00:00.000Z');
  });

  it('custom rend `to` exclusif (fin de journée incluse)', () => {
    const p = resolvePeriod('custom', NOW, { from: '2026-09-01', to: '2026-09-30' });
    expect(iso(p.from)).toBe('2026-08-31T21:00:00.000Z');
    expect(iso(p.to)).toBe('2026-09-30T21:00:00.000Z');
  });

  it('custom sans bornes lève une erreur', () => {
    expect(() => resolvePeriod('custom', NOW)).toThrow(/from/);
  });

  it('custom avec fin < début lève une erreur', () => {
    expect(() => resolvePeriod('custom', NOW, { from: '2026-10-05', to: '2026-10-01' })).toThrow(
      /postérieure/,
    );
  });
});
