"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/format";

export interface PointsChartPoint {
  date: string;
  points: number;
  /** True for a bonus award (game/monthly-champion/NSBE-Week) landing rather than a regular check-in — rendered as a distinct, larger dot so a +5 jump is legible against the stream of +1/+2/+3 event points. */
  isBonus?: boolean;
}

function renderDot(props: { cx?: number; cy?: number; payload?: PointsChartPoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined) return <></>;
  if (payload?.isBonus) {
    return <circle cx={cx} cy={cy} r={5} fill="var(--amber)" stroke="var(--surface)" strokeWidth={1.5} />;
  }
  return <circle cx={cx} cy={cy} r={3} fill="var(--signal)" />;
}

/**
 * Cumulative points, stepped rather than smoothed — points arrive in
 * discrete jumps (one event at a time), so a smooth curve would imply a
 * continuous rate that doesn't exist. Bonus awards get a distinct amber dot
 * (see renderDot) instead of blending into the regular event-point stream.
 */
export default function PointsChart({ data }: { data: PointsChartPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(v) => formatDate(new Date(String(v)))}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={{ stroke: "var(--line)" }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            labelFormatter={(v) => formatDate(new Date(String(v)))}
            formatter={(value, _name, item) => [
              `${value}${item?.payload?.isBonus ? " (bonus)" : ""}`,
              "Points",
            ] as [string, string]}
            contentStyle={{ borderRadius: 8, borderColor: "var(--line)", fontSize: 12 }}
          />
          <Line
            type="stepAfter"
            dataKey="points"
            stroke="var(--signal)"
            strokeWidth={2}
            dot={renderDot}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
