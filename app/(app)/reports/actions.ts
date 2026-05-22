"use server";

import { assertAiBudget } from "@/lib/ai/budget";
import { generateObjectViaGateway } from "@/lib/ai/gateway";
import { loadPromptByName } from "@/lib/ai/prompts/load-prompt";
import { actionClient } from "@/lib/auth/safe-action";
import type { TenantId } from "@/lib/db/schema/_shared";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import { ReportQuerySchema } from "@/lib/domain/reporting/schema";
import {
  type AuditLogFilters,
  executeReportQuery,
  getAuditDashboard,
} from "@/lib/domain/reporting/service";
import { z } from "zod";

const InputSchema = z.object({
  prompt: z.string().min(1),
});

export const askReportQuestion = actionClient
  .schema(InputSchema)
  .metadata({ permission: "report:view" })
  .action(async ({ parsedInput, ctx }) => {
    const tenantId = ctx.tenantCtx.tenantId as TenantId;

    try {
      // 1. Assert AI budget
      await assertAiBudget(tenantId, 0.01);

      // 2. Load prompt
      const promptMeta = loadPromptByName("reporting.v1.md");

      // 3. Invoke LLM to translate question to ReportQuery object
      const { object: reportQuery } = await generateObjectViaGateway({
        model: "anthropic/claude-sonnet-4-6",
        schema: ReportQuerySchema,
        system: promptMeta.body,
        prompt: parsedInput.prompt,
        tenantId,
        feature: "reporting",
        maxTokens: 256,
      });

      // 4. Run the query in a tenant transaction
      const queryResult = await withTenantTx(ctx.tenantCtx, async (tx) => {
        return executeReportQuery(tx, reportQuery);
      });

      return {
        query: reportQuery,
        rows: queryResult.rows,
        sql: queryResult.sql,
      };
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      if (
        errorObj.name === "ZodError" ||
        errorObj.message?.includes("validation") ||
        errorObj.message?.includes("Invalid metric")
      ) {
        throw new Error(
          "I don't track that metric/dimension combination. Try: loans count, holds, signups, searches, or AI cost.",
        );
      }
      throw err;
    }
  });

export const getMoreAuditLogs = actionClient
  .schema(
    z.object({
      actorId: z.string().optional(),
      action: z.string().optional(),
      subjectType: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      cursor: z.string().optional(),
    }),
  )
  .metadata({ permission: "report:view" })
  .action(async ({ parsedInput, ctx }) => {
    const { cursor, ...filters } = parsedInput;
    return withTenantTx(ctx.tenantCtx, async (tx) => {
      return getAuditDashboard(tx, filters as AuditLogFilters, 25, cursor);
    });
  });
