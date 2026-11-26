import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const digest = "a".repeat(64);
const kotoRepo = "ShirokaProject/Shirobot.Plugin.KotoSub";
const lagrangeRepo = "ShirokaProject/ShiroBot.LagrangeAdapter";

test("market refresh isolates hidden repositories and restores them when public", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "market-refresh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
  await mkdir(join(dir, "scripts"));
  for (const file of ["build-market.mjs", "inspect-asset.mjs", "market-compatibility.mjs", "repository-license.mjs"]) {
    await cp(join(root, "scripts", file), join(dir, "scripts", file));
  }
  await cp(join(root, "schema"), join(dir, "schema"), { recursive: true });
  for (const [file, collection, id] of [["list.json", "plugins", "kotosub"], ["adapters.json", "adapters", "lagrange"]]) {
    const document = await readJson(join(root, file));
    document[collection] = document[collection].filter((item) => item.id === id);
    assert.equal(document[collection].length, 1);
    await writeFile(join(dir, file), JSON.stringify(document));
  }

  const cache = join(dir, ".cache", "contracts-v2");
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, `${digest}.json`), JSON.stringify({ status: "verified" }));
  await writeFile(join(dir, "mock-github.mjs"), `
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      const [, , owner, repo, endpoint] = url.pathname.split("/");
      const name = owner + "/" + repo;
      const koto = name === ${JSON.stringify(kotoRepo)};
      if (url.hostname !== "api.github.com" || (!koto && name !== ${JSON.stringify(lagrangeRepo)}))
        throw new Error("Unexpected URL: " + input);
      const mode = process.env.TEST_REPOSITORY_MODE;
      if (koto && mode === "missing") return Response.json({ message: "Not Found" }, { status: 404 });
      if (koto && mode === "outage") return Response.json({ message: "Unavailable" }, { status: 503 });
      if (koto && mode === "private") {
        if (endpoint) throw new Error("Private releases must not be fetched");
        return Response.json({ private: true, visibility: "private" });
      }
      if (endpoint !== "releases") return Response.json({ private: false, license: { spdx_id: "MIT" } });
      const tag = koto ? "v2.0.0" : process.env.TEST_LAGRANGE_TAG;
      const page = "https://github.com/" + name + "/releases";
      const asset = koto ? "Shirobot.Plugin.KotoSub.zip" : "ShiroBot.LagrangeAdapter.zip";
      return Response.json([{
        draft: false, prerelease: false, tag_name: tag, published_at: "2025-01-01T00:00:00Z",
        html_url: page + "/tag/" + tag,
        assets: [{ state: "uploaded", name: asset, size: 10, download_count: 1,
          browser_download_url: page + "/download/" + tag + "/" + asset, digest: "sha256:${digest}" }],
      }]);
    };
  `);
  const summary = join(dir, "summary.md");
  const run = (mode, tag, ...args) => exec(process.execPath, [
    "--import", "./mock-github.mjs", "scripts/build-market.mjs", ...args,
  ], { cwd: dir, env: { ...process.env, GITHUB_STEP_SUMMARY: summary, TEST_REPOSITORY_MODE: mode, TEST_LAGRANGE_TAG: tag } });
  const readPlugin = async () => (await readJson(join(dir, "dist/marketplace.v1.json"))).plugins[0];
  const readAdapter = async () => (await readJson(join(dir, "dist/adapters.v1.json"))).adapters[0];

  await run("public", "v0.1.10");
  assert.equal((await readPlugin()).health.status, "available");
  await run("missing", "v0.1.11");
  const hidden = await readPlugin();
  assert.equal(hidden.health.status, "repository-unavailable");
  assert.equal(hidden.release.required, true);
  assert.equal(hidden.release.asset, null);
  assert.equal(hidden.release.pageUrl, null);
  assert.equal((await readAdapter()).release.version, "0.1.11");
  assert.match(await readFile(summary, "utf8"), /plugin\/kotosub.*404/);
  await assert.rejects(run("missing", "v0.1.12", "--validate-only"), /kotosub.*HTTP 404/);
  await assert.rejects(run("outage", "v0.1.12"), /kotosub.*HTTP 503/);
  assert.equal((await readAdapter()).release.version, "0.1.11");
  await run("private", "v0.1.11");
  assert.equal((await readPlugin()).release.asset, null);
  await assert.rejects(run("private", "v0.1.11", "--validate-only"), /kotosub.*not public/);
  await run("public", "v0.1.12");
  assert.equal((await readPlugin()).health.status, "available");
  assert.equal((await readPlugin()).release.version, "2.0.0");
  assert.equal((await readAdapter()).release.version, "0.1.12");
});
