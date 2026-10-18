# CAD Teacher

**Try it: https://pgrandin.github.io/cad-teacher/**

Teaches kids the Fusion 360 / SolidWorks way to model: sketch, extrude, then build features on
features (fillet, chamfer, hole), with a timeline you can go back and edit. Six guided lessons and
five challenges, each checked against a goal shape. Parts export to STL.

Static site, no build step. The geometry is real B-rep CAD (OpenCascade through
[replicad](https://replicad.xyz), WebAssembly). The view is three.js. Both are vendored in `vendor/`.

- Run locally: `python3 -m http.server -d .`, then open http://localhost:8000
- Test the engine and every lesson goal: `node test.mjs`
- Deploy: every push to `main` publishes to GitHub Pages. Homelab copy: `lab deploy . --name cad-teacher`

To add a lesson or challenge, append it to `lessons.js` (its goal is a feature list) and add its
expected volume to `test.mjs`.

License: MIT for this code. The vendored libraries keep their own licenses (see `LICENSE`).
