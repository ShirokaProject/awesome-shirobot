import { test } from "node:test";
import assert from "node:assert/strict";
import { marketCompatibility } from "../market-compatibility.mjs";

test("ABI and framework are generated from release metadata without manual declarations", () => {
  const contract = { status: "verified", api: { minimum: "99.0", testedThrough: "99.0" },
    abi: { "ShiroBot.SDK": "1.2.0.0", "ShiroBot.Model.QQ": "1.0.0.0" },
    frameworks: [".NETCoreApp,Version=v10.0"],
    assemblies: [{ name: "Plugin", minimumApi: "99.0", testedApi: "99.0", framework: ".NETCoreApp,Version=v10.0" }] };
  const result = JSON.parse(JSON.stringify(marketCompatibility(contract)));
  assert.equal(result.shirobot, "unknown");
  assert.equal(result.framework, "net10.0");
  assert.equal(result.status, "verified");
  assert.deepEqual(result.abi, contract.abi);
  assert.equal("api" in result, false);
  assert.equal("minimumApi" in result.assemblies[0], false);
  assert.equal("testedApi" in result.assemblies[0], false);
  assert.equal(contract.api.minimum, "99.0");
});

test("missing or multiple frameworks do not produce invented requirements", () => {
  for (const contract of [undefined, { status: "unknown", abi: {} }, { frameworks: ["net8.0", "net10.0"] }]) {
    const result = marketCompatibility(contract);
    assert.equal(result.shirobot, "unknown");
    assert.equal(result.framework, "unknown");
    assert.equal(result.status, "unknown");
  }
});
