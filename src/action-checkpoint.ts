// Pause an action step until a screen check confirms the result.
export type ActionCheckpoint = {
  expectedAction: string;
  completionCondition: string;
  app: string;
  sensitive: boolean;
};
export function validCheckpoint(value: unknown): value is ActionCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as ActionCheckpoint;
  return (
    [
      checkpoint.expectedAction,
      checkpoint.completionCondition,
      checkpoint.app,
    ].every(
      (text) => typeof text === "string" && !!text.trim() && text.length <= 400,
    ) && typeof checkpoint.sensitive === "boolean"
  );
}
export type CheckResult = "complete" | "incomplete" | "ambiguous" | "wrong-app";
export class ActionGate {
  revision = 0;
  armed = false;
  watchUntil = 0;
  // Start checking after narration gives the student a chance to act.
  arm(now = Date.now()) {
    if (this.watchUntil || this.confirmed) return;
    this.armed = true;
    this.watchUntil = now + 120_000;
  }
  // A new interaction can retry a paused check without resetting its budget.
  resume(now = Date.now()) {
    if (
      !this.watchUntil ||
      now >= this.watchUntil ||
      this.action.sensitive ||
      this.confirmed ||
      this.attempts >= 5
    )
      return false;
    this.armed = true;
    return true;
  }
  canWatch(now = Date.now()) {
    return (
      this.armed &&
      !this.action.sensitive &&
      !this.confirmed &&
      this.attempts < 5 &&
      now < this.watchUntil
    );
  }
  confirmed: "model" | undefined;
  checking = false;
  lastCheck = 0;
  attempts = 0;
  constructor(
    readonly turn: number,
    readonly step: number,
    readonly action: ActionCheckpoint,
  ) {}
  // Ignore a check that finishes after the screen changes.
  invalidate() {
    this.revision++;
    this.checking = false;
  }
  begin(now = Date.now()) {
    if (
      this.confirmed ||
      this.checking ||
      this.attempts >= 5 ||
      now - this.lastCheck < 3000
    )
      return undefined;
    this.lastCheck = now;
    this.attempts++;
    this.checking = true;
    return ++this.revision;
  }
  finish(revision: number, result: CheckResult) {
    if (revision !== this.revision || !this.checking || this.confirmed)
      return false;
    this.checking = false;
    if (result === "complete") this.confirmed = "model";
    return !!this.confirmed;
  }
}
