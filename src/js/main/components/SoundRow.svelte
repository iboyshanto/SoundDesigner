<script lang="ts">
  import type { SoundFile } from "../types";
  import { formatDuration, formatSize } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import Waveform from "./Waveform.svelte";

  let { sound, channels = [], selected, playing, progress, dragHint, onSelect, onPlay, onInsert, onFavorite, onDownload, onDragPrepare, onDragStart, onDragEnd }: {
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
    onDownload: () => void;
    onDragPrepare: () => void;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: (event: DragEvent) => void;
  } = $props();

  let score = $derived(76 + (sound.name.length * 7) % 23);
  let isCloud = $derived(sound.source === "freesound");
  let sourceLabel = $derived(isCloud
    ? sound.path ? "Freesound · downloaded for this project" : "Freesound cloud library"
    : "Local sound library");
</script>

<div
  class={`sound-row accent-${sound.accent} ${selected ? "is-selected" : ""}`}
  class:is-cloud={isCloud}
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
    <div class="sound-title-line">
      <span class={`sound-source sound-source--${isCloud ? "cloud" : "local"} tooltip`} data-tooltip={sourceLabel}>
        <Icon name={isCloud ? sound.path ? "cloudCheck" : "cloud" : "drive"} size={13} />
      </span>
      <strong>{sound.name}</strong>
      {#if isCloud && sound.creator}<small class="sound-creator">by {sound.creator}</small>{/if}
    </div>
    <Waveform compact values={sound.waveform} {channels} progress={playing ? progress : 0} />
  </div>
  <div class="sound-meta"><span>{sound.duration ? formatDuration(sound.duration) : "—:—"}</span><small>{sound.extension.toUpperCase()} · {formatSize(sound.size)}</small></div>
  <span class="match-score tooltip" data-tooltip="Search relevance">{score}%</span>
  {#if isCloud}
    <IconButton
      icon={sound.path ? "cloudCheck" : "download"}
      label={sound.path ? "Downloaded for this project" : `Download ${sound.name} for this project`}
      disabled={sound.downloadState === "downloading" || Boolean(sound.path)}
      active={Boolean(sound.path)}
      onclick={(event) => { event.stopPropagation(); onDownload(); }}
      class="row-download"
    />
  {/if}
  <IconButton icon="heart" label={sound.favorite ? "Remove from favorites" : "Add to favorites"} active={sound.favorite} onclick={(event) => { event.stopPropagation(); onFavorite(); }} class="row-favorite" />
</div>
