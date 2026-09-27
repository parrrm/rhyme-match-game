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
