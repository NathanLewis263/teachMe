// Pause one action step until the screen check or the student confirms it is done.
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
  // Controls arm this after narration, so we do not check before the student can act.
  arm(now = Date.now()) {
    if (this.armed || this.confirmed) return;
    this.armed = true;
    this.watchUntil = now + 120_000;
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
  confirmed: "model" | "manual" | undefined;
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
  manual() {
    this.invalidate();
    this.confirmed = "manual";
  }
}
