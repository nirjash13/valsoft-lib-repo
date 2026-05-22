import { z } from "zod";

export const METRIC_DIMENSION_WHITELIST = {
  loans_count: ["subject", "year", "member_role"],
  unique_borrowers: ["subject", "year", "member_role"],
  holds_placed: ["subject", "year", "member_role"],
  searches_zero_result: ["year", "member_role"],
  ai_cost_usd: ["feature", "model", "year", "member_role"],
} as const;

export type Metric = keyof typeof METRIC_DIMENSION_WHITELIST;
export type Dimension = (typeof METRIC_DIMENSION_WHITELIST)[Metric][number];

export const MetricSchema = z.enum([
  "loans_count",
  "unique_borrowers",
  "holds_placed",
  "searches_zero_result",
  "ai_cost_usd",
]);

export const DimensionSchema = z.enum(["subject", "year", "member_role", "feature", "model"]);

export const PeriodSchema = z.string().refine((val) => {
  if (val === "last_7_days" || val === "last_30_days" || val === "month_to_date") {
    return true;
  }
  const parts = val.split("..");
  if (parts.length !== 2) return false;
  const [start, end] = parts;
  if (!start || !end) return false;
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(start) || !isoDateRegex.test(end)) return false;
  const startDate = new Date(start);
  const endDate = new Date(end);
  return (
    !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && startDate <= endDate
  );
}, "Period must be last_7_days, last_30_days, month_to_date, or YYYY-MM-DD..YYYY-MM-DD");

export const ReportQuerySchema = z
  .object({
    metric: MetricSchema,
    dimension: DimensionSchema.optional(),
    period: PeriodSchema,
    filter: z.record(z.string(), z.string()).optional(),
  })
  .refine(
    (data) => {
      if (data.dimension) {
        const allowed = METRIC_DIMENSION_WHITELIST[data.metric] as readonly string[];
        if (!allowed.includes(data.dimension)) {
          return false;
        }
      }
      return true;
    },
    {
      message: "Invalid metric and dimension combination",
      path: ["dimension"],
    },
  )
  .refine(
    (data) => {
      if (data.filter) {
        for (const key of Object.keys(data.filter)) {
          if (!data.dimension || key !== data.dimension) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message: "Filter key must match the selected dimension",
      path: ["filter"],
    },
  );

export type ReportQuery = z.infer<typeof ReportQuerySchema>;

export function validateWhitelist(metric: string, dimension?: string): boolean {
  if (!MetricSchema.safeParse(metric).success) return false;
  if (!dimension) return true;
  if (!DimensionSchema.safeParse(dimension).success) return false;
  const allowed = METRIC_DIMENSION_WHITELIST[metric as Metric] as readonly string[];
  return allowed.includes(dimension);
}

export function isSafeFilterColumn(col: string, dimension?: string): boolean {
  if (!dimension) return false;
  return col === dimension;
}
