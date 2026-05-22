/**
 * Typed render helpers for all email templates.
 *
 * Thin wrappers around `@react-email/render`'s `render()` that accept
 * the props type for each template and return a fully-rendered HTML string.
 *
 * Callers in the domain layer import from here rather than reaching for
 * `@react-email/render` and JSX directly.
 */

import { render } from "@react-email/render";
import React from "react";
import { BatchReminder, type BatchReminderProps } from "./batch-reminder";
import { DueReminder, type DueReminderProps } from "./due-reminder";
import { HoldReady, type HoldReadyProps } from "./hold-ready";
import { Rejection, type RejectionProps } from "./rejection";
import { Welcome, type WelcomeProps } from "./welcome";

// Re-export prop types so callers can import from a single path.
export type { BatchReminderProps, DueReminderProps, HoldReadyProps, RejectionProps, WelcomeProps };

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

export function renderDueReminder(props: DueReminderProps): Promise<string> {
  return render(React.createElement(DueReminder, props));
}

export function renderHoldReady(props: HoldReadyProps): Promise<string> {
  return render(React.createElement(HoldReady, props));
}

export function renderWelcome(props: WelcomeProps): Promise<string> {
  return render(React.createElement(Welcome, props));
}

export function renderRejection(props: RejectionProps): Promise<string> {
  return render(React.createElement(Rejection, props));
}

export function renderBatchReminder(props: BatchReminderProps): Promise<string> {
  return render(React.createElement(BatchReminder, props));
}
