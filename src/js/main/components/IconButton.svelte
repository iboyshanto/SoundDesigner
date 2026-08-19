<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";

  let {
    icon,
    label,
    onclick,
    active = false,
    pressed,
    disabled = false,
    class: className = "",
    type = "button",
  }: {
    icon: IconName;
    label: string;
    onclick?: (event: MouseEvent) => void;
    active?: boolean;
    pressed?: boolean;
    disabled?: boolean;
    class?: string;
    type?: "button" | "submit";
  } = $props();
</script>

<button
  aria-label={label}
  aria-pressed={pressed}
  class={`icon-button tooltip ${active ? "is-active" : ""} ${className}`}
  data-tooltip={label}
  {disabled}
  {onclick}
  {type}
>
  <Icon name={icon} />
</button>
