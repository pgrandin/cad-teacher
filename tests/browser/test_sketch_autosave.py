from playwright.sync_api import expect

from support import BrowserTest


class SketchAutosaveTests(BrowserTest):
    def work(self, design="free"):
        return self.page.evaluate("id => JSON.parse(localStorage.getItem('cad-teacher-work:' + id))", design)

    def start_sketch(self, plane="XY"):
        direction = "0,0,1" if plane == "XY" else "0,-1,0"
        self.page.locator(f'#view-cube [data-direction="{direction}"]').press("Enter")
        self.page.locator('[data-tool="sketch"]').click()
        canvas = self.page.locator("#view > canvas")
        box = canvas.bounding_box()
        canvas.click(position={"x": box["width"] / 2 + 80,
                               "y": box["height"] / 2 + (80 if plane == "XY" else -80)})
        expect(self.page.locator('[data-tool="rect"]')).to_be_visible()

    def draw_shape(self, tool="rect"):
        self.page.locator(f'[data-tool="{tool}"]').click()
        box = self.page.locator("#view > canvas").bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        self.page.mouse.move(x - 60, y - 40)
        self.page.mouse.down()
        self.page.mouse.move(x + 60, y + 40)
        self.page.mouse.up()

    def reload(self):
        self.page.reload()
        self.ready()

    def test_new_draft_restores_plane_shapes_and_unfinished_drawing(self):
        self.start_sketch("XZ")
        self.draw_shape()
        self.page.locator('#dialog [data-k="w"]').fill("37,5")
        self.page.locator('#dialog [data-k="name"]').fill("Unfinished sketch")
        saved = self.work()
        self.assertEqual(saved["features"], [])
        self.assertEqual(saved["sketchDraft"]["feature"]["plane"], {"base": "XZ"})
        self.assertEqual(saved["sketchDraft"]["feature"]["shapes"][0]["w"], 37.5)
        self.reload()
        expect(self.page.locator('#dialog [data-k="w"]')).to_have_value("37.5")
        expect(self.page.locator('#dialog [data-k="name"]')).to_have_value("Unfinished sketch")
        expect(self.page.locator('[data-tool="rect"]')).to_have_class("tool on")
        self.assertEqual(self.work()["sketchDraft"], saved["sketchDraft"])
        expect(self.page.locator("#chips .chip")).to_have_count(0)

        # Clicked polygon corners survive too; the unfinished polygon is still a draft.
        self.page.locator('[data-tool="line"]').click()
        canvas = self.page.locator("#view > canvas")
        box = canvas.bounding_box()
        canvas.click(position={"x": box["width"] / 2 - 50, "y": box["height"] / 2 - 50})
        points = self.work()["sketchDraft"]["pts"]
        self.assertEqual(len(points), 1)
        self.reload()
        self.assertEqual(self.work()["sketchDraft"]["pts"], points)
        expect(self.page.locator('[data-tool="line"]')).to_have_class("tool on")

        self.page.locator('#dialog [data-act="finish"]').click()
        self.assertIsNone(self.work()["sketchDraft"])
        self.reload()
        expect(self.page.locator("#dialog")).to_be_hidden()
        expect(self.page.locator("#chips .chip")).to_have_count(1)
        self.assertEqual(self.work()["features"][0], saved["sketchDraft"]["feature"])

        # A restored draft must reserve its id for the next new sketch.
        self.start_sketch()
        self.assertNotEqual(self.work()["sketchDraft"]["feature"]["id"], saved["sketchDraft"]["feature"]["id"])
        self.page.locator('#dialog [data-act="delete"]').click()
        self.assertIsNone(self.work()["sketchDraft"])
        self.reload()
        expect(self.page.locator("#dialog")).to_be_hidden()
        expect(self.page.locator("#chips .chip")).to_have_count(1)

    def test_existing_sketch_edits_stay_separate_until_finish_or_delete(self):
        original = [
            {"id": "s1", "type": "sketch", "plane": {"base": "XY"},
             "shapes": [{"kind": "rect", "x": 0, "y": 0, "w": 20, "h": 10}]},
            {"id": "e1", "type": "extrude", "sketch": "s1", "distance": 12, "op": "join"},
        ]
        self.import_design(original)
        expect(self.page.locator("#chips .chip")).to_have_count(2)
        self.page.locator("#chips .chip").first.click()
        self.page.locator('#dialog [data-k="w"]').fill("42")
        self.page.locator('#dialog [data-k="name"]').fill("Edited sketch")
        self.assertEqual(self.work()["features"], original)
        self.reload()
        expect(self.page.locator('#dialog [data-k="w"]')).to_have_value("42")
        expect(self.page.locator('#dialog [data-k="name"]')).to_have_value("Edited sketch")
        expect(self.page.locator("#chips .chip.on")).to_have_count(1)
        expect(self.page.locator("#chips .chip.rolled")).to_have_count(1)
        self.assertEqual(self.work()["features"], original)
        self.page.locator('#dialog [data-act="finish"]').click()
        self.assertIsNone(self.work()["sketchDraft"])
        self.assertEqual(self.work()["features"][0]["shapes"][0]["w"], 42)
        self.page.locator("#chips .chip").first.click()
        self.page.locator('#dialog [data-act="delete"]').click()
        self.assertIsNone(self.work()["sketchDraft"])
        self.reload()
        expect(self.page.locator("#dialog")).to_be_hidden()
        self.assertEqual(self.work()["features"], original[1:])

    def test_lesson_drafts_are_isolated_and_restart_clears_only_that_lesson(self):
        self.start_sketch()
        self.draw_shape()
        self.page.locator('#dialog [data-k="name"]').fill("Free draft")
        free = self.work()
        self.page.locator('[data-open="block"]').click()
        expect(self.page.locator("#dialog")).to_be_hidden()
        self.start_sketch("XZ")
        self.draw_shape("circle")
        self.page.locator('#dialog [data-k="name"]').fill("Block draft")
        block = self.work("block")
        self.page.locator('#learn [data-act="back"]').click()
        expect(self.page.locator('#dialog [data-k="name"]')).to_have_value("Free draft")
        self.page.locator('[data-open="hole"]').click()
        self.page.locator("#chips .chip").first.click()
        self.page.locator('#dialog [data-k="name"]').fill("Hole draft")
        hole = self.work("hole")
        self.reload()
        expect(self.page.locator('#dialog [data-k="name"]')).to_have_value("Free draft")
        self.assertEqual(self.work(), free)
        self.page.locator('[data-open="block"]').click()
        expect(self.page.locator('#dialog [data-k="name"]')).to_have_value("Block draft")
        self.assertEqual(self.work("block"), block)
        self.page.locator('#learn [data-act="restart"]').click()
        expect(self.page.locator("#dialog")).to_be_hidden()
        self.assertIsNone(self.work("block")["sketchDraft"])
        self.assertEqual(self.work("block")["features"], [])
        self.assertEqual(self.work("free"), free)
        self.assertEqual(self.work("hole"), hole)
        self.page.locator('#learn [data-act="back"]').click()
        self.page.locator('[data-open="hole"]').click()
        expect(self.page.locator('#dialog [data-k="name"]')).to_have_value("Hole draft")
