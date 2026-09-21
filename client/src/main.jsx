import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import 'emoji-picker-element';
import { ArrowLeft, Check, Copy, LogOut, Menu, MessageCircle, Moon, Send, ShieldCheck, Sun, X } from 'lucide-react';
import './styles.css';

const serverUrl = (import.meta.env.VITE_SERVER_URL || 'https://hushroom-x9t3.onrender.com').replace(/\/$/, '');
const socket = io(serverUrl, { autoConnect: true });
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
  const [error, setError] = useState('');
  const [dark, setDark] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [captureObscured, setCaptureObscured] = useState(false);
  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);

  useEffect(() => {
    const onMessage = (message) => setMessages((current) => [...current, message]);
    const onMessageExpired = (messageId) => setMessages((current) => current.filter((message) => message.id !== messageId));
    const onPresence = (nextUsers) => setUsers(nextUsers);
    const onTyping = (names) => setTyping(names);
    const onRoomExpired = () => { setRoom(null); setRoomExpiresAt(null); setMessages([]); setUsers([]); setTyping([]); setDraft(''); setCode(''); setError('This room expired and can no longer be reopened.'); };
    socket.on('message:new', onMessage); socket.on('message:expired', onMessageExpired); socket.on('presence:update', onPresence); socket.on('typing:update', onTyping); socket.on('room:expired', onRoomExpired);
    return () => { socket.off('message:new', onMessage); socket.off('message:expired', onMessageExpired); socket.off('presence:update', onPresence); socket.off('typing:update', onTyping); socket.off('room:expired', onRoomExpired); };
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
    const blockMessageAction = (event) => { if (event.target.closest('.message, .bubble')) event.preventDefault(); };
    ['contextmenu', 'copy', 'cut', 'dragstart'].forEach((eventName) => messageList.addEventListener(eventName, blockMessageAction));
    return () => ['contextmenu', 'copy', 'cut', 'dragstart'].forEach((eventName) => messageList.removeEventListener(eventName, blockMessageAction));
  }, [room]);

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

  function join(action) {
    setError('');
    socket.emit(`room:${action}`, { name: name.trim(), code: code.trim().toUpperCase(), messageTtlMs: action === 'create' ? messageTtlMs : undefined, roomTtlMs: action === 'create' ? roomTtlMs : undefined }, (result) => {
      if (result?.error) return setError(result.error);
      setRoom(result.code); setMessages(result.messages || []); setMessageTtlMs(result.messageTtlMs); setRoomExpiresAt(result.expiresAt);
    });
  }

  function leave() {
    socket.emit('room:leave'); setRoom(null); setRoomExpiresAt(null); setMessages([]); setUsers([]); setTyping([]); setDraft(''); setCode(''); setError(''); setShowDetails(false);
  }

  function sendMessage(event) {
    event.preventDefault(); if (!draft.trim()) return;
    socket.emit('message:send', { text: draft }); setDraft(''); socket.emit('typing:set', false);
  }

  function updateDraft(event) {
    const value = event.target.value.slice(0, 1000); setDraft(value); socket.emit('typing:set', Boolean(value.trim()));
    clearTimeout(typingTimeout.current); typingTimeout.current = setTimeout(() => socket.emit('typing:set', false), 1200);
  }

  async function copyCode() {
    let copiedSuccessfully = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(room); copiedSuccessfully = true; } } catch { copiedSuccessfully = false; }
    if (!copiedSuccessfully) { const fallbackInput = document.createElement('textarea'); fallbackInput.value = room; fallbackInput.setAttribute('readonly', ''); fallbackInput.style.position = 'fixed'; fallbackInput.style.opacity = '0'; document.body.appendChild(fallbackInput); fallbackInput.select(); copiedSuccessfully = document.execCommand('copy'); fallbackInput.remove(); }
    if (copiedSuccessfully) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  }

  if (!room) return <main className={`landing ${dark ? 'theme-dark' : 'theme-light'}`}><button className="theme-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><section className="welcome"><div className="brand-mark"><MessageCircle size={25} /></div><p className="eyebrow">PRIVATE, TEMPORARY, SIMPLE</p><h1>Meet in a room.<br /><em>Leave no trace.</em></h1><p className="intro">A quiet place for conversations with people you trust. No accounts, no history, no noise.</p><div className="join-card"><label htmlFor="name">Your display name</label><input id="name" value={name} onChange={(event) => setName(event.target.value)} maxLength="24" placeholder="e.g. Alex" autoComplete="off" /><div className="settings-grid"><label>Message lifetime<select value={messageTtlMs} onChange={(event) => setMessageTtlMs(Number(event.target.value))}>{messageDurations.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Room lifetime<select value={roomTtlMs} onChange={(event) => setRoomTtlMs(Number(event.target.value))}>{roomDurations.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div><button className="primary-button" onClick={() => join('create')} disabled={!name.trim()}><MessageCircle size={18} /> Create a new room</button><div className="divider"><span>or join an existing room</span></div><div className="join-row"><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))} placeholder="ROOM CODE" maxLength="6" aria-label="Room code" /><button className="secondary-button" onClick={() => join('join')} disabled={!name.trim() || code.length !== 6}>Join room <ArrowLeft size={16} /></button></div>{error && <p className="error">{error}</p>}</div><div className="privacy-line"><ShieldCheck size={16} /><span>Rooms and messages live in memory only. Closing the room erases them.</span></div></section></main>;

  return <main className={`chat-app ${dark ? 'theme-dark' : 'theme-light'}`}><aside className={`room-sidebar ${showDetails ? 'is-open' : ''}`}><div className="sidebar-top"><div className="brand"><span className="brand-mark small"><MessageCircle size={18} /></span><strong>hushroom</strong></div><button className="icon-button close-details" onClick={() => setShowDetails(false)} aria-label="Close room details"><X size={19} /></button></div><div className="room-card"><span className="overline">CURRENT ROOM</span><div className="room-code">{room}<button className="copy-button" onClick={copyCode} aria-label="Copy room code">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><p>Share this code with your friends.</p><div className="room-countdown">Room closes in <strong>{formatRemaining(remaining)}</strong></div></div><div className="online-heading"><span>People here</span><span className="count">{users.length}</span></div><div className="user-list">{users.map((user) => <div className="user" key={user.id}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}{user.id === socket.id && <small>you</small>}</span><i className="online-dot" /></div>)}</div><div className="sidebar-bottom"><div className="privacy-box"><ShieldCheck size={18} /><span>Nothing is saved. This room disappears after everyone leaves.</span></div><button className="leave-button" onClick={leave}><LogOut size={17} /> Leave room</button></div></aside><section className="conversation"><header className="chat-header"><button className="icon-button menu-button" onClick={() => setShowDetails(true)} aria-label="Show room details"><Menu size={21} /></button><div><span className="online-label"><i className="online-dot" />Live room</span><h2>Room {room}</h2></div><span className="header-countdown">{formatRemaining(remaining)}</span><button className="icon-button theme-chat-toggle" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={19} /> : <Moon size={19} />}</button></header><div className="message-list">{messages.length === 0 ? <div className="empty-chat"><span className="empty-icon"><MessageCircle size={25} /></span><h3>A quiet room</h3><p>Messages disappear automatically.</p></div> : messages.map((message) => <article className={`message ${message.userId === socket.id ? 'mine' : ''}`} key={message.id}><div className="message-meta"><strong>{message.userId === socket.id ? 'You' : message.name}</strong><time>{formatTime(message.sentAt)}</time><time className="expires-label">{formatRemaining(message.expiresAt - Date.now())}</time></div><div className="bubble">{message.text}</div></article>)}<div ref={bottomRef} /></div><div className="composer-wrap"><div className="typing">{typing.length > 0 && <><span className="typing-dots"><i /><i /><i /></span>{typing.join(', ')} {typing.length === 1 ? 'is' : 'are'} typing</>}</div><form className="composer" onSubmit={sendMessage}><button type="button" className="composer-action" aria-label="Add emoji">☺</button><input value={draft} onChange={updateDraft} placeholder="Write a message..." maxLength="1000" autoComplete="off" /><button className="send-button" type="submit" disabled={!draft.trim()} aria-label="Send message"><Send size={17} /></button></form><p className="composer-note">Messages disappear after {messageDurations.find((option) => option.value === messageTtlMs)?.label}. Room closes in {formatRemaining(remaining)}.</p></div></section></main>;
}

export default App;

const rootElement = document.getElementById('root');
const root = rootElement.__hushroomRoot || createRoot(rootElement);
rootElement.__hushroomRoot = root;
root.render(<App />);
