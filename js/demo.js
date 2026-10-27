// Données d'exemple — clairement marquées (demo: true) et supprimables.
// LES PRIX SONT FICTIFS : ordres de grandeur plausibles, non relevés en magasin.

const I = (id, name, category, defaultUnit, extra = {}) => ({ id: 'demo-i-' + id, name, category, defaultUnit, productIds: [], preferredProductId: null, manualPrice: null, unitWeight: null, ...extra });
const P = (id, name, packQty, packUnit, packPrice, extra = {}) => ({
  id: 'demo-p-' + id, name, brand: extra.brand || '', store: extra.store || 'Colruyt', barcode: '', category: extra.category || 'Autres',
  packQty, packUnit, packPrice, soldByWeight: !!extra.bulk, lot: 1, available: true,
  priceDate: null, priceSource: 'manuel', priceNote: 'exemple, prix fictif', autoUpdate: false, url: '', zone: '',
});

const products = [
  P('riz', 'Riz long grain 1 kg', 1, 'kg', 1.89, { category: 'Épicerie sèche' }),
  P('spag', 'Spaghetti 500 g', 500, 'g', 0.99, { category: 'Épicerie sèche' }),
  P('pdt', 'Pommes de terre 2,5 kg', 2.5, 'kg', 2.79, { category: 'Fruits et légumes' }),
  P('car', 'Carottes 1 kg', 1, 'kg', 1.19, { category: 'Fruits et légumes' }),
  P('oig', 'Oignons jaunes 1 kg', 1, 'kg', 1.49, { category: 'Fruits et légumes' }),
  P('chic', 'Chicons 1 kg', 1, 'kg', 2.99, { category: 'Fruits et légumes' }),
  P('tom', 'Tomates concassées 400 g', 400, 'g', 0.79, { category: 'Conserves' }),
  P('tom2', 'Tomates concassées 3 × 400 g', 1200, 'g', 1.99, { category: 'Conserves' }),
  P('hache', 'Haché porc et bœuf 500 g', 500, 'g', 4.29, { category: 'Viande et poisson' }),
  P('boeuf', 'Bœuf à braiser 1 kg', 1, 'kg', 13.9, { category: 'Viande et poisson' }),
  P('saumon', 'Filets de saumon 2 × 125 g', 250, 'g', 5.49, { category: 'Viande et poisson' }),
  P('jambon', 'Jambon cuit 8 tranches', 8, 'tranche', 2.69, { category: 'Viande et poisson' }),
  P('lait', 'Lait demi-écrémé 1 l', 1, 'l', 0.99, { category: 'Produits laitiers' }),
  P('beurre', 'Beurre 250 g', 250, 'g', 2.49, { category: 'Produits laitiers' }),
  P('gruy', 'Gruyère râpé 200 g', 200, 'g', 2.29, { category: 'Produits laitiers' }),
  P('oeufs', 'Œufs frais × 12', 12, 'piece', 3.19, { category: 'Produits laitiers' }),
  P('biere', 'Bière brune 33 cl', 33, 'cl', 1.29, { category: 'Boissons' }),
  P('pain', 'Pain d\'épices 20 tranches', 20, 'tranche', 1.79, { category: 'Boulangerie' }),
  P('haric', 'Haricots verts 1 kg', 1, 'kg', 3.49, { category: 'Fruits et légumes', bulk: true }),
  P('farine', 'Farine 1 kg', 1, 'kg', 0.89, { category: 'Épicerie sèche' }),
  P('bouillon', 'Bouillon de légumes (12 cubes)', 12, 'piece', 1.39, { category: 'Épicerie sèche' }),
];

const link = (ing, ...pids) => ({ ...ing, productIds: pids.map(p => 'demo-p-' + p) });

const ingredients = [
  link(I('riz', 'Riz', 'Épicerie sèche', 'g'), 'riz'),
  link(I('spag', 'Spaghetti', 'Épicerie sèche', 'g'), 'spag'),
  link(I('pdt', 'Pommes de terre', 'Fruits et légumes', 'g'), 'pdt'),
  link(I('car', 'Carottes', 'Fruits et légumes', 'g'), 'car'),
  link(I('oig', 'Oignon jaune', 'Fruits et légumes', 'piece', { unitWeight: { qty: 150, unit: 'g' } }), 'oig'),
  I('oigr', 'Oignon rouge', 'Fruits et légumes', 'piece'),
  link(I('chic', 'Chicons', 'Fruits et légumes', 'g'), 'chic'),
  link(I('tom', 'Tomates concassées', 'Conserves', 'g'), 'tom', 'tom2'),
  link(I('hache', 'Haché porc et bœuf', 'Viande et poisson', 'g'), 'hache'),
  link(I('boeuf', 'Bœuf à braiser', 'Viande et poisson', 'g'), 'boeuf'),
  link(I('saumon', 'Saumon', 'Viande et poisson', 'g'), 'saumon'),
  link(I('jambon', 'Jambon cuit', 'Viande et poisson', 'tranche'), 'jambon'),
  link(I('lait', 'Lait', 'Produits laitiers', 'ml'), 'lait'),
  link(I('beurre', 'Beurre', 'Produits laitiers', 'g'), 'beurre'),
  link(I('gruy', 'Gruyère râpé', 'Produits laitiers', 'g'), 'gruy'),
  link(I('oeufs', 'Œufs', 'Produits laitiers', 'piece'), 'oeufs'),
  link(I('biere', 'Bière brune', 'Boissons', 'cl'), 'biere'),
  link(I('pain', 'Pain d\'épices', 'Boulangerie', 'tranche'), 'pain'),
  link(I('haric', 'Haricots verts', 'Fruits et légumes', 'g'), 'haric'),
  link(I('farine', 'Farine', 'Épicerie sèche', 'g'), 'farine'),
  link(I('bouillon', 'Bouillon cube', 'Épicerie sèche', 'piece'), 'bouillon'),
  I('ail', 'Ail', 'Fruits et légumes', 'gousse'),
  I('sel', 'Sel', 'Épicerie sèche', 'pincee'),
  I('muscade', 'Muscade', 'Épicerie sèche', 'pincee'),
  I('lard', 'Lardons', 'Viande et poisson', 'g', { manualPrice: { price: 2.2, qty: 200, unit: 'g' } }),
  I('citron', 'Citron', 'Fruits et légumes', 'piece', { manualPrice: { price: 0.45, qty: 1, unit: 'piece' } }),
];

