export const supportEmail: string;
export const policyVersion: string;
export const policies: Record<"terms" | "privacy" | "child-safety" | "delete-account", { title: string; sections: { title: string; body: string }[] }>;
