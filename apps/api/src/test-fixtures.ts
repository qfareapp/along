// Isolated database fixtures only. No public endpoint can set these eligibility fields.
import { Profile, ProfilePhoto } from "./models.js";
export async function eligibleProfile(user: unknown) {
  const photo = await ProfilePhoto.create({
    owner: user,
    bytes: Buffer.from("fixture-only"),
    contentType: "image/jpeg",
  });
  return Profile.findOneAndUpdate(
    { user },
    {
      $set: {
        city: "Kolkata",
        gender: "woman",
        photos: [String(photo._id)],
        "preferences.genders": ["woman", "man", "nonbinary", "self_described"],
        "preferences.minAge": 18,
        "preferences.maxAge": 100,
        "consents.termsAt": new Date(),
        "consents.guidelinesAt": new Date(),
        "onboarding.vibes": ["coffee_dates"],
        "onboarding.firstPlanIntent": "do_something",
        "onboarding.relationshipIntent": "meaningful",
        "onboarding.startedAt": new Date(),
        "onboarding.quickStartCompleted": true,
        "onboarding.quickStartCompletedAt": new Date(),
        "onboarding.personalityCompleted": true,
        "onboarding.fullyCompletedAt": new Date(),
        "onboarding.currentStage": "ready_for_discovery",
        "onboarding.currentStep": 6,
      },
    },
    { upsert: true, new: true },
  );
}
