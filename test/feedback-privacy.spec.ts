import { privacyGrant, PRIVACY_NOTICE_VERSION } from "../src/feedback/privacy";
describe("separate explicit processing purposes", () => {
  it("defaults private/public purposes off and requires the displayed notice version for a grant", () => {
    expect(privacyGrant({})).toMatchObject({
      privateAnalyticsAllowed: false,
      privateCoachingAllowed: false,
      publicAnalyticsAllowed: false,
    });
    expect(() => privacyGrant({ privateCoachingAllowed: true })).toThrow();
    expect(
      privacyGrant({
        privateAnalyticsAllowed: true,
        privateCoachingAllowed: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      }),
    ).toMatchObject({
      privateAnalyticsAllowed: true,
      privateCoachingAllowed: true,
      publicAnalyticsAllowed: false,
      privateAnalyticsConsentAt: expect.any(Date),
      privateCoachingConsentAt: expect.any(Date),
    });
  });
  it("does not accept a preparer granting permission for an assigned registered reviewer", () => {
    expect(
      privacyGrant(
        {
          privateAnalyticsAllowed: true,
          privateCoachingAllowed: true,
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        },
        false,
      ),
    ).toEqual({
      privateAnalyticsAllowed: false,
      privateCoachingAllowed: false,
      publicAnalyticsAllowed: false,
    });
  });
  it("allows withdrawal without accepting a new notice and never treats old field names as new grants", () => {
    expect(privacyGrant({ privateCoachingAllowed: false })).not.toHaveProperty(
      "privateCoachingConsentAt",
    );
    expect(
      privacyGrant({ analyticsAllowed: true, evidenceAllowed: true } as object),
    ).toMatchObject({
      privateAnalyticsAllowed: false,
      privateCoachingAllowed: false,
      publicAnalyticsAllowed: false,
    });
  });
});
