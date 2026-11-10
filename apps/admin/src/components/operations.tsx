"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSession } from "./shell";
import { Badge, ErrorState, Loading, PageHeading } from "./common";
import { Button } from "./ui/button";
export function Roles() {
  const query = useQuery({
    queryKey: ["roles"],
    queryFn: () =>
      api<{
        roles: { slug: string; name: string; permissions: string[] }[];
        admins: {
          _id: string;
          name: string;
          email: string;
          adminRole: string;
          status: string;
        }[];
      }>("/roles"),
  });
  return (
    <>
      <PageHeading
        title="The people behind the care."
        description="Eight scoped administrative roles, checked by the shared API on every request."
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error.message} />
      ) : (
        query.data && (
          <>
            <div className="panel mb-6 table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Administrator</th>
                    <th>Role</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.admins.map((a) => (
                    <tr key={a._id}>
                      <td>
                        <p className="font-semibold">{a.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.email}
                        </p>
                      </td>
                      <td>{a.adminRole}</td>
                      <td>
                        <Badge value={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {query.data.roles.map((role) => (
                <div key={role.slug} className="panel p-6">
                  <h2 className="font-semibold">{role.name}</h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {role.permissions.map((p) => (
                      <span
                        key={p}
                        className="rounded-lg bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-muted-foreground">
              Role editing and invitation delivery are later-phase work. No
              public admin registration exists.
            </p>
          </>
        )
      )}
    </>
  );
}
export function SystemHealth() {
  const query = useQuery({
    queryKey: ["system-health"],
    queryFn: () => api<Record<string, string | number>>("/system-health"),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageHeading
        title="A healthy platform starts here."
        description="Live diagnostics from the same Express process serving the mobile application."
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState message={query.error.message} />
      ) : (
        query.data && (
          <div className="panel divide-y divide-border p-6">
            {Object.entries(query.data).map(([key, value]) => (
              <div
                key={key}
                className="flex flex-wrap justify-between gap-3 py-4 text-sm"
              >
                <span className="capitalize text-muted-foreground">
                  {key.replace(/([A-Z])/g, " $1")}
                </span>
                <span className="font-semibold">{String(value)}</span>
              </div>
            ))}
          </div>
        )
      )}
    </>
  );
}
export function Settings() {
  const session = useSession();
  const client = useQueryClient();
  const router = useRouter();
  async function revoke() {
    try {
      await api("/auth/revoke-sessions", { method: "POST" });
      client.clear();
      router.replace("/login");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not revoke sessions.",
      );
    }
  }
  return (
    <>
      <PageHeading
        title="Your workspace, securely."
        description="Manage your administrative session and review its security boundaries."
      />
      <div className="panel max-w-2xl space-y-5 p-7">
        <h2 className="text-lg font-semibold">{session.data?.name}</h2>
        <p className="text-sm text-muted-foreground">
          {session.data?.email} · {session.data?.role}
        </p>
        <div className="rounded-xl bg-[#e9efe8] p-4 text-xs leading-6 text-primary">
          {session.data?.authMode === "env"
            ? "Email and password sign-in is enabled."
            : "MFA is mandatory."}{" "}
          Sessions expire after 30 minutes of inactivity or 8 hours in total.
          Passwords, TOTP secrets and session tokens are never exposed by the
          admin profile API.
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          Revoking your sessions signs you out on every browser, including this
          one.{" "}
          {session.data?.authMode === "env"
            ? "Your platform operator manages login credentials."
            : "Lost your authenticator? Sign in with a one-time recovery code. Keep your codes offline and private."}
        </p>
        <Button
          variant="destructive"
          onClick={() => {
            void revoke();
          }}
        >
          Revoke all my sessions & sign out
        </Button>
      </div>
    </>
  );
}
