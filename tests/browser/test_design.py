import json
from pathlib import Path

from playwright.sync_api import expect

from support import BrowserTest


class DesignWorkflowTests(BrowserTest):
    def test_import_extrude_reload_and_save_open(self):
        sketch = {
            "id": "s1", "type": "sketch", "plane": {"base": "XY"},
            "shapes": [{"kind": "rect", "x": 0, "y": 0, "w": 20, "h": 10}],
        }
        self.import_design([sketch])
        expect(self.page.locator("#chips .chip")).to_have_count(1)
        self.page.locator('[data-tool="extrude"]').click()
        self.page.locator('#dialog input[data-k="distance"]').fill("12")
        self.page.locator('#dialog [data-act="ok"]').click()
        expect(self.page.locator("#chips .chip")).to_have_count(2)
        expect(self.page.locator("#chips .err")).to_have_count(0)
        expect(self.page.locator('[data-tool="stl"]')).to_be_enabled()

        self.page.reload()
        self.ready()
        expect(self.page.locator("#chips .chip")).to_have_count(2)
        with self.page.expect_download() as saved:
            self.page.locator('[data-tool="save"]').click()
        payload = json.loads(Path(saved.value.path()).read_text())
        self.assertEqual(payload["features"][0], sketch)
        self.assertEqual(payload["features"][1]["distance"], 12)

        self.page.locator('[data-tool="new"]').click()
        expect(self.page.locator("#chips .chip")).to_have_count(0)
        self.page.locator("#open-file").set_input_files(saved.value.path())
        expect(self.page.locator("#chips .chip")).to_have_count(2)
        expect(self.page.locator('[data-tool="stl"]')).to_be_enabled()

    def test_lesson_and_language_controls(self):
        self.page.locator('[data-open="block"]').click()
        expect(self.page.locator('#learn input[data-act="goal"]')).to_be_checked()
        self.page.locator('#learn input[data-act="goal"]').uncheck()
        expect(self.page.locator('#learn input[data-act="goal"]')).not_to_be_checked()
        self.page.locator("#lang").select_option("fr")
        expect(self.page.locator("html")).to_have_attribute("lang", "fr")
        self.page.locator('#learn [data-act="back"]').click()
        expect(self.page.locator("#learn .course-card")).to_have_count(6)
