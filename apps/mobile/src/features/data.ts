import type { ImageSourcePropType } from "react-native";
import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
export type IconName = ComponentProps<typeof Ionicons>["name"];
export type Plan = {
  audience?: import("../services/plans").PlanAudience;
  id: string;
  title: string;
  category: string;
  zone: string;
  time: string;
  description: string;
  need: string;
  people: number;
  image: ImageSourcePropType;
  creator: string;
  creatorId?: string;
  creatorPhotoId?: string | null;
  creatorVerified?: boolean;
  creatorOccupation?: string;
  type: "need" | "offer" | "together";
  startsAt?: string;
  ownerState?: "live" | "paused" | "successful";
  categoryDetails?: import("../../../../packages/plan-details/index.js").PlanDetails;
};
export const assets = {
  ananya: require("../../assets/brand/ananya-photo.png"),
  carpool: require("../../assets/brand/carpool.png"),
  coffee: require("../../assets/brand/coffee.png"),
  travel: require("../../assets/brand/travel.png"),
  welcome: require("../../assets/brand/welcome.png"),
  rohan: require("../../assets/brand/rohan.png"),
};
export const categories: {
  id: string;
  name: string;
  icon: IconName;
  label: string;
}[] = [
  {
    id: "commute",
    name: "Travel /\nCommute",
    icon: "car-sport",
    label: "Commute",
  },
  { id: "food", name: "Food & Dining", icon: "restaurant", label: "Food" },
  { id: "travel", name: "Travel & Trips", icon: "airplane", label: "Travel" },
  {
    id: "fitness",
    name: "Fitness & Sports",
    icon: "barbell",
    label: "Fitness",
  },
  { id: "shopping", name: "Shopping", icon: "bag-handle", label: "Shopping" },
  {
    id: "learning",
    name: "Hobbies &\nLearning",
    icon: "book",
    label: "Learning",
  },
  {
    id: "events",
    name: "Events &\nEntertainment",
    icon: "ticket",
    label: "Events",
  },
  {
    id: "hobbies",
    name: "Hobbies & Creativity",
    icon: "color-palette",
    label: "Hobbies",
  },
];
export const initialPlans: Plan[] = [
  {
    id: "carpool",
    title: "Office Carpool",
    category: "commute",
    zone: "Salt Lake → Sector V",
    time: "Mon – Fri · 9:00 AM",
    description:
      "One seat, good music and better company. I drive from Salt Lake to Sector V on weekday mornings. Happy to share fuel costs and a few stories along the way.",
    need: "1 spot left",
    people: 3,
    image: assets.carpool,
    creator: "Rohan",
    type: "offer",
  },
  {
    id: "coffee",
    title: "Coffee After Work",
    category: "food",
    zone: "Park Street",
    time: "Today · 6:00 PM",
    description:
      "Looking for a coffee partner to unwind with after work. Let’s find a cosy café on Park Street and see where the conversation takes us. Everyone pays for their own coffee.",
    need: "Looking for company",
    people: 3,
    image: assets.coffee,
    creator: "Ananya",
    type: "together",
  },
  {
    id: "weekend",
    title: "Weekend Getaway",
    category: "travel",
    zone: "Digha / Mandarmani",
    time: "Next weekend",
    description:
      "A little sea breeze, a long walk and a change of scenery. Looking for a travel partner for a relaxed weekend by the coast. Meet in a public place and plan together first.",
    need: "Looking for travel partner",
    people: 4,
    image: assets.travel,
    creator: "Arjun",
    type: "need",
  },
];
export type Person = {
  id: string;
  name: string;
  age: number;
  occupation: string;
  distance: string;
  tags: string[];
  bio: string;
  image: ImageSourcePropType;
  category: string;
};
export const people: Person[] = [
  {
    id: "ananya",
    name: "Ananya",
    age: 26,
    occupation: "Product Designer",
    distance: "5 km away",
    tags: ["Coffee", "Movies", "Weekend trips"],
    bio: "Love good food, spontaneous trips and meaningful conversations. Looking for a coffee partner, gym buddy and maybe more if the vibe is right. ☀️",
    image: assets.ananya,
    category: "Coffee & Food",
  },
  {
    id: "rohan",
    name: "Rohan",
    age: 27,
    occupation: "Software Engineer",
    distance: "3 km away",
    tags: ["Road trips", "Music", "Coffee"],
    bio: "Good playlists, early drives and finding little adventures in everyday life. Let’s make the commute the best part of the day.",
    image: assets.carpool,
    category: "Travel & Commute",
  },
];
