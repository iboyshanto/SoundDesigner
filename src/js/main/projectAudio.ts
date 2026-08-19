import { crypto, fs, https, path } from "../lib/cep/node";
import type {
  AudioConversionPolicy,
  AudioNormalization,
  AudioSegmentSelection,
  HostApp,
  HostProjectContext,
  SoundFile,
} from "./types";

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_DECODE_BYTES = 128 * 1024 * 1024;
const MAX_CONVERTED_PCM_BYTES = 128 * 1024 * 1024;
const MAX_DECODED_PCM_BYTES = Math.floor(MAX_CONVERTED_PCM_BYTES * 4 / 3);
const ENCODE_CHECK_INTERVAL = 8192;
const MAIN_THREAD_BUDGET_MS = 10;
const MIN_SEGMENT_SECONDS = 0.05;
const TARGET_PEAK = Math.pow(10, -1 / 20);
const DIRECT_ADOBE_AUDIO: { [extension: string]: boolean } = {
  aac: true,
  aif: true,
  aiff: true,
  bwf: true,
  m4a: true,
  mpa: true,
  mp3: true,
  wav: true,
};

export const requiresProjectAudioPreparation = (
  sound: SoundFile,
  conversionPolicy: AudioConversionPolicy,
  normalization: AudioNormalization,
) => Boolean(sound.path && sound.preparedProfile === `${conversionPolicy}:${normalization}`)
  ? false
  : sound.source === "freesound"
  || normalization !== "preserve"
  || conversionPolicy === "always"
  || (conversionPolicy === "unsupported" && !DIRECT_ADOBE_AUDIO[sound.extension.toLowerCase()]);

export type PrepareAudioOptions = {
  host: HostApp;
  project: HostProjectContext;
  conversionPolicy: AudioConversionPolicy;
  normalization: AudioNormalization;
  signal?: AbortSignal;
  onProgress?: (stage: "downloading" | "converting", message: string) => void;
};

export type PreparedAudio = {
  sound: SoundFile;
  projectRoot: string;
  converted: boolean;
  downloaded: boolean;
  gainDb: number;
};

const errorText = (error: unknown) => {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error || "Unknown audio preparation error");
};

const safeName = (value: string, fallback: string) => {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return cleaned || fallback;
};

const ensureDirectory = (directory: string) => {
  if (!fs || typeof fs.mkdirSync !== "function") throw new Error("CEP filesystem access is unavailable.");
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
};

const extensionFromUrl = (url: string) => {
  try {
    const extension = path.extname(new URL(url).pathname).replace(/^\./, "").toLowerCase();
    return extension === "mpeg" ? "mp3" : extension || "mp3";
  } catch (_error) {
    return "mp3";
  }
};

const trustedDownloadUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && (parsed.hostname === "freesound.org" || parsed.hostname === "www.freesound.org" || parsed.hostname === "cdn.freesound.org");
  } catch (_error) {
    return false;
  }
};

