import React from "react";
import { PlanListing } from "../../features/Plans";
import { EligibilityGate } from "../../features/AlongHome";
export default function AllPlans() { return <EligibilityGate><PlanListing /></EligibilityGate>; }
