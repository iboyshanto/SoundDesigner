<script lang="ts">
  let {
    values,
    channels = [],
    progress = 0,
    compact = false,
    zoom = 1,
    reversed = false,
  }: {
    values: Float32Array;
    channels?: Float32Array[];
    progress?: number;
    compact?: boolean;
    zoom?: number;
    reversed?: boolean;
  } = $props();

  const MINI_POINTS = 180;

  const fallbackPeaks = (source: Float32Array) => {
    const peaks = new Float32Array(MINI_POINTS * 2);
    let noise = 2166136261;
    for (let index = 0; index < MINI_POINTS; index += 1) {
      const position = (index / Math.max(1, MINI_POINTS - 1)) * Math.max(0, source.length - 1);
      const left = Math.floor(position);
      const right = Math.min(source.length - 1, left + 1);
      const mix = position - left;
      noise = Math.imul(noise ^ (noise >>> 15), 2246822519) >>> 0;
      const texture = 0.8 + ((noise >>> 8) / 0x00ffffff) * 0.2;
      const amplitude = Math.max(0.015, Math.min(1, (source[left] * (1 - mix) + source[right] * mix) * texture));
      peaks[index * 2] = -amplitude * 0.9;
      peaks[index * 2 + 1] = amplitude;
    }
    return peaks;
  };

  const compactPath = (sourceChannels: Float32Array[], fallback: Float32Array, waveformZoom: number, waveformReversed: boolean) => {
    const peakChannels = sourceChannels.length ? sourceChannels : [fallbackPeaks(fallback)];
    const totalBins = Math.max(1, Math.floor(peakChannels[0].length / 2));
    const visibleBins = Math.max(2, Math.floor(totalBins / waveformZoom));
    const renderBins = Math.min(MINI_POINTS, visibleBins);
    const points: Array<{ minimum: number; maximum: number }> = [];
    let absolutePeak = 0;

    for (let index = 0; index < renderBins; index += 1) {
      const relativeStart = Math.floor((index * visibleBins) / renderBins);
      const relativeEnd = Math.max(relativeStart + 1, Math.floor(((index + 1) * visibleBins) / renderBins));
      let minimum = 0;
      let maximum = 0;
      for (let relative = relativeStart; relative < relativeEnd; relative += 1) {
        const sourceIndex = waveformReversed ? totalBins - relative - 1 : relative;
        for (const channel of peakChannels) {
          minimum = Math.min(minimum, channel[sourceIndex * 2] || 0);
          maximum = Math.max(maximum, channel[sourceIndex * 2 + 1] || 0);
        }
      }
      absolutePeak = Math.max(absolutePeak, Math.abs(minimum), Math.abs(maximum));
      points.push({ minimum, maximum });
    }

    const gain = absolutePeak > 0 ? Math.min(3, 0.94 / absolutePeak) : 1;
    const width = 1000;
    const center = 50;
    const amplitude = 46;
    const top = points.map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
      return `${x.toFixed(2)},${(center - point.maximum * gain * amplitude).toFixed(2)}`;
    });
    const bottom = points.map((_, index) => {
      const sourceIndex = points.length - index - 1;
      const x = points.length === 1 ? 0 : (sourceIndex / (points.length - 1)) * width;
      return `${x.toFixed(2)},${(center - points[sourceIndex].minimum * gain * amplitude).toFixed(2)}`;
    });
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  };

  let path = $derived(compactPath(channels, values, zoom, reversed));
  let playedPercent = $derived(Math.max(0, Math.min(100, progress * 100)));
</script>

<div class={`waveform ${compact ? "waveform--compact" : ""}`} aria-label="Audio waveform">
  <div class="waveform-layer waveform-layer--base">
    <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1000 100"><path d={path}></path></svg>
  </div>
  <div class="waveform-played" style:clip-path={`inset(0 ${100 - playedPercent}% 0 0)`}>
    <div class="waveform-layer waveform-layer--played">
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1000 100"><path d={path}></path></svg>
    </div>
  </div>
  {#if !compact}<span class="waveform-playhead" style:inset-inline-start={`${playedPercent}%`}></span>{/if}
</div>
