import { version as installedVersion } from "../../../package.json";
import { https } from "../lib/cep/node";

export const UPDATE_REPOSITORY = "iboyshanto/SoundDesigner";
export const INSTALLED_VERSION = installedVersion;

const API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
const RELEASES_URL = `https://github.com/${UPDATE_REPOSITORY}/releases`;
const CACHE_KEY = "sounddesigner.update-cache.v1";
const DISMISSED_KEY = "sounddesigner.dismissed-update.v1";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "error" | "unsupported";

export type UpdateState = {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  assetName?: string;
  checkedAt?: number;
  message?: string;
};

type ReleaseAsset = {
  name?: unknown;
  state?: unknown;
  browser_download_url?: unknown;
};

type GithubRelease = {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
};

type UpdateCache = {
  checkedAt: number;
  etag?: string;
  state: UpdateState;
};

const readCache = (): UpdateCache | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as UpdateCache | null;
    if (!parsed || typeof parsed.checkedAt !== "number" || !parsed.state) return null;
    if (parsed.state.status !== "current" && parsed.state.status !== "available") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
};

const writeCache = (cache: UpdateCache) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (_error) {
    // Update checks remain functional if host policy blocks persistent storage.
  }
};

const numericVersion = (value: string): number[] | null => {
  const match = String(value || "").match(/(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:[^0-9]|$)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

export const compareVersions = (first: string, second: string): number => {
  const left = numericVersion(first);
  const right = numericVersion(second);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
};

const trustedGithubUrl = (value: unknown, area: "release" | "download"): string => {
  if (typeof value !== "string") return "";
  const normalized = value.toLowerCase();
  const base = `https://github.com/${UPDATE_REPOSITORY.toLowerCase()}/releases/`;
  if (normalized.indexOf(base) !== 0) return "";
  if (area === "download" && normalized.indexOf(`${base}download/`) !== 0) return "";
  return value;
};

const assetScore = (asset: ReleaseAsset): number => {
  if (typeof asset.name !== "string" || asset.state !== "uploaded") return -1;
  if (!trustedGithubUrl(asset.browser_download_url, "download")) return -1;
  const name = asset.name.toLowerCase();
  if (name.indexOf("sounddesigner") === -1) return -1;
  const isWindows = typeof navigator !== "undefined" && navigator.platform.toLowerCase().indexOf("win") === 0;
  const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().indexOf("mac") === 0;
  let score = 0;
  if (/\.zxp$/.test(name)) score += 80;
  else if (/\.zip$/.test(name)) score += 60;
  else if (isWindows && /\.(exe|msi)$/.test(name)) score += 50;
  else if (isMac && /\.(pkg|dmg)$/.test(name)) score += 50;
  else return -1;
  if (isWindows && /(?:win|windows)/.test(name)) score += 20;
  if (isMac && /(?:mac|macos)/.test(name)) score += 20;
  if (/universal/.test(name)) score += 10;
  return score;
};

const selectAsset = (assets: unknown): ReleaseAsset | null => {
  if (!Array.isArray(assets)) return null;
  let selected: ReleaseAsset | null = null;
  let selectedScore = -1;
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index] as ReleaseAsset;
    const score = assetScore(asset);
    if (score > selectedScore) {
      selected = asset;
      selectedScore = score;
    }
  }
  return selected;
};

const requestLatestRelease = (etag?: string): Promise<{ statusCode: number; body: string; etag?: string }> =>
  new Promise((resolve, reject) => {
    if (!https || typeof https.get !== "function") {
      reject(new Error("The CEP HTTPS bridge is unavailable."));
      return;
    }
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const headers: { [name: string]: string } = {
      Accept: "application/vnd.github+json",
      "User-Agent": `SoundDesigner/${INSTALLED_VERSION}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (etag) headers["If-None-Match"] = etag;
    const request = https.get(API_URL, { headers }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      const responseEtag = typeof response.headers.etag === "string" ? response.headers.etag : undefined;
      if (statusCode === 304) {
        response.resume();
        if (!settled) {
          settled = true;
          resolve({ statusCode, body: "", etag: responseEtag || etag });
        }
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_RESPONSE_BYTES) {
          request.abort();
          finishError(new Error("GitHub returned an unexpectedly large response."));
        }
      });
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({ statusCode, body, etag: responseEtag });
      });
      response.on("error", finishError);
    });
    request.setTimeout(8000, () => {
      request.abort();
      finishError(new Error("The GitHub update check timed out."));
    });
    request.on("error", finishError);
  });

const stateFromRelease = (release: GithubRelease, checkedAt: number): UpdateState => {
  if (release.draft === true || release.prerelease === true) throw new Error("GitHub did not return a stable release.");
  if (typeof release.tag_name !== "string") throw new Error("The latest GitHub release has no valid version tag.");
  const latest = numericVersion(release.tag_name);
  if (!latest) throw new Error("Use a semantic release tag such as v1.2.3.");
  const latestVersion = latest.join(".");
  const releaseUrl = trustedGithubUrl(release.html_url, "release") || RELEASES_URL;
  const asset = selectAsset(release.assets);
  const available = compareVersions(latestVersion, INSTALLED_VERSION) > 0;
  return {
    status: available ? "available" : "current",
    currentVersion: INSTALLED_VERSION,
    latestVersion,
    releaseName: typeof release.name === "string" && release.name.trim() ? release.name : `SoundDesigner v${latestVersion}`,
    releaseUrl,
    downloadUrl: asset ? trustedGithubUrl(asset.browser_download_url, "download") : releaseUrl,
    assetName: asset && typeof asset.name === "string" ? asset.name : undefined,
    checkedAt,
    message: available ? "A stable SoundDesigner update is available." : "SoundDesigner is up to date.",
  };
};

export const checkForUpdates = async (force = false): Promise<UpdateState> => {
  if (!window.cep) return { status: "unsupported", currentVersion: INSTALLED_VERSION, message: "Update checks run inside the Adobe panel." };
  const cache = readCache();
  const now = Date.now();
  if (!force && cache && now - cache.checkedAt < CHECK_INTERVAL_MS) return cache.state;
  try {
    const response = await requestLatestRelease(cache?.etag);
    if (response.statusCode === 304 && cache) {
      const refreshed = { ...cache, checkedAt: now, state: { ...cache.state, checkedAt: now } };
      writeCache(refreshed);
      return refreshed.state;
    }
    if (response.statusCode === 404) throw new Error("No public SoundDesigner release was found yet.");
    if (response.statusCode === 403 || response.statusCode === 429) throw new Error("GitHub temporarily limited update checks. Try again later.");
    if (response.statusCode !== 200) throw new Error(`GitHub update check failed (HTTP ${response.statusCode}).`);
    const state = stateFromRelease(JSON.parse(response.body) as GithubRelease, now);
    writeCache({ checkedAt: now, etag: response.etag, state });
    return state;
  } catch (error) {
    if (cache) return { ...cache.state, message: `${cache.state.message || "Cached update information."} Offline cache is being used.` };
    return {
      status: "error",
      currentVersion: INSTALLED_VERSION,
      checkedAt: now,
      message: error instanceof Error ? error.message : "The update check failed.",
    };
  }
};

export const dismissUpdate = (version: string) => {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch (_error) {
    // Dismissal is session-only if storage is unavailable.
  }
};

export const isUpdateDismissed = (version?: string) => {
  if (!version) return false;
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch (_error) {
    return false;
  }
};
