# Video renderer

`render_video.py` draws the page's demo videos from the episode data in `assets/data/episodes.json` and the
Street View frames in `assets/img/episodes/`. It writes:

| Output | What it is |
|---|---|
| `assets/video/hero.mp4`, `hero.jpg` | the hero montage of the three illustrative episodes, and its poster |
| `assets/video/<id>.mp4`, `<id>.jpg` | one clip and one poster per episode |
| `assets/data/videos.json`, `videos.js` | the index the page reads |

Every drawn element comes from the episode data: frames, tool calls, clue boxes, notes, answers. The videos
are drawn in the page's light theme (white ground, ink text, one blue accent, pegman yellow for the current
step) and its fonts; the colours mirror the page's CSS tokens.

## Requirements

- Python 3.12 with Pillow (built with FreeType) and numpy: `python3 -m pip install pillow numpy`
- `ffmpeg` with libx264, on `PATH` (or at `/opt/homebrew/bin/ffmpeg`)

## Usage

From the repository root:

```bash
python3 tools/render_video.py                    # every clip, the hero and the index
python3 tools/render_video.py --hero-only        # only the hero montage
python3 tools/render_video.py --only type2-kenya # only one episode's clip
python3 tools/render_video.py --still hero@4,12  # PNG stills (in the current folder), no encode
python3 tools/render_video.py --help             # all options
```

A full run replaces the files in `assets/video/` and deletes clips that the index no longer lists. The render
stops if any drawn text leaves its box or the 40 px safe area. An encode over its size cap (6 MB per clip,
12 MB for the hero) is redone at a higher CRF.

## Bundled files

- `fonts/`: Hanken Grotesk and Google Sans Code variable fonts (the page's fonts) from
  [google/fonts](https://github.com/google/fonts),
  under the SIL Open Font License 1.1 (license texts beside them).
- `data/ne_110m_land.geojson`: [Natural Earth](https://www.naturalearthdata.com/) 1:110m land polygons
  (public domain), for the answer map on the Precise Localization end cards.

The frames are Google Street View imagery, and every video carries the credit "Imagery: Google Street View".
