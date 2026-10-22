from playwright.sync_api import expect

from support import BrowserTest


class GradingTests(BrowserTest):
    def open_saved_goal(self, lesson_id, shifted=False):
        self.page.set_default_timeout(90000)
        course = self.page.evaluate("""async ({id, shifted}) => {
            const {LESSONS} = await import('./lessons.js');
            const lesson = LESSONS.find(l => l.id === id);
            const features = structuredClone(lesson.goal);
            if (shifted) features.find(f => f.type === 'hole').y = 1;
            localStorage.setItem('cad-teacher-work:' + id, JSON.stringify({
                features, step: lesson.steps.length - 1, lessonVersion: lesson.version
            }));
            return lesson.course;
        }""", {"id": lesson_id, "shifted": shifted})
        card = self.page.locator(f'#learn [data-course="{course}"]')
        if card.get_attribute("open") is None:
            card.locator("summary").first.click()
        self.page.locator(f'[data-open="{lesson_id}"]').click()

    def assert_incomplete(self, lesson_id):
        expect(self.page.locator("#learn .win")).to_have_count(0)
        self.assertNotIn(lesson_id, self.page.evaluate(
            "JSON.parse(localStorage.getItem('cad-teacher-done') || '[]')"
        ))
        expect(self.page.locator("#learn")).not_to_contain_text("No differences")

    def test_shifted_threaded_hole_cannot_finish_lesson(self):
        self.open_saved_goal("adv-nut", shifted=True)
        self.page.locator('#learn [data-act="diff"]').check()
        expect(self.page.locator("#learn")).to_contain_text("missing (add this)", timeout=90000)
        expect(self.page.locator("#chips .err")).to_have_count(0)
        self.assert_incomplete("adv-nut")

    def test_failed_comparison_is_reported_without_completion(self):
        def fail_boolean(route):
            response = route.fetch()
            source = response.text()
            expression = "a.clone().cut(b.clone())"
            self.assertIn(expression, source)
            source = source.replace(expression, "(() => { throw new Error('simulated boolean failure'); })()")
            route.fulfill(response=response, body=source)

        self.page.route("**/cad.js", fail_boolean)
        self.page.reload()
        self.ready()
        self.open_saved_goal("hole")
        expect(self.page.locator("#learn")).to_contain_text("The shapes could not be compared", timeout=90000)
        self.page.locator('#learn [data-act="diff"]').check()
        self.assert_incomplete("hole")
        self.page.locator("#lang").select_option("fr")
        expect(self.page.locator("#learn")).to_contain_text("Impossible de comparer les formes")
