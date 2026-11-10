export const workingDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const field = (key, label, placeholder, extra = {}) => ({
  key,
  label,
  placeholder,
  required: true,
  ...extra,
});
const choice = (key, label, options) =>
  field(key, label, undefined, { kind: "choice", options });
const level = () =>
  choice("level", "Experience level", [
    "Beginner",
    "Intermediate",
    "Advanced",
    "All levels",
  ]);
const venue = () =>
  field("venue", "Venue or meeting area", "A public venue or approximate area");
const definitions = {
  commute: [
    field("source", "Starting area", "e.g. Salt Lake, Kolkata"),
    field("destination", "Office / destination area", "e.g. New Town, Kolkata"),
    field("departureTime", "Leaving home at", "08:30", { kind: "time" }),
    field("returnTime", "Leaving office for home at", "18:30", {
      kind: "time",
    }),
    field("workingDays", "Working days", undefined, {
      kind: "days",
      options: workingDays,
    }),
    choice("transport", "How will you commute?", [
      "Carpool",
      "Public transport",
      "Cab sharing",
      "Bike / cycle",
      "Walk",
      "Decide together",
    ]),
  ],
  travel: [
    field("departureArea", "Starting city / area", "e.g. Kolkata"),
    field("destination", "Travel destination", "e.g. Darjeeling"),
    field("returnDate", "Return date", "YYYY-MM-DD", { kind: "date" }),
    choice("transport", "Travel mode", [
      "Train",
      "Flight",
      "Road trip",
      "Bus",
      "Decide together",
    ]),
    field(
      "stay",
      "Stay preferences (optional)",
      "e.g. Separate rooms, hotel or homestay",
      { required: false },
    ),
  ],
  food: [
    choice("meal", "Meal or outing", [
      "Coffee / tea",
      "Breakfast",
      "Lunch",
      "Dinner",
      "Street food",
      "Decide together",
    ]),
    field(
      "cuisine",
      "Cuisine / food preference",
      "e.g. Bengali, vegetarian, open to anything",
    ),
    venue(),
    field("dietary", "Dietary needs (optional)", "e.g. Vegetarian, allergies", {
      required: false,
    }),
  ],
  shopping: [
    field(
      "shoppingFor",
      "What are you shopping for?",
      "e.g. Clothes, books, groceries",
    ),
    field("shoppingArea", "Market / mall / shopping area", "e.g. New Market"),
    choice("shoppingStyle", "Shopping plan", [
      "Browse together",
      "Help me choose",
      "Shop for essentials",
      "Explore a market",
    ]),
  ],
  fitness: [
    field(
      "workout",
      "Workout / wellness activity",
      "e.g. Yoga, gym, morning walk",
    ),
    venue(),
    level(),
    field("duration", "Duration in minutes", "60", { kind: "number" }),
  ],
  movies: [
    field(
      "movie",
      "Movie / show / entertainment",
      "e.g. A movie title or live comedy",
    ),
    venue(),
    choice("format", "Format", [
      "Cinema",
      "Live show",
      "Concert",
      "Other public screening",
    ]),
  ],
  hobbies: [
    field(
      "activity",
      "Creative activity / hobby",
      "e.g. Painting, photography, music",
    ),
    venue(),
    level(),
    field(
      "materials",
      "Materials to bring (optional)",
      "e.g. Sketchbook and pencils",
      { required: false },
    ),
  ],
  sports: [
    field("sport", "Sport", "e.g. Badminton, football, tennis"),
    venue(),
    level(),
    field(
      "equipment",
      "Equipment / booking details (optional)",
      "e.g. Bring a racket; court booked",
      { required: false },
    ),
  ],
  learning: [
    field(
      "subject",
      "What will you learn or study?",
      "e.g. Spanish, coding, exam preparation",
    ),
    choice("learningMode", "Learning format", [
      "Study together",
      "Practice together",
      "Teach / mentor",
      "Attend a class",
    ]),
    venue(),
    level(),
  ],
  events: [
    field("event", "Event name", "e.g. Weekend board game meetup"),
    venue(),
    choice("eventType", "Type of event", [
      "Meetup",
      "Community gathering",
      "Workshop",
      "Public celebration",
      "Other",
    ]),
  ],
  culture: [
    field(
      "occasion",
      "Festival / cultural occasion",
      "e.g. Durga Puja, museum visit",
    ),
    venue(),
    field(
      "participation",
      "What will you do together?",
      "e.g. Visit pandals, explore an exhibition",
    ),
  ],
  volunteering: [
    field(
      "cause",
      "Cause / volunteering activity",
      "e.g. Community cleanup, food distribution",
    ),
    field("meetingPoint", "Public meeting area", "e.g. Park entrance"),
    field("commitment", "Time commitment", "e.g. Two hours on Saturday"),
    field(
      "organization",
      "Organization (optional)",
      "e.g. A local community group",
      { required: false },
    ),
  ],
};
export function fieldsForCategory(category) {
  return Object.hasOwn(definitions, category)
    ? definitions[category]
    : [
        field(
          "meetingPoint",
          "Public meeting area",
          "e.g. A cafe or park entrance",
        ),
      ];
}
export function validatePlanDetails(category, details) {
  const fields = fieldsForCategory(category);
  const errors = {};
  for (const key of Object.keys(details)) {
    if (!fields.some((item) => item.key === key))
      Object.defineProperty(errors, key, {
        value: "This field does not belong to the selected category.",
        enumerable: true,
      });
  }
  for (const item of fields) {
    const value = details[item.key];
    if (item.kind === "days") {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.some((day) => !workingDays.includes(day)) ||
        new Set(value).size !== value.length
      )
        errors[item.key] = "Choose at least one working day.";
      continue;
    }
    if (value === undefined || value === "") {
      if (item.required)
        errors[item.key] = `Enter ${item.label.toLowerCase()}.`;
      continue;
    }
    if (typeof value !== "string" || !value.trim() || value.length > 300)
      errors[item.key] = "Enter between 1 and 300 characters.";
    else if (item.kind === "choice" && !item.options.includes(value))
      errors[item.key] = "Choose one of the available options.";
    else if (item.kind === "time" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      errors[item.key] = "Use 24-hour time, e.g. 08:30.";
    else if (
      item.kind === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(+new Date(`${value}T00:00:00Z`)) ||
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    )
      errors[item.key] = "Enter a valid date as YYYY-MM-DD.";
    else if (
      item.kind === "number" &&
      (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1440)
    )
      errors[item.key] = "Enter a whole number between 1 and 1440.";
  }
  return errors;
}
