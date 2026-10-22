import json
import struct
from pathlib import Path

from playwright.sync_api import expect

from support import BrowserTest


BLOCK = [
    {"id": "s1", "type": "sketch", "plane": {"base": "XY"},
     "shapes": [{"kind": "rect", "x": 0, "y": 0, "w": 20, "h": 10}]},
    {"id": "e1", "type": "extrude", "sketch": "s1", "distance": 12, "op": "join"},
]


class PrintOrientationTests(BrowserTest):
    def assert_work(self, features, down):
        self.page.wait_for_function(
            "([features, down]) => { const work = JSON.parse(localStorage.getItem('cad-teacher-work:free')); "
            "return JSON.stringify(work.features) === JSON.stringify(features) && "
            "JSON.stringify(work.printDown) === JSON.stringify(down); }",
            arg=[features, down],
        )

    def download(self, kind, name):
        path = Path(__file__).resolve().parents[2] / ".work/browser-print" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.page.expect_download() as download:
            self.page.locator(f'[data-tool="{kind}"]').click()
        download.value.save_as(path)
        return path

    def stl_bounds(self, path):
        data = path.read_bytes()
        count, = struct.unpack_from("<I", data, 80)
        self.assertEqual(len(data), 84 + 50 * count)
        points = [struct.unpack_from("<3f", data, 84 + 50 * i + 12 + 12 * j)
                  for i in range(count) for j in range(3)]
        return [[min(p[k] for p in points) for k in range(3)],
                [max(p[k] for p in points) for k in range(3)]]

    def test_save_open_new_legacy_and_undo_preserve_print_placement(self):
        self.import_design(BLOCK)
        self.assert_work(BLOCK, None)
        self.page.locator('[data-tool="print"]').click()
        self.page.locator('#view-cube [data-direction="0,-1,0"]').click()
        canvas = self.page.locator("#view > canvas")
        box = canvas.bounding_box()
        canvas.click(position={"x": box["width"] / 2, "y": box["height"] / 2})
        down = [0, -1, 0]
        self.assert_work(BLOCK, down)
        saved = self.download("save", "oriented.cadteacher.json")
        self.assertEqual(json.loads(saved.read_text())["printDown"], down)
        original = self.stl_bounds(self.download("stl", "before.stl"))
        for actual, expected in zip(sum(original, []), [-10, -6, 0, 10, 6, 10]):
            self.assertAlmostEqual(actual, expected, places=5)

        self.page.locator('[data-tool="new"]').click()
        self.assert_work([], None)
        self.page.locator('[data-tool="undo"]').click()
        self.assert_work(BLOCK, down)
        self.page.locator('[data-tool="new"]').click()
        self.page.locator("#open-file").set_input_files(saved)
        self.assert_work(BLOCK, down)
        reopened = self.stl_bounds(self.download("stl", "after.stl"))
        self.assertEqual(reopened, original)

        self.import_design(BLOCK[:1])  # A legacy design has no orientation field.
        self.assert_work(BLOCK[:1], None)
        self.page.locator('[data-tool="undo"]').click()
        self.assert_work(BLOCK, down)

    def test_orientation_validation_preserves_existing_work(self):
        for down in [[0, -2, 0], [0, -1e308, 0], [0, -5e-324, 0]]:
            self.import_design(BLOCK, printDown=down)
            self.assert_work(BLOCK, [0, -1, 0])
        for down in [[0, 0, 0], [], [1, 0], [1, 0, 0, 0], "front", {},
                     ["1", 0, 0], [True, 0, 0], [None, 0, 0], [float("inf"), 0, 0]]:
            with self.subTest(down=down):
                self.page.locator("#hint").evaluate("el => el.textContent = ''")
                payload = json.dumps({"app": "cad-teacher", "features": [], "printDown": down})
                self.page.locator("#open-file").set_input_files({
                    "name": "invalid.cadteacher.json", "mimeType": "application/json",
                    # Overflowing JSON numbers parse as Infinity in JavaScript.
                    "buffer": payload.replace("Infinity", "1e309").encode(),
                })
                expect(self.page.locator("#hint")).to_have_text("This file is not a CAD Teacher design.")
                self.assert_work(BLOCK, [0, -1, 0])
        # Invalid orientation must also be rejected before leaving a lesson.
        self.page.locator('[data-open="block"]').click()
        self.import_design([], printDown=[0, 0, 0])
        expect(self.page.locator('#learn [data-act="back"]')).to_be_visible()
        self.assert_work(BLOCK, [0, -1, 0])

    def test_joint_undo_still_restores_the_joint_list(self):
        joint = {"id": "j1", "type": "revolute", "angle": 20,
                 "moving": {"comp": "link", "rim": {"c": [-24, 0, 4], "n": [0, 0, 1]}},
                 "fixed": {"comp": "base", "rim": {"c": [4, 0, 5], "n": [0, 0, 1]}}}
        self.page.evaluate(
            "joint => localStorage.setItem('cad-teacher-work:robot-joint', JSON.stringify({joints: [joint]}))",
            joint,
        )
        self.page.locator('[data-course="robot"] > summary').click()
        self.page.locator('[data-open="robot-joint"]').click()
        expect(self.page.locator("#chips .chip")).to_have_count(1)
        self.page.locator("#chips .chip").click()
        self.page.locator('#dialog [data-act="delete"]').click()
        expect(self.page.locator("#chips .chip")).to_have_count(0)
        self.page.locator('[data-tool="undo"]').click()
        expect(self.page.locator("#chips .chip")).to_have_count(1)
        self.assertEqual(self.page.evaluate(
            "JSON.parse(localStorage.getItem('cad-teacher-work:robot-joint')).joints"
        ), [joint])
