"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Input } from "@/components/ui";

/**
 * The home page's image tiles (D87): a title and an image each, in three sections. A tile with no
 * image shows a dark placeholder on the website, so a section can go live before its photos exist.
 */

type Section = "highlights" | "events" | "driving";

interface Tile {
  id: string;
  section: Section;
  title: string;
  imageUrl: string | null;
  sort: number;
  active: boolean;
}

const SECTIONS: { id: Section; title: string; description: string }[] = [
  { id: "highlights", title: "Under the hero", description: "The big 2×2 grid at the top of the home page. Wide images work best (5:3)." },
  { id: "events", title: "Book your event", description: "Kinds of session. Every tile takes the visitor to Book now. Wide images (5:3)." },
  { id: "driving", title: "Types of driving", description: "Shown only, not links. The bottom bar's Explore button lands here. Square images." },
];

export default function TilesPage() {
  const tiles = useApiData<{ tiles: Tile[] }>("/admin/site-tiles");
  const action = useAction();

  return (
    <>
      <PageHeader
        title="Home page tiles"
        description="The image tiles on the website's home page. Upload a JPEG, PNG or WebP up to 5 MB; the title is written across the middle of the image."
      />
      <ErrorNote error={tiles.error ?? action.error} />
      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <SectionCard key={section.id} section={section} tiles={(tiles.data?.tiles ?? []).filter((t) => t.section === section.id)} onChanged={tiles.reload} />
        ))}
      </div>
    </>
  );
}

function SectionCard({ section, tiles, onChanged }: { section: (typeof SECTIONS)[number]; tiles: Tile[]; onChanged: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [newTitle, setNewTitle] = useState("");

  /** Swap with the neighbour, then number the section 1, 2, 3… in that order, so ties can't reorder it. */
  const move = (i: number, by: -1 | 1) =>
    void action.run(async () => {
      const order = [...tiles];
      [order[i], order[i + by]] = [order[i + by]!, order[i]!];
      for (const [n, tile] of order.entries()) {
        if (tile.sort !== n + 1) await api(`/admin/site-tiles/${tile.id}`, { method: "PATCH", body: { sort: n + 1 } });
      }
      onChanged();
    });

  return (
    <Card title={section.title}>
      <p className="mb-4 text-sm text-ink-400">{section.description}</p>
      <ErrorNote error={action.error} />
      <ul className="divide-y divide-ink-800">
        {tiles.map((tile, i) => (
          <TileRow
            key={tile.id}
            tile={tile}
            busy={action.busy}
            first={i === 0}
            last={i === tiles.length - 1}
            onMove={(by) => move(i, by)}
            onChanged={onChanged}
          />
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api("/admin/site-tiles", { body: { section: section.id, title: newTitle.trim() } });
            setNewTitle("");
            onChanged();
          });
        }}
      >
        <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New tile title" aria-label={`New ${section.title} tile`} />
        <Button type="submit" disabled={action.busy || !newTitle.trim()}>
          Add tile
        </Button>
      </form>
    </Card>
  );
}

function TileRow({ tile, busy, first, last, onMove, onChanged }: { tile: Tile; busy: boolean; first: boolean; last: boolean; onMove: (by: -1 | 1) => void; onChanged: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [title, setTitle] = useState(tile.title);
  const disabled = busy || action.busy;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div
        className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-800 bg-cover bg-center text-xs text-ink-400"
        style={tile.imageUrl ? { backgroundImage: `url(${tile.imageUrl})` } : undefined}
      >
        {tile.imageUrl ? null : "No image"}
      </div>
      <div className="flex min-w-48 flex-1 gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Tile title" />
        {title.trim() !== tile.title ? (
          <Button
            size="sm"
            variant="primary"
            disabled={disabled || !title.trim()}
            onClick={() => void action.run(async () => (await api(`/admin/site-tiles/${tile.id}`, { method: "PATCH", body: { title: title.trim() } }), onChanged()))}
          >
            Save
          </Button>
        ) : null}
      </div>
      {tile.active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={disabled || first} onClick={() => onMove(-1)} aria-label={`Move ${tile.title} up`}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled || last} onClick={() => onMove(1)} aria-label={`Move ${tile.title} down`}>
          ↓
        </Button>
        <label className={`inline-flex h-9 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold ring-1 ring-ink-700 hover:bg-ink-800 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
          {tile.imageUrl ? "Change image" : "Upload image"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              void action.run(async () => {
                const form = new FormData();
                form.set("file", file);
                await api(`/admin/site-tiles/${tile.id}/image`, { body: form });
                onChanged();
              });
            }}
          />
        </label>
        {tile.imageUrl ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void action.run(async () => (await api(`/admin/site-tiles/${tile.id}/image`, { method: "DELETE" }), onChanged()))}>
            Remove image
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => void action.run(async () => (await api(`/admin/site-tiles/${tile.id}`, { method: "PATCH", body: { active: !tile.active } }), onChanged()))}
        >
          {tile.active ? "Turn off" : "Turn on"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            if (!confirm(`Delete the ${tile.title} tile? This cannot be undone.`)) return;
            void action.run(async () => (await api(`/admin/site-tiles/${tile.id}`, { method: "DELETE" }), onChanged()));
          }}
        >
          Delete
        </Button>
      </div>
      {action.error ? <p className="w-full text-sm text-red-300">{action.error}</p> : null}
    </li>
  );
}
