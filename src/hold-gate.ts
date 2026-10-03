// Track the chosen chord only; never retain other key codes or typed text.
export class HoldGate {
  held = false;
  blocked = false;
  update(control: boolean, shift: boolean): "press" | "release" | undefined {
    const down = control && shift;
    if (!down) this.blocked = false;
    if (down === this.held) return;
    this.held = down;
    return down ? (this.blocked ? undefined : "press") : "release";
  }
  cancel() {
    this.blocked = this.held;
  }
}
