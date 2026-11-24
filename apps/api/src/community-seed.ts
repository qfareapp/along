import { Community } from "./community-models.js";
export const initialCommunities = [
  {
    name: "#TravelAlong",
    slug: "travel-along",
    category: "travel",
    icon: "airplane-outline",
    description:
      "Discover destinations, share travel stories, find travel companions, and plan your next adventure.",
  },
  {
    name: "#JamAlong",
    slug: "jam-along",
    category: "hangouts",
    icon: "cafe-outline",
    description:
      "Meet people who enjoy spontaneous hangouts, casual meetups, and making everyday moments more fun.",
  },
  {
    name: "#MusicAlong",
    slug: "music-along",
    category: "music",
    icon: "musical-notes-outline",
    description:
      "Connect through music, discover concerts, share playlists, and meet fellow music lovers.",
  },
  {
    name: "#FoodAlong",
    slug: "food-along",
    category: "food",
    icon: "restaurant-outline",
    description:
      "Discover great food, explore restaurants, share recommendations, and meet people over delicious experiences.",
  },
  {
    name: "#PlayAlong",
    slug: "play-along",
    category: "gaming",
    icon: "game-controller-outline",
    description:
      "Find gaming partners, organise game nights, and connect through friendly competition.",
  },
  {
    name: "#FitAlong",
    slug: "fit-along",
    category: "fitness",
    icon: "fitness-outline",
    description:
      "Find workout partners, explore active lifestyles, and stay motivated together.",
  },
];
export async function seedCommunities() {
  for (const community of initialCommunities)
    await Community.updateOne(
      { slug: community.slug },
      { $setOnInsert: community },
      { upsert: true },
    );
}
