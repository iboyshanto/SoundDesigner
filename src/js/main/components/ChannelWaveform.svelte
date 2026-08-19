<script lang="ts">
  let {
    channels = [],
    fallback = new Float32Array([0]),
    progress = 0,
    zoom = 1,
    reversed = false,
    showModeControls = true,
    channelCountHint = 0,
    loading = false,
  }: {
    channels: Float32Array[];
    fallback: Float32Array;
    progress?: number;
    zoom?: number;
    reversed?: boolean;
    showModeControls?: boolean;
    channelCountHint?: number;
    loading?: boolean;
  } = $props();

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

  let knownChannelCount = $derived(Math.max(0, Math.min(2, Math.floor(channelCountHint || 0))));
  let awaitingChannelAnalysis = $derived(loading && channels.length === 0 && knownChannelCount === 0);
  let fallbackChannelCount = $derived(knownChannelCount || 1);
  let renderedChannels = $derived(channels.length
    ? channels
    : Array.from({ length: fallbackChannelCount }, (_, index) => fallbackPeaks(fallback, index)));
  let hasStereo = $derived(renderedChannels.length > 1);
  let channelMode = $state<"mono" | "stereo">("stereo");
  let effectiveChannelMode = $derived(hasStereo && channelMode === "stereo" ? "stereo" : "mono");
  let monoChannel = $derived.by(() => {
    if (renderedChannels.length <= 1) return renderedChannels[0] || fallbackPeaks(fallback, 0);
    const channelCount = Math.min(2, renderedChannels.length);
    const valueCount = Math.min(...renderedChannels.slice(0, channelCount).map((channel) => channel.length));
    const mixed = new Float32Array(valueCount);
    for (let index = 0; index < valueCount; index += 1) {
      let value = 0;
      for (let channel = 0; channel < channelCount; channel += 1) value += renderedChannels[channel][index];
      mixed[index] = value / channelCount;
    }
    return mixed;
  });
  let visibleChannels = $derived(effectiveChannelMode === "stereo"
    ? renderedChannels.slice(0, 2)
    : [monoChannel]);
  let visibleChannelPaths = $derived(visibleChannels.map((channel, index) => ({
    index,
    path: pathForChannel(channel, zoom, reversed),
  })));
  let playedPercent = $derived(Math.max(0, Math.min(100, progress * 100)));
  let effectiveMode = $derived(effectiveChannelMode === "stereo" ? "Stereo" : "Mono");
</script>

<div
  aria-busy={loading}
  aria-label={loading ? "Analyzing audio channels" : `${effectiveMode} waveform preview`}
  class:has-mode-controls={showModeControls}
  class="channel-waveform"
>
  {#if awaitingChannelAnalysis}
    <div aria-hidden="true" class="channel-lanes channel-lanes--pending">
      <span></span>
    </div>
  {:else}
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
  {/if}
  {#if showModeControls}
    {#if loading}
      <div aria-live="polite" class="channel-labels channel-labels--loading">
        <span class="channel-analysis"><i aria-hidden="true"></i>Analyzing channels</span>
      </div>
    {:else}
      <div aria-label="Waveform channel mode" class="channel-labels" role="group">
        <button
          aria-label="Show mono waveform"
          aria-pressed={effectiveChannelMode === "mono"}
          class:is-active={effectiveChannelMode === "mono"}
          onclick={(event) => { event.stopPropagation(); channelMode = "mono"; }}
          type="button"
        >Mono</button>
        <button
          aria-label={hasStereo ? "Show stereo waveform" : "Stereo is unavailable for this sound"}
          aria-pressed={effectiveChannelMode === "stereo"}
          class:is-active={effectiveChannelMode === "stereo"}
          disabled={!hasStereo}
          onclick={(event) => { event.stopPropagation(); channelMode = "stereo"; }}
          type="button"
        >Stereo</button>
      </div>
    {/if}
  {/if}
  {#if !loading}<span aria-live="polite" class="sr-only">Showing {effectiveMode.toLowerCase()} waveform</span>{/if}
  <span class="channel-playhead" style:inset-inline-start={`${playedPercent}%`}>{#if progress > 0.02 && progress < 0.98}<i>{Math.round(progress * 100)}%</i>{/if}</span>
</div>
