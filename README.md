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

Publish `index.html`, `styles.css`, `app.js`, `theme.js`, `meal-filters.js`, `meal-picker.js`, `meal-slot.js`, `swipe.js`, `calendar.js`, and `favicon.svg` together on any HTTPS static host (including GitHub Pages). All asset paths are relative, so subdirectory deployments work.

Development and testing happen in a local checkout on the desktop (`~/Projects/mensa`). Production runs on the Raspberry Pi, served from `/var/www/mensa`; publishing is a push here followed by a pull on the Pi:

```sh
git push origin main
ssh pi 'cd /var/www/mensa && git pull'
```

## Data and scope

- Cafeterias and dated menus are fetched directly in the browser from https://api.studentenwerk-dresden.de/openmensa/v2. The official API permits cross-origin requests.
- The initial date is today before 19:00 and tomorrow from 19:00 in `Europe/Berlin`, advanced to Monday if it falls on a weekend. Week navigation and the date picker request menus for the chosen date; unpublished dates show an explicit empty state. A Saturday or Sunday entered in the native date picker also advances to Monday.
- The date strip shows five weekdays, never Saturday or Sunday. On mobile, swipe horizontally to browse five weekdays forward/back, or use the arrows to shift the strip by one weekday. Browsing does not request menus until a date is tapped. Desktop shows Monday–Friday with week arrows. Today has an accent-colored border even when selected; date animations respect reduced motion.
- Cafeteria visibility is saved in local storage on the visitor’s device. All cafeterias are selected initially. The compact “Mensen” disclosure opens the full filter list without changing the selection.
- The header’s sun/moon button toggles dark mode. Without a saved choice, the theme follows the browser’s `prefers-color-scheme`, including changes while the page is open. A manual choice is saved locally under `mensa-theme-v1` and takes priority on later visits. Switching also works if storage is blocked; removing that stored preference restores system-following mode. Theme changes synchronize across tabs. The theme is applied before loading the stylesheet to avoid a light-theme flash.
- Cafeteria addresses are not displayed. “Route” uses Apple Maps on iPhones and Google Maps on other devices, with the cafeteria’s official API address as the destination. The HTTPS Maps link opens in a new tab or the installed Maps app, as handled by the device. The visitor chooses their starting point in Maps. Cafeterias without an address have no route link.
- The Mittag/Abend switch separates lunch from evening meals. An `Abendangebot` prefix in the API category or meal name identifies evening meals. At page opening, defaults use `Europe/Berlin` (including daylight saving time): before 15:00, today's lunch; 15:00–18:59, today's evening menu; from 19:00, tomorrow's lunch menu. Any weekend date advances to Monday. Manual changes remain selected across date/filter changes, but are not persisted across reloads or overridden by a timer.
- The three icon buttons “Fleisch/Fisch”, “Vegetarisch”, and “Vegan” are independent checkbox selections. All start selected; selected groups combine using OR, and selecting none shows an explicit empty state. Vegan and vegetarian are separate groups: exact provider vegan notes take priority, then exact vegetarian notes. Dishes without either label belong to “Fleisch/Fisch”; this fallback is not proof that they contain meat. No classification is inferred from meal names or ingredients.
- “Allergene & Zusatzstoffe” offers every code found in parenthesized lists in the loaded meal titles, with descriptions taken from provider notes where available. Selecting a code excludes dishes carrying that exact code (A does not automatically match A1); numeric additive codes are also supported. Excluding several codes hides a dish if any match. Reset clears all exclusions. Selected exclusions remain removable if they are absent from another date/cafeteria. Options use raw loaded menus, not already filtered results, so exclusions cannot hide their own controls.
- Dietary groups and code exclusions combine with date, cafeteria and Mittag/Abend filters for both the menu browser and swipe picker. They stay selected across other filter changes, but reset on reload. Cached raw responses are reused. Only codes explicitly written in titles are matched; absent or incomplete labels are not an allergy-safety guarantee. Always consult the provider’s full information.
- “Tom-View” opens the main page in a continuous style: one grid of all dishes, five cards wide on desktop, two on tablets, and two on phones with cards sized to their content, each card labelled with its cafeteria, keeping the selected date and Mittag/Abend state. A small slider next to the Tom-View button (visible only while Tom-View is active) switches to the weekly view, which shows only the evening meals of the selected week (Monday–Friday) in the same continuous style, each card labelled with its weekday and cafeteria. Weekend menus are neither requested nor displayed. Both views retain cafeteria, dietary and price selections. In the weekly view, days without matching published offers simply contribute no cards, and failed requests are collected in one retry banner above the grid. In the weekly view arrows and mobile date swipes change the week; in the day view they step between weekdays like the normal page. The Mittag/Abend switch is locked to Abend in the weekly view and stays active as on the main page in the day view; leaving Tom-View restores its previous value. The single-day swipe and random pickers are hidden until returning to day view so meals from different dates cannot be confused. Week requests share the existing five-minute cache and four-request concurrency limit. The normal weekday-only date strip is unchanged.
- Each meal in the Tom-View weekly view has a “zum Kalender hinzufügen” button with a calendar icon, also available in its details dialog. It downloads a standard `.ics` calendar event with the meal title, cafeteria name/address and that meal's displayed date. Times always represent 17:30–19:00 in `Europe/Berlin`, converted to UTC with the correct summer/winter offset so imports work in other time zones. The calendar app still requires the user to open/import and confirm the event; the website does not directly access a calendar account.
- The “Student / Bediensteter / Gäste” price selector defaults to Student on each page load. Each card shows only the selected category’s published price (or “Keine Preisangabe” if unavailable). Both the Dresden API’s German price keys and standard OpenMensa keys are supported. Changing category updates prices in place, without fetching menus or resetting meal pages; the selection is retained across the other filters and dates.
- Cafeterias without matching meals are omitted; a clear empty state appears when none match. Failed cafeterias remain visible with retry controls. Raw cached API responses are shared between lunch and evening views, so switching does not discard either set of meals.
- Each cafeteria shows up to three meals at a time on desktop/tablet, in API order. On mobile (up to 560px wide), it shows two meals in one row at a time, cards sized to their content: horizontal finger gestures move the page continuously with the finger, then advance or snap back. Both distance and quick flicks can complete a swipe. Previous/next buttons remain as an accessible alternative. Tiny, cancelled and vertical gestures do not change the page; pagination stops at the ends. Resizing preserves the current meal's group.
- Browse cards on desktop/tablet have a fixed height of 420px, with no internal scrolling. On phones (up to 560px wide), cards size to their content, so a row takes as much height as its tallest meal needs. Descriptions are previews; clicking the card, or focusing it and pressing Enter or Space, opens the complete text and all notes in a separate details dialog. Details photos use their natural aspect ratio without cropping or hover zoom. A swipe does not open details. On larger screens each page reserves the same grid rows even for a partial last group. Off-screen groups are hidden from assistive technology and keyboard navigation.
- Cafeterias with no more meals than fit on one page need no navigation. Changing the date or cafeteria selection resets the meal pages.
- “Gerichte swipen” opens a modal picker with the loaded meals matching the selected cafeterias, date, Mittag/Abend and dietary filters. Like/reject buttons work with keyboard and mouse; horizontal swipes across the whole card support touch, with directional drag and dismissal animations. Interactive buttons are excluded from dragging. Reduced-motion users still get direct finger tracking, but without automatic slide or dismissal animations.
- The next meal is rendered directly beneath the current voting card, with its photo preloaded, so dragging the top card reveals the next meal immediately. This preview cannot receive focus or votes; it becomes the active meal only after the current vote is complete.
- The voting card fits the available viewport without internal scrolling. Long meal names are shown as a preview; clicking the card, or focusing it and pressing Enter or Space, opens a separate, scrollable details dialog with the complete description and all notes. On short landscape displays the photo is hidden to preserve room for the meal and voting controls. The final liked-meal list can still scroll.
- At the end of a swipe session, all liked meals are listed with the cafeteria where each is served. A meal served at multiple cafeterias is evaluated separately for each cafeteria. Sold-out meals remain clearly labeled, as in the menu browser. Picks are session-only; closing the picker, restarting, or changing filters/date resets them. The picker is disabled while menus load or no meals are available; partial API failures are disclosed in the picker.
- “Zufallsgericht” opens a slot machine using exactly the same filtered meal/cafeteria pairs as the swipe picker. Pull its handle with a click, tap, Enter or Space to select one pair uniformly with `Math.random`. Each meal counts once per cafeteria serving it; cafeterias with more matching meals therefore have a greater total chance. A decorative vertical reel decelerates onto the independently chosen result, displaying the meal, cafeteria and selected price. Repeated pulls are disabled during a spin; closing or changing filters/date cancels it. No extra API requests or saved picks are involved. Sold-out dishes stay labeled, and unavailable cafeterias are disclosed. Reduced-motion users get the result immediately without automatic motion.
- During the slot animation, only full-height meal photos (or the neutral missing-photo illustration) are shown. Photos use `object-fit: contain`, without cropping or hover zoom; the actual landing image is retained at the same size after the reel stops. The description slides upward over the photo on a translucent, blurred panel, with the cafeteria name above. The handle has a downward pull/hold/spring-return motion and a shaft anchored to its base. Confetti launches from both sides, follows gravity-like arcs and flutters as it falls. Its particles are removed automatically or when spinning again, closing, changing filters/date, or enabling reduced motion. Reduced-motion users get the result and description immediately without automatic animation or confetti.
- Photos, prices, sold-out status, dietary labels, and allergen notes come from the API. Missing photos and the API’s generic promotional image receive a neutral placeholder, never an unrelated food photo. Dietary labels reflect provider notes, not inferred ingredients.
- Successful menu responses are cached in memory for five minutes. Requests run with a maximum concurrency of four; changing dates or filters cancels obsolete requests. Failed cafeterias can be retried independently of successful cached results.
- Only menu browsing, the swipe picker and random meal selection are implemented: no accounts, ordering, advertising, or other reference-site features.
- Google Fonts provides optional typography; system fallback fonts keep the page usable if that request fails.

