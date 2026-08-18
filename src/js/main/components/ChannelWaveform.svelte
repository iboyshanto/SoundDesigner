<script lang="ts">
  let {
    channels = [],
    fallback = new Float32Array([0.1]),
    progress = 0,
    zoom = 1,
    reversed = false,
  }: {
    channels: Float32Array[];
    fallback: Float32Array;
    progress?: number;
    zoom?: number;
    reversed?: boolean;
  } = $props();

  const FALLBACK_BINS = 3072;
  const MAX_RENDER_POINTS = 1024;

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
      const amplitude = Math.max(0.006, Math.min(1, envelope * texture));
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

  let renderedChannels = $derived(channels.length ? channels : [fallbackPeaks(fallback, 0), fallbackPeaks(fallback, 1)]);
  let isolatedChannel = $state<number | null>(null);
  let visibleChannelPaths = $derived.by(() => {
    const indexes = isolatedChannel === null || !renderedChannels[isolatedChannel]
      ? renderedChannels.map((_, index) => index)
      : [isolatedChannel];
    return indexes.map((sourceIndex) => ({
      sourceIndex,
      path: pathForChannel(renderedChannels[sourceIndex], zoom, reversed),
    }));
  });
  let playedPercent = $derived(Math.max(0, Math.min(100, progress * 100)));

  $effect(() => {
    if (isolatedChannel !== null && !renderedChannels[isolatedChannel]) isolatedChannel = null;
  });
</script>

<div class="channel-waveform" aria-label={`${visibleChannelPaths.length} of ${renderedChannels.length} audio ${renderedChannels.length === 1 ? "channel" : "channels"} visible`}>
  <div class="channel-lanes" style={`--channel-count: ${visibleChannelPaths.length}`}>
    {#each visibleChannelPaths as channel (channel.sourceIndex)}
      <div class="channel-lane">
        <span class="channel-centerline"></span>
        <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1024 100">
          <path d={channel.path}></path>
        </svg>
      </div>
    {/each}
  </div>
  <div class="channel-labels">
    {#each renderedChannels as _, index (index)}
      <button
        aria-label={isolatedChannel === index ? `Show all channels` : `Show only Channel ${index + 1}`}
        aria-pressed={isolatedChannel === null || isolatedChannel === index}
        class:is-active={isolatedChannel === null || isolatedChannel === index}
        onclick={(event) => {
          event.stopPropagation();
          isolatedChannel = isolatedChannel === index ? null : index;
        }}
        type="button"
      >Channel {index + 1}</button>
    {/each}
  </div>
  <span aria-live="polite" class="sr-only">{isolatedChannel === null ? `Showing all ${renderedChannels.length} channels` : `Showing Channel ${isolatedChannel + 1}`}</span>
  <span class="channel-playhead" style:inset-inline-start={`${playedPercent}%`}>{#if progress > 0.02 && progress < 0.98}<i>{Math.round(progress * 100)}%</i>{/if}</span>
</div>
