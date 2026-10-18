# CAD Teacher

**Try it: https://pgrandin.github.io/cad-teacher/**

Teaches kids the Fusion 360 / SolidWorks way to model: sketch, extrude, then build features on
features (fillet, chamfer, hole), with a timeline you can go back and edit. Three courses, each with
guided lessons and challenges checked against a goal shape: the basics, "Design your robot arm"
(printable parts, then an assembly with joints you can drive, like Fusion's Joint and Drive Joints),
and "Elf furniture" (dollhouse table, chair, bookshelf, bed).
Parts export to STL.

Static site, no build step. The geometry is real B-rep CAD (OpenCascade through
[replicad](https://replicad.xyz), WebAssembly). The view is three.js. Both are vendored in `vendor/`.

- Run locally: `python3 -m http.server -d .`, then open http://localhost:8000
- Test the engine and every lesson goal: `node test.mjs`
- Deploy: every push to `main` publishes to GitHub Pages.

Languages: English, Français, Español, Deutsch (picker in the header, or `?lang=fr` in the URL).
Tool names match Fusion 360's own UI in each language, so kids find the same words there.

To add a lesson or challenge, append it to `lessons.js` with its `course` (its goal is a feature list), add its words
to every file in `locales/`, and add its expected volume to `test.mjs`.

To add a language, copy `locales/en.js`, translate it, and list it in `i18n.js`. `node test.mjs`
fails if any key is missing.

License: MIT for this code. The vendored libraries keep their own licenses (see `LICENSE`).