const downloadFile = (
  sourceUrl: string,
  destination: string,
  signal?: AbortSignal,
  redirectCount = 0,
): Promise<void> => new Promise((resolve, reject) => {
  if (!window.cep || !https || typeof https.get !== "function" || !fs || typeof fs.createWriteStream !== "function") {
    reject(new Error("Cloud downloads are available inside the installed Adobe panel."));
    return;
  }
  if (!trustedDownloadUrl(sourceUrl)) {
    reject(new Error("Freesound returned an untrusted download address."));
    return;
  }
  const temporaryPath = `${destination}.part`;
  let settled = false;
  let received = 0;
  let abortHandler: (() => void) | null = null;
  const cleanupSignal = () => {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    abortHandler = null;
  };
  const cleanup = () => {
    try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch (_error) {}
  };
  const finishError = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanupSignal();
    cleanup();
    reject(error);
  };
  const request = https.get(sourceUrl, { headers: { "User-Agent": "SoundDesigner CEP" } }, (response) => {
    const statusCode = Number(response.statusCode || 0);
    const location = typeof response.headers.location === "string" ? response.headers.location : "";
    if (statusCode >= 300 && statusCode < 400 && location) {
      response.resume();
      if (redirectCount >= 4) return finishError(new Error("Freesound redirected the download too many times."));
      let redirected = "";
      try { redirected = new URL(location, sourceUrl).toString(); } catch (_error) {}
      if (!redirected || !trustedDownloadUrl(redirected)) return finishError(new Error("Freesound redirected to an untrusted download address."));
      settled = true;
      cleanupSignal();
      downloadFile(redirected, destination, signal, redirectCount + 1).then(resolve, reject);
      return;
    }
    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      return finishError(new Error(`Freesound download failed (HTTP ${statusCode}).`));
    }
    const contentLength = Number(response.headers["content-length"] || 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      response.resume();
      return finishError(new Error("This sound is too large to download safely."));
    }
    const output = fs.createWriteStream(temporaryPath);
    response.on("data", (chunk: Uint8Array) => {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) {
        request.abort();
        output.destroy();
        finishError(new Error("This sound exceeded the maximum safe download size."));
      }
    });
    response.on("error", (error) => finishError(error instanceof Error ? error : new Error(String(error))));
    output.on("error", (error) => finishError(error instanceof Error ? error : new Error(String(error))));
    output.on("finish", () => {
      output.close(() => {
        if (settled) return;
        try {
          if (!received) throw new Error("Freesound returned an empty audio file.");
          if (fs.existsSync(destination)) fs.unlinkSync(destination);
          fs.renameSync(temporaryPath, destination);
          settled = true;
          cleanupSignal();
          resolve();
        } catch (error) {
          finishError(new Error(errorText(error)));
        }
      });
    });
    response.pipe(output);
  });
  request.setTimeout(30000, () => {
    request.abort();
    finishError(new Error("The Freesound download timed out."));
  });
  request.on("error", (error) => finishError(error instanceof Error ? error : new Error(String(error))));
  if (signal) {
    abortHandler = () => {
      request.abort();
      finishError(new DOMException("The download was cancelled.", "AbortError"));
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener("abort", abortHandler, { once: true });
  }
});

const readFileBuffer = async (filePath: string) => {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_DECODE_BYTES) throw new Error("This audio file is too large for the compatibility converter.");
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    fs.readFile(filePath, (error, value) => error ? reject(error) : resolve(value));
  });
  const source = bytes.buffer as ArrayBuffer;
  return source.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const decodeAudio = async (filePath: string, signal?: AbortSignal) => {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) throw new Error("The CEP audio decoder is unavailable.");
  let context: AudioContext | null = null;
  try {
    const bytes = await readFileBuffer(filePath);
    if (signal?.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
    context = new AudioContextConstructor();
    const decoded = await context.decodeAudioData(bytes);
    if (signal?.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
    const decodedPcmBytes = decoded.length * decoded.numberOfChannels * 4;
    if (!Number.isFinite(decodedPcmBytes) || decodedPcmBytes > MAX_DECODED_PCM_BYTES) {
      throw new Error("This sound is too long to convert safely in the Adobe panel. Trim it or convert it externally first.");
    }
    return decoded;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("This audio codec could not be converted by the lightweight SoundDesigner decoder.");
  } finally {
    try { if (context) await context.close(); } catch (_error) {}
  }
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
};

const encodePcm24Wave = async (
  audioBuffer: AudioBuffer,
  normalization: AudioNormalization,
  signal?: AbortSignal,
  frameStart = 0,
  frameEnd = audioBuffer.length,
) => {
  const boundedStart = Math.max(0, Math.min(audioBuffer.length - 1, Math.floor(frameStart)));
  const boundedEnd = Math.max(boundedStart + 1, Math.min(audioBuffer.length, Math.ceil(frameEnd)));
  const frameCount = boundedEnd - boundedStart;
  const channels: Float32Array[] = [];
  let peak = 0;
  let sliceStartedAt = performance.now();
  const yieldToPanel = async () => {
    if (signal?.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
    if (performance.now() - sliceStartedAt < MAIN_THREAD_BUDGET_MS) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    sliceStartedAt = performance.now();
  };
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const samples = audioBuffer.getChannelData(channel);
    channels.push(samples);
    if (normalization === "peak-minus-one") {
      for (let index = boundedStart; index < boundedEnd; index += 1) {
        const absolute = Math.abs(samples[index]);
        if (absolute > peak) peak = absolute;
        if (index > 0 && index % ENCODE_CHECK_INTERVAL === 0) await yieldToPanel();
      }
    }
  }
  const gain = normalization === "peak-minus-one" && peak > 0 ? TARGET_PEAK / peak : 1;
  const gainDb = gain > 0 ? 20 * Math.log(gain) / Math.LN10 : 0;
  const bytesPerSample = 3;
  const blockAlign = audioBuffer.numberOfChannels * bytesPerSample;
  const dataLength = frameCount * blockAlign;
  if (dataLength > MAX_CONVERTED_PCM_BYTES) throw new Error("This sound is too long to convert safely in the Adobe panel. Trim it or convert it externally first.");
  if (dataLength + 44 > 0xffffffff) throw new Error("The converted WAV would exceed the 4 GB RIFF limit.");
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audioBuffer.numberOfChannels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sourceFrame = boundedStart + frame;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][sourceFrame] * gain));
      let integer = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
      if (integer < 0) integer += 0x1000000;
      bytes[offset++] = integer & 0xff;
      bytes[offset++] = (integer >>> 8) & 0xff;
      bytes[offset++] = (integer >>> 16) & 0xff;
    }
    if (frame > 0 && frame % ENCODE_CHECK_INTERVAL === 0) await yieldToPanel();
  }
  return { bytes, gainDb };
};

