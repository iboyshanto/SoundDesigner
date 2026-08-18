<script lang="ts">
  export type IconName =
    | "activity" | "add" | "back" | "chevron" | "close" | "collapse" | "download"
    | "drag" | "folder" | "forward" | "heart" | "library" | "list" | "loop"
    | "minus" | "more" | "next" | "pause" | "play" | "previous" | "refresh"
    | "reverse" | "search" | "settings" | "sliders" | "sparkles" | "stop"
    | "trash" | "volume" | "waveform" | "zoomIn" | "zoomOut";

  let { name, size = 16 }: { name: IconName; size?: number } = $props();

  const paths: Record<IconName, string> = {
    activity: '<path d="M3 12h3l2.2-6 3.2 12L14 9l2 3h5" />',
    add: '<path d="M12 5v14M5 12h14" />',
    back: '<path d="m15 18-6-6 6-6" />',
    chevron: '<path d="m8 10 4 4 4-4" />',
    close: '<path d="m7 7 10 10M17 7 7 17" />',
    collapse: '<path d="m9 18-6-6 6-6M15 6l6 6-6 6" />',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />',
    drag: '<path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />',
    folder: '<path d="M3 7.5h7l2-2h9v13H3z" />',
    forward: '<path d="m9 18 6-6-6-6" />',
    heart: '<path d="M20.2 5.8a5.5 5.5 0 0 0-7.8 0L12 6.2l-.4-.4a5.5 5.5 0 0 0-7.8 7.8L12 21l8.2-7.4a5.5 5.5 0 0 0 0-7.8Z" />',
    library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l4-1 2 14-4 1z" />',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />',
    loop: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3" />',
    minus: '<path d="M5 12h14" />',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01" />',
    next: '<path d="m6 5 10 7L6 19zM18 5v14" />',
    pause: '<path d="M8 5v14M16 5v14" />',
    play: '<path d="m8 5 11 7-11 7z" />',
    previous: '<path d="m18 5-10 7 10 7zM6 5v14" />',
    refresh: '<path d="M20 7h-5V2M4 17h5v5M19 11a7 7 0 0 0-12-5l-2 2M5 13a7 7 0 0 0 12 5l2-2" />',
    reverse: '<path d="m11 6-8 6 8 6V6Zm10 0-8 6 8 6V6Z" />',
    search: '<circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />',
    settings: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />',
    sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4" />',
    sparkles: '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7zM5 14l.7 2.3L8 17l-2.3.7L5 20l-.7-2.3L2 17l2.3-.7z" />',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1" />',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />',
    volume: '<path d="M5 10v4h4l5 4V6L9 10zM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" />',
    waveform: '<path d="M3 12h2l1.5-5L9 17l2-12 2.5 14L16 8l2 4h3" />',
    zoomIn: '<circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6" />',
    zoomOut: '<circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M7.5 10.5h6" />',
  };
</script>

<svg aria-hidden="true" class="icon-svg" fill="none" height={size} viewBox="0 0 24 24" width={size}>
  <g stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
    {@html paths[name]}
  </g>
</svg>
