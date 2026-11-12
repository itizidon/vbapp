# Five-card volleyball feedback

The existing registered and invitation feedback forms now share a five-category card flow: **Attacking → Defense → Passing → Setting → Serving**, followed by a review-and-submit screen. Only one illustrated skill card is mounted at a time. The original recipient, invitation, match, registered/guest identity, same-device reset and assigned-reviewer approval behavior remain.

## Components and files

- `frontend/src/components/feedback-form.tsx`: invitation/catalog fetching, shared answers, identity/context, navigation, final validation and the existing mutation.
- `feedback-category-card.tsx`: native-ratio artwork, backend description, nullable five-star answer, 5,000-character skill comment and Previous/Skip/Next controls.
- `feedback-star-rating.tsx`: accessible radio group, hover preview, touch/click selection, explicit Clear Rating, roving keyboard focus, arrows/Home/End and exact screen-reader values.
- `feedback-reviewer-header.tsx`: actual submitter identity and badge, recipient and separate designated approver.
- `feedback-review-summary.tsx`: all five outcomes, selected scores/comments, skipped/unavailable labels and Edit actions.
- `frontend/src/lib/feedback-steps.ts`: category order, asset metadata, backend skill matching and payload extraction.
- `frontend/src/app/globals.css`: scoped sunset/gold/teal styling, responsive cards, persistent recipient/progress bar and short reduced-motion-aware transitions.
- Frontend unit tests and existing platform/approval Playwright fixtures updated for sequential navigation and the final review screen.

## Existing artwork

All paths were verified in the repository. Source images are imported statically and rendered with `next/image` responsive optimization; no generated images, copied assets or new dependencies were added. Their full intrinsic aspect ratio is retained, so neither the featured player nor ball is cropped. Only a lower gradient blends the artwork into the controls.

| Card | Backend slug aliases | Existing image |
| --- | --- | --- |
| Attacking | attack, attacking, spike | `/assets/feedback_bg_attacking.png` |
| Defense | defense, defence | `/assets/feedback_bg_defense.png` |
| Passing | passing, bump | `/assets/feedback_bg_passing.png` |
| Setting | setting, set | `/assets/feedback_bg_setting.png` |
| Serving | serving, serve | `/assets/feedback_bg_serving.png` |

Files are under `frontend/public/assets/`. Include these five supplied PNGs when committing/deploying; they were untracked assets when implementation began. The supplied collection/collage image is left untouched.

Backend IDs are never hardcoded. Slugs match the existing centralized volleyball aliases, with a backend-name fallback for older records. Labels use the requested display names, so backend `Attack` displays as `Attacking`; backend descriptions and immutable skill IDs are retained. Inactive skills are excluded. Missing canonical records display an unavailable card and can be skipped; no IDs or scores are invented. If none of the five exist, an empty state is shown. Additional categories outside these five are intentionally not part of this flow.

## State and navigation

Answers are a sparse `Record<skillId, SkillFeedbackAnswer>`:

```ts
type SkillFeedbackAnswer = {
  skillId: string;
  rating: number | null;
  comment: string;
  skipped: boolean;
};
```

An unanswered entry resolves to a null rating, blank comment and `skipped: false`. No zero scores or default positive ratings are stored. Selecting/editing a rating or comment updates shared parent state immediately. Previous and review Edit preserve answers and restore the associated artwork. Skip explicitly sets rating to null, clears the comment, marks skipped and advances. Clearing only the rating retains the comment so the reviewer can correct it; Next blocks a nonempty comment without a rating, rather than silently discarding it.

The existing product permits omitting individual skills. Next on an entirely blank category therefore records a skip and continues. The last card opens **Review Feedback**. All five outcomes are summarized; at least one rating is still required. The review screen retains the optional overall written feedback and existing privacy choices. Enter/Next/Previous never submits an intermediate card. Final Submit Feedback is disabled while sending, and the existing synchronous submission lock prevents duplicate requests. Errors retain all answers and allow retry. Guest-only **Next reviewer** clears identity, every answer, comments, errors and progress while preserving the invitation/match.

Draft state lasts for the current mounted form; reload/navigation does not autosave it. This feature adds no browser persistence or per-card server writes.

## Identity and backend integration

