import { fs } from "../lib/cep/node";

// Keep enough source detail for the 3x preview zoom while the renderer caps the
// number of SVG points it draws. This remains tiny compared with decoded audio:
// roughly 24 KB per channel rather than retaining full PCM sample buffers.
const PEAK_BINS = 1536;
const MAX_DECODE_BYTES = 32 * 1024 * 1024;
const MAX_DECODE_DURATION_SECONDS = 120;
const MAX_CACHE_ENTRIES = 8;
const channelCache = new Map<string, Float32Array[]>();

const readAudioFile = (filePath: string) => new Promise<ArrayBuffer>((resolve, reject) => {
  fs.readFile(filePath, (error, bytes) => {
    if (error) {
      reject(error);
      return;
    }
    const source = bytes.buffer as ArrayBuffer;
    resolve(source.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  });
});

const extractPeaks = (samples: Float32Array, bins: number) => {
  const peaks = new Float32Array(bins * 2);
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor((bin * samples.length) / bins);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor(((bin + 1) * samples.length) / bins)));
    let minimum = 0;
    let maximum = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index];
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    peaks[bin * 2] = minimum;
    peaks[bin * 2 + 1] = maximum;
  }
  return peaks;
};

const rememberChannels = (key: string, channels: Float32Array[]) => {
  channelCache.delete(key);
  channelCache.set(key, channels);
  while (channelCache.size > MAX_CACHE_ENTRIES) {
    const oldest = channelCache.keys().next().value as string | undefined;
    if (!oldest) break;
    channelCache.delete(oldest);
  }
};

export const decodeAudioWaveformChannels = async (
  filePath: string,
  fileSize: number,
  modifiedAt: number,
  durationSeconds = 0,
  shouldContinue?: () => boolean,
): Promise<Float32Array[]> => {
  if (
    !filePath
    || !window.cep
    || fileSize > MAX_DECODE_BYTES
    || durationSeconds > MAX_DECODE_DURATION_SECONDS
    || typeof fs.readFile !== "function"
    || (shouldContinue && !shouldContinue())
  ) return [];
  const cacheKey = `${filePath}:${modifiedAt}:${fileSize}`;
  const cached = channelCache.get(cacheKey);
  if (cached) {
    rememberChannels(cacheKey, cached);
    return cached;
  }

  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return [];

  let context: AudioContext | null = null;
  try {
    const bytes = await readAudioFile(filePath);
    if (shouldContinue && !shouldContinue()) return [];
    context = new AudioContextConstructor();
    const audioBuffer = await context.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      channels.push(extractPeaks(audioBuffer.getChannelData(channel), PEAK_BINS));
    }
    rememberChannels(cacheKey, channels);
    return channels;
  } catch (_error) {
    return [];
  } finally {
    try { if (context) await context.close(); } catch (_error) {}
  }
};
