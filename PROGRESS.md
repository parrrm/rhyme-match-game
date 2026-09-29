# Project refactor progress — 2026-09-27

## Current objective

Refactor the existing single-file Firebase game into browser ES modules and external CSS, add Vite dev/build scripts, keep behavior and GitHub Pages compatibility. The planned final tree was shown to the user before editing. Firebase RTDB remains the backend; no custom `/server` is needed.

## Completed

- Extracted CSS to `styles/main.css` and inline JavaScript to `client/main.js`.
- Extracted mode configuration, word bank/history/twists, host game state, scoring/predictions, and round setup/timer into `client/game/`.
- Extracted view helpers/controller, results ranking/headline, and connection guidance into `client/ui/`.
- Extracted Firebase initialization, room IDs/sessions, subscriptions, and RTDB write helpers into `client/room/roomManager.js`.
- Converted QR vendor library and Firebase config to ES imports so Vite bundles them. Root `index.html` also works as a static GitHub Pages page.
- Added `package.json`, `package-lock.json`, `.gitignore`; Vite build uses a relative base for GitHub Pages paths.
- Updated tests to import the new modules; 12/12 pass. `npm run build` succeeds. A production preview loads with CSS and no browser errors.
- Live local host + independent Chrome guest: created/joined room `M9M72LNK`, CAT/BAT on both, judging, +3 and total 3 on both results/scoreboards. Host resumed the same result after reload and showed the QR. One missing UI helper import was found and fixed before continuing.

## Final verification

- `npm test`: 12/12 pass; `npm run build`: succeeds; `npm run dev`: serves HTTP 200 and loads with no browser errors; production preview loads with CSS and QR generation.
- A second full two-browser round after RTDB write extraction: CAT/HAT, both clients reached judging and results, each earned +3 and moved from total 3 to 6. Guest reload rejoined the canonical room and saw saved results.
- The 390px mobile menu had no horizontal overflow and a 54px primary button; CSS was moved without edits. The production lobby QR rendered and its code button remained 48px high.
- No PeerJS references; `git diff --check` and JavaScript syntax checks pass.
- README updated. No remaining implementation work. Changes are local and have not been pushed or deployed.

---

# Rhyme Match mode implementation progress

Updated 2026-09-27. Continue this task when the user says “resume.”

## Objective and source

Implement `/Users/apple/.codex/attachments/0db7c4d3-3e5a-41ad-83b5-cfb1feb1b9d4/Pasted text.txt` in the existing Firebase app. The user authorized source changes and asked for this progress file. The required ten-part design specification was provided in commentary before editing. Preserve the Firebase host-authoritative answer → lock → judge → results flow and neon arcade identity. Worktree: `/Users/apple/Desktop/Parm/Projects - GPT:Codex/2026-09-23/i-x20/work/rhyme-match-publish`.

## Implemented in the working tree

- `index.html`: per-mode contextual advanced settings (one modifier, default/custom 7–90s timer); Classic 20s and Speed 12s defaults; live host/guest Game Briefing; host-authoritative `roundRule` and timer state in Firebase snapshots/messages.
- Classic Match Prediction is optional and integrated into the answer form for the first round of each five-round window. Skip is default. Correct = active player count, wrong = minus half rounded up, skip = 0. The separate vote screen/messages were removed.
- Rhyme Twist has a large family-filtered challenge pool and a distinct pre-timer reveal. Unknown targets get a broad challenge fallback. Host still judges answer validity.
- Speed Streak (+2 at second consecutive matching round, +3 at third, etc.), Shrinking Clock (down 1s per consecutive round to max(7, ceil(start × 2/3))), Chaos Timer (one random 7–10s choice per round; incompatible with Custom Timer).
- Lone Wolf Bounty adds +2, +4, … for consecutive valid solo answers. Sudden Death Three Lives costs one life for the lowest scorer per round, eliminates at zero. Active/results UI displays these states.
- Eliminated players have Exit/Spectate choices. An eliminated host can hand Firebase room authority to a capable current-code guest; old host rejoins as a spectator. The Spectate choice persists across handoff, then clears when a rematch makes that player active again.
- `tests/game-modes.test.cjs` covers timer bounds/defaults, prediction, streak, bounty, lives. Last run: 12/12 passing.
- Fixed a discovered RTDB write rejection: `results.lifeLostNames` is now always an array, so normal results persist; host reload verified this.

