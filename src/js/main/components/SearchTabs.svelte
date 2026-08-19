<script lang="ts">
  import type { SearchTab } from "../types";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  let { tabs, activeId, onActivate, onAdd, onClose }: {
    tabs: SearchTab[];
    activeId: string;
    onActivate: (id: string) => void;
    onAdd: () => void;
    onClose: (id: string) => void;
  } = $props();
</script>

<div class="search-tabs" role="tablist" aria-label="Sound searches">
  <div class="search-tabs__scroller">
    {#each tabs as tab (tab.id)}
      <div class:has-close={tabs.length > 1} class:is-active={tab.id === activeId} class="search-tab-wrap">
        <button aria-selected={tab.id === activeId} class:is-active={tab.id === activeId} class="search-tab" onclick={() => onActivate(tab.id)} role="tab" type="button">
          <Icon name="search" size={13} />
          <span>{tab.label || "New search"}</span>
        </button>
        {#if tabs.length > 1}
          <button
            aria-label={`Close ${tab.label} search`}
            class="tab-close tooltip"
            data-tooltip="Close search"
            onclick={(event) => { event.stopPropagation(); onClose(tab.id); }}
            type="button"
          ><Icon name="close" size={12} /></button>
        {/if}
      </div>
    {/each}
  </div>
  <IconButton icon="add" label="Open a new search tab" onclick={onAdd} class="new-tab-button" />
</div>
