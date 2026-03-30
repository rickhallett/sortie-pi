// Event capture tests — SORTIE_PROTOCOL_v3.md Section 15
// Written FIRST (TDD red phase)

import { describe, test, expect } from "bun:test";
import { RunEventEmitter } from "./events.js";
import type { RunEvent, RunSummary } from "./events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<RunEvent> = {}): RunEvent {
  return {
    type: "reviewer:start",
    step: "claude-sonnet",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// emit() stores events
// ---------------------------------------------------------------------------

describe("RunEventEmitter", () => {
  test("emit() stores events", () => {
    const emitter = new RunEventEmitter();
    const event = makeEvent();
    emitter.emit(event);
    expect(emitter.getEvents()).toHaveLength(1);
    expect(emitter.getEvents()[0]).toEqual(event);
  });

  // -------------------------------------------------------------------------
  // getEvents() returns all emitted events in order
  // -------------------------------------------------------------------------

  test("getEvents() returns all emitted events in order", () => {
    const emitter = new RunEventEmitter();
    const e1 = makeEvent({ type: "reviewer:start", step: "claude-sonnet", timestamp: "2026-03-30T10:00:00.000Z" });
    const e2 = makeEvent({ type: "reviewer:complete", step: "claude-sonnet", timestamp: "2026-03-30T10:00:01.000Z" });
    const e3 = makeEvent({ type: "debrief:start", step: "debrief", timestamp: "2026-03-30T10:00:02.000Z" });
    emitter.emit(e1);
    emitter.emit(e2);
    emitter.emit(e3);
    const events = emitter.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual(e1);
    expect(events[1]).toEqual(e2);
    expect(events[2]).toEqual(e3);
  });

  // -------------------------------------------------------------------------
  // getSummary() totals tokens across all events
  // -------------------------------------------------------------------------

  test("getSummary() totals tokens across all events", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent({ tokens: 100 }));
    emitter.emit(makeEvent({ tokens: 250 }));
    emitter.emit(makeEvent({ tokens: 50 }));
    const summary = emitter.getSummary();
    expect(summary.total_tokens).toBe(400);
  });

  // -------------------------------------------------------------------------
  // getSummary() totals cost across all events
  // -------------------------------------------------------------------------

  test("getSummary() totals cost across all events", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent({ cost: 0.01 }));
    emitter.emit(makeEvent({ cost: 0.02 }));
    emitter.emit(makeEvent({ cost: 0.005 }));
    const summary = emitter.getSummary();
    expect(summary.total_cost).toBeCloseTo(0.035, 10);
  });

  // -------------------------------------------------------------------------
  // getSummary() computes wall time from first event to last event timestamp
  // -------------------------------------------------------------------------

  test("getSummary() computes wall time from first event to last event timestamp", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent({ timestamp: "2026-03-30T10:00:00.000Z" }));
    emitter.emit(makeEvent({ timestamp: "2026-03-30T10:00:01.500Z" }));
    emitter.emit(makeEvent({ timestamp: "2026-03-30T10:00:05.000Z" }));
    const summary = emitter.getSummary();
    expect(summary.total_wall_time_ms).toBe(5000);
  });

  // -------------------------------------------------------------------------
  // getSummary() breaks down by step name
  // -------------------------------------------------------------------------

  test("getSummary() breaks down by step name", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent({ step: "claude-sonnet", tokens: 100, cost: 0.01, duration_ms: 500 }));
    emitter.emit(makeEvent({ step: "claude-sonnet", tokens: 200, cost: 0.02, duration_ms: 700 }));
    emitter.emit(makeEvent({ step: "debrief", tokens: 50, cost: 0.005, duration_ms: 300 }));
    const summary = emitter.getSummary();

    expect(summary.by_step["claude-sonnet"]).toBeDefined();
    expect(summary.by_step["claude-sonnet"].tokens).toBe(300);
    expect(summary.by_step["claude-sonnet"].cost).toBeCloseTo(0.03, 10);
    expect(summary.by_step["claude-sonnet"].wall_time_ms).toBe(1200);

    expect(summary.by_step["debrief"]).toBeDefined();
    expect(summary.by_step["debrief"].tokens).toBe(50);
    expect(summary.by_step["debrief"].cost).toBeCloseTo(0.005, 10);
    expect(summary.by_step["debrief"].wall_time_ms).toBe(300);
  });

  // -------------------------------------------------------------------------
  // getSummary() handles events with missing optional fields
  // -------------------------------------------------------------------------

  test("getSummary() handles events with missing optional fields (no tokens, no cost)", () => {
    const emitter = new RunEventEmitter();
    // Event with no tokens, no cost, no duration_ms
    emitter.emit(makeEvent({ step: "claude-sonnet" }));
    // Event with only tokens
    emitter.emit(makeEvent({ step: "claude-sonnet", tokens: 100 }));
    const summary = emitter.getSummary();
    expect(summary.total_tokens).toBe(100);
    expect(summary.total_cost).toBe(0);
    expect(summary.by_step["claude-sonnet"].tokens).toBe(100);
    expect(summary.by_step["claude-sonnet"].cost).toBe(0);
  });

  // -------------------------------------------------------------------------
  // reset() clears all events
  // -------------------------------------------------------------------------

  test("reset() clears all events", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent());
    emitter.emit(makeEvent());
    expect(emitter.getEvents()).toHaveLength(2);

    emitter.reset();

    expect(emitter.getEvents()).toHaveLength(0);
    const summary = emitter.getSummary();
    expect(summary.total_tokens).toBe(0);
    expect(summary.total_cost).toBe(0);
    expect(summary.total_wall_time_ms).toBe(0);
    expect(summary.events).toHaveLength(0);
    expect(Object.keys(summary.by_step)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Events without duration/tokens/cost default to 0 in summary
  // -------------------------------------------------------------------------

  test("events without duration/tokens/cost default to 0 in summary", () => {
    const emitter = new RunEventEmitter();
    emitter.emit({
      type: "reviewer:start",
      step: "claude-sonnet",
      timestamp: "2026-03-30T10:00:00.000Z",
      // no duration_ms, tokens, or cost
    });
    const summary = emitter.getSummary();
    expect(summary.total_tokens).toBe(0);
    expect(summary.total_cost).toBe(0);
    expect(summary.by_step["claude-sonnet"].tokens).toBe(0);
    expect(summary.by_step["claude-sonnet"].cost).toBe(0);
    expect(summary.by_step["claude-sonnet"].wall_time_ms).toBe(0);
  });

  // -------------------------------------------------------------------------
  // getSummary() captures error from events in by_step
  // -------------------------------------------------------------------------

  test("getSummary() captures error from events in by_step", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent({
      type: "reviewer:error",
      step: "claude-sonnet",
      error: "timeout exceeded",
    }));
    const summary = emitter.getSummary();
    expect(summary.by_step["claude-sonnet"].error).toBe("timeout exceeded");
  });

  // -------------------------------------------------------------------------
  // getSummary().events returns the same events as getEvents()
  // -------------------------------------------------------------------------

  test("getSummary().events returns the same events as getEvents()", () => {
    const emitter = new RunEventEmitter();
    const e1 = makeEvent({ step: "claude-sonnet" });
    const e2 = makeEvent({ step: "debrief" });
    emitter.emit(e1);
    emitter.emit(e2);
    const summary = emitter.getSummary();
    expect(summary.events).toEqual(emitter.getEvents());
  });

  // -------------------------------------------------------------------------
  // getEvents() returns a copy (not a mutable reference)
  // -------------------------------------------------------------------------

  test("getEvents() returns a copy, not a mutable reference", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent());
    const events = emitter.getEvents();
    events.push(makeEvent({ step: "injected" }));
    // Original should be untouched
    expect(emitter.getEvents()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // wall time is 0 when only a single event exists
  // -------------------------------------------------------------------------

  test("wall time is 0 when only a single event exists", () => {
    const emitter = new RunEventEmitter();
    emitter.emit(makeEvent({ timestamp: "2026-03-30T10:00:00.000Z" }));
    const summary = emitter.getSummary();
    expect(summary.total_wall_time_ms).toBe(0);
  });

  // -------------------------------------------------------------------------
  // wall time uses min/max timestamps, not insertion order
  // -------------------------------------------------------------------------

  test("wall time uses min/max timestamps, not insertion order", () => {
    const emitter = new RunEventEmitter();
    // Insert out of chronological order
    emitter.emit({ type: "reviewer:complete", step: "b", timestamp: "2026-03-30T12:00:10Z", tokens: 100 });
    emitter.emit({ type: "reviewer:start", step: "a", timestamp: "2026-03-30T12:00:00Z", tokens: 50 });
    emitter.emit({ type: "reviewer:complete", step: "c", timestamp: "2026-03-30T12:00:05Z", tokens: 75 });
    const summary = emitter.getSummary();
    expect(summary.total_wall_time_ms).toBe(10000); // 10s between 00:00 and 00:10
  });

  test("wall time is never negative even with reversed insertion", () => {
    const emitter = new RunEventEmitter();
    emitter.emit({ type: "reviewer:complete", step: "late", timestamp: "2026-03-30T12:00:30Z" });
    emitter.emit({ type: "reviewer:start", step: "early", timestamp: "2026-03-30T12:00:00Z" });
    const summary = emitter.getSummary();
    expect(summary.total_wall_time_ms).toBeGreaterThanOrEqual(0);
    expect(summary.total_wall_time_ms).toBe(30000);
  });
});
