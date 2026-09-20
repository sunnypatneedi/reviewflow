export class ActiveTimeTracker {
  private elapsed = 0;
  private startedAt: number | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  reset(active: boolean): void {
    this.elapsed = 0;
    this.startedAt = active ? this.now() : null;
  }

  setActive(active: boolean): void {
    if (active && this.startedAt === null) {
      this.startedAt = this.now();
    } else if (!active && this.startedAt !== null) {
      this.elapsed += this.now() - this.startedAt;
      this.startedAt = null;
    }
  }

  milliseconds(): number {
    const current = this.startedAt === null ? 0 : this.now() - this.startedAt;
    return Math.max(0, Math.round(this.elapsed + current));
  }
}