const writeFileAsync = (filePath: string, bytes: Uint8Array) => new Promise<void>((resolve, reject) => {
  fs.writeFile(filePath, bytes, (error) => error ? reject(error) : resolve());
});

const writeJsonAtomically = (filePath: string, value: unknown) => {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  fs.renameSync(temporary, filePath);
};

const fileFingerprint = (sound: SoundFile, sourcePath: string, policy: AudioConversionPolicy, normalization: AudioNormalization) => {
  const stat = fs.statSync(sourcePath);
  const key = [sound.source || "local", sound.sourceId || sound.id, sourcePath, stat.size, stat.mtimeMs, policy, normalization].join("|");
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
};

const projectDirectories = (project: HostProjectContext) => {
  if (!project.ok || !project.projectDirectory || !project.projectName) throw new Error(project.message || "Save the Adobe project before preparing audio.");
  const projectName = safeName(project.projectName, "Adobe Project");
  const root = path.join(project.projectDirectory, "SoundDesigner", projectName);
  const originals = path.join(root, "Freesound", "Originals");
  const converted = path.join(root, "Converted");
  const segments = path.join(root, "Segments");
  const metadata = path.join(root, "Metadata");
  ensureDirectory(originals);
  ensureDirectory(converted);
  ensureDirectory(segments);
  ensureDirectory(metadata);
  return { root, originals, converted, segments, metadata };
};

const segmentTimeToken = (seconds: number) => String(Math.max(0, Math.round(seconds * 1000))).padStart(8, "0");

const segmentDisplayTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
};

