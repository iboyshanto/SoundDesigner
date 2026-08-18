<script lang="ts">
  let {
    channels = [],
    fallback = new Float32Array([0]),
    progress = 0,
    zoom = 1,
    reversed = false,
    showModeControls = true,
  }: {
    channels: Float32Array[];
    fallback: Float32Array;
    progress?: number;
    zoom?: number;
    reversed?: boolean;
    showModeControls?: boolean;
  } = $props();

  type WaveformMode = "stereo" | "mono";
  const FALLBACK_BINS = 1536;
  const MAX_RENDER_POINTS = 512;

  const fallbackPeaks = (values: Float32Array, variation: number) => {
    const peaks = new Float32Array(FALLBACK_BINS * 2);
    let noise = 2166136261 ^ (variation * 2654435761);
    for (let index = 0; index < FALLBACK_BINS; index += 1) {
      const position = (index / Math.max(1, FALLBACK_BINS - 1)) * Math.max(0, values.length - 1);
      const left = Math.floor(position);
      const right = Math.min(values.length - 1, left + 1);
      const mix = position - left;
      const envelope = values[left] * (1 - mix) + values[right] * mix;
      noise = Math.imul(noise ^ (noise >>> 15), 2246822519) >>> 0;
      const texture = 0.68 + ((noise >>> 8) / 0x00ffffff) * 0.32;
      const amplitude = Math.max(0, Math.min(1, envelope * texture));
      const asymmetry = 0.84 + ((noise & 255) / 255) * 0.16;
      peaks[index * 2] = -amplitude * asymmetry;
      peaks[index * 2 + 1] = amplitude * (1.84 - asymmetry);
    }
    return peaks;
  };

  const mixChannelsToMono = (sourceChannels: Float32Array[]) => {
    if (sourceChannels.length === 1) return sourceChannels[0];
    const sampleLength = Math.max(0, ...sourceChannels.map((channel) => channel.length));
    const mono = new Float32Array(sampleLength);
    for (let index = 0; index < sampleLength; index += 2) {
      let minimum = 0;
      let maximum = 0;
      for (const channel of sourceChannels) {
        minimum += channel[index] || 0;
        maximum += channel[index + 1] || 0;
      }
      mono[index] = minimum / sourceChannels.length;
      if (index + 1 < sampleLength) mono[index + 1] = maximum / sourceChannels.length;
    }
    return mono;
  };

  const pathForChannel = (peaks: Float32Array, channelZoom: number, channelReversed: boolean) => {
    const totalBins = Math.floor(peaks.length / 2);
    const visibleBins = Math.max(2, Math.floor(totalBins / channelZoom));
    const renderBins = Math.min(MAX_RENDER_POINTS, visibleBins);
    const points: Array<{ minimum: number; maximum: number }> = [];
    let absolutePeak = 0;
    for (let index = 0; index < totalBins; index += 1) {
      absolutePeak = Math.max(absolutePeak, Math.abs(peaks[index * 2]), Math.abs(peaks[index * 2 + 1]));
    }
    const gain = absolutePeak > 0 ? Math.min(3, 0.93 / absolutePeak) : 1;
    for (let index = 0; index < renderBins; index += 1) {
      const relativeStart = Math.floor((index * visibleBins) / renderBins);
      const relativeEnd = Math.max(relativeStart + 1, Math.floor(((index + 1) * visibleBins) / renderBins));
      let minimum = 0;
      let maximum = 0;
      for (let relative = relativeStart; relative < relativeEnd; relative += 1) {
        const sourceIndex = channelReversed ? totalBins - relative - 1 : relative;
        minimum = Math.min(minimum, peaks[sourceIndex * 2]);
        maximum = Math.max(maximum, peaks[sourceIndex * 2 + 1]);
      }
      points.push({ minimum: minimum * gain, maximum: maximum * gain });
    }
    const width = 1024;
    const center = 50;
    const amplitude = 46;
    const top = points.map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
      return `${x.toFixed(2)},${(center - point.maximum * amplitude).toFixed(2)}`;
    });
    const bottom = points.map((point, index) => {
      const x = points.length === 1 ? 0 : ((points.length - index - 1) / (points.length - 1)) * width;
      const source = points[points.length - index - 1];
      return `${x.toFixed(2)},${(center - source.minimum * amplitude).toFixed(2)}`;
    });
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  };

  let renderedChannels = $derived(channels.length ? channels : [fallbackPeaks(fallback, 0)]);
  let hasStereo = $derived(renderedChannels.length > 1);
  let waveformMode = $state<WaveformMode>("stereo");
  let visibleChannels = $derived(
    waveformMode === "mono" || !hasStereo
      ? [mixChannelsToMono(renderedChannels)]
      : renderedChannels.slice(0, 2),
  );
  let visibleChannelPaths = $derived(visibleChannels.map((channel, index) => ({
    index,
    path: pathForChannel(channel, zoom, reversed),
  })));
  let playedPercent = $derived(Math.max(0, Math.min(100, progress * 100)));
  let effectiveMode = $derived(waveformMode === "stereo" && hasStereo ? "Stereo" : "Mono");
</script>

<div
  aria-label={`${effectiveMode} waveform preview`}
  class:has-mode-controls={showModeControls}
  class="channel-waveform"
>
  <div class="channel-lanes" style={`--channel-count: ${visibleChannelPaths.length}`}>
    {#each visibleChannelPaths as channel (channel.index)}
      <div class="channel-lane">
        <span class="channel-centerline"></span>
        <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1024 100">
          <path d={channel.path}></path>
        </svg>
      </div>
    {/each}
  </div>
  {#if showModeControls}
    <div aria-label="Waveform channel mode" class="channel-labels" role="group">
      <button
        aria-label="Show stereo waveform"
        aria-pressed={waveformMode === "stereo" && hasStereo}
        class:is-active={waveformMode === "stereo" && hasStereo}
        disabled={!hasStereo}
        onclick={(event) => { event.stopPropagation(); waveformMode = "stereo"; }}
        type="button"
      >Stereo</button>
      <button
        aria-label="Show mono waveform"
        aria-pressed={waveformMode === "mono" || !hasStereo}
        class:is-active={waveformMode === "mono" || !hasStereo}
        onclick={(event) => { event.stopPropagation(); waveformMode = "mono"; }}
        type="button"
      >Mono</button>
    </div>
  {/if}
  <span aria-live="polite" class="sr-only">Showing {effectiveMode.toLowerCase()} waveform</span>
  <span class="channel-playhead" style:inset-inline-start={`${playedPercent}%`}>{#if progress > 0.02 && progress < 0.98}<i>{Math.round(progress * 100)}%</i>{/if}</span>
</div>
