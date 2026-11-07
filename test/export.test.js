import test from "node:test";
import assert from "node:assert/strict";
import { createJourneyShare, shareFilename } from "../export.js";

const snapshot = { page: { url: "http://localhost:8080/example" }, element: { html: "<button>Open</button>" } };
const steps = [{ snapshot, note: " Open the menu " }, { snapshot, note: " Choose Absences " }];

test("exports a versioned, ordered journey with optional question and per-step notes", () => {
  const share = createJourneyShare(steps, "  Explain this journey  ");
  const roundTrip = JSON.parse(JSON.stringify(share));
  assert.equal(roundTrip.schemaVersion, 2);
  assert.equal(roundTrip.kind, "inspected-journey");
  assert.equal(roundTrip.question, "Explain this journey");
  assert.deepEqual(roundTrip.steps.map((step) => [step.step, step.note]), [[1, "Open the menu"], [2, "Choose Absences"]]);
  assert.deepEqual(roundTrip.steps[0].snapshot, snapshot);
  assert.notEqual(share.steps[0].snapshot, snapshot);
  assert.ok(Number.isFinite(Date.parse(roundTrip.savedAt)));
  assert.match(shareFilename(share, "abcd1234"), /^share-with-pi\/share-[\dT-Z-]+-abcd1234\.json$/);
  assert.equal(createJourneyShare([{ snapshot, note: "" }]).question, "");
});

test("rejects empty journeys, invalid origins, and excessive questions or notes", () => {
  assert.throws(() => createJourneyShare([]), /at least one element/);
  assert.throws(() => createJourneyShare([{ snapshot: null, note: "" }]), /localhost:8080/);
  assert.throws(() => createJourneyShare([{ snapshot: { page: { url: "http://localhost:3030" } }, note: "" }]), /localhost:8080/);
  assert.throws(() => createJourneyShare(steps, "a".repeat(8001)), /8,000/);
  assert.throws(() => createJourneyShare([{ snapshot, note: "a".repeat(8001) }]), /8,000/);
});
