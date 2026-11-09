// The owner's approval of a job's publication review, as the review screen will send it (owner-controlled
// publication, Stage 1). Built from the real review on the server side, so a test that publishes goes through
// the real rules: fingerprint, freshness, and one acknowledgement per material disagreement (all of them here,
// for tests about something else; tests/local-stack/owner-publication.test.ts tests the refusals).

export async function approved(id: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { getRecruitmentById } = await import("@/lib/cms/repository");
  const { buildPublicationReview } = await import("@/lib/cms/publication-review");
  const { todayInIndia } = await import("@/lib/cms/attention");
  const record = await getRecruitmentById(id);
  if (!record) return body;
  const review = await buildPublicationReview(record, todayInIndia());
  return {
    ...body,
    ownerApproval: {
      acknowledged: true, reviewHash: review.reviewHash, ...review.freshness,
      conflictsAcknowledged: review.conflicts.map((c) => c.fieldPath),
    },
  };
}
