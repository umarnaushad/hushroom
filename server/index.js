const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const DEFAULT_CLIENT_ORIGINS = [
  'https://hushroom-chi.vercel.app',
  'https://hushroom-3dh5yghb3-umarnaushad.vercel.app'
];
const MESSAGE_TTL_OPTIONS = new Set([10_000, 30_000, 60_000, 5 * 60_000, 60 * 60_000]);
const ROOM_TTL_OPTIONS = new Set([30 * 60_000, 60 * 60_000, 6 * 60 * 60_000]);
const REACTION_OPTIONS = new Set(['❤️', '😂', '👍', '😭', '😮']);
const MAX_MESSAGE_LENGTH = 1000;
const MAX_NAME_LENGTH = 24;
const ROOM_CODE_PATTERN = /^[A-Z2-9]{6}$/;
const configuredOrigins = [process.env.ALLOWED_ORIGINS, process.env.CLIENT_ORIGIN]
  .filter(Boolean)
  .flatMap((origins) => origins.split(','))
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedOrigins = new Set([...DEFAULT_CLIENT_ORIGINS, ...configuredOrigins]);
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');

function corsOrigin(origin, callback) {
  callback(null, !origin || allowedOrigins.has(origin.replace(/\/$/, '')));
}

// Volatile by design: this Map is the only place active names and messages live.
// Nothing here is written to disk, a database, a cookie, or browser storage.
const rooms = new Map();

const app = express();
const corsOptions = { origin: corsOrigin };
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok', temporaryRooms: rooms.size });
});

