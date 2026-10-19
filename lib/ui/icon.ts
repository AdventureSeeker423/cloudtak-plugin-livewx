/*
 * LiveWX menu icon (radar dish).
 *
 * Inline SVG so fill/stroke="currentColor" resolves against the surrounding
 * text colour. CloudTAK's MenuItemCard renders menu icons as components, so:
 * - size maps to width and height
 * - color drives the CSS color, which currentColor then picks up
 * - stroke is accepted and ignored (an undeclared prop would fall through
 *   onto the root as stroke="1")
 */
import { defineComponent, h } from 'vue';

const VIEW_BOX = '0 0 64 64';

export const IconLiveWx = defineComponent({
    name: 'IconLiveWx',
    props: {
        size: { type: [Number, String], default: 32 },
        color: { type: String, default: 'currentColor' },
        stroke: { type: [Number, String], default: undefined },
    },
    setup(props) {
        return () => h('svg', {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: VIEW_BOX,
            width: props.size,
            height: props.size,
            fill: 'none',
            'aria-hidden': 'true',
            focusable: 'false',
            style: { color: props.color },
        }, [
            h('circle', {
                cx: 32,
                cy: 32,
                r: 28,
                stroke: 'currentColor',
                'stroke-width': 3,
                opacity: 0.35,
            }),
            h('circle', {
                cx: 32,
                cy: 32,
                r: 18,
                stroke: 'currentColor',
                'stroke-width': 3,
                opacity: 0.55,
            }),
            h('circle', {
                cx: 32,
                cy: 32,
                r: 8,
                stroke: 'currentColor',
                'stroke-width': 3,
            }),
            h('path', {
                d: 'M32 32 L54 18',
                stroke: 'currentColor',
                'stroke-width': 4,
                'stroke-linecap': 'round',
            }),
            h('circle', {
                cx: 32,
                cy: 32,
                r: 3.5,
                fill: 'currentColor',
            }),
        ]);
    },
});
