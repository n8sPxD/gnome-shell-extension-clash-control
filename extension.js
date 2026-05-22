import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import Clutter from 'gi://Clutter';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

const EXTENSION_UUID = 'gnome-clash-control@n8spxd';
const API_TIMEOUT = 5;

const PROXY_MODES = ['rule', 'global', 'direct'];

function _modeLabel(mode) {
    return ({
        rule: _('Rule Mode'),
        global: _('Global Mode'),
        direct: _('Direct Mode'),
    })[mode];
}

function _isCancelledError(error) {
    return error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

function _apiCall(session, method, url, headers, body = null, cancellable = null) {
    const message = Soup.Message.new(method, url);
    for (const [key, value] of Object.entries(headers))
        message.request_headers.append(key, value);
    if (body)
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));

    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, result) => {
            try {
                const bytes = s.send_and_read_finish(result);
                const status = message.get_status();
                if (status < 200 || status >= 300)
                    reject(new Error(`HTTP ${status}`));
                else
                    resolve(bytes);
            } catch (e) {
                reject(e);
            }
        });
    });
}

class SignalBag {
    constructor() {
        this._items = [];
    }

    add(object, id) {
        this._items.push([object, id]);
        return id;
    }

    destroy() {
        for (const [object, id] of this._items.splice(0)) {
            try {
                object.disconnect(id);
            } catch (e) {
                logError(e);
            }
        }
    }
}

const ProxySwitchMenuItem = GObject.registerClass({
    GTypeName: 'ProxySwitchMenuItem',
}, class ProxySwitchMenuItem extends PopupMenu.PopupSwitchMenuItem {
    _init(text, active) {
        super._init(text, active);
        this.connect('button-press-event', () => {
            this.toggle();
            this.emit('toggled', this.state);
            return Clutter.EVENT_STOP;
        });
    }
});

