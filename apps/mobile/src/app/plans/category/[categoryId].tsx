import React from "react";
import { useLocalSearchParams } from "expo-router";
import { PlanListing } from "../../../features/Plans";
import { EligibilityGate } from "../../../features/AlongHome";
export default function CategoryPlans() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  return <EligibilityGate><PlanListing category={categoryId} /></EligibilityGate>;
}
