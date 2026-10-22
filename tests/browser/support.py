"""Shared real-browser setup; run with unittest discovery from the repository root."""

import functools
import json
import os
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[2]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class BrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT))
        )
        cls.addClassCleanup(server.server_close)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cls.addClassCleanup(thread.join)
        cls.addClassCleanup(server.shutdown)
        cls.url = f"http://127.0.0.1:{server.server_port}"
        playwright = sync_playwright().start()
        cls.addClassCleanup(playwright.stop)
        downloads = ROOT / ".work" / "browser-downloads"
        downloads.mkdir(parents=True, exist_ok=True)
        cls.browser = playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_EXECUTABLE"),
            downloads_path=str(downloads),
            args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
        )
        cls.addClassCleanup(cls.browser.close)

    def setUp(self):
        self.context = self.browser.new_context(locale="en-US", viewport={"width": 1440, "height": 1000})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.page.set_default_timeout(15000)
        self.page_errors = []
        self.page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        self.page.goto(self.url)
        self.ready()

    def tearDown(self):
        self.assertEqual(self.page_errors, [], "Uncaught application errors")

    def ready(self):
        expect(self.page.locator("#loading")).to_have_count(0, timeout=30000)
        expect(self.page.locator("#tools button").first).to_be_visible()
        expect(self.page.locator("#view")).to_have_attribute("aria-busy", "false", timeout=60000)

    def import_design(self, features, **metadata):
        """Upload through Open; the caller waits for the expected accepted/rejected result."""
        payload = {"app": "cad-teacher", "version": 1, "features": features, **metadata}
        self.page.locator("#open-file").set_input_files(
            {"name": "test.cadteacher.json", "mimeType": "application/json", "buffer": json.dumps(payload).encode()}
        )
