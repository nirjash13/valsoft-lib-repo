"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReportQuery } from "@/lib/domain/reporting/schema";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Download,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState, useTransition, useMemo } from "react";
import { askReportQuestion, getMoreAuditLogs } from "./actions";

interface ReportsClientViewProps {
  initialData: {
    overview: {
      kpis:
        | {
            active_loans: number;
            overdue_loans: number;
            holds_queued: number;
            signups_today: number;
          }
        | undefined;
      topCirculated: {
        book_id: string;
        title: string;
        authors: string[];
        checkout_count: number;
      }[];
      // Per-KPI 30-day daily series
      activeByDay: { date: string; active_count: number }[];
      overdueByDay: { date: string; overdue_count: number }[];
      holdsQueuedByDay: { date: string; holds_count: number }[];
      signupsByDay: { date: string; signup_count: number }[];
      // Drill-down detail sets
      drillActiveLoans: {
        loan_id: string;
        title: string;
        isbn: string;
        display_name: string;
        email: string;
        checked_out_at: string;
        due_at: string;
      }[];
      drillOverdueLoans: {
        loan_id: string;
        title: string;
        isbn: string;
        display_name: string;
        email: string;
        checked_out_at: string;
        due_at: string;
        days_overdue: number;
      }[];
      drillHoldsQueued: {
        hold_id: string;
        title: string;
        isbn: string;
        display_name: string;
        email: string;
        queued_at: string;
        status: string;
      }[];
      drillSignupsToday: {
        member_id: string;
        display_name: string;
        email: string;
        status: string;
        created_at: string;
      }[];
    };
    circulation: {
      circulationHistory: {
        date: string;
        checkout_count: number;
        return_count: number;
        hold_count: number;
      }[];
      topBorrowers: {
        member_id: string;
        display_name: string;
        email: string;
        loan_count: number;
        overdue_count: number;
      }[];
      topBooks: {
        book_id: string;
        title: string;
        isbn: string;
        checkout_count: number;
        hold_count: number;
        avg_loan_duration_days: number;
      }[];
      loanDurationStats:
        | {
            avg_loan_duration_days: number;
            max_loan_duration_days: number;
          }
        | undefined;
    };
    discovery: {
      zeroResultSearches: {
        query: string;
        search_count: number;
        last_searched_at: string;
      }[];
    };
    members: {
      statusStats: {
        status: string;
        count: number;
      }[];
      signupsHistory: {
        week_start: string;
        signup_count: number;
      }[];
      churnProxy: {
        member_id: string;
        display_name: string;
        email: string;
        created_at: string;
        last_activity_at: string | null;
      }[];
    };
    aiUsage: {
      p95LatencyMs: number | null;
      totalSpendUsd: number;
      monthlyCapUsd: number;
      refusals: {
        refusal_reason: string;
        refusal_count: number;
        sample_messages: string | null;
      }[];
      costByFeature: {
        feature: string;
        ai_cost_usd: string;
      }[];
      costByModel: {
        model: string;
        ai_cost_usd: string;
      }[];
      costByRole: {
        member_role: string;
        ai_cost_usd: string;
      }[];
    };
    audit: {
      logs: {
        id: string;
        actor_id: string | null;
        action: string;
        subject_type: string;
        subject_id: string | null;
        before_json: unknown;
        after_json: unknown;
        occurred_at: string;
      }[];
      nextCursor: string | undefined;
    };
  };
  platformData: {
    activeTenants: number;
    totalMau: number;
    platformAiCostUsd: number;
  } | null;
  isSystemOwner: boolean;
  lastRefreshed: string;
}

// ---------------------------------------------------------------------------
// Custom SVG Chart components (No External Deps)
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  width = 80,
  height = 32,
  color = "accent",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: "accent" | "success" | "danger" | "warning";
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  let colorStroke = "var(--accent)";
  if (color === "success") colorStroke = "var(--success)";
  if (color === "danger") colorStroke = "var(--danger)";
  if (color === "warning") colorStroke = "var(--warning)";

  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible"
      aria-hidden="true"
      style={{ color: `hsl(${colorStroke})` }}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

interface SvgMultiLineChartProps {
  data: {
    date: string;
    checkout_count: number;
    return_count: number;
    hold_count: number;
  }[];
}

