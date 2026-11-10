import { Category } from "./models.js";
export const defaultCategories = [
  ["commute", "Office Commute", "car-outline"],
  ["travel", "Travel & Holidays", "airplane-outline"],
  ["food", "Food & Dining", "restaurant-outline"],
  ["shopping", "Shopping", "bag-outline"],
  ["fitness", "Fitness & Wellness", "barbell-outline"],
  ["movies", "Movies & Entertainment", "film-outline"],
  ["hobbies", "Hobbies & Creativity", "color-palette-outline"],
  ["sports", "Sports", "football-outline"],
  ["learning", "Learning", "book-outline"],
  ["events", "Social Events", "ticket-outline"],
  ["culture", "Festivals & Culture", "sparkles-outline"],
  ["volunteering", "Community Volunteering", "heart-outline"],
];
export async function seedCategories() {
  for (const [slug, name, icon] of defaultCategories) {
    await Category.updateOne(
      { slug },
      { $setOnInsert: { name, icon, active: true } },
      { upsert: true },
    );
  }
}
export async function initializeCategories() {
  if (await Category.exists({})) return;
  await seedCategories();
}
