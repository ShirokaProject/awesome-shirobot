#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(rootDir, "list.json");
const schemaPath = resolve(rootDir, "schema/list.v1.schema.json");
const outputPath = resolve(rootDir, "dist/marketplace.v1.json");
const checksumPath = `${outputPath}.sha256`;
const maxAssetBytes = 100 * 1024 * 1024;
const validateOnly = process.argv.includes("--validate-only");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--validate-only");

try {
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  }

  const source = await readJson(sourcePath, "source list");
  const schema = await readJson(schemaPath, "JSON Schema");

  if (schema.$id !== "https://raw.githubusercontent.com/ShirokaProject/awesome-shirobot/main/schema/list.v1.schema.json") {
    throw new Error("schema/list.v1.schema.json has an unexpected or missing $id");
  }

  const validatedPlugins = validateSource(source);
  const resolutionResults = await settleWithConcurrency(
    validatedPlugins,
    4,
    ({ plugin, repository, assetMatcher }) => resolvePlugin(plugin, repository, assetMatcher),
  );

  const failures = resolutionResults
    .map((result, index) => ({ result, plugin: validatedPlugins[index].plugin }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, plugin }) => `- ${plugin.id}: ${formatError(result.reason)}`);

  if (failures.length > 0) {
    throw new Error(`GitHub release validation failed:\n${failures.join("\n")}`);
  }

  const plugins = resolutionResults
    .map((result) => result.value)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  for (const plugin of plugins) {
    if (plugin.health.status !== "available") {
      console.warn(`Warning: ${plugin.id}: ${plugin.health.message}`);
    }
  }

  if (validateOnly) {
    console.log(`Validated list.json, repository URLs, and GitHub releases for ${plugins.length} plugins.`);
  } else {
    await writeMarketplace(plugins);
  }
} catch (error) {
  console.error(`Marketplace build failed: ${formatError(error)}`);
  process.exitCode = 1;
}

function validateSource(value) {
  const errors = [];

  if (!checkObject(value, "list.json", ["$schema", "schemaVersion", "plugins"], ["$schema", "schemaVersion", "plugins"], errors)) {
    throwValidationErrors(errors);
  }

  if (value.$schema !== "./schema/list.v1.schema.json") {
    errors.push('list.json.$schema must be "./schema/list.v1.schema.json"');
  }
  if (value.schemaVersion !== 1) {
    errors.push("list.json.schemaVersion must be 1");
  }
  if (!Array.isArray(value.plugins) || value.plugins.length === 0) {
    errors.push("list.json.plugins must be a non-empty array");
    throwValidationErrors(errors);
  }
  if (value.plugins.length > 200) {
    errors.push("list.json.plugins must contain at most 200 entries");
  }

  const ids = new Set();
  const repositories = new Set();
  const validated = [];

  for (const [index, plugin] of value.plugins.entries()) {
    const path = `list.json.plugins[${index}]`;
    const requiredKeys = [
      "id",
      "kind",
      "name",
      "description",
      "category",
      "authors",
      "repository",
      "license",
      "compatibility",
      "release",
      "deprecated",
    ];
    const allowedKeys = [...requiredKeys, "deprecationReason"];

    if (!checkObject(plugin, path, requiredKeys, allowedKeys, errors)) {
      continue;
    }

    checkString(plugin.id, `${path}.id`, errors, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 100 });
    if (plugin.kind !== "plugin") {
      errors.push(`${path}.kind must be "plugin"; adapters are not part of this marketplace list`);
    }
    checkString(plugin.name, `${path}.name`, errors, { maxLength: 100 });
    checkString(plugin.description, `${path}.description`, errors, { maxLength: 500 });
    checkString(plugin.category, `${path}.category`, errors, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 100 });
    checkAuthors(plugin.authors, `${path}.authors`, errors);
    checkString(plugin.license, `${path}.license`, errors, { maxLength: 200 });
    checkCompatibility(plugin.compatibility, `${path}.compatibility`, errors);
    const assetMatcher = checkRelease(plugin.release, `${path}.release`, errors);

    if (typeof plugin.deprecated !== "boolean") {
      errors.push(`${path}.deprecated must be a boolean`);
    }
    if (plugin.deprecated === true) {
      checkString(plugin.deprecationReason, `${path}.deprecationReason`, errors, { maxLength: 500 });
    } else if (plugin.deprecationReason !== undefined) {
      checkString(plugin.deprecationReason, `${path}.deprecationReason`, errors, { maxLength: 500 });
    }

    let repository;
    try {
      repository = parseRepository(plugin.repository);
    } catch (error) {
      errors.push(`${path}.repository ${formatError(error)}`);
    }

    if (typeof plugin.id === "string") {
      const canonicalId = plugin.id.toLowerCase();
      if (ids.has(canonicalId)) {
        errors.push(`${path}.id duplicates another plugin ID: ${plugin.id}`);
      }
      ids.add(canonicalId);
    }

    if (repository) {
      if (repositories.has(repository.canonical)) {
        errors.push(`${path}.repository duplicates another repository: ${plugin.repository}`);
      }
      repositories.add(repository.canonical);
    }

    if (repository && assetMatcher) {
      validated.push({ plugin, repository, assetMatcher });
    }
  }

  throwValidationErrors(errors);
  return validated;
}

