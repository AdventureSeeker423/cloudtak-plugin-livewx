import type { App } from 'vue';
import { h } from 'vue';
import type { PluginAPI, PluginInstance } from '@tak-ps/cloudtak';
import MenuTemplate from './lib/ui/MenuTemplate.vue';
import AppShell from './lib/ui/AppShell.vue';
import { IconLiveWx } from './lib/ui/icon.ts';
import { MENU_KEY, ROUTE_NAME } from './lib/core/constants.ts';
import { destroy, init } from './lib/plugin.ts';

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
                render: () => h(MenuTemplate, { name: 'LiveWX', back: false }, {
                    default: () => h(AppShell, { api: this.api }),
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
            label: 'LiveWX',
            route: ROUTE_NAME,
            tooltip: 'LiveWX Weather',
            description: 'Forecast, radar, NWS alerts, lightning, fire/hydro/marine layers',
            icon: IconLiveWx,
        });
    }

    async disable(): Promise<void> {
        destroy();
        try { this.api.menu.remove(MENU_KEY); } catch { /* ignore */ }
        // Intentionally NOT removing the route — see constructor note.
    }
}
