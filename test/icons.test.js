import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("manifest icons have the declared PNG sizes", async () => {
  const root = new URL("../", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = await readFile(new URL(path, root));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});

test("registers one Elements sidebar using the existing journey interface, not a top-level panel", async () => {
  const registrations = [];
  const pages = [];
  vm.runInNewContext(await readFile(new URL("../devtools.js", import.meta.url), "utf8"), {
    chrome: {
      devtools: {
        panels: {
          create: () => assert.fail("Do not register a separate top-level panel"),
          elements: {
            createSidebarPane: (title, callback) => {
              registrations.push(title);
              callback({ setPage: (page) => pages.push(page) });
            },
          },
        },
      },
    },
  });
  assert.deepEqual(registrations, ["Share with Pi"]);
  assert.deepEqual(pages, ["panel.html"]);
});
