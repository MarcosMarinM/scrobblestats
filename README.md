# ScrobbleStats

A web app that turns a Last.fm scrobble CSV into Spotify Wrapped style listening stats.
Everything runs in your browser, so no data is uploaded anywhere.

## What makes it different

1. **Features are shared between artists.** A scrobble of "Title (feat. Pepito)" by Mariita
   counts for **both Mariita and Pepito**. The overall total is **not** duplicated: each play
   counts once as a total and once for each credited artist in the rankings. You can **switch the
   automatic attribution off** and **correct it by hand** (see below).
2. **Minutes listened** (coming soon) using track durations from MusicBrainz. See *Pending*.

## Usage

Just open `index.html` in your browser. **No server is needed**, because the app uses plain
scripts, so it works over `file://` too.

You can also serve it over HTTP if you prefer:

```bash
python3 -m http.server 8000
```

Then drop your CSV onto the upload area, or click to choose a file.

## Controls

After a CSV is loaded these controls appear, and the results are recalculated whenever you change
them:

- **Attribute features automatically**: turns the feature detection on or off. When it is off,
  only the main artist counts.
- **Time range**: a single picker with *All time*, every *calendar year*, every *Spotify year*
  (December to November), a *specific month* (a native month picker) and a *custom range* with two
  dates.
- **Feature plays in rankings**: *Combined with main plays* (features are included in the totals but
  are not marked), *Shown separately* (the bars are split into a main artist part and a feature
  part) or *Hidden* (only main artist plays count in the ranking, and the features card is hidden).
- **Credit an artist by hand**: pick a track from your data (type and pick from the list) and the
  artist that should count for it too (choose from the list or type a new one). These
  relationships are always applied, and are saved in `localStorage` along with the feature toggle.

The feature markers recognised are `feat`, `featuring`, `ft`, `with` and `f/` wherever they appear
in a bracket, plus `con` and `y` when the bracket starts with them. `prod. by` and other credits
are not treated as features. After the marker, several featured names can be split with `,` `;`
`&` `y` `vs` or `|`.

## Results

The results are split into tabs (Overview, Artists, Tracks, Albums, Features, Time) instead of one
long page. The rankings show 25 rows per page and you can page through the whole list.

## CSV format

It accepts the usual export from [lastfmstats.com](https://lastfmstats.com) and similar files:

```
uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid
"1788273431","01 Sep 2026, 14:37","Angelina Mango","","Voglia di Vivere","","Vita morte e miracoli",""
```

- The date is read from `uts` (epoch) or from an ISO date. The delimiter (`;` `,` `\t` `|`) and the
  columns are detected automatically, with header aliases in several languages.
- At minimum it needs **artist**, **track** and, optionally, **date**.

## Structure

```
index.html             Page structure (upload area, controls and results)
styles.css             Styles
js/text.js             Text normalisation (comparison keys, feature stripping, title parts)
js/csv.js              CSV parsing, column and date detection
js/artists.js          Artist attribution (main artists, features and manual extras)
js/stats.js            Wrapped style aggregations
js/app.js              UI: file loading, controls and rendering
test/fixtures/mini.csv Small CSV with feature cases for manual testing
```

It is vanilla JS with no dependencies and no build step. The modules are **plain scripts** that
share the `window.SS` namespace, loaded in order from `index.html`. The logic is inspired by the
**Last.fm Lens** cleanup engine (`engine.js`), which is kept out of the repository.

## Deploying to GitHub Pages

1. Push the project to the `main` branch.
2. On GitHub: **Settings, Pages, Build and deployment, Deploy from a branch**, then choose the
   `main` branch and the `/ (root)` folder.
3. The app will be available at `https://<user>.github.io/scrobblestats/`.

## Pending: minutes with MusicBrainz

The minutes calculation will query
`GET https://musicbrainz.org/ws/2/recording?query=recording:"<title>" AND artist:"<artist>"&fmt=json`
and read the `length` field (in milliseconds) of each recording. Things to keep in mind:

- The API is free for non commercial use and **has CORS enabled**, so it can be called from the
  browser.
- It allows **one request per second per IP**, so the app has to deduplicate tracks, cache results
  in `localStorage` or `IndexedDB`, and retry with backoff when it gets a `503`.
- The "Minutes listened" section is already reserved in the interface.
