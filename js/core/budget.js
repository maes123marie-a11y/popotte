// Récapitulatif d'une semaine planifiée.
import { recipeCost } from './costing.js';
import { listBudget } from './shopping.js';

const get = (m, k) => (m && m.get ? m.get(k) : m ? m[k] : undefined);

export function weekSummary(week, recipesById, ingredientsById, productsById, shoppingItems = []) {
  const entries = (week && week.entries) || [];
  let consumed = 0, servings = 0, prep = 0, cook = 0, meals = 0;
  const unknownIngredients = new Set();
  let incomplete = false;
  const perEntry = [];
  for (const e of entries) {
    const r = get(recipesById, e.recipeId);
    if (!r) { perEntry.push({ entry: e, missing: true }); continue; }
    const c = recipeCost(r, e.servings, ingredientsById, productsById);
    meals++;
    servings += c.servings;
    consumed += c.total;
    prep += Number(r.prepMin) || 0;
    cook += Number(r.cookMin) || 0;
    if (!c.complete) incomplete = true;
    for (const l of c.lines) if (l.cost == null) unknownIngredients.add(l.item.ingredientId);
    perEntry.push({ entry: e, recipe: r, cost: c });
  }
  const list = listBudget(shoppingItems, ingredientsById, productsById);
  return {
    meals, servings, prep, cook, total: prep + cook,
    consumed, consumedComplete: !incomplete,
    avgMeal: meals ? consumed / meals : 0,
    avgPerson: servings ? consumed / servings : 0,
    unknownIngredients: unknownIngredients.size,
    list, perEntry,
  };
}

export function formatDuration(min) {
  const m = Math.round(Number(min) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}