async function settleWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function checkAuthors(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }

  const names = new Set();
  for (const [index, author] of value.entries()) {
    const authorPath = `${path}[${index}]`;
    if (!checkObject(author, authorPath, ["name"], ["name", "url"], errors)) {
      continue;
    }
    checkString(author.name, `${authorPath}.name`, errors, { maxLength: 100 });
    if (typeof author.name === "string") {
      const canonicalName = author.name.toLowerCase();
      if (names.has(canonicalName)) {
        errors.push(`${authorPath}.name duplicates another author: ${author.name}`);
      }
      names.add(canonicalName);
    }
    if (author.url !== undefined) {
      checkHttpsUrl(author.url, `${authorPath}.url`, errors);
    }
  }
}

function checkCompatibility(value, path, errors) {
  if (!checkObject(value, path, ["shirobot", "framework"], ["shirobot", "framework", "platforms"], errors)) {
    return;
  }

  checkString(value.shirobot, `${path}.shirobot`, errors, { maxLength: 100 });
  checkString(value.framework, `${path}.framework`, errors, { pattern: /^net[0-9]+(?:\.[0-9]+)?$/, maxLength: 30 });

  if (value.platforms !== undefined) {
    if (!Array.isArray(value.platforms) || value.platforms.length === 0) {
      errors.push(`${path}.platforms must be a non-empty array when present`);
      return;
    }
    const platforms = new Set();
    for (const [index, platform] of value.platforms.entries()) {
      checkString(platform, `${path}.platforms[${index}]`, errors, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxLength: 50 });
      if (typeof platform === "string") {
        if (platforms.has(platform)) {
          errors.push(`${path}.platforms[${index}] duplicates another platform: ${platform}`);
        }
        platforms.add(platform);
      }
    }
  }
}

function checkRelease(value, path, errors) {
  if (!checkObject(value, path, ["required", "assetPattern"], ["required", "assetPattern"], errors)) {
    return undefined;
  }

  if (typeof value.required !== "boolean") {
    errors.push(`${path}.required must be a boolean`);
  }
  checkString(value.assetPattern, `${path}.assetPattern`, errors, { maxLength: 200 });

  if (typeof value.assetPattern !== "string") {
    return undefined;
  }
  if (value.assetPattern.includes("/") || value.assetPattern.includes("\\")) {
    errors.push(`${path}.assetPattern must match a file name, not a path`);
    return undefined;
  }
  if (!value.assetPattern.includes(".")) {
    errors.push(`${path}.assetPattern must include a file extension`);
    return undefined;
  }
  if (/[^\x20-\x7e]/.test(value.assetPattern)) {
    errors.push(`${path}.assetPattern must contain printable ASCII only`);
    return undefined;
  }

  return globMatcher(value.assetPattern);
}

