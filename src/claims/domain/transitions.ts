import type { ClaimStatus } from "./claim";

export type TransitionAction = "submit" | "approve" | "reject" | "pay";

export const TRANSITIONS: Record<TransitionAction, { from: ClaimStatus; to: ClaimStatus; adminOnly: boolean }> = {
  submit: { from: "draft", to: "submitted", adminOnly: false },
  approve: { from: "submitted", to: "approved", adminOnly: true },
  reject: { from: "submitted", to: "rejected", adminOnly: true },
  pay: { from: "approved", to: "paid", adminOnly: true },
};

/** Nama event di claim_events untuk tiap transisi. */
export const ACTION_EVENT: Record<TransitionAction, string> = {
  submit: "submitted",
  approve: "approved",
  reject: "rejected",
  pay: "paid",
};
