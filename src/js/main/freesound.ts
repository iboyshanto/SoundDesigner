import { https } from "../lib/cep/node";
import { makeWaveform } from "./library";
import type { FreesoundLicenseFilter, SoundFile } from "./types";

const API_ORIGIN = "https://freesound.org";
const SEARCH_ENDPOINT = `${API_ORIGIN}/apiv2/search/`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 30;

type FreesoundPreviewMap = {
  "preview-hq-mp3"?: unknown;
  "preview-hq-ogg"?: unknown;
  "preview-lq-mp3"?: unknown;
};

type FreesoundApiSound = {
  id?: unknown;
  name?: unknown;
  tags?: unknown;
  username?: unknown;
  license?: unknown;
  type?: unknown;
  duration?: unknown;
  filesize?: unknown;
  samplerate?: unknown;
  channels?: unknown;
  url?: unknown;
  previews?: FreesoundPreviewMap;
};

type FreesoundSearchResponse = {
  count?: unknown;
  next?: unknown;
  previous?: unknown;
  results?: unknown;
};

export type FreesoundSearchPage = {
  sounds: SoundFile[];
  total: number;
  page: number;
  hasNext: boolean;
};

const trustedFreesoundUrl = (value: unknown) => {
  if (typeof value !== "string" || value.indexOf("https://") !== 0) return "";
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "freesound.org" || parsed.hostname === "www.freesound.org" || parsed.hostname === "cdn.freesound.org") {
      return parsed.toString();
    }
  } catch (_error) {}
  return "";
};

const licenseFilter = (filter: FreesoundLicenseFilter) => {
  if (filter === "cc0") return 'license:"Creative Commons 0"';
  if (filter === "commercial") return 'license:("Creative Commons 0" OR "Attribution")';
  return "";
};

const requestJsonWithNode = (url: string, apiKey: string, signal?: AbortSignal): Promise<unknown> =>
  new Promise((resolve, reject) => {
    if (!https || typeof https.get !== "function") {
      reject(new Error("The CEP HTTPS bridge is unavailable."));
      return;
    }
    let settled = false;
    let abortHandler: (() => void) | null = null;
    const cleanupSignal = () => {
      if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
      abortHandler = null;
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupSignal();
      reject(error);
    };
    const request = https.get(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Token ${apiKey}`,
        "User-Agent": "SoundDesigner CEP",
      },
    }, (response) => {
      const statusCode = Number(response.statusCode || 0);
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > MAX_RESPONSE_BYTES) {
          request.abort();
          finishError(new Error("Freesound returned an unexpectedly large response."));
        }
      });
      response.on("end", () => {
        if (settled) return;
        if (statusCode === 401) return finishError(new Error("The Freesound API key is invalid. Update it in Settings."));
        if (statusCode === 429) return finishError(new Error("Freesound request limit reached. Please try again later."));
        if (statusCode < 200 || statusCode >= 300) return finishError(new Error(`Freesound search failed (HTTP ${statusCode}).`));
        try {
          settled = true;
          cleanupSignal();
          resolve(JSON.parse(body));
        } catch (_error) {
          finishError(new Error("Freesound returned an invalid response."));
        }
      });
      response.on("error", finishError);
    });
    request.setTimeout(10000, () => {
      request.abort();
      finishError(new Error("The Freesound search timed out."));
    });
    request.on("error", finishError);
    if (signal) {
      abortHandler = () => {
        request.abort();
        finishError(new DOMException("The search was cancelled.", "AbortError"));
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }
  });

const requestJson = async (url: string, apiKey: string, signal?: AbortSignal) => {
  if (window.cep) return requestJsonWithNode(url, apiKey, signal);
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Token ${apiKey}` },
    signal,
  });
  if (response.status === 401) throw new Error("The Freesound API key is invalid. Update it in Settings.");
  if (response.status === 429) throw new Error("Freesound request limit reached. Please try again later.");
  if (!response.ok) throw new Error(`Freesound search failed (HTTP ${response.status}).`);
  return response.json();
};

const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const mapSound = (value: FreesoundApiSound): SoundFile | null => {
  const id = typeof value.id === "number" || typeof value.id === "string" ? String(value.id) : "";
  const nameWithExtension = typeof value.name === "string" && value.name.trim() ? value.name.trim() : `Freesound ${id}`;
  const apiType = typeof value.type === "string" ? value.type.toLowerCase().replace(/^\./, "") : "mp3";
  const dot = nameWithExtension.lastIndexOf(".");
  const name = dot > 0 ? nameWithExtension.slice(0, dot) : nameWithExtension;
  const previews = value.previews || {};
  const previewUrl = trustedFreesoundUrl(previews["preview-hq-mp3"])
    || trustedFreesoundUrl(previews["preview-hq-ogg"])
    || trustedFreesoundUrl(previews["preview-lq-mp3"]);
  const sourceUrl = trustedFreesoundUrl(value.url) || (id ? `${API_ORIGIN}/s/${id}/` : "");
  if (!id || !previewUrl || !sourceUrl) return null;
  return {
    id: `freesound-${id}`,
    folderId: "freesound",
    directoryId: "freesound",
    name,
    path: "",
    extension: apiType || "mp3",
    size: asNumber(value.filesize),
    modifiedAt: 0,
    duration: asNumber(value.duration),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 16) : [],
    waveform: makeWaveform(`freesound:${id}:${name}`),
    accent: "graphite",
    source: "freesound",
    sourceId: id,
    sourceUrl,
    previewUrl,
    creator: typeof value.username === "string" ? value.username : "",
    license: typeof value.license === "string" ? value.license : "",
    channels: asNumber(value.channels),
    sampleRate: asNumber(value.samplerate),
    downloadState: "remote",
  };
};

export const searchFreesound = async (
  query: string,
  apiKey: string,
  filter: FreesoundLicenseFilter,
  page = 1,
  signal?: AbortSignal,
): Promise<FreesoundSearchPage> => {
  const normalizedQuery = query.trim();
  if (!apiKey.trim()) throw new Error("Add your Freesound API key in Settings to search the cloud library.");
  if (!normalizedQuery) return { sounds: [], total: 0, page: 1, hasNext: false };
  const parameters = new URLSearchParams({
    query: normalizedQuery,
    page: String(Math.max(1, Math.floor(page))),
    page_size: String(PAGE_SIZE),
    sort: "score",
    fields: "id,name,tags,username,license,type,duration,filesize,samplerate,channels,url,previews",
  });
  const filterValue = licenseFilter(filter);
  if (filterValue) parameters.set("filter", filterValue);
  const response = await requestJson(`${SEARCH_ENDPOINT}?${parameters.toString()}`, apiKey.trim(), signal) as FreesoundSearchResponse;
  const results = Array.isArray(response.results) ? response.results : [];
  const sounds = results.map((item) => mapSound(item as FreesoundApiSound)).filter((item): item is SoundFile => Boolean(item));
  return {
    sounds,
    total: asNumber(response.count),
    page: Math.max(1, Math.floor(page)),
    hasNext: typeof response.next === "string" && Boolean(response.next),
  };
};

export const freesoundLicenseLabel = (license: string) => {
  const normalized = String(license || "").toLowerCase();
  if (normalized.indexOf("noncommercial") > -1) return "CC BY-NC";
  if (normalized.indexOf("attribution") > -1) return "CC BY";
  if (normalized.indexOf("creative commons 0") > -1 || normalized.indexOf("cc0") > -1) return "CC0";
  return license || "License unknown";
};
