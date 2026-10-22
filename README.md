# CAD Teacher

**Try it: https://pgrandin.github.io/cad-teacher/**

Teaches kids the Fusion 360 / SolidWorks way to model: sketch, extrude, then build features on
features (fillet, chamfer, hole, thread, revolve, pattern), with a timeline you can go back and edit. Six courses, each with
guided lessons and challenges checked against a goal shape ("Show differences" colors what is missing or extra): the basics (starting with a guided walkthrough of axes, the origin, sketch planes, and camera controls), "Design your robot arm"
(printable parts, then an assembly with joints you can drive, like Fusion's Joint and Drive Joints),
"Elf furniture" (dollhouse table, chair, bookshelf, bed), "Spin & repeat" (revolve and
pattern: chess pawn, robot wheel, toy brick), "Print without supports" (the 45° rule, print
orientation, sideways holes), and "Advanced projects" (chess knight, sword and shield, building façade,
gears, a screw and a nut that fit, a hinge made of two identical leaves). Print check shows what would print in thin air and lets you pick the
face that lies on the bed; Export STL saves the part in that position.
Work is saved in the browser per lesson, and the design made outside lessons is kept too. Save writes
the timeline to a `.cadteacher.json` file that Open reads back (another computer, a teacher). Parts
export to STL (3D printing) and STEP (opens in Fusion).

Click a face, edge, or corner of the view cube to align the camera; it follows the view as you orbit.

Static site, no build step. The geometry is real B-rep CAD (OpenCascade through
[replicad](https://replicad.xyz), WebAssembly). The view is three.js. Both are vendored in `vendor/`.

- Run locally: `python3 -m http.server -d .`, then open http://localhost:8000
- Test the engine and every lesson goal: `node test.mjs`
- Deploy: every push to `main` runs `.github/workflows/pages.yml`: tests, stamps the commit (shown in the
  page footer), cache-busts the app files, and publishes to GitHub Pages.

Explanations use Fusion's own words, with an "In simple words" fold-out under each one for younger
kids, including every step of the intro. Both versions teach the same CAD terms: pair technical
wording with a concrete example or analogy, rather than replacing the vocabulary. New teaching
explanations need a `.simple` companion in every language. Languages: English, Français, Español, Deutsch (picker in the header, or `?lang=fr` in the URL).
The language defaults to the first supported language in the browser’s preferences, with English
as the fallback. A saved picker choice takes priority; `?lang=fr` in the URL overrides both.
Tool names match Fusion 360's own UI in each language, so kids find the same words there.

To add a lesson or challenge, append it to `lessons.js` with its `course` (its goal is a feature list), add its words
to every file in `locales/`, and add its expected volume to `test.mjs`.

To add a language, copy `locales/en.js`, translate it, and list it in `i18n.js`. `node test.mjs`
fails if any key is missing.

License: MIT for this code. The vendored libraries keep their own licenses (see `LICENSE`).
