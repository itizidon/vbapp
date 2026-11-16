# Five-card volleyball feedback

Registered and invitation forms default to a quick review showing all five categories together. The optional **Review mode** retains the five-category card flow: **Attacking → Defense → Passing → Setting → Serving**, followed by a review-and-submit screen. Only one illustrated skill card is mounted at a time. The original recipient, invitation, match, registered/guest identity, same-device reset and assigned-reviewer approval behavior remain.

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

## Quick review and top information layout

Quick review is the default for registered, invitation and same-device forms. All five star groups appear together without category navigation. Each category has a keyboard-accessible disclosure button with expanded state for its backend description and optional skill comment. Multiple comments may be open at once; collapsed comments remain in the shared draft, and a comment icon marks populated comments. Missing catalog categories remain unavailable rather than producing invented skill IDs. Quick Review leads through **Review & Submit** to the same final summary, overall comment, sharing settings, validation and mutation as Card Review. The summary lists all five categories, including skipped categories, before the final submit.

**Card Review** opens the existing illustrated card flow. **Quick Review** switches back to the flat list. Ratings, per-skill comments, overall comments, reviewer assignment and match context are retained across switches. Card Skip still clears that category; comments without numerical ratings are rejected in either mode. Same-device Next reviewer clears identity/answers and returns to Quick review.

A single Feedback Details panel precedes the rating area in DOM and visual order. Its heading and recipient occupy the left column on desktop; giver selection occupies the right. The panel stacks on mobile and keeps match context in a compact footer. Illustrated cards remain limited to 620px wide beneath that row. Quick mode does not mount illustrated cards or request their artwork. No backend API, approval rule, internal-rating calculation or database migration changes are required.

`feedback-quick-ratings.tsx` reuses `FeedbackStarRating` and the same five backend-mapped steps/answer state as `FeedbackCategoryCard`.

Guest names are optional. Blank, whitespace-only or omitted guest names use the backend label **Guest reviewer**, preserving the existing database identity rule. Signed-in reviewers retain their verified account identity; designated approvers still come from the invitation.

The sidebar now also permits selecting a registered approver for an unassigned invitation or signed-in feedback form. Selected submissions await that player’s Account approval; link-level assignments remain fixed. See [feedback-approvals.md](feedback-approvals.md#choosing-an-approver-in-the-feedback-form) for API, migration and authorization details.

When a guest selects a registered feedback giver (or the invitation fixes one), guest-name/login controls are hidden and the header shows the assigned player with an explicit approval-required badge. Guest names are omitted from assigned guest submission payloads. Removing an optional assignment returns to registered-user search. Switching to Guest restores the guest-name input and its previous draft value. A signed-in preparer retains their verified submitter identity. Assignment never authenticates the selected player or bypasses approval.

Both modes are available for multi-match requests and Quick Review is the default. Individual requests keep each match’s ratings/comments in `answerSets[matchId][skillId]`, retain match notes when navigating, and advance with **Next match** before the final summary of every match. Combined requests use one `answerSets.combined[skillId]` assessment with all selected matches shown as context. Mode switches only change presentation; submission receipts, assignment/approval and internal rating behavior are unchanged. Unrated skills are omitted rather than sent as zero; existing validation still requires a rating to include a skill comment and at least one rating for each individual match. No backend or database changes were added for the mode update.

Mode update validation: 126 frontend tests passed, with 41 relevant regressions rerun after final component cleanup. TypeScript, targeted ESLint and the production webpack build passed. Twelve mocked-API production browser checks passed at 320, 375 and 1440 pixels, covering both multi-match modes, mode switching, summary/submission payloads, layout, artwork and themes. Database-backed approval/internal-rating integration tests were not rerun for this frontend-only update.

## Unified Feedback Details and giver selection

`FeedbackReviewerHeader` now owns one full-width panel for the heading, recipient, giver controls and match context. `FeedbackSubmissionForm` reuses `ReviewerPicker` for a debounced username combobox with initials, keyboard selection, loading/empty/error states, and a removable selected account. The Guest / Registered User segmented control switches the input without clearing skill ratings, comments, overall notes or per-match answers. Registered mode requires an actual selected backend user; typing text alone cannot assign or submit as that user. The existing backend excludes the recipient and validates selected IDs.

Invitation-level assignments initialize Registered User, prepopulate the assigned account and lock both type switching and removal. The header displays the approval explanation once. Verified signed-in submitters keep their identity (Guest is disabled); when choosing another approver, a separate short line identifies the signed-in draft submitter. Same-device mode continues ignoring the host’s account as the feedback giver. Guest names remain optional and unverified. No GraphQL, backend approval, internal-rating, migration or database changes were made for this layout update. Search retries explicitly use a non-submit button.

Unified header validation: all 134 frontend tests and 97 backend unit tests passed. TypeScript, targeted ESLint and the production build passed. Twenty-four selected mocked-API browser scenarios were verified across 320, 375 and 1440px, with the nine header/layout cases rerun after tightening spacing. These cover guest/registered switching, selected IDs, keyboard search, fixed assignments, same-device individual/combined reviews, login in another tab, and existing card artwork/themes. Database-backed approval integration tests were not rerun for this frontend-only change.

## Leaving a feedback form

`FeedbackNavigation` supplies a compact contextual Back link and, on public `/f/[token]` routes, the existing clickable brand and theme control. The brand has an accessible **BVBTips home** label. It links to `/matches` for a known authenticated session and `/` for guests. The existing homepage also resolves authenticated visitors to Matches. Loading and expired invitations retain these controls, and success includes **Return to BVBTips** without directing guests into private pages.

Same-device launches carry `returnTo` with their originating page and filters; the match-to-player review action carries the match detail route. Shared/copy/QR invitation URLs stay free of the creator’s return context. `feedbackReturnDestination` restricts context to existing internal app routes, rejects external/protocol-relative/control-character/auth/review destinations, and allows only public landing/player destinations for unauthenticated visitors. Content authorization on private pages remains with the existing app/backend guards.

The form derives a single dirty flag from actual names, notes, sharing choices, reviewer/match selection and ratings/comments across every match. Mode switches, disclosures and match navigation alone do not dirty the form. The guard captures ordinary same-tab links across the form and app shell, using one accessible Radix exit dialog for Back, brand and other links. **Keep reviewing** retains values and restores focus; **Leave without saving** follows the intended destination. Modified/new-tab clicks retain the current draft. Refresh and tab-close use native `beforeunload` warnings where supported. No history-stack rewriting or draft persistence is introduced; browser-controlled history traversal is outside the custom link guard. Successful submission disables warnings; Next reviewer starts clean. Backend submission, approval and internal rating behavior remain unchanged.

Navigation validation: the full 152-test frontend suite passed, followed by three additional origin/filter context cases (155 unique tests verified). Thirty-three mocked-API production browser checks passed at 320, 375 and 1440px, including custom dialog focus/retention, safe contextual exits, expired links, success, native refresh warning/confirmed reload and existing multi-match/card/theme flows. TypeScript and the production build passed; targeted ESLint reported zero errors and three existing unused-parameter warnings. No backend or database changes were made.
