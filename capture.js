// Keep this function self-contained: DevTools evaluates its source in the page.
export function captureSelection(element) {
  if (!element || element.nodeType !== 1) {
    throw new Error("Select an element in the DevTools Elements tab first.");
  }
  const doc = element.ownerDocument;
  if (doc.location.origin !== "http://localhost:8080") {
    throw new Error("Share with Pi only captures http://localhost:8080 pages.");
  }

  const escape = (value) => doc.defaultView.CSS?.escape
    ? doc.defaultView.CSS.escape(value)
    : Array.from(value, (char) => `\\${char.codePointAt(0).toString(16)} `).join("");

  function selectorFor(node) {
    const root = node.getRootNode();
    const parts = [];
    for (let current = node; current?.nodeType === 1; current = current.parentElement) {
      if (current.id) {
        const id = `#${escape(current.id)}`;
        if (root.querySelectorAll(id).length === 1) {
          parts.unshift(id);
          break;
        }
      }
      const tag = escape(current.localName);
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((child) => child.localName === current.localName)
        : [];
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
    }
    return parts.join(" > ");
  }

  function htmlPreview(source, maxLength) {
    let remainingNodes = 160;
    let truncated = false;
    function copy(node, depth = 0) {
      if (remainingNodes-- <= 0 || depth > 12) {
        truncated = true;
        return null;
      }
      if (node.nodeType === 3) {
        if (node.textContent.length > 1000) truncated = true;
        return doc.createTextNode(node.textContent.slice(0, 1000));
      }
      if (node.nodeType !== 1) return null;
      const tag = node.localName.toLowerCase();
      if (["script", "style", "noscript", "template", "iframe", "object", "embed"].includes(tag)) return null;
      const clone = doc.createElement(tag);
      for (const { name, value } of node.attributes) {
        if (/^(value|checked|selected|srcdoc)$/i.test(name) || /^on|^data-/i.test(name)
          || /password|token|secret|authorization|cookie|nonce/i.test(name)) continue;
        if (value.length > 500) truncated = true;
        clone.setAttribute(name, value.slice(0, 500));
      }
      const editable = node.isContentEditable
        || node.closest('[contenteditable]:not([contenteditable="false"])');
      if (["input", "textarea", "select", "option"].includes(tag) || editable) {
        clone.setAttribute("data-share-with-pi-redacted", "form-or-editable-content");
        return clone;
      }
      for (const child of node.childNodes) {
        if (remainingNodes <= 0) {
          truncated = true;
          break;
        }
        const result = copy(child, depth + 1);
        if (result) clone.append(result);
      }
      return clone;
    }
    const html = copy(source)?.outerHTML || "[element omitted]";
    return { html: html.slice(0, maxLength), truncated: truncated || html.length > maxLength };
  }

  const root = element.getRootNode();
  const selector = selectorFor(element);
  const shadowHosts = [];
  for (let currentRoot = root; currentRoot.host; currentRoot = currentRoot.host.getRootNode()) {
    shadowHosts.unshift(selectorFor(currentRoot.host));
  }
  return {
    capturedAt: new Date().toISOString(),
    page: { url: doc.location.href, title: doc.title, isFrame: doc.defaultView !== doc.defaultView.top },
    element: {
      tagName: element.localName,
      selector,
      selectorScope: root.nodeType === 9 ? "document" : "shadow-root",
      selectorUnique: root.querySelectorAll(selector).length === 1,
      shadowHosts,
      ...htmlPreview(element, 24000),
    },
    context: element.parentElement ? htmlPreview(element.parentElement, 6000) : null,
    privacyNotice: "Form values, editable content, data-* and common secret attributes are omitted. Other text, URLs and attributes may still contain private data. Shadow trees are not included in HTML previews.",
  };
}

export function selectionExpression() {
  return `(${captureSelection.toString()})(typeof $0 === 'undefined' ? null : $0)`;
}
