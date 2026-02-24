# RPS Hive 🐝

A collective intelligence Rock Paper Scissors engine.
Mother AI silently observes every human match and weaponizes that knowledge against you.

## Architecture

```
server.js        — HTTP + WebSocket server (zero dependencies, pure Node)
mother.js        — Hive brain: learning engine, observation ingestion, prediction
public/index.html — Frontend: AI match + multiplayer rooms + live insight panel
mother_state.json — Persisted AI state (auto-created on first run)
```

## Setup

Requires Node.js 18+. No npm install needed — zero external dependencies.

```bash
node server.js
# or for auto-restart on file changes:
node --watch server.js
```

Open http://localhost:3000

## How it works

### Observer Mode
Every human move in every match (AI or multiplayer) is ingested by Mother AI:
- Updates global population move frequencies
- Updates per-player 1-gram and 2-gram Markov chains
- Recalculates player entropy and style classification
- Adjusts population Q-values

### Prediction Stack (priority order)
1. Player-level 2-gram  — your specific bigram pattern (strongest)
2. Player-level 1-gram  — your last-move tendency
3. Population 2-gram    — what humans do after this sequence globally
4. Population 1-gram    — what humans do after this move globally
5. Global bias          — population's most common move (weakest)

### Anti-Poisoning
- Players are confidence-weighted by games played and entropy
- Spammers (low entropy, repetitive play) are down-weighted up to 70%
- Minimum sample thresholds before Markov predictions are trusted

### Entropy-driven exploit
- Shannon entropy of your move history, normalised to [0,1]
- Low entropy (predictable) → AI reduces ε by up to 60%, exploits harder
- High entropy (chaotic) → AI explores more, relies on population data

## Multiplayer Rooms
- Create a room → share the 6-character code
- Second player joins → game starts automatically
- Mother AI observes both players silently each round
- Both player profiles are updated and returned after each round

## API
- `GET /` — serves the frontend
- `GET /stats` — Mother AI population stats (JSON)
- WebSocket at `ws://localhost:3000` — all game logic

## WebSocket Protocol

### Client → Server
```json
{ "type": "identify",    "hash": "...", "name": "..." }
{ "type": "ai_move",     "move": "rock" }
{ "type": "create_room" }
{ "type": "join_room",   "room": "ABC123" }
{ "type": "move",        "move": "paper" }
{ "type": "leave_room" }
```

### Server → Client
```json
{ "type": "connected",      "hash": "...", "stats": {...} }
{ "type": "ai_result",      "humanMove": "...", "aiMove": "...", "outcome": "...", ... }
{ "type": "room_created",   "room": "..." }
{ "type": "room_joined",    "room": "..." }
{ "type": "game_start",     "room": "..." }
{ "type": "room_state",     "players": [...], ... }
{ "type": "round_result",   "moves": {...}, "winner": "...", "profiles": {...} }
{ "type": "error",          "msg": "..." }
```
