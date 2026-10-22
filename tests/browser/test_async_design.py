from playwright.sync_api import expect

from support import BrowserTest

BLOCK = [
    {'id': 's', 'name': 'Original sketch', 'type': 'sketch', 'plane': {'base': 'XY'},
     'shapes': [{'kind': 'rect', 'x': 0, 'y': 0, 'w': 20, 'h': 10}]},
    {'id': 'e', 'type': 'extrude', 'sketch': 's', 'distance': 10, 'op': 'join'},
]


class AsyncDesignTests(BrowserTest):
    def setUp(self):
        super().setUp()
        self.page.add_init_script('''(() => {
          const NativeWorker = Worker;
          window.heldModels = [];
          window.holdModels = localStorage.getItem('test-hold-model') === 'yes';
          window.Worker = class extends NativeWorker {
            constructor(...args) { super(...args); this.requests = new Map(); }
            postMessage(data) { this.requests.set(data.id, data); super.postMessage(data); }
            set onmessage(handler) {
              super.onmessage = event => {
                if (window.holdModels && this.requests.get(event.data.id)?.channel === 'model') {
                  heldModels.push(() => handler(event));
                } else handler(event);
              };
            }
          };
        })()''')
        self.page.reload()
        self.ready()
        self.settled()

    def settled(self):
        expect(self.page.locator('#view')).to_have_attribute('aria-busy', 'false')

    def release(self):
        self.page.evaluate('() => { holdModels = false; heldModels.splice(0).forEach(release => release()); }')
        self.settled()

    def saved(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('cad-teacher-work:free'))")

    def test_newer_open_wins(self):
        self.page.locator('[data-open="hole"]').click()
        expect(self.page.locator('#learn [data-act="goal"]')).to_be_visible()
        self.settled()
        self.page.evaluate('holdModels = true')
        first = [{'id': 'first', 'name': 'First import', 'type': 'sketch', 'plane': {'base': 'XY'}, 'shapes': []}]
        second = [{'id': 'second', 'name': 'Second import', 'type': 'sketch', 'plane': {'base': 'XY'}, 'shapes': []}]
        self.import_design(first)
        self.page.wait_for_function('heldModels.length === 1')
        self.import_design(second)
        expect(self.page.locator('#chips')).to_contain_text('Second import')
        self.release()
        expect(self.page.locator('#chips')).to_contain_text('Second import')
        self.assertEqual(self.saved()['features'], second)

    def restore_held_draft(self):
        self.page.evaluate('''features => {
            localStorage.setItem('test-hold-model', 'yes');
            localStorage.setItem('cad-teacher-work:free', JSON.stringify({features, sketchDraft: {
                index: 2, feature: {id: 'draft', name: 'Restored draft', type: 'sketch', plane: {base: 'XZ'}, shapes: []},
                pts: [], tool: null, sel: -1, picking: false
            }}));
        }''', BLOCK)
        self.page.reload()
        expect(self.page.locator('#loading')).to_have_count(0)
        self.page.wait_for_function('heldModels.length === 1')

    def test_new_lesson_wins_over_pending_open(self):
        self.page.locator('[data-open="hole"]').click()
        expect(self.page.locator('#learn [data-act="goal"]')).to_be_visible()
        self.settled()
        self.page.evaluate('holdModels = true')
        self.import_design(BLOCK)
        self.page.wait_for_function('heldModels.length === 1')
        self.page.locator('[data-open="block"]').click()
        self.release()
        expect(self.page.locator('#learn [data-act="back"]')).to_be_visible()
        expect(self.page.locator('#chips .chip')).to_have_count(0)
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('cad-teacher-work:block')).features"), [])

    def test_new_lesson_does_not_consume_old_draft(self):
        self.restore_held_draft()
        self.page.locator('[data-open="block"]').click()
        self.release()
        expect(self.page.locator('#dialog')).to_be_hidden()
        expect(self.page.locator('#chips .chip')).to_have_count(0)
        self.assertEqual(self.saved()['sketchDraft']['feature']['id'], 'draft')
        self.page.locator('#learn [data-act="back"]').click()
        self.settled()
        expect(self.page.locator('#dialog input[data-k="name"]')).to_have_value('Restored draft')

    def test_new_cancels_pending_draft_restore(self):
        self.restore_held_draft()
        self.page.locator('[data-tool="new"]').click()
        self.assertEqual(self.saved()['features'], [])
        self.assertIsNone(self.saved()['sketchDraft'])
        self.release()
        expect(self.page.locator('#dialog')).to_be_hidden()
        expect(self.page.locator('#chips .chip')).to_have_count(0)
        self.assertEqual(self.saved()['features'], [])
        self.assertIsNone(self.saved()['sketchDraft'])

    def test_undo_after_new_does_not_revive_pending_draft(self):
        self.restore_held_draft()
        self.page.locator('[data-tool="new"]').click()
        self.page.locator('[data-tool="undo"]').click()
        self.release()
        expect(self.page.locator('#dialog')).to_be_hidden()
        expect(self.page.locator('#chips .chip')).to_have_count(2)
        self.assertEqual(self.saved()['features'], BLOCK)
        self.assertIsNone(self.saved()['sketchDraft'])


    def test_slow_file_read_cannot_replace_newer_open(self):
        self.page.evaluate("""() => {
            const text = File.prototype.text;
            let first = true;
            File.prototype.text = function () {
                if (!first) return text.call(this);
                first = false;
                return new Promise(resolve => { window.releaseFile = () => text.call(this).then(resolve); });
            };
        }""")
        self.import_design(BLOCK)
        self.page.wait_for_function('window.releaseFile !== undefined')
        second = [{'id': 'second', 'name': 'Second import', 'type': 'sketch', 'plane': {'base': 'XY'}, 'shapes': []}]
        self.import_design(second)
        expect(self.page.locator('#chips')).to_contain_text('Second import')
        self.settled()
        self.page.evaluate('releaseFile()')
        expect(self.page.locator('#chips')).to_contain_text('Second import')
        self.assertEqual(self.saved()['features'], second)
