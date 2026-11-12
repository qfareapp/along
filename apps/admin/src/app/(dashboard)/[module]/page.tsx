import { notFound } from "next/navigation";
import { Categories } from "@/components/categories";
import { Matching } from "@/components/matching";
import { Roles, Settings, SystemHealth } from "@/components/operations";
import { Resource } from "@/components/resource";
import { SocialModeration } from "@/components/social";
import { AlongPlayAdmin } from "@/components/play";
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  if (module === "social") return <SocialModeration />;
  if (module === "along-play") return <AlongPlayAdmin />;
  if (module === "categories") return <Categories />;
  if (module === "matching") return <Matching />;
  if (module === "admin-roles") return <Roles />;
  if (module === "system-health") return <SystemHealth />;
  if (module === "settings") return <Settings />;
  if (["verification", "activities", "reports", "audit-logs"].includes(module))
    return <Resource module={module} />;
  notFound();
}