function checkObject(value, path, requiredKeys, allowedKeys, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${path}.${key} is not allowed`);
    }
  }
  return true;
}

function checkString(value, path, errors, { pattern, maxLength } = {}) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return;
  }
  if (value !== value.trim()) {
    errors.push(`${path} must not have leading or trailing whitespace`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    errors.push(`${path} must not exceed ${maxLength} characters`);
  }
  if (pattern && !pattern.test(value)) {
    errors.push(`${path} has an invalid format`);
  }
}

function checkHttpsUrl(value, path, errors) {
  checkString(value, path, errors, { maxLength: 500 });
  if (typeof value !== "string") {
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      errors.push(`${path} must be an HTTPS URL without credentials`);
    }
  } catch {
    errors.push(`${path} must be a valid URL`);
  }
}

function parseRepository(value) {
  if (typeof value !== "string") {
    throw new Error("must be a string");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("must be a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("must use HTTPS");
  }
  if (url.hostname !== "github.com") {
    throw new Error("must use github.com");
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error("must not contain credentials, a port, query parameters, or a fragment");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || url.pathname !== `/${parts[0]}/${parts[1]}`) {
    throw new Error("must have the canonical form https://github.com/OWNER/REPOSITORY");
  }

  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new Error("has an invalid GitHub owner");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(repo) || repo.endsWith(".git")) {
    throw new Error("has an invalid GitHub repository name");
  }

  return {
    owner,
    repo,
    canonical: `${owner}/${repo}`.toLowerCase(),
  };
}

function globMatcher(pattern) {
  const escaped = pattern.replace(/[|\\{}()[\]^$+.-]/g, "\\$&");
  const expression = escaped.replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${expression}$`);
}

async function resolvePlugin(plugin, repository, assetMatcher) {
  const releases = await fetchReleases(repository);
  const release = releases
    .filter((candidate) => candidate?.draft === false && candidate?.prerelease === false)
    .sort((left, right) => releaseTimestamp(right) - releaseTimestamp(left))[0];

  if (!release) {
    return unavailable(plugin, "no-release", "No non-draft GitHub release was found.");
  }

  const releaseTag = requireString(release.tag_name, "release tag_name");
  const version = releaseTag.replace(/^v(?=\d)/i, "");
  const publishedAt = requireDate(release.published_at ?? release.created_at, "release published_at");
  const pageUrl = requireGithubReleaseUrl(release.html_url, repository, "release html_url");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const matchingAssets = assets.filter((asset) =>
    asset?.state === "uploaded" && typeof asset.name === "string" && assetMatcher.test(asset.name),
  );
  const releaseBase = {
    required: plugin.release.required,
    assetPattern: plugin.release.assetPattern,
    version,
    prerelease: release.prerelease === true,
    publishedAt,
    pageUrl,
    downloadCount: null,
    asset: null,
  };

  if (matchingAssets.length === 0) {
    return unavailable(
      plugin,
      "asset-missing",
      `Latest release ${version} has no uploaded asset matching ${JSON.stringify(plugin.release.assetPattern)}.`,
      releaseBase,
    );
  }
  if (matchingAssets.length > 1) {
    return unavailable(
      plugin,
      "asset-ambiguous",
      `Latest release ${version} has ${matchingAssets.length} uploaded assets matching ${JSON.stringify(plugin.release.assetPattern)}.`,
      releaseBase,
    );
  }

  const asset = matchingAssets[0];
  const size = requireNonNegativeInteger(asset.size, "release asset size");
  const downloadCount = requireNonNegativeInteger(asset.download_count, "release asset download_count");
  const assetUrl = requireGithubReleaseUrl(asset.browser_download_url, repository, "release asset browser_download_url");
  const digest = await resolveAssetDigest(asset, assetUrl, size);

  return marketPlugin(plugin, {
    ...releaseBase,
    downloadCount,
    asset: {
      name: requireString(asset.name, "release asset name"),
      url: assetUrl,
      size,
      digest,
    },
  }, "available", "Latest release asset is available.");
}

