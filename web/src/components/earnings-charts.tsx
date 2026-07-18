"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EarnEvent } from "@/lib/adapters/types";
import { AssetIcon } from "@/components/asset-icon";
import { assetChartColor } from "@/lib/asset-color";
import {
  chartDisplayUnit,
  earningsByCurrency,
  earningsByYear,
  earningsOverTime,
  hasChartData,
  type ConvertAmount,
  type EarningsChartOptions,
} from "@/lib/earnings-charts";

export interface EarningsChartsProps {
  events: EarnEvent[];
  /**
   * Optional display-currency conversion (wire from EUR/USD/BTC/ETH selector).
   * When omitted, charts use native Number(amount) — fine for single-asset ledgers.
   */
  convertAmount?: ConvertAmount;
  displayCurrency?: string;
}

function formatTick(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="chart-card">
      <header className="chart-card-head">
        <h2>{title}</h2>
        {subtitle ? <p className="chart-card-sub">{subtitle}</p> : null}
      </header>
      <div className="chart-card-body">{children}</div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <p className="chart-empty">{label}</p>;
}

function tooltipStyle(): CSSProperties {
  return {
    background: "#0c1524",
    border: "1px solid color-mix(in oklab, #8a9bb0 40%, transparent)",
    borderRadius: 0,
    fontSize: "0.8rem",
    color: "#e8eef6",
  };
}

export function EarningsCharts({
  events,
  convertAmount,
  displayCurrency,
}: EarningsChartsProps) {
  const opts: EarningsChartOptions = useMemo(
    () => ({ convertAmount, displayCurrency }),
    [convertAmount, displayCurrency],
  );
  const unit = chartDisplayUnit(opts);
  const ready = hasChartData(events);

  const overTime = useMemo(
    () => (ready ? earningsOverTime(events, opts) : []),
    [events, opts, ready],
  );
  const byYear = useMemo(
    () => (ready ? earningsByYear(events, opts) : []),
    [events, opts, ready],
  );
  const byCurrency = useMemo(
    () => (ready ? earningsByCurrency(events, opts) : []),
    [events, opts, ready],
  );

  const unitHint =
    unit === "native"
      ? "Native asset amounts (add a display-currency converter for mixed assets)"
      : `Values in ${unit}`;

  if (!ready) {
    return (
      <div className="charts">
        <ChartCard title="Earnings over time">
          <EmptyChart label="No earn events yet — sync a source to see the timeline." />
        </ChartCard>
        <div className="charts-row">
          <ChartCard title="Per year">
            <EmptyChart label="No yearly totals yet." />
          </ChartCard>
          <ChartCard title="By currency">
            <EmptyChart label="No asset breakdown yet." />
          </ChartCard>
        </div>
      </div>
    );
  }

  return (
    <div className="charts">
      <ChartCard title="Earnings over time" subtitle={`Cumulative · ${unitHint}`}>
        {overTime.length === 0 ? (
          <EmptyChart label="No dated earn events to plot." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={overTime}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="earnFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3dffa8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#3dffa8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="color-mix(in oklab, #8a9bb0 25%, transparent)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "#8a9bb0", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
              />
              <YAxis
                tick={{ fill: "#8a9bb0", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={formatTick}
              />
              <Tooltip
                contentStyle={tooltipStyle()}
                labelStyle={{ color: "#8a9bb0" }}
                formatter={(value, name) => [
                  formatTick(Number(value)),
                  name === "cumulative" ? "Cumulative" : "Period",
                ]}
              />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="#3dffa8"
                strokeWidth={2}
                fill="url(#earnFill)"
                name="cumulative"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="charts-row">
        <ChartCard title="Per year" subtitle={unitHint}>
          {byYear.length === 0 ? (
            <EmptyChart label="No yearly totals to plot." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={byYear}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="color-mix(in oklab, #8a9bb0 25%, transparent)"
                  vertical={false}
                />
                <XAxis
                  dataKey="year"
                  tick={{ fill: "#8a9bb0", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "#8a9bb0", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={formatTick}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
                  formatter={(value) => [formatTick(Number(value)), "Earned"]}
                />
                <Bar
                  dataKey="total"
                  fill="#3dffa8"
                  radius={[0, 0, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="By currency" subtitle={unitHint}>
          {byCurrency.length === 0 ? (
            <EmptyChart label="No asset breakdown to plot." />
          ) : (
            <div className="chart-pie-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={byCurrency}
                    dataKey="total"
                    nameKey="asset"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={78}
                    stroke="#05080f"
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    {byCurrency.map((slice) => (
                      <Cell
                        key={slice.asset}
                        fill={assetChartColor(slice.asset)}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle()}
                    formatter={(value, _name, item) => {
                      const asset =
                        (item?.payload as { asset?: string } | undefined)
                          ?.asset ?? "";
                      return [formatTick(Number(value)), asset];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <ul className="chart-legend">
                {byCurrency.map((slice) => (
                  <li key={slice.asset}>
                    <span
                      className="chart-legend-swatch"
                      style={{
                        background: assetChartColor(slice.asset),
                      }}
                    />
                    <AssetIcon symbol={slice.asset} size="sm" />
                    <span className="chart-legend-val mono">
                      {formatTick(slice.total)}
                      <span className="chart-legend-pct">
                        {" "}
                        ({(slice.share * 100).toFixed(0)}%)
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
