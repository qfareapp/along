export type Session = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  csrf: string;
  authMode?: "mfa" | "env";
};
export type Page<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};
export type User = {
  _id: string;
  name: string;
  email: string;
  status: string;
  emailVerified: boolean;
  identityVerified: boolean;
  restrictions?: { posting: boolean; messaging: boolean };
  createdAt: string;
  lastActiveAt?: string;
  profile?: { city?: string; area?: string; onboardingComplete?: boolean };
};
export type Audit = {
  _id: string;
  admin?: { name: string };
  action: string;
  targetType: string;
  targetId?: string;
  reason?: string;
  createdAt: string;
  outcome: string;
  requestId?: string;
};
export type UserDetail = {
  onboarding?: {
    state: string;
    checks: Record<string, boolean>;
    eligible: boolean;
    currentStep: number;
    quickStartCompleted: boolean;
  };
  user: User;
  profile?: {
    bio?: string;
    occupation?: string;
    city?: string;
    area?: string;
    interests: string[];
    onboardingComplete: boolean;
  };
  activities: {
    _id: string;
    title: string;
    category: string;
    status: string;
  }[];
  matchCount: number;
  history: Audit[];
};
export type Dashboard = {
  scope: { from: string; to: string; city: string; category: string };
  metrics: Record<string, number | null>;
  growth: { date: string; users: number }[];
  categories: { name: string; count: number }[];
  geography: { _id: string; count: number }[];
  severity: { _id: string; count: number }[];
  recent: Audit[];
  notes: { activity: string; billing: string };
};
export type Category = {
  coverAssetKey?: string;
  coverImageUrl?: string;
  liveCount?: number;
  _id: string;
  name: string;
  slug: string;
  active: boolean;
  icon: string;
  description?: string;
  displayOrder: number;
  cities: string[];
  riskLevel: string;
  allowedTypes: string[];
  moderationRequired: boolean;
};
export type Activity = {
  _id: string;
  title: string;
  description: string;
  category: string;
  type: string;
  zone: string;
  startsAt: string;
  budget?: string;
  status: string;
  creator?: { _id: string; name: string; status: string };
};
export type Verification = {
  _id: string;
  user?: { name: string; email: string };
  type: string;
  status: string;
  providerReference?: string;
  createdAt: string;
};
export type Report = {
  _id: string;
  reporter?: { name: string };
  target?: { name: string; _id: string };
  reason: string;
  status: string;
  severity: string;
  createdAt: string;
  notes?: { text: string; at: string }[];
};
