/**
 * recordEmail — inserts one outgoing_emails row.
 *
 * Called by every send helper (send-transactional, send-lifecycle, send-batch)
 * immediately after dispatching to Resend (or recording a skip/failure).
 * Runs inside the caller's transaction so the audit trail is atomic with the send.
 */

import { outgoingEmails } from "@/lib/db/schema/outgoing-emails";
import type { NewOutgoingEmailRow, OutgoingEmailRow } from "@/lib/db/schema/outgoing-emails";
import type { TenantCtx, TxClient } from "@/lib/db/with-tenant-tx";

// ---------------------------------------------------------------------------
// Params type
// ---------------------------------------------------------------------------

export interface RecordEmailParams {
  memberId?: string;
  loanId?: string;
  batchId?: string;
  toEmail: string;
  emailType: OutgoingEmailRow["emailType"];
  deliveryStatus: OutgoingEmailRow["deliveryStatus"];
  subject: string;
  resendId?: string;
  error?: string;
  sentAt?: Date;
}

// ---------------------------------------------------------------------------
// recordEmail
// ---------------------------------------------------------------------------

/**
 * Inserts an `outgoing_emails` row and returns it.
 *
 * @param tx     Active tenant transaction (tenant_id bound via withTenantTx).
 * @param ctx    Tenant context — supplies tenantId.
 * @param params Email metadata to persist.
 */
export async function recordEmail(
  tx: TxClient,
  ctx: TenantCtx,
  params: RecordEmailParams,
): Promise<OutgoingEmailRow> {
  const insert: NewOutgoingEmailRow = {
    tenantId: ctx.tenantId,
    toEmail: params.toEmail,
    emailType: params.emailType,
    deliveryStatus: params.deliveryStatus,
    subject: params.subject,
    ...(params.memberId !== undefined ? { memberId: params.memberId } : {}),
    ...(params.loanId !== undefined ? { loanId: params.loanId } : {}),
    ...(params.batchId !== undefined ? { batchId: params.batchId } : {}),
    ...(params.resendId !== undefined ? { resendId: params.resendId } : {}),
    ...(params.error !== undefined ? { error: params.error } : {}),
    ...(params.sentAt !== undefined ? { sentAt: params.sentAt } : {}),
  };

  const [row] = await tx.insert(outgoingEmails).values(insert).returning();

  if (!row) {
    throw new Error("recordEmail: insert returned no rows — unexpected DB state.");
  }

  return row;
}
