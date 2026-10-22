import copy
import json
from pathlib import Path

from playwright.sync_api import expect
from support import BrowserTest


DESIGN = [
    {"type": "sketch", "id": "s1", "plane": {"base": "XY"},
     "shapes": [{"kind": "rect", "x": 8, "y": 0, "w": 4, "h": 6}]},
    {"type": "extrude", "id": "e1", "sketch": "s1", "distance": 4, "op": "join"},
    {"type": "pattern", "id": "p1", "of": "e1", "kind": "rect",
     "nx": 2, "dx": 4, "ny": 1, "dy": 10, "nz": 1, "dz": 10},
]
HOSTILE_ID = '\"></option></select><img src="data:," onerror="window.importXss=1"><select><option value="'


class ImportTests(BrowserTest):
    def saved_features(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('cad-teacher-work:free')).features")

    def assert_saved(self, features):
        self.page.wait_for_function(
            "features => JSON.stringify(JSON.parse(localStorage.getItem('cad-teacher-work:free')).features) === JSON.stringify(features)",
            arg=features,
        )

    def assert_safe_dialogs(self, sketch_id="s1", feature_id="e1"):
        for tool, field, value in [("extrude", "sketch", sketch_id),
                                   ("revolve", "sketch", sketch_id),
                                   ("pattern", "of", feature_id)]:
            self.page.locator(f'[data-tool="{tool}"]').click()
            expect(self.page.locator(f'#dialog select[data-k="{field}"]')).to_have_value(value)
            expect(self.page.locator("#dialog img")).to_have_count(0)
            self.assertIsNone(self.page.evaluate("window.importXss"))
            self.page.locator('#dialog [data-act="cancel"]').click()

    def test_hostile_import_is_rejected_without_replacing_design(self):
        self.import_design(DESIGN)
        self.assert_saved(DESIGN)
        hostile = copy.deepcopy(DESIGN)
        hostile[0]["id"] = hostile[1]["sketch"] = HOSTILE_ID
        self.import_design(hostile)
        expect(self.page.locator("#hint")).to_have_text("This file is not a CAD Teacher design.")
        self.assertEqual(self.saved_features(), DESIGN)
        self.assert_safe_dialogs()

    def test_previously_imported_ids_are_escaped_in_all_dialogs(self):
        # Older versions already accepted these IDs into autosave; escaping must protect restoration too.
        hostile = copy.deepcopy(DESIGN)
        hostile[0]["id"] = hostile[1]["sketch"] = HOSTILE_ID
        hostile[1]["id"] = hostile[2]["of"] = HOSTILE_ID + "extrude"
        self.page.evaluate(
            "features => localStorage.setItem('cad-teacher-work:free', JSON.stringify({features}))",
            hostile,
        )
        self.page.reload()
        self.ready()
        self.assert_saved(hostile)
        self.assert_safe_dialogs(HOSTILE_ID, HOSTILE_ID + "extrude")

    def test_invalid_ids_and_references_preserve_current_design(self):
        self.import_design(DESIGN)
        self.assert_saved(DESIGN)
        invalid = []
        for feature, key, value in [(0, "id", ""), (0, "id", "__proto__"),
                                    (0, "id", "constructor"), (0, "id", "e1"),
                                    (1, "sketch", {}), (1, "sketch", "p1"),
                                    (2, "of", "s1"), (2, "of", HOSTILE_ID)]:
            features = copy.deepcopy(DESIGN)
            features[feature][key] = value
            invalid.append(features)
        invalid.extend([None, {}, [None]])
        for features in invalid:
            with self.subTest(features=features):
                self.page.locator("#hint").evaluate("hint => hint.textContent = ''")
                self.import_design(features)
                expect(self.page.locator("#hint")).to_have_text("This file is not a CAD Teacher design.")
                self.assertEqual(self.saved_features(), DESIGN)

        # Validation must happen before Open switches a lesson to free design.
        self.page.locator('[data-open="block"]').click()
        expect(self.page.locator('#learn [data-act="back"]')).to_be_visible()
        self.page.locator("#hint").evaluate("hint => hint.textContent = ''")
        self.import_design(invalid[0])
        expect(self.page.locator("#hint")).to_have_text("This file is not a CAD Teacher design.")
        expect(self.page.locator('#learn [data-act="back"]')).to_be_visible()
        self.assertEqual(self.saved_features(), DESIGN)

    def test_valid_references_survive_save_open_and_dangling_references_stay_editable(self):
        self.import_design(DESIGN)
        self.assert_saved(DESIGN)
        self.assert_safe_dialogs()
        with self.page.expect_download() as download:
            self.page.locator('[data-tool="save"]').click()
        path = Path(__file__).resolve().parents[2] / ".work/browser-import/roundtrip.cadteacher.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        download.value.save_as(path)
        self.assertEqual(json.loads(path.read_text())["features"], DESIGN)
        self.page.locator('[data-tool="new"]').click()
        self.page.locator("#open-file").set_input_files(path)
        self.assert_saved(DESIGN)
        self.assert_safe_dialogs()
        expect(self.page.locator("#chips .err")).to_have_count(0)

        dangling = copy.deepcopy(DESIGN[1:])
        self.import_design(dangling)
        self.assert_saved(dangling)
        expect(self.page.locator("#chips .err")).to_have_count(2)
