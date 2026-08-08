# Lightweight Serverless P2P Meeting App

A minimalist, high-performance, 2-person video conferencing application built with vanilla HTML5, CSS3, and JavaScript. This application connects peers directly using **WebRTC** and utilizes **Firebase Realtime Database** as a completely serverless signaling channel, requiring no heavy backend infrastructure.

Available [here](https://hnikolov.github.io/p2p-meeting)

## 🚀 Key Features

*   **100% Peer-to-Peer:** Audio and video streams bypass intermediate servers and flow directly between participants.
*   **Shared Secret Rooms:** Enter an agreed-upon passphrase (e.g., `hristo-room`) to connect securely without sharing complex URL paths.
*   **Audio-First Bandwidth Optimization:** Automatically hard-caps video bandwidth (~400kbps) and sets audio streams to high network priority (`high`). If your connection drops, video quality degrades gracefully so audio never stutters.
*   **Hot-Swappable Hardware Selectors:** Switch between multiple microphones or webcams mid-call instantly without dropping the connection.
*   **Automatic Cleanup:** Each participant clears their own signaling records automatically via browser lifecycle triggers (`beforeunload`) when they leave the page.

---

## 🛠️ Tech Stack

*   **Frontend:** Vanilla HTML5, JavaScript (ES6 Modules), CSS Grid.
*   **P2P Core:** Native Browser WebRTC API (`RTCPeerConnection`).
*   **Signaling Channel:** Firebase Realtime Database (Client-SDK driven).
*   **Hosting Deployment:** GitHub Pages (Static site hosting).

---

## ⚙️ Configuration Setup

Before deploying to GitHub Pages or running locally, you must link your own free Firebase database configuration.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click Add project, name it (e.g., p2p-meeting), and disable Google Analytics.
3. Click the **Web (</>)** icon to register a web app. Name it and click Register app.
4. Copy your `firebaseConfig` object and overwrite the placeholder inside `index.html`:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.REGION.firebasedatabase.app",
    projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

5. In your Firebase Left Sidebar, click **Build** > **Realtime Database** -> **Create Database**.
6. Set the rules to **Test Mode** and click **Enable** so that both peers can read/write connection tokens freely:
```json
{
  "rules": {
    ".read": "true",
    ".write": "true"
  }
}
```

---

## 💻 Local Testing & Corporate Firewall Bypass

Due to modern browser security restrictions, JavaScript Modules (`type="module"`) cannot run via the local file system protocol (`file:///`). You must serve the application through a local web server layer.

Open your terminal in the repository folder and run:

```bash
# Using Python 3
python -m http.server 8000
```
Then navigate your browser to `http://localhost:8000`.

### 📱 PWA Install Mode (Fullscreen App)
This project now includes a PWA setup modeled after your working pattern:

* `manifest.json` for app metadata and install prompts.
* `sw.js` service worker with versioned cache + stale cache cleanup.
* App icons: `icon.svg`, `icon-192.png`, `icon-512.png`.
* Mobile app meta tags in `index.html` (`theme-color`, Apple standalone tags).

Important requirements:

1. PWA install only works on secure origins (`https://`) or `http://localhost`.
2. Opening `index.html` via `file:///` will not provide reliable install behavior.
3. After deploy/update, refresh once so the latest service worker version is activated.

Install flow:

1. Open the app on `https://...` (or `http://localhost` for local testing).
2. In Chrome/Edge Android, use **Install app** / **Add to Home screen**.
3. On iOS Safari, use **Share** -> **Add to Home Screen**.
4. Launch from the home-screen icon to run without browser controls.

### ⚠️ Corporate Network Note
Corporate networks and proxies often intercept outbound CDN scripts (`gstatic.com`) or block streaming UDP traffic entirely. For development on work laptops, make sure you download `firebase-app.js` and `firebase-database.js` locally to your root folder as configured in the scripts. For testing the actual call connection, ensure both devices are connected to less restrictive consumer/home networks.

### ⚠️ Known Issue: Some Phone Connections
Laptop-to-laptop browser sessions are currently stable and fully functional. Some laptop-to-phone and phone-to-phone sessions can fail during ICE negotiation (for example: selected pair remains unavailable and media packet counters stay at zero), which results in no remote media and eventual call failure.

This appears to depend on mobile network/NAT behavior and relay reachability rather than the room signaling flow itself. If you must test mobile interoperability, prefer:
1. Devices on the same Wi-Fi network.
2. A dedicated, production-grade TURN service with your own credentials.
3. Browser versions with WebRTC support fully up to date.

---

## 📞 How to Start a Call

1. Both users open the live GitHub Pages deployment link.
2. Grant camera and microphone permissions when prompted by your browser.
3. Agree on a custom key (e.g., `our-private-room`).
4. **User 1 (Host):** Type the key into the input box and click **Call**.
5. **User 2:** Type the *exact same* key into their box and click **Call**.
6. The app auto-detects whether to create a new room or join the existing one for that key.
7. The same button toggles to **Disconnect** while connected or connecting. Click it to leave and return to **Call** mode.
