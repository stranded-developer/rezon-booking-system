"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";

/**
 * Games, tracks and cars (D80): what a customer can ask to drive when they book a simulator.
 * A preference for staff to set the rig up, never part of the price.
 */

interface Game {
  id: string;
  resource_type_id: string;
  name: string;
  sort: number;
  active: boolean;
  tracks: string[];
  cars: string[];
}

interface ResourceType {
  id: string;
  name: string;
  active: boolean;
}

/** One per line; blank lines ignored. */
const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export default function GamesPage() {
  const games = useApiData<{ games: Game[] }>("/admin/games");
  const types = useApiData<{ resourceTypes: ResourceType[] }>("/admin/resource-types");
  const [editing, setEditing] = useState<Game | null>(null);
  const [adding, setAdding] = useState(false);
  const { api } = usePos();
  const action = useAction();
  const activeTypes = (types.data?.resourceTypes ?? []).filter((t) => t.active);
  const typeName = (id: string) => types.data?.resourceTypes.find((t) => t.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader
        title="Games, tracks & cars"
        description="When someone books a simulator they can tick “pick your game, track and car” and choose from these lists. Staff see their choice on the booking. It never changes the price."
        actions={<Button onClick={() => setAdding(true)}>Add game</Button>}
      />
      <ErrorNote error={games.error ?? types.error ?? action.error} />

      <Card>
        <Table head={["Game", "For", "Tracks", "Cars", "", ""]} empty={games.data !== null && games.data.games.length === 0}>
          {(games.data?.games ?? []).map((g) => (
            <tr key={g.id}>
              <Td className="font-medium">{g.name}</Td>
              <Td className="text-ink-400">{typeName(g.resource_type_id)}</Td>
              <Td className="tnum text-ink-400">{g.tracks.length}</Td>
              <Td className="tnum text-ink-400">{g.cars.length}</Td>
              <Td>{g.active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}</Td>
              <Td>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={action.busy}
                    onClick={() => void action.run(async () => (await api(`/admin/games/${g.id}`, { method: "PATCH", body: { active: !g.active } }), games.reload()))}
                  >
                    {g.active ? "Turn off" : "Turn on"}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-sm text-ink-400">
          A game that is off is not offered on the website. Bookings already made keep the game, track and car they chose.
        </p>
      </Card>

      {(adding || editing) && (
        <GameDialog
          game={editing ?? undefined}
          types={activeTypes}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            games.reload();
          }}
        />
      )}
    </>
  );
}

function GameDialog({ game, types, onClose, onSaved }: { game?: Game; types: ResourceType[]; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [name, setName] = useState(game?.name ?? "");
  // Simulators first: that is what games are for.
  const [typeId, setTypeId] = useState(game?.resource_type_id ?? types.find((t) => /sim/i.test(t.name))?.id ?? types[0]?.id ?? "");
  const [sort, setSort] = useState(String(game?.sort ?? 100));
  const [tracks, setTracks] = useState((game?.tracks ?? []).join("\n"));
  const [cars, setCars] = useState((game?.cars ?? []).join("\n"));
  const [reason, setReason] = useState("");
  const sortOk = /^\d+$/.test(sort);

  return (
    <Modal title={game ? `Edit ${game.name}` : "Add game"} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_6rem]">
          <Field label="Game">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Assetto Corsa Competizione" />
          </Field>
          <Field label="Offered on">
            <select
              value={typeId}
              disabled={game !== undefined}
              onChange={(e) => setTypeId(e.target.value)}
              className="h-11 rounded-lg bg-ink-900 px-3 ring-1 ring-ink-700 disabled:opacity-60"
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Order" hint="Lower first">
            <Input inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tracks" hint="One per line, in the order to list them.">
            <textarea value={tracks} onChange={(e) => setTracks(e.target.value)} rows={12} className="w-full rounded-lg bg-ink-900 p-3 text-sm ring-1 ring-ink-700" />
          </Field>
          <Field label="Cars" hint="One per line, in the order to list them.">
            <textarea value={cars} onChange={(e) => setCars(e.target.value)} rows={12} className="w-full rounded-lg bg-ink-900 p-3 text-sm ring-1 ring-ink-700" />
          </Field>
        </div>
        <Field label="Reason (optional)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        <ErrorNote error={action.error} />

        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !name.trim() || !typeId || !sortOk}
          onClick={() =>
            void action.run(async () => {
              const payload = {
                name: name.trim(),
                sort: Number(sort),
                tracks: lines(tracks),
                cars: lines(cars),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              };
              if (game) await api(`/admin/games/${game.id}`, { method: "PATCH", body: payload });
              else await api("/admin/games", { body: { ...payload, resourceTypeId: typeId } });
              onSaved();
            })
          }
        >
          {game ? "Save game" : "Add game"}
        </Button>
      </div>
    </Modal>
  );
}
