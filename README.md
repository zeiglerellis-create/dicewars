# Dice Wars

A single-page **Dice Wars** style game: **30–100** connected hexes, four players (you are Player 1; others are bots), setup → placement → battle until one player controls every hex.

## Run

```bash
cd dice-wars
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build   # production build
npm run preview # serve build
npm test        # Vitest unit tests
```

## Rules summary

1. **Setup** — Choose **hex count** (30–100), **Apply size** to generate a map, then **New map** / **Shuffle owners** until you like it. **Start game** begins placement. **New game** / **Reset** / **Play again** use the current hex count (Reset and New game regenerate a fresh random map).

2. **Board** — Random connected blob (not a rectangle). Each cell starts with **1** die and a shuffled four-player ownership.

3. **Toolbar** — Phase, player, hex count, setup actions, **End turn**, **Reset**, **New game**, and **zoom** (− / Fit / +). The map is **full width** below the toolbar; scroll wheel and middle-drag still work on the canvas.

4. **Phase 1 — Placement (snake, two rounds)** — Each player places **10** dice: **two** turns, **5 dice per click** on **any one hex they own** (whole stack on a single hex; you may choose a different hex each turn). Order: **`1 → 2 → 3 → 4 → 4 → 3 → 2 → 1`**.

5. **Phase 2 — Battle** — Turns cycle `1 → 2 → 3 → 4`. Attack any number of times, then **End turn**.
   - Your hex (≥ **2** dice), then adjacent enemy.
   - Rolls: one **d6** per die on each side; higher wins; **ties → defender**.
   - **Win:** attacker → **1** die; captured hex yours with **(old attacker − 1)** dice.
   - **Lose/tie:** attacker → **1**; defender unchanged.

6. **Reinforcement** — After **End turn**, you gain dice equal to your **largest connected** group of owned hexes. They are placed **automatically at random** among your hexes (no manual step).

7. **Win** — One player owns every hex.

The UI is **dark mode** throughout. There is **no seed field**; maps and rolls use in-browser randomness.

## Bot behavior

- **Placement:** Favors border / pressure / low stacks.
- **Battle:** Monte Carlo win odds (200 trials), threshold 55%, then component growth heuristic.
- **Reinforcement:** Handled by the same auto-random rule as humans.

## Tech

Vite, React 19, TypeScript, HTML5 **Canvas**. Logic in `src/engine/`; UI in `src/ui/`.
