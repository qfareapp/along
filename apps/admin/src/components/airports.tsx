"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "./ui/button";

type Airport = {
  _id: string;
  name: string;
  city: string;
  iataCode: string;
  enabled: boolean;
  radiusM: number;
  configurationSource?: string;
  boundary?: number[][];
  zones: { id: string; name: string; compatibleWith: string[] }[];
};
export function AirportManagement() {
  const client = useQueryClient();
  const airports = useQuery({
    queryKey: ["admin-airports"],
    queryFn: () => api<Airport[]>("/airports"),
  });
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Airport | null>(null),
    [configuration, setConfiguration] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function edit(airport: Airport) {
    setSelected(airport);
    setReason("");
    setError("");
    setConfiguration(
      JSON.stringify(
        {
          enabled: airport.enabled,
          radiusM: airport.radiusM,
          configurationSource: airport.configurationSource ?? "",
          boundary: airport.boundary ?? null,
          zones: airport.zones,
        },
        null,
        2,
      ),
    );
  }
  async function save() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api(`/airports/${selected._id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...JSON.parse(configuration), reason }),
      });
      await client.invalidateQueries({ queryKey: ["admin-airports"] });
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save airport.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Airport Mode</h1>
      <p>
        Imported airports stay disabled until configured. Use verified terminal
        and zone information. A reference-point radius is approximate; it is not
        an airport boundary or proof of terminal access.
      </p>
      <p>
        Import the supplied data using the API airports:import command. This
        screen never imports or enables airports automatically.
      </p>
      <input
        className="w-full rounded-xl border p-3"
        aria-label="Search airports"
        placeholder="Airport, city or IATA code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {airports.isPending && <p>Loading airports…</p>}
      {airports.isError && <p role="alert">{airports.error.message}</p>}
      {!!error && <p role="alert">{error}</p>}
      {selected && (
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <h2 className="font-semibold">Configure {selected.name}</h2>
          <p>
            Fields: enabled, radiusM (default 500), configurationSource,
            optional boundary ring [longitude, latitude], and zones with id,
            name, compatibleWith. List compatibility in both directions. An
            empty compatibility list permits chat only. Boundary checks include
            a 500-metre perimeter allowance.
          </p>
          <textarea
            className="min-h-80 w-full rounded-lg border p-3 font-mono"
            aria-label="Airport configuration JSON"
            value={configuration}
            onChange={(e) => setConfiguration(e.target.value)}
          />
          <input
            className="w-full rounded-lg border p-3"
            aria-label="Audit reason"
            placeholder="Reason for change (at least 10 characters)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-3">
            <Button
              disabled={busy || reason.trim().length < 10}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save configuration"}
            </Button>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      <div className="space-y-2">
        {airports.data
          ?.filter((a) =>
            `${a.name} ${a.city} ${a.iataCode}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((a) => (
            <div
              key={a._id}
              className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4"
            >
              <div>
                <strong>
                  {a.iataCode || "No IATA"} · {a.city}
                </strong>
                <p>{a.name}</p>
                <p>
                  {a.enabled ? "Enabled" : "Disabled"} · {a.zones.length}{" "}
                  configured zones
                </p>
              </div>
              <Button variant="outline" onClick={() => edit(a)}>
                Configure
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
