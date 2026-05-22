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

  // 1. Fetch tenant-scoped dashboard data. Each dashboard runs in its own
  // tenant transaction so the six fetches execute concurrently on separate
  // connections. Sharing a single tx serializes every query (~25 round-trips
  // back-to-back) on one connection, which dominates this page's load time.
  const [overview, circulation, discovery, members, aiUsage, audit] = await Promise.all([
    withTenantTx(tenantCtx, (tx) => getOverviewDashboard(tx)),
    withTenantTx(tenantCtx, (tx) => getCirculationDashboard(tx)),
    withTenantTx(tenantCtx, (tx) => getDiscoveryDashboard(tx)),
    withTenantTx(tenantCtx, (tx) => getMembersDashboard(tx)),
    withTenantTx(tenantCtx, (tx) => getAiUsageDashboard(tx, tenantCtx.tenantId)),
    withTenantTx(tenantCtx, (tx) => getAuditDashboard(tx, {}, 25)),
  ]);
  const data = { overview, circulation, discovery, members, aiUsage, audit };

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
