import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, readFile, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const limit = 100 * 1024 * 1024;
const inspector = resolve(import.meta.dirname, "ContractInspector/bin/Release/net10.0/ContractInspector.dll");
let build;

export async function inspectAsset(url, size, expectedDigest, name) {
  if (size > limit) throw new Error("Release asset exceeds marketplace size limit");
  const cacheDir = resolve(import.meta.dirname, "../.cache/contracts-v2");
  if (expectedDigest) {
    const cachePath = join(cacheDir, expectedDigest.toLowerCase().slice(7) + ".json");
    try { return { digest: expectedDigest.toLowerCase(), contract: JSON.parse(await readFile(cachePath, "utf8")) }; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // No credentials are inherited by the static metadata parser.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DOTNET_ROOT: process.env.DOTNET_ROOT };
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "awesome-shirobot-market-builder/1" } });
  if (!response.ok || !response.body) throw new Error(`Asset download returned HTTP ${response.status}`);
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > limit) throw new Error("Asset download exceeds size limit");
    chunks.push(chunk);
  }
  if (received !== size) throw new Error("Asset size changed during download");
  const data = Buffer.concat(chunks);
  const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
  if (expectedDigest && digest !== expectedDigest.toLowerCase()) throw new Error("Asset SHA-256 mismatch");
  const cachePath = join(cacheDir, digest.slice(7) + ".json");
  try { return { digest, contract: JSON.parse(await readFile(cachePath, "utf8")) }; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  build ??= exec("dotnet", ["build", resolve(import.meta.dirname, "ContractInspector/ContractInspector.csproj"), "-c", "Release", "--nologo"], { env, timeout: 120_000 });
  await build;
  const dir = await mkdtemp(join(tmpdir(), "shirobot-contract-"));
  let contract;
  let parsed = false;
  try {
    const path = join(dir, name.toLowerCase().endsWith(".zip") ? "asset.zip" : "asset.dll");
    await writeFile(path, data);
    try {
      const { stdout } = await exec("dotnet", [inspector, path], { env, timeout: 30_000, maxBuffer: 1024 * 1024 });
      contract = JSON.parse(stdout);
      parsed = true;
    } catch {
      contract = { status: "unknown", message: "Release metadata could not be safely inspected.", abi: {}, frameworks: [], assemblies: [] };
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  await mkdir(cacheDir, { recursive: true });
  if (!parsed) return { digest, contract };
  const temporary = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(contract));
  await rename(temporary, cachePath);
  return { digest, contract };
}
