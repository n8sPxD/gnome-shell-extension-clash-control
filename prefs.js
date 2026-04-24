import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

export default class GnomeClashControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('GNOME Clash Control'),
        });
        window.add(page);

        // Clash API 设置组
        const apiGroup = new Adw.PreferencesGroup({
            title: _('Clash API Settings'),
        });
        page.add(apiGroup);

        // API Host
        const hostRow = new Adw.EntryRow({
            title: _('API Host'),
            text: settings.get_string('clash-host'),
        });
        hostRow.connect('changed', (row) => {
            settings.set_string('clash-host', row.text);
        });
        settings.connect('changed::clash-host', () => {
            if (hostRow.text !== settings.get_string('clash-host')) {
                hostRow.text = settings.get_string('clash-host');
            }
        });
        apiGroup.add(hostRow);

        // API Port
        const portRow = new Adw.SpinRow({
            title: _('API Port'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 65535,
                step_increment: 1,
                value: settings.get_int('clash-port'),
            }),
        });
        portRow.connect('changed', (row) => {
            settings.set_int('clash-port', row.value);
        });
        settings.connect('changed::clash-port', () => {
            if (portRow.value !== settings.get_int('clash-port')) {
                portRow.value = settings.get_int('clash-port');
            }
        });
        apiGroup.add(portRow);

        // API Secret
        const secretRow = new Adw.PasswordEntryRow({
            title: _('API Secret'),
            text: settings.get_string('clash-secret'),
        });
        secretRow.connect('changed', (row) => {
            settings.set_string('clash-secret', row.text);
        });
        settings.connect('changed::clash-secret', () => {
            if (secretRow.text !== settings.get_string('clash-secret')) {
                secretRow.text = settings.get_string('clash-secret');
            }
        });
        apiGroup.add(secretRow);

        // 代理端口设置组
        const proxyGroup = new Adw.PreferencesGroup({
            title: _('Proxy Ports'),
        });
        page.add(proxyGroup);

        // HTTP Proxy Port
        const httpPortRow = new Adw.SpinRow({
            title: _('HTTP/HTTPS Port'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 65535,
                step_increment: 1,
                value: settings.get_int('proxy-port-http'),
            }),
        });
        httpPortRow.connect('changed', (row) => {
            settings.set_int('proxy-port-http', row.value);
        });
        settings.connect('changed::proxy-port-http', () => {
            if (httpPortRow.value !== settings.get_int('proxy-port-http')) {
                httpPortRow.value = settings.get_int('proxy-port-http');
            }
        });
        proxyGroup.add(httpPortRow);

        // SOCKS Proxy Port
        const socksPortRow = new Adw.SpinRow({
            title: _('SOCKS5 Port'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 65535,
                step_increment: 1,
                value: settings.get_int('proxy-port-socks'),
            }),
        });
        socksPortRow.connect('changed', (row) => {
            settings.set_int('proxy-port-socks', row.value);
        });
        settings.connect('changed::proxy-port-socks', () => {
            if (socksPortRow.value !== settings.get_int('proxy-port-socks')) {
                socksPortRow.value = settings.get_int('proxy-port-socks');
            }
        });
        proxyGroup.add(socksPortRow);
    }
}
