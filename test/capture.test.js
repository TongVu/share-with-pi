import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { captureSelection, selectionExpression } from "../capture.js";
import { allowedOrigins } from "../config.js";

function page(html, url = "http://localhost:8080/example") {
  return new JSDOM(html, { url, runScripts: "outside-only" });
}

test("identifies the selected Open button among duplicate labels", () => {
  const dom = page('<title>Apps</title><section><h2>First</h2><button>Open</button></section><section><h2>Developer-portal</h2><button>Open</button></section>');
  const selected = dom.window.document.querySelectorAll("button")[1];
  const result = captureSelection(selected);
  assert.equal(dom.window.document.querySelector(result.element.selector), selected);
  assert.equal(result.element.selectorUnique, true);
  assert.match(result.context.html, /Developer-portal/);
  assert.equal(result.page.title, "Apps");
  assert.equal(result.page.url, "http://localhost:8080/example");
  dom.window.close();
});

test("serialized DevTools expression works with $0 and reports no selection", () => {
  const dom = page('<button id="form:open">Open</button>');
  dom.window.$0 = dom.window.document.querySelector("button");
  const result = dom.window.eval(selectionExpression());
  assert.equal(dom.window.document.querySelector(result.element.selector), dom.window.$0);
  delete dom.window.$0;
  assert.throws(() => dom.window.eval(selectionExpression()), /Select an element/);
  dom.window.close();
});

test("refuses other ports, aliases, protocols, and external pages", () => {
  for (const url of ["http://localhost:3030", "http://127.0.0.1:8080", "https://localhost:8080", "https://example.com"]) {
    const dom = page("<button>Open</button>", url);
    assert.throws(() => captureSelection(dom.window.document.querySelector("button")), /only captures/);
    dom.window.close();
  }
});

test("uses config for direct capture and serialized DevTools evaluation on an alternate origin", (t) => {
  const original = [...allowedOrigins];
  t.after(() => allowedOrigins.splice(0, allowedOrigins.length, ...original));
  const alternatives = ["http://localhost:3030", "https://app.example.test:9443"];
  allowedOrigins.push(...alternatives);
  for (const origin of alternatives) {
    const dom = page('<button id="open">Open</button>', `${origin}/example`);
    t.after(() => dom.window.close());
    dom.window.$0 = dom.window.document.querySelector("button");
    assert.equal(captureSelection(dom.window.$0).page.url, `${origin}/example`);
    assert.equal(dom.window.eval(selectionExpression()).page.url, `${origin}/example`);
  }
  const denied = page("<button>Open</button>", "http://localhost:3031");
  t.after(() => denied.window.close());
  denied.window.$0 = denied.window.document.querySelector("button");
  assert.throws(() => captureSelection(denied.window.$0), /configured origins/);
  assert.throws(() => denied.window.eval(selectionExpression()), /configured origins/);
});

test("an empty configured origin list denies direct and serialized capture", (t) => {
  const original = [...allowedOrigins];
  t.after(() => allowedOrigins.splice(0, allowedOrigins.length, ...original));
  allowedOrigins.length = 0;
  const dom = page("<button>Open</button>");
  t.after(() => dom.window.close());
  dom.window.$0 = dom.window.document.querySelector("button");
  assert.throws(() => captureSelection(dom.window.$0), /configured origins: \(none\)/);
  assert.throws(() => dom.window.eval(selectionExpression()), /configured origins: \(none\)/);
});

test("omits form values, editable text, script contents, and common secret attributes", () => {
  const dom = page(`<main><input type="password" value="PASSWORD_LEAK">
    <textarea>TEXTAREA_LEAK</textarea><select><option selected>SELECT_LEAK</option></select>
    <div contenteditable><b>EDITABLE_LEAK</b></div>
    <button data-key="DATA_LEAK" access-token="TOKEN_LEAK" onclick="HANDLER_LEAK">Open</button>
    <script>SCRIPT_LEAK</script><iframe srcdoc="IFRAME_LEAK"></iframe></main>`);
  const result = captureSelection(dom.window.document.querySelector("main"));
  for (const secret of ["PASSWORD", "TEXTAREA", "SELECT", "EDITABLE", "DATA", "TOKEN", "HANDLER", "SCRIPT", "IFRAME"]) {
    assert.doesNotMatch(result.element.html, new RegExp(`${secret}_LEAK`));
  }
  assert.match(result.element.html, /Open/);
  const editableChild = captureSelection(dom.window.document.querySelector("b"));
  assert.doesNotMatch(editableChild.element.html, /EDITABLE_LEAK/);
  dom.window.close();
});

test("bounds large and deeply nested snapshots and reports truncation", () => {
  const dom = page(`<main><p>${"a".repeat(3000)}</p>${"<p>hello</p>".repeat(400)}${"<div>".repeat(20)}deep${"</div>".repeat(20)}</main>`);
  const result = captureSelection(dom.window.document.querySelector("main"));
  assert.ok(result.element.html.length <= 24000);
  assert.ok(result.context.html.length <= 6000);
  assert.equal(result.element.truncated, true);
  dom.window.close();
});

test("records shadow-root selector scope and host path", () => {
  const dom = page('<div id="host"></div>');
  const host = dom.window.document.querySelector("#host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = '<button id="open">Open</button>';
  const selected = shadow.querySelector("button");
  const result = captureSelection(selected);
  assert.equal(result.element.selectorScope, "shadow-root");
  assert.equal(shadow.querySelector(result.element.selector), selected);
  assert.equal(dom.window.document.querySelector(result.element.shadowHosts[0]), host);
  dom.window.close();
});
