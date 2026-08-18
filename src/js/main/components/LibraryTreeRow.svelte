<script lang="ts">
  import type { LibraryTreeNode } from "../types";
  import { treeMatchesQuery } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import LibraryTreeRow from "./LibraryTreeRow.svelte";

  let {
    node,
    depth,
    selectedId,
    expandedIds,
    filterQuery,
    meta,
    onSelect,
    onToggle,
    onEdit,
  }: {
    node: LibraryTreeNode;
    depth: number;
    selectedId: string;
    expandedIds: Set<string>;
    filterQuery: string;
    meta?: string;
    onSelect: (nodeId: string) => void;
    onToggle: (nodeId: string) => void;
    onEdit?: () => void;
  } = $props();

  let visibleChildren = $derived(node.children.filter((child) => treeMatchesQuery(child, filterQuery)));
  let hasChildren = $derived(visibleChildren.length > 0);
  let expanded = $derived(filterQuery.length > 0 || expandedIds.has(node.id));
</script>

<div class="library-tree-branch">
  <div class:is-selected={selectedId === node.id} class="library-tree-row" style:padding-inline-start={`${4 + depth * 13}px`}>
    <button
      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
      class:is-expanded={expanded}
      class="tree-expander"
      disabled={!hasChildren}
      onclick={() => onToggle(node.id)}
      type="button"
    ><Icon name="chevron" size={12} /></button>
    <button class="library-tree-select" onclick={() => onSelect(node.id)} type="button">
      <span class="library-icon"><Icon name="folder" size={14} /></span>
      <span class="library-copy">
        <strong>{node.name}</strong>
        <small>{meta || (node.children.length ? `${node.children.length} folders` : `${node.directFileCount} sounds`)}</small>
      </span>
      <span class="count-badge">{node.totalFileCount}</span>
    </button>
    {#if onEdit}<IconButton icon="more" label={`Edit ${node.name}`} onclick={onEdit} class="library-more" />{/if}
  </div>
  {#if hasChildren && expanded}
    <div class="library-tree-children">
      {#each visibleChildren as child (child.id)}
        <LibraryTreeRow
          node={child}
          depth={depth + 1}
          {selectedId}
          {expandedIds}
          {filterQuery}
          {onSelect}
          {onToggle}
        />
      {/each}
    </div>
  {/if}
</div>
