"use client";

import { useState } from "react";
import { Badge, Card, PageHeader, Table, Td, useAction, useApiData } from "@/components/admin/kit";
import { usePos } from "@/components/pos-provider";
import { Button, ErrorNote, Field, Input, Modal } from "@/components/ui";

interface StaffMember {
  id: string;
  display_name: string;
  role: "superadmin" | "cashier";
  active: boolean;
  email: string | null;
}

export default function StaffPage() {
  const { data, error, reload } = useApiData<{ staff: StaffMember[] }>("/admin/staff");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const staff = (data?.staff ?? []).slice().sort((a, b) => Number(b.active) - Number(a.active) || a.display_name.localeCompare(b.display_name));

  return (
    <>
      <PageHeader
        title="Staff"
        description="Each person has their own sign-in and 4-digit PIN, so every sale and change is recorded against them."
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add staff
          </Button>
        }
      />
      <ErrorNote error={error} />
      <Card>
        <Table head={["Name", "Email", "Role", "Status", ""]}>
          {staff.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.display_name}</Td>
              <Td className="text-ink-400">{s.email}</Td>
              <Td>{s.role === "superadmin" ? <Badge tone="blue">Superadmin</Badge> : <Badge tone="grey">Cashier</Badge>}</Td>
              <Td>{s.active ? <Badge tone="green">Active</Badge> : <Badge tone="grey">Inactive</Badge>}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  Edit
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {adding ? (
        <AddStaffDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}
      {editing ? (
        <EditStaffDialog
          staff={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function AddStaffDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [f, setF] = useState({ displayName: "", email: "", password: "", role: "cashier" as "cashier" | "superadmin", pin: "" });
  const set = (k: "displayName" | "email" | "password" | "pin") => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: k === "pin" ? e.target.value.replace(/\D/g, "").slice(0, 4) : e.target.value }));
  return (
    <Modal title="Add staff" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={f.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Email (for signing in a device)">
          <Input type="email" value={f.email} onChange={set("email")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password" hint="At least 8 characters">
            <Input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" />
          </Field>
          <Field label="4-digit PIN">
            <Input inputMode="numeric" value={f.pin} onChange={set("pin")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["cashier", "superadmin"] as const).map((r) => (
            <Button key={r} variant={f.role === r ? "primary" : "secondary"} onClick={() => setF((x) => ({ ...x, role: r }))}>
              {r === "cashier" ? "Cashier" : "Superadmin"}
            </Button>
          ))}
        </div>
        <ErrorNote error={action.error} />
        <Button
          variant="primary"
          className="w-full"
          disabled={action.busy || !f.displayName.trim() || !f.email.includes("@") || f.password.length < 8 || f.pin.length !== 4}
          onClick={() =>
            void action.run(async () => {
              await api("/admin/staff", { body: { ...f, displayName: f.displayName.trim(), email: f.email.trim() } });
              onSaved();
            })
          }
        >
          Add {f.role}
        </Button>
      </div>
    </Modal>
  );
}

function EditStaffDialog({ staff, onClose, onSaved }: { staff: StaffMember; onClose: () => void; onSaved: () => void }) {
  const { api } = usePos();
  const action = useAction();
  const [name, setName] = useState(staff.display_name);
  const [pin, setPin] = useState("");
  const save = (body: Record<string, unknown>) =>
    action.run(async () => {
      await api(`/admin/staff/${staff.id}`, { method: "PATCH", body });
      onSaved();
    });
  return (
    <Modal title={staff.display_name} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input className="flex-1" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <Button disabled={action.busy || !name.trim() || name.trim() === staff.display_name} onClick={() => void save({ displayName: name.trim() })}>
            Rename
          </Button>
        </div>
        <div className="flex gap-2">
          <Input className="flex-1" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="New 4-digit PIN" aria-label="New PIN" />
          <Button disabled={action.busy || pin.length !== 4} onClick={() => void save({ pin, reason: "PIN reset in back office" })}>
            Reset PIN
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-ink-800 pt-4">
          <Button disabled={action.busy} onClick={() => void save({ role: staff.role === "cashier" ? "superadmin" : "cashier" })}>
            Make {staff.role === "cashier" ? "superadmin" : "cashier"}
          </Button>
          <Button variant={staff.active ? "danger" : "secondary"} disabled={action.busy} onClick={() => void save({ active: !staff.active })}>
            {staff.active ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
        <ErrorNote error={action.error} />
      </div>
    </Modal>
  );
}
