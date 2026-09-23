# Rhyme Match

Play at **https://parrrm.github.io/rhyme-match-game/**. A host can open a room and use **Copy join link**; the link fills in the room code for guests. This repository is deployed with GitHub Pages from the `main` branch. The PeerJS browser library is bundled with the site.

No account, build step, database, or app installation is needed. Players need a current browser and an internet connection. The game uses PeerJS for peer-to-peer multiplayer and its default signaling service. Some restrictive networks may block a direct connection; if that becomes common, add a TURN relay or migrate room state to a managed realtime service.

The recent target and rhyme-family history is stored in the host browser's local storage. Clearing browser data resets it. Multiplayer requires the host to keep the browser tab open.

## Game changes in this version

- Random targets avoid the last 18 words and last 5 rhyme families where possible; the host's history persists in that browser.
- **Quick Next Round** draws a target and starts the timer. **Choose Target** keeps manual selection available.
- The room link fills in the code on the join screen. Players still choose a nickname and press **Join Game**.
- Connection status and the live count of submitted answers are visible.
- After rounds 5, 10, 15, and so on, active players may predict which *other* player will match their own submitted rhyme most often over the next five rounds. A correct pick earns points equal to the number of active players when the prediction was made. A wrong pick loses half that amount, rounded up. Skipping changes no points. Tied top partners count as correct; if the player has no matches, a non-skipped pick is wrong. Predictions settle at the end of the five-round window or at game end.
