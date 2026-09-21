# Hushroom

Hushroom is a temporary private chat room. It uses React + Vite in the browser and Express + Socket.IO on the server.

## Privacy model

- Active rooms, usernames, and messages exist only in the Node.js process memory.
- There is no database, file persistence, `localStorage`, IndexedDB, cookie, analytics, or tracking code.
- Restarting the server erases every room and message. A room is erased when its last participant leaves or when its selected deadline is reached.
- New rooms can be configured to expire after 30 minutes, 1 hour, or 6 hours. The server broadcasts room expiry and rejects joins after destruction.
- Messages can be configured to disappear after 10 seconds, 30 seconds, 1 minute, 5 minutes, or 1 hour. Expired messages are removed from server memory and broadcast to every participant.
- Messages support temporary reactions (❤️ 😂 👍 😭 😮) and replies. Reactions are synchronized in real time, and replies keep only a short in-memory preview tied to the active message.
- Authors can edit or delete their own messages. Deleted messages show a temporary tombstone until their normal expiry.
- Room owners can remove users, lock or unlock new joins, change the room expiration, rotate the invite code, or destroy the room immediately. These controls are server-authorized and memory-only.
- Images and small files are transferred through Socket.IO and held only as bounded in-memory message data. This Render service has no persistent disk or object storage configured, so files disappear on message/room expiry, restart, or redeploy. Allowed types are JPEG, PNG, GIF, WebP, TXT, PDF, and ZIP, up to 5 MB; executable and script-like extensions are rejected.
- The server does not log message contents.
- User text is length-limited and sanitized before it is broadcast.

This is private from storage and tracking, but it is not end-to-end encrypted. Use HTTPS when putting it online and share room codes only with people you trust.

## Run locally

Install Node.js 20 or newer, then open a terminal in this folder:

```powershell
npm run install:all
npm run dev
```

Open `http://localhost:5173` in two browser windows. One person creates a room, chooses the message and room lifetimes, and others enter the six-character code. Use `Ctrl+C` to stop the server and erase the active rooms.

Right-click a message on desktop or press and hold it on mobile to reply. Use the reaction buttons below a message to add, change, or remove a reaction. Both interactions are temporary and disappear with the message.

The room owner controls are shown in the room details sidebar. Removing a participant disconnects their room access immediately; locking affects new joins while existing participants remain connected.

To test files, create a room in one browser, attach a supported file with the `+` button, send it, and join the room from another browser. Confirm the receiver can see the temporary attachment, then select a short message lifetime and confirm the attachment disappears when the message expires. Do not treat this as permanent file hosting.

For a production frontend build:

```powershell
npm run build
npm start
```

The backend health check is at `http://localhost:3001/health`.

## Put it online for free

The easiest free setup for this exact project is:

- **Render Web Service** for the Node.js + Socket.IO backend.
- **Vercel** for the static React + Vite frontend.

Render free services may sleep after inactivity, so the first visit after sleeping can take a little longer. Socket.IO WebSocket upgrades work on a Render Web Service. This app must use one backend instance because rooms are stored only in that instance's memory.

### 1. Create a GitHub repository

Create a private repository on GitHub and upload this entire project, including `server`, `client`, `package.json`, and `render.yaml`. Do not commit `.env` files containing secrets. This project has no required secrets.

### 2. Deploy the backend on Render

1. Open [render.com](https://render.com), create an account, and connect GitHub.
2. Select **New > Blueprint** and choose the repository.
3. Render reads `render.yaml` and creates `hushroom-server`.
4. Set the `ALLOWED_ORIGINS` environment variable temporarily to the frontend origin, deploy, and wait for the service to become live.
5. Copy the backend URL. It will look like:

	`https://hushroom-server.onrender.com`

6. Open the backend health URL in a browser. It should show JSON similar to `{"status":"ok","temporaryRooms":0}`.

### 3. Deploy the frontend on Vercel

1. Open [vercel.com](https://vercel.com), create an account, and import the same GitHub repository.
2. Set **Root Directory** to `client`.
3. Keep the framework as **Vite**.
4. Set the build command to `npm run build`.
5. Set the output directory to `dist`.
6. Add this environment variable for Production:

	`VITE_SERVER_URL=https://hushroom-server.onrender.com`

7. Deploy the site. Vercel gives you a URL like:

	`https://hushroom-abc123.vercel.app`

### 4. Lock the backend to your frontend

Return to Render, open the `hushroom-server` service, and change:

`ALLOWED_ORIGINS=https://hushroom-abc123.vercel.app`

Use your actual Vercel URL and do not add a trailing slash. Redeploy the backend after saving the variable. This allows browser requests and Socket.IO connections only from your frontend URL.

### 5. Test from different networks

Open the Vercel URL on your computer and create a room. Copy the full room link, then open it on a phone using mobile data. Join with a different name and send messages both ways. Confirm the people list, typing indicator, and leave behavior.

The final link friends use is:

`https://hushroom-abc123.vercel.app/?room=ABC123`

The actual room code will be generated by the server.

### Privacy and deployment limits

The Render process stores active rooms, names, and messages only in its volatile `Map`. There is no database, disk write, browser storage, cookie, analytics, or permanent history. Restarting or redeploying Render erases all rooms. The app also erases a room when its last participant leaves or when its selected expiration deadline is reached.

Do not deploy multiple backend instances: separate instances would have separate in-memory rooms. Do not use a serverless-only backend for Socket.IO because it cannot reliably keep a long-lived WebSocket connection.