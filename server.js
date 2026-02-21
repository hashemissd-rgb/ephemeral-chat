/**
 * EPHEMERAL CHAT SERVER
 * ---------------------
 * - Express serves the static frontend
 * - Socket.io handles real-time messaging
 * - All data lives in RAM only — no database, no disk writes
 * - Messages are broadcast to connected clients only
 * - No message history is sent to newly joining users (intentional)
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ── In-Memory store (RAM only) ──────────────────────────────────────────────
// chatLogs holds messages only for the current server session.
// It is NEVER written to disk or any database.
// Restarting the server wipes it automatically.
let chatLogs   = [];          // { id, nickname, text, timestamp }
let onlineUsers = new Map();  // socketId → nickname

// ── Sanitization ─────────────────────────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .slice(0, 500)                          // max length
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Join room ──
  socket.on('join', (rawNickname) => {
    const nickname = sanitize(rawNickname) || 'Anonymous';

    // Reject duplicate nicknames
    const taken = [...onlineUsers.values()].some(
      n => n.toLowerCase() === nickname.toLowerCase()
    );

    if (taken) {
      socket.emit('join_error', 'That name is already taken. Try another.');
      return;
    }

    onlineUsers.set(socket.id, nickname);

    // Confirm join — send NO message history (ephemeral by design)
    socket.emit('join_success', {
      nickname,
      onlineCount: onlineUsers.size
    });

    // Notify everyone of the new user
    io.emit('user_joined', {
      nickname,
      onlineCount: onlineUsers.size
    });

    console.log(`[join] ${nickname} (${socket.id}) — ${onlineUsers.size} online`);
  });

  // ── Incoming message ──
  socket.on('message', (rawText) => {
    const nickname = onlineUsers.get(socket.id);
    if (!nickname) return; // not joined yet

    const text = sanitize(rawText);
    if (!text) return;

    const msg = {
      id:        `${Date.now()}-${socket.id}`,
      nickname,
      text,
      timestamp: new Date().toISOString()
    };

    // Store in RAM (never touches disk)
    chatLogs.push(msg);

    // Keep memory bounded — drop oldest messages beyond 200
    if (chatLogs.length > 200) chatLogs.shift();

    // Broadcast to all clients
    io.emit('message', msg);
  });

  // ── Typing indicator ──
  socket.on('typing', (isTyping) => {
    const nickname = onlineUsers.get(socket.id);
    if (!nickname) return;
    socket.broadcast.emit('typing', { nickname, isTyping });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const nickname = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);

    if (nickname) {
      io.emit('user_left', {
        nickname,
        onlineCount: onlineUsers.size
      });
      console.log(`[leave] ${nickname} — ${onlineUsers.size} online`);
    }

    // If room is empty, wipe chat logs from RAM too
    if (onlineUsers.size === 0) {
      chatLogs = [];
      console.log('[wipe] Room empty — chat logs cleared from memory');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🟢 Ephemeral Chat running at http://localhost:${PORT}\n`);
});
