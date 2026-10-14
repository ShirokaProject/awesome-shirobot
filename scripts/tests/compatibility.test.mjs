import { test } from "node:test";
import assert from "node:assert/strict";
import { marketCompatibility } from "../market-compatibility.mjs";

test("v1 compatibility declarations survive verified and failed inspection", () => {
  const declared = { shirobot: ">=1.0.0", framework: "net10.0", platforms: ["qq"] };
  for (const contract of [undefined, { status: "unknown", api: null, abi: {} }, {
    status: "verified", api: { minimum: "0.9.2", testedThrough: "1.0" },
    abi: { "ShiroBot.SDK": "1.2.0.0" }, frameworks: [".NETCoreApp,Version=v10.0"],
  }]) {
    const result = JSON.parse(JSON.stringify(marketCompatibility(declared, contract)));
    // Fields consumed by existing v1 clients stay exactly as declared.
    assert.equal(result.shirobot, declared.shirobot);
    assert.equal(result.framework, declared.framework);
    assert.deepEqual(result.platforms, declared.platforms);
    assert.equal(result.status, contract?.status ?? "unknown");
    if (contract?.api) assert.deepEqual(result.api, contract.api);
    if (contract?.abi) assert.deepEqual(result.abi, contract.abi);
  }
  assert.deepEqual(declared, { shirobot: ">=1.0.0", framework: "net10.0", platforms: ["qq"] });
});
