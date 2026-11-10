export type DetailField = {
  key: string;
  label: string;
  placeholder?: string;
  kind?: "time" | "date" | "number" | "choice" | "days";
  options?: string[];
  required?: boolean;
};
export type PlanDetails = Record<string, string | string[]>;
export const workingDays: string[];
export function fieldsForCategory(category: string): DetailField[];
export function validatePlanDetails(
  category: string,
  details: PlanDetails,
): Record<string, string>;
