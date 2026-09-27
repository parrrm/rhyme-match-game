# Rhyme Match

Play at **https://parrrm.github.io/rhyme-match-game/**. The site is published from the `main` branch on GitHub Pages. Rooms use Firebase Realtime Database in Singapore and anonymous Firebase Authentication. Players do not need to create an account.

## Rooms and reconnection

- The host creates an eight-character room code and shares the link or QR code. The room code resolves to one Firebase record; players communicate through Firebase rather than a direct browser-to-browser connection.
- The game saves room state and scores in Firebase. A host can reload the same `?host=CODE` URL and resume the room. The guest's `?room=CODE` URL restores the same anonymous player after a reload in the same browser profile.
- If the host disconnects, the room remains saved. Players see that the host is away and can wait for the host to reconnect. The host controls round progression and judging. If the host is eliminated and chooses Spectate or Exit, control transfers to a connected player running the current game version.
- A guest who reconnects during an active round keeps their score and joins play at the next round. Disconnected players do not block the current round.
- Active rooms extend their expiry during play. Room links expire after 24 hours of inactivity. Old room data is not automatically deleted from the database; periodic cleanup is a future operational task.
- Connection help identifies an offline device, an unreachable Firebase service, an unavailable or full room, access refusal, an absent host, and a stalled room sync. The browser cannot diagnose every network failure with certainty; the guidance reflects the observable failure stage.

## Firebase configuration

`firebase-config.js` contains the public web app configuration. Access is enforced by the scoped rules in `database.rules.json`, not by hiding this configuration. Anonymous sign-in is enabled. The live database rules must stay in sync with this file when room paths change.

The game uses Firebase JavaScript SDK 12.19.0 from Google's CDN. `connection-help.js` is local and has tests in `tests/connection-help.test.cjs` (`node --test`).

## Game features

- Random targets avoid the last 18 words and last five rhyme families where possible; the host's target history is stored in that browser.
- **Quick Next Round** draws a target and starts the timer. **Choose Target** keeps manual selection available.
- Each mode has its own default or custom 7–90 second timer and at most one optional modifier. The lobby briefing updates for every player when the host changes these settings.
- **Classic Rhyme** defaults to 20 seconds. Match Prediction adds an optional pick to the answer form in rounds 6, 11, 16, and so on. Players pick who will match their own rhyme most often over that five-round window. A correct pick earns points equal to the active player count, a wrong pick loses half that amount rounded up, and Skip changes no points. Tied top partners count as correct. Rhyme Twist reveals a filtered answer challenge before the timer starts. Streak Mode rewards consecutive matching rounds.
- **Speed Round** defaults to 12 seconds. Its optional modifiers are Streak Mode, Shrinking Clock (one second less each consecutive round to a playable floor), and Chaos Timer (one 7–10 second duration selected per round). Chaos Timer uses Default Timer only.
- **Lone Wolf** can add a growing Bounty (+2, +4, …) for consecutive valid solo answers. **Sudden Death** can use Three Lives: the lowest scorer loses one life each round and is eliminated at zero. Eliminated players can Exit or Spectate without submitting or scoring.

The lobby QR code is generated in the browser from the current room link; it does not send the link to a QR service. `qrcode.js` is qrcode-generator 2.0.4 (MIT license, attribution in the bundled file).
