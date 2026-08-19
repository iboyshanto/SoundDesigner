<script lang="ts">
  import type { AudioSegmentSelection, SoundFile } from "../types";
  import { formatDuration, formatSize } from "../ui-utils";
  import { freesoundLicenseLabel } from "../freesound";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import ChannelWaveform from "./ChannelWaveform.svelte";

  let {
    sound, channels, channelsLoading, progress, zoom, reversed, selection, segmentPreparing, segmentReady,
    onSeek, onZoomIn, onZoomOut, onSelectionChange, onSegmentDragStart, onSegmentDragEnd,
  }: {
    sound: SoundFile | null;
    channels: Float32Array[];
    channelsLoading: boolean;
    progress: number;
    zoom: number;
    reversed: boolean;
    selection: AudioSegmentSelection | null;
    segmentPreparing: boolean;
    segmentReady: boolean;
    onSeek: (progress: number) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onSelectionChange: (selection: AudioSegmentSelection | null, commit: boolean) => void;
    onSegmentDragStart: (event: DragEvent) => void;
    onSegmentDragEnd: (event: DragEvent) => void;
  } = $props();

  const fallbackWaveform = new Float32Array([0]);
  const MIN_SEGMENT_SECONDS = 0.05;
  let rangeElement = $state<HTMLDivElement | null>(null);
  let pendingSelectionFrame = 0;
  let activeRangeCleanup: (() => void) | null = null;

  let duration = $derived(Math.max(0, sound?.duration || 0));
  let visibleDuration = $derived(duration > 0 ? duration / Math.max(1, zoom) : 0);
  let visibleSelection = $derived(selection && visibleDuration > 0
    ? {
      left: Math.max(0, Math.min(100, selection.start / visibleDuration * 100)),
      right: Math.max(0, Math.min(100, selection.end / visibleDuration * 100)),
    }
    : null);
  let selectionDuration = $derived(selection ? Math.max(0, selection.end - selection.start) : 0);

  const formatPreciseTime = (seconds: number) => {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds - minutes * 60;
    return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
  };

  const timeAtClientX = (clientX: number) => {
    if (!rangeElement || visibleDuration <= 0) return 0;
    const rect = rangeElement.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * visibleDuration;
  };

  const normalizeSelection = (start: number, end: number): AudioSegmentSelection => {
    const maximum = Math.max(MIN_SEGMENT_SECONDS, visibleDuration || duration || MIN_SEGMENT_SECONDS);
    const boundedStart = Math.max(0, Math.min(maximum - MIN_SEGMENT_SECONDS, Math.min(start, end)));
    const boundedEnd = Math.max(boundedStart + MIN_SEGMENT_SECONDS, Math.min(maximum, Math.max(start, end)));
    return { start: boundedStart, end: boundedEnd };
  };

  const queueSelection = (next: AudioSegmentSelection) => {
    if (pendingSelectionFrame) window.cancelAnimationFrame(pendingSelectionFrame);
    pendingSelectionFrame = window.requestAnimationFrame(() => {
      pendingSelectionFrame = 0;
      onSelectionChange(next, false);
    });
  };

  const startRangeInteraction = (event: MouseEvent) => {
    if (!sound || !duration || event.button !== 0) return;
    activeRangeCleanup?.();
    const target = event.target as HTMLElement;
    if (target.closest(".waveform-selection") && !target.closest(".range-handle")) return;
    const handleElement = target.closest<HTMLElement>(".range-handle");
    const handle = handleElement?.dataset.rangeHandle as "start" | "end" | undefined;
    const initial = selection;
    const anchor = timeAtClientX(event.clientX);
    const originX = event.clientX;
    let latest = initial;
    let moved = false;

    const move = (nextEvent: MouseEvent) => {
      if ((nextEvent.buttons & 1) === 0) return finish(nextEvent);
      nextEvent.preventDefault();
      const current = timeAtClientX(nextEvent.clientX);
      if (Math.abs(nextEvent.clientX - originX) >= 3) moved = true;
      if (handle && initial) {
        latest = handle === "start"
          ? normalizeSelection(Math.min(current, initial.end - MIN_SEGMENT_SECONDS), initial.end)
          : normalizeSelection(initial.start, Math.max(current, initial.start + MIN_SEGMENT_SECONDS));
      } else if (moved) {
        latest = normalizeSelection(anchor, current);
      }
      if (latest) queueSelection(latest);
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", finish, true);
      window.removeEventListener("blur", cancel, true);
      if (pendingSelectionFrame) {
        window.cancelAnimationFrame(pendingSelectionFrame);
        pendingSelectionFrame = 0;
      }
      if (activeRangeCleanup === cleanup) activeRangeCleanup = null;
    };

    const finish = (nextEvent: MouseEvent) => {
      cleanup();
      if (handle && latest) onSelectionChange(latest, true);
      else if (moved && latest) onSelectionChange(latest, true);
      else onSeek(duration > 0 ? timeAtClientX(nextEvent.clientX) / duration : 0);
    };

    const cancel = () => cleanup();

    event.preventDefault();
    handleElement?.focus();
    activeRangeCleanup = cleanup;
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", finish, true);
    window.addEventListener("blur", cancel, true);
  };

  const rangeInteraction = (node: HTMLDivElement, enabled: boolean) => {
    node.addEventListener("mousedown", startRangeInteraction);
    node.addEventListener("keydown", adjustWaveformFromKeyboard);
    node.tabIndex = enabled ? 0 : -1;
    return {
      update: (nextEnabled: boolean) => { node.tabIndex = nextEnabled ? 0 : -1; },
      destroy: () => {
        node.removeEventListener("mousedown", startRangeInteraction);
        node.removeEventListener("keydown", adjustWaveformFromKeyboard);
        activeRangeCleanup?.();
      },
    };
  };

  const adjustWaveformFromKeyboard = (event: KeyboardEvent) => {
    if (!sound || !duration) return;
    const currentTime = Math.max(0, Math.min(duration, progress * duration));
    const seekStep = event.shiftKey ? Math.max(0.5, duration / 20) : Math.max(0.05, duration / 100);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onSeek(Math.max(0, currentTime - seekStep) / duration);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onSeek(Math.min(duration, currentTime + seekStep) / duration);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!selection) {
      const segmentLength = Math.min(1, duration);
      const start = Math.max(0, Math.min(duration - segmentLength, currentTime));
      onSelectionChange({ start, end: start + segmentLength }, true);
    }
    window.requestAnimationFrame(() => rangeElement?.querySelector<HTMLElement>(".range-handle--start")?.focus());
  };

  const adjustHandle = (handle: "start" | "end", event: KeyboardEvent) => {
    if (!selection || !duration) return;
    const baseStep = Math.max(0.01, duration / 200);
    const step = event.shiftKey ? baseStep * 5 : baseStep;
    let nextValue = handle === "start" ? selection.start : selection.end;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextValue -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextValue += step;
    else if (event.key === "Home") nextValue = handle === "start" ? 0 : selection.start + MIN_SEGMENT_SECONDS;
    else if (event.key === "End") nextValue = handle === "start" ? selection.end - MIN_SEGMENT_SECONDS : duration;
    else return;
    event.preventDefault();
    const next = handle === "start"
      ? normalizeSelection(nextValue, selection.end)
      : normalizeSelection(selection.start, nextValue);
    onSelectionChange(next, true);
  };
