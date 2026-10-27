// Optimisation des conditionnements : trouve la combinaison de paquets entiers
// qui couvre au moins la quantité nécessaire au coût total minimal.
//
// options : [{ productId, packQtyBase, packPrice, soldByWeight, lot }]
//  - packQtyBase : contenance d'un paquet dans l'unité de base (g, ml, pièce)
//  - packPrice   : prix d'un paquet
//  - soldByWeight: vendu au poids/au détail (vrac) → on paie la quantité exacte
//                  au prix unitaire, sans arrondi au paquet
//  - lot         : nombre minimal de paquets vendus ensemble (ex. lot de 4)
//
// Renvoie { packs:[{productId,count,packQtyBase,packPrice}], payable,
//           purchasedQty, surplus } ou null si aucune option n'est utilisable.

const MAX_STEPS = 200000; // borne de la programmation dynamique

export function optimizePurchase(needBase, options) {
  const usable = (options || []).filter(o =>
    o && isFinite(o.packPrice) && o.packPrice >= 0 && isFinite(o.packQtyBase) && o.packQtyBase > 0);
  if (!usable.length) return null;
  if (!(needBase > 0)) return { packs: [], payable: 0, purchasedQty: 0, surplus: 0 };

  let best = null;
  const consider = (cand) => {
    if (!cand) return;
    if (!best || cand.payable < best.payable - 1e-9 ||
        (Math.abs(cand.payable - best.payable) <= 1e-9 && cand.purchasedQty < best.purchasedQty)) {
      best = cand;
    }
  };

  // Vrac : quantité exacte
  for (const o of usable.filter(o => o.soldByWeight)) {
    const unitPrice = o.packPrice / o.packQtyBase;
    consider({
      packs: [{ productId: o.productId, count: needBase / o.packQtyBase, packQtyBase: o.packQtyBase, packPrice: o.packPrice, bulk: true }],
      payable: needBase * unitPrice, purchasedQty: needBase, surplus: 0,
    });
  }

  // Paquets entiers (avec lots)
  const discrete = usable.filter(o => !o.soldByWeight).map(o => {
    const lot = Math.max(1, Math.floor(o.lot || 1));
    return { ...o, lot, qty: o.packQtyBase * lot, price: o.packPrice * lot };
  });
  if (discrete.length) consider(discreteOptimum(needBase, discrete));
  return best;
}

function discreteOptimum(need, opts) {
  // Résolution : unité de base entière ; si le besoin est énorme, on agrandit le pas.
  let step = 1;
  while (Math.ceil(need / step) > MAX_STEPS) step *= 10;
  const N = Math.ceil(need / step - 1e-9);
  const q = opts.map(o => Math.max(1, Math.round(o.qty / step)));
  const cost = new Float64Array(N + 1).fill(Infinity);
  const bought = new Float64Array(N + 1).fill(Infinity);
  const choice = new Int32Array(N + 1).fill(-1);
  cost[0] = 0; bought[0] = 0;
  for (let x = 1; x <= N; x++) {
    for (let i = 0; i < opts.length; i++) {
      const prev = Math.max(0, x - q[i]);
      const c = cost[prev] + opts[i].price;
      const b = bought[prev] + opts[i].qty;
      if (c < cost[x] - 1e-9 || (Math.abs(c - cost[x]) <= 1e-9 && b < bought[x])) {
        cost[x] = c; bought[x] = b; choice[x] = i;
      }
    }
  }
  if (!isFinite(cost[N])) return null;
  const counts = new Map();
  let x = N;
  while (x > 0) {
    const i = choice[x];
    counts.set(i, (counts.get(i) || 0) + 1);
    x = Math.max(0, x - q[i]);
  }
  const packs = [...counts].map(([i, n]) => ({
    productId: opts[i].productId, count: n * opts[i].lot,
    packQtyBase: opts[i].packQtyBase, packPrice: opts[i].packPrice,
  }));
  const purchasedQty = packs.reduce((s, p) => s + p.count * p.packQtyBase, 0);
  const payable = packs.reduce((s, p) => s + p.count * p.packPrice, 0);
  return { packs, payable, purchasedQty, surplus: Math.max(0, purchasedQty - need) };
}
