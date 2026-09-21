/** CloudTAK floating sidebar / panel surface (see CloudTAK api/web/src/style.scss). */
export const SURFACE_BG = 'var(--livewx-bg, var(--cloudtak-surface-bg, var(--cloudtak-panel-bg, var(--tblr-bg-surface, Canvas))))';
export const SURFACE_FG = 'var(--livewx-fg, var(--cloudtak-surface-color, var(--tblr-body-color, inherit)))';
export const SURFACE_BORDER = 'var(--livewx-border, var(--cloudtak-surface-border, var(--tblr-border-color, rgba(127, 127, 127, 0.35))))';
export const SURFACE_HOVER = 'var(--cloudtak-hover-bg, var(--cloudtak-active-bg, rgba(127, 127, 127, 0.12)))';

const SIDEBAR_SELECTOR = [
    '.main-menu-surface',
    '.cloudtak-panel',
    'aside.navbar-vertical',
    '.navbar-vertical',
].join(', ');

/** Copy the live sidebar fill onto :root so popups (outside the sidebar) match. */
export function syncSidebarTheme(): void {
    const nodes = document.querySelectorAll(SIDEBAR_SELECTOR);
    for (const src of nodes) {
        if (!(src instanceof HTMLElement)) continue;
        if (src.classList.contains('livewx-shell')) continue;
        const cs = getComputedStyle(src);
        if (!cs.backgroundColor || cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') {
            continue;
        }
        const root = document.documentElement.style;
        root.setProperty('--livewx-bg', cs.backgroundColor);
        if (cs.color) root.setProperty('--livewx-fg', cs.color);
        const token = cs.getPropertyValue('--cloudtak-surface-border').trim()
            || cs.getPropertyValue('--tblr-border-color').trim();
        const border = token || (cs.borderTopColor !== 'rgba(0, 0, 0, 0)' ? cs.borderTopColor : '');
        if (border) root.setProperty('--livewx-border', border);
        return;
    }
}