const it = (ing, qty, unit, optional = false) => ({ id: `demo-it-${ing}-${qty}-${unit}`, ingredientId: 'demo-i-' + ing, qty, unit, optional, note: '' });
const R = (id, name, category, servings, prepMin, cookMin, items, steps, extra = {}) => ({
  id: 'demo-r-' + id, name, category, servings, prepMin, cookMin, items, steps, description: extra.description || '', notes: extra.notes || '',
  photoId: null, createdAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T12:00:00.000Z',
});

const recipes = [
  R('stoemp', 'Stoemp aux carottes', 'Végétarien', 4, 20, 25,
    [it('pdt', 1000, 'g'), it('car', 500, 'g'), it('beurre', 40, 'g'), it('lait', 100, 'ml'), it('muscade', 1, 'pincee', true), it('sel', 2, 'pincee')],
    ['Éplucher et couper les pommes de terre et les carottes.', 'Cuire 25 minutes à l\'eau salée.', 'Écraser avec le beurre et le lait chaud, assaisonner.']),
  R('chicons', 'Chicons au gratin', 'Viande', 4, 25, 35,
    [it('chic', 800, 'g'), it('jambon', 8, 'tranche'), it('beurre', 50, 'g'), it('farine', 50, 'g'), it('lait', 500, 'ml'), it('gruy', 100, 'g'), it('pdt', 800, 'g')],
    ['Braiser les chicons 20 minutes.', 'Préparer une béchamel avec beurre, farine et lait.', 'Rouler chaque chicon dans une tranche de jambon.', 'Napper, parsemer de gruyère et gratiner 15 minutes.'],
    { description: 'Le classique belge, servi avec une purée.' }),
  R('carbo', 'Carbonnades flamandes', 'Viande', 4, 30, 150,
    [it('boeuf', 1000, 'g'), it('oig', 3, 'piece'), it('biere', 66, 'cl'), it('pain', 2, 'tranche'), it('beurre', 30, 'g')],
    ['Couper le bœuf en cubes et le saisir au beurre.', 'Ajouter les oignons émincés.', 'Mouiller avec la bière, poser le pain d\'épices tartiné de moutarde.', 'Mijoter 2 h 30 à couvert.'],
    { notes: 'Encore meilleur réchauffé le lendemain.' }),
  R('bolo', 'Spaghetti bolognaise', 'Pâtes', 4, 15, 40,
    [it('spag', 400, 'g'), it('hache', 500, 'g'), it('tom', 800, 'g'), it('oig', 1, 'piece'), it('car', 150, 'g'), it('ail', 2, 'gousse'), it('gruy', 60, 'g', true)],
    ['Faire revenir oignon, carotte et ail hachés.', 'Ajouter le haché et le dorer.', 'Ajouter les tomates et mijoter 30 minutes.', 'Cuire les spaghetti et servir.']),
  R('saumon', 'Saumon, riz et haricots', 'Poisson', 2, 10, 20,
    [it('saumon', 250, 'g'), it('riz', 150, 'g'), it('haric', 300, 'g'), it('citron', 1, 'piece'), it('beurre', 10, 'g')],
    ['Cuire le riz.', 'Cuire les haricots à la vapeur 8 minutes.', 'Poêler le saumon 4 minutes de chaque côté, arroser de citron.']),
  R('soupe', 'Soupe tomates-carottes', 'Soupe', 4, 15, 30,
    [it('tom', 800, 'g'), it('car', 400, 'g'), it('oig', 1, 'piece'), it('bouillon', 1, 'piece'), it('pdt', 200, 'g')],
    ['Émincer les légumes et les faire suer.', 'Ajouter tomates, bouillon et 1 l d\'eau.', 'Cuire 25 minutes puis mixer.']),
  R('omelette', 'Omelette au jambon', 'Viande', 2, 5, 8,
    [it('oeufs', 4, 'piece'), it('jambon', 2, 'tranche'), it('beurre', 10, 'g'), it('gruy', 30, 'g', true)],
    ['Battre les œufs.', 'Cuire au beurre, ajouter le jambon et le fromage.']),
  R('salade', 'Salade liégeoise', 'Salade', 4, 20, 25,
    [it('haric', 500, 'g'), it('pdt', 600, 'g'), it('lard', 150, 'g'), it('oigr', 1, 'piece'), it('oeufs', 2, 'piece', true)],
    ['Cuire pommes de terre et haricots.', 'Rissoler les lardons et l\'oignon rouge.', 'Déglacer au vinaigre et mélanger encore tiède.'],
    { notes: 'L\'oignon rouge n\'a pas de prix : exemple de prix manquant.' }),
];

export const DEMO = { ingredients, products, recipes, stock: [
  { id: 'demo-s-riz', ingredientId: 'demo-i-riz', name: 'Riz', qty: 300, unit: 'g', expiry: null, productId: 'demo-p-riz' },
  { id: 'demo-s-farine', ingredientId: 'demo-i-farine', name: 'Farine', qty: 1, unit: 'kg', expiry: null, productId: null },
] };
