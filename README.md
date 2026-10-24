# Citation Generator

Web app for filling out Lake Merwin Campers Hideaway violation notices. Pick a
site on the camp map (or type it), fill in the rest, and download a 4×6
fillable PDF.

## Run

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 (use `localhost`, not a LAN IP — unlocking needs
HTTPS or localhost). It must be served, not opened as a file. Needs
`assets/locked/bundle.bin`; see [Access code](#access-code).

## Access code

The app opens with an access-code screen. The form template, site list and
maps are **encrypted** with that code (AES-256-GCM, key derived with
PBKDF2-SHA256, 600k iterations) into `assets/locked/bundle.bin`, and only that
bundle is committed — the readable files under `assets/forms/`, `assets/data/`
and `assets/maps/` are git-ignored and stay on your machine. The code itself is
not stored anywhere; a wrong code just fails to decrypt.

**Set or change the code** (also run after changing the form, maps or CSV):

```sh
python3 tools/lock_assets.py      # prompts for the code twice
git add assets/locked/bundle.bin && git commit -m "Update bundle" && git push
```

Changing the code makes every device ask for the new one the next time it
picks up the update. "Remember on this device" keeps the derived key (not the
code) in a cookie for 400 days; the **Lock** button forgets it.

Use a long code (a few random words). Anyone can download the bundle and try
codes offline, so a short PIN can be guessed; a passphrase can't.

## Install on iPad / iPhone / Android (offline use)

The app works offline once installed. It has to be hosted on HTTPS first
(any static host, e.g. GitHub Pages, Netlify, Railway); devices then
install it once while connected.

- **iPad / iPhone:** open the site in Safari → Share → **Add to Home Screen**.
- **Android:** open the site in Chrome → menu → **Install app** (or Add to
  Home screen).

Open it once from the home screen while still connected. When the bottom of
the page says "✓ Available offline", it will work with no signal. On phones
and tablets, **Share / Print / Save** opens the system
share sheet (Save to Files, Print, AirDrop, email…).

**Updating:** deploy the new files. Each device picks up the change the next
time it opens the app with a connection (the change shows on the following
launch). To force every device to re-download everything, bump `VERSION` in
`sw.js`. If you add or rename files the app loads, add them to `SHELL` in
`sw.js` (map images are picked up from `numbers.csv` automatically).

## Layout

```
index.html                  app entry point
manifest.webmanifest        install metadata (name, icons)
sw.js                       service worker: offline cache
src/
  app.js                    map picker, autofill, form handling
  fill.js                   fills the PDF template (pdf-lib)
  vault.js                  access code: decrypts the bundle, remembers the key
  style.css
assets/
  locked/bundle.bin             encrypted form, site list and maps (committed)
  forms/citation_fillable.pdf   4×6 fillable form template      (local only)
  maps/camp_map_2024.pdf        source camp map                 (local only)
  maps/pages/                   rendered block maps             (local only)
  data/numbers.csv              site positions on each block map (local only)
  images/logo-circle.png        logo used on the form and in the app
  icons/                        home-screen icons (generated)
vendor/pdf-lib.min.js       pdf-lib 1.17.1
tools/
  build_form.py             regenerates assets/forms/citation_fillable.pdf
  render_maps.py            regenerates assets/maps/pages/ from the map PDF
  make_icons.py             regenerates assets/icons/ from the logo
  lock_assets.py            encrypts the private files into assets/locked/
```

## Regenerating assets

- **Form:** `python3 tools/build_form.py` (needs `reportlab`). Field names in the
  form must match the `name` attributes in `index.html`.
- **Map images:** `python3 tools/render_maps.py` (needs `pdftoppm`). Run after
  changing the map PDF or the `pdf_page`/`image` columns in `numbers.csv`.
- After either, run `python3 tools/lock_assets.py` so the app gets the change.

`numbers.csv` coordinates (`left`, `top`, `width`, `height`, `x`, `y`) are
fractions of the full map page, so they stay valid at any render resolution.

## Notes

- The next citation number and the "Issued by" name are remembered per browser
  (localStorage). Two devices will hand out the same numbers. Drawn
  signatures are never saved on the device (not even in the draft).
- The sun/moon button switches light and dark mode. It follows the device
  setting until used, then remembers the choice on that device.
