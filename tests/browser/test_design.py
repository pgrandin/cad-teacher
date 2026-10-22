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

    def test_correct_goal_completes_and_saves_the_lesson(self):
        steps = self.page.evaluate("""async () => {
            const { LESSONS } = await import('./lessons.js');
            const lesson = LESSONS.find(l => l.id === 'hole');
            localStorage.setItem('cad-teacher-work:hole', JSON.stringify({
                features: lesson.goal, step: lesson.steps.length - 1, lessonVersion: lesson.version
            }));
            return lesson.steps.length;
        }""")
        self.page.locator('[data-open="hole"]').click()
        expect(self.page.locator("#learn .win")).to_be_visible()
        self.assertIn("hole", self.page.evaluate("JSON.parse(localStorage.getItem('cad-teacher-done'))"))
        self.page.wait_for_function(
            "steps => JSON.parse(localStorage.getItem('cad-teacher-work:hole')).step === steps", arg=steps
        )
        self.page.locator('#learn [data-act="diff"]').check()
        expect(self.page.locator("#learn")).to_contain_text("No differences")
        self.page.reload()
        self.ready()
        self.page.locator('[data-open="hole"]').click()
        expect(self.page.locator("#learn .win")).to_be_visible()
