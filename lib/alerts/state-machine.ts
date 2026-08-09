export const ATTEMPT_INTERVAL_MS = 21_600_000;
export const PROVIDER_DISPATCH_INTERVAL_MS = {
  flight: 86_400_000,
  express_bus: 3_600_000,
  intercity_bus: 3_600_000,
  ticket: 3_600_000,
  foresttrip: 21_600_000
} as const;

export function isProviderDispatchDue(type: string, lastProviderRunAt: Date | null, now: Date): boolean {
  const interval = PROVIDER_DISPATCH_INTERVAL_MS[type as keyof typeof PROVIDER_DISPATCH_INTERVAL_MS];
  if (interval === undefined) return false;
  if (lastProviderRunAt === null) return true;
  const last = lastProviderRunAt.getTime();
  const current = now.getTime();
  return Number.isFinite(last) && Number.isFinite(current) && current - last >= interval;
}

export type BaselineState = "never" | "matched" | "no_match";
export type DeliveryState = "never" | "reserved" | "sending" | "sent" | "rejected" | "ambiguous" | "suppressed" | "cancelled";
export type LatestOutcome =
  | "never"
  | "success_matched"
  | "success_no_match"
  | "partial"
  | "failed"
  | "blocked_source"
  | "unsupported_shape"
  | "result_type_mismatch"
  | "result_superseded"
  | "parent_disabled"
  | "failed_cooldown"
  | "config_invalid"
  | "message_invalid"
  | "config_changed";

export interface AlertBaseline {
  baselineState: BaselineState;
  baselineFingerprint: string | null;
  baselineTransitionSeq: number;
  baselineAt: Date | null;
  lastAttemptAt: Date | null;
}
export interface LatestOutcomeUpdate {
  latestOutcome: Exclude<LatestOutcome, "success_matched" | "success_no_match">;
  latestOutcomeAt: Date;
  latestOutcomeCode: string | null;
}

/** Failure diagnostics are deliberately isolated from the successful baseline. */
export function recordLatestOutcome(
  outcome: LatestOutcomeUpdate["latestOutcome"],
  now: Date,
  code: string | null = null
): LatestOutcomeUpdate {
  return { latestOutcome: outcome, latestOutcomeAt: now, latestOutcomeCode: code };
}

export type SuccessfulEvaluation =
  | { matched: false }
  | { matched: true; fingerprint: string };

export type SuccessfulTransition = {
  latestOutcome: "success_matched" | "success_no_match";
  baselineState: BaselineState;
  baselineFingerprint: string | null;
  baselineTransitionSeq: number;
  baselineAt: Date;
  deliveryAction: "none" | "suppressed" | "reserve";
};

/**
 * Computes only the successful latest outcome and dedup baseline transition.
 * Non-success outcomes intentionally do not call this function and cannot alter
 * a successful baseline.
 */
export function transitionSuccessfulBaseline(
  previous: AlertBaseline,
  evaluation: SuccessfulEvaluation,
  now: Date
): SuccessfulTransition {
  const latestOutcome = evaluation.matched ? "success_matched" : "success_no_match";
  const base = {
    latestOutcome,
    baselineState: previous.baselineState,
    baselineFingerprint: previous.baselineFingerprint,
    baselineTransitionSeq: previous.baselineTransitionSeq,
    baselineAt: now
  } as const;

  if (!evaluation.matched) {
    if (previous.baselineState === "no_match") {
      return { ...base, deliveryAction: "none" };
    }

    return {
      ...base,
      baselineState: "no_match",
      baselineFingerprint: null,
      baselineTransitionSeq: previous.baselineTransitionSeq + 1,
      deliveryAction: "none"
    };
  }

  if (previous.baselineState === "matched" && previous.baselineFingerprint === evaluation.fingerprint) {
    return { ...base, deliveryAction: "none" };
  }

  const nextSequence = previous.baselineTransitionSeq + 1;
  const eligible = previous.lastAttemptAt === null || now.getTime() - previous.lastAttemptAt.getTime() >= ATTEMPT_INTERVAL_MS;
  return {
    ...base,
    baselineState: "matched",
    baselineFingerprint: evaluation.fingerprint,
    baselineTransitionSeq: nextSequence,
    deliveryAction: eligible ? "reserve" : "suppressed"
  };
}

export function createSuppressedDelivery(now: Date): { deliveryState: "suppressed"; terminalAt: Date } {
  return { deliveryState: "suppressed", terminalAt: now };
}

export interface IncompleteAttempt {
  deliveryState: DeliveryState;
  attemptId: string | null;
  attemptRunId: string | null;
  attemptFingerprint: string | null;
  attemptTransitionSeq: number | null;
  attemptResultId: string | null;
  attemptResultType: string | null;
  lastAttemptAt: Date | null;
}

export type RecoveryClassification =
  | { kind: "none" }
  | { kind: "cancelled"; deliveryState: "cancelled"; code: "RECOVERED_BEFORE_SEND" }
  | { kind: "ambiguous"; deliveryState: "ambiguous"; code: "RECOVERED_DURING_SEND" };

/** Recovery never retries: a pre-send reservation is cancelled; a send fence is ambiguous. */
export function classifyIncompleteAttempt(attempt: IncompleteAttempt): RecoveryClassification {
  if (attempt.deliveryState === "reserved") {
    return { kind: "cancelled", deliveryState: "cancelled", code: "RECOVERED_BEFORE_SEND" };
  }
  if (attempt.deliveryState === "sending") {
    return { kind: "ambiguous", deliveryState: "ambiguous", code: "RECOVERED_DURING_SEND" };
  }
  return { kind: "none" };
}