</script>

<section class="preview-pane">
  <div class="preview-heading">
    <div><span class="eyebrow">Spectrum preview</span><strong>{sound ? sound.name : "Nothing selected"}</strong></div>
    <div class="preview-tools">
      {#if selection}
        <span aria-live="polite" class="segment-readout">{formatPreciseTime(selection.start)}–{formatPreciseTime(selection.end)}</span>
        <button class="segment-clear" onclick={() => onSelectionChange(null, true)} type="button">Clear</button>
      {/if}
      <span class="zoom-value">{zoom.toFixed(1)}×</span>
      <IconButton icon="zoomOut" label="Zoom waveform out" onclick={onZoomOut} disabled={zoom <= 1} />
      <IconButton icon="zoomIn" label="Zoom waveform in" onclick={onZoomIn} disabled={zoom >= 3} />
    </div>
  </div>
  <div class="hero-waveform">
    <span class="time-ruler"><i>0:00</i><i>{sound ? formatDuration(visibleDuration / 2) : "0:00"}</i><i>{sound ? formatDuration(visibleDuration) : "0:00"}</i></span>
    <div
      aria-label="Audio waveform. Arrow keys seek. Press Enter to create a one-second segment at the playhead, or drag to select a segment."
      class="channel-range-target"
      role="group"
      use:rangeInteraction={Boolean(sound)}
      bind:this={rangeElement}
    >
      {#if selection && visibleSelection && visibleSelection.right > visibleSelection.left}
        <div
          aria-label={`Selected audio segment, ${formatPreciseTime(selectionDuration)} long. Drag to Adobe to import.`}
          aria-roledescription="draggable audio segment"
          class:is-preparing={segmentPreparing}
          class:is-ready={segmentReady}
          class="waveform-selection"
          draggable="true"
          ondragstart={onSegmentDragStart}
          ondragend={onSegmentDragEnd}
          role="group"
          style:inset-inline-start={`${visibleSelection.left}%`}
          style:width={`${visibleSelection.right - visibleSelection.left}%`}
        >
          <span
            aria-label="Segment start"
            aria-valuemax={duration}
            aria-valuemin={0}
            aria-valuenow={selection.start}
            aria-valuetext={formatPreciseTime(selection.start)}
            aria-orientation="horizontal"
            class="range-handle range-handle--start"
            data-range-handle="start"
            onkeydown={(event) => adjustHandle("start", event)}
            role="slider"
            tabindex="0"
          ></span>
          <strong>{segmentPreparing ? "Preparing…" : formatPreciseTime(selectionDuration)}</strong>
          <span
            aria-label="Segment end"
            aria-valuemax={duration}
            aria-valuemin={0}
            aria-valuenow={selection.end}
            aria-valuetext={formatPreciseTime(selection.end)}
            aria-orientation="horizontal"
            class="range-handle range-handle--end"
            data-range-handle="end"
            onkeydown={(event) => adjustHandle("end", event)}
            role="slider"
            tabindex="0"
          ></span>
        </div>
      {/if}
    </div>
    {#key sound?.id || "empty"}
      <ChannelWaveform {channels} loading={channelsLoading} fallback={sound ? sound.waveform : fallbackWaveform} {progress} {zoom} {reversed} channelCountHint={sound?.channels || 0} showModeControls={Boolean(sound)} />
    {/key}
  </div>
  <div class="preview-aside">
    <div class="preview-detail-grid">
      <div><span>Format</span><strong>{sound ? sound.extension.toUpperCase() : "—"}</strong></div>
      <div><span>Size</span><strong>{sound ? formatSize(sound.size) : "—"}</strong></div>
      <div><span>Length</span><strong>{sound && sound.duration ? formatDuration(sound.duration) : "On load"}</strong></div>
      <div><span>Source</span><strong class="preview-source">{#if sound}<Icon name={sound.source === "freesound" ? "cloud" : "drive"} size={12} /> {sound.source === "freesound" ? "Freesound" : "Local"}{:else}—{/if}</strong></div>
    </div>
    {#if sound}
      <div class="tag-row">
        {#if sound.source === "freesound" && sound.license}<span class="tag-chip tag-chip--license">{freesoundLicenseLabel(sound.license)}</span>{/if}
        {#each sound.tags.slice(0, 5) as tag (tag)}<span class="tag-chip">{tag}</span>{/each}
      </div>
    {/if}
  </div>
</section>
