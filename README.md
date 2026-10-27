# mensa.

A static, German-language menu browser for the cafeterias operated by Studentenwerk Dresden. No backend, API key, build step, or package installation is required.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. Do not open `index.html` as a `file://` URL; browsers can restrict JavaScript modules on local files.

To test on a phone connected to the same Wi-Fi network, bind the server to the local network:

```sh
python3 -m http.server 8006 --bind 0.0.0.0
```

Open `http://<computer-LAN-IP>:8006` on the phone (not `localhost`). Allow local-network access through the computer's firewall if prompted. This exposes the served directory to devices on the local network; stop the server when finished and do not forward this port to the internet.

## Deploy

Publish `index.html`, `styles.css`, `app.js`, `theme.js`, `meal-picker.js`, `swipe.js`, and `favicon.svg` together on any HTTPS static host (including GitHub Pages). All asset paths are relative, so subdirectory deployments work.

## Data and scope

- Cafeterias and dated menus are fetched directly in the browser from https://api.studentenwerk-dresden.de/openmensa/v2. The official API permits cross-origin requests.
- The initial date is today before 19:00 and tomorrow from 19:00 in `Europe/Berlin`, advanced to Monday if it falls on a weekend. Week navigation and the date picker request menus for the chosen date; unpublished dates show an explicit empty state. A Saturday or Sunday entered in the native date picker also advances to Monday.
- The date strip shows five weekdays, never Saturday or Sunday. On mobile, swipe horizontally to browse five weekdays forward/back, or use the arrows to shift the strip by one weekday. Browsing does not request menus until a date is tapped. Desktop shows Monday–Friday with week arrows. Today has an accent-colored border even when selected; date animations respect reduced motion.
- Cafeteria visibility is saved in local storage on the visitor’s device. All cafeterias are selected initially. The compact “Mensen” disclosure opens the full filter list without changing the selection.
- The header’s sun/moon button toggles dark mode. Without a saved choice, the theme follows the browser’s `prefers-color-scheme`, including changes while the page is open. A manual choice is saved locally under `mensa-theme-v1` and takes priority on later visits. Switching also works if storage is blocked; removing that stored preference restores system-following mode. Theme changes synchronize across tabs. The theme is applied before loading the stylesheet to avoid a light-theme flash.
- Cafeteria addresses are not displayed. “Route” uses Apple Maps on iPhones and Google Maps on other devices, with the cafeteria’s official API address as the destination. The HTTPS Maps link opens in a new tab or the installed Maps app, as handled by the device. The visitor chooses their starting point in Maps. Cafeterias without an address have no route link.
- The Mittag/Abend switch separates lunch from evening meals. An `Abendangebot` prefix in the API category or meal name identifies evening meals. At page opening, defaults use `Europe/Berlin` (including daylight saving time): before 15:00, today's lunch; 15:00–18:59, today's evening menu; from 19:00, tomorrow's lunch menu. Any weekend date advances to Monday. Manual changes remain selected across date/filter changes, but are not persisted across reloads or overridden by a timer.
- Vegan and Vegetarian each have a segmented radio control, styled like the price selector, with “×” (no restriction), “✓” (only matching meals), and a crossed-out eye (exclude matching meals). German tooltips and screen-reader labels explain each symbol. Both default to “×” and combine using AND: Vegetarian includes vegan dishes, so hiding vegan meals plus “Vegetarisch: ✓” selects vegetarian-but-not-vegan meals. Contradictory choices show an empty state without silently resetting either control. Classifications use only exact provider notes (“Menü ist vegan” / “Menü ist vegetarisch”), never inferred ingredients. Dishes without these labels remain in unrestricted/hide views; hiding a label does not certify that a dish contains meat or animal products. The selections stay active across date, cafeteria, price, and meal-period changes, but reset on reload. Cached raw responses are reused.
- The “Student / Bediensteter / Gäste” price selector defaults to Student on each page load. Each card shows only the selected category’s published price (or “Keine Preisangabe” if unavailable). Both the Dresden API’s German price keys and standard OpenMensa keys are supported. Changing category updates prices in place, without fetching menus or resetting meal pages; the selection is retained across the other filters and dates.
- Cafeterias without matching meals are omitted; a clear empty state appears when none match. Failed cafeterias remain visible with retry controls. Raw cached API responses are shared between lunch and evening views, so switching does not discard either set of meals.
- Each cafeteria shows up to three meals at a time on desktop/tablet, in API order. On mobile (up to 560px wide), it shows one meal at a time: horizontal finger gestures move the card continuously with the finger, then advance or snap back. Both distance and quick flicks can complete a swipe. Previous/next buttons remain as an accessible alternative. Tiny, cancelled and vertical gestures do not change meals; pagination stops at the ends. Resizing preserves the current meal's group.
- Browse cards have a fixed height of 420px, with no internal scrolling. Descriptions are previews; clicking the card or “Gericht & Allergene” opens the complete text and all notes in a separate details dialog. The button remains available to keyboard users. Details photos use their natural aspect ratio without cropping or hover zoom. A swipe does not open details. Each page reserves the same grid rows even for a partial last group. Off-screen groups are hidden from assistive technology and keyboard navigation.
- Cafeterias with no more meals than fit on one page need no navigation. Changing the date or cafeteria selection resets the meal pages.
- “Gerichte swipen” opens a modal picker with the loaded meals matching the selected cafeterias, date, Mittag/Abend and dietary filters. Like/reject buttons work with keyboard and mouse; horizontal swipes across the whole card support touch, with directional drag and dismissal animations. Interactive buttons are excluded from dragging. Reduced-motion users still get direct finger tracking, but without automatic slide or dismissal animations.
- The next meal is rendered directly beneath the current voting card, with its photo preloaded, so dragging the top card reveals the next meal immediately. This preview cannot receive focus or votes; it becomes the active meal only after the current vote is complete.
- The voting card fits the available viewport without internal scrolling. Long meal names are shown as a preview; “Gericht & Allergene” opens a separate, scrollable details dialog with the complete description and all notes. On short landscape displays the photo is hidden to preserve room for the meal and voting controls. The final liked-meal list can still scroll.
- At the end of a swipe session, all liked meals are listed with the cafeteria where each is served. A meal served at multiple cafeterias is evaluated separately for each cafeteria. Sold-out meals remain clearly labeled, as in the menu browser. Picks are session-only; closing the picker, restarting, or changing filters/date resets them. The picker is disabled while menus load or no meals are available; partial API failures are disclosed in the picker.
- Photos, prices, sold-out status, dietary labels, and allergen notes come from the API. Missing photos and the API’s generic promotional image receive a neutral placeholder, never an unrelated food photo. Dietary labels reflect provider notes, not inferred ingredients.
- Successful menu responses are cached in memory for five minutes. Requests run with a maximum concurrency of four; changing dates or filters cancels obsolete requests. Failed cafeterias can be retried independently of successful cached results.
- Only menu browsing and the swipe-based meal picker are implemented: no accounts, ordering, maps, advertising, or other reference-site features.
- Google Fonts provides optional typography; system fallback fonts keep the page usable if that request fails.

Data and images remain those of [Studentenwerk Dresden](https://www.studentenwerk-dresden.de/mensen/speiseplan/). This is an independent interface, not the official website.

## Browser regression checks

With the static server running, open `/tests/swipe.html`. It loads the production modules in an isolated iframe with API fixtures and simulated touch-pointer events. It checks live finger-position transforms before release, capture-loss events from nested elements, pagination, cancellation, no-scroll card layouts, full details, and voting. It does not change saved cafeteria preferences or query the live menu API. Test results appear on the page.

These checks do not replace real-device testing of native touch input, scrolling, and browser gesture arbitration.

Open `/tests/theme.html` for isolated theme checks: browser defaults, saved preferences, toggles, system changes, cross-tab changes, blocked storage, light/dark contrast and mobile layout.
