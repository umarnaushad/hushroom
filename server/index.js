const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const ROOM_TTL_MS = 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_NAME_LENGTH = 24;
const ROOM_CODE_PATTERN = /^[A-Z2-9]{6}$/;
const clientOrigin = process.env.CLIENT_ORIGIN?.replace(/\/$/, '') || true;

// Volatile by design: this Map is the only place active names and messages live.
// Nothing here is written to disk, a database, a cookie, or browser storage.
const rooms = new Map();

const app = express();
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', temporaryRooms: rooms.size });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: clientOrigin, methods: ['GET', 'POST'] }
});

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

function newRoomCode() {
  let code;
  do {
    code = crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
  } while (code.length < 6 || rooms.has(code));
  return code;
}

function getRoom(code) {
  const room = rooms.get(code);
  if (!room) return null;
  room.lastActive = Date.now();
  return room;
}

function roomUsers(room) {
  return [...room.users.values()].map(({ id, name }) => ({ id, name }));
}

function typingUsers(room) {
  return [...room.typing].map((id) => room.users.get(id)?.name).filter(Boolean);
}

function publishPresence(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit('presence:update', roomUsers(room));
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;
  room.users.delete(socket.id);
  room.typing.delete(socket.id);
  room.lastActive = Date.now();
  if (room.users.size === 0) {
    rooms.delete(code);
    return;
  }
  publishPresence(code);
  io.to(code).emit('typing:update', typingUsers(room));
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, callback) => {
    const name = cleanText(payload?.name, MAX_NAME_LENGTH);
    if (!name) return callback({ error: 'Choose a display name first.' });
    const code = newRoomCode();
    rooms.set(code, { messages: [], users: new Map(), typing: new Set(), lastActive: Date.now() });
    joinRoom(socket, code, name, callback);
  });

  socket.on('room:join', (payload, callback) => {
    const code = cleanText(payload?.code, 6).toUpperCase();
    const name = cleanText(payload?.name, MAX_NAME_LENGTH);
    if (!ROOM_CODE_PATTERN.test(code)) return callback({ error: 'Enter a valid six-character room code.' });
    if (!name) return callback({ error: 'Choose a display name first.' });
    if (!rooms.has(code)) return callback({ error: 'That room is no longer active.' });
    joinRoom(socket, code, name, callback);
  });

  socket.on('message:send', (payload) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (!room || !room.users.has(socket.id)) return;
    const now = Date.now();
    socket.data.messageTimes = (socket.data.messageTimes || []).filter((sentAt) => now - sentAt < 10_000);
    if (socket.data.messageTimes.length >= 20) return;
    socket.data.messageTimes.push(now);
    const text = cleanText(payload?.text, MAX_MESSAGE_LENGTH);
    if (!text) return;
    const message = { id: crypto.randomUUID(), userId: socket.id, name: room.users.get(socket.id).name, text, sentAt: Date.now() };
    room.messages.push(message);
    room.typing.delete(socket.id);
    io.to(code).emit('message:new', message);
    io.to(code).emit('typing:update', typingUsers(room));
  });

  socket.on('typing:set', (isTyping) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (!room || !room.users.has(socket.id)) return;
    isTyping ? room.typing.add(socket.id) : room.typing.delete(socket.id);
    io.to(code).emit('typing:update', typingUsers(room));
  });

  socket.on('room:leave', () => leaveRoom(socket));
  socket.on('disconnect', () => leaveRoom(socket));
});

function joinRoom(socket, code, name, callback) {
  leaveRoom(socket);
  const room = getRoom(code);
  room.users.set(socket.id, { id: socket.id, name });
  socket.data.roomCode = code;
  socket.join(code);
  callback({ ok: true, code, messages: room.messages });
  publishPresence(code);
}

setInterval(() => {
  const expiry = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.lastActive >= expiry) continue;
    io.to(code).emit('room:expired');
    for (const userId of room.users.keys()) {
      const member = io.sockets.sockets.get(userId);
      if (member) {
        member.leave(code);
        member.data.roomCode = null;
      }
    }
    rooms.delete(code);
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, () => console.log(`Hushroom server listening on port ${PORT}`));