import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { captureSelection } from "../capture.js";

const tick = () => new Promise(setImmediate);
let moduleId = 0;
async function waitFor(predicate) {
  for (let i = 0; i < 50 && !predicate(); i++) await tick();
  assert.ok(predicate(), "Expected asynchronous operation to finish");
}

async function harness(t) {
  const html = await readFile(new URL("../panel.html", import.meta.url), "utf8");
  const panel = new JSDOM(html);
  const page = new JSDOM('<button id="avatar">Profile</button><a id="absence">Absences</a><a id="substitutes" role="tab">Substitutes</a>', { url: "http://localhost:8080/app" });
  const snapshots = ["avatar", "absence", "substitutes"].map((id) => captureSelection(page.window.document.getElementById(id)));
  const evaluations = [];
  const changes = new Set();
  const h = { evaluations, changes, snapshots, panel, state: "complete", failDownload: false };
  globalThis.document = panel.window.document;
  t.after(() => {
    delete globalThis.document;
    delete globalThis.chrome;
    panel.window.close();
    page.window.close();
  });
  globalThis.chrome = {
    devtools: {
      inspectedWindow: { eval: (expression, callback) => evaluations.push({ expression, callback }) },
      panels: { elements: { onSelectionChanged: { addListener: (callback) => { h.selectionChanged = callback; } } } },
    },
    downloads: {
      download: async (options) => {
        if (h.failDownload) throw new Error("Downloads are blocked");
        h.requested = options;
        h.downloaded = await (await fetch(options.url)).json();
        return 12;
      },
      search: async () => [{ id: 12, state: h.state }],
      onChanged: {
        addListener: (listener) => changes.add(listener),
        removeListener: (listener) => changes.delete(listener),
      },
    },
  };
  await import(`../panel.js?test=${++moduleId}`);
  h.get = (id) => panel.window.document.getElementById(id);
  h.reply = (index = 0) => evaluations.shift().callback(snapshots[index]);
  h.inspect = (index) => { h.selectionChanged(); h.reply(index); };
  h.input = (id, value) => {
    h.get(id).value = value;
    h.get(id).dispatchEvent(new panel.window.Event("input"));
  };
  return h;
}

test("records avatar → Absences → Substitutes without saving each selection, then exports one journey", async (t) => {
  const h = await harness(t);
  assert.match(h.get("recording-state").textContent, /Recording — 0 steps/);
  assert.equal(h.get("save").disabled, true);
  assert.match(h.evaluations[0].expression, /\$0/);
  h.reply();
  h.input("step-note", "Open avatar menu");
  // Switching away from the panel must not drop the next inspected element.
  Object.defineProperty(h.panel.window.document, "hidden", { value: true, configurable: true });
  h.inspect(1);
  h.input("step-note", "Choose Absences");
  h.inspect(2);
  h.input("step-note", "Choose Substitutes");
  assert.match(h.get("recording-state").textContent, /3 steps/);
  assert.equal(h.get("steps").options.length, 3);
  assert.match(h.get("preview").textContent, /Substitutes/);
  assert.equal(h.get("save").disabled, false); // Overall question is optional.

  const first = h.get("steps").options[0].value;
  h.get("steps").value = first;
  h.get("steps").dispatchEvent(new h.panel.window.Event("change"));
  assert.equal(h.get("step-note").value, "Open avatar menu");
  h.input("step-note", "First open avatar menu");
  h.input("question", "Explain my journey");
  h.get("save").click();
  await waitFor(() => h.get("status").textContent.startsWith("Saved 3 steps"));
  assert.equal(h.downloaded.schemaVersion, 2);
  assert.equal(h.downloaded.question, "Explain my journey");
  assert.deepEqual(h.downloaded.steps.map((step) => step.note), ["First open avatar menu", "Choose Absences", "Choose Substitutes"]);
  assert.deepEqual(h.downloaded.steps.map((step) => step.snapshot.element.selector), h.snapshots.map((s) => s.element.selector));
  assert.equal(h.requested.saveAs, false);
  assert.match(h.requested.filename, /^share-with-pi\/share-.*\.json$/);
  assert.equal(h.changes.size, 0);
  assert.equal(h.get("steps").options.length, 3); // Save does not silently discard work.
});

test("deduplicates consecutive inspections/refreshes, preserves notes, and keeps later revisits", async (t) => {
  const h = await harness(t);
  h.reply();
  h.input("step-note", "Avatar");
  h.get("refresh").click();
  h.reply();
  assert.equal(h.get("steps").options.length, 1);
  assert.equal(h.get("step-note").value, "Avatar");
  h.inspect(1);
  h.inspect(0);
  assert.equal(h.get("steps").options.length, 3);
});

test("pause stops collection, clear cancels pending captures, and individual steps can be removed", async (t) => {
  const h = await harness(t);
  h.reply();
  h.input("step-note", "Keep this note");
  h.selectionChanged();
  const delayed = h.evaluations.shift();
  h.get("toggle-recording").click();
  assert.match(h.get("recording-state").textContent, /Paused — 1 step/);
  assert.equal(h.get("refresh").disabled, true);
  h.selectionChanged();
  assert.equal(h.evaluations.length, 0);
  delayed.callback(h.snapshots[1]);
  assert.equal(h.get("steps").options.length, 1);
  assert.equal(h.get("step-note").value, "Keep this note");

  h.get("toggle-recording").click();
  h.reply(1);
  assert.equal(h.get("steps").options.length, 2);
  h.get("remove").click();
  assert.equal(h.get("steps").options.length, 1);
  assert.equal(h.get("step-note").value, "Keep this note");
  h.selectionChanged();
  h.input("question", "Old journey");
  h.get("clear").click();
  h.reply(2);
  assert.equal(h.get("steps").options.length, 0);
  assert.equal(h.get("question").value, "");
  assert.equal(h.get("preview").textContent, "");
  assert.equal(h.get("save").disabled, true);
  h.inspect(2);
  assert.equal(h.get("steps").options.length, 1);
});

test("preserves inspection order when callbacks arrive late and retains steps after capture errors", async (t) => {
  const h = await harness(t);
  const first = h.evaluations.shift();
  h.selectionChanged();
  h.reply(1);
  assert.equal(h.get("save").disabled, true);
  first.callback(h.snapshots[0]);
  assert.equal(h.get("save").disabled, false);
  assert.ok(h.get("steps").options[0].textContent.endsWith(h.snapshots[0].element.selector));
  assert.ok(h.get("steps").options[1].textContent.endsWith(h.snapshots[1].element.selector));
  assert.match(h.get("preview").textContent, /Absences/);
  h.selectionChanged();
  h.evaluations.shift().callback(undefined, { isException: true, value: "Only localhost:8080 is allowed" });
  assert.match(h.get("status").textContent, /Only localhost/);
  assert.equal(h.get("steps").options.length, 2);
  assert.equal(h.get("save").disabled, false);
});

test("a late intermediate capture preserves A → B → A instead of prematurely merging the A steps", async (t) => {
  const h = await harness(t);
  const first = h.evaluations.shift();
  h.selectionChanged();
  const middle = h.evaluations.shift();
  h.selectionChanged();
  h.reply(0);
  first.callback(h.snapshots[0]);
  middle.callback(h.snapshots[1]);
  assert.equal(h.get("steps").options.length, 3);
  for (const [index, snapshotIndex] of [0, 1, 0].entries()) {
    assert.ok(h.get("steps").options[index].textContent.endsWith(h.snapshots[snapshotIndex].element.selector));
  }
  assert.match(h.get("preview").textContent, /Profile/);
});

test("download failures retain the journey; pending downloads keep their blob alive until complete", async (t) => {
  const h = await harness(t);
  h.reply();
  h.failDownload = true;
  h.get("save").click();
  await waitFor(() => h.get("status").textContent.includes("Downloads are blocked"));
  assert.equal(h.get("save").disabled, false);
  assert.equal(h.get("steps").options.length, 1);

  h.failDownload = false;
  h.state = "interrupted";
  h.get("save").click();
  await waitFor(() => h.get("status").textContent.startsWith("Download interrupted"));
  assert.equal(h.changes.size, 0);
  h.state = "in_progress";
  h.get("save").click();
  await waitFor(() => h.changes.size === 1);
  assert.equal((await (await fetch(h.requested.url)).json()).steps.length, 1);
  for (const listener of h.changes) listener({ id: 12, state: { current: "complete" } });
  assert.match(h.get("status").textContent, /^Saved 1 step in/);
  assert.equal(h.changes.size, 0);
  await assert.rejects(fetch(h.requested.url));
});
