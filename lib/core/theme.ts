/**
 * CloudTAK panel / surface tokens.
 * Same chain as cloudtak-plugin-rubbersheet (AdjustBar / OpacityBar): host sets
 * --cloudtak-* for light and dark, so overlays inherit without copying computed styles.
 */
export const SURFACE_BG = 'var(--cloudtak-panel-bg, var(--cloudtak-surface-bg, var(--tblr-bg-surface, Canvas)))';
export const SURFACE_FG = 'var(--cloudtak-surface-color, var(--tblr-body-color, inherit))';
export const SURFACE_BORDER = 'var(--cloudtak-surface-border, var(--tblr-border-color, rgba(128, 128, 128, 0.3)))';
export const SURFACE_HOVER = 'var(--cloudtak-hover-bg, var(--cloudtak-active-bg, rgba(127, 127, 127, 0.12)))';
export const SURFACE_MUTED = 'var(--tblr-secondary-color, var(--tblr-secondary, inherit))';
