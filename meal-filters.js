export function isVeganMeal(meal) {
  return Array.isArray(meal.notes) && meal.notes.some((note) =>
    typeof note === 'string' && /^Menü ist vegan$/i.test(note.trim()));
}

export function isVegetarianMeal(meal) {
  return isVeganMeal(meal) || (Array.isArray(meal.notes) && meal.notes.some((note) =>
    typeof note === 'string' && /^Menü ist vegetarisch$/i.test(note.trim())));
}

export function dietaryCategory(meal) {
  if (isVeganMeal(meal)) return 'vegan';
  if (isVegetarianMeal(meal)) return 'vegetarian';
  // Unlabelled dishes belong here too: absence of a vegetarian label is not
  // proof that a dish contains meat. The UI explains this provider limitation.
  return 'meat';
}

export function mealTitleCodes(meal) {
  const codes = new Set();
  if (typeof meal.name !== 'string') return codes;
  for (const group of meal.name.matchAll(/\(([^()]*)\)/g)) {
    const tokens = group[1].split(/[,;]/).map((token) => token.trim().toUpperCase());
    // Only complete code lists count. Do not interpret prose, quantities,
    // arbitrary letters in a dish name, or the provider's "(-)" as allergens.
    if (tokens.every((token) => /^(?:[A-Z]\d*|\d+)$/.test(token))) {
      tokens.forEach((token) => codes.add(token));
    }
  }
  return codes;
}

export function matchesMealFilters(meal, categories, excludedCodes) {
  return categories.has(dietaryCategory(meal)) &&
    ![...mealTitleCodes(meal)].some((code) => excludedCodes.has(code));
}
