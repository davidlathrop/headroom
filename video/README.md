# Headroom demo video

A ~40-second walkthrough of the app, built with [Remotion](https://www.remotion.dev): an intro,
eight real screens (captured from the app running on **demo data**, see `scripts/capture.sh`)
with captions and a slow camera move each, cross-fades, and an outro. Composition:
`src/HeadroomDemo.tsx` (1920×1080, 30 fps).

```sh
cd video
npm install
npm run dev                      # Remotion Studio, to preview and scrub
npx remotion render HeadroomDemo out/headroom-demo.mp4
```

Remotion downloads its own Chrome Headless Shell on first render (`npx remotion browser ensure`).
Rendering the video through the system Chrome (`--browser-executable`) fails on macOS with
"got no response"; stills work either way.

`out/` is git-ignored. The screens in `public/screens/` are committed so the video renders
without running the app; regenerate them with `scripts/capture.sh` after UI changes.