The header shows the actual signed-in player with a Registered Player badge, or the entered guest name/Guest Reviewer with a guest badge. Same-device guest mode deliberately hides the account identity and login/signup actions. The recipient is read-only and remains named in the sticky progress panel throughout the flow. Linked match teams/scores remain read-only behind a compact context disclosure; registered non-invitation forms retain their existing match selector.

For assigned invitations, **Submitted by** refers to the actual preparer, while **Awaiting approval from @reviewer** uses verified backend invitation data. A guest is never labelled authenticated merely because a registered approver was assigned. Even the assigned signed-in user still submits a Pending draft and must explicitly approve it later.

Submission reuses `submitGuestFeedback` for guests and assigned-link drafts, and `submitFeedback` for normal authenticated reviews. Only matched, rated, non-skipped skill IDs and their individual trimmed comments enter `ratings`. Skipped/unavailable skills do not create `FeedbackRating` rows and cannot reduce internal ratings. No reviewer ID or publication status is supplied by the form. The existing server decides identity, Pending/publication, approval authorization and rating eligibility. No backend API, Prisma model, migration or internal rating algorithm was changed.

## Verification

The full frontend unit suite passes: **104 tests**. Coverage includes all five image mappings/order, one card at a time, backend descriptions/IDs, nullable/unselected scores, hover and keyboard interaction, comments, Skip, Previous, persistence, review edits, single final mutation, guest/registered/assigned identity, errors, duplicate prevention, missing categories, match scope and next-reviewer reset.

Frontend TypeScript, the webpack production build and full lint passed; lint retains six existing warnings and no errors.

Real browser verification includes:

- Assigned-link guest and authenticated draft submission, Pending isolation, Account approval/rejection and actual internal rating changes at **320, 375 and 1440px**, using a disposable migrated/seeded PostgreSQL database.
- Twelve existing feedback regressions across **375 and 1440px**: QR/copy/share-to-guest submission, linked read-only match scope, ordinary registered submissions, backend descriptions, login/signup return paths, session changes in another tab, and unrated comment validation.

Preview captures are saved under `/tmp/vbapp-feedback-cards-width-*.png` and `/tmp/vbapp-feedback-review-width-*.png`. Existing approval test instructions remain in [feedback-approvals.md](feedback-approvals.md).

## Image caching and themes

The five PNGs are static imports. Next.js derives intrinsic dimensions and content-hashed asset URLs during the build, so replacing an image under the same filename produces a new URL on rebuild. Long-lived immutable caching stays enabled; the optimized image cache is keyed by the new source URL. There are no timestamp query parameters, disabled caches or manual cache-purge requirements. Only the current card is rendered and requests its artwork, with responsive sizes and the existing default WebP optimizer. Updated deployed artwork requires a frontend rebuild/redeploy with the updated PNGs included; development watches the imports.

The component now follows the existing light/dark theme toggle through scoped CSS tokens. Light mode uses warm cream cards, white inputs, dark teal text and amber controls. Dark mode keeps the teal surfaces and gold controls. Both palettes cover identity/context, card fade, ratings, comments, progress, errors and review. Changing theme preserves all form answers.

Validation for this update: all 104 frontend tests, TypeScript, production build and lint (zero errors, six existing warnings) passed. Production browser checks at 320, 375 and 1440 pixels confirmed hashed immutable assets, WebP responses, optimized-cache HITs, only current-card artwork loading, readable heading/body contrast, no horizontal overflow and retained review answers when toggling themes. No new dependencies, backend changes or migrations were needed.

## Card-first layout

The card/progress area is now first in both DOM and visual order. At desktop widths (1024px and up), a wider 964px form places a 620px rating/review column beside a 320px identity/context sidebar with a 24px gap. The sidebar contains reviewer/recipient information, guest name/login controls and match context, and stays available while scrolling. Expanded sidebar content scrolls within the viewport. Smaller screens put the same sidebar below the card. Both areas remain within the same form/disabled fieldset, preserving guest-name validation, entered answers and submission locking. The public invitation page container was widened to accommodate the two columns.

Guest names are optional. Blank, whitespace-only or omitted guest names use the backend label **Guest reviewer**, preserving the existing database identity rule. Signed-in reviewers retain their verified account identity; designated approvers still come from the invitation.
