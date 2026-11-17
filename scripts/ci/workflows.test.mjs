import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDocument } from "yaml";

const folder = new URL("../../.github/workflows/", import.meta.url);

for (const name of readdirSync(folder).filter((file) => /\.ya?ml$/.test(file))) {
  test(`${name} is valid YAML`, () => {
    const document = parseDocument(readFileSync(new URL(name, folder), "utf8"), { prettyErrors: true });
    assert.deepEqual(document.errors.map(String), []);
  });
}