async function resolveAssetDigest(asset, assetUrl, expectedSize) {
  if (expectedSize > maxAssetBytes) {
    throw new Error(`Release asset exceeds the ${maxAssetBytes} byte marketplace limit`);
  }
  if (typeof asset.digest === "string" && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
    return asset.digest.toLowerCase();
  }

  let response;
  try {
    response = await fetch(assetUrl, {
      headers: { "User-Agent": "awesome-shirobot-market-builder/1" },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(`Release asset download failed for digest verification: ${formatError(error)}`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`Release asset download returned HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxAssetBytes) {
    throw new Error(`Release asset Content-Length exceeds ${maxAssetBytes} bytes`);
  }

  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > maxAssetBytes) {
      throw new Error(`Release asset download exceeds ${maxAssetBytes} bytes`);
    }
    hash.update(chunk);
  }
  if (received !== expectedSize) {
    throw new Error(`Release asset size changed during verification: expected ${expectedSize}, received ${received}`);
  }
  return `sha256:${hash.digest("hex")}`;
}

function unavailable(plugin, status, message, release = undefined) {
  if (plugin.release.required) {
    throw new Error(message);
  }

  const emptyRelease = {
    required: plugin.release.required,
    assetPattern: plugin.release.assetPattern,
    version: null,
    prerelease: false,
    publishedAt: null,
    pageUrl: null,
    downloadCount: null,
    asset: null,
  };
  return marketPlugin(plugin, release ?? emptyRelease, status, message);
}

function marketPlugin(plugin, release, status, message) {
  const { release: ignoredReleasePolicy, ...metadata } = plugin;
  return {
    ...metadata,
    release,
    health: {
      status,
      message,
    },
  };
}

async function fetchReleases({ owner, repo }) {
  const releases = [];
  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100&page=${page}`;
    const batch = await githubJson(url);
    if (!Array.isArray(batch)) {
      throw new Error("GitHub releases API returned a non-array response");
    }
    releases.push(...batch);
    if (batch.length < 100) {
      return releases;
    }
  }
  throw new Error("GitHub repository has more than 1,000 releases; refusing an incomplete result");
}

async function githubJson(url) {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "awesome-shirobot-market-builder/1",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`GitHub API request failed for ${url}: ${formatError(error)}`);
  }

  const body = await response.text();
  if (!response.ok) {
    let detail = body.slice(0, 500);
    try {
      detail = JSON.parse(body).message ?? detail;
    } catch {
      // Keep the response text when GitHub did not return JSON.
    }
    const rateLimit = response.headers.get("x-ratelimit-remaining");
    const rateSuffix = rateLimit === null ? "" : `; rate limit remaining: ${rateLimit}`;
    throw new Error(`GitHub API returned HTTP ${response.status} for ${url}: ${detail}${rateSuffix}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${url}`);
  }
}

function releaseTimestamp(release) {
  const value = Date.parse(release?.published_at ?? release?.created_at ?? "");
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function requireDate(value, label) {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} is not a valid date`);
  }
  return new Date(timestamp).toISOString();
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} is missing or invalid`);
  }
  return value;
}

function requireGithubReleaseUrl(value, repository, label) {
  const text = requireString(value, label);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }

  const expectedPrefix = `/${repository.owner}/${repository.repo}/releases/`.toLowerCase();
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || !url.pathname.toLowerCase().startsWith(expectedPrefix)
  ) {
    throw new Error(`${label} is not a safe GitHub release URL for ${repository.owner}/${repository.repo}`);
  }
  return url.href;
}

async function writeMarketplace(plugins) {
  const stableDocument = {
    schemaVersion: 1,
    source: "https://github.com/ShirokaProject/awesome-shirobot/blob/main/list.json",
    plugins,
  };
  const previous = await readOptionalJson(outputPath);
  const previousStable = previous && typeof previous === "object"
    ? {
        schemaVersion: previous.schemaVersion,
        source: previous.source,
        plugins: previous.plugins,
      }
    : undefined;
  const previousDateIsValid = typeof previous?.generatedAt === "string"
    && !Number.isNaN(Date.parse(previous.generatedAt));
  const generatedAt = previousDateIsValid && isDeepStrictEqual(previousStable, stableDocument)
    ? previous.generatedAt
    : new Date().toISOString();
  const document = {
    schemaVersion: stableDocument.schemaVersion,
    generatedAt,
    source: stableDocument.source,
    plugins: stableDocument.plugins,
  };
  const output = `${JSON.stringify(document, null, 2)}\n`;
  const checksum = createHash("sha256").update(output).digest("hex");
  const checksumFile = `${checksum}  marketplace.v1.json\n`;

  await mkdir(dirname(outputPath), { recursive: true });
  const outputChanged = await writeIfChanged(outputPath, output);
  const checksumChanged = await writeIfChanged(checksumPath, checksumFile);
  console.log(
    outputChanged || checksumChanged
      ? `Wrote dist/marketplace.v1.json for ${plugins.length} plugins.`
      : `Marketplace is unchanged for ${plugins.length} plugins.`,
  );
}

async function writeIfChanged(path, contents) {
  try {
    if (await readFile(path, "utf8") === contents) {
      return false;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, "utf8");
  await rename(temporaryPath, path);
  return true;
}

async function readJson(path, label) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${label} at ${path}: ${formatError(error)}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Could not parse ${label} at ${path}: ${formatError(error)}`);
  }
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function throwValidationErrors(errors) {
  if (errors.length > 0) {
    throw new Error(`list.json validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
