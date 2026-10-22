import json
import math
from pathlib import Path

from playwright.sync_api import expect

from support import BrowserTest


class PreviewTests(BrowserTest):
    def observe_worker(self):
        self.page.add_init_script("""(() => {
            window.geometryEvents = [];
            const NativeWorker = Worker;
            window.Worker = class extends NativeWorker {
                constructor(...args) {
                    super(...args);
                    this.requests = new Map();
                    this.addEventListener('message', ({data}) => {
                        geometryEvents.push({request:this.requests.get(data.id), ...structuredClone(data)});
                    });
                }
                set onmessage(handler) {
                    super.onmessage = event => {
                        const delay = window.delayPreview && this.requests.get(event.data.id)?.channel === 'preview';
                        delay ? setTimeout(() => handler(event), 400) : handler(event);
                    };
                }
                postMessage(data) { this.requests.set(data.id, data); super.postMessage(data); }
            };
        })()""")
        self.page.reload()
        self.ready()
        self.settled()

    def settled(self):
        expect(self.page.locator('#view')).to_have_attribute('aria-busy', 'false', timeout=60000)

    def volume(self, channel):
        return self.page.evaluate("""async channel => {
            const cad = await import('./cad.js');
            const result = geometryEvents.filter(e => e.request.channel === channel && e.result?.body).at(-1).result;
            const body = cad.deserialize(result.body);
            const volume = cad.metrics(body).volume;
            body.delete();
            return volume;
        }""", channel)

    def test_threaded_prefix_latest_preview_commit_cancel_and_upstream_edit(self):
        self.observe_worker()
        goal = self.page.evaluate("""async () => (await import('./lessons.js')).LESSONS.find(l => l.id === 'adv-screw').goal""")
        later = [
            {'id': 'later-sk', 'type': 'sketch', 'plane': {'base': 'XY'},
             'shapes': [{'kind': 'circle', 'x': 30, 'y': 0, 'd': 4}]},
            {'id': 'later-extrude', 'type': 'extrude', 'sketch': 'later-sk', 'distance': 10, 'op': 'join'},
        ]
        self.page.evaluate("""() => {
            window.gaps = []; let last = performance.now();
            window.heartbeat = setInterval(() => { const now = performance.now(); gaps.push(now-last); last = now; }, 20);
        }""")
        self.import_design(goal + later)
        self.settled()
        gaps = self.page.evaluate('() => { clearInterval(heartbeat); return gaps; }')
        self.assertGreater(len(gaps), 20, 'The UI should keep handling timer events during a thread build')
        self.assertLess(max(gaps), 1000, 'Geometry must not occupy the UI thread for seconds')
        original_volume = self.volume('model')

        self.page.locator('#chips .chip').last.click()
        self.settled()
        self.page.evaluate('geometryEvents.length = 0')
        field = self.page.locator('#dialog input[data-k="distance"]')
        self.page.evaluate('window.delayPreview = true')
        field.fill('21')
        self.page.wait_for_function("geometryEvents.some(e => e.request.channel === 'preview')")
        # Deliver the old result after newer input, exercising the stale-result guard.
        field.evaluate("""el => { for (let value = 11; value <= 20; value++) {
            el.value = String(value); el.dispatchEvent(new Event('input', {bubbles:true}));
        }}""")
        self.settled()
        events = self.page.evaluate("""geometryEvents.filter(e => e.request.channel === 'preview').map(e => ({reused:e.result.reused, distance:e.request.features.at(-1).distance}))""")
        self.assertLessEqual(len(events), 2, 'A burst must be coalesced to the latest preview')
        self.assertEqual(events[-1]['distance'], 20)
        self.assertGreaterEqual(events[-1]['reused'], len(goal) + 1)
        self.assertAlmostEqual(self.volume('preview'), original_volume + math.pi * 4 * 10, delta=0.05)
        self.page.locator('#dialog [data-act="ok"]').click()
        self.settled()
        self.assertAlmostEqual(self.volume('model'), original_volume + math.pi * 4 * 10, delta=0.05)

        # A queued preview must not re-open its dialog or change committed state after Cancel.
        self.page.locator('#chips .chip').last.click()
        self.settled()
        self.page.evaluate('geometryEvents.length = 0')
        field.fill('30')
        self.page.wait_for_function("geometryEvents.some(e => e.request.channel === 'preview')")
        self.page.locator('#dialog [data-act="cancel"]').click()
        expect(self.page.locator('#dialog')).to_be_hidden()
        with self.page.expect_download() as saved:
            self.page.locator('[data-tool="save"]').click()
        self.assertEqual(json.loads(Path(saved.value.path()).read_text())['features'][-1]['distance'], 20)

        # Changing the first sketch invalidates all dependent geometry, including the thread.
        self.page.locator('#chips .chip').first.click()
        self.settled()
        self.page.locator('#dialog [data-act="delete"]').click()
        self.settled()
        expect(self.page.locator('#chips .err').first).to_be_visible()
        self.assertAlmostEqual(self.volume('model'), math.pi * 4 * 20, delta=0.05)

    def test_worker_failure_releases_controls_and_allows_retry(self):
        self.page.route('**/cad-worker.js*', lambda route: route.fulfill(
            content_type='text/javascript', body="throw new Error('test worker startup failure');"))
        self.page.reload()
        self.ready()
        self.settled()
        self.page.unroute('**/cad-worker.js*')
        self.import_design([
            {'id': 's', 'type': 'sketch', 'plane': {'base': 'XY'},
             'shapes': [{'kind': 'circle', 'x': 0, 'y': 0, 'd': 4}]},
            {'id': 'e', 'type': 'extrude', 'sketch': 's', 'distance': 10, 'op': 'join'},
        ])
        self.settled()
        expect(self.page.locator('[data-tool="stl"]')).to_be_enabled()

    def test_synchronous_worker_failures_do_not_poison_the_queue(self):
        self.page.add_init_script("""(() => {
            window.workerFailure = 'constructor';
            const NativeWorker = Worker;
            window.Worker = class extends NativeWorker {
                constructor(...args) {
                    if (workerFailure === 'constructor') { window.workerFailure = null; throw Error('test constructor'); }
                    super(...args);
                }
                postMessage(data) {
                    if (workerFailure === 'send') { window.workerFailure = null; throw Error('test send'); }
                    super.postMessage(data);
                }
            };
        })()""")
        self.page.reload()
        self.ready()
        self.settled()
        model = [
            {'id': 's', 'type': 'sketch', 'plane': {'base': 'XY'},
             'shapes': [{'kind': 'circle', 'x': 0, 'y': 0, 'd': 4}]},
            {'id': 'e', 'type': 'extrude', 'sketch': 's', 'distance': 10, 'op': 'join'},
        ]
        self.import_design(model)
        self.settled()
        expect(self.page.locator('[data-tool="stl"]')).to_be_enabled()
        self.page.evaluate("window.workerFailure = 'send'")
        self.import_design(model)
        expect(self.page.locator('#chips .err')).to_have_count(2)
        self.settled()
        self.import_design(model)
        self.settled()
        expect(self.page.locator('[data-tool="stl"]')).to_be_enabled()
