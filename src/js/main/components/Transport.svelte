<script lang="ts">
  import type { SoundFile } from "../types";
  import { formatDuration } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  let { sound, playing, progress, volume, loop, reversed, busy, onPrevious, onTogglePlay, onNext, onStop, onLoop, onReverse, onVolume, onInsert, onRemove }: {
    sound: SoundFile | null;
    playing: boolean;
    progress: number;
    volume: number;
    loop: boolean;
    reversed: boolean;
    busy: boolean;
    onPrevious: () => void;
    onTogglePlay: () => void;
    onNext: () => void;
    onStop: () => void;
    onLoop: () => void;
    onReverse: () => void;
    onVolume: (value: number) => void;
    onInsert: () => void;
    onRemove: () => void;
  } = $props();
</script>

<footer class="transport-bar">
  <div class="now-playing">
    <span class="now-glyph"><Icon name="waveform" /></span>
    <div><span class="eyebrow">Now previewing</span><strong>{sound ? sound.name : "Select a sound"}</strong></div>
  </div>
  <div class="transport-controls">
    <IconButton icon="previous" label="Previous sound" onclick={onPrevious} disabled={!sound} />
    <button aria-label={playing ? "Pause preview" : "Play preview"} class="play-button tooltip" data-tooltip={playing ? "Pause preview" : "Play preview"} disabled={!sound} onclick={onTogglePlay} type="button">
      <Icon name={playing ? "pause" : "play"} size={18} />
    </button>
    <IconButton icon="next" label="Next sound" onclick={onNext} disabled={!sound} />
    <IconButton icon="stop" label="Stop and return to start" onclick={onStop} disabled={!sound} />
    <IconButton icon="loop" label="Loop preview" active={loop} pressed={loop} onclick={onLoop} />
    <IconButton icon="reverse" label="Reverse preview" active={reversed} pressed={reversed} onclick={onReverse} />
  </div>
  <div class="transport-right">
    <div class="volume-control tooltip" data-tooltip="Preview volume">
      <Icon name="volume" />
      <input aria-label="Preview volume" max="1" min="0" oninput={(event) => onVolume(Number(event.currentTarget.value))} step="0.01" type="range" value={volume} />
    </div>
    <span class="transport-time">{sound ? formatDuration(progress * (sound.duration || 0)) : "0:00"}</span>
    <IconButton icon="trash" label="Remove from index (keeps source file)" onclick={onRemove} disabled={!sound} class="danger-icon" />
    <button class="primary-button tooltip" data-tooltip="Insert at the current playhead" disabled={!sound || busy} onclick={onInsert} type="button">
      {#if busy}<span class="spinner"></span>{:else}<Icon name="download" />{/if}
      <span>Insert</span>
    </button>
  </div>
</footer>
