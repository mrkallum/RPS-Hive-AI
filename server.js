/**
 * RPS Hive — Server
 * Pure Node.js, zero dependencies.
 * HTTP serves the frontend. WebSocket handles all real-time game logic.
 */

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const net    = require('net');

const mother = require('./mother');

const PORT = process.env.PORT || 3000;

// ─── WebSocket Implementation (no ws package) ────────────────────────────────

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsHandshake(req, socket) {
    const key     = req.headers['sec-websocket-key'];
    const accept  = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
}

function wsDecodeFrame(buf) {
    if (buf.length < 2) return null;
    const fin    = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let   payLen = buf[1] & 0x7f;
    let   offset = 2;

    if (payLen === 126) { payLen = buf.readUInt16BE(2); offset = 4; }
    else if (payLen === 127) { payLen = Number(buf.readBigUInt64BE(2)); offset = 10; }

    if (buf.length < offset + (masked ? 4 : 0) + payLen) return null;

    let payload;
    if (masked) {
        const mask = buf.slice(offset, offset + 4);
        offset += 4;
        payload = Buffer.alloc(payLen);
        for (let i = 0; i < payLen; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
    } else {
        payload = buf.slice(offset, offset + payLen);
    }

    return { fin, opcode, payload, totalLength: offset + payLen };
}

function wsEncodeFrame(data) {
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const len     = payload.length;
    let   header;

    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text opcode
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }

    return Buffer.concat([header, payload]);
}

function wsSend(socket, msg) {
    if (!socket.writable) return;
    try { socket.write(wsEncodeFrame(msg)); } catch (_) {}
}

function wsClose(socket) {
    if (!socket.writable) return;
    try { socket.write(Buffer.from([0x88, 0x00])); } catch (_) {}
    socket.destroy();
}

// ─── Room Manager ────────────────────────────────────────────────────────────

const rooms   = new Map();   // roomId → Room
const clients = new Map();   // socket → ClientState

function generateId(len = 6) {
    return crypto.randomBytes(len).toString('hex').slice(0, len).toUpperCase();
}

class Room {
    constructor(id) {
        this.id        = id;
        this.players   = [];   // [{ socket, hash, name, ready, move, history }]
        this.round     = 0;
        this.scores    = {};
        this.phase     = 'waiting'; // waiting | choosing | result
        this.createdAt = Date.now();
    }

    addPlayer(socket, hash, name) {
        if (this.players.length >= 2) return false;
        this.players.push({ socket, hash, name, ready: false, move: null, history: [], prev2: null, prev1: null });
        this.scores[hash] = 0;
        return true;
    }

    removePlayer(socket) {
        this.players = this.players.filter(p => p.socket !== socket);
    }

    isFull()  { return this.players.length === 2; }
    isEmpty() { return this.players.length === 0; }

    broadcast(msg) {
        for (const p of this.players) wsSend(p.socket, msg);
    }

    broadcastState() {
        this.broadcast({
            type: 'room_state',
            room: this.id,
            round: this.round,
            phase: this.phase,
            players: this.players.map(p => ({
                name:  p.name,
                score: this.scores[p.hash],
                ready: p.ready,
            })),
            motherStats: mother.getStats(),
        });
    }

    submitMove(socket, move) {
        const player = this.players.find(p => p.socket === socket);
        if (!player || this.phase !== 'choosing') return;
        if (!['rock', 'paper', 'scissors'].includes(move)) return;

        player.move  = move;
        player.ready = true;

        this.broadcast({ type: 'player_ready', name: player.name });

        if (this.players.every(p => p.ready)) {
            this._resolveRound();
        }
    }

