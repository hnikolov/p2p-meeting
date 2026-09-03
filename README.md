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

## ⚙️ Firebase Setup

Before deploying to GitHub Pages or running locally, configure a Firebase project for the signaling database and enable the minimum secure access needed for browser-based peers.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Create a project (for example, `p2p-meeting`) and disable Google Analytics unless you want it enabled for other reasons.
3. Open the project and register a web app from the project overview page.
4. Copy the generated `firebaseConfig` values and place them in the browser app configuration used by this project.

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

5. In Firebase, open **Build** > **Authentication** > **Sign-in method** and enable **Anonymous**.
6. Open **Build** > **Realtime Database** and create the database.
7. Set the database rules to authenticated access scoped to the room tree:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

This is the recommended pattern for a browser-based WebRTC signaling app: anonymous clients authenticate with Firebase, and each room is limited to authenticated reads and writes. The app performs this anonymous authentication automatically when it starts, which keeps the signaling flow simple for peer-to-peer meetings while avoiding the insecure global open-database model.

---

## ⚠️ Known issue: peer-to-peer call failure behind a company firewall

This app relies on direct WebRTC peer-to-peer media exchange. In some real-world network conditions, especially when one participant is on a corporate network or behind a strict firewall/VPN/NAT, signaling succeeds but the media path still fails.

Typical symptoms observed in practice:

- both peers complete the room setup and SDP exchange
- the app shows status messages such as “Answer transmitted. Syncing streams...” or “Connected! Peer media stream verified.”
- no actual video is transmitted
- after the internal WebRTC timeout, the app resets with: “Connection failed. You can try the same room key again.”

This is a WebRTC ICE/NAT traversal issue rather than a Firebase or room-creation bug. Firebase is only used for signaling; it does not carry the actual audio/video traffic. If the browser cannot find a valid ICE route between the two devices, the call appears to connect at the signaling layer but cannot send media end-to-end.

This issue is especially common when:

- one side is on a company network or VPN
- one side is behind a restrictive corporate firewall or symmetric NAT
- the other side is on a mobile carrier network or another NAT domain

In such cases, direct browser-to-browser UDP media is often blocked or unusable, even though the signaling data is exchanged successfully. That is why the app can look “connected” before the actual media session fails.

This is a known limitation of pure peer-to-peer WebRTC in restrictive enterprise environments. The app remains a peer-to-peer design, but it is not guaranteed to work reliably when direct media paths are blocked by network policy.

---

## ⚠️ Known issue: Android Chrome cannot switch browser audio output device

On desktop browsers, the app can enumerate `audiooutput` devices and allow the user to select a different speaker or headset through the built-in output selector. On Android Chrome, this is not generally supported by the browser Web API.

Symptoms observed in practice:

- the selector shows `System Default` as selected
- the browser reports no selectable output devices
- the browser disables the speaker-output dropdown on Android Chrome
- the device effectively falls back to the OS-controlled default output (earpiece or loudspeaker), rather than letting the web app choose a specific output route

This is not a bug in the app's selector logic. The root cause is browser capability: on Android Chrome, `HTMLMediaElement.setSinkId()` is not implemented, so the Web app cannot programmatically force the output to a different device like it can on desktop Chrome/Edge. In practice, the browser decides whether audio goes through the earpiece or loudspeaker, and the app must respect that limitation.

If the application requires explicit earpiece vs loudspeaker switching on Android, that needs to be implemented in a native Android wrapper or WebView integration, not in standard browser JavaScript alone.

---

## 💻 Local Testing

Due to modern browser security restrictions, JavaScript Modules (`type="module"`) cannot run via the local file system protocol (`file:///`). You must serve the application through a local web server layer.

Open your terminal in the repository folder and run:

```bash
# Using Python 3
python -m http.server 8000
```
Then navigate your browser to `http://localhost:8000`.

### 📱 PWA Install Mode (Fullscreen App)
This project now includes a PWA setup modeled after the following working pattern:

* `manifest.json` for app metadata and install prompts.
* `sw.js` service worker with versioned cache + stale cache cleanup.
* App icons: `icon.svg`, `icon-192.png`, `icon-512.png`.
* Mobile app meta tags in `index.html` (`theme-color`, Apple standalone tags).

The install entry point is the top-level `index.html` page, while the application logic is loaded from the separate JavaScript module, so the service worker and install metadata are still rooted at the app entry page rather than the script file itself.

Important requirements:

1. PWA install only works on secure origins (`https://`) or `http://localhost`.
2. Opening `index.html` via `file:///` will not provide reliable install behavior.
3. After deploy/update, refresh once so the latest service worker version is activated.

Install flow:

1. Open the app on `https://...` (or `http://localhost` for local testing).
2. In Chrome/Edge Android, use **Install app** / **Add to Home screen**.
3. On iOS Safari, use **Share** -> **Add to Home Screen**.
4. Launch from the home-screen icon to run without browser controls.

---

## 📞 How to Start a Call

1. Both users open the live GitHub Pages deployment link.
2. Grant camera and microphone permissions when prompted by your browser.
3. Agree on a custom key (e.g., `our-private-room`).
4. **User 1 (Host):** Type the key into the input box and click **Call**.
5. **User 2:** Type the *exact same* key into their box and click **Call**.
6. The app auto-detects whether to create a new room or join the existing one for that key.
7. The same button toggles to **Disconnect** while connected or connecting. Click it to leave and return to **Call** mode.
