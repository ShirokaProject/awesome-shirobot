import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { repositoryLicense } from "../repository-license.mjs";

test("generated licenses use GitHub's SPDX identifier, ignoring handwritten declarations", () => {
  for (const id of ["MIT", "Apache-2.0", "GPL-3.0", "GPL-3.0-only"]) {
    assert.equal(repositoryLicense({ license: { spdx_id: id, name: "Another name" } }), id);
  }
  assert.equal(repositoryLicense({ license: { name: "MIT", key: "mit" } }), "NOASSERTION");
});

test("missing and unrecognized repository licenses remain unknown without inventing a license", () => {
  for (const data of [undefined, null, {}, { license: null }, { license: {} },
    { license: { spdx_id: "NOASSERTION" } }, { license: { spdx_id: "" } },
    { license: { spdx_id: 42 } }, { license: { spdx_id: "<script>" } }]) {
    assert.equal(repositoryLicense(data), "NOASSERTION");
  }
});

test("marketplace source lists and schemas no longer require manual license fields", async () => {
  const root = new URL("../../", import.meta.url);
  for (const [sourceName, entries, schemaName, definition] of [
    ["list.json", "plugins", "schema/list.v1.schema.json", "plugin"],
    ["adapters.json", "adapters", "schema/adapters.v1.schema.json", "adapter"],
  ]) {
    const source = JSON.parse(await readFile(new URL(sourceName, root), "utf8"));
    const schema = JSON.parse(await readFile(new URL(schemaName, root), "utf8"));
    for (const item of source[entries]) assert.equal("license" in item, false);
    assert.equal(schema.$defs[definition].required.includes("license"), false);
    assert.equal("license" in schema.$defs[definition].properties, false);
  }
});