Data and images remain those of [Studentenwerk Dresden](https://www.studentenwerk-dresden.de/mensen/speiseplan/). This is an independent interface, not the official website.

## Browser regression checks

With the static server running, open `/tests/swipe.html`. It loads the production modules in an isolated iframe with API fixtures and simulated touch-pointer events. It checks live finger-position transforms before release, capture-loss events from nested elements, pagination, cancellation, no-scroll card layouts, full details, and voting. It does not change saved cafeteria preferences or query the live menu API. Test results appear on the page.

These checks do not replace real-device testing of native touch input, scrolling, and browser gesture arbitration.

Open `/tests/theme.html` for isolated theme checks: browser defaults, saved preferences, toggles, system changes, cross-tab changes, blocked storage, light/dark contrast and mobile layout.

Open `/tests/tom.html` for Tom-View checks: the continuous main-page-style day view with cafeteria labels, Monday–Friday only (no weekend requests), the flat weekly grid with day/cafeteria card labels, hidden cafeterias, evening-only menus, price/dietary selections, partial failures and retry, caching, request cancellation/concurrency, year boundaries, the Tag/Woche layout slider, responsive layout and restoration of the single-day view. It also verifies calendar downloads, meal/date/location mapping, summer/winter/DST event times, safe iCalendar text escaping and Unicode line folding. Opening/importing the downloaded event in a native calendar app remains a manual check.

Open `/tests/slot.html` for isolated slot-machine checks: handle/reel animation, selections across cafeterias, active filters/prices, cancellation, empty selections, reduced motion, responsive layouts and dark mode.
