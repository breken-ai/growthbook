import {
  collectAnalysisFailures,
  collectSnapshotFailures,
  findAnalysisComputeFailure,
  isAnalysisAllowed,
  snapshotStatusFromAnalyses,
} from "../../src/util";
import type {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";

describe("isAnalysisAllowed", () => {
  const baseSnapshotSettings = {
    dimensions: [{ id: "precomputed:country" }],
    regressionAdjustmentEnabled: false,
  } as ExperimentSnapshotSettings;

  const baseAnalysisSettings = {
    dimensions: [],
    regressionAdjusted: false,
  } as ExperimentSnapshotAnalysisSettings;

  it("allows precomputed unit dimensions from snapshot settings", () => {
    expect(
      isAnalysisAllowed(
        {
          ...baseSnapshotSettings,
          precomputedUnitDimensionIds: ["dim_country"],
        },
        {
          ...baseAnalysisSettings,
          dimensions: ["dim_country"],
        },
      ),
    ).toBe(true);
  });

  it("rejects dimensions that were not computed by the snapshot", () => {
    expect(
      isAnalysisAllowed(baseSnapshotSettings, {
        ...baseAnalysisSettings,
        dimensions: ["dim_country"],
      }),
    ).toBe(false);
  });
});

type AnalysisMetrics =
  ExperimentSnapshotAnalysis["results"][number]["variations"][number]["metrics"];

function makeAnalysis(
  metrics: AnalysisMetrics,
  status: ExperimentSnapshotAnalysis["status"] = "success",
  otherVariationMetrics: AnalysisMetrics[] = [],
): ExperimentSnapshotAnalysis {
  return {
    analysisKey: "analysis_1",
    dateCreated: new Date("2026-08-25T00:00:00Z"),
    status,
    settings: {
      dimensions: [],
      statsEngine: "bayesian",
      differenceType: "relative",
      numGoalMetrics: 1,
      numGuardrailMetrics: 0,
    },
    results: [
      {
        name: "All",
        srm: 1,
        variations: [metrics, ...otherVariationMetrics].map((metrics) => ({
          users: 0,
          metrics,
        })),
      },
    ],
  };
}

describe("findAnalysisComputeFailure", () => {
  it("returns the first experiment metric that failed to compute", () => {
    const analysis = makeAnalysis({
      failed: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "analysis failed",
      },
    });

    expect(findAnalysisComputeFailure(analysis)).toEqual({
      metricId: "failed",
      errorMessage: "analysis failed",
    });
  });

  it("ignores benign metric error messages", () => {
    const analysis = makeAnalysis({
      healthy: {
        value: 1,
        cr: 0.1,
        users: 10,
        errorMessage: "no units",
      },
    });

    expect(findAnalysisComputeFailure(analysis)).toBeNull();
  });

  it("accepts a missing analysis", () => {
    expect(findAnalysisComputeFailure(null)).toBeNull();
  });
});

describe("collectAnalysisFailures", () => {
  it("collects a single failed metric with its message", () => {
    const analysis = makeAnalysis({
      failed: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "analysis failed",
      },
    });

    expect(collectAnalysisFailures(analysis)).toEqual({
      metrics: { failed: "analysis failed" },
    });
  });

  it("collects every failed metric in one analysis", () => {
    const analysis = makeAnalysis({
      failedA: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "boom a",
      },
      failedB: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "boom b",
      },
      healthy: { value: 1, cr: 0.1, users: 10 },
    });

    expect(collectAnalysisFailures(analysis)).toEqual({
      metrics: { failedA: "boom a", failedB: "boom b" },
    });
  });

  it("records a null message when gbstats supplied none", () => {
    const analysis = makeAnalysis({
      failed: { value: 0, cr: 0, users: 0, computeFailed: true },
    });

    expect(collectAnalysisFailures(analysis)).toEqual({
      metrics: { failed: null },
    });
  });

  it("keeps the first non-null message for a metric spread across variations", () => {
    const analysis = makeAnalysis(
      { failed: { value: 0, cr: 0, users: 0, computeFailed: true } },
      "success",
      [
        {
          failed: {
            value: 0,
            cr: 0,
            users: 0,
            computeFailed: true,
            errorMessage: "second variation message",
          },
        },
      ],
    );

    expect(collectAnalysisFailures(analysis)).toEqual({
      metrics: { failed: "second variation message" },
    });
  });

  it("returns null for a clean analysis", () => {
    const analysis = makeAnalysis({
      healthy: { value: 1, cr: 0.1, users: 10, errorMessage: "no units" },
    });

    expect(collectAnalysisFailures(analysis)).toBeNull();
  });

  it("returns null for a missing analysis", () => {
    expect(collectAnalysisFailures(null)).toBeNull();
  });
});

describe("collectSnapshotFailures", () => {
  it("keys failures by analysis index and omits clean analyses", () => {
    const clean = makeAnalysis({ healthy: { value: 1, cr: 0.1, users: 10 } });
    const failing = makeAnalysis({
      failed: {
        value: 0,
        cr: 0,
        users: 0,
        computeFailed: true,
        errorMessage: "boom",
      },
    });

    expect(collectSnapshotFailures({ analyses: [clean, failing] })).toEqual({
      1: { metrics: { failed: "boom" } },
    });
  });

  it("returns an empty object when all analyses are clean", () => {
    const clean = makeAnalysis({ healthy: { value: 1, cr: 0.1, users: 10 } });

    expect(collectSnapshotFailures({ analyses: [clean] })).toEqual({});
  });
});

describe("snapshotStatusFromAnalyses", () => {
  it("returns partial-success when any analysis is partial", () => {
    expect(
      snapshotStatusFromAnalyses([
        { status: "success" },
        { status: "partial" },
      ]),
    ).toBe("partial-success");
  });

  it("returns success when all analyses succeeded", () => {
    expect(
      snapshotStatusFromAnalyses([
        { status: "success" },
        { status: "success" },
      ]),
    ).toBe("success");
  });

  it("returns partial-success when a whole analysis errored", () => {
    expect(
      snapshotStatusFromAnalyses([{ status: "success" }, { status: "error" }]),
    ).toBe("partial-success");
  });
});
