import threading

import pystray
from PIL import Image

from generate_icon import generate_icon
from i18n import t
import database


class TrayApp:
    def __init__(self, callbacks: dict):
        """
        callbacks dict keys:
            on_open, on_pause, on_quit, on_water
        """
        self.callbacks = callbacks
        self._icon: pystray.Icon | None = None
        self._paused = False

    def _create_menu(self):
        return pystray.Menu(
            pystray.MenuItem(t("tray.open"), self._on_open, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(t("tray.log_water"), self._on_water),
            pystray.MenuItem(
                lambda item: t("tray.resume") if self._paused else t("tray.pause"),
                self._on_pause,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(t("tray.quit"), self._on_quit),
        )

    def _on_open(self, icon, item):
        cb = self.callbacks.get("on_open")
        if cb:
            cb()

    def _on_water(self, icon, item):
        database.log_water(1)
        total = database.get_water_today()
        self._icon.notify(t("tray.water_logged", total=total), t("tray.water_title"))
        cb = self.callbacks.get("on_water")
        if cb:
            cb()

    def _on_pause(self, icon, item):
        self._paused = not self._paused
        cb = self.callbacks.get("on_pause")
        if cb:
            cb(self._paused)

    def _on_quit(self, icon, item):
        cb = self.callbacks.get("on_quit")
        if cb:
            cb()
        self._icon.stop()

    @property
    def paused(self):
        return self._paused

    def run(self):
        icon_path = generate_icon()
        image = Image.open(icon_path)
        self._icon = pystray.Icon(
            "HealthDesk",
            image,
            t("tray.tooltip"),
            menu=self._create_menu(),
        )
        self._icon.run()

    def stop(self):
        if self._icon:
            self._icon.stop()

    def notify(self, message: str, title: str = "HealthDesk"):
        if self._icon:
            self._icon.notify(message, title)
