"use client";

import { useId, useState, type ReactNode } from "react";

/** Lower case with accents dropped, so "nurburgring" finds "Nürburgring". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * A dropdown you can type into (D80): the list narrows as you type. A combobox in the ARIA sense —
 * arrow keys move, Enter picks, Escape closes the list (and only the list, not the dialog it is in).
 * The first option is always "no preference", so a choice can be taken back.
 */
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  noneLabel = "No preference",
  disabled = false,
  hint,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel?: string;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.id === value) ?? null;
  const matches = query.trim() === "" ? options : options.filter((o) => fold(o.name).includes(fold(query.trim())));
  const rows: { id: string | null; name: string }[] = [{ id: null, name: noneLabel }, ...matches];

  function choose(row: { id: string | null }) {
    onChange(row.id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-800">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={selected ? selected.name : noneLabel}
          value={open ? query : (selected?.name ?? "")}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(e.target.value.trim() === "" ? 0 : 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open) {
              e.preventDefault();
              const row = rows[active];
              if (row) choose(row);
            } else if (e.key === "Escape" && open) {
              // Close the list, not the booking panel around it.
              e.stopPropagation();
              setOpen(false);
              setQuery("");
            }
          }}
          className="h-11 w-full rounded-xl border border-line bg-night/60 pr-9 pl-3 text-ink-950 placeholder:text-ink-500 focus:border-flag focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-500" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {open ? (
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-deep py-1 shadow-2xl"
          >
            {rows.map((row, i) => (
              <li
                key={row.id ?? "none"}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={row.id === value}
                // mousedown, not click: a click would blur the input first and close the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(row);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-mist text-ink-950" : "text-ink-600"} ${row.id === null ? "text-ink-500" : ""}`}
              >
                {row.name}
                {row.id === value ? <span className="float-right text-flag">✓</span> : null}
              </li>
            ))}
            {matches.length === 0 ? <li className="px-3 py-2 text-sm text-ink-500">Nothing matches &ldquo;{query.trim()}&rdquo;</li> : null}
          </ul>
        ) : null}
      </div>
      {hint ? <span className="text-sm text-ink-500">{hint}</span> : null}
    </div>
  );
}