app.use(express.static(clientDistPath));
app.get('/', (_request, response) => {
  response.sendFile(path.join(clientDistPath, 'index.html'));
});
app.get(/^\/(?!socket\.io(?:\/|$)).*/, (request, response, next) => {
  if (request.path === '/health') return next();
  response.sendFile(path.join(clientDistPath, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { ...corsOptions, methods: ['GET', 'POST'] }
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
  return room;
}

function validDuration(value, options, fallback) {
  const duration = Number(value);
  return options.has(duration) ? duration : fallback;
}

function roomUsers(room) {
  return [...room.users.values()].map(({ id, name }) => ({ id, name, isOwner: id === room.ownerId }));
}

function typingUsers(room) {
  return [...room.typing].map((id) => room.users.get(id)?.name).filter(Boolean);
}

function publishPresence(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit('presence:update', roomUsers(room));
}

function isOwner(socket, room) {
  return room?.ownerId === socket.id;
}

function emitRoomState(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit('room:state', { locked: room.locked, expiresAt: room.expiresAt, code });
}

function removeUser(code, userId) {
  const room = rooms.get(code);
  const member = io.sockets.sockets.get(userId);
  if (!room || !member || !room.users.has(userId) || userId === room.ownerId) return;
  room.users.delete(userId);
  room.typing.delete(userId);
  member.leave(code);
  member.data.roomCode = null;
  member.emit('room:removed', 'You were removed from this room.');
  publishPresence(code);
  io.to(code).emit('typing:update', typingUsers(room));
  if (room.users.size === 0) destroyRoom(code);
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
  if (room.users.size === 0) {
    destroyRoom(code);
    return;
  }
  publishPresence(code);
  io.to(code).emit('typing:update', typingUsers(room));
}

function destroyRoom(code, notify = false) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.expiryTimer);
  for (const timer of room.messageTimers.values()) clearTimeout(timer);
  if (notify) io.to(code).emit('room:expired');
  for (const userId of room.users.keys()) {
    const member = io.sockets.sockets.get(userId);
    if (member) {
      member.leave(code);
      member.data.roomCode = null;
    }
  }
  rooms.delete(code);
}

function expireMessage(code, messageId) {
  const room = rooms.get(code);
  if (!room) return;
  const messageIndex = room.messages.findIndex((message) => message.id === messageId);
  if (messageIndex === -1) return;
  room.messages.splice(messageIndex, 1);
  room.messageTimers.delete(messageId);
  io.to(code).emit('message:expired', messageId);
}

function expireRoom(code) {
  if (rooms.has(code)) destroyRoom(code, true);
}

function publicReactions(reactions) {
  return Object.fromEntries(Object.entries(reactions).filter(([, userIds]) => userIds.length > 0));
}

function findMessage(room, messageId) {
  return room.messages.find((message) => message.id === messageId);
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, callback) => {
    const name = cleanText(payload?.name, MAX_NAME_LENGTH);
    if (!name) return callback({ error: 'Choose a display name first.' });
    const messageTtlMs = validDuration(payload?.messageTtlMs, MESSAGE_TTL_OPTIONS, 30_000);
    const roomTtlMs = validDuration(payload?.roomTtlMs, ROOM_TTL_OPTIONS, 60 * 60_000);
    const code = newRoomCode();
    const room = {
      messages: [],
      users: new Map(),
      typing: new Set(),
      messageTimers: new Map(),
      messageTtlMs,
      expiresAt: Date.now() + roomTtlMs,
      expiryTimer: null,
      ownerId: socket.id,
      locked: false
    };
    room.expiryTimer = setTimeout(() => expireRoom(code), roomTtlMs).unref();
    rooms.set(code, room);
    joinRoom(socket, code, name, callback);
  });

  socket.on('room:join', (payload, callback) => {
    const code = cleanText(payload?.code, 6).toUpperCase();
    const name = cleanText(payload?.name, MAX_NAME_LENGTH);
    if (!ROOM_CODE_PATTERN.test(code)) return callback({ error: 'Enter a valid six-character room code.' });
    if (!name) return callback({ error: 'Choose a display name first.' });
    const room = rooms.get(code);
    if (!room) return callback({ error: 'That room is no longer active.' });
    if (room.locked) return callback({ error: 'That room is locked.' });
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
    const replyTarget = findMessage(room, cleanText(payload?.replyToId, 80));
    const message = {
      id: crypto.randomUUID(),
      userId: socket.id,
      name: room.users.get(socket.id).name,
      text,
      sentAt: Date.now(),
      expiresAt: Date.now() + room.messageTtlMs,
      reactions: {},
      replyTo: replyTarget ? { id: replyTarget.id, name: replyTarget.name, text: replyTarget.text.slice(0, 140) } : null
    };
    room.messages.push(message);
    room.messageTimers.set(message.id, setTimeout(() => expireMessage(code, message.id), room.messageTtlMs).unref());
    room.typing.delete(socket.id);
    io.to(code).emit('message:new', message);
    io.to(code).emit('typing:update', typingUsers(room));
  });

  socket.on('message:reaction', (payload) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    const message = room && findMessage(room, cleanText(payload?.messageId, 80));
    const emoji = String(payload?.emoji || '');
    if (!room || !message || !REACTION_OPTIONS.has(emoji)) return;
    const previousEmoji = Object.entries(message.reactions).find(([, userIds]) => userIds.includes(socket.id))?.[0];
    for (const userIds of Object.values(message.reactions)) {
      const index = userIds.indexOf(socket.id);
      if (index !== -1) userIds.splice(index, 1);
    }
    if (previousEmoji !== emoji) {
      message.reactions[emoji] = message.reactions[emoji] || [];
      message.reactions[emoji].push(socket.id);
    }
    io.to(code).emit('message:reactions', { messageId: message.id, reactions: publicReactions(message.reactions) });
  });

  socket.on('message:edit', (payload) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    const message = room && findMessage(room, cleanText(payload?.messageId, 80));
    const text = cleanText(payload?.text, MAX_MESSAGE_LENGTH);
    if (!room || !message || message.deleted || message.userId !== socket.id || !text) return;
    message.text = text;
    message.edited = true;
    io.to(code).emit('message:updated', { messageId: message.id, text, edited: true });
  });

  socket.on('message:delete', (payload) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    const message = room && findMessage(room, cleanText(payload?.messageId, 80));
    if (!room || !message || message.deleted || message.userId !== socket.id) return;
    message.deleted = true;
    message.text = '';
    message.reactions = {};
    message.replyTo = null;
    io.to(code).emit('message:deleted', message.id);
  });

  socket.on('typing:set', (isTyping) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (!room || !room.users.has(socket.id)) return;
    isTyping ? room.typing.add(socket.id) : room.typing.delete(socket.id);
    io.to(code).emit('typing:update', typingUsers(room));
  });

  socket.on('room:remove-user', (payload) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (isOwner(socket, room)) removeUser(code, cleanText(payload?.userId, 80));
  });

  socket.on('room:lock', (locked) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (!isOwner(socket, room)) return;
    room.locked = Boolean(locked);
    emitRoomState(code);
  });

  socket.on('room:change-expiration', (duration) => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (!isOwner(socket, room)) return;
    const roomTtlMs = validDuration(duration, ROOM_TTL_OPTIONS, null);
    if (!roomTtlMs) return;
    clearTimeout(room.expiryTimer);
    room.expiresAt = Date.now() + roomTtlMs;
    room.expiryTimer = setTimeout(() => expireRoom(code), roomTtlMs).unref();
    emitRoomState(code);
  });

  socket.on('room:destroy', () => {
    const code = socket.data.roomCode;
    const room = code && getRoom(code);
    if (isOwner(socket, room)) destroyRoom(code, true);
  });

  socket.on('room:regenerate-invite', () => {
    const oldCode = socket.data.roomCode;
    const room = oldCode && getRoom(oldCode);
    if (!isOwner(socket, room)) return;
    const newCode = newRoomCode();
    clearTimeout(room.expiryTimer);
    const remaining = Math.max(0, room.expiresAt - Date.now());
    room.expiryTimer = setTimeout(() => expireRoom(newCode), remaining).unref();
    rooms.delete(oldCode);
    rooms.set(newCode, room);
    for (const userId of room.users.keys()) {
      const member = io.sockets.sockets.get(userId);
      if (member) { member.leave(oldCode); member.join(newCode); member.data.roomCode = newCode; }
    }
    io.to(newCode).emit('room:code-changed', newCode);
    emitRoomState(newCode);
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
  callback({ ok: true, code, messages: room.messages, messageTtlMs: room.messageTtlMs, expiresAt: room.expiresAt, locked: room.locked, ownerId: room.ownerId });
  publishPresence(code);
}

server.listen(PORT, '0.0.0.0', () => console.log(`Hushroom server listening on port ${PORT}`));