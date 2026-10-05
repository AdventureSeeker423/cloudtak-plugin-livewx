import type { App } from 'vue';
import { h } from 'vue';
import type { PluginAPI, PluginInstance } from '@tak-ps/cloudtak';
import MenuTemplate from './lib/MenuTemplate.vue';
import RadarContainer from './lib/RadarContainer.vue';
import IconRadarUrl from './lib/Radar.svg';
import { MENU_KEY, ROUTE_NAME } from './lib/constants.ts';
import { destroy, init } from './lib/radar.ts';

const IconRadar = {
    render: () => h('img', {
        src: IconRadarUrl,
        width: 32,
        height: 32,
        alt: 'LiveWX Radar',
    }),
};

export default class LiveWxRadar implements PluginInstance {
    api: PluginAPI;

    constructor(api: PluginAPI) {
        this.api = api;

        // Routes register once at install time and are never removed —
        // CloudTAK calls disable() before enable() on load, so removing
        // the route at disable() makes the subsequent menu.add fail.
        this.api.routes.add({
            path: 'plugin-livewx-radar',
            name: ROUTE_NAME,
            component: {
                render: () => h(MenuTemplate, { name: 'LiveWX Radar', back: false }, {
                    default: () => h(RadarContainer, { api: this.api }),
                }),
            },
        }, 'home-menu');
    }

    static async install(app: App, api: PluginAPI): Promise<LiveWxRadar> {
        void app;
        return new LiveWxRadar(api);
    }

    async enable(): Promise<void> {
        await init(this.api);

        this.api.menu.add({
            key: MENU_KEY,
            label: 'LiveWX Radar',
            route: ROUTE_NAME,
            tooltip: 'LiveWX Radar',
            description: 'NEXRAD overlay, NWS watches/warnings, and lightning',
            icon: IconRadar,
        });
    }

    async disable(): Promise<void> {
        destroy();
        try { this.api.menu.remove(MENU_KEY); } catch { /* ignore */ }
        // Intentionally NOT removing the route — see constructor note.
    }
}
