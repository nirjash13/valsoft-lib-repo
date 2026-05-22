import { buildAbility } from "@/lib/auth/ability";
import { getSession, sessionToTenantCtx } from "@/lib/auth/session";
import { withSystemOwnerTx } from "@/lib/db/with-system-owner-tx";
import { withTenantTx } from "@/lib/db/with-tenant-tx";
import {
  getAiUsageDashboard,
  getAuditDashboard,
  getCirculationDashboard,
  getDiscoveryDashboard,
  getMembersDashboard,
  getOverviewDashboard,
  getPlatformDashboard,
} from "@/lib/domain/reporting/service";
import { redirect } from "next/navigation";
import { ReportsClientView } from "./reports-client-view";

export const metadata = {
  title: "Reports & Insights — Stack",
  description:
    "View library circulation metrics, AI usage stats, and query records using natural language.",
};

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const ability = buildAbility(session.roles);
  if (!ability.can("view", "Report")) {
    redirect("/");
  }

  const tenantCtx = await sessionToTenantCtx(session);
  const isSystemOwner = session.roles.includes("system_owner");

  // 1. Fetch tenant-scoped dashboard data inside a tenant transaction
  const data = await withTenantTx(tenantCtx, async (tx) => {
    const overview = await getOverviewDashboard(tx);
    const circulation = await getCirculationDashboard(tx);
    const discovery = await getDiscoveryDashboard(tx);
    const members = await getMembersDashboard(tx);
    const aiUsage = await getAiUsageDashboard(tx, tenantCtx.tenantId);
    const audit = await getAuditDashboard(tx, {}, 25);

    return {
      overview,
      circulation,
      discovery,
      members,
      aiUsage,
      audit,
    };
  });

  // 2. If system_owner, fetch platform-wide data using a system owner transaction
  let platformData = null;
  if (isSystemOwner) {
    platformData = await withSystemOwnerTx(async (tx) => {
      return getPlatformDashboard(tx);
    });
  }

  const lastRefreshed = new Date().toLocaleTimeString();

  return (
    <div className="space-y-6">
      <ReportsClientView
        initialData={data}
        platformData={platformData}
        isSystemOwner={isSystemOwner}
        lastRefreshed={lastRefreshed}
      />
    </div>
  );
}
