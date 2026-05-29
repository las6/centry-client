// ── RateLimiter ───────────────────────────────────────────────────────────────
// Sliding-window rate limiter. Tracks timestamps of recent sends and rejects
// if the count within the window exceeds the cap.

export class RateLimiter {
  private readonly max: number
  private readonly windowMs: number
  private timestamps: number[] = []

  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }

  allow(): boolean {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs)
    if (this.timestamps.length >= this.max) return false
    this.timestamps.push(now)
    return true
  }
}