export const prepareAudioForHost = async (sound: SoundFile, options: PrepareAudioOptions): Promise<PreparedAudio> => {
  if (!window.cep) throw new Error("Audio preparation is available inside the installed Adobe panel.");
  if (options.signal?.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
  let workingPath = sound.source === "freesound" ? "" : sound.originalPath || sound.path;
  let workingExtension = (sound.originalExtension || sound.extension).toLowerCase();
  let downloaded = false;

  const localNeedsConversion = options.normalization !== "preserve"
    || options.conversionPolicy === "always"
    || (options.conversionPolicy === "unsupported" && !DIRECT_ADOBE_AUDIO[workingExtension]);
  if (sound.source !== "freesound" && !localNeedsConversion) {
    if (!workingPath || !fs.existsSync(workingPath)) throw new Error("The source audio file is unavailable.");
    const stat = fs.statSync(workingPath);
    return {
      sound: {
        ...sound,
        path: workingPath,
        extension: workingExtension,
        size: stat.size,
        modifiedAt: stat.mtimeMs || stat.mtime.getTime(),
        preparedProjectPath: undefined,
        preparedProfile: undefined,
      },
      projectRoot: "",
      converted: false,
      downloaded: false,
      gainDb: 0,
    };
  }

  const directories = projectDirectories(options.project);

  if (sound.source === "freesound") {
    if (!sound.previewUrl || !sound.sourceId) throw new Error("This Freesound result has no downloadable preview.");
    workingExtension = extensionFromUrl(sound.previewUrl);
    const baseName = `${safeName(sound.sourceId, "sound")}-${safeName(sound.name, "freesound")}`;
    workingPath = path.join(directories.originals, `${baseName}.${workingExtension}`);
    if (!fs.existsSync(workingPath)) {
      options.onProgress?.("downloading", `Downloading ${sound.name}…`);
      await downloadFile(sound.previewUrl, workingPath, options.signal);
      downloaded = true;
    }
    const sourceMetadataPath = path.join(directories.metadata, `${baseName}.json`);
    writeJsonAtomically(sourceMetadataPath, {
      version: 1,
      provider: "Freesound",
      id: sound.sourceId,
      name: sound.name,
      creator: sound.creator || "",
      license: sound.license || "",
      sourceUrl: sound.sourceUrl || "",
      previewUrl: sound.previewUrl,
      localSource: workingPath,
      downloadedAt: new Date().toISOString(),
    });
  }

  if (!workingPath || !fs.existsSync(workingPath)) throw new Error("The source audio file is unavailable.");
  const needsCompatibilityConversion = !DIRECT_ADOBE_AUDIO[workingExtension];
  const needsConversion = options.normalization !== "preserve"
    || options.conversionPolicy === "always"
    || (options.conversionPolicy === "unsupported" && needsCompatibilityConversion);
  let preparedPath = workingPath;
  let gainDb = 0;
  let converted = false;

  if (needsConversion) {
    options.onProgress?.("converting", options.normalization === "peak-minus-one" ? `Converting and normalizing ${sound.name}…` : `Converting ${sound.name} to WAV…`);
    const fingerprint = fileFingerprint(sound, workingPath, options.conversionPolicy, options.normalization);
    const suffix = options.normalization === "peak-minus-one" ? "-norm-1db" : "";
    preparedPath = path.join(directories.converted, `${safeName(sound.sourceId || sound.id, "sound")}-${safeName(sound.name, "audio")}-${fingerprint}${suffix}.wav`);
    if (!fs.existsSync(preparedPath)) {
      const temporary = `${preparedPath}.part`;
      try {
        const decoded = await decodeAudio(workingPath, options.signal);
        if (options.signal?.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
        const encoded = await encodePcm24Wave(decoded, options.normalization, options.signal);
        gainDb = encoded.gainDb;
        await writeFileAsync(temporary, encoded.bytes);
        if (fs.existsSync(preparedPath)) fs.unlinkSync(preparedPath);
        fs.renameSync(temporary, preparedPath);
      } catch (error) {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_cleanupError) {}
        throw error;
      }
    }
    converted = true;
    const conversionMetadataPath = path.join(directories.metadata, `${path.basename(preparedPath, ".wav")}.json`);
    writeJsonAtomically(conversionMetadataPath, {
      version: 1,
      sourcePath: workingPath,
      outputPath: preparedPath,
      format: "PCM WAV",
      bitDepth: 24,
      sampleRate: "preserved",
      channels: "preserved",
      normalization: options.normalization,
      gainDb,
      createdAt: new Date().toISOString(),
    });
  }

  const stat = fs.statSync(preparedPath);
  return {
    sound: {
      ...sound,
      path: preparedPath,
      extension: converted ? "wav" : workingExtension,
      size: stat.size,
      modifiedAt: stat.mtimeMs || stat.mtime.getTime(),
      downloadState: sound.source === "freesound" ? "ready" : sound.downloadState,
      preparedProjectPath: options.project.projectPath,
      preparedProfile: `${options.conversionPolicy}:${options.normalization}`,
      originalPath: sound.source === "freesound" ? sound.originalPath : sound.originalPath || workingPath,
      originalExtension: sound.originalExtension || sound.extension,
    },
    projectRoot: directories.root,
    converted,
    downloaded,
    gainDb,
  };
};

export const prepareAudioSegmentForHost = async (
  sound: SoundFile,
  selection: AudioSegmentSelection,
  options: PrepareAudioOptions,
): Promise<PreparedAudio> => {
  if (!window.cep) throw new Error("Audio segment rendering is available inside the installed Adobe panel.");
  if (!Number.isFinite(selection.start) || !Number.isFinite(selection.end)) throw new Error("The selected audio range is invalid.");
  if (selection.end - selection.start < MIN_SEGMENT_SECONDS) throw new Error("Select at least 0.05 seconds of audio.");

  const preparedSource = await prepareAudioForHost(sound, options);
  const sourcePath = preparedSource.sound.path;
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("The prepared source audio is unavailable.");

  options.onProgress?.("converting", `Rendering the selected segment from ${sound.name}…`);
  const decoded = await decodeAudio(sourcePath, options.signal);
  if (options.signal?.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");

  const sourceDuration = decoded.duration || sound.duration || 0;
  const maximumStart = Math.max(0, sourceDuration - MIN_SEGMENT_SECONDS);
  const startSeconds = Math.max(0, Math.min(maximumStart, selection.start));
  const endSeconds = Math.min(sourceDuration, Math.max(startSeconds + MIN_SEGMENT_SECONDS, selection.end));
  if (endSeconds <= startSeconds) throw new Error("The selected range falls outside this sound.");

  const startFrame = Math.floor(startSeconds * decoded.sampleRate);
  const endFrame = Math.min(decoded.length, Math.ceil(endSeconds * decoded.sampleRate));
  const directories = projectDirectories(options.project);
  const sourceFingerprint = fileFingerprint(preparedSource.sound, sourcePath, options.conversionPolicy, options.normalization);
  const rangeToken = `${segmentTimeToken(startSeconds)}-${segmentTimeToken(endSeconds)}`;
  const fingerprint = crypto.createHash("sha1")
    .update(`${sourceFingerprint}|${rangeToken}|pcm24`)
    .digest("hex")
    .slice(0, 12);
  const baseName = `${safeName(sound.sourceId || sound.id, "sound")}-${safeName(sound.name, "audio")}-segment-${rangeToken}-${fingerprint}`;
  const outputPath = path.join(directories.segments, `${baseName}.wav`);

  if (!fs.existsSync(outputPath)) {
    const temporary = `${outputPath}.part`;
    try {
      const encoded = await encodePcm24Wave(decoded, "preserve", options.signal, startFrame, endFrame);
      await writeFileAsync(temporary, encoded.bytes);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      fs.renameSync(temporary, outputPath);
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_cleanupError) {}
      throw error;
    }
  }

  const segmentDuration = (endFrame - startFrame) / decoded.sampleRate;
  const segmentName = `${sound.name} [${segmentDisplayTime(startSeconds)}–${segmentDisplayTime(endSeconds)}]`;
  const metadataPath = path.join(directories.metadata, `${baseName}.json`);
  writeJsonAtomically(metadataPath, {
    version: 1,
    kind: "audio-segment",
    sourcePath,
    outputPath,
    sourceName: sound.name,
    startSeconds,
    endSeconds,
    durationSeconds: segmentDuration,
    format: "PCM WAV",
    bitDepth: 24,
    sampleRate: decoded.sampleRate,
    channels: decoded.numberOfChannels,
    normalization: options.normalization,
    createdAt: new Date().toISOString(),
  });

  const stat = fs.statSync(outputPath);
  return {
    sound: {
      ...preparedSource.sound,
      id: `${sound.id}:segment:${rangeToken}`,
      name: segmentName,
      path: outputPath,
      extension: "wav",
      size: stat.size,
      modifiedAt: stat.mtimeMs || stat.mtime.getTime(),
      duration: segmentDuration,
      waveform: sound.waveform,
      downloadState: sound.source === "freesound" ? "ready" : sound.downloadState,
      preparedProjectPath: options.project.projectPath,
      preparedProfile: `${options.conversionPolicy}:${options.normalization}`,
      originalPath: preparedSource.sound.originalPath || sourcePath,
      originalExtension: preparedSource.sound.originalExtension || preparedSource.sound.extension,
    },
    projectRoot: directories.root,
    converted: true,
    downloaded: preparedSource.downloaded,
    gainDb: preparedSource.gainDb,
  };
};
