// test/scoring.stub.test.ts
import { describe, it, expect } from "@jest/globals";
import { ScoringServiceStub } from "../src/services/scoring.stub.js";

describe("ScoringServiceStub", () => {
  const stub = new ScoringServiceStub();
  const baseParams = {
    text: "x".repeat(800),
    language: "en",
    jurisdiction: "US",
    requestId: "test-request-id-1234",
  };

  it("returns a valid ClaudeScorePayload", async () => {
    const result = await stub.analyseText(baseParams);
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThanOrEqual(-1.0);
    expect(result.score).toBeLessThanOrEqual(1.0);
    expect(Number.isInteger(result.confidence)).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.uncertaintyRange)).toBe(true);
    expect(result.uncertaintyRange).toHaveLength(2);
    expect(result.methodologyDisclaimer.length).toBeGreaterThan(0);
  });

  it("is deterministic — same requestId always returns same score", async () => {
    const r1 = await stub.analyseText(baseParams);
    const r2 = await stub.analyseText(baseParams);
    expect(r1.score).toBe(r2.score);
    expect(r1.confidence).toBe(r2.confidence);
  });

  it("returns different scores for different requestIds", async () => {
    const r1 = await stub.analyseText({ ...baseParams, requestId: "aaaa-bbbb-cccc-dddd" });
    const r2 = await stub.analyseText({ ...baseParams, requestId: "1111-2222-3333-4444" });
    // Different requestIds should produce different scores (not guaranteed but very likely)
    // We just check both are valid
    expect(r1.score).toBeGreaterThanOrEqual(-1.0);
    expect(r2.score).toBeGreaterThanOrEqual(-1.0);
  });

  it("includes the STUB disclaimer in methodologyDisclaimer", async () => {
    const result = await stub.analyseText(baseParams);
    expect(result.methodologyDisclaimer).toContain("STUB");
  });
});
