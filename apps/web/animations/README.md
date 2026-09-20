# Quod homepage animations

`quod_homepage.py` renders the three selector states for the homepage hero.
They use only Manim geometry, so they do not need LaTeX, fonts, credentials, or
external assets. Every scene is a 10-second, 24 fps cycle at 1280x800.

From the repository root on Windows, use the isolated animation environment:

```powershell
$python = '.\.session-tools\manim-venv\Scripts\python.exe'
& $python -m manim apps\web\animations\quod_homepage.py Lattice -r 1280,800 --fps 24 --format mp4 --media_dir .session-tools\quod-renders
```

Render `Sphere`, `Surface`, or `Lattice`; copy the resulting MP4 from
`.session-tools/quod-renders/videos/quod_homepage/800p24/` into
`apps/web/public/animations/`. For a reduced-motion poster, replace `--format
mp4` with `-s`; Manim writes the final frame into the corresponding `images/`
directory.

The production assets are named:

| Selector | Video | Poster |
| --- | --- | --- |
| Sphere | `quod-sphere.mp4` | `quod-sphere-poster.png` |
| Surface | `quod-surface.mp4` | `quod-surface-poster.png` |
| Lattice (default) | `quod-lattice.mp4` | `quod-lattice-poster.png` |
