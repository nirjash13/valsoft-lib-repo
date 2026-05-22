/**
 * DeliveryLog — presentational table of recent outgoing_emails rows.
 *
 * WCAG 2.2 AA: semantic <table> with <caption>, <th scope="col">, and
 * status badges that convey meaning via both colour and text.
 */

import { cn } from "@/lib/utils/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeliveryLogRow {
  id: string;
  toEmail: string;
  emailType: string;
  deliveryStatus: string;
  subject: string;
  createdAt: Date;
}

interface DeliveryLogProps {
  rows: ReadonlyArray<DeliveryLogRow>;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  sent: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  delivered: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  bounced: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  complained: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  skipped_opt_out: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  skipped_subject_removed:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-neutral-100 text-neutral-600";
  const label = status.replace(/_/g, " ");
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", style)}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Type label
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  due_soon: "Due soon",
  due_today: "Due today",
  overdue: "Overdue",
  hold_ready: "Hold ready",
  welcome: "Welcome",
  rejection: "Rejection",
  batch_reminder: "Batch reminder",
};

function typeLabel(emailType: string): string {
  return TYPE_LABELS[emailType] ?? emailType;
}

// ---------------------------------------------------------------------------
// DeliveryLog
// ---------------------------------------------------------------------------

export function DeliveryLog({ rows }: DeliveryLogProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary py-4 text-center">No emails sent yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="min-w-full text-sm">
        <caption className="sr-only">Recent outgoing emails</caption>
        <thead className="bg-elevated text-text-secondary">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              To
            </th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              Subject
            </th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 text-left font-medium">
              Sent
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle bg-surface">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-elevated transition-colors">
              <td className="px-4 py-2.5 text-text-primary font-mono text-xs">
                {maskEmail(row.toEmail)}
              </td>
              <td className="px-4 py-2.5 text-text-secondary">{typeLabel(row.emailType)}</td>
              <td className="px-4 py-2.5 text-text-primary max-w-xs truncate">{row.subject}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={row.deliveryStatus} />
              </td>
              <td className="px-4 py-2.5 text-text-tertiary whitespace-nowrap">
                {row.createdAt.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// maskEmail — partial masking for display (shows domain; hides local-part)
// ---------------------------------------------------------------------------

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const masked =
    local.length <= 2
      ? "**"
      : `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${masked}${domain}`;
}
