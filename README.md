# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/astutiseksi/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/astutiseksi/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar (model radar-2): a dashboard that ranks pre-token protocols by implied value and shows how to farm each one. It reads a frozen DefiLlama snapshot (758 protocols, 14 Nov 2026), covers all 40 watchlist protocols plus 138 early pre-token protocols below the $50M floor, and sets the 24 live-token protocols aside with their market caps. Implied value follows only from the snapshot's own figures — TVL, 7-day growth, age with no token, and chain breadth — with a readiness score (0–100) and a risk tier on every row, and a 7-step farm plan with costs and times. No token is predicted and no airdrop is promised.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser (it reads `out/data.js`, no network). The run writes `out/board.json` (178 ranked rows), `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Node.js 22.18 or later is required. Screenshots: `screenshots/1-board.png` is the board, `2-detail.png` is the detail view of rank 1, `3-filtered.png` is the board filtered to Risk Curators.

---

<sub>Entered on [make.fun](https://make.fun/?ref=7nnx3pf5&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