function SvgMultiLineChart({ data }: SvgMultiLineChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { maxVal, checkoutPoints, returnPoints, holdPoints } = useMemo(() => {
    const maxVal = Math.max(
      ...data.flatMap((d) => [d.checkout_count, d.return_count, d.hold_count]),
      1,
    );

    const N = data.length;
    const checkoutPoints = data.map((d, i) => ({
      x: 50 + (i / (N - 1)) * 680,
      y: 20 + 200 - (d.checkout_count / maxVal) * 200,
    }));
    const returnPoints = data.map((d, i) => ({
      x: 50 + (i / (N - 1)) * 680,
      y: 20 + 200 - (d.return_count / maxVal) * 200,
    }));
    const holdPoints = data.map((d, i) => ({
      x: 50 + (i / (N - 1)) * 680,
      y: 20 + 200 - (d.hold_count / maxVal) * 200,
    }));

    return { maxVal, checkoutPoints, returnPoints, holdPoints };
  }, [data]);

  if (
    data.length === 0 ||
    checkoutPoints.length === 0 ||
    returnPoints.length === 0 ||
    holdPoints.length === 0
  ) {
    return <div className="text-center py-12 text-meta text-text-tertiary">No data available</div>;
  }

  const firstDateStr = data[0]?.date;
  const middleDateStr = data[Math.floor(data.length / 2)]?.date;
  const lastDateStr = data[data.length - 1]?.date;

  const firstDateFormatted = firstDateStr
    ? new Date(firstDateStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  const middleDateFormatted = middleDateStr
    ? new Date(middleDateStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  const lastDateFormatted = lastDateStr
    ? new Date(lastDateStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  const checkoutPath = checkoutPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const returnPath = returnPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const holdPath = holdPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  const checkoutArea = `${checkoutPath} L ${checkoutPoints[checkoutPoints.length - 1]?.x} 220 L ${checkoutPoints[0]?.x} 220 Z`;
  const returnArea = `${returnPath} L ${returnPoints[returnPoints.length - 1]?.x} 220 L ${returnPoints[0]?.x} 220 Z`;
  const holdArea = `${holdPath} L ${holdPoints[holdPoints.length - 1]?.x} 220 L ${holdPoints[0]?.x} 220 Z`;

  return (
    <div className="relative">
      <svg viewBox="0 0 760 250" className="w-full h-auto overflow-visible select-none">
        <title>Circulation History Multi Line Chart</title>
        <defs>
          <linearGradient id="checkoutGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="returnGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="holdGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = 20 + 200 * (1 - ratio);
          const val = Math.round(maxVal * ratio);
          return (
            <g key={ratio} className="opacity-20">
              <line
                x1="50"
                y1={y}
                x2="730"
                y2={y}
                stroke="hsl(var(--border-default))"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
              <text
                x="15"
                y={y + 4}
                className="text-[10px] font-mono fill-text-secondary"
                textAnchor="start"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Area segment backgrounds */}
        <path d={checkoutArea} fill="url(#checkoutGrad)" />
        <path d={returnArea} fill="url(#returnGrad)" />
        <path d={holdArea} fill="url(#holdGrad)" />

        {/* Lines */}
        <path
          d={checkoutPath}
          fill="none"
          stroke="hsl(var(--accent))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d={returnPath}
          fill="none"
          stroke="hsl(var(--success))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d={holdPath}
          fill="none"
          stroke="hsl(var(--warning))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Hover vertical line */}
        {hoveredIdx !== null && (
          <line
            x1={50 + (hoveredIdx / (data.length - 1)) * 680}
            y1="20"
            x2={50 + (hoveredIdx / (data.length - 1)) * 680}
            y2="220"
            stroke="hsl(var(--border-strong))"
            strokeWidth="1.5"
            strokeDasharray="2,2"
          />
        )}

        {/* Intersections/Points */}
        {hoveredIdx !== null && (
          <>
            <circle
              cx={checkoutPoints[hoveredIdx]?.x}
              cy={checkoutPoints[hoveredIdx]?.y}
              r="5"
              fill="hsl(var(--accent))"
              stroke="hsl(var(--bg-canvas))"
              strokeWidth="1.5"
            />
            <circle
              cx={returnPoints[hoveredIdx]?.x}
              cy={returnPoints[hoveredIdx]?.y}
              r="5"
              fill="hsl(var(--success))"
              stroke="hsl(var(--bg-canvas))"
              strokeWidth="1.5"
            />
            <circle
              cx={holdPoints[hoveredIdx]?.x}
              cy={holdPoints[hoveredIdx]?.y}
              r="5"
              fill="hsl(var(--warning))"
              stroke="hsl(var(--bg-canvas))"
              strokeWidth="1.5"
            />
          </>
        )}

        {/* Invisible tracking rects for hover */}
        {data.map((_, i) => {
          const stepWidth = 680 / (data.length - 1);
          const x = 50 + i * stepWidth - stepWidth / 2;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: tracking rects match data array indexes directly
              key={i}
              x={x}
              y="20"
              width={stepWidth}
              height="200"
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          );
        })}

        {/* X axis labels (first, middle, last) */}
        <text
          x="50"
          y="240"
          className="text-[10px] font-mono fill-text-secondary"
          textAnchor="middle"
        >
          {firstDateFormatted}
        </text>
        <text
          x="390"
          y="240"
          className="text-[10px] font-mono fill-text-secondary"
          textAnchor="middle"
        >
          {middleDateFormatted}
        </text>
        <text
          x="730"
          y="240"
          className="text-[10px] font-mono fill-text-secondary"
          textAnchor="middle"
        >
          {lastDateFormatted}
        </text>
      </svg>

      {/* Floating Tooltip HTML Overlay */}
      {hoveredIdx !== null && (
        <div
          className="absolute z-10 p-3 rounded-lg border border-border-subtle bg-elevated/95 backdrop-blur-md shadow-2 text-meta space-y-1 pointer-events-none"
          style={{
            left: `${Math.min(Math.max(10, (hoveredIdx / (data.length - 1)) * 100 - 10), 80)}%`,
            top: "-40px",
          }}
        >
          <p className="font-semibold border-b border-border-subtle pb-1 mb-1">
            {(() => {
              const hoveredDateStr = data[hoveredIdx]?.date;
              return hoveredDateStr
                ? new Date(hoveredDateStr).toLocaleDateString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "";
            })()}
          </p>
          <div className="flex items-center gap-2 justify-between">
            <span className="flex items-center gap-1.5 text-accent">
              <span className="w-2.5 h-2.5 rounded-full bg-accent" /> Checkouts
            </span>
            <span className="font-semibold text-text-primary">
              {data[hoveredIdx]?.checkout_count}
            </span>
          </div>
          <div className="flex items-center gap-2 justify-between">
            <span className="flex items-center gap-1.5 text-success">
              <span className="w-2.5 h-2.5 rounded-full bg-success" /> Returns
            </span>
            <span className="font-semibold text-text-primary">
              {data[hoveredIdx]?.return_count}
            </span>
          </div>
          <div className="flex items-center gap-2 justify-between">
            <span className="flex items-center gap-1.5 text-warning">
              <span className="w-2.5 h-2.5 rounded-full bg-warning" /> Holds
            </span>
            <span className="font-semibold text-text-primary">{data[hoveredIdx]?.hold_count}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface SvgSingleLineChartProps {
  data: {
    week_start: string;
    signup_count: number;
  }[];
}

function SvgSingleLineChart({ data }: SvgSingleLineChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { maxVal, points } = useMemo(() => {
    const maxVal = Math.max(...data.map((d) => d.signup_count), 1);
    const N = data.length;
    const points = data.map((d, i) => ({
      x: 50 + (i / (N - 1)) * 680,
      y: 20 + 200 - (d.signup_count / maxVal) * 200,
    }));
    return { maxVal, points };
  }, [data]);

  if (data.length === 0 || points.length === 0) {
    return <div className="text-center py-12 text-meta text-text-tertiary">No data available</div>;
  }

  const firstWeekStr = data[0]?.week_start;
  const middleWeekStr = data[Math.floor(data.length / 2)]?.week_start;
  const lastWeekStr = data[data.length - 1]?.week_start;

  const firstWeekFormatted = firstWeekStr
    ? new Date(firstWeekStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  const middleWeekFormatted = middleWeekStr
    ? new Date(middleWeekStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  const lastWeekFormatted = lastWeekStr
    ? new Date(lastWeekStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1]?.x} 220 L ${points[0]?.x} 220 Z`;

  return (
    <div className="relative">
      <svg viewBox="0 0 760 250" className="w-full h-auto overflow-visible select-none">
        <title>Member Signups Line Chart</title>
        <defs>
          <linearGradient id="singleGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.15" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = 20 + 200 * (1 - ratio);
          const val = Math.round(maxVal * ratio);
          return (
            <g key={ratio} className="opacity-20">
              <line
                x1="50"
                y1={y}
                x2="730"
                y2={y}
                stroke="hsl(var(--border-default))"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
              <text
                x="15"
                y={y + 4}
                className="text-[10px] font-mono fill-text-secondary"
                textAnchor="start"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Area */}
        <path d={areaPath} fill="url(#singleGrad)" />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="hsl(var(--accent))"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* Hover line */}
        {hoveredIdx !== null && (
          <line
            x1={50 + (hoveredIdx / (data.length - 1)) * 680}
            y1="20"
            x2={50 + (hoveredIdx / (data.length - 1)) * 680}
            y2="220"
            stroke="hsl(var(--border-strong))"
            strokeWidth="1.5"
            strokeDasharray="2,2"
          />
        )}

        {/* Interaction point */}
        {hoveredIdx !== null && (
          <circle
            cx={points[hoveredIdx]?.x}
            cy={points[hoveredIdx]?.y}
            r="5"
            fill="hsl(var(--accent))"
            stroke="hsl(var(--bg-canvas))"
            strokeWidth="1.5"
          />
        )}

        {/* Tracking rects */}
        {data.map((_, i) => {
          const stepWidth = 680 / (data.length - 1);
          const x = 50 + i * stepWidth - stepWidth / 2;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: tracking rects match data array indexes directly
              key={i}
              x={x}
              y="20"
              width={stepWidth}
              height="200"
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          );
        })}

        {/* X labels */}
        <text
          x="50"
          y="240"
          className="text-[10px] font-mono fill-text-secondary"
          textAnchor="middle"
        >
          {firstWeekFormatted}
        </text>
        <text
          x="390"
          y="240"
          className="text-[10px] font-mono fill-text-secondary"
          textAnchor="middle"
        >
          {middleWeekFormatted}
        </text>
        <text
          x="730"
          y="240"
          className="text-[10px] font-mono fill-text-secondary"
          textAnchor="middle"
        >
          {lastWeekFormatted}
        </text>
      </svg>

      {hoveredIdx !== null && (
        <div
          className="absolute z-10 p-2.5 rounded-lg border border-border-subtle bg-elevated/95 backdrop-blur-md shadow-2 text-meta pointer-events-none"
          style={{
            left: `${Math.min(Math.max(10, (hoveredIdx / (data.length - 1)) * 100 - 10), 80)}%`,
            top: "-35px",
          }}
        >
          <p className="font-semibold text-text-secondary">
            Week of {(() => {
              const hoveredWeekStr = data[hoveredIdx]?.week_start;
              return hoveredWeekStr
                ? new Date(hoveredWeekStr).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : "";
            })()}
          </p>
          <p className="text-text-primary text-body font-bold mt-0.5">
            {data[hoveredIdx]?.signup_count} signups
          </p>
        </div>
      )}
    </div>
  );
}

// Custom Bar Chart for dynamic NL queries
interface SvgBarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
}

function SvgBarChart({ data, xKey, yKey }: SvgBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { maxVal, bars } = useMemo(() => {
    const values = data.map((d) => Number(d[yKey]) || 0);
    const maxVal = Math.max(...values, 1);
    const N = data.length;

    const plotAreaWidth = 600;
    const barSpacing = plotAreaWidth / N;
    const barWidth = barSpacing * 0.6;

    const bars = data.map((d, i) => {
      const value = Number(d[yKey]) || 0;
      const h = (value / maxVal) * 180;
      return {
        x: 60 + i * barSpacing + (barSpacing - barWidth) / 2,
        y: 20 + 180 - h,
        w: barWidth,
        h,
        value,
        label: String(d[xKey] ?? ""),
      };
    });

    return { maxVal, bars };
  }, [data, xKey, yKey]);

  return (
    <div className="relative">
      <svg viewBox="0 0 680 230" className="w-full h-auto overflow-visible select-none">
        <title>Natural-Language Query Result Bar Chart</title>
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="1" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.4" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = 20 + 180 * (1 - ratio);
          const val =
            maxVal >= 10 ? Math.round(maxVal * ratio) : Number((maxVal * ratio).toFixed(1));
          return (
            <g key={ratio} className="opacity-20">
              <line
                x1="60"
                y1={y}
                x2="660"
                y2={y}
                stroke="hsl(var(--border-default))"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
              <text
                x="15"
                y={y + 4}
                className="text-[10px] font-mono fill-text-secondary"
                textAnchor="start"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {bars.map((bar, i) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: bars are directly mapped to query results indexing
            key={i}
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height={bar.h}
            rx="4"
            fill="url(#barGrad)"
            className="transition-quick hover:brightness-125 cursor-pointer"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}

        {/* X Labels */}
        {bars.map((bar, i) => {
          // Only show labels for every index if N is small, or skip labels if crowded
          const showLabel = bars.length <= 15 || i % Math.ceil(bars.length / 15) === 0;
          if (!showLabel) return null;
          return (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: bar labels mapped directly to coordinates
              key={i}
              x={bar.x + bar.w / 2}
              y="215"
              className="text-[9px] font-mono fill-text-secondary capitalize"
              textAnchor="middle"
            >
              {bar.label.length > 8 ? `${bar.label.substring(0, 7)}...` : bar.label}
            </text>
          );
        })}
      </svg>

      {(() => {
        const hoveredBar = hoveredIdx !== null ? bars[hoveredIdx] : null;
        if (!hoveredBar) return null;
        return (
          <div
            className="absolute z-10 p-2 rounded-lg border border-border-subtle bg-elevated/95 backdrop-blur-md shadow-2 text-meta pointer-events-none"
            style={{
              left: `${Math.min(Math.max(10, (hoveredBar.x / 680) * 100 - 10), 80)}%`,
              top: "-35px",
            }}
          >
            <p className="font-semibold text-text-secondary capitalize">{hoveredBar.label}</p>
            <p className="text-accent text-body font-bold mt-0.5">
              {yKey === "ai_cost_usd" ? `$${hoveredBar.value.toFixed(4)}` : hoveredBar.value}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Client Component
// ---------------------------------------------------------------------------

export function ReportsClientView({
  initialData,
  platformData,
  isSystemOwner,
  lastRefreshed,
}: ReportsClientViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Active dashboard tab state
  const [activeTab, setActiveTab] = useState<string>("overview");

  // NL Console state
  const [prompt, setPrompt] = useState("");
  const [isNlLoading, setIsNlLoading] = useState(false);
  const [nlResult, setNlResult] = useState<{
    query: ReportQuery;
    rows: Record<string, unknown>[];
    sql: string;
  } | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  // Drill-down UI state for overview KPIs
  const [activeDrillDown, setActiveDrillDown] = useState<
    "active_loans" | "overdue_loans" | "holds_queued" | "signups_today" | null
  >(null);
  const [drillDownSearch, setDrillDownSearch] = useState("");

  // Audit tab filters and items list
  const [auditLogs, setAuditLogs] = useState(initialData.audit.logs);
  const [nextCursor, setNextCursor] = useState(initialData.audit.nextCursor);
  const [isLoadingMoreAudit, setIsLoadingMoreAudit] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Audit filter state
  const [auditFilters, setAuditFilters] = useState({
    actorId: "",
    action: "",
    subjectType: "",
    startDate: "",
    endDate: "",
  });

  // KPI Calculations (Overview sparklines + deltas) — each tile uses its own metric series
  const {
    activeSparkline,
    activeDelta,
    overdueSparkline,
    overdueDelta,
    holdsSparkline,
    holdsDelta,
    signupSparkline,
    signupDelta,
  } = useMemo(() => {
    // Active loans — own 30-day series, last 14 vs prior 14
    const activeLast14 = initialData.overview.activeByDay.slice(-14).map((d) => d.active_count);
    const activePrev14 = initialData.overview.activeByDay
      .slice(-28, -14)
      .map((d) => d.active_count);
    const sumA14 = activeLast14.reduce((s, c) => s + c, 0);
    const sumAP14 = activePrev14.reduce((s, c) => s + c, 0);
    const activeDelta = calculateDelta(sumA14, sumAP14);

    // Overdue loans — own series
    const overdueLast14 = initialData.overview.overdueByDay.slice(-14).map((d) => d.overdue_count);
    const overduePrev14 = initialData.overview.overdueByDay
      .slice(-28, -14)
      .map((d) => d.overdue_count);
    const sumO14 = overdueLast14.reduce((s, c) => s + c, 0);
    const sumOP14 = overduePrev14.reduce((s, c) => s + c, 0);
    const overdueDelta = calculateDelta(sumO14, sumOP14);

    // Holds queued — own series
    const holdsLast14 = initialData.overview.holdsQueuedByDay.slice(-14).map((d) => d.holds_count);
    const holdsPrev14 = initialData.overview.holdsQueuedByDay
      .slice(-28, -14)
      .map((d) => d.holds_count);
    const sumH14 = holdsLast14.reduce((s, h) => s + h, 0);
    const sumHP14 = holdsPrev14.reduce((s, h) => s + h, 0);
    const holdsDelta = calculateDelta(sumH14, sumHP14);

    // Signups — own series (daily, last 14 vs prior 14)
    const signupsLast14 = initialData.overview.signupsByDay.slice(-14).map((d) => d.signup_count);
    const signupsPrev14 = initialData.overview.signupsByDay
      .slice(-28, -14)
      .map((d) => d.signup_count);
    const sumS14 = signupsLast14.reduce((s, c) => s + c, 0);
    const sumSP14 = signupsPrev14.reduce((s, c) => s + c, 0);
    const signupDelta = calculateDelta(sumS14, sumSP14);

    return {
      activeSparkline: activeLast14,
      activeDelta,
      overdueSparkline: overdueLast14,
      overdueDelta,
      holdsSparkline: holdsLast14,
      holdsDelta,
      signupSparkline: signupsLast14,
      signupDelta,
    };
  }, [initialData]);

  function calculateDelta(current: number, previous: number) {
    if (previous === 0) {
      return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / previous) * 100);
  }

  // Trigger cache-bust refresh
  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
      // Reset audit logs to pick up fresh paginated logs
      setAuditLogs(initialData.audit.logs);
      setNextCursor(initialData.audit.nextCursor);
    });
  };

  // Submit Natural-Language query
  const handleNlQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsNlLoading(true);
    setNlError(null);
    setNlResult(null);

    try {
      const res = await askReportQuestion({ prompt });
      if (res?.serverError) {
        setNlError(res.serverError);
      } else if (res?.data) {
        setNlResult(res.data);
      } else {
        setNlError("No response returned from the server.");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "An unexpected error occurred.";
      setNlError(errorMsg);
    } finally {
      setIsNlLoading(false);
    }
  };

  // Run audit log searches
  const handleApplyAuditFilters = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoadingMoreAudit(true);
    try {
      const res = await getMoreAuditLogs({
        ...auditFilters,
        cursor: undefined,
      });
      if (res?.data) {
        setAuditLogs(res.data.logs);
        setNextCursor(res.data.nextCursor);
      }
    } catch (err) {
      console.error("Filter failed:", err);
    } finally {
      setIsLoadingMoreAudit(false);
    }
  };

  // Load more paginated audit logs
  const handleLoadMoreAudit = async () => {
    if (!nextCursor || isLoadingMoreAudit) return;

    setIsLoadingMoreAudit(true);
    try {
      const res = await getMoreAuditLogs({
        ...auditFilters,
        cursor: nextCursor,
      });
      const data = res?.data;
      if (data) {
        setAuditLogs((prev) => [...prev, ...data.logs]);
        setNextCursor(data.nextCursor);
      }
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setIsLoadingMoreAudit(false);
    }
  };

  // Drilldown list filtering — each tile uses its own metric-specific detail dataset
  const drillDownFilteredItems = useMemo(() => {
    if (!activeDrillDown) return [];
    const search = drillDownSearch.toLowerCase().trim();

    if (activeDrillDown === "active_loans") {
      const loans = initialData.overview.drillActiveLoans;
      if (!search) return loans;
      return loans.filter(
        (l) =>
          l.title.toLowerCase().includes(search) || l.display_name.toLowerCase().includes(search),
      );
    }

    if (activeDrillDown === "overdue_loans") {
      const loans = initialData.overview.drillOverdueLoans;
      if (!search) return loans;
      return loans.filter(
        (l) =>
          l.title.toLowerCase().includes(search) || l.display_name.toLowerCase().includes(search),
      );
    }

    if (activeDrillDown === "holds_queued") {
      const holds = initialData.overview.drillHoldsQueued;
      if (!search) return holds;
      return holds.filter(
        (h) =>
          h.title.toLowerCase().includes(search) || h.display_name.toLowerCase().includes(search),
      );
    }

    if (activeDrillDown === "signups_today") {
      const members = initialData.overview.drillSignupsToday;
      if (!search) return members;
      return members.filter(
        (m) =>
          m.display_name.toLowerCase().includes(search) || m.email.toLowerCase().includes(search),
      );
    }

    return [];
  }, [activeDrillDown, drillDownSearch, initialData]);

  // AI Cap checks
  const aiSpend = initialData.aiUsage.totalSpendUsd;
  const aiCap = initialData.aiUsage.monthlyCapUsd;
  const isNearAiCap = aiCap > 0 && aiSpend / aiCap >= 0.8;

  // Determine dynamic chart configuration for NL Queries
  const nlChartConfig = useMemo(() => {
    if (!nlResult || nlResult.rows.length === 0 || !nlResult.query?.dimension) return null;
    const rows = nlResult.rows;
    const xKey = nlResult.query.dimension;
    const firstRow = rows[0];
    const yKey = firstRow
      ? Object.keys(firstRow).find((k) => k !== xKey && k !== "period") || "value"
      : "value";
    const chartType = xKey === "year" ? "line" : "bar";

    return { xKey, yKey, chartType };
  }, [nlResult]);

  return (
    <div className="max-w-[1250px] mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div>
          <h1 className="text-h1 text-text-primary flex items-center gap-2">
            <BarChart2 className="h-7 w-7 text-accent" />
            Reports & Insights
          </h1>
          <p className="text-meta text-text-secondary mt-1 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Last refreshed at {lastRefreshed}
          </p>
        </div>

        <Button
          variant="secondary"
          onClick={handleRefresh}
          disabled={isPending}
          id="refresh-reports-btn"
        >
          <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
          Refresh now
        </Button>
      </div>

      {/* 1. Ask Stack: Natural-Language query box (Global at top) */}
      <div className="p-5 rounded-xl border border-border-subtle bg-surface-2 elev-1 space-y-4">
        <div className="flex items-center gap-2 text-h3 text-text-primary">
          <Sparkles className="h-5 w-5 text-accent" />
          <h2>Ask Stack</h2>
          <Badge className="bg-accent/10 text-accent border-accent/20">AI Assistant</Badge>
        </div>
        <p className="text-meta text-text-secondary">
          Ask questions in plain English (e.g.,{" "}
          <code className="text-accent bg-canvas px-1 rounded">
            "how many loans in fantasy last month?"
          </code>{" "}
          or{" "}
          <code className="text-accent bg-canvas px-1 rounded">"AI cost by model last 7 days"</code>
          ) to auto-generate reports.
        </p>

        <form onSubmit={handleNlQuery} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-tertiary" />
            <Input
              type="text"
              placeholder="Ask anything about loans, holds, zero-result searches, or AI spend..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="pl-10 h-10 border-border-default focus-visible:ring-accent"
              disabled={isNlLoading}
              id="nl-query-input"
            />
          </div>
          <Button type="submit" disabled={isNlLoading || !prompt.trim()} id="nl-query-submit-btn">
            {isNlLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Query
              </>
            )}
          </Button>
        </form>

        {nlError && (
          <div className="p-3.5 rounded-lg border border-danger/20 bg-danger/10 text-danger text-meta flex items-start gap-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Unable to compile report</p>
              <p className="opacity-90">{nlError}</p>
            </div>
          </div>
        )}

        {/* NL Query Result Section */}
        {isNlLoading && (
          <div className="space-y-4 pt-4">
            <Skeleton className="h-8 w-1/4 bg-surface" />
            <Skeleton className="h-[200px] w-full bg-surface" />
            <Skeleton className="h-20 w-full bg-surface" />
          </div>
        )}

        {nlResult && (
          <div className="border border-border-subtle bg-surface rounded-xl p-5 space-y-5 animate-quick-fade">
            {/* Result Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-3">
              <div>
                <h3 className="font-semibold text-h3 text-text-primary capitalize">
                  Result: {nlResult.query.metric.replace(/_/g, " ")}
                  {nlResult.query.dimension && ` by ${nlResult.query.dimension}`}
                </h3>
                <p className="text-meta text-text-secondary mt-0.5">
                  Period:{" "}
                  <span className="capitalize">{nlResult.query.period.replace(/_/g, " ")}</span>
                </p>
              </div>

              {/* View SQL toggle */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSql(!showSql)}
                id="toggle-sql-btn"
              >
                <FileText className="h-3.5 w-3.5" />
                {showSql ? "Hide SQL" : "View SQL"}
              </Button>
            </div>

            {/* SQL Disclosure */}
            {showSql && (
              <div className="p-3.5 rounded-lg bg-canvas border border-border-subtle font-mono text-[12px] text-accent/90 whitespace-pre-wrap">
                {nlResult.sql}
              </div>
            )}

            {/* Render chart if grouping dimension exists */}
            {nlChartConfig && nlResult.rows.length > 0 && (
              <div className="border border-border-subtle rounded-lg p-4 bg-surface-2 max-w-[800px]">
                <h4 className="text-meta text-text-secondary font-semibold mb-4">Visualization</h4>
                <SvgBarChart
                  data={nlResult.rows}
                  xKey={nlChartConfig.xKey}
                  yKey={nlChartConfig.yKey}
                />
              </div>
            )}

            {/* Data Table */}
            {nlResult.rows.length === 0 ? (
              <p className="text-meta text-text-secondary italic">
                No rows returned for this query.
              </p>
            ) : (
              <div className="overflow-x-auto border border-border-subtle rounded-lg">
                <table className="w-full text-left text-meta text-text-secondary" data-tabular>
                  <thead className="bg-surface-2 text-text-primary border-b border-border-subtle">
                    <tr>
                      {Object.keys(nlResult.rows[0] ?? {}).map((h) => (
                        <th key={h} className="p-3 font-semibold capitalize">
                          {h.replace(/_/g, " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {nlResult.rows.map((row, idx) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: dynamic SQL query result row indexes
                      <tr key={idx} className="hover:bg-surface-2/40">
                        {Object.keys(nlResult.rows[0] ?? {}).map((h) => {
                          const val = row[h];
                          return (
                            <td key={h} className="p-3 font-mono text-text-primary">
                              {val === null || val === undefined
                                ? "-"
                                : typeof val === "object"
                                  ? JSON.stringify(val)
                                  : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-border-subtle overflow-x-auto no-scrollbar gap-2">
        {[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "circulation", label: "Circulation", icon: BarChart2 },
          { id: "discovery", label: "Discovery", icon: Search },
          { id: "members", label: "Members", icon: Users },
          { id: "ai", label: "AI Usage", icon: Sparkles },
          { id: "audit", label: "Audit Log", icon: Clock },
          ...(isSystemOwner && platformData
            ? [{ id: "platform", label: "Platform Operator", icon: User }]
            : []),
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 text-body font-medium transition-instant ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary hover:border-border-default"
              }`}
              id={`tab-btn-${tab.id}`}
            >
              <Icon className="h-4.5 w-4.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      <div className="py-2">
        {/* ================= OVERVIEW TAB ================= */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Active Loans */}
              <div
                onClick={() =>
                  setActiveDrillDown(activeDrillDown === "active_loans" ? null : "active_loans")
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveDrillDown(activeDrillDown === "active_loans" ? null : "active_loans");
                  }
                }}
                // biome-ignore lint/a11y/useSemanticElements: KPI card container
                tabIndex={0}
                role="button"
                className={`p-4 rounded-xl border transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  activeDrillDown === "active_loans"
                    ? "border-accent bg-accent/5 elev-2"
                    : "border-border-subtle bg-surface hover:bg-surface-2/40"
                }`}
                id="kpi-active-loans"
              >
                <div className="flex justify-between items-start text-meta text-text-secondary">
                  <span>Active Loans</span>
                  <Activity className="h-4 w-4 text-accent" />
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-[32px] font-bold text-text-primary tracking-tight">
                    {initialData.overview.kpis?.active_loans ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-4 pt-2 border-t border-border-subtle/50">
                  <div className="text-[10px] text-text-tertiary">14-day Active</div>
                  <div className="flex items-center gap-2">
                    <Sparkline
                      data={activeSparkline}
                      color={activeDelta >= 0 ? "success" : "danger"}
                    />
                    <span
                      className={`text-caption font-bold ${activeDelta >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {activeDelta >= 0 ? "+" : ""}
                      {activeDelta}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Overdue Loans */}
              <div
                onClick={() =>
                  setActiveDrillDown(activeDrillDown === "overdue_loans" ? null : "overdue_loans")
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveDrillDown(
                      activeDrillDown === "overdue_loans" ? null : "overdue_loans",
                    );
                  }
                }}
                // biome-ignore lint/a11y/useSemanticElements: KPI card container
                tabIndex={0}
                role="button"
                className={`p-4 rounded-xl border transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger ${
                  activeDrillDown === "overdue_loans"
                    ? "border-danger bg-danger/5 elev-2"
                    : "border-border-subtle bg-surface hover:bg-surface-2/40"
                }`}
                id="kpi-overdue-loans"
              >
                <div className="flex justify-between items-start text-meta text-text-secondary">
                  <span>Overdue Loans</span>
                  <AlertTriangle className="h-4 w-4 text-danger" />
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-[32px] font-bold text-danger tracking-tight">
                    {initialData.overview.kpis?.overdue_loans ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-4 pt-2 border-t border-border-subtle/50">
                  <div className="text-[10px] text-text-tertiary">14-day Overdue</div>
                  <div className="flex items-center gap-2">
                    <Sparkline
                      data={overdueSparkline}
                      color={overdueDelta <= 0 ? "success" : "danger"}
                    />
                    <span
                      className={`text-caption font-bold ${overdueDelta <= 0 ? "text-success" : "text-danger"}`}
                    >
                      {overdueDelta >= 0 ? "+" : ""}
                      {overdueDelta}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 3: Holds Queued */}
              <div
                onClick={() =>
                  setActiveDrillDown(activeDrillDown === "holds_queued" ? null : "holds_queued")
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveDrillDown(activeDrillDown === "holds_queued" ? null : "holds_queued");
                  }
                }}
                // biome-ignore lint/a11y/useSemanticElements: KPI card container
                tabIndex={0}
                role="button"
                className={`p-4 rounded-xl border transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning ${
                  activeDrillDown === "holds_queued"
                    ? "border-warning bg-warning/5 elev-2"
                    : "border-border-subtle bg-surface hover:bg-surface-2/40"
                }`}
                id="kpi-holds-queued"
              >
                <div className="flex justify-between items-start text-meta text-text-secondary">
                  <span>Holds Queued</span>
                  <FileText className="h-4 w-4 text-warning" />
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-[32px] font-bold text-text-primary tracking-tight">
                    {initialData.overview.kpis?.holds_queued ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-4 pt-2 border-t border-border-subtle/50">
                  <div className="text-[10px] text-text-tertiary">14-day Holds</div>
                  <div className="flex items-center gap-2">
                    <Sparkline
                      data={holdsSparkline}
                      color={holdsDelta >= 0 ? "success" : "danger"}
                    />
                    <span
                      className={`text-caption font-bold ${holdsDelta >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {holdsDelta >= 0 ? "+" : ""}
                      {holdsDelta}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Signups Today */}
              <div
                onClick={() =>
                  setActiveDrillDown(activeDrillDown === "signups_today" ? null : "signups_today")
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveDrillDown(
                      activeDrillDown === "signups_today" ? null : "signups_today",
                    );
                  }
                }}
                // biome-ignore lint/a11y/useSemanticElements: KPI card container
                tabIndex={0}
                role="button"
                className={`p-4 rounded-xl border transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success ${
                  activeDrillDown === "signups_today"
                    ? "border-success bg-success/5 elev-2"
                    : "border-border-subtle bg-surface hover:bg-surface-2/40"
                }`}
                id="kpi-signups-today"
              >
                <div className="flex justify-between items-start text-meta text-text-secondary">
                  <span>Signups Today</span>
                  <Users className="h-4 w-4 text-success" />
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-[32px] font-bold text-text-primary tracking-tight">
                    {initialData.overview.kpis?.signups_today ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-4 pt-2 border-t border-border-subtle/50">
                  <div className="text-[10px] text-text-tertiary">Weekly Signups</div>
                  <div className="flex items-center gap-2">
                    <Sparkline
                      data={signupSparkline}
                      color={signupDelta >= 0 ? "success" : "danger"}
                    />
                    <span
                      className={`text-caption font-bold ${signupDelta >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {signupDelta >= 0 ? "+" : ""}
                      {signupDelta}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Drilldown details table */}
            {activeDrillDown && (
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4 animate-quick-fade">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <h3 className="text-h3 text-text-primary font-semibold capitalize">
                    Drill-down: {activeDrillDown.replace(/_/g, " ")}
                  </h3>
                  <Input
                    type="text"
                    placeholder="Search drilldown details..."
                    value={drillDownSearch}
                    onChange={(e) => setDrillDownSearch(e.target.value)}
                    className="w-full sm:w-64 h-8 text-meta border-border-default focus-visible:ring-accent"
                  />
                </div>

                {drillDownFilteredItems.length === 0 ? (
                  <p className="text-meta text-text-secondary italic py-3 text-center">
                    No details matches the search term.
                  </p>
                ) : (
                  <div className="overflow-x-auto border border-border-subtle rounded-lg">
                    <table className="w-full text-left text-meta text-text-secondary">
                      <thead className="bg-surface-2 text-text-primary border-b border-border-subtle">
                        {activeDrillDown === "active_loans" ? (
                          <tr>
                            <th className="p-3 font-semibold">Title</th>
                            <th className="p-3 font-semibold">Member</th>
                            <th className="p-3 font-semibold">Checked Out</th>
                            <th className="p-3 font-semibold">Due</th>
                          </tr>
                        ) : activeDrillDown === "overdue_loans" ? (
                          <tr>
                            <th className="p-3 font-semibold">Title</th>
                            <th className="p-3 font-semibold">Member</th>
                            <th className="p-3 font-semibold">Due</th>
                            <th className="p-3 font-semibold">Days Overdue</th>
                          </tr>
                        ) : activeDrillDown === "holds_queued" ? (
                          <tr>
                            <th className="p-3 font-semibold">Title</th>
                            <th className="p-3 font-semibold">Member</th>
                            <th className="p-3 font-semibold">Queued At</th>
                            <th className="p-3 font-semibold">Status</th>
                          </tr>
                        ) : (
                          <tr>
                            <th className="p-3 font-semibold">Name</th>
                            <th className="p-3 font-semibold">Email</th>
                            <th className="p-3 font-semibold">Signed Up</th>
                            <th className="p-3 font-semibold">Status</th>
                          </tr>
                        )}
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {/* biome-ignore lint/suspicious/noExplicitAny: item is a union of drill-down shape types */}
                        {drillDownFilteredItems.map((item: any, idx) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: drilldown list items don't reorder dynamically
                          <tr key={idx} className="hover:bg-surface-2/40">
                            {activeDrillDown === "active_loans" ? (
                              <>
                                <td className="p-3 text-text-primary font-medium">{item.title}</td>
                                <td className="p-3">{item.display_name}</td>
                                <td className="p-3 font-mono">
                                  {new Date(item.checked_out_at).toLocaleDateString()}
                                </td>
                                <td className="p-3 font-mono">
                                  {new Date(item.due_at).toLocaleDateString()}
                                </td>
                              </>
                            ) : activeDrillDown === "overdue_loans" ? (
                              <>
                                <td className="p-3 text-text-primary font-medium">{item.title}</td>
                                <td className="p-3">{item.display_name}</td>
                                <td className="p-3 font-mono text-danger">
                                  {new Date(item.due_at).toLocaleDateString()}
                                </td>
                                <td className="p-3 font-mono text-danger font-semibold">
                                  {item.days_overdue}d
                                </td>
                              </>
                            ) : activeDrillDown === "holds_queued" ? (
                              <>
                                <td className="p-3 text-text-primary font-medium">{item.title}</td>
                                <td className="p-3">{item.display_name}</td>
                                <td className="p-3 font-mono">
                                  {new Date(item.queued_at).toLocaleDateString()}
                                </td>
                                <td className="p-3 capitalize">{item.status}</td>
                              </>
                            ) : (
                              <>
                                <td className="p-3 text-text-primary font-medium">
                                  {item.display_name}
                                </td>
                                <td className="p-3 font-mono">{item.email}</td>
                                <td className="p-3 font-mono">
                                  {new Date(item.created_at).toLocaleTimeString()}
                                </td>
                                <td className="p-3 capitalize">{item.status}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Split Grid for overview stats */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Top Circulated Books */}
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-h3 text-text-primary font-semibold">
                    Top Circulated This Week
                  </h3>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" asChild>
                      <a
                        href="/api/reports/export?viewName=top_circulated_this_week&format=csv"
                        download
                      >
                        <Download className="h-3.5 w-3.5" /> CSV
                      </a>
                    </Button>
                    <Button variant="secondary" size="sm" asChild>
                      <a
                        href="/api/reports/export?viewName=top_circulated_this_week&format=json"
                        download
                      >
                        JSON
                      </a>
                    </Button>
                  </div>
                </div>

                {initialData.overview.topCirculated.length === 0 ? (
                  <p className="text-meta text-text-secondary italic py-10 text-center">
                    No circulation logged this week.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-meta text-text-secondary">
                      <thead className="text-text-primary border-b border-border-subtle">
                        <tr>
                          <th className="pb-3 font-semibold">Title</th>
                          <th className="pb-3 font-semibold">Authors</th>
                          <th className="pb-3 font-semibold text-right">Checkouts</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle/50">
                        {initialData.overview.topCirculated.map((book) => (
                          <tr key={book.book_id} className="hover:bg-surface-2/20">
                            <td className="py-2.5 pr-3 text-text-primary font-medium">
                              {book.title}
                            </td>
                            <td className="py-2.5 text-text-tertiary">{book.authors.join(", ")}</td>
                            <td className="py-2.5 font-mono text-right text-accent font-semibold">
                              {book.checkout_count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Right Column: Interactive Line Chart */}
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-h3 text-text-primary font-semibold">
                      Circulation Activity
                    </h3>
                    <p className="text-caption text-text-tertiary mt-0.5">
                      Daily loans, returns, and holds (30d)
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" asChild>
                      <a href="/api/reports/export?viewName=circulation_by_day&format=csv" download>
                        <Download className="h-3.5 w-3.5" /> CSV
                      </a>
                    </Button>
                    <Button variant="secondary" size="sm" asChild>
                      <a
                        href="/api/reports/export?viewName=circulation_by_day&format=json"
                        download
                      >
                        JSON
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="border border-border-subtle rounded-lg p-4 bg-surface-2">
                  <SvgMultiLineChart data={initialData.circulation.circulationHistory} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= CIRCULATION TAB ================= */}
        {activeTab === "circulation" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-border-subtle bg-surface flex items-center gap-4">
                <Clock className="h-8 w-8 text-accent" />
                <div>
                  <span className="text-caption text-text-tertiary uppercase font-semibold">
                    Average Loan Duration
                  </span>
                  <div className="text-[28px] font-bold text-text-primary mt-1">
                    {initialData.circulation.loanDurationStats?.avg_loan_duration_days ?? "0"} days
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-xl border border-border-subtle bg-surface flex items-center gap-4">
                <Activity className="h-8 w-8 text-warning" />
                <div>
                  <span className="text-caption text-text-tertiary uppercase font-semibold">
                    Max Loan Duration
                  </span>
                  <div className="text-[28px] font-bold text-text-primary mt-1">
                    {initialData.circulation.loanDurationStats?.max_loan_duration_days ?? "0"} days
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Detailed Books Stats */}
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-h3 text-text-primary font-semibold">Top Books Detailed</h3>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" asChild>
                      <a href="/api/reports/export?viewName=top_books_detailed&format=csv" download>
                        <Download className="h-3.5 w-3.5" /> CSV
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-meta text-text-secondary">
                    <thead className="text-text-primary border-b border-border-subtle">
                      <tr>
                        <th className="pb-3 font-semibold">Title</th>
                        <th className="pb-3 font-semibold text-center">Checkouts</th>
                        <th className="pb-3 font-semibold text-center">Holds</th>
                        <th className="pb-3 font-semibold text-right">Avg Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle/50">
                      {initialData.circulation.topBooks.map((book) => (
                        <tr key={book.book_id} className="hover:bg-surface-2/20">
                          <td className="py-2.5 text-text-primary font-medium">{book.title}</td>
                          <td className="py-2.5 text-center font-mono">{book.checkout_count}</td>
                          <td className="py-2.5 text-center font-mono">{book.hold_count}</td>
                          <td className="py-2.5 text-right font-mono">
                            {book.avg_loan_duration_days} days
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Borrowers */}
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-h3 text-text-primary font-semibold">Active Borrowers</h3>
                  <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" asChild>
                      <a href="/api/reports/export?viewName=top_borrowers&format=csv" download>
                        <Download className="h-3.5 w-3.5" /> CSV
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-meta text-text-secondary">
                    <thead className="text-text-primary border-b border-border-subtle">
                      <tr>
                        <th className="pb-3 font-semibold">Name</th>
                        <th className="pb-3 font-semibold text-center">Total Loans</th>
                        <th className="pb-3 font-semibold text-right text-danger">Overdue Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle/50">
                      {initialData.circulation.topBorrowers.map((borrower) => (
                        <tr key={borrower.member_id} className="hover:bg-surface-2/20">
                          <td className="py-2.5">
                            <p className="text-text-primary font-medium">{borrower.display_name}</p>
                            <p className="text-[11px] text-text-tertiary">{borrower.email}</p>
                          </td>
                          <td className="py-2.5 text-center font-mono font-semibold text-accent">
                            {borrower.loan_count}
                          </td>
                          <td className="py-2.5 text-right font-mono font-semibold text-danger">
                            {borrower.overdue_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= DISCOVERY TAB ================= */}
        {activeTab === "discovery" && (
          <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-h3 text-text-primary font-semibold">Zero-Result Searches</h3>
                <p className="text-caption text-text-tertiary mt-0.5">
                  Queries typed by members yielding zero catalog results.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="secondary" size="sm" asChild>
                  <a href="/api/reports/export?viewName=zero_result_searches&format=csv" download>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </a>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <a href="/api/reports/export?viewName=zero_result_searches&format=json" download>
                    JSON
                  </a>
                </Button>
              </div>
            </div>

            {initialData.discovery.zeroResultSearches.length === 0 ? (
              <p className="text-meta text-text-secondary italic py-12 text-center">
                No search queries returning zero results found.
              </p>
            ) : (
              <div className="overflow-x-auto border border-border-subtle rounded-lg">
                <table className="w-full text-left text-meta text-text-secondary">
                  <thead className="bg-surface-2 text-text-primary border-b border-border-subtle">
                    <tr>
                      <th className="p-3 font-semibold">Query</th>
                      <th className="p-3 font-semibold text-center">Search Count</th>
                      <th className="p-3 font-semibold text-right">Last Searched At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {initialData.discovery.zeroResultSearches.map((search) => (
                      <tr key={search.query} className="hover:bg-surface-2/40">
                        <td className="p-3 text-text-primary font-medium italic">
                          "{search.query}"
                        </td>
                        <td className="p-3 text-center font-mono font-semibold text-accent">
                          {search.search_count}
                        </td>
                        <td className="p-3 text-right text-text-tertiary font-mono">
                          {new Date(search.last_searched_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ================= MEMBERS TAB ================= */}
        {activeTab === "members" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Member Status Stacked progress bar */}
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-h3 text-text-primary font-semibold">Members Breakdown</h3>
                  <Button variant="secondary" size="sm" asChild>
                    <a href="/api/reports/export?viewName=member_status_stats&format=csv" download>
                      <Download className="h-3.5 w-3.5" /> CSV
                    </a>
                  </Button>
                </div>
                <div className="space-y-4">
                  {(() => {
                    const statusStats = initialData.members.statusStats;
                    const totalMembers = statusStats.reduce((sum, item) => sum + item.count, 0);
                    return (
                      <>
                        <div className="h-6 w-full rounded-full overflow-hidden flex bg-surface-2 border border-border-subtle">
                          {statusStats.map((item) => {
                            const percentage =
                              totalMembers > 0 ? (item.count / totalMembers) * 100 : 0;
                            if (percentage === 0) return null;
                            let colorClass = "bg-success";
                            if (item.status === "pending") colorClass = "bg-warning";
                            if (item.status === "inactive" || item.status === "suspended")
                              colorClass = "bg-text-tertiary";
                            return (
                              <div
                                key={item.status}
                                className={`${colorClass} h-full transition-all`}
                                style={{ width: `${percentage}%` }}
                                title={`${item.status}: ${item.count} (${percentage.toFixed(1)}%)`}
                              />
                            );
                          })}
                        </div>
                        <div className="flex flex-col gap-2 pt-2">
                          {statusStats.map((item) => {
                            let badgeVar: "success" | "warning" | "secondary" = "success";
                            if (item.status === "pending") badgeVar = "warning";
                            if (item.status === "inactive" || item.status === "suspended")
                              badgeVar = "secondary";
                            return (
                              <div
                                key={item.status}
                                className="flex items-center justify-between border-b border-border-subtle/40 pb-1.5 text-meta"
                              >
                                <span className="flex items-center gap-2">
                                  <Badge variant={badgeVar} className="capitalize">
                                    {item.status}
                                  </Badge>
                                </span>
                                <span className="font-semibold text-text-primary font-mono">
                                  {item.count}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Signups history line chart */}
              <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-h3 text-text-primary font-semibold">Signups Pipeline</h3>
                    <p className="text-caption text-text-tertiary mt-0.5">Weekly signup numbers</p>
                  </div>
                  <Button variant="secondary" size="sm" asChild>
                    <a
                      href="/api/reports/export?viewName=member_signups_by_week&format=csv"
                      download
                    >
                      <Download className="h-3.5 w-3.5" /> CSV
                    </a>
                  </Button>
                </div>
                <div className="border border-border-subtle rounded-lg p-4 bg-surface-2">
                  <SvgSingleLineChart data={initialData.members.signupsHistory} />
                </div>
              </div>
            </div>

            {/* Churn Proxy (Inactive members) */}
            <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-h3 text-text-primary font-semibold text-warning flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" /> Member Churn Risk (No activity &gt; 90
                    days)
                  </h3>
                  <p className="text-caption text-text-tertiary mt-0.5 font-mono">
                    Members currently active but with no loan activity logged in the last 90 days.
                  </p>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <a href="/api/reports/export?viewName=member_churn_proxy&format=csv" download>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </a>
                </Button>
              </div>

              {initialData.members.churnProxy.length === 0 ? (
                <p className="text-meta text-text-secondary italic py-10 text-center">
                  No inactive members matching criteria.
                </p>
              ) : (
                <div className="overflow-x-auto border border-border-subtle rounded-lg">
                  <table className="w-full text-left text-meta text-text-secondary">
                    <thead className="bg-surface-2 text-text-primary border-b border-border-subtle">
                      <tr>
                        <th className="p-3 font-semibold">Display Name</th>
                        <th className="p-3 font-semibold">Email</th>
                        <th className="p-3 font-semibold">Signup Date</th>
                        <th className="p-3 font-semibold text-right">Last Activity Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {initialData.members.churnProxy.map((m) => (
                        <tr key={m.member_id} className="hover:bg-surface-2/40">
                          <td className="p-3 text-text-primary font-medium">{m.display_name}</td>
                          <td className="p-3 font-mono">{m.email}</td>
                          <td className="p-3 font-mono">
                            {new Date(m.created_at).toLocaleDateString()}
                          </td>
                          <td className="p-3 text-right font-mono text-text-tertiary">
                            {m.last_activity_at
                              ? new Date(m.last_activity_at).toLocaleDateString()
                              : "Never"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= AI USAGE TAB ================= */}
        {activeTab === "ai" && (
          <div className="space-y-6">
            {/* Quota Warning Banner */}
            {isNearAiCap && (
              <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-warning/10 border border-warning/20 text-warning mb-6">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
                  <div>
                    <p className="font-semibold text-h3">Approaching monthly AI quota</p>
                    <p className="text-meta text-text-secondary mt-0.5">
                      Review usage or raise the cap. You have consumed{" "}
                      {Math.round((aiSpend / aiCap) * 100)}% of your monthly cap of $
                      {aiCap.toFixed(2)}.
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  asChild
                  className="border-warning/30 hover:bg-warning/20 text-warning"
                  id="raise-cap-btn"
                >
                  <Link href="/settings">Raise Cap</Link>
                </Button>
              </div>
            )}

            {/* No-usage consolidated state */}
            {aiSpend === 0 &&
            initialData.aiUsage.p95LatencyMs === null &&
            initialData.aiUsage.costByFeature.length === 0 &&
            initialData.aiUsage.costByModel.length === 0 &&
            initialData.aiUsage.costByRole.length === 0 ? (
              <div className="p-8 rounded-xl border border-border-subtle bg-surface flex flex-col items-center justify-center gap-3 text-center">
                <Sparkles className="h-10 w-10 text-text-tertiary" />
                <p className="text-h3 text-text-primary font-semibold">No AI usage this period</p>
                <p className="text-meta text-text-secondary max-w-xs">
                  AI features have not been used this month. Usage metrics will appear here once
                  members start using the Reader&apos;s Advisor or other AI-powered tools.
                </p>
              </div>
            ) : (
              <>
                {/* KPI Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border border-border-subtle bg-surface flex items-center gap-4">
                    <DollarSign className="h-8 w-8 text-accent" />
                    <div>
                      <span className="text-caption text-text-tertiary uppercase font-semibold">
                        Monthly Spend
                      </span>
                      <div className="text-[28px] font-bold text-text-primary mt-1 font-mono">
                        ${aiSpend.toFixed(4)}{" "}
                        <span className="text-meta font-normal text-text-tertiary">
                          / ${aiCap.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-border-subtle bg-surface flex items-center gap-4">
                    <Clock className="h-8 w-8 text-success" />
                    <div>
                      <span className="text-caption text-text-tertiary uppercase font-semibold">
                        p95 Latency
                      </span>
                      <div className="text-[28px] font-bold text-text-primary mt-1 font-mono">
                        {initialData.aiUsage.p95LatencyMs === null
                          ? "—"
                          : `${initialData.aiUsage.p95LatencyMs}ms`}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Breakdown Lists */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Cost by Feature */}
                  <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-h3 text-text-primary font-semibold">Cost by Feature</h3>
                      <Button variant="secondary" size="sm" asChild>
                        <a
                          href="/api/reports/export?viewName=ai_cost_by_feature&format=csv"
                          download
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {initialData.aiUsage.costByFeature.length === 0 ? (
                        <p className="text-meta text-text-secondary italic">No usage recorded.</p>
                      ) : (
                        initialData.aiUsage.costByFeature.map((item) => {
                          const cost = Number.parseFloat(item.ai_cost_usd);
                          const percentage = aiSpend > 0 ? (cost / aiSpend) * 100 : 0;
                          return (
                            <div key={item.feature} className="space-y-1">
                              <div className="flex justify-between text-meta">
                                <span className="font-medium text-text-primary capitalize">
                                  {item.feature.replace(/_/g, " ")}
                                </span>
                                <span className="text-text-secondary font-mono">
                                  ${cost.toFixed(4)} ({percentage.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-accent rounded-full"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Cost by Model */}
                  <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-h3 text-text-primary font-semibold">Cost by Model</h3>
                      <Button variant="secondary" size="sm" asChild>
                        <a href="/api/reports/export?viewName=ai_cost_by_model&format=csv" download>
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {initialData.aiUsage.costByModel.length === 0 ? (
                        <p className="text-meta text-text-secondary italic">No usage recorded.</p>
                      ) : (
                        initialData.aiUsage.costByModel.map((item) => {
                          const cost = Number.parseFloat(item.ai_cost_usd);
                          const percentage = aiSpend > 0 ? (cost / aiSpend) * 100 : 0;
                          return (
                            <div key={item.model} className="space-y-1">
                              <div className="flex justify-between text-meta">
                                <span className="font-medium text-text-primary capitalize">
                                  {item.model.split("/").pop() || item.model}
                                </span>
                                <span className="text-text-secondary font-mono">
                                  ${cost.toFixed(4)} ({percentage.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-success rounded-full"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Cost by Member Role */}
                  <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-h3 text-text-primary font-semibold">Cost by User Role</h3>
                      <Button variant="secondary" size="sm" asChild>
                        <a
                          href="/api/reports/export?viewName=ai_cost_by_member_role&format=csv"
                          download
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {initialData.aiUsage.costByRole.length === 0 ? (
                        <p className="text-meta text-text-secondary italic">No usage recorded.</p>
                      ) : (
                        initialData.aiUsage.costByRole.map((item) => {
                          const cost = Number.parseFloat(item.ai_cost_usd);
                          const percentage = aiSpend > 0 ? (cost / aiSpend) * 100 : 0;
                          return (
                            <div key={item.member_role} className="space-y-1">
                              <div className="flex justify-between text-meta">
                                <span className="font-medium text-text-primary capitalize">
                                  {item.member_role}
                                </span>
                                <span className="text-text-secondary font-mono">
                                  ${cost.toFixed(4)} ({percentage.toFixed(1)}%)
                                </span>
                              </div>
                              <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-warning rounded-full"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Chat Refusals (24h) */}
            <div className="p-5 rounded-xl border border-border-subtle bg-surface space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-h3 text-text-primary font-semibold text-danger flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" /> Chat Refusals (Last 24h)
                  </h3>
                  <p className="text-caption text-text-tertiary mt-0.5 font-mono">
                    Chat blocks triggered due to AI governance filters, toxicity guards, or system
                    policies.
                  </p>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <a href="/api/reports/export?viewName=chat_refusals_24h&format=csv" download>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </a>
                </Button>
              </div>

              {initialData.aiUsage.refusals.length === 0 ? (
                <p className="text-meta text-text-secondary italic py-10 text-center">
                  No refusals logged in the last 24 hours.
                </p>
              ) : (
                <div className="space-y-4">
                  {initialData.aiUsage.refusals.map((r) => {
                    const samples = r.sample_messages ? r.sample_messages.split(" || ") : [];
                    return (
                      <div
                        key={r.refusal_reason}
                        className="p-4 rounded-xl border border-border-subtle bg-surface-2"
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span className="font-semibold text-text-primary capitalize">
                            {r.refusal_reason.replace(/_/g, " ")}
                          </span>
                          <Badge variant="danger">
                            {r.refusal_count} refusal{r.refusal_count !== 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {samples.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-caption text-text-tertiary font-semibold">
                              Sample User Prompt Messages:
                            </span>
                            <ul className="list-disc pl-5 text-meta text-text-secondary space-y-1">
                              {samples.map((s, idx) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: index is appropriate for inline string lists
                                <li key={idx} className="italic text-text-secondary/90">
                                  "{s}"
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= AUDIT LOG TAB ================= */}
        {activeTab === "audit" && (
          <div className="space-y-6">
            {/* Filter Form */}
            <form
              onSubmit={handleApplyAuditFilters}
              className="p-4 rounded-xl border border-border-subtle bg-surface-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
            >
              <div className="space-y-1">
                <Label htmlFor="actorId" className="text-meta text-text-secondary">
                  Actor UUID
                </Label>
                <Input
                  id="actorId"
                  type="text"
                  placeholder="Filter actor uuid"
                  value={auditFilters.actorId}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, actorId: e.target.value }))}
                  className="h-8 text-meta"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="action" className="text-meta text-text-secondary">
                  Action
                </Label>
                <Input
                  id="action"
                  type="text"
                  placeholder="e.g. loan:checkout"
                  value={auditFilters.action}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, action: e.target.value }))}
                  className="h-8 text-meta"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="subjectType" className="text-meta text-text-secondary">
                  Subject Type
                </Label>
                <Input
                  id="subjectType"
                  type="text"
                  placeholder="e.g. loan"
                  value={auditFilters.subjectType}
                  onChange={(e) => setAuditFilters((f) => ({ ...f, subjectType: e.target.value }))}
                  className="h-8 text-meta"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="startDate" className="text-meta text-text-secondary">
                    Start Date
                  </Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={auditFilters.startDate}
                    onChange={(e) => setAuditFilters((f) => ({ ...f, startDate: e.target.value }))}
                    className="h-8 text-meta"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="endDate" className="text-meta text-text-secondary">
                    End Date
                  </Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={auditFilters.endDate}
                    onChange={(e) => setAuditFilters((f) => ({ ...f, endDate: e.target.value }))}
                    className="h-8 text-meta"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="h-8 w-full text-meta"
                  disabled={isLoadingMoreAudit}
                  id="apply-audit-filters-btn"
                >
                  {isLoadingMoreAudit ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Apply Filters"
                  )}
                </Button>
                <Button variant="secondary" size="icon" className="h-8 w-8" asChild>
                  <a
                    href="/api/reports/export?viewName=audit_logs_timeline&format=csv"
                    download
                    title="Export Full Audit Log to CSV"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </form>

            {/* Audit Logs Table */}
            {auditLogs.length === 0 ? (
              <p className="text-meta text-text-secondary italic py-12 text-center bg-surface border border-border-subtle rounded-xl">
                No audit logs match criteria.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto border border-border-subtle rounded-xl bg-surface">
                  <table className="w-full text-left text-meta text-text-secondary" data-tabular>
                    <thead className="bg-surface-2 text-text-primary border-b border-border-subtle">
                      <tr>
                        <th className="p-3 font-semibold w-10" />
                        <th className="p-3 font-semibold">Date/Time</th>
                        <th className="p-3 font-semibold">Actor ID</th>
                        <th className="p-3 font-semibold">Action</th>
                        <th className="p-3 font-semibold">Subject</th>
                        <th className="p-3 font-semibold">Subject ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {auditLogs.map((log) => {
                        const isExpanded = expandedLogId === log.id;
                        return (
                          <React.Fragment key={log.id}>
                            <tr
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setExpandedLogId(isExpanded ? null : log.id);
                                }
                              }}
                              // biome-ignore lint/a11y/useSemanticElements: interactive table row
                              tabIndex={0}
                              role="button"
                              className="hover:bg-surface-2/40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-surface-2/80"
                            >
                              <td className="p-3">
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-text-tertiary" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-text-tertiary" />
                                )}
                              </td>
                              <td className="p-3 font-mono text-[12px] text-text-primary">
                                {new Date(log.occurred_at).toLocaleString()}
                              </td>
                              <td
                                className="p-3 font-mono text-[11px] max-w-[120px] truncate"
                                title={log.actor_id || "System"}
                              >
                                {log.actor_id ? `${log.actor_id.substring(0, 8)}...` : "System"}
                              </td>
                              <td className="p-3">
                                <Badge
                                  className={
                                    log.action.includes("create") || log.action.includes("checkout")
                                      ? "bg-success/10 text-success border-success/20"
                                      : log.action.includes("delete") ||
                                          log.action.includes("refusal")
                                        ? "bg-danger/10 text-danger border-danger/20"
                                        : "bg-accent/10 text-accent border-accent/20"
                                  }
                                >
                                  {log.action}
                                </Badge>
                              </td>
                              <td className="p-3 capitalize">{log.subject_type}</td>
                              <td className="p-3 font-mono text-[11px] text-text-tertiary">
                                {log.subject_id ? `${log.subject_id.substring(0, 8)}...` : "-"}
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr className="bg-canvas border-l-2 border-accent">
                                <td colSpan={6} className="p-4">
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-4 text-caption text-text-tertiary">
                                      <div>
                                        Actor:{" "}
                                        <span className="font-mono select-all text-text-secondary">
                                          {log.actor_id || "System"}
                                        </span>
                                      </div>
                                      <div>
                                        Subject ID:{" "}
                                        <span className="font-mono select-all text-text-secondary">
                                          {log.subject_id || "-"}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div>
                                        <p className="text-caption text-text-tertiary mb-1 font-semibold">
                                          State Before
                                        </p>
                                        <pre className="p-3 rounded border border-border-subtle bg-surface-2 font-mono text-[11px] text-text-secondary overflow-x-auto max-h-48">
                                          {log.before_json
                                            ? JSON.stringify(log.before_json, null, 2)
                                            : "NULL"}
                                        </pre>
                                      </div>
                                      <div>
                                        <p className="text-caption text-text-tertiary mb-1 font-semibold">
                                          State After
                                        </p>
                                        <pre className="p-3 rounded border border-border-subtle bg-surface-2 font-mono text-[11px] text-text-secondary overflow-x-auto max-h-48">
                                          {log.after_json
                                            ? JSON.stringify(log.after_json, null, 2)
                                            : "NULL"}
                                        </pre>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {nextCursor && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="secondary"
                      onClick={handleLoadMoreAudit}
                      disabled={isLoadingMoreAudit}
                      id="audit-load-more-btn"
                    >
                      {isLoadingMoreAudit ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading more logs...
                        </>
                      ) : (
                        "Load More Logs"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= PLATFORM OPERATOR TAB ================= */}
        {activeTab === "platform" && isSystemOwner && platformData && (
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-accent/10 border border-accent/20 text-accent-text flex items-center gap-3">
              <Info className="h-5 w-5 text-accent shrink-0" />
              <div>
                <p className="font-semibold text-body">System Operator mode enabled</p>
                <p className="text-meta text-text-secondary">
                  Viewing aggregated system statistics across all active tenants on this platform.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-xl border border-border-subtle bg-surface relative overflow-hidden">
                <div className="text-meta text-text-secondary">Active Tenants</div>
                <div className="text-[32px] font-bold text-text-primary mt-2 font-mono">
                  {platformData.activeTenants}
                </div>
                <div className="absolute bottom-0 right-0 p-2 text-caption bg-accent/5 border-l border-t border-border-subtle text-[10px] text-accent/80 font-bold uppercase tracking-wider">
                  platform-wide
                </div>
              </div>

              <div className="p-5 rounded-xl border border-border-subtle bg-surface relative overflow-hidden">
                <div className="text-meta text-text-secondary">Total MAU (30d)</div>
                <div className="text-[32px] font-bold text-text-primary mt-2 font-mono">
                  {platformData.totalMau}
                </div>
                <div className="absolute bottom-0 right-0 p-2 text-caption bg-accent/5 border-l border-t border-border-subtle text-[10px] text-accent/80 font-bold uppercase tracking-wider">
                  platform-wide
                </div>
              </div>

              <div className="p-5 rounded-xl border border-border-subtle bg-surface relative overflow-hidden">
                <div className="text-meta text-text-secondary">Platform AI Cost (30d)</div>
                <div className="text-[32px] font-bold text-text-primary mt-2 font-mono">
                  ${platformData.platformAiCostUsd.toFixed(4)}
                </div>
                <div className="absolute bottom-0 right-0 p-2 text-caption bg-accent/5 border-l border-t border-border-subtle text-[10px] text-accent/80 font-bold uppercase tracking-wider">
                  platform-wide
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
