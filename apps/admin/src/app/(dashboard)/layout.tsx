import { Shell } from "@/components/shell";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Loading } from "@/components/common";
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </Shell>
  );
}
