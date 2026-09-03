"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import { inputClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/format";
import type { EventResponseRow } from "@/lib/repo";

type SortKey = "name" | "timestamp" | "points";

function SortButton({
  label,
  sortField,
  activeKey,
  desc,
  onToggle,
}: {
  label: string;
  sortField: SortKey;
  activeKey: SortKey;
  desc: boolean;
  onToggle: (key: SortKey) => void;
}) {
  return (
    <button type="button" onClick={() => onToggle(sortField)} className="inline-flex items-center gap-1">
      {label}
      {activeKey === sortField ? desc ? <ArrowDown size={12} /> : <ArrowUp size={12} /> : null}
    </button>
  );
}

export default function ResponsesTable({ responses, fieldKeys, fieldLabels }: { responses: EventResponseRow[]; fieldKeys: string[]; fieldLabels: string[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDesc, setSortDesc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = responses.filter(
      (r) => !q || `${r.firstName} ${r.lastName} ${r.email}`.toLowerCase().includes(q),
    );
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`);
      else if (sortKey === "timestamp") cmp = (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0);
      else cmp = a.pointsAwarded - b.pointsAwarded;
      return sortDesc ? -cmp : cmp;
    });
  }, [responses, search, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email"
        className={inputClass}
      />

      {filtered.length === 0 ? (
        <EmptyState title="No responses" description="Nobody has checked in yet." />
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>
              <SortButton label="Member" sortField="name" activeKey={sortKey} desc={sortDesc} onToggle={toggleSort} />
            </th>
            <th className={thClass}>
              <SortButton label="Time" sortField="timestamp" activeKey={sortKey} desc={sortDesc} onToggle={toggleSort} />
            </th>
            <th className={thClass}>
              <SortButton label="Points" sortField="points" activeKey={sortKey} desc={sortDesc} onToggle={toggleSort} />
            </th>
            {fieldLabels.map((label, i) => (
              <th key={fieldKeys[i]} className={thClass}>
                {label}
              </th>
            ))}
          </Thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className={tdClass}>
                  {r.firstName} {r.lastName}
                  <div className="text-xs text-muted">{r.email}</div>
                </td>
                <td className={tdClass}>{formatDateTime(r.timestamp)}</td>
                <td className={`${tdClass} numeric`}>{r.pointsAwarded}</td>
                {fieldKeys.map((key) => (
                  <td key={key} className={tdClass}>
                    {r.answers[key] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