## Live validation already completed

- Two current-code clients completed multiple Classic rounds, including Match Prediction windows at rounds 6–10 (both Skip, zero bonus) and 11–15 (correct picks, both +2 at settlement). Results and scoreboard agreed.
- Rhyme Twist local host + older deployed guest: CAT, “starts with B,” BAT, host judged, results on both. Two current-code clients later saw the same pre-timer CAT challenge, submitted BAT/BAT, and received +3/total 3 on both results and scoreboards.
- Streak: two matching CAT/BAT rounds produced +3 then +5 on results and scoreboard. Bounty: valid solo answer yielded +6 (+4 base, +2 bounty). Three Lives: losing guest went 3→2 and both screens agreed.
- An eliminated host selected Spectate; authority moved to a current-code guest, old host rejoined as eliminated guest, both displayed the same results/players, new host could open Rematch. Eliminated guest Exit returned to menu and new host saw disconnect. Capability gate blocks stale-client handoff.
- A second host elimination confirmed Spectate persisted across navigation, then a rematch cleared it when the player became active. An initial handoff emitted Firebase permission warnings because the old host kept command/presence subscriptions after authority moved. Those listeners are now cleared before the Firebase host identity changes; a repeat handoff produced no warnings.
- Speed Shrinking synchronized 12s→11s, and Chaos synchronized a single 8s duration on both clients. Chaos was rejected under Custom Timer and accepted after switching to Default. A custom 7s Sudden Death timer appeared in the guest briefing.
- Mobile results were inspected at a 390px CSS viewport: no horizontal overflow and action buttons were at least 48px tall. The lobby had no horizontal overflow. Final inline script syntax, all 12 tests, diff checks, and the no-PeerJS search pass.
- Earlier host+guest custom 23s Classic full round completed with host/share/join/start, same score on both clients, no console errors. Normal results phase persisted after host reload.

## Completion

- Implementation was committed as `f42b91f` and pushed to `main`.
- GitHub Pages build `36322731876` completed successfully. The public page returned HTTP 200 with the new Twist challenge and handoff code at `https://parrrm.github.io/rhyme-match-game/`.
- No remaining implementation work for this request. New requests can start from the current `main` branch.

## Notes

- Existing repo remote: `https://github.com/parrrm/rhyme-match-game.git`, main. Previous version before this work was `b9f15d6`.
- Previous disposable Firebase test room `Q3B5UMSE` is no longer needed.
- No new networking infrastructure or PeerJS code has been introduced.

---

# Word-bank integration progress — 2026-09-29

- Audited both supplied pasted files; they are identical proposed `rhymeBank.js` sources. The project actually uses `client/game/words.js`.
- Traced consumers in `client/main.js`, `client/game/gameState.js`, and `client/game/rounds.js`; the host remains the authoritative rhyme judge.
- Curated the proposed 167 tiered families to 2,475 pronunciation-supported family words. Removed unsupported, dictionary-uncovered, accent-sensitive, heteronym, and age-inappropriate pairings; split the `DOG` and `FROG` pronunciation groups. `core`, `longWords`, and all legacy exports remain.
- Added `FAMILY_TIERS`, `TIER_OF`, `TARGET_POOLS`, `getRhymes`, and `isKnownRhyme`, family-first difficulty selection, recent history with blocked-storage fallback, and bank-backed twist eligibility. Custom targets receive no invented twist prompt.
- Fixed the missing `QUALITY_WORDS` import used by the random-word animation. Added `tests/words.test.cjs` for uniqueness, tiers, rhyme lookups, cooldowns, twists, and storage failure.
- `npm test`, `npm run build`, `node --check`, and local Vite browser load with zero console errors passed.
