import { RatingAlgorithm, decimal } from "../src/internal-ratings/algorithm";
const a = new RatingAlgorithm();
describe("internal rating algorithm V1", () => {
  it.each([
    [1, 1],
    [2, 3.162277660168],
    [3, 10],
    [4, 31.622776601684],
    [5, 100],
  ])("weights reviewer %s exponentially", (r, w) => {
    expect(a.influence(decimal(r), 1).rawWeight.toNumber()).toBeCloseTo(w, 10);
  });
  it("supports fractional weights and normalized learning rates", () => {
    const influence = a.influence(decimal(3.5), 0.35);
    expect(influence.rawWeight.toNumber()).toBeCloseTo(17.782794100389, 10);
    expect(influence.effectiveRate.toNumber()).toBeCloseTo(
      (0.2 * 17.782794100389) / 37.782794100389,
      11,
    );
    expect(influence.finalRate.toNumber()).toBeCloseTo(
      influence.effectiveRate.toNumber() * 0.35,
      11,
    );
    expect(
      a
        .influence(decimal(5), 1)
        .effectiveRate.div(a.influence(decimal(1), 1).effectiveRate)
        .toNumber(),
    ).toBeCloseTo(17.5, 7);
  });
  it.each([
    [0, 0.1],
    [1, 0.35],
    [4, 0.35],
    [5, 0.75],
    [9, 0.75],
    [10, 1],
  ])("uses deterministic distinct-reviewer confidence at %s", (n, confidence) =>
    expect(a.confidence(n)).toBe(confidence),
  );
  it("bounds and rounds adjustments deterministically, including zero and negatives", () => {
    expect(
      a
        .apply(decimal(3), 5, a.influence(decimal(5), 0.1).finalRate)
        .next.toString(),
    ).toBe("3.03333333");
    expect(
      a
        .apply(decimal(3), 1, a.influence(decimal(5), 0.1).finalRate)
        .next.toString(),
    ).toBe("2.96666667");
    expect(a.apply(decimal(3), 3, decimal(0.2)).delta.toString()).toBe("0");
    expect(a.apply(decimal(5), 5, decimal(1)).next.toString()).toBe("5");
    expect(a.apply(decimal(1), 1, decimal(1)).next.toString()).toBe("1");
    expect(() => a.apply(decimal(3), 6, decimal(0.2))).toThrow();
    expect(() => a.apply(decimal(3), 2.5, decimal(0.2))).toThrow();
  });
  it("uses minimum weight for missing skill ratings and rejects invalid configuration", () => {
    expect(a.influence(null, 0.1).rawWeight.toString()).toBe("1");
    expect(() => new RatingAlgorithm({ normalization: 0 })).toThrow();
    expect(() => new RatingAlgorithm({ thresholds: [5, 1, 10] })).toThrow();
  });
});
