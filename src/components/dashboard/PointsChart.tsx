"use client";

import { useSyncExternalStore } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/lib/format";
import { currentTheme, subscribeToTheme, type Theme } from "@/lib/theme";

export interface PointsChartPoint {
  date: string;
  points: number;
  /** True for a bonus award (game/monthly-champion/NSBE-Week) landing rather than a regular check-in — rendered as a distinct, larger dot so a +5 jump is legible against the stream of +1/+2/+3 event points. */
  isBonus?: boolean;
}

const CHART_TOKENS = {
  signal: "--signal",
  torch: "--torch",
  surface: "--surface",
  border: "--border",
  foreground: "--foreground",
  muted: "--muted",
} as const;

type ChartColors = Record<keyof typeof CHART_TOKENS, string>;

/**
 * Recharts writes colors into SVG attributes and its own inline tooltip styles
 * (with a hardcoded white tooltip background of its own), and nothing tells it
 * to re-render when the theme flips. So the chart resolves the globals.css
 * tokens to concrete values itself, and re-resolves whenever <html>'s theme
 * class changes. On the server, and during hydration, there is no computed
 * style to read, so it falls back to the var() references.
 */
function useChartColors(): ChartColors {
  const theme = useSyncExternalStore<Theme | null>(subscribeToTheme, currentTheme, () => null);
  const style = theme ? getComputedStyle(document.documentElement) : null;
  return Object.fromEntries(
    Object.entries(CHART_TOKENS).map(([key, token]) => [key, style?.getPropertyValue(token).trim() || `var(${token})`]),
  ) as ChartColors;
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: PointsChartPoint;
}

function renderDot({ cx, cy, payload }: DotProps, colors: ChartColors) {
  if (cx === undefined || cy === undefined) return <></>;
  if (payload?.isBonus) {
    return <circle cx={cx} cy={cy} r={5} fill={colors.torch} stroke={colors.surface} strokeWidth={1.5} />;
  }
  return <circle cx={cx} cy={cy} r={3} fill={colors.signal} />;
}

/**
 * Cumulative points, stepped rather than smoothed — points arrive in
 * discrete jumps (one event at a time), so a smooth curve would imply a
 * continuous rate that doesn't exist. Bonus awards get a distinct torch dot
 * (see renderDot) instead of blending into the regular event-point stream.
 */
export default function PointsChart({ data }: { data: PointsChartPoint[] }) {
  const colors = useChartColors();

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(v) => formatDate(new Date(String(v)))}
            tick={{ fontSize: 11, fill: colors.muted }}
            axisLine={{ stroke: colors.border }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: colors.muted }}
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
            contentStyle={{
              borderRadius: 8,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              color: colors.foreground,
              fontSize: 12,
            }}
            labelStyle={{ color: colors.foreground }}
            itemStyle={{ color: colors.foreground }}
            cursor={{ stroke: colors.border }}
          />
          <Line
            type="stepAfter"
            dataKey="points"
            stroke={colors.signal}
            strokeWidth={2}
            dot={(props: DotProps) => renderDot(props, colors)}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
