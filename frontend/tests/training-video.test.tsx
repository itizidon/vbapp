import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AnalysisResults, qualityMessage } from "@/components/training-videos";
import type { Analysis, Submission } from "@/lib/training-video";
vi.mock("@/lib/training-video", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  playback: vi
    .fn()
    .mockResolvedValue({
      url: "https://example.test/private-signed",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }),
}));
const submission = {
  id: "player",
  createdAt: "2026-11-19T12:00:00Z",
  jobs: [],
  analyses: [],
} as unknown as Submission;
const result = {
  id: "analysis",
  status: "COMPLETED",
  analysisVersion: "test",
  result: {
    comparison: {
      overallSimilarity: null,
      scoreLabel: "Experimental movement similarity",
      aggregation: "Median of compatible references.",
      limitations: ["Projected 2D only."],
      references: [],
      checkpoints: [
        {
          checkpointId: "c",
          name: "Ball contact",
          status: "NOT_SUPPORTED",
          similarity: null,
          quality: null,
          evidence: [],
          perReference: [],
          limitations: ["Ball contact cannot be located reliably."],
        },
      ],
    },
    coaching: {
      source: "DETERMINISTIC",
      summary: "Not enough reliable measurements.",
      consistent: [],
      improve: [],
      practice: [],
    },
  },
} as unknown as Analysis;
describe("private movement results", () => {
  it("shows insufficient measurements without inventing a score", () => {
    render(<AnalysisResults analysis={result} submission={submission} />);
    expect(screen.getByText("Not enough information")).toBeInTheDocument();
    expect(screen.getByText("Not evaluated")).toBeInTheDocument();
    expect(
      screen.getByText(/not a correctness percentage/),
    ).toBeInTheDocument();
  });
  it("shows unavailable state without an active progress spinner", () => {
    render(
      <AnalysisResults
        analysis={{
          ...result,
          status: "ANALYSIS_UNAVAILABLE",
          errorCode: "NO_COMPATIBLE_REFERENCES",
        }}
        submission={submission}
      />,
    );
    expect(screen.getByText(/No matching demonstration/)).toBeInTheDocument();
    expect(
      screen.queryByText("Experimental movement similarity"),
    ).not.toBeInTheDocument();
  });
  it("offers actionable quality messages", () => {
    expect(qualityMessage("BODY_OUT_OF_FRAME")).toContain("feet");
    expect(qualityMessage("MULTIPLE_PEOPLE")).toContain("one athlete");
  });
  it("shows measured differences and real paired timestamps", () => {
    const data = structuredClone(result);
    data.result!.comparison!.references = [
      {
        referenceVideoId: "ref",
        referenceVersion: 1,
        poseArtifactId: "pose",
        similarity: 80,
        mirrored: false,
      },
    ];
    data.result!.comparison!.checkpoints = [
      {
        checkpointId: "c",
        name: "Knee projection",
        status: "EVALUATED",
        similarity: 80,
        quality: 0.8,
        limitations: [],
        perReference: [],
        evidence: [
          {
            referenceVideoId: "ref",
            playerMs: 1200,
            referenceMs: 900,
            playerValue: 125,
            referenceValue: 160,
            difference: -35,
            quality: 0.8,
            feature: "left_knee_angle",
            unit: "degrees",
          },
        ],
      },
    ];
    render(<AnalysisResults analysis={data} submission={submission} />);
    expect(screen.getByText(/You: 125.0/)).toBeInTheDocument();
    const seek = screen.getByRole("button", {
      name: /View aligned moments · 1.2s \/ 0.9s/,
    });
    fireEvent.click(seek);
  });
});
