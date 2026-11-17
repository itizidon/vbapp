import { createHash } from "node:crypto";
import { z } from "zod";

export const PROMPT_VERSION = "volleyball-observations-v1";
export const TEMPLATE_VERSION = "observation-document-v1";
export const skills = [
  "attack",
  "defense",
  "passing",
  "setting",
  "serving",
] as const;
export const extractionSchema = z
  .object({
    moderation: z.enum(["ALLOW", "ABUSE", "INJECTION", "PII", "UNCERTAIN"]),
    observations: z
      .array(
        z
          .object({
            sourceKey: z.string().min(1).max(100),
            skill: z.enum(skills).nullable(),
            theme: z.string().min(1).max(80),
            sentiment: z.enum(["positive", "neutral", "negative"]),
            evidence: z.string().min(3).max(240),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type Extraction = z.infer<typeof extractionSchema>;
export type Source = { key: string; text: string };
export type Theme = { id: string; name: string; skillSlugs: string[] };
export type ExtractionInput = {
  sources: Source[];
  themes: Theme[];
  skillSlugs: string[];
};
export type ExtractionResult = {
  value: unknown;
  inputTokens: number;
  outputTokens: number;
};
export interface Extractor {
  provider: string;
  modelVersion: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
export interface Embedder {
  provider: string;
  model: string;
  modelVersion: string;
  dimensions: number;
  embed(document: string): Promise<number[]>;
}
export class ProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = true,
  ) {
    super(code);
  }
}
export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Structural validation alone cannot establish provenance or enforce taxonomy membership.
export function validateExtraction(value: unknown, input: ExtractionInput) {
  const parsed = extractionSchema.safeParse(value);
  if (!parsed.success) throw new ProcessingError("INVALID_EXTRACTION");
  const observations: Extraction["observations"] = [];
  const unknownThemes = new Set<string>();
  const fingerprints = new Set<string>();
  for (const row of parsed.data.observations) {
    const source = input.sources.find((s) => s.key === row.sourceKey);
    if (!source || !source.text.includes(row.evidence) || !row.evidence.trim())
      throw new ProcessingError("INVALID_EVIDENCE");
    const theme = input.themes.find((t) => t.id === row.theme);
    if (!theme) {
      if (/^[a-z][a-z0-9_]{0,79}$/.test(row.theme))
        unknownThemes.add(row.theme);
      continue;
    }
    if (row.skill && !input.skillSlugs.includes(row.skill))
      throw new ProcessingError("INVALID_SKILL");
    if (
      theme.skillSlugs.length &&
      (!row.skill || !theme.skillSlugs.includes(row.skill))
    )
      throw new ProcessingError("INVALID_THEME_SKILL");
    const fingerprint = hash(row);
    if (!fingerprints.has(fingerprint)) {
      observations.push(row);
      fingerprints.add(fingerprint);
    }
  }
  return { ...parsed.data, observations, unknownThemes: [...unknownThemes] };
}
export function embeddingDocument(row: {
  skill?: { slug: string } | null;
  theme: { name: string };
  evidence: string;
  sentiment: string;
}) {
  return `Beach volleyball\nSkill: ${row.skill?.slug ?? "general"}\nTheme: ${row.theme.name}\nSentiment: ${row.sentiment}\nEvidence: ${row.evidence}`;
}
export function validateVector(vector: number[], dimensions: number) {
  if (
    vector.length !== dimensions ||
    !vector.every(Number.isFinite) ||
    !vector.some((x) => x !== 0)
  )
    throw new ProcessingError("INVALID_EMBEDDING");
  return vector;
}

// Shared canonical source ordering keeps maintenance and worker hashes identical.
export function feedbackSources(row: {
  overallComment: string | null;
  ratings: { skillId: string; comment: string | null }[];
}): Source[] {
  return [
    ...(row.overallComment?.trim()
      ? [{ key: "overall", text: row.overallComment }]
      : []),
    ...[...row.ratings]
      .sort((a, b) => a.skillId.localeCompare(b.skillId))
      .filter((r) => r.comment?.trim())
      .map((r) => ({ key: `skill:${r.skillId}`, text: r.comment! })),
  ];
}
