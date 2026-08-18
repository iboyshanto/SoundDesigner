<script lang="ts">
  import type { SoundFile } from "../types";
  import { formatDuration, formatSize } from "../ui-utils";
  import IconButton from "./IconButton.svelte";
  import ChannelWaveform from "./ChannelWaveform.svelte";

  let { sound, channels, progress, zoom, reversed, onSeek, onZoomIn, onZoomOut }: {
    sound: SoundFile | null;
    channels: Float32Array[];
    progress: number;
    zoom: number;
    reversed: boolean;
    onSeek: (progress: number) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
  } = $props();

  const fallbackWaveform = new Float32Array([0]);
</script>

<section class="preview-pane">
  <div class="preview-heading">
    <div><span class="eyebrow">Spectrum preview</span><strong>{sound ? sound.name : "Nothing selected"}</strong></div>
    <div class="preview-tools">
      <span class="zoom-value">{zoom.toFixed(1)}×</span>
      <IconButton icon="zoomOut" label="Zoom waveform out" onclick={onZoomOut} disabled={zoom <= 1} />
      <IconButton icon="zoomIn" label="Zoom waveform in" onclick={onZoomIn} disabled={zoom >= 3} />
    </div>
  </div>
  <div class="hero-waveform">
    <span class="time-ruler"><i>0:00</i><i>{sound ? formatDuration((sound.duration || 8) / 2) : "0:00"}</i><i>{sound ? formatDuration(sound.duration || 8) : "0:00"}</i></span>
    <button
      aria-label="Seek audio preview"
      class="channel-seek-target"
    onclick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek((event.clientX - rect.left) / rect.width);
    }}
      type="button"
    ></button>
    {#key sound?.id || "empty"}
      <ChannelWaveform {channels} fallback={sound ? sound.waveform : fallbackWaveform} {progress} {zoom} {reversed} showModeControls={Boolean(sound)} />
    {/key}
  </div>
  <div class="preview-aside">
    <div class="preview-detail-grid">
      <div><span>Format</span><strong>{sound ? sound.extension.toUpperCase() : "—"}</strong></div>
      <div><span>Size</span><strong>{sound ? formatSize(sound.size) : "—"}</strong></div>
      <div><span>Length</span><strong>{sound && sound.duration ? formatDuration(sound.duration) : "On load"}</strong></div>
      <div><span>Source</span><strong>{sound ? "Local" : "—"}</strong></div>
    </div>
    {#if sound}
      <div class="tag-row">
        {#each sound.tags.slice(0, 5) as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
      </div>
    {/if}
  </div>
</section>
