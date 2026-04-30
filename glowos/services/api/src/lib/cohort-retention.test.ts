import { describe, it, expect } from "vitest";
import {
  LOOKFORWARD_DAYS,
  SAMPLE_SIZE_THRESHOLD,
} from "./cohort-retention.js";

describe("cohort-retention constants", () => {
  it("uses 60-day lookforward window", () => {
    expect(LOOKFORWARD_DAYS).toBe(60);
  });

  it("uses 5 as the cohort sample-size threshold", () => {
    expect(SAMPLE_SIZE_THRESHOLD).toBe(5);
  });
});
