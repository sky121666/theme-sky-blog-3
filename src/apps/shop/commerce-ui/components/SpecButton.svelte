<script>
import { onDestroy } from 'svelte';
import { getThumbnailUrl } from '../utils/thumbnail';
import { searchIcon as MingcuteSearch3Line, closeIcon } from '../icons.js';
import i18n, { getLocale } from '../i18n';
let { isSelected, isAvailable, imageUrl, value, onclick } = $props();
let zoomDialog = $state();
let previewOpen = $state(false);
const closeLabel = { en: 'Close preview', es: 'Cerrar vista previa', 'zh-CN': '关闭大图', 'zh-TW': '關閉大圖' }[getLocale()];
function handleZoomClick(event) {
  event.stopPropagation();
  if (!imageUrl || !zoomDialog || zoomDialog.open) return;
  previewOpen = true;
  zoomDialog.showModal();
}
function closePreview() {
  zoomDialog?.close();
  previewOpen = false;
}
onDestroy(() => zoomDialog?.close());
</script>

<button
  class="buy-box__spec-option"
  class:buy-box__spec-option--selected={isSelected}
  class:buy-box__spec-option--disabled={!isAvailable}
  class:buy-box__spec-option--with-image={imageUrl}
  disabled={!isAvailable}
  {onclick}
>
  {#if imageUrl}
    <img
      src={getThumbnailUrl(imageUrl, 'S')}
      data-zoom-src={imageUrl}
      alt={value}
      class="buy-box__spec-option-image"
    />
    <div
      role="button"
      tabindex="0"
      class="buy-box__spec-option-zoom"
      aria-label={$i18n.t('common.viewLargeImage')}
      onclick={handleZoomClick}
      onkeydown={(e) => e.key === 'Enter' && handleZoomClick(e)}
    >
      {@html MingcuteSearch3Line}
    </div>
  {/if}
  <span class="buy-box__spec-option-text">{value}</span>
</button>


<dialog bind:this={zoomDialog} class="shop-spec-preview" aria-label={$i18n.t('common.viewLargeImage')} onclose={() => previewOpen = false}>
  <button type="button" class="shop-spec-preview__close" aria-label={closeLabel} onclick={closePreview}>
    {@html closeIcon}
  </button>
  {#if previewOpen && imageUrl}
    <img src={imageUrl} alt={value ?? ''} class="shop-spec-preview__image" />
  {/if}
</dialog>

<style>
  .shop-spec-preview {
    width: fit-content;
    max-width: min(90vw, 960px);
    max-height: 90vh;
    padding: 40px 16px 16px;
    border: 1px solid var(--shop-gray-200, #e5e7eb);
    border-radius: var(--shop-border-radius, 8px);
    background: var(--shop-color-base-100, #fff);
    color: var(--shop-color-base-content, #171717);
  }
  .shop-spec-preview::backdrop { background: rgb(0 0 0 / 55%); }
  .shop-spec-preview__close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: var(--shop-color-base-200, #fafafa);
    color: inherit;
    cursor: pointer;
  }
  .shop-spec-preview__image {
    display: block;
    max-width: 100%;
    max-height: calc(90vh - 56px);
    object-fit: contain;
  }
</style>
