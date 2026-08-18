<script lang="ts">
  import type { SoundFile } from "../types";
  import { formatDuration, formatSize } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import Waveform from "./Waveform.svelte";

  let { sound, channels = [], selected, playing, progress, dragHint, onSelect, onPlay, onInsert, onFavorite, onDragPrepare, onDragStart, onDragEnd }: {
    sound: SoundFile;
    channels?: Float32Array[];
    selected: boolean;
    playing: boolean;
    progress: number;
    dragHint: string;
    onSelect: () => void;
    onPlay: () => void;
    onInsert: () => void;
    onFavorite: () => void;
    onDragPrepare: () => void;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: (event: DragEvent) => void;
  } = $props();

  let score = $derived(76 + (sound.name.length * 7) % 23);
</script>

<div
  class={`sound-row accent-${sound.accent} ${selected ? "is-selected" : ""}`}
  draggable={Boolean(sound.path)}
  onclick={onSelect}
  ondblclick={onInsert}
  onpointerdown={(event) => { if (sound.path && event.button === 0) onDragPrepare(); }}
  ondragstart={onDragStart}
  ondragend={onDragEnd}
  onkeydown={(event) => {
    if (event.key === "Enter") onSelect();
  }}
  role="option"
  aria-selected={selected}
  tabindex="0"
>
  <span class="drag-handle tooltip" data-tooltip={dragHint}><Icon name="drag" /></span>
  <button aria-label={playing ? `Pause ${sound.name}` : `Preview ${sound.name}`} class="row-play tooltip" data-tooltip={playing ? "Pause preview" : "Preview sound"} onclick={(event) => { event.stopPropagation(); onPlay(); }} type="button">
    <Icon name={playing ? "pause" : "play"} size={14} />
  </button>
  <div class="sound-main">
    <div class="sound-title-line"><strong>{sound.name}</strong></div>
    <Waveform compact values={sound.waveform} {channels} progress={playing ? progress : 0} />
  </div>
  <div class="sound-meta"><span>{sound.duration ? formatDuration(sound.duration) : "—:—"}</span><small>{sound.extension.toUpperCase()} · {formatSize(sound.size)}</small></div>
  <span class="match-score tooltip" data-tooltip="Search relevance">{score}%</span>
  <IconButton icon="heart" label={sound.favorite ? "Remove from favorites" : "Add to favorites"} active={sound.favorite} onclick={onFavorite} class="row-favorite" />
</div>