const ClashToggle = GObject.registerClass({
    GTypeName: 'GnomeClashControlToggle',
}, class ClashToggle extends QuickSettings.QuickMenuToggle {
    _init(settings, session, proxySettings) {
        super._init({
            title: 'Clash',
            iconName: 'preferences-system-network-proxy-symbolic',
            toggleMode: false,
        });

        this._settings = settings;
        this._session = session;
        this._proxySettings = proxySettings;
        this._destroyed = false;
        this._signals = new SignalBag();
        this._cancellable = new Gio.Cancellable();
        this.set({ enabled: false });
        this._connected = false;
        this._currentMode = 'rule';

        this.menu.setHeader('preferences-system-network-proxy-symbolic', _('Clash Control'), _('Connecting...'));

        // System Proxy
        this._proxyItem = new ProxySwitchMenuItem(_('System Proxy'), false);
        this._signals.add(
            this._proxyItem,
            this._proxyItem.connect('toggled', (_, state) => this._setSystemProxy(state)),
        );
        this.menu.addMenuItem(this._proxyItem);

        // TUN Mode
        this._tunItem = new ProxySwitchMenuItem(_('TUN Mode'), false);
        this._signals.add(
            this._tunItem,
            this._tunItem.connect('toggled', (_, state) => this._setTunMode(state)),
        );
        this.menu.addMenuItem(this._tunItem);

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Proxy mode items
        this._modeItems = {};
        for (const mode of PROXY_MODES) {
            const item = new PopupMenu.PopupMenuItem(_modeLabel(mode));
            this._signals.add(
                item,
                item.connect('activate', () => this._setProxyMode(mode)),
            );
            item.setOrnament(mode === 'rule' ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            this.menu.addMenuItem(item);
            this._modeItems[mode] = item;
        }

        // Separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings
        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        this._signals.add(
            settingsItem,
            settingsItem.connect('activate', () => this._openSettings()),
        );
        this.menu.addMenuItem(settingsItem);

        // Listen for system proxy changes from outside
        this._signals.add(this._proxySettings.main, this._proxySettings.main.connect('changed::mode', () => {
            if (this._destroyed)
                return;

            const mode = this._proxySettings.main.get_string('mode');
            this._proxyItem.setToggleState(mode === 'manual');
        }));

        // Refresh state when menu opens
        this._signals.add(
            this.menu,
            this.menu.connect('open-state-changed', (_, isOpen) => {
                if (!this._destroyed && isOpen)
                    this._refreshState();
            }),
        );

        this._refreshState();
    }

    _getApiUrl(path) {
        const host = this._settings.get_string('clash-host');
        const port = this._settings.get_int('clash-port');
        return `http://${host}:${port}${path}`;
    }

    _getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const secret = this._settings.get_string('clash-secret');
        if (secret) headers['Authorization'] = `Bearer ${secret}`;
        return headers;
    }

    async _apiCall(method, path, body = null) {
        if (this._destroyed || !this._session || !this._cancellable)
            return null;

        const bytes = await _apiCall(
            this._session,
            method,
            this._getApiUrl(path),
            this._getHeaders(),
            body,
            this._cancellable,
        );

        if (this._destroyed)
            return null;

        return bytes;
    }

    _setConnected(connected) {
        if (this._destroyed)
            return;

        this._connected = connected;
        this.checked = connected;
        this.set({ enabled: true });

        const subtitle = connected ? _('Connected') : _('Disconnected');
        this.menu.setHeader('preferences-system-network-proxy-symbolic', _('Clash Control'), subtitle);

        this._tunItem.sensitive = connected;
        for (const item of Object.values(this._modeItems))
            item.sensitive = connected;

        if (connected) {
            const mode = this._proxySettings.main.get_string('mode');
            this._proxyItem.setToggleState(mode === 'manual');
        }
    }

    async _refreshState() {
        try {
            const bytes = await this._apiCall('GET', '/configs');
            if (!bytes || this._destroyed)
                return;

            const config = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            this._setConnected(true);
            this._tunItem.setToggleState(config.tun?.enable ?? false);
            this._updateModeUI(config.mode ?? 'rule');
        } catch (e) {
            if (this._destroyed || _isCancelledError(e))
                return;

            log(`[GNOME Clash Control] Failed to fetch state: ${e.message}`);
            this._setConnected(false);
        }
    }

    _updateModeUI(activeMode) {
        if (this._destroyed)
            return;

        this._currentMode = activeMode;
        for (const [mode, item] of Object.entries(this._modeItems)) {
            item.setOrnament(
                mode === activeMode
                    ? PopupMenu.Ornament.DOT
                    : PopupMenu.Ornament.NONE,
            );
        }
    }

    _setSystemProxy(enable) {
        if (this._destroyed)
            return;

        const { main, http, https, socks } = this._proxySettings;
        if (enable) {
            const host = this._settings.get_string('clash-host');
            const httpPort = this._settings.get_int('proxy-port-http');
            const socksPort = this._settings.get_int('proxy-port-socks');

            http.set_string('host', host);
            http.set_int('port', httpPort);
            https.set_string('host', host);
            https.set_int('port', httpPort);
            socks.set_string('host', host);
            socks.set_int('port', socksPort);
            main.set_string('mode', 'manual');
        } else {
            main.set_string('mode', 'none');
        }
    }

    async _setTunMode(enable) {
        if (this._destroyed)
            return;

        try {
            const bytes = await this._apiCall('PATCH', '/configs', JSON.stringify({ tun: { enable } }));
            if (!bytes || this._destroyed)
                return;

            this._refreshState();
        } catch (e) {
            if (this._destroyed || _isCancelledError(e))
                return;

            log(`[GNOME Clash Control] Failed to toggle TUN: ${e.message}`);
            this._tunItem.setToggleState(!enable);
        }
    }

    async _setProxyMode(mode) {
        if (this._destroyed)
            return;

        if (mode === this._currentMode) return;
        const prevMode = this._currentMode;

        try {
            const bytes = await this._apiCall('PATCH', '/configs', JSON.stringify({ mode }));
            if (!bytes || this._destroyed)
                return;

            this._refreshState();
        } catch (e) {
            if (this._destroyed || _isCancelledError(e))
                return;

            log(`[GNOME Clash Control] Failed to set mode: ${e.message}`);
            this._updateModeUI(prevMode);
        }
    }

    _openSettings() {
        if (this._destroyed)
            return;

        this.menu.close();
        Main.panel.statusArea.quickSettings.menu.close();
        Util.spawn(['gnome-extensions', 'prefs', EXTENSION_UUID]);
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;
        this._cancellable?.cancel();
        this._signals?.destroy();
        this._settings = null;
        this._proxySettings = null;
        this._session = null;
        this._cancellable = null;
        this._signals = null;
        super.destroy();
    }
});

const ClashIndicator = GObject.registerClass({
    GTypeName: 'GnomeClashControlIndicator',
}, class ClashIndicator extends QuickSettings.SystemIndicator {
    _init(settings, session, proxySettings) {
        super._init();
        this._toggle = new ClashToggle(settings, session, proxySettings);
        this.quickSettingsItems.push(this._toggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this);
    }

    destroy() {
        this._toggle?.destroy();
        this._toggle = null;
        this.quickSettingsItems = [];
        super.destroy();
    }
});

export default class GnomeClashControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._session = new Soup.Session({ timeout: API_TIMEOUT });
        this._proxySettings = {
            main: new Gio.Settings({ schema_id: 'org.gnome.system.proxy' }),
            http: new Gio.Settings({ schema_id: 'org.gnome.system.proxy.http' }),
            https: new Gio.Settings({ schema_id: 'org.gnome.system.proxy.https' }),
            socks: new Gio.Settings({ schema_id: 'org.gnome.system.proxy.socks' }),
        };

        this._indicator = new ClashIndicator(
            this._settings,
            this._session,
            this._proxySettings,
        );
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;

        this._session?.abort();
        this._session = null;

        this._settings = null;
        this._proxySettings = null;
    }
}
