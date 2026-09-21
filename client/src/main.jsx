import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import 'emoji-picker-element';
import { ArrowLeft, Check, Copy, LogOut, Menu, MessageCircle, Moon, Send, ShieldCheck, Sun, X } from 'lucide-react';
import './styles.css';

const serverUrl = (import.meta.env.VITE_SERVER_URL || 'https://hushroom-x9t3.onrender.com').replace(/\/$/, '');
const socket = io(serverUrl, { autoConnect: true });
const reactionOptions = ['❤️', '😂', '👍', '😭', '😮'];
const messageDurations = [{ value: 10_000, label: '10 seconds' }, { value: 30_000, label: '30 seconds' }, { value: 60_000, label: '1 minute' }, { value: 5 * 60_000, label: '5 minutes' }, { value: 60 * 60_000, label: '1 hour' }];
const roomDurations = [{ value: 30 * 60_000, label: '30 minutes' }, { value: 60 * 60_000, label: '1 hour' }, { value: 6 * 60 * 60_000, label: '6 hours' }];

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function formatRemaining(milliseconds) {
  const seconds = Math.max(0, Math.ceil((milliseconds || 0) / 1000));
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${seconds}s`;
}

function App() {
  const [room, setRoom] = useState(null);
  const [ownerId, setOwnerId] = useState(null);
  const [locked, setLocked] = useState(false);
  const [roomExpiresAt, setRoomExpiresAt] = useState(null);
  const [messageTtlMs, setMessageTtlMs] = useState(30_000);
  const [roomTtlMs, setRoomTtlMs] = useState(60 * 60_000);
  const [remaining, setRemaining] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('room')?.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6) || '');
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typing, setTyping] = useState([]);
  const [draft, setDraft] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [replyTarget, setReplyTarget] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [error, setError] = useState('');
  const [dark, setDark] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [captureObscured, setCaptureObscured] = useState(false);
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const longPressTimer = useRef(null);

  useEffect(() => {
    const onMessage = (message) => setMessages((current) => [...current, message]);
    const onMessageExpired = (messageId) => { setMessages((current) => current.filter((message) => message.id !== messageId)); setReplyTarget((current) => current?.id === messageId ? null : current); };
    const onMessageUpdated = ({ messageId, text, edited }) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, text, edited } : message));
    const onMessageDeleted = (messageId) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, deleted: true, text: '', reactions: {}, replyTo: null, attachment: null } : message));
    const onReactions = ({ messageId, reactions }) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, reactions } : message));
    const onPresence = (nextUsers) => setUsers(nextUsers);
    const onTyping = (names) => setTyping(names);
    const onRoomExpired = () => { setRoom(null); setRoomExpiresAt(null); setMessages([]); setUsers([]); setTyping([]); setDraft(''); setReplyTarget(null); setCode(''); setError('This room expired and can no longer be reopened.'); };
    const onRoomRemoved = (message) => { setRoom(null); setRoomExpiresAt(null); setMessages([]); setUsers([]); setTyping([]); setDraft(''); setReplyTarget(null); setCode(''); setError(message); };
    const onRoomState = (state) => { setLocked(state.locked); setRoomExpiresAt(state.expiresAt); if (state.code) setRoom(state.code); };
    const onRoomCodeChanged = (newCode) => setRoom(newCode);
    socket.on('message:new', onMessage); socket.on('message:expired', onMessageExpired); socket.on('message:updated', onMessageUpdated); socket.on('message:deleted', onMessageDeleted); socket.on('message:reactions', onReactions); socket.on('presence:update', onPresence); socket.on('typing:update', onTyping); socket.on('room:expired', onRoomExpired); socket.on('room:removed', onRoomRemoved); socket.on('room:state', onRoomState); socket.on('room:code-changed', onRoomCodeChanged);
    return () => { socket.off('message:new', onMessage); socket.off('message:expired', onMessageExpired); socket.off('message:updated', onMessageUpdated); socket.off('message:deleted', onMessageDeleted); socket.off('message:reactions', onReactions); socket.off('presence:update', onPresence); socket.off('typing:update', onTyping); socket.off('room:expired', onRoomExpired); socket.off('room:removed', onRoomRemoved); socket.off('room:state', onRoomState); socket.off('room:code-changed', onRoomCodeChanged); };
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!roomExpiresAt) { setRemaining(null); return undefined; }
    const update = () => setRemaining(Math.max(0, roomExpiresAt - Date.now()));
    update(); const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [roomExpiresAt]);

  useEffect(() => {
    const updateCaptureState = () => setCaptureObscured(document.visibilityState !== 'visible');
    const handleBeforePrint = () => setCaptureObscured(true);
    const handleAfterPrint = () => setCaptureObscured(false);
    document.addEventListener('visibilitychange', updateCaptureState); window.addEventListener('beforeprint', handleBeforePrint); window.addEventListener('afterprint', handleAfterPrint);
    return () => { document.removeEventListener('visibilitychange', updateCaptureState); window.removeEventListener('beforeprint', handleBeforePrint); window.removeEventListener('afterprint', handleAfterPrint); };
  }, []);

  useEffect(() => {
    const messageList = document.querySelector('.message-list');
    if (messageList) messageList.classList.toggle('capture-obscured', captureObscured);
  }, [captureObscured, room]);

  useEffect(() => {
    if (!room) return undefined;
    const messageList = document.querySelector('.message-list');
    if (!messageList) return undefined;
    const blockMessageAction = (event) => { if (event.target.closest('.message, .bubble')) { if (event.type !== 'contextmenu') event.preventDefault(); } };
    ['copy', 'cut', 'dragstart'].forEach((eventName) => messageList.addEventListener(eventName, blockMessageAction));
    return () => ['copy', 'cut', 'dragstart'].forEach((eventName) => messageList.removeEventListener(eventName, blockMessageAction));
  }, [room]);

  useEffect(() => {
    if (!room) return undefined;
    const composer = document.querySelector('.composer');
    const emojiButton = composer?.querySelector('.composer-action');
    if (!composer || !emojiButton || composer.querySelector('.file-attach-button')) return undefined;
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain', 'application/pdf', 'application/zip']);
    const blockedExtensions = /\.(exe|bat|cmd|com|msi|scr|js|mjs|cjs|ps1|sh|dll|so|dylib|jar|hta|vbs|vbe|wsf|docm|xlsm|pptm)$/i;
    const attachButton = document.createElement('button'); attachButton.type = 'button'; attachButton.className = 'composer-action file-attach-button'; attachButton.textContent = '+'; attachButton.setAttribute('aria-label', 'Attach temporary image or file');
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/gif,image/webp,text/plain,application/pdf,application/zip'; input.hidden = true;
    const selection = document.createElement('span'); selection.className = 'file-selection'; composer.prepend(attachButton); composer.appendChild(input); composer.parentElement.prepend(selection);
    const updateSelection = () => { selection.textContent = selectedFile ? `Attached: ${selectedFile.name}` : ''; selection.classList.toggle('has-file', Boolean(selectedFile)); };
    attachButton.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024 || !allowedTypes.has(file.type) || blockedExtensions.test(file.name)) { setError('That file type or size is not allowed. Maximum size is 5 MB.'); input.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => { setSelectedFile({ name: file.name, type: file.type, size: file.size, data: String(reader.result) }); setError(''); };
      reader.readAsDataURL(file);
    });
    updateSelection();
    return () => { attachButton.remove(); input.remove(); selection.remove(); };
  }, [room, selectedFile]);

  useEffect(() => {
    if (!room) return undefined;
    const roomCard = document.querySelector('.room-card');
    const owner = ownerId === socket.id;
    document.querySelectorAll('.owner-controls').forEach((element) => element.remove());
    const ownerPanel = document.createElement('div');
    ownerPanel.className = 'owner-controls';
    if (owner && roomCard) {
      ownerPanel.innerHTML = `<span class="overline">ROOM OWNER</span><button type="button" data-owner-action="lock">${locked ? 'Unlock room' : 'Lock room'}</button><label>Expiration<select data-owner-action="expiration"><option value="1800000">30 minutes</option><option value="3600000">1 hour</option><option value="21600000">6 hours</option></select></label><button type="button" data-owner-action="invite">Generate new invite link</button><button type="button" class="danger-control" data-owner-action="destroy">Destroy room now</button>`;
      ownerPanel.querySelector('[data-owner-action="expiration"]').value = String(roomTtlMs);
      ownerPanel.addEventListener('click', (event) => {
        const action = event.target.closest('[data-owner-action]')?.dataset.ownerAction;
        if (action === 'lock') socket.emit('room:lock', !locked);
        if (action === 'invite') socket.emit('room:regenerate-invite');
        if (action === 'destroy') socket.emit('room:destroy');
      });
      ownerPanel.querySelector('[data-owner-action="expiration"]').addEventListener('change', (event) => { setRoomTtlMs(Number(event.target.value)); socket.emit('room:change-expiration', Number(event.target.value)); });
      roomCard.after(ownerPanel);
    }

    const messageArticles = [...document.querySelectorAll('article.message')];
    if (owner) {
      document.querySelectorAll('[data-remove-user]').forEach((element) => element.remove());
      document.querySelectorAll('.user').forEach((userElement, index) => {
        const user = users[index];
        if (!user || user.id === socket.id) return;
        const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'remove-user'; removeButton.dataset.removeUser = user.id; removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => removeUser(user.id));
        userElement.appendChild(removeButton);
      });
    }
    messageArticles.forEach((article) => {
      const message = messages.find((item) => article.id === `message-${item.id}`);
      if (!message) return;
      const meta = article.querySelector('.message-meta');
      if (message.edited && meta && !meta.querySelector('.edited-label')) {
        const edited = document.createElement('span'); edited.className = 'edited-label'; edited.textContent = 'edited'; meta.appendChild(edited);
      }
      const bubble = article.querySelector('.bubble');
      if (bubble && message.deleted) { bubble.textContent = 'Message deleted'; article.classList.add('is-deleted'); }
      if (message.attachment && !article.querySelector('.attachment')) {
        const attachment = document.createElement('div'); attachment.className = 'attachment';
        const source = `data:${message.attachment.type};base64,${message.attachment.data}`;
        if (message.attachment.type.startsWith('image/')) { const image = document.createElement('img'); image.src = source; image.alt = message.attachment.name; attachment.appendChild(image); }
        const link = document.createElement('a'); link.href = source; link.download = message.attachment.name; link.textContent = `${message.attachment.name} (${Math.ceil(message.attachment.size / 1024)} KB)`; attachment.appendChild(link);
        article.appendChild(attachment);
      }
      if (message.deleted) article.querySelector('.message-controls')?.remove();
      if (message.userId === socket.id && !message.deleted && !article.querySelector('.message-controls')) {
        const controls = document.createElement('div'); controls.className = 'message-controls';
        controls.innerHTML = '<button type="button" data-message-action="edit">Edit</button><button type="button" data-message-action="delete">Delete</button>';
        controls.addEventListener('click', (event) => { const action = event.target.closest('[data-message-action]')?.dataset.messageAction; if (action === 'edit') editMessage(message); if (action === 'delete') deleteMessage(message); });
        article.appendChild(controls);
      }
    });
    return () => ownerPanel.remove();
  }, [room, ownerId, locked, roomTtlMs, messages, users]);

  useEffect(() => {
    if (!room) return undefined;
    const composerWrap = document.querySelector('.composer-wrap'); const emojiToggle = composerWrap?.querySelector('.composer-action');
    if (!composerWrap || !emojiToggle) return undefined;
    const picker = document.createElement('emoji-picker'); picker.className = 'emoji-picker'; picker.setAttribute('locale', navigator.language || 'en'); composerWrap.appendChild(picker);
    picker.addEventListener('emoji-click', (event) => setDraft((current) => `${current}${event.detail.unicode}`));
    const togglePicker = (event) => { event.preventDefault(); event.stopImmediatePropagation(); picker.classList.toggle('is-open'); };
    const closePicker = (event) => { if (!composerWrap.contains(event.target)) picker.classList.remove('is-open'); };
    emojiToggle.addEventListener('click', togglePicker); document.addEventListener('click', closePicker);
    return () => { emojiToggle.removeEventListener('click', togglePicker); document.removeEventListener('click', closePicker); picker.remove(); };
  }, [room]);

  useEffect(() => {
    const sendButton = document.querySelector('.send-button');
    if (sendButton) sendButton.disabled = !draft.trim() && !selectedFile;
  }, [draft, selectedFile, room]);

  function join(action) {
    setError('');
    socket.emit(`room:${action}`, { name: name.trim(), code: code.trim().toUpperCase(), messageTtlMs: action === 'create' ? messageTtlMs : undefined, roomTtlMs: action === 'create' ? roomTtlMs : undefined }, (result) => {
      if (result?.error) return setError(result.error);
      setRoom(result.code); setOwnerId(result.ownerId); setLocked(result.locked); setMessages(result.messages || []); setMessageTtlMs(result.messageTtlMs); setRoomExpiresAt(result.expiresAt);
    });
  }

  function leave() {
    socket.emit('room:leave'); setRoom(null); setRoomExpiresAt(null); setMessages([]); setUsers([]); setTyping([]); setDraft(''); setReplyTarget(null); setCode(''); setError(''); setShowDetails(false);
  }

  function sendMessage(event) {
    event.preventDefault(); if (!draft.trim() && !selectedFile) return;
    if (editingMessage) socket.emit('message:edit', { messageId: editingMessage.id, text: draft });
    else socket.emit('message:send', { text: draft, attachment: selectedFile, replyToId: replyTarget?.id });
    setDraft(''); setSelectedFile(null); setReplyTarget(null); setEditingMessage(null); socket.emit('typing:set', false);
  }

  function updateDraft(event) {
    const value = event.target.value.slice(0, 1000); setDraft(value); socket.emit('typing:set', Boolean(value.trim()));
    clearTimeout(typingTimeout.current); typingTimeout.current = setTimeout(() => socket.emit('typing:set', false), 1200);
  }

  function selectReply(message) {
    setReplyTarget({ id: message.id, name: message.name, text: message.text });
    window.setTimeout(() => document.querySelector('.composer input')?.focus(), 0);
  }

  function jumpToMessage(messageId) {
    document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleReaction(messageId, emoji) {
    socket.emit('message:reaction', { messageId, emoji });
  }

  function editMessage(message) {
    if (message.deleted) return;
    setEditingMessage(message);
    setReplyTarget(null);
    setDraft(message.text);
    window.setTimeout(() => document.querySelector('.composer input')?.focus(), 0);
  }

  function deleteMessage(message) {
    if (!message.deleted) socket.emit('message:delete', { messageId: message.id });
  }

  function removeUser(userId) {
    socket.emit('room:remove-user', { userId });
  }

  function changeExpiration(event) {
    socket.emit('room:change-expiration', Number(event.target.value));
  }

  function destroyRoom() {
    socket.emit('room:destroy');
  }

  function startLongPress(message) {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => selectReply(message), 550);
  }

  function stopLongPress() {
    clearTimeout(longPressTimer.current);
  }

  async function copyCode() {
    let copiedSuccessfully = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(room); copiedSuccessfully = true; } } catch { copiedSuccessfully = false; }
    if (!copiedSuccessfully) { const fallbackInput = document.createElement('textarea'); fallbackInput.value = room; fallbackInput.setAttribute('readonly', ''); fallbackInput.style.position = 'fixed'; fallbackInput.style.opacity = '0'; document.body.appendChild(fallbackInput); fallbackInput.select(); copiedSuccessfully = document.execCommand('copy'); fallbackInput.remove(); }
    if (copiedSuccessfully) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  }

  if (!room) return <main className={`landing ${dark ? 'theme-dark' : 'theme-light'}`}><button className="theme-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><section className="welcome"><div className="brand-mark"><MessageCircle size={25} /></div><p className="eyebrow">PRIVATE, TEMPORARY, SIMPLE</p><h1>Meet in a room.<br /><em>Leave no trace.</em></h1><p className="intro">A quiet place for conversations with people you trust. No accounts, no history, no noise.</p><div className="join-card"><label htmlFor="name">Your display name</label><input id="name" value={name} onChange={(event) => setName(event.target.value)} maxLength="24" placeholder="e.g. Alex" autoComplete="off" /><div className="settings-grid"><label>Message lifetime<select value={messageTtlMs} onChange={(event) => setMessageTtlMs(Number(event.target.value))}>{messageDurations.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Room lifetime<select value={roomTtlMs} onChange={(event) => setRoomTtlMs(Number(event.target.value))}>{roomDurations.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><button className="primary-button" onClick={() => join('create')} disabled={!name.trim()}><MessageCircle size={18} /> Create a new room</button><div className="divider"><span>or join an existing room</span></div><div className="join-row"><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))} placeholder="ROOM CODE" maxLength="6" aria-label="Room code" /><button className="secondary-button" onClick={() => join('join')} disabled={!name.trim() || code.length !== 6}>Join room <ArrowLeft size={16} /></button></div>{error && <p className="error">{error}</p>}</div><div className="privacy-line"><ShieldCheck size={16} /><span>Rooms and messages live in memory only. Closing the room erases them.</span></div></section></main>;

  return <main className={`chat-app ${dark ? 'theme-dark' : 'theme-light'}`}><aside className={`room-sidebar ${showDetails ? 'is-open' : ''}`}><div className="sidebar-top"><div className="brand"><span className="brand-mark small"><MessageCircle size={18} /></span><strong>hushroom</strong></div><button className="icon-button close-details" onClick={() => setShowDetails(false)} aria-label="Close room details"><X size={19} /></button></div><div className="room-card"><span className="overline">CURRENT ROOM</span><div className="room-code">{room}<button className="copy-button" onClick={copyCode} aria-label="Copy room code">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><p>Share this code with your friends.</p><div className="room-countdown">Room closes in <strong>{formatRemaining(remaining)}</strong></div></div><div className="online-heading"><span>People here</span><span className="count">{users.length}</span></div><div className="user-list">{users.map((user) => <div className="user" key={user.id}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}{user.id === socket.id && <small>you</small>}</span><i className="online-dot" /></div>)}</div><div className="sidebar-bottom"><div className="privacy-box"><ShieldCheck size={18} /><span>Nothing is saved. This room disappears after everyone leaves.</span></div><button className="leave-button" onClick={leave}><LogOut size={17} /> Leave room</button></div></aside><section className="conversation"><header className="chat-header"><button className="icon-button menu-button" onClick={() => setShowDetails(true)} aria-label="Show room details"><Menu size={21} /></button><div><span className="online-label"><i className="online-dot" />Live room</span><h2>Room {room}</h2></div><span className="header-countdown">{formatRemaining(remaining)}</span><button className="icon-button theme-chat-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={19} /> : <Moon size={19} />}</button></header><div className="message-list">{messages.length === 0 ? <div className="empty-chat"><span className="empty-icon"><MessageCircle size={25} /></span><h3>A quiet room</h3><p>Messages disappear automatically.</p></div> : messages.map((message) => <article className={`message ${message.userId === socket.id ? 'mine' : ''}`} id={`message-${message.id}`} key={message.id} onContextMenu={(event) => { event.preventDefault(); selectReply(message); }} onTouchStart={() => startLongPress(message)} onTouchEnd={stopLongPress} onTouchMove={stopLongPress}><div className="message-meta"><strong>{message.userId === socket.id ? 'You' : message.name}</strong><time>{formatTime(message.sentAt)}</time><time className="expires-label">{formatRemaining(message.expiresAt - Date.now())}</time></div>{message.replyTo && <button className="reply-preview" onClick={() => jumpToMessage(message.replyTo.id)}><strong>Reply to {message.replyTo.name}</strong><span>{message.replyTo.text}</span></button>}<div className="bubble">{message.text}</div><div className="reaction-bar">{reactionOptions.map((emoji) => { const usersForReaction = message.reactions?.[emoji] || []; return <button type="button" className={usersForReaction.includes(socket.id) ? 'reaction is-selected' : 'reaction'} key={emoji} onClick={(event) => { event.stopPropagation(); toggleReaction(message.id, emoji); }} aria-label={`React ${emoji}`}><span>{emoji}</span>{usersForReaction.length > 0 && <small>{usersForReaction.length}</small>}</button>; })}</div></article>)}<div ref={bottomRef} /></div><div className="composer-wrap">{replyTarget && <button className="reply-composer-preview" onClick={() => jumpToMessage(replyTarget.id)}><span><strong>Replying to {replyTarget.name}</strong><span>{replyTarget.text}</span></span><X size={15} onClick={(event) => { event.stopPropagation(); setReplyTarget(null); }} /></button>}<div className="typing">{typing.length > 0 && <><span className="typing-dots"><i /><i /><i /></span>{typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing</>}</div><form className="composer" onSubmit={sendMessage}><button type="button" className="composer-action" aria-label="Add emoji">☺</button><input value={draft} onChange={updateDraft} placeholder="Write a message..." maxLength="1000" autoComplete="off" /><button className="send-button" type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={17} /></button></form><p className="composer-note">Messages disappear after {messageDurations.find((option) => option.value === messageTtlMs)?.label}. Room closes in {formatRemaining(remaining)}.</p></div></section></main>;
}

export default App;

const rootElement = document.getElementById('root');
const root = rootElement.__hushroomRoot || createRoot(rootElement);
rootElement.__hushroomRoot = root;
root.render(<App />);
