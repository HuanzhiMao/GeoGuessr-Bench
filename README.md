# GeoGuesser Bench project page

Project page for *GeoGuesser Bench: Benchmarking Vision-Language Agents on Interactive Geolocation*. It shows
the leaderboard, a demo video and an episode viewer for the paper's Figure 1 examples, a step-by-step demo of
the offline environment's tools, a console of logged agent traces, the benchmark description, the findings,
an animated diagram of the Planner–Worker–Compressor harness with its token savings, and the citation.

It is a static site: plain HTML, CSS and JavaScript with relative paths and no build step. The data ships as
`.js` files under `assets/data/` (with `.json` copies), so the page also works when `index.html` is opened
directly from disk.

## Preview locally

From this folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then open http://127.0.0.1:8000/
```

Opening `index.html` directly in a browser also works. Fonts come from Google Fonts, so an offline preview
falls back to system fonts. Add `?theme=light` or `?theme=dark` to the URL to force a color theme.

## Links

The hero has three link buttons: arXiv, Code and Environment. Their URLs are in one object at the top of
`assets/js/site.js`:

```js
var LINKS = {
  arxiv: "",
  code: "https://github.com/HuanzhiMao/gorilla",
  environment: "https://github.com/HuanzhiMao/GeoGuessr-StreetView-Server"
};
```

| Key | Button | Link |
|---|---|---|
| `arxiv` | arXiv | arXiv abstract page |
| `code` | Code | benchmark and harness repository |
| `environment` | Environment | offline environment repository |

A button with a URL is a link that opens in a new tab. A button whose URL is still empty looks the same but
does not navigate: it has no `href`, carries `aria-disabled="true"` and a small "soon" tag, and its tooltip
says "Link coming soon". The benchmark data is not released, so there is no data button.

## Starting-location map

All 282 markers are ordinary Google Maps links that open Street View in a new tab. Each link includes a
panorama ID and its camera coordinates. If Google cannot find the ID, it uses the coordinates to select
nearby imagery. The site needs no API key, backend, or recurring refresh job; all link data ships in
`assets/data/world.js` (with a matching `world.json` copy).

## TODO when the preprint is posted: arXiv link

Put the abstract-page URL in `LINKS.arxiv`, and update the BibTeX entry in `index.html` (section
`#citation`): add `eprint`/`archivePrefix` (or the journal line) and remove the comment line above the entry.

## TODO after the first deploy: social preview image

The `og:image` and `twitter:image` tags in `index.html` point to `assets/video/type1-tepoztlan.jpg` with a
relative path. Link previews need an absolute URL, so replace both values with the published address of that
file, for example `https://<user>.github.io/<repo>/assets/video/type1-tepoztlan.jpg`.

## Deploy to GitHub Pages

1. Copy the contents of this folder, including the hidden `.nojekyll` file, to the root of a GitHub Pages
   repository or branch (for example `gh-pages`). From this folder:
   ```bash
   rsync -a --delete --exclude .git --exclude tools ./ <pages-checkout>/
   ```
   `.nojekyll` makes Pages serve the files as they are.
2. Commit and push, then enable Pages under **Settings → Pages** with that branch and folder as the source.
3. Make the social preview image URLs absolute (see the TODO above).

The largest file is `assets/video/hero.mp4` (about 11.1 MB), well under GitHub's 100 MB file limit; the whole
folder is about 37 MB.

`tools/render_video.py` renders the demo videos from the episode data (see `tools/README.md`). The scripts
that build the data and figures are not included.
