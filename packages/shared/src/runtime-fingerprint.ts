import crypto from "node:crypto";

export type ReplayEquivalence = "identical" | "semantically_equivalent" | "acceptable_variance" | "material_divergence" | "non_reproducible";

export interface RuntimeFingerprintInput {
  provider?: string;
  model?: string;
  modelVersion?: string;
  runtime?: string;
  runtimeVersion?: string;
  hardwareClass?: string;
  operatingSystem?: string;
  architecture?: string;
  seed?: number | string | null;
  sampling?: Record<string, unknown>;
  batchingMode?: string;
  kernelVersion?: string;
  toolVersions?: Record<string, string>;
  environmentDigest?: string;
  repositoryCommit?: string;
  workingTreeDigest?: string;
  inputDigests?: string[];
  policyDigest?: string;
  promptDigest?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeFingerprint extends RuntimeFingerprintInput {
  digest: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function fields(value: RuntimeFingerprint): Record<string, unknown> {
  const { digest: _digest, ...rest } = value;
  return rest;
}

export function createRuntimeFingerprint(input: RuntimeFingerprintInput): RuntimeFingerprint {
  const normalized: RuntimeFingerprintInput = {
    ...structuredClone(input),
    inputDigests: [...new Set(input.inputDigests ?? [])].sort(),
    toolVersions: input.toolVersions ? Object.fromEntries(Object.entries(input.toolVersions).sort(([a], [b]) => a.localeCompare(b))) : undefined,
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(canonicalize(normalized))).digest("hex");
  return { ...normalized, digest };
}

export function compareRuntimeFingerprints(a: RuntimeFingerprint, b: RuntimeFingerprint): { equivalent: boolean; differences: string[] } {
  if (a.digest === b.digest) return { equivalent: true, differences: [] };
  const left = fields(a);
  const right = fields(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const differences = [...keys].filter((key) => JSON.stringify(canonicalize(left[key])) !== JSON.stringify(canonicalize(right[key]))).sort();
  return { equivalent: differences.length === 0, differences };
}

export function classifyReplay({ outputDigestA, outputDigestB, semanticEquivalent = false, acceptableVariance = false, runtimeA, runtimeB }: { outputDigestA?: string | null; outputDigestB?: string | null; semanticEquivalent?: boolean; acceptableVariance?: boolean; runtimeA?: RuntimeFingerprint | null; runtimeB?: RuntimeFingerprint | null; }): { classification: ReplayEquivalence; runtimeDifferences: string[] } {
  const runtimeDifferences = runtimeA && runtimeB ? compareRuntimeFingerprints(runtimeA, runtimeB).differences : [];
  if (outputDigestA && outputDigestB && outputDigestA === outputDigestB) return { classification: "identical", runtimeDifferences };
  if (semanticEquivalent) return { classification: "semantically_equivalent", runtimeDifferences };
  if (acceptableVariance) return { classification: "acceptable_variance", runtimeDifferences };
  if (outputDigestA && outputDigestB) return { classification: "material_divergence", runtimeDifferences };
  return { classification: "non_reproducible", runtimeDifferences };
}
