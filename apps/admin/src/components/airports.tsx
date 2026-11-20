"use client";
import { useId, useState } from "react";
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
const radiusLabel = (metres: number) => metres < 1000 ? `${metres} m` : `${(metres / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} km`;

function AirportRow({ airport, onUpdated, onConfigure, disabled }: {
  airport: Airport;
  onUpdated: (airport: Airport) => void;
  onConfigure: () => void;
  disabled: boolean;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState<{ saved: number; value: number } | null>(null);
  const radius = draft?.saved === airport.radiusM ? draft.value : airport.radiusM;
  const setRadius = (value: number) => setDraft({ saved: airport.radiusM, value });
  const [saving, setSaving] = useState<"enabled" | "radius" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = radius !== airport.radiusM;
  async function update(kind: "enabled" | "radius") {
    if (saving || disabled) return;
    setSaving(kind); setError(""); setNotice("");
    try {
      const result = await api<Airport>(`/airports/${airport._id}/controls`, {
        method: "PATCH",
        body: JSON.stringify(kind === "enabled" ? { enabled: !airport.enabled } : { radiusM: radius }),
      });
      onUpdated(result);
      setNotice(kind === "radius" ? `Radius saved: ${radiusLabel(result.radiusM)}.` : `Airport ${result.enabled ? "enabled" : "disabled"}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update this airport. Please try again."); }
    finally { setSaving(null); }
  }
  return <section aria-label={airport.name} className="space-y-4 rounded-2xl border border-border bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold">{airport.iataCode || "No IATA"}</span>
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${airport.enabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{airport.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <h2 className="mt-2 text-base font-semibold break-words">{airport.name}</h2>
        {!!airport.city && <p className="mt-1 text-sm text-muted-foreground">{airport.city}</p>}
      </div>
      <Button variant={airport.enabled ? "outline" : "default"} aria-label={`${airport.enabled ? "Disable" : "Enable"} ${airport.name}`} aria-pressed={airport.enabled} disabled={disabled || !!saving} onClick={() => void update("enabled")}>
        {saving === "enabled" ? "Saving…" : airport.enabled ? "Disable" : "Enable"}
      </Button>
    </div>
    <div className="rounded-xl bg-muted/40 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">Detection radius</label>
        <output htmlFor={inputId} className="text-base font-semibold text-primary">{radiusLabel(radius)}</output>
      </div>
      <input id={inputId} aria-label={`Radius for ${airport.name}`} aria-valuetext={radiusLabel(radius)} type="range" min={100} max={15000} step={1} value={radius} disabled={disabled || !!saving} onChange={e => { setRadius(Number(e.target.value)); setNotice(""); }} className="h-6 w-full cursor-pointer accent-[#015D5E] disabled:cursor-not-allowed" />
      <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>100 m</span><span>15 km</span></div>
      {airport.boundary?.length ? <p className="mt-2 text-xs text-muted-foreground">A verified boundary is active. This radius is used if the boundary is removed.</p> : <p className="mt-2 text-xs text-muted-foreground">Measured from the airport reference point. Coverage is approximate.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={disabled || !!saving || !dirty} onClick={() => void update("radius")}>{saving === "radius" ? "Saving…" : "Save radius"}</Button>
        {dirty && <Button size="sm" variant="ghost" disabled={disabled || !!saving} onClick={() => setRadius(airport.radiusM)}>Reset</Button>}
        <Button size="sm" variant="ghost" disabled={disabled || !!saving} onClick={onConfigure}>Advanced configuration</Button>
      </div>
    </div>
    {!!error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p role="status" className="text-sm text-emerald-800">{notice}</p>
  </section>;
}
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
        Enable airports individually and adjust their nearby detection radius.
        New airports start with one approximate nearby area for discovery and
        chat. Terminal-specific meeting areas can be configured later.
      </p>
      <p>
        {airports.data ? `${airports.data.length} locations · ${airports.data.filter(a => a.enabled).length} enabled` : "Changes are saved separately for each airport."}
      </p>
      <input
        className="w-full rounded-xl border p-3"
        aria-label="Search airports"
        placeholder="Airport, city or IATA code"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {airports.isPending && <p>Loading airports…</p>}
      {airports.isError && <div><p role="alert">{airports.error.message}</p><Button variant="outline" onClick={() => void airports.refetch()}>Try again</Button></div>}
      {!!error && <p role="alert">{error}</p>}
      {selected && (
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <h2 className="font-semibold">Configure {selected.name}</h2>
          <p>
            Fields: enabled, radiusM (default 1000 = 1 km), configurationSource,
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
            <AirportRow
              key={a._id}
              airport={a}
              disabled={busy || selected?._id === a._id}
              onConfigure={() => edit(a)}
              onUpdated={updated => client.setQueryData<Airport[]>(["admin-airports"], current => current?.map(item => item._id === updated._id ? updated : item))}
            />
          ))}
      </div>
    </div>
  );
}