    _resolveRound() {
        const [a, b] = this.players;
        this.round++;

        const result = outcome(a.move, b.move);
        if      (result === 1)   this.scores[a.hash]++;
        else if (result === 0)   this.scores[b.hash]++;

        // Mother AI observes both players
        mother.observe(a.hash, a.move, a.prev1, a.prev2);
        mother.observe(b.hash, b.move, b.prev1, b.prev2);

        // Update per-player history
        for (const p of [a, b]) {
            p.prev2   = p.prev1;
            p.prev1   = p.move;
            p.history.push(p.move);
            if (p.history.length > 50) p.history.shift();
        }

        const roundResult = {
            type:    'round_result',
            round:   this.round,
            moves:   { [a.name]: a.move, [b.name]: b.move },
            winner:  result === 1 ? a.name : result === 0 ? b.name : null,
            scores:  { [a.name]: this.scores[a.hash], [b.name]: this.scores[b.hash] },
            // Mother AI profiles of each player after observation
            profiles: {
                [a.name]: mother.getPlayerProfile(a.hash),
                [b.name]: mother.getPlayerProfile(b.hash),
            },
        };

        this.broadcast(roundResult);

        // Reset for next round
        for (const p of this.players) { p.move = null; p.ready = false; }
        this.phase = 'choosing';
        setTimeout(() => this.broadcastState(), 200);
    }

    startGame() {
        this.phase = 'choosing';
        this.broadcast({ type: 'game_start', room: this.id });
        this.broadcastState();
    }
}

function outcome(a, b) {
    if (a === b) return 0.5;
    if ((a==='rock'&&b==='scissors')||(a==='paper'&&b==='rock')||(a==='scissors'&&b==='paper')) return 1;
    return 0;
}

// ─── AI Match Session ─────────────────────────────────────────────────────────

class AISession {
    constructor(socket, hash, name) {
        this.socket  = socket;
        this.hash    = hash;
        this.name    = name;
        this.history = [];
        this.prev1   = null;
        this.prev2   = null;
        this.scores  = { human: 0, ai: 0, draw: 0 };
        this.round   = 0;
    }

    play(humanMove) {
        const chosen  = mother.choose(this.hash, this.history);
        const aiMove  = chosen.move;
        const r       = outcome(aiMove, humanMove);
        this.round++;

        if      (r === 1)   this.scores.ai++;
        else if (r === 0)   this.scores.human++;
        else                this.scores.draw++;

        // Mother observes the human
        mother.observe(this.hash, humanMove, this.prev1, this.prev2);

        this.prev2 = this.prev1;
        this.prev1 = humanMove;
        this.history.push(humanMove);
        if (this.history.length > 50) this.history.shift();

        const profile    = mother.getPlayerProfile(this.hash);
        const prediction = mother.predictPlayer(this.hash, this.history);

        wsSend(this.socket, {
            type:         'ai_result',
            round:        this.round,
            humanMove,
            aiMove,
            outcome:      r === 1 ? 'ai_wins' : r === 0 ? 'human_wins' : 'draw',
            scores:       this.scores,
            aiDecision:   chosen,
            playerProfile: profile,
            nextPrediction: prediction,
            motherStats:  mother.getStats(),
        });
    }
}

// ─── Message Handlers ─────────────────────────────────────────────────────────

