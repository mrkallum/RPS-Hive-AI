/**
 * Mother AI — Hive Brain
 * Central learning engine. Observes all human matches, builds population model,
 * weaponizes collective knowledge against individual players.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MOVES   = ['rock', 'paper', 'scissors'];
const COUNTER = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
const STATE_FILE = path.join(__dirname, 'mother_state.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function softmax(q, temp = 0.5) {
    const exps = {};
    let total = 0;
    for (const m of MOVES) {
        exps[m] = Math.exp(q[m] / temp);
        total  += exps[m];
    }
    let r = Math.random() * total, acc = 0;
    for (const m of MOVES) {
        acc += exps[m];
        if (r <= acc) return m;
    }
    return MOVES[MOVES.length - 1];
}

function entropy(counts, total) {
    if (total < 5) return 1;
    let H = 0;
    for (const m of MOVES) {
        const p = (counts[m] || 0) / total;
        if (p > 0) H -= p * Math.log2(p);
    }
    return H / Math.log2(3); // normalised [0,1]
}

function argmax(obj) {
    return Object.keys(obj).reduce((a, b) => obj[a] > obj[b] ? a : b);
}

// ─── Default State ───────────────────────────────────────────────────────────

function defaultState() {
    return {
        // Global population move frequencies
        globalCounts: { rock: 0, paper: 0, scissors: 0 },

        // Markov chains — population level
        trans1: {},   // prev_move → { next: count }
        trans2: {},   // prev2_prev1 → { next: count }

        // Q-values (population aggregate)
        q: { rock: 0, paper: 0, scissors: 0 },

        // Per-player profiles keyed by playerHash
        players: {},

        // Total observations ingested
        totalObservations: 0,
    };
}

// ─── Mother Class ────────────────────────────────────────────────────────────

class Mother {
    constructor() {
        this.state = this._load();
        this._savePending = false;
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    _load() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const raw = fs.readFileSync(STATE_FILE, 'utf8');
                return { ...defaultState(), ...JSON.parse(raw) };
            }
        } catch (e) {
            console.error('[Mother] State load failed, starting fresh:', e.message);
        }
        return defaultState();
    }

    _scheduleSave() {
        if (this._savePending) return;
        this._savePending = true;
        // Debounce: write at most once per second
        setTimeout(() => {
            try {
                fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
            } catch (e) {
                console.error('[Mother] Save failed:', e.message);
            }
            this._savePending = false;
        }, 1000);
    }

    // ── Player Profiles ───────────────────────────────────────────────────────

    _getPlayer(hash) {
        if (!this.state.players[hash]) {
            this.state.players[hash] = {
                counts:  { rock: 0, paper: 0, scissors: 0 },
                history: [],         // last 30 moves
                trans1:  {},
                trans2:  {},
                games:   0,
                entropy: 1,
                style:   'unknown',  // aggressive | repetitive | reactive | random
            };
        }
        return this.state.players[hash];
    }

    _classifyStyle(player) {
        const { counts, history } = player;
        const total = player.games;
        if (total < 5) return 'unknown';

        // Repetitive: last 5 moves are dominated by one choice
        if (history.length >= 5) {
            const last5 = history.slice(-5);
            const dominant = last5.filter(m => m === last5[0]).length;
            if (dominant >= 4) return 'repetitive';
        }

        // Aggressive: one move > 60% of total
        for (const m of MOVES) {
            if (counts[m] / total > 0.6) return 'aggressive';
        }

        // Random: entropy > 0.9
        if (player.entropy > 0.9) return 'random';

        return 'reactive';
    }

    // ── Core Observation ─────────────────────────────────────────────────────

    /**
     * Ingest one move from a player.
     * Called for every move in every match (human vs human, human vs AI).
     */
    observe(playerHash, move, prevMove = null, prev2Move = null) {
        if (!MOVES.includes(move)) return;

        const s      = this.state;
        const player = this._getPlayer(playerHash);

        // Global counts
        s.globalCounts[move]++;
        s.totalObservations++;

        // Player counts
        player.counts[move]++;
        player.games++;

        // Player history (capped at 50)
        player.history.push(move);
        if (player.history.length > 50) player.history.shift();

        // Population 1-gram transitions
        if (prevMove && MOVES.includes(prevMove)) {
            if (!s.trans1[prevMove]) s.trans1[prevMove] = {};
            s.trans1[prevMove][move] = (s.trans1[prevMove][move] || 0) + 1;

            // Player-level 1-gram
            if (!player.trans1[prevMove]) player.trans1[prevMove] = {};
            player.trans1[prevMove][move] = (player.trans1[prevMove][move] || 0) + 1;
        }

        // Population 2-gram transitions
        if (prevMove && prev2Move && MOVES.includes(prev2Move)) {
            const bigram = `${prev2Move}_${prevMove}`;
            if (!s.trans2[bigram]) s.trans2[bigram] = {};
            s.trans2[bigram][move] = (s.trans2[bigram][move] || 0) + 1;

            // Player-level 2-gram
            if (!player.trans2[bigram]) player.trans2[bigram] = {};
            player.trans2[bigram][move] = (player.trans2[bigram][move] || 0) + 1;
        }

        // Q-learning update on population level
        // Reward signal: inverse of global bias — moves that beat population's favourite are "good"
        const globalFavourite = argmax(s.globalCounts);
        const reward = move === COUNTER[globalFavourite] ? 1 : move === globalFavourite ? 0 : 0.5;
        const lr = 0.05;
        s.q[move] += lr * (reward - s.q[move]);
        s.q[move]  = Math.max(-1, Math.min(1, s.q[move]));

        // Recalculate player entropy + style
        const playerTotal = player.games;
        player.entropy = entropy(player.counts, playerTotal);
        player.style   = this._classifyStyle(player);

        this._scheduleSave();
    }

    // ── Anti-Poisoning ────────────────────────────────────────────────────────

    /**
     * Confidence weight for a player — frequent, varied players count more.
     * Spammers (low entropy) get down-weighted.
     * Range: 0.1 – 1.0
     */
    _playerWeight(player) {
        const gamesFactor    = Math.min(1, player.games / 50);          // ramps up to 1 over 50 games
        const entropyFactor  = 0.3 + 0.7 * player.entropy;             // spammers: 0.3, varied: 1.0
        return Math.max(0.1, gamesFactor * entropyFactor);
    }

    // ── Prediction Engine ─────────────────────────────────────────────────────

    /**
     * Predict a specific player's next move.
     * Layers: player 2-gram → player 1-gram → population 2-gram → population 1-gram → global bias
     */
    predictPlayer(playerHash, history) {
        const player = this._getPlayer(playerHash);
        const h = history || player.history;
        const s = this.state;

        const sources = [];

        // Player 2-gram (strongest signal, most specific)
        if (h.length >= 2) {
            const bigram = `${h[h.length - 2]}_${h[h.length - 1]}`;
            const counts = player.trans2[bigram];
            if (counts) {
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                if (total >= 3) {
                    sources.push({ move: argmax(counts), confidence: total / (total + 5), source: 'player-2gram' });
                }
            }
        }

        // Player 1-gram
        if (h.length >= 1) {
            const last   = h[h.length - 1];
            const counts = player.trans1[last];
            if (counts) {
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                if (total >= 2) {
                    sources.push({ move: argmax(counts), confidence: total / (total + 8), source: 'player-1gram' });
                }
            }
        }

        // Population 2-gram
        if (h.length >= 2) {
            const bigram = `${h[h.length - 2]}_${h[h.length - 1]}`;
            const counts = s.trans2[bigram];
            if (counts) {
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                if (total >= 5) {
                    sources.push({ move: argmax(counts), confidence: (total / (total + 10)) * 0.7, source: 'pop-2gram' });
                }
            }
        }

        // Population 1-gram
        if (h.length >= 1) {
            const last   = h[h.length - 1];
            const counts = s.trans1[last];
            if (counts) {
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                if (total >= 3) {
                    sources.push({ move: argmax(counts), confidence: (total / (total + 15)) * 0.5, source: 'pop-1gram' });
                }
            }
        }

        // Global bias (weakest — population favourite)
        if (s.totalObservations >= 10) {
            sources.push({ move: argmax(s.globalCounts), confidence: 0.2, source: 'global-bias' });
        }

        if (sources.length === 0) return null;

        // Weighted vote across prediction sources
        const votes = { rock: 0, paper: 0, scissors: 0 };
        for (const src of sources) {
            votes[src.move] += src.confidence;
        }

        const predicted = argmax(votes);
        const topConf   = Math.max(...Object.values(votes));

        return { predicted, counter: COUNTER[predicted], confidence: topConf, sources };
    }

    // ── Choose Move Against Player ────────────────────────────────────────────

    choose(playerHash, history) {
        const player     = this._getPlayer(playerHash);
        const prediction = this.predictPlayer(playerHash, history);
        const H          = player.entropy;
        const exploitP   = 1 - H;

        // Base epsilon decays with games, then further shrunk by exploit pressure
        const baseEps    = Math.max(0.05, 0.2 - (player.games / 100) * 0.15);
        const epsilon    = baseEps * (1 - exploitP * 0.6);
        const temp       = Math.max(0.3, 0.9 - player.games * 0.004);

        let move;

        if (prediction && Math.random() > epsilon) {
            move = prediction.counter;
        } else if (Math.random() < epsilon) {
            move = MOVES[Math.floor(Math.random() * 3)];
        } else {
            move = softmax(this.state.q, temp);
        }

        return { move, prediction, epsilon, exploitPressure: exploitP, playerStyle: player.style };
    }

    // ── Public Stats ─────────────────────────────────────────────────────────

    getStats() {
        const s = this.state;
        const totalMoves = Object.values(s.globalCounts).reduce((a, b) => a + b, 0);
        const playerCount = Object.keys(s.players).length;

        const globalBias = {};
        for (const m of MOVES) {
            globalBias[m] = totalMoves > 0 ? (s.globalCounts[m] / totalMoves * 100).toFixed(1) : '0.0';
        }

        return {
            totalObservations: s.totalObservations,
            totalPlayers: playerCount,
            globalBias,
            qValues: s.q,
        };
    }

    getPlayerProfile(hash) {
        const p = this.state.players[hash];
        if (!p) return null;
        const total = p.games;
        return {
            games:   p.games,
            entropy: p.entropy,
            style:   p.style,
            bias: {
                rock:     total > 0 ? (p.counts.rock     / total * 100).toFixed(1) : '0.0',
                paper:    total > 0 ? (p.counts.paper    / total * 100).toFixed(1) : '0.0',
                scissors: total > 0 ? (p.counts.scissors / total * 100).toFixed(1) : '0.0',
            },
            weight: this._playerWeight(p),
        };
    }
}

module.exports = new Mother();
