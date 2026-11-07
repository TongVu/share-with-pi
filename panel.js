import { allowedOrigins } from "./config.js";
import { selectionExpression } from "./capture.js";
import { createJourneyShare, shareFilename } from "./export.js";

const preview = document.querySelector("#preview");
const question = document.querySelector("#question");
const stepNote = document.querySelector("#step-note");
const stepList = document.querySelector("#steps");
const status = document.querySelector("#status");
const recordingState = document.querySelector("#recording-state");
const toggleButton = document.querySelector("#toggle-recording");
const clearButton = document.querySelector("#clear");
const removeButton = document.querySelector("#remove");
const refreshButton = document.querySelector("#refresh");
const saveButton = document.querySelector("#save");
document.querySelector("#allowed-origins").textContent = allowedOrigins.join(", ") || "(none)";
let steps = [];
let selectedId = null;
let recording = true;
let epoch = 0;
let requestId = 0;
let pending = 0;
let saving = false;

function showStatus(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function selectedStep() {
  return steps.find((step) => step.id === selectedId);
}

function selectionKey(snapshot) {
  return JSON.stringify([snapshot.page.url, snapshot.element.selectorScope,
    snapshot.element.shadowHosts, snapshot.element.selector]);
}

function render() {
  recordingState.textContent = `${recording ? "● Recording" : "Paused"} — ${steps.length} step${steps.length === 1 ? "" : "s"}${pending ? " (capturing…)" : ""}`;
  toggleButton.textContent = recording ? "Pause recording" : "Resume recording";
  toggleButton.setAttribute("aria-pressed", String(recording));
  refreshButton.disabled = !recording;
  clearButton.disabled = steps.length === 0 && pending === 0;
  saveButton.disabled = saving || pending > 0 || steps.length === 0;
  stepList.replaceChildren();
  steps.forEach((step, index) => {
    const option = document.createElement("option");
    option.value = String(step.id);
    option.textContent = `${index + 1}. ${step.snapshot.element.tagName} — ${step.snapshot.page.title} — ${step.snapshot.element.selector}`;
    option.selected = step.id === selectedId;
    stepList.append(option);
  });
  const step = selectedStep();
  stepNote.disabled = !step;
  removeButton.disabled = !step;
  stepNote.value = step?.note || "";
  preview.textContent = step ? JSON.stringify(step.snapshot, null, 2) : "";
}

function mergeConsecutiveSteps() {
  if (pending > 0) return;
  const merged = [];
  for (const step of steps) {
    const previous = merged.at(-1);
    if (previous && selectionKey(previous.snapshot) === selectionKey(step.snapshot)) {
      previous.snapshot = step.snapshot;
      previous.note ||= step.note;
      if (selectedId === step.id) selectedId = previous.id;
    } else {
      merged.push(step);
    }
  }
  steps = merged;
}

function captureCurrent() {
  if (!recording) return;
  const generation = epoch;
  const request = ++requestId;
  pending++;
  render();
  chrome.devtools.inspectedWindow.eval(selectionExpression(), (snapshot, exception) => {
    if (generation !== epoch) return;
    pending--;
    if (exception || !snapshot) {
      mergeConsecutiveSteps();
      showStatus(exception?.description || exception?.value || "Select an element in the Elements tab first.", true);
      render();
      return;
    }
    steps.push({ id: request, note: "", snapshot });
    steps.sort((a, b) => a.id - b.id);
    // Wait for outstanding captures before merging, so a late intermediate
    // selection cannot turn an A → B → A journey into just A → B.
    mergeConsecutiveSteps();
    if (request === requestId || selectedId === null) {
      selectedId = steps.findLast((step) => selectionKey(step.snapshot) === selectionKey(snapshot)).id;
    }
    showStatus("Element collected. Inspect the next element, or review and save the journey.");
    render();
  });
}

toggleButton.addEventListener("click", () => {
  recording = !recording;
  epoch++;
  pending = 0;
  render();
  showStatus(recording ? "Recording resumed, including while this panel is hidden." : "Paused. Existing steps and notes are kept.");
  if (recording) captureCurrent();
});

clearButton.addEventListener("click", () => {
  epoch++;
  pending = 0;
  steps = [];
  selectedId = null;
  question.value = "";
  showStatus("Journey cleared. Inspect another element to start a new journey.");
  render();
});

removeButton.addEventListener("click", () => {
  const index = steps.findIndex((step) => step.id === selectedId);
  if (index < 0) return;
  steps.splice(index, 1);
  selectedId = steps[Math.min(index, steps.length - 1)]?.id ?? null;
  showStatus("Step removed.");
  render();
});

stepList.addEventListener("change", () => {
  selectedId = Number(stepList.value);
  render();
});

stepNote.addEventListener("input", () => {
  const step = selectedStep();
  if (step) step.note = stepNote.value;
});

saveButton.addEventListener("click", async () => {
  let url;
  let watch;
  const release = () => {
    if (watch) chrome.downloads.onChanged.removeListener(watch);
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  saving = true;
  render();
  try {
    const share = createJourneyShare(steps, question.value);
    const filename = shareFilename(share, crypto.randomUUID().slice(0, 8));
    url = URL.createObjectURL(new Blob([JSON.stringify(share, null, 2) + "\n"], { type: "application/json" }));
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });
    showStatus(`Saving ${filename}…`);
    watch = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        showStatus(`Saved ${share.steps.length} step${share.steps.length === 1 ? "" : "s"} in ${filename}. Tell Pi: Read my latest share in ~/Downloads/share-with-pi/`);
        release();
      } else if (delta.state?.current === "interrupted") {
        showStatus("Download interrupted. Check Chrome Downloads and try again.", true);
        release();
      }
    };
    chrome.downloads.onChanged.addListener(watch);
    // A tiny download can finish before the listener is attached.
    const [download] = await chrome.downloads.search({ id: downloadId });
    if (download?.state === "complete" || download?.state === "interrupted") {
      watch({ id: downloadId, state: { current: download.state } });
    }
  } catch (error) {
    release();
    showStatus(error.message || String(error), true);
  } finally {
    saving = false;
    render();
  }
});

refreshButton.addEventListener("click", captureCurrent);
chrome.devtools.panels.elements.onSelectionChanged.addListener(captureCurrent);
render();
captureCurrent();