function handleMessage(socket, msg) {
    const client = clients.get(socket);
    if (!client) return;

    const { type } = msg;

    // ── AI Match ─────────────────────────────────────────────────────────────
    if (type === 'ai_move') {
        if (!client.aiSession) {
            client.aiSession = new AISession(socket, client.hash, client.name || 'Player');
        }
        client.aiSession.play(msg.move);
        return;
    }

    // ── Create Room ──────────────────────────────────────────────────────────
    if (type === 'create_room') {
        if (client.room) leaveRoom(socket);
        const roomId = generateId();
        const room   = new Room(roomId);
        rooms.set(roomId, room);
        room.addPlayer(socket, client.hash, client.name);
        client.room = roomId;
        wsSend(socket, { type: 'room_created', room: roomId });
        room.broadcastState();
        return;
    }

    // ── Join Room ────────────────────────────────────────────────────────────
    if (type === 'join_room') {
        const roomId = (msg.room || '').toUpperCase();
        const room   = rooms.get(roomId);
        if (!room) { wsSend(socket, { type: 'error', msg: 'Room not found.' }); return; }
        if (room.isFull()) { wsSend(socket, { type: 'error', msg: 'Room is full.' }); return; }
        if (client.room) leaveRoom(socket);

        room.addPlayer(socket, client.hash, client.name);
        client.room = roomId;
        wsSend(socket, { type: 'room_joined', room: roomId });
        room.broadcast({ type: 'player_joined', name: client.name });
        room.broadcastState();

        if (room.isFull()) {
            setTimeout(() => room.startGame(), 500);
        }
        return;
    }

    // ── Submit Move (multiplayer) ─────────────────────────────────────────────
    if (type === 'move') {
        const room = rooms.get(client.room);
        if (room) room.submitMove(socket, msg.move);
        return;
    }

    // ── Leave Room ────────────────────────────────────────────────────────────
    if (type === 'leave_room') {
        leaveRoom(socket);
        return;
    }
}

function leaveRoom(socket) {
    const client = clients.get(socket);
    if (!client?.room) return;
    const room = rooms.get(client.room);
    if (room) {
        room.removePlayer(socket);
        room.broadcast({ type: 'player_left', name: client.name });
        if (room.isEmpty()) rooms.delete(client.room);
        else room.broadcastState();
    }
    client.room = null;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const FRONTEND = path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const html = fs.readFileSync(FRONTEND, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
        } catch (e) {
            res.writeHead(404); res.end('Frontend not found.');
        }
        return;
    }
    if (req.url === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mother.getStats(), null, 2));
        return;
    }
    res.writeHead(404); res.end('Not found.');
});

// ─── WebSocket Upgrade ────────────────────────────────────────────────────────

server.on('upgrade', (req, socket) => {
    if (req.headers['upgrade']?.toLowerCase() !== 'websocket') {
        socket.destroy(); return;
    }

    wsHandshake(req, socket);

    // Generate stable player hash from IP + a server-side random salt
    // (client sends its own localStorage hash; we trust it for identity)
    const hash = generateId(8);

    const client = { socket, hash, name: 'Player', room: null, aiSession: null, buffer: Buffer.alloc(0) };
    clients.set(socket, client);

    wsSend(socket, {
        type:  'connected',
        hash,
        stats: mother.getStats(),
    });

    socket.on('data', (chunk) => {
        client.buffer = Buffer.concat([client.buffer, chunk]);

        while (true) {
            const frame = wsDecodeFrame(client.buffer);
            if (!frame) break;
            client.buffer = client.buffer.slice(frame.totalLength);

            if (frame.opcode === 0x8) { socket.destroy(); break; } // close
            if (frame.opcode === 0x9) { // ping → pong
                socket.write(Buffer.from([0x8a, 0x00])); continue;
            }
            if (frame.opcode === 0x1 || frame.opcode === 0x2) {
                try {
                    const msg = JSON.parse(frame.payload.toString('utf8'));

                    // Handle identity first
                    if (msg.type === 'identify') {
                        client.hash = msg.hash || client.hash;
                        client.name = (msg.name || 'Player').slice(0, 20);
                        wsSend(socket, { type: 'identified', hash: client.hash, name: client.name });
                        continue;
                    }

                    handleMessage(socket, msg);
                } catch (e) {
                    console.error('[WS] Bad message:', e.message);
                }
            }
        }
    });

    socket.on('close', () => {
        leaveRoom(socket);
        clients.delete(socket);
    });

    socket.on('error', () => {
        leaveRoom(socket);
        clients.delete(socket);
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
    console.log(`\n🐝 RPS Hive running on http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   Stats:     http://localhost:${PORT}/stats`);
    console.log(`   Mother AI: ${mother.getStats().totalObservations} observations loaded\n`);
});
