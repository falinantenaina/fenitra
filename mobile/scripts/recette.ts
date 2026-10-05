/**
 * Recette de bout en bout (Phase 7) — rejoue les 12 scénarios du §16 contre
 * l'API, exactement comme le ferait le mobile.
 *   API sur 4100 (base de tests) puis : npx tsx scripts/recette.ts
 */
const BASE = process.env.API_URL ?? 'http://127.0.0.1:4100/api';
let checks = 0;

function ok(condition: boolean, label: string, extra?: unknown) {
  checks += 1;
  if (!condition) {
    console.error(`ÉCHEC #${checks} — ${label}`, extra ?? '');
    process.exit(1);
  }
}

interface ReqOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

async function req(path: string, options?: ReqOptions): Promise<{ status: number; body: any }>;
async function req(
  path: string,
  options: ReqOptions & { raw: true },
): Promise<{ status: number; bytes: Uint8Array }>;
async function req(
  path: string,
  options: ReqOptions & { raw?: boolean } = {},
): Promise<{ status: number; body?: any; bytes?: Uint8Array }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  if (options.raw) return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) };
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, body: json as any };
}

const num = (v: unknown): number => Number(v);

async function main() {
  const stamp = Date.now().toString(36).toUpperCase();
  const login = await req('/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.local', password: 'admin1234' },
  });
  ok(login.status === 200, 'connexion admin');
  const t = login.body.accessToken as string;

  /* ── Référentiels ─────────────────────────────────────── */

  const supplier = await req('/suppliers', {
    method: 'POST',
    token: t,
    body: { name: `Recette F ${stamp}` },
  });
  const customer = await req('/customers', {
    method: 'POST',
    token: t,
    body: { name: `Recette C ${stamp}` },
  });
  const seller = await req('/online-sellers', {
    method: 'POST',
    token: t,
    body: { name: `Recette V ${stamp}` },
  });
  ok(supplier.status === 201 && customer.status === 201 && seller.status === 201, 'tiers créés');

  const product = await req('/products', {
    method: 'POST',
    token: t,
    body: { name: `Recette ${stamp}` },
  });
  // La base part vierge (seed = login seul) : la recette crée ce qu'il lui faut.
  let sizes = await req('/sizes?limit=100', { token: t });
  if (!sizes.body.items.length) {
    const created = await req('/sizes', {
      method: 'POST',
      token: t,
      body: { value: 40, label: '40' },
    });
    ok(created.status === 201 || created.status === 409, 'pointure de référence créée', created.status);
    sizes = await req('/sizes?limit=100', { token: t });
  }
  ok(Array.isArray(sizes.body.items) && sizes.body.items.length > 0, 'pointure disponible');
  const size = sizes.body.items[0];
  const variant = await req('/variants', {
    method: 'POST',
    token: t,
    body: { productId: product.body.id, sizeId: size.id, sellingPrice: 40000 },
  });
  ok(variant.status === 201, 'variante créée');
  const V = variant.body.id as string;

  const categories = await req('/expense-categories?limit=200', { token: t });
  let categoryId: string | undefined = (categories.body.items as { id: string; active: boolean }[])
    .find((c) => c.active)?.id;
  if (!categoryId) {
    const created = await req('/expense-categories', {
      method: 'POST',
      token: t,
      body: { name: `Recette ${stamp}`, icon: 'box' },
    });
    ok(created.status === 201, 'catégorie de dépense créée', created.status);
    categoryId = created.body.id as string;
  }

  /* ── 1. Arrivage réglé d'emblée ───────────────────────── */

  const arrival1 = await req('/arrivals', {
    method: 'POST',
    token: t,
    body: {
      supplierId: supplier.body.id,
      cartons: [{ items: [{ variantId: V, quantity: 10, unitCost: 15000 }] }],
      payment: { amount: 150000, method: 'Espèces' },
    },
  });
  ok(arrival1.status === 201, 'arrivage 1 → 201', arrival1.status);
  ok(/^ARR-\d{4}$/.test(arrival1.body.reference), 'référence ARR-####', arrival1.body.reference);
  ok(arrival1.body.debt === null, 'arrivage réglé → aucune dette fournisseur', arrival1.body.debt);
  ok(num(arrival1.body.paidAmount) === 150000 && num(arrival1.body.unpaidAmount) === 0, 'réglé intégralement', {
    paid: arrival1.body.paidAmount,
    unpaid: arrival1.body.unpaidAmount,
  });
  ok(num(arrival1.body.lots[0].remainingQty) === 10, '10 unités en lot');

  /* ── 2. Arrivage à crédit partiel ─────────────────────── */

  const arrival2 = await req('/arrivals', {
    method: 'POST',
    token: t,
    body: {
      supplierId: supplier.body.id,
      cartons: [{ items: [{ variantId: V, quantity: 6, unitCost: 16000 }] }],
      payment: { amount: 50000, method: 'Espèces' },
    },
  });
  ok(arrival2.status === 201, 'arrivage 2 → 201');
  ok(arrival2.body.debt?.status === 'PARTIAL', 'arrivage à crédit → PARTIAL', arrival2.body.debt);
  ok(num(arrival2.body.debt.remainingAmount) > 0, 'reste dû > 0');

  const summary = await req(`/stock/summary?variantId=${V}`, { token: t });
  ok(summary.body.quantity === 16, 'stock à 16 après deux arrivages', summary.body.quantity);

  /* ── 4. Vente FIFO ────────────────────────────────────── */

  const sale = await req('/sales', {
    method: 'POST',
    token: t,
    body: {
      customerId: customer.body.id,
      items: [{ variantId: V, quantity: 4, unitPrice: 45000 }],
      payment: { amount: 180000, method: 'Espèces' },
    },
  });
  ok(sale.status === 201, 'vente → 201');
  ok(sale.body.status === 'PAID', 'vente réglée → PAID', sale.body.status);
  ok(num(sale.body.cogs) > 0 && num(sale.body.margin) >= 0, 'COGS et marge calculés', {
    cogs: sale.body.cogs,
    margin: sale.body.margin,
  });

  const saleDetail = await req(`/sales/${sale.body.id}`, { token: t });
  ok(saleDetail.body.items.length === 1, 'vente : 1 ligne');
  ok(saleDetail.body.items[0].lots.length >= 1, 'vente : allocation FIFO tracée');

  const summaryAfterSale = await req(`/stock/summary?variantId=${V}`, { token: t });
  ok(summaryAfterSale.body.quantity === 12, 'stock 16 → 12', summaryAfterSale.body.quantity);

  /* ── 6. Vente à crédit ────────────────────────────────── */

  const creditSale = await req('/sales', {
    method: 'POST',
    token: t,
    body: {
      customerId: customer.body.id,
      items: [{ variantId: V, quantity: 2, unitPrice: 45000 }],
    },
  });
  ok(creditSale.status === 201, 'vente à crédit → 201');
  ok(creditSale.body.status === 'UNPAID', 'vente à crédit → UNPAID', creditSale.body.status);
  ok(creditSale.body.debt?.id && creditSale.body.debt.status === 'OPEN', 'dette cliente ouverte');

  /* ── 10. Règlements de vente ──────────────────────────── */

  const part = await req(`/sales/${creditSale.body.id}/payments`, {
    method: 'POST',
    token: t,
    body: { amount: 30000, method: 'Espèces' },
  });
  ok(part.status === 200 && part.body.status === 'PARTIAL', 'règlement partiel → PARTIAL', part.body.status);

  const rest = num(creditSale.body.remainingAmount) - 30000;
  const settle = await req(`/sales/${creditSale.body.id}/payments`, {
    method: 'POST',
    token: t,
    body: { amount: rest, method: 'Espèces' },
  });
  ok(settle.status === 200 && settle.body.status === 'PAID', 'solde → PAID', settle.body.status);

  const tooMuch = await req(`/sales/${creditSale.body.id}/payments`, {
    method: 'POST',
    token: t,
    body: { amount: 1000, method: 'Espèces' },
  });
  ok(tooMuch.status === 422, 'trop-perçu refusé → 422', tooMuch.status);

  /* ── 5. Annulation d'une vente ────────────────────────── */

  const beforeCancel = await req(`/stock/summary?variantId=${V}`, { token: t });
  const cancelled = await req(`/sales/${sale.body.id}/cancel`, {
    method: 'POST',
    token: t,
    body: { reason: 'Recette : retour client' },
  });
  ok(cancelled.status === 200 && cancelled.body.status === 'CANCELLED', 'vente annulée');
  const afterCancel = await req(`/stock/summary?variantId=${V}`, { token: t });
  ok(
    afterCancel.body.quantity === beforeCancel.body.quantity + 4,
    'annulation → stock restitué',
    { avant: beforeCancel.body.quantity, apres: afterCancel.body.quantity },
  );

  /* ── 7. Dettes génériques ─────────────────────────────── */

  const debt = await req('/debts', {
    method: 'POST',
    token: t,
    body: { type: 'CUSTOMER', customerId: customer.body.id, amount: 60000, reason: 'Recette' },
  });
  ok(debt.status === 201 && debt.body.status === 'OPEN', 'dette manuelle → OPEN');

  const paidPart = await req(`/debts/${debt.body.id}/payments`, {
    method: 'POST',
    token: t,
    body: { amount: 25000 },
  });
  ok(paidPart.body.status === 'PARTIAL', 'dette PARTIAL', paidPart.body.status);
  const paidAll = await req(`/debts/${debt.body.id}/payments`, {
    method: 'POST',
    token: t,
    body: { amount: num(debt.body.remainingAmount) - 25000 },
  });
  ok(paidAll.body.status === 'PAID', 'dette PAID', paidAll.body.status);

  const overpaid = await req(`/debts/${debt.body.id}/payments`, {
    method: 'POST',
    token: t,
    body: { amount: 5000 },
  });
  ok(overpaid.status === 422, 'trop-perçu dette → 422', overpaid.status);

  /* ── 9. Ajustement de stock (casse) ───────────────────── */

  const adjust = await req('/stock/adjustments', {
    method: 'POST',
    token: t,
    body: { variantId: V, qty: 1, reason: 'Recette : casse' },
  });
  ok(adjust.status === 201 && num(adjust.body.lostValue) > 0, 'casse → lostValue > 0');
  const expenses = await req('/expenses?limit=50', { token: t });
  ok(
    expenses.body.items.some((e: { id: string }) => e.id === adjust.body.expenseId),
    'la casse devient une dépense',
  );

  /* ── 11. Dépenses & versements ────────────────────────── */

  const expense = await req('/expenses', {
    method: 'POST',
    token: t,
    body: { categoryId, amount: 7500, description: 'Recette transport' },
  });
  ok(expense.status === 201, 'dépense → 201');

  /* ── 12. Argent propre, trosa sinoa, financement mixte ── */

  const trosa = await req('/trosa-sinoa', {
    method: 'POST',
    token: t,
    body: { type: 'TROSA_SINOA', partyName: `Prêteur ${stamp}`, amount: 80000, reason: 'Recette emprunt' },
  });
  ok(trosa.status === 201 && trosa.body.direction === 'PAYABLE', 'trosa sinoa → PAYABLE (A1)');
  ok(num(trosa.body.remainingAmount) === 80000, 'trosa à 80000');

  const capital = await req('/personal-capital', {
    method: 'POST',
    token: t,
    body: { type: 'IN', amount: 50000, motif: 'Recette injection' },
  });
  ok(capital.status === 201, 'injection argent propre → 201 (A5)');

  const versement = await req('/versements', {
    method: 'POST',
    token: t,
    body: { personName: `Prêteur ${stamp}`, amount: 20000, motif: 'Recette remboursement' },
  });
  ok(versement.status === 201, 'versement → 201');
  ok(versement.body.treatment === 'DEBT_SETTLEMENT', 'A2 : remboursement de trosa ouverte', versement.body.treatment);
  ok(versement.body.debtId === trosa.body.id, 'versement rattaché à la trosa');

  /* ── 3. Annulation d'arrivage (stock intact) ──────────── */

  const arrival3 = await req('/arrivals', {
    method: 'POST',
    token: t,
    body: {
      supplierId: supplier.body.id,
      cartons: [{ items: [{ variantId: V, quantity: 3, unitCost: 14000 }] }],
      payment: { amount: 42000, method: 'Espèces' },
    },
  });
  const qtyBeforeCancelArrival = (await req(`/stock/summary?variantId=${V}`, { token: t })).body
    .quantity;
  const cancelArrival = await req(`/arrivals/${arrival3.body.id}/cancel`, {
    method: 'POST',
    token: t,
    body: { reason: 'Recette : arrivage annulé' },
  });
  ok(cancelArrival.status === 200, 'annulation arrivage → 200');
  const qtyAfterCancelArrival = (await req(`/stock/summary?variantId=${V}`, { token: t })).body
    .quantity;
  ok(qtyAfterCancelArrival === qtyBeforeCancelArrival - 3, 'lots annulés exclus du stock', {
    avant: qtyBeforeCancelArrival,
    apres: qtyAfterCancelArrival,
  });

  /* ── 8. Valorisation & historique de prix ─────────────── */

  const lots = await req(`/stock/lots?variantId=${V}&limit=50`, { token: t });
  ok(lots.status === 200 && lots.body.items.length > 0, 'lots listés');
  const priceHistory = await req(`/variants/${V}/price-history`, { token: t });
  ok(priceHistory.body.items.length >= 2, 'historique des prix d\'achat', priceHistory.body.total);

  /* ── 5/12. Journal, dashboard et rapports ─────────────── */

  const dashboard = await req('/dashboard?period=month', { token: t });
  ok(dashboard.status === 200, 'dashboard mensuel');
  ok(dashboard.body.integrity.identityDelta === 0, 'identité comptable = 0', dashboard.body.integrity);
  ok(num(dashboard.body.activity.ca) > 0, 'CA du mois > 0');

  const drill = await req('/dashboard/ca/transactions?period=month', { token: t });
  ok(drill.status === 200, 'dérillage CA');
  ok(
    Math.abs(num(drill.body.total) - num(dashboard.body.activity.ca)) < 0.01,
    'dérillage = valeur affichée',
    { total: drill.body.total, ca: dashboard.body.activity.ca },
  );

  const today = new Date().toISOString().slice(0, 10);
  const daily = await req(`/reports/daily?date=${today}`, { token: t });
  ok(daily.status === 200 && daily.body.type === 'daily', 'rapport quotidien');
  ok(daily.body.integrity.identityDelta === 0, 'rapport : identité = 0');
  ok(daily.body.sales.length > 0, 'rapport : ventes du jour');

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const monthly = await req(`/reports/monthly?year=${year}&month=${month}`, { token: t });
  ok(monthly.status === 200 && monthly.body.type === 'monthly', 'rapport mensuel');

  const ledger = await req('/ledger?limit=50', { token: t });
  ok(ledger.status === 200 && ledger.body.items.length > 0, 'journal des écritures');
  const ledgerSummary = await req('/ledger/summary?limit=50', { token: t });
  ok(ledgerSummary.status === 200 && ledgerSummary.body.byKind.length > 0, 'résumé du journal');

  const pdf = await req(`/reports/export.pdf?type=daily&date=${today}`, { token: t, raw: true });
  ok(pdf.status === 200, 'export PDF');
  ok(String.fromCharCode(...pdf.bytes.slice(0, 4)) === '%PDF', 'signature %PDF');

  /* ── Intégrité finale ─────────────────────────────────── */

  const finalDashboard = await req('/dashboard?period=month', { token: t });
  ok(finalDashboard.body.integrity.ok === true, 'identité comptable intacte en fin de recette');
  ok(finalDashboard.body.integrity.identityDelta === 0, 'écart final = 0', finalDashboard.body.integrity);

  console.log(`RECETTE OK (${checks} vérifications, 12 scénarios §16)`);
}

main().catch((error) => {
  console.error('ERREUR', error);
  process.exit(1);
});
