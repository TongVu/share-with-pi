import { allowedOrigins } from "./config.js";

export function createJourneyShare(steps, question = "") {
  if (!steps.length) throw new Error("Inspect at least one element before saving.");
  const text = (value) => {
    const trimmed = value.trim();
    if (trimmed.length > 8000) throw new Error("Keep questions and step notes under 8,000 characters.");
    return trimmed;
  };
  return {
    schemaVersion: 2,
    source: "share-with-pi",
    kind: "inspected-journey",
    savedAt: new Date().toISOString(),
    question: text(question),
    steps: steps.map(({ snapshot, note }, index) => {
      if (!snapshot || !allowedOrigins.includes(new URL(snapshot.page.url).origin)) {
        throw new Error(`Every step must capture an element from configured origins: ${allowedOrigins.join(", ") || "(none)"}.`);
      }
      return { step: index + 1, note: text(note), snapshot: structuredClone(snapshot) };
    }),
  };
}

export function shareFilename(share, id) {
  const timestamp = share.savedAt.replace(/[:.]/g, "-");
  return `share-with-pi/share-${timestamp}-${id}.json`;
}
