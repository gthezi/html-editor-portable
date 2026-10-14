import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { createElementTarget } from "../app/node_modules/@deckflow/html-editor/public/inlineEdit.js";
import { appendStructuralPatch, appendStylePatch } from "../app/node_modules/@deckflow/html-editor/public/patchQueue.js";
import { patchElementsInHtml } from "../app/node_modules/@deckflow/html-editor/htmlPatch.js";
import { createEditorServer } from "../app/node_modules/@deckflow/html-editor/server.js";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { parseDocument } = require("htmlparser2");
const { selectAll } = require("css-select");
const { textContent, removeElement } = require("domutils");
const { Text } = require("domhandler");
const app = readFileSync(new URL("../app/node_modules/@deckflow/html-editor/public/app.js", import.meta.url), "utf8");

function appFunction(name) {
  const match = app.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `Missing application function ${name}`);
  return match[0];
}

// Only DOM identity and mutations are needed; rendering is not part of these tests.
function fixture(source) {
  const root = parseDocument(source, { decodeEntities: true });
  const wrappers = new WeakMap();
  const isElement = (node) => ["tag", "script", "style"].includes(node?.type);
  const doc = {
    querySelectorAll(selector) { return selectAll(selector, root.children).map(wrap); },
    get body() { return this.querySelectorAll("body")[0]; },
  };
  function wrap(node) {
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);
    const element = {
      node,
      nodeType: 1,
      ownerDocument: doc,
      get tagName() { return node.name.toUpperCase(); },
      get id() { return node.attribs.id || ""; },
      get parentElement() { return isElement(node.parent) ? wrap(node.parent) : null; },
      get children() { return (node.children || []).filter(isElement).map(wrap); },
      get textContent() { return textContent(node); },
      set textContent(value) {
        const text = new Text(value);
        text.parent = node;
        node.children = [text];
      },
      remove() { removeElement(node); },
    };
    wrappers.set(node, element);
    return element;
  }
  const context = vm.createContext({
    state: { elementTargets: new WeakMap() },
    createElementTarget,
    CSS: { escape: (value) => value },
  });
  vm.runInContext(`${appFunction("selectorFor")}\n${appFunction("targetForElement")}`, context);
  return { doc, target: context.targetForElement };
}

const style = { type: "inline-style", property: "color", value: "#112233" };
const serializable = (patches) => patches.map(({ target, operations }) => ({ target, operations }));

function deleteThenEditAncestor(source, parentSelector, childSelector) {
  const { doc, target } = fixture(source);
  const parent = doc.querySelectorAll(parentSelector)[0];
  const child = doc.querySelectorAll(childSelector)[0];
  assert.ok(parent && child);
  target(parent);
  const patches = [];
  appendStructuralPatch(patches, target(child), { type: "delete-element" }, 1);
  child.remove();
  appendStylePatch(patches, target(parent), style);
  const result = patchElementsInHtml(source, serializable(patches));
  assert.equal(result.matched, true, `Failed patch index: ${result.failedIndex}`);
  const saved = fixture(result.html).doc;
  assert.equal(saved.querySelectorAll(childSelector).length, 0);
  assert.match(saved.querySelectorAll(parentSelector)[0].node.attribs.style, /color: #112233/);
}

test("deleting a child refreshes the ancestor fingerprint", () => {
  deleteThenEditAncestor('<html><body><header><h1>Title</h1><p>Summary</p></header></body></html>', "header", "h1");
});

test("repeated-text siblings are deleted by current position, not a cached path", () => {
  const source = '<html><body><div><p data-name="a">Same</p><p data-name="b">Same</p><p data-name="c">Same</p></div></body></html>';
  const { doc, target } = fixture(source);
  const [first, second] = doc.querySelectorAll("p");
  target(second);
  const patches = [];
  appendStructuralPatch(patches, target(first), { type: "delete-element" }, 1);
  first.remove();
  appendStructuralPatch(patches, target(second), { type: "delete-element" }, 2);
  second.remove();
  const result = patchElementsInHtml(source, serializable(patches));
  assert.equal(result.matched, true);
  assert.deepEqual(fixture(result.html).doc.querySelectorAll("p").map((el) => el.node.attribs["data-name"]), ["c"]);
});

test("editing child text then deleting a previously selected ancestor saves atomically", () => {
  const source = '<html><body><div id="panel"><p>Before</p></div><p>Keep</p></body></html>';
  const { doc, target } = fixture(source);
  const parent = doc.querySelectorAll("#panel")[0];
  const child = doc.querySelectorAll("#panel p")[0];
  target(parent);
  const patches = [];
  appendStylePatch(patches, target(child), { type: "text-content", value: "After" });
  child.textContent = "After";
  appendStructuralPatch(patches, target(parent), { type: "delete-element" }, 1);
  const result = patchElementsInHtml(source, serializable(patches));
  assert.equal(result.matched, true);
  assert.equal(fixture(result.html).doc.querySelectorAll("#panel").length, 0);
  assert.equal(fixture(result.html).doc.querySelectorAll("p")[0].textContent, "Keep");
  assert.equal(patches[0].target.originalText, "Before");
});

test("invalid targets still reject the entire batch without changing source", () => {
  const source = '<html><body><p>Keep</p></body></html>';
  const { doc, target } = fixture(source);
  const first = { target: target(doc.querySelectorAll("p")[0]), operations: [style] };
  const invalid = { target: { tagName: "p", originalText: "Missing" }, operations: [{ type: "delete-element" }] };
  const result = patchElementsInHtml(source, [first, invalid]);
  assert.equal(result.matched, false);
  assert.equal(result.html, source);
});

if (process.env.HTML_EDITOR_TEST_FILE) {
  test("the reported research brief supports deletion followed by ancestor editing", () => {
    const source = readFileSync(process.env.HTML_EDITOR_TEST_FILE, "utf8");
    deleteThenEditAncestor(source, "header.hero", "header.hero h1");
  });

  test("the local API serves the fix and accepts a deletion batch without writing the file", async () => {
    const input = process.env.HTML_EDITOR_TEST_FILE;
    const before = readFileSync(input);
    const server = await createEditorServer({ input, port: 0 });
    try {
      const response = await fetch(`${server.url}/__local-editor__/app.js`);
      assert.equal(response.status, 200);
      const servedApp = await response.text();
      assert.ok(servedApp.includes("return createElementTarget(el, selectorFor(el));"));
      assert.ok(!servedApp.includes("state.elementTargets"));
      const source = before.toString("utf8");
      const { doc, target } = fixture(source);
      const parent = doc.querySelectorAll("header.hero")[0];
      const child = doc.querySelectorAll("header.hero h1")[0];
      target(parent);
      const patches = [];
      appendStructuralPatch(patches, target(child), { type: "delete-element" }, 1);
      child.remove();
      appendStylePatch(patches, target(parent), style);
      const saved = await fetch(`${server.url}/api/patch-content`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: source, patches: serializable(patches) }),
      });
      assert.equal(saved.status, 200);
      const payload = await saved.json();
      assert.equal(payload.ok, true);
      assert.equal(payload.matched, true);
      assert.equal(fixture(payload.content).doc.querySelectorAll("header.hero h1").length, 0);
    } finally {
      await server.close();
      assert.deepEqual(readFileSync(input), before, "User file must remain byte-for-byte unchanged");
    }
  });
}
