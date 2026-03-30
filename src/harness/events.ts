// Event capture module — SORTIE_PROTOCOL_v3.md Section 15
// Captures run events and produces a RunSummary with per-step breakdowns.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunEvent {
  type:
    | "reviewer:start"
    | "reviewer:complete"
    | "reviewer:error"
    | "debrief:start"
    | "debrief:complete"
    | "debrief:error"
    | "triage:complete"
    | "pipeline:complete";
  step: string;
  timestamp: string; // ISO 8601
  duration_ms?: number;
  tokens?: number;
  cost?: number;
  error?: string;
}

export interface StepSummary {
  tokens: number;
  cost: number;
  wall_time_ms: number;
  error?: string;
}

export interface RunSummary {
  total_tokens: number;
  total_cost: number;
  total_wall_time_ms: number;
  by_step: Record<string, StepSummary>;
  events: RunEvent[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class RunEventEmitter {
  private events: RunEvent[] = [];

  /**
   * Record a run event.
   */
  emit(event: RunEvent): void {
    this.events.push(event);
  }

  /**
   * Return a shallow copy of all recorded events, preserving insertion order.
   */
  getEvents(): RunEvent[] {
    return [...this.events];
  }

  /**
   * Aggregate all recorded events into a RunSummary.
   *
   * - `total_wall_time_ms` is the span from the earliest to the latest
   *   timestamp. When fewer than two events exist it is 0.
   * - Optional numeric fields (`tokens`, `cost`, `duration_ms`) default to 0
   *   when absent.
   * - The last `error` string seen for a step is preserved in `by_step`.
   */
  getSummary(): RunSummary {
    const byStep: Record<string, StepSummary> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const event of this.events) {
      const tokens = event.tokens ?? 0;
      const cost = event.cost ?? 0;
      const duration = event.duration_ms ?? 0;

      totalTokens += tokens;
      totalCost += cost;

      let step = byStep[event.step];
      if (!step) {
        step = { tokens: 0, cost: 0, wall_time_ms: 0 };
        byStep[event.step] = step;
      }

      step.tokens += tokens;
      step.cost += cost;
      step.wall_time_ms += duration;

      if (event.error !== undefined) {
        step.error = event.error;
      }
    }

    let totalWallTimeMs = 0;
    if (this.events.length >= 2) {
      let minTime = Infinity;
      let maxTime = -Infinity;
      for (const event of this.events) {
        const t = new Date(event.timestamp).getTime();
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
      }
      totalWallTimeMs = maxTime - minTime;
    }

    return {
      total_tokens: totalTokens,
      total_cost: totalCost,
      total_wall_time_ms: totalWallTimeMs,
      by_step: byStep,
      events: this.getEvents(),
    };
  }

  /**
   * Clear all recorded events.
   */
  reset(): void {
    this.events = [];
  }
}
