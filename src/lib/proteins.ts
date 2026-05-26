const FLAG_TO_PROTEIN: Record<string, string> = {
  meat: "beef",
  poultry: "chicken",
  fish: "fish",
  shellfish: "seafood",
  egg: "eggs",
  dairy: "whey",
  soy: "tofu",
};

export function deriveProteinsFromIngredients(
  ingredients: Array<{ name?: string | null; dietaryFlags?: string[] | null }>,
): string[] {
  const derived = new Set<string>();
  for (const ing of ingredients) {
    for (const flag of ing.dietaryFlags ?? []) {
      const slug = FLAG_TO_PROTEIN[flag];
      if (slug) derived.add(slug);
    }
  }
  // Name-based overrides (more specific than dietary_flags alone)
  for (const ing of ingredients) {
    const n = (ing.name ?? "").toLowerCase();
    if (/salmon|salmão/.test(n)) {
      derived.add("salmon");
      derived.delete("fish");
    }
    if (/\btuna\b|atum/.test(n)) {
      derived.add("tuna");
      derived.delete("fish");
    }
    if (/\bpato\b|duck/.test(n)) {
      derived.add("duck");
      derived.delete("chicken");
    }
    if (/\bperu\b|turkey/.test(n)) {
      derived.add("turkey");
      derived.delete("chicken");
    }
    if (/\bporco\b|pork|leitão/.test(n)) {
      derived.add("pork");
      derived.delete("beef");
    }
    if (/vitela|veal/.test(n)) {
      derived.add("veal");
      derived.delete("beef");
    }
    if (/borrego|lamb/.test(n)) {
      derived.add("lamb");
      derived.delete("beef");
    }
    if (/camarão|shrimp|gambas/.test(n)) derived.add("seafood");
    if (/amêijoa|mexilhão|lula|squid|clam|mussel/.test(n))
      derived.add("seafood");
  }
  return [...derived];
}
