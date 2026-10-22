from playwright.sync_api import expect

from support import BrowserTest, ROOT


BLOCK = [
    {"type": "sketch", "id": "s1", "plane": {"base": "XY"},
     "shapes": [{"kind": "rect", "x": 0, "y": 0, "w": 20, "h": 20}]},
    {"type": "extrude", "id": "e1", "sketch": "s1", "distance": 10, "op": "join"},
]


class PatternTests(BrowserTest):
    def setUp(self):
        super().setUp()
        # Even if both input and engine validation regress, no test may allocate unbounded copies.
        guard = """
            const clone = R.Solid.prototype.clone;
            let copies = 0;
            R.Solid.prototype.clone = function () {
                if (++copies > 200) throw Error('test stopped excessive pattern allocation');
                if (copies === 1) queueMicrotask(() => { copies = 0; });
                return clone.call(this);
            };
        """
        self.cad_requests = 0

        def guarded_cad(route):
            self.cad_requests += 1
            route.fulfill(content_type='text/javascript', body=(ROOT / 'cad.js').read_text() + guard)

        self.page.route('**/cad.js*', guarded_cad)
        self.page.reload()
        self.ready()

    def tearDown(self):
        self.assertGreaterEqual(self.cad_requests, 2, "Allocation guard must protect the main thread and worker")
        super().tearDown()

    def test_invalid_numbers_block_preview_commit_and_recover(self):
        self.import_design(BLOCK)
        expect(self.page.locator("#chips .chip")).to_have_count(2)
        self.page.locator('[data-tool="pattern"]').click()
        self.page.locator('[data-k="kind"]').select_option("circle")
        count = self.page.locator('[data-k="n"]')
        ok = self.page.locator("#okbtn")
        error = self.page.locator("#cmderr")
        for value in ["Infinity", "-Infinity", "NaN", "1e309", "", "-", "2garbage", "1.5", "101", "1000000000"]:
            count.fill(value)
            expect(ok).to_be_disabled()
            expected = "whole-number" if value == "1.5" else "100 copies" if value in ["101", "1000000000"] else "finite number"
            expect(error).to_contain_text(expected)
            count.press("Enter")
            expect(self.page.locator("#chips .chip")).to_have_count(2)
            expect(count).to_have_value(value)
        count.fill("2")
        expect(ok).to_be_enabled()
        expect(error).to_be_empty()
        ok.click()
        expect(self.page.locator("#chips .chip")).to_have_count(3)

    def test_rectangular_product_and_import_are_bounded(self):
        # A finite JSON number can overflow JS to Infinity; importing it must still be safe.
        pattern = {"id": "p1", "type": "pattern", "of": "e1", "kind": "circle", "n": 10**309}
        self.import_design([*BLOCK, pattern])
        expect(self.page.locator("#chips .chip.err")).to_have_count(1)
        self.page.locator("#chips .chip").last.click()
        expect(self.page.locator("#okbtn")).to_be_disabled()
        expect(self.page.locator("#cmderr")).to_contain_text("whole-number")
        self.page.locator('[data-k="kind"]').select_option("rect")
        for axis in ["nx", "ny", "nz"]:
            self.page.locator(f'[data-k="{axis}"]').fill("5")
        expect(self.page.locator("#okbtn")).to_be_disabled()
        expect(self.page.locator("#cmderr")).to_contain_text("100 copies")

    def test_localized_decimal_input_and_unfinished_sketch_validation(self):
        self.import_design(BLOCK)
        expect(self.page.locator("#chips .chip")).to_have_count(2)
        self.page.locator("#chips .chip").last.click()
        distance = self.page.locator('[data-k="distance"]')
        distance.fill("3,5")
        expect(self.page.locator("#okbtn")).to_be_enabled()
        self.page.locator("#okbtn").click()
        self.page.locator("#chips .chip").first.click()
        width = self.page.locator('[data-k="w"]')
        width.fill("-")
        expect(self.page.locator('#dialog [data-act="finish"]')).to_be_disabled()
        self.page.locator('[data-tool="finish"]').click()
        expect(width).to_have_value("-")
        width.fill("20")
        self.page.locator('#dialog [data-act="finish"]').click()
        expect(self.page.locator("#dialog")).to_be_hidden()
