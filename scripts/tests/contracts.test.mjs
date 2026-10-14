import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { inspectAsset } from "../inspect-asset.mjs";

const exec = promisify(execFile);
const project = resolve(import.meta.dirname, "../ContractInspector/ContractInspector.csproj");
const inspector = resolve(import.meta.dirname, "../ContractInspector/bin/Release/net10.0/ContractInspector.dll");

test("static inspection, download verification and cache", async () => {
  await exec("dotnet", ["build", project, "-c", "Release", "--nologo"]);
  await exec("dotnet", ["build", resolve(import.meta.dirname, "Plugin/Plugin.csproj"), "-c", "Release", "--nologo"]);
  const fixture = resolve(import.meta.dirname, "Plugin/bin/Release/net10.0/Plugin.dll");
  const { stdout } = await exec("dotnet", [inspector, fixture]);
  const result = JSON.parse(stdout);
  assert.equal(result.status, "verified");
  assert.equal("api" in result, false);
  assert.equal(result.abi["ShiroBot.SDK"], "1.2.0.0");
  assert.deepEqual(result.frameworks, [".NETCoreApp,Version=v10.0"]);

  await exec("dotnet", ["build", resolve(import.meta.dirname, "Plugin/Plugin.csproj"), "-c", "Release", "--nologo", "-p:DefineConstants=LEGACY_API"]);
  const legacy = JSON.parse((await exec("dotnet", [inspector, fixture])).stdout);
  assert.equal(legacy.status, "verified", "invalid legacy API declaration must be ignored");
  assert.equal("api" in legacy, false);
  assert.deepEqual(legacy.abi, result.abi);
  const data = await readFile(fixture);
  const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
  const cache = resolve(import.meta.dirname, "../../.cache/contracts-v2", digest.slice(7) + ".json");
  const fetch = globalThis.fetch;
  await rm(cache, { force: true });
  let downloads = 0;
  globalThis.fetch = async () => { downloads++; return new Response(data); };
  try {
    const first = await inspectAsset("https://example.test/Plugin.dll", data.length, digest, "Plugin.dll");
    assert.equal(first.contract.status, "verified");
    const second = await inspectAsset("https://example.test/Plugin.dll", data.length, digest, "Plugin.dll");
    assert.deepEqual(second, first);
    assert.equal(downloads, 1, "cache hit must not download");
    await assert.rejects(inspectAsset("https://example.test/Plugin.dll", data.length, `sha256:${"0".repeat(64)}`, "Plugin.dll"), /SHA-256 mismatch/);
    await assert.rejects(inspectAsset("https://example.test/Plugin.dll", data.length + 1, undefined, "Plugin.dll"), /size changed/);
    await assert.rejects(inspectAsset("https://example.test/Plugin.dll", 101 * 1024 * 1024, undefined, "Plugin.dll"), /size limit/);
  } finally {
    globalThis.fetch = fetch;
    await rm(cache, { force: true });
  }
  const dir = await mkdtemp(join(tmpdir(), "contract-test-"));
  try {
    const broken = join(dir, "broken.zip");
    await writeFile(broken, "not a ZIP");
    await assert.rejects(exec("dotnet", [inspector, broken]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
