import Link from "next/link";
export const metadata = { title: "Feedback privacy" };
export default function PrivacyPage() {
  const contact = process.env.PRIVACY_CONTACT_EMAIL;
  const email =
    contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null;
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-5 sm:p-10 text-sm leading-7">
      <h1 className="text-3xl">How BVBTips uses feedback</h1>
      <p>
        Notice version: feedback-privacy-v1. Offered in the USA. This notice
        describes current feedback controls; it is not a claim of legal
        compliance.
      </p>
      <h2 className="text-xl">Private analytics and AI coaching</h2>
      <p>
        Feedback includes ratings, optional comments, match associations and
        reviewer identity or guest name. The recipient and registered reviewer
        can access published original feedback; pending assigned reviews remain
        restricted until approval. Submitting a review does not require opting
        in to analytics or AI.
      </p>
      <p>
        Private numerical analytics and private AI coaching are separate
        permissions. The submission form offers an unchecked choice for both;
        you can change them separately later. When AI is permitted and the
        review is published or the assigned reviewer separately permits
        recipient AI before approval, comments may be sent to OpenAI to extract
        volleyball observations. Observations are embedded by OpenAI and stored
        in our PostgreSQL database. AI coaching may send minimized aggregates,
        observation snippets, your questions and limited chat history to OpenAI.
        We omit account emails/usernames, internal user IDs, reviewer rating
        snapshots and match rosters from extraction; free text can still contain
        identifying details. Avoid including them.
      </p>
      <p>
        OpenAI is an external processor. Responses requests use store:false,
        which does not guarantee zero provider retention. OpenAI documents
        default abuse-monitoring retention of up to 30 days, with exceptions and
        account-specific controls. API data is not used for training by default
        unless sharing is opted into; deployment operators must verify their
        actual agreement and settings.{" "}
        <a
          className="underline"
          href="https://developers.openai.com/api/docs/guides/your-data"
          target="_blank"
          rel="noopener noreferrer"
        >
          OpenAI data controls
        </a>
        .
      </p>
      <h2 className="text-xl">Pending reviews and AI insights</h2>
      <p>
        Submitted guest reviews can support private AI coaching with the
        permissions above, but never change internal ratings. Assigned pending
        reviews remain private to the assigned reviewer unless that reviewer
        separately allows recipient AI insights and comment excerpts before
        approval. That choice is optional, recorded with its own notice version,
        and can be withdrawn in Feedback privacy or the approval card. It does
        not approve the review or verify authorship. Historical pending reviews
        are not automatically opted in.
      </p>
      <h2 className="text-xl">Public sharing and other uses</h2>
      <p>
        Public aggregate sharing is a separate opt-in, off by default. The
        public statistics endpoint requires at least 10 reviews and 5 registered
        reviewers; it does not disclose comments or reviewer identities. These
        thresholds reduce identification risk, not eliminate it. A public
        account exposes match history, not private AI feedback. BVBTips does not
        use this feedback permission to authorize advertising, unrelated
        research, model training or additional secondary uses.
      </p>
      <h2 className="text-xl">Your choices, withdrawal and deletion</h2>
      <p>
        Registered reviewers manage each review through{" "}
        <Link className="underline" href="/privacy/feedback">
          Feedback privacy
        </Link>
        , including reviews assigned for approval. Nobody else may grant these
        permissions on their behalf. Unverified guests receive a
        purpose-limited, one-year withdrawal receipt after submitting; save it
        before leaving the device. A receipt can withdraw processing but cannot
        view feedback or grant permission. Guest names do not establish verified
        identity.
      </p>
      <p>
        Recipients can disable their AI coaching in Account. Withdrawal or
        removal excludes the source, removes derived observations/vectors and
        invalidates profiles as applicable. Saved Coach answer content for the
        affected player/sport is cleared to remove stale evidence. User-written
        questions and operational usage records may remain under retention
        rules. Conversations expire 90 days after creation by default; an
        operator must run retention cleanup. Feedback deletion is soft deletion;
        original ratings, audit events and snapshots can remain until an
        authorized retention process removes them. Invalidation cannot recall
        copies already sent to an external provider or downloaded by a user.
      </p>
      <p>
        Historical feedback is not newly opted in by this change. Previously
        excluded feedback remains excluded until its reviewer makes an informed
        choice. Existing ordinary match statistics and internal rating
        calculations are separate functionality.
      </p>
      <h2 className="text-xl">Operator and requests</h2>
      {email ? (
        <p>
          Privacy requests and help with lost guest receipts:{" "}
          <a className="underline" href={`mailto:${email}`}>
            {email}
          </a>
          .
        </p>
      ) : (
        <p>
          Operator privacy contact details are not configured in this
          deployment. The operator must supply a contact and complete state,
          age, retention and rights review before public rollout.
        </p>
      )}
      <p>
        Guest receipts and account controls do not replace applicable access,
        correction or deletion rights. Legal entity, state-law applicability,
        treatment of minors, international processing arrangements and
        production retention require operator review. No Terms of Service have
        been provided by this repository.
      </p>
      <Link className="underline" href="/privacy/feedback">
        Manage feedback privacy
      </Link>
    </main>
  );
}
