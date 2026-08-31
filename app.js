const settingsToggle = document.getElementById('settingsToggleBtn');
const deviceSelector = document.getElementById('deviceSelector');

settingsToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  deviceSelector.classList.toggle('active');
});

document.addEventListener('click', (e) => {
  if (!deviceSelector.contains(e.target) && e.target !== settingsToggle) {
    deviceSelector.classList.remove('active');
  }
});

function handleMediaLayoutChange() {
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  const connectionCard = document.getElementById('connectionControlsCard');
  const portraitHeaderTarget = document.getElementById('roomHeaderCard');
  const bottomBar = document.querySelector('.bottom-bar');
  const statusText = document.getElementById('statusText');
  const metaStatusBar = document.querySelector('.meta-status-bar');

  if (isPortrait) {
    if (connectionCard.parentElement !== portraitHeaderTarget) {
      portraitHeaderTarget.appendChild(connectionCard);
      portraitHeaderTarget.appendChild(statusText);
    }
  } else {
    if (connectionCard.parentElement !== bottomBar) {
      bottomBar.insertBefore(connectionCard, bottomBar.firstChild);
      metaStatusBar.insertBefore(statusText, metaStatusBar.firstChild);
    }
  }
}

window.addEventListener('resize', handleMediaLayoutChange);
window.addEventListener('orientationchange', handleMediaLayoutChange);
document.addEventListener('DOMContentLoaded', handleMediaLayoutChange);

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, get, ref, runTransaction, set, onChildAdded, onValue, remove, onDisconnect } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB2F_QfZFAwitJrFEcvCTadOsLOVETkRpg',
  authDomain: 'p2p-meeting-c4e09.firebaseapp.com',
  databaseURL: 'https://p2p-meeting-c4e09-default-rtdb.europe-west1.firebasedatabase.app/',
  projectId: 'p2p-meeting-c4e09',
  storageBucket: 'p2p-meeting-c4e09.firebasestorage.app',
  messagingSenderId: '977559758143',
  appId: '1:977559758143:web:014c42c579988a25555f8a'
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

signInAnonymously(auth).catch((error) => {
  console.error('Firebase anonymous sign-in failed:', error);
  setStatusText('Could not authenticate to Firebase. Please enable Anonymous sign-in in Firebase Authentication.');
});

let localStream;
let remoteStream = null;
let peerConnection;
let activeRoomName = null;
let localParticipantRole = null;
let activeSessionId = null;
let remotePresenceSeen = false;
let remoteIceQueue = [];
let signalingUnsubscribers = [];
let joinTimeoutId = null;

function getRoomCleanupPaths(roomName, role) {
  const roomBasePath = `rooms/${roomName}`;

  if (role === 'caller') {
    return {
      offer: `${roomBasePath}/offer`,
      candidates: `${roomBasePath}/callerCandidates`,
      participant: `${roomBasePath}/participants/caller`
    };
  }

  return {
    offer: `${roomBasePath}/answer`,
    candidates: `${roomBasePath}/calleeCandidates`,
    participant: `${roomBasePath}/participants/callee`
  };
}

function getRoomSignalPaths(roomName, role) {
  const isCaller = role === 'caller';

  return {
    remoteSdpPath: isCaller ? `rooms/${roomName}/answer` : `rooms/${roomName}/offer`,
    remoteCandidatesPath: isCaller ? `rooms/${roomName}/calleeCandidates` : `rooms/${roomName}/callerCandidates`,
    remotePresencePath: `rooms/${roomName}/participants/${isCaller ? 'callee' : 'caller'}`
  };
}

const webRtcDebugger = new WebRTCDebugger();
webRtcDebugger.bindToggleKey();

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ],
  iceTransportPolicy: 'all'
};

const roomKeyInput = document.getElementById('roomKey');
const callBtn = document.getElementById('callBtn');
const muteBtn = document.getElementById('muteBtn');
const camBtn = document.getElementById('camBtn');
const statusText = document.getElementById('statusText');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const mainVideoHost = document.getElementById('mainVideoHost');
const pipVideoHost = document.getElementById('pipVideoHost');
const mainVideoLabel = document.getElementById('mainVideoLabel');
const pipVideoLabel = document.getElementById('pipVideoLabel');
const pipCard = document.getElementById('pipCard');
const audioSource = document.getElementById('audioSource');
const videoSource = document.getElementById('videoSource');
const audioSampleRate = document.getElementById('audioSampleRate');
const audioBitDepth = document.getElementById('audioBitDepth');
const audioChannels = document.getElementById('audioChannels');
const audioBitrateCeiling = document.getElementById('audioBitrateCeiling');
const videoResolution = document.getElementById('videoResolution');
const videoFps = document.getElementById('videoFps');
const videoDegradation = document.getElementById('videoDegradation');
const videoBitrateCeiling = document.getElementById('videoBitrateCeiling');
const moveBtn = document.getElementById('moveBtn');
const swapBtn = document.getElementById('swapBtn');
const sizeBtn = document.getElementById('sizeBtn');
const appVersionText = document.getElementById('appVersion');
const elapsedTimeText = document.getElementById('elapsedTime');

const APP_VERSION = 'v0.4.3';
const ROOM_KEY_STORAGE_KEY = 'p2p-meeting:last-room-key';
const PIP_LAYOUT_STORAGE_KEY = 'p2p-meeting:pip-layout-v1';
const AUDIO_BITRATE_SPEECH_BPS = 128000;
const AUDIO_BITRATE_MUSIC_BPS = 256000;

const KEYBOARD_SHORTCUTS = {
  call: 'q',
  mute: 'space',
  camera: 'c',
  move: 'm',
  swap: 'x',
  size: 'v'
};

const DEVICE_SELECT_REFOCUS_GUARD_MS = 150;

const PIP_POSITIONS = [
  { key: 'top-right', top: '16px', right: '16px', bottom: 'auto', left: 'auto', transform: 'none' },
  { key: 'top-center', top: '16px', right: 'auto', bottom: 'auto', left: '50%', transform: 'translateX(-50%)' },
  { key: 'top-left', top: '16px', right: 'auto', bottom: 'auto', left: '16px', transform: 'none' },
  { key: 'bottom-left', top: 'auto', right: 'auto', bottom: '16px', left: '16px', transform: 'none' },
  { key: 'bottom-center', top: 'auto', right: 'auto', bottom: '16px', left: '50%', transform: 'translateX(-50%)' },
  { key: 'bottom-right', top: 'auto', right: '16px', bottom: '16px', left: 'auto', transform: 'none' }
];

const PIP_SIZES = [
  { key: 'small', width: 'min(20vw, 240px)', minWidth: '140px' },
  { key: 'medium', width: 'min(24vw, 320px)', minWidth: '190px' },
  { key: 'large', width: 'min(30vw, 400px)', minWidth: '220px' }
];

const pipViewState = {
  positionIndex: PIP_POSITIONS.length - 1,
  sizeIndex: 1,
  mainView: 'remote'
};

const deviceSelectUiState = {
  audioOpenedAt: 0,
  videoOpenedAt: 0
};

let viewportMetricsRafId = 0;
let elapsedTimerId = 0;
let elapsedTimerStartedAt = 0;
let isMediaChanging = false;
const STALE_ROOM_TTL_MS = 45000;

function formatElapsedTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setElapsedTimeMs(ms) {
  if (!elapsedTimeText) return;
  elapsedTimeText.innerText = formatElapsedTime(ms);
}

function startElapsedTimer({ reset = false } = {}) {
  if (reset) {
    elapsedTimerStartedAt = Date.now();
    setElapsedTimeMs(0);
  } else if (!elapsedTimerStartedAt) {
    elapsedTimerStartedAt = Date.now();
  }

  if (elapsedTimerId) {
    clearInterval(elapsedTimerId);
  }

  elapsedTimerId = setInterval(() => {
    setElapsedTimeMs(Date.now() - elapsedTimerStartedAt);
  }, 250);
}

function stopElapsedTimer({ reset = false } = {}) {
  if (elapsedTimerId) {
    clearInterval(elapsedTimerId);
    elapsedTimerId = 0;
  }

  if (reset) {
    elapsedTimerStartedAt = 0;
    setElapsedTimeMs(0);
  }
}

const videoStatusTrackers = {
  main: { labelEl: mainVideoLabel, videoEl: remoteVideo, baseText: 'Remote', rafId: 0 },
  pip: { labelEl: pipVideoLabel, videoEl: localVideo, baseText: 'Local', rafId: 0 }
};

function syncVideoTrackLabel(cardKey, videoEl, baseText) {
  const tracker = videoStatusTrackers[cardKey];
  if (!tracker) return;

  tracker.videoEl = videoEl;
  tracker.baseText = baseText;

  if (tracker.labelEl) {
    tracker.labelEl.innerText = `${baseText}: ? x ?`;
  }
}

function updateVideoTrackLabelState(cardKey) {
  const tracker = videoStatusTrackers[cardKey];
  if (!tracker || !tracker.labelEl || !tracker.videoEl) return;

  const { videoEl } = tracker;
  const windowWidth = Math.max(0, Math.round(videoEl.clientWidth || 0));
  const windowHeight = Math.max(0, Math.round(videoEl.clientHeight || 0));
  const streamWidth = Math.max(0, Math.round(videoEl.videoWidth || 0));
  const streamHeight = Math.max(0, Math.round(videoEl.videoHeight || 0));

  const renderedWidthText = windowWidth > 0 ? windowWidth : '?';
  const renderedHeightText = windowHeight > 0 ? windowHeight : '?';
  const streamWidthText = streamWidth > 0 ? streamWidth : '?';
  const streamHeightText = streamHeight > 0 ? streamHeight : '?';

  tracker.labelEl.innerText = `${tracker.baseText}: ${renderedWidthText} x ${renderedHeightText} (${streamWidthText} x ${streamHeightText})`;
}

function startVideoTrackTelemetry() {
  Object.keys(videoStatusTrackers).forEach((cardKey) => {
    const tracker = videoStatusTrackers[cardKey];
    if (!tracker) return;

    if (tracker.rafId) {
      cancelAnimationFrame(tracker.rafId);
    }

    const tick = () => {
      updateVideoTrackLabelState(cardKey);
      tracker.rafId = requestAnimationFrame(tick);
    };

    tick();
  });
}

startVideoTrackTelemetry();

// STREAM SETTINGS START
function getAudioFilterInputState() {
  const filterInputs = Array.from(document.querySelectorAll('#deviceSelector .device-section .device-toggle input')).slice(0, 3);

  return {
    echoCancellation: filterInputs[0] ? filterInputs[0].checked : true,
    noiseSuppression: filterInputs[1] ? filterInputs[1].checked : true,
    autoGainControl: filterInputs[2] ? filterInputs[2].checked : true
  };
}

function parseSampleRateFromUi() {
  const value = (audioSampleRate && audioSampleRate.value) || '48000 Hz';
  const match = value.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 48000;
}

function parseBitDepthFromUi() {
  const value = (audioBitDepth && audioBitDepth.value) || '16-bit';
  const match = value.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 16;
}

function parseChannelCountFromUi() {
  const value = (audioChannels && audioChannels.value) || 'Mono';
  return value.toLowerCase() === 'stereo' ? 2 : 1;
}

function parseRateBpsFromUi(selectElement, fallbackBps) {
  const value = selectElement && selectElement.value ? selectElement.value : '';
  const match = value.match(/(\d+)/);
  const parsedValue = match ? Number.parseInt(match[1], 10) : fallbackBps;
  return Number.isFinite(parsedValue) ? parsedValue * 1000 : fallbackBps;
}

function getAudioBitrateBps() {
  return parseRateBpsFromUi(audioBitrateCeiling, 256);
}

function getVideoBitrateBps() {
  return parseRateBpsFromUi(videoBitrateCeiling, 2000);
}

function resolveVideoConstraints() {
  const selectedResolution = (videoResolution && videoResolution.value) || '720p';
  const resolutionMap = {
    '360p': { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 } },
    '720p': { width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } },
    '1080p': { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }
  };

  return resolutionMap[selectedResolution] || resolutionMap['720p'];
}

function buildVideoConstraints(deviceId = null) {
  const constraints = {
    ...resolveVideoConstraints(),
    frameRate: { ideal: (videoFps && videoFps.value ? Number.parseFloat(videoFps.value) : 30), max: (videoFps && videoFps.value ? Number.parseFloat(videoFps.value) : 30) },
    aspectRatio: { ideal: 1.7777777778 }
  };

  if (deviceId) {
    constraints.deviceId = { exact: deviceId };
  }

  return constraints;
}

function buildAudioConstraints(deviceId = null, fallback = false) {
  const captureConfig = {
    ...getAudioFilterInputState(),
    channelCount: { ideal: parseChannelCountFromUi(), max: parseChannelCountFromUi() },
    sampleRate: { ideal: parseSampleRateFromUi() },
    sampleSize: { ideal: parseBitDepthFromUi() }
  };

  if (fallback) {
    const fallbackConfig = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };

    if (deviceId) {
      fallbackConfig.deviceId = { exact: deviceId };
    }

    return fallbackConfig;
  }

  if (deviceId) {
    captureConfig.deviceId = { exact: deviceId };
  }

  return captureConfig;
}

function getPreferredAudioBitrateBps() {
  return getAudioBitrateBps();
}

function applyAudioSenderEncodingPreferences(audioSender) {
  if (!audioSender || typeof audioSender.getParameters !== 'function' || typeof audioSender.setParameters !== 'function') {
    return;
  }

  const preferredBitrateBps = getPreferredAudioBitrateBps();
  if (!Number.isFinite(preferredBitrateBps) || preferredBitrateBps <= 0) {
    return;
  }

  let audioParameters;
  try {
    audioParameters = audioSender.getParameters() || {};
  } catch (err) {
    console.warn('Audio sender parameters are unavailable:', err);
    return;
  }

  audioParameters.encodings = Array.isArray(audioParameters.encodings) && audioParameters.encodings.length > 0
    ? audioParameters.encodings.map(encoding => ({
        ...encoding,
        priority: 'high',
        maxBitrate: preferredBitrateBps
      }))
    : [{ priority: 'high', maxBitrate: preferredBitrateBps }];

  audioSender.setParameters(audioParameters)
    .catch(err => console.warn('Audio sender bitrate tuning skipped by browser:', err));
}

async function setLocalDescriptionSafely(peerConn, description) {
  if (!peerConn || !description) {
    throw new Error('Peer connection and description are required.');
  }

  try {
    await peerConn.setLocalDescription(description);
    return peerConn.localDescription || description;
  } catch (err) {
    console.warn('setLocalDescription rejected with the original SDP; aborting call setup:', err);
    throw err;
  }
}

async function getAudioInputStream(deviceId = null) {
  const primaryConstraints = buildAudioConstraints(deviceId, false);

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: primaryConstraints });
  } catch (err) {
    const fallbackConstraints = buildAudioConstraints(deviceId, true);
    return await navigator.mediaDevices.getUserMedia({ audio: fallbackConstraints });
  }
}

async function executeAutomatedAudioSwap() {
  if (!localStream || isMediaChanging) return;

  isMediaChanging = true;

  try {
    const currentAudioTracks = localStream.getAudioTracks();
    currentAudioTracks.forEach(track => {
      localStream.removeTrack(track);
      track.stop();
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(audioSource.value || null, false)
    });
    const newAudioTrack = newStream.getAudioTracks()[0];

    if (!newAudioTrack) {
      throw new Error('No audio track returned for the selected hardware profile.');
    }

    const isCurrentlyMuted = muteBtn.getAttribute('data-muted') === 'true';
    newAudioTrack.enabled = !isCurrentlyMuted;
    localStream.addTrack(newAudioTrack);

    if (peerConnection) {
      const audioSender = peerConnection.getSenders().find(sender => sender.track && sender.track.kind === 'audio');
      if (audioSender) {
        await audioSender.replaceTrack(newAudioTrack);
        applyAudioSenderEncodingPreferences(audioSender);
      }
    }

    webRtcDebugger.start(peerConnection, localStream);
    await pushAudioEncodingParameters();
  } catch (err) {
    console.error('Audio configuration update failed:', err);
    alert('Could not apply the selected audio configuration.');
  } finally {
    isMediaChanging = false;
  }
}

async function executeAutomatedVideoScale() {
  if (!localStream) return;

  try {
    const videoTracks = localStream.getVideoTracks();
    if (!videoTracks || videoTracks.length === 0) return;

    await videoTracks[0].applyConstraints(buildVideoConstraints());
    await pushNetworkEncodingParameters();
  } catch (err) {
    console.error('Video configuration update failed:', err);
    alert('Could not apply the selected video configuration.');
  }
}

async function pushNetworkEncodingParameters() {
  if (!peerConnection) return;

  const videoSender = peerConnection.getSenders().find(sender => sender.track && sender.track.kind === 'video');
  if (!videoSender) return;

  try {
    const params = videoSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    const selectedFps = Number.parseFloat((videoFps && videoFps.value) || '30');
    const selectedBitrateBps = getVideoBitrateBps();
    const degradationPreference = videoDegradation && videoDegradation.value === 'Maintain Resolution'
      ? 'maintain-resolution'
      : videoDegradation && videoDegradation.value === 'Balanced Mode'
        ? 'balanced'
        : 'maintain-framerate';

    params.encodings[0].maxFramerate = Number.isFinite(selectedFps) && selectedFps > 0 ? selectedFps : 30;
    params.encodings[0].maxBitrate = Number.isFinite(selectedBitrateBps) && selectedBitrateBps > 0 ? selectedBitrateBps : 2000000;
    params.degradationPreference = degradationPreference;

    await videoSender.setParameters(params);
  } catch (err) {
    console.error('Video sender parameter error:', err);
  }
}

async function pushAudioEncodingParameters() {
  if (!peerConnection) return;

  const audioSender = peerConnection.getSenders().find(sender => sender.track && sender.track.kind === 'audio');
  if (!audioSender) return;

  try {
    const params = audioSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    const selectedBitrateBps = getAudioBitrateBps();
    params.encodings[0].maxBitrate = Number.isFinite(selectedBitrateBps) && selectedBitrateBps > 0 ? selectedBitrateBps : 256000;
    await audioSender.setParameters(params);
  } catch (err) {
    console.error('Audio sender parameter error:', err);
  }
}

async function applyVideoSourceById(videoDeviceId = null) {
  if (!localStream) return;

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(videoDeviceId)
  });

  const newVideoTrack = newStream.getVideoTracks()[0];
  const oldVideoTrack = localStream.getVideoTracks()[0];

  if (!newVideoTrack) {
    throw new Error('No video track returned for selected profile.');
  }

  if (oldVideoTrack) {
    localStream.removeTrack(oldVideoTrack);
    oldVideoTrack.stop();
  }

  localStream.addTrack(newVideoTrack);
  localVideo.srcObject = localStream;

  if (peerConnection) {
    const senders = peerConnection.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(newVideoTrack);
      await pushNetworkEncodingParameters();
    }
  }
}

async function applyAudioSourceById(audioDeviceId = null) {
  if (!localStream) return;

  const newStream = await getAudioInputStream(audioDeviceId);
  const newAudioTrack = newStream.getAudioTracks()[0];
  const oldAudioTrack = localStream.getAudioTracks()[0];

  if (!newAudioTrack) {
    throw new Error('No audio track returned for selected profile.');
  }

  const isCurrentlyMuted = muteBtn.getAttribute('data-muted') === 'true';
  newAudioTrack.enabled = !isCurrentlyMuted;

  if (oldAudioTrack) {
    localStream.removeTrack(oldAudioTrack);
    oldAudioTrack.stop();
  }

  localStream.addTrack(newAudioTrack);

  if (peerConnection) {
    const senders = peerConnection.getSenders();
    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
    if (audioSender) {
      await audioSender.replaceTrack(newAudioTrack);
      applyAudioSenderEncodingPreferences(audioSender);
      await pushAudioEncodingParameters();
    }
  }

  webRtcDebugger.start(peerConnection, localStream);
}
// STREAM SETTINGS END

function updateViewportLayoutMetrics() {
  const visualViewport = window.visualViewport;
  const viewportWidth = Math.round(visualViewport ? visualViewport.width : window.innerWidth);
  const viewportHeight = Math.round(visualViewport ? visualViewport.height : window.innerHeight);
  const isPortraitViewport = viewportHeight >= viewportWidth;

  document.documentElement.style.setProperty('--app-vh', `${viewportHeight}px`);

  const compactViewport = isPortraitViewport && viewportHeight < 700;
  document.body.classList.toggle('compact-viewport', compactViewport);
}

function scheduleViewportLayoutMetricsUpdate() {
  if (viewportMetricsRafId) {
    cancelAnimationFrame(viewportMetricsRafId);
  }

  viewportMetricsRafId = requestAnimationFrame(() => {
    viewportMetricsRafId = 0;
    updateViewportLayoutMetrics();
  });
}

function persistRoomKey() {
  try {
    const roomKeyValue = (roomKeyInput.value || '').trim();
    if (!roomKeyValue) {
      return;
    }

    localStorage.setItem(ROOM_KEY_STORAGE_KEY, roomKeyValue);
  } catch {
    // Ignore storage failures.
  }
}

function restoreRoomKey() {
  try {
    const savedRoomKey = localStorage.getItem(ROOM_KEY_STORAGE_KEY);
    if (typeof savedRoomKey === 'string' && savedRoomKey.trim()) {
      roomKeyInput.value = savedRoomKey;
    }
  } catch {
    // Ignore storage failures.
  }
}

function persistPipLayout() {
  try {
    const payload = {
      positionIndex: pipViewState.positionIndex,
      sizeIndex: pipViewState.sizeIndex
    };
    localStorage.setItem(PIP_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function restorePipLayout() {
  try {
    const raw = localStorage.getItem(PIP_LAYOUT_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const positionIndex = Number(parsed && parsed.positionIndex);
    const sizeIndex = Number(parsed && parsed.sizeIndex);

    if (Number.isInteger(positionIndex) && positionIndex >= 0 && positionIndex < PIP_POSITIONS.length) {
      pipViewState.positionIndex = positionIndex;
    }

    if (Number.isInteger(sizeIndex) && sizeIndex >= 0 && sizeIndex < PIP_SIZES.length) {
      pipViewState.sizeIndex = sizeIndex;
    }
  } catch {
    // Ignore invalid / corrupt storage.
  }
}

async function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (!window.isSecureContext) {
    console.info('PWA install support is disabled on insecure origins. Use HTTPS or localhost.');
    return;
  }

  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

function tryPlayRemoteVideo() {
  const playPromise = remoteVideo.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(err => {
      if (err && err.name === 'AbortError') {
        return;
      }
      console.warn('Remote video playback blocked:', err);
    });
  }
}

function setCallButtonsEnabled(enabled) {
  callBtn.disabled = !enabled;
}

function syncCallButtonMode() {
  const isConnectedOrConnecting = Boolean(activeRoomName);
  callBtn.innerText = isConnectedOrConnecting ? 'Leave' : 'Call';
  callBtn.classList.toggle('btn-call-disconnect', isConnectedOrConnecting);
}

function setDeviceControlsEnabled(enabled) {
  audioSource.disabled = !enabled;
  videoSource.disabled = !enabled;
  muteBtn.disabled = !enabled;
  camBtn.disabled = !enabled;
}

function setPipControlsEnabled(enabled) {
  moveBtn.disabled = !enabled;
  swapBtn.disabled = !enabled;
  sizeBtn.disabled = !enabled;
}

function syncSelectedDeviceTitles() {
  const audioLabel = audioSource.selectedOptions[0] ? audioSource.selectedOptions[0].text : '';
  const videoLabel = videoSource.selectedOptions[0] ? videoSource.selectedOptions[0].text : '';
  audioSource.title = audioLabel;
  videoSource.title = videoLabel;
}

function collapseDeviceSelector(selectElement) {
  if (!selectElement) return;

  requestAnimationFrame(() => {
    selectElement.blur();
  });
}

function markDeviceSelectorOpen(selectElement) {
  if (selectElement === audioSource) {
    deviceSelectUiState.audioOpenedAt = Date.now();
    return;
  }

  if (selectElement === videoSource) {
    deviceSelectUiState.videoOpenedAt = Date.now();
  }
}

function getDeviceSelectorOpenTime(selectElement) {
  if (selectElement === audioSource) {
    return deviceSelectUiState.audioOpenedAt;
  }

  if (selectElement === videoSource) {
    return deviceSelectUiState.videoOpenedAt;
  }

  return 0;
}

function handleDeviceSelectorClick(selectElement) {
  const openedAt = getDeviceSelectorOpenTime(selectElement);
  if (!openedAt) return;

  if (Date.now() - openedAt < DEVICE_SELECT_REFOCUS_GUARD_MS) {
    return;
  }

  collapseDeviceSelector(selectElement);
}

function applyPipPosition() {
  const position = PIP_POSITIONS[pipViewState.positionIndex];
  pipCard.style.top = position.top;
  pipCard.style.right = position.right;
  pipCard.style.bottom = position.bottom;
  pipCard.style.left = position.left;
  pipCard.style.transform = position.transform;
}

function applyPipSize() {
  const size = PIP_SIZES[pipViewState.sizeIndex];
  pipCard.style.width = size.width;
  pipCard.style.minWidth = size.minWidth;
  sizeBtn.innerText = 'Size';
  sizeBtn.dataset.currentSize = size.key;
}

function applyMainView() {
  if (pipViewState.mainView === 'remote') {
    if (mainVideoHost.firstElementChild !== remoteVideo) {
      mainVideoHost.appendChild(remoteVideo);
    }
    if (pipVideoHost.firstElementChild !== localVideo) {
      pipVideoHost.appendChild(localVideo);
    }

    syncVideoTrackLabel('main', remoteVideo, 'Remote');
    syncVideoTrackLabel('pip', localVideo, 'Local');
    localVideo.muted = true;
  } else {
    if (mainVideoHost.firstElementChild !== localVideo) {
      mainVideoHost.appendChild(localVideo);
    }
    if (pipVideoHost.firstElementChild !== remoteVideo) {
      pipVideoHost.appendChild(remoteVideo);
    }

    syncVideoTrackLabel('main', localVideo, 'Local');
    syncVideoTrackLabel('pip', remoteVideo, 'Remote');
    localVideo.muted = true;
  }

  swapBtn.classList.toggle('btn-pip-active', pipViewState.mainView === 'local');
}

function applyPipLayoutState() {
  applyPipPosition();
  applyPipSize();
  applyMainView();
}

function updateToggleButtonVisuals() {
  const isMuted = muteBtn.getAttribute('data-muted') === 'true';
  const isCameraOff = camBtn.getAttribute('data-off') === 'true';

  muteBtn.classList.toggle('btn-toggle-active', isMuted);
  camBtn.classList.toggle('btn-toggle-active', isCameraOff);

  muteBtn.innerText = isMuted ? 'Unmute' : 'Mute';
  camBtn.innerText = isCameraOff ? 'Camera on' : 'Camera off';

  muteBtn.title = isMuted ? 'Unmute (Space)' : 'Mute (Space)';
  camBtn.title = isCameraOff ? 'Turn camera on (C)' : 'Turn camera off (C)';
}

function isTypingIntoControl(target) {
  if (!target) return false;
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function triggerButton(button) {
  if (!button || button.disabled) return;
  button.click();
}

function handleKeyboardShortcuts(event) {
  if (event.defaultPrevented || event.repeat) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (isTypingIntoControl(event.target)) return;

  const key = (event.key || '').toLowerCase();
  if (key === KEYBOARD_SHORTCUTS.call) {
    event.preventDefault();
    triggerButton(callBtn);
    return;
  }

  if (event.code === 'Space' || key === ' ' || key === 'spacebar') {
    event.preventDefault();
    triggerButton(muteBtn);
    return;
  }

  if (key === KEYBOARD_SHORTCUTS.camera) {
    event.preventDefault();
    triggerButton(camBtn);
    return;
  }

  if (key === KEYBOARD_SHORTCUTS.move) {
    event.preventDefault();
    triggerButton(moveBtn);
    return;
  }

  if (key === KEYBOARD_SHORTCUTS.swap) {
    event.preventDefault();
    triggerButton(swapBtn);
    return;
  }

  if (key === KEYBOARD_SHORTCUTS.size) {
    event.preventDefault();
    triggerButton(sizeBtn);
  }
}

function createSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getRemoteParticipantRole() {
  if (localParticipantRole === 'caller') return 'callee';
  if (localParticipantRole === 'callee') return 'caller';
  return null;
}

async function publishOwnPresence(roomName) {
  if (!roomName || !localParticipantRole || !activeSessionId) return;

  const ownPresenceRef = ref(db, `rooms/${roomName}/participants/${localParticipantRole}`);
  await set(ownPresenceRef, {
    sessionId: activeSessionId,
    updatedAt: Date.now()
  });
  await onDisconnect(ownPresenceRef).remove();
}

async function claimRoleSlot(roomName, role, sessionId) {
  const slotRef = ref(db, `rooms/${roomName}/participants/${role}`);
  const claimResult = await runTransaction(slotRef, currentValue => {
    if (!currentValue || !currentValue.sessionId || currentValue.sessionId === sessionId) {
      return {
        sessionId,
        updatedAt: Date.now()
      };
    }

    return;
  }, { applyLocally: false });

  return claimResult.committed;
}

async function cleanupStaleRoomState(roomName) {
  if (!roomName) return;

  const roomRef = ref(db, `rooms/${roomName}`);
  const roomSnapshot = await get(roomRef);
  if (!roomSnapshot.exists()) return;

  const roomData = roomSnapshot.val() || {};
  const participants = roomData.participants || {};
  const stalePaths = [];
  const now = Date.now();

  Object.entries(participants).forEach(([role, participant]) => {
    if (!participant || !participant.sessionId || !participant.updatedAt) return;
    if (activeSessionId && participant.sessionId === activeSessionId) return;
    if (now - participant.updatedAt > STALE_ROOM_TTL_MS) {
      stalePaths.push(ref(db, `rooms/${roomName}/participants/${role}`));
    }
  });

  const offerData = roomData.offer || null;
  if (offerData && offerData.sessionId && (!activeSessionId || offerData.sessionId !== activeSessionId) && offerData.updatedAt && now - offerData.updatedAt > STALE_ROOM_TTL_MS) {
    stalePaths.push(ref(db, `rooms/${roomName}/offer`));
  }

  const answerData = roomData.answer || null;
  if (answerData && answerData.sessionId && (!activeSessionId || answerData.sessionId !== activeSessionId) && answerData.updatedAt && now - answerData.updatedAt > STALE_ROOM_TTL_MS) {
    stalePaths.push(ref(db, `rooms/${roomName}/answer`));
  }

  if (roomData.callerCandidates && Object.keys(roomData.callerCandidates).length > 0) {
    const staleCallerCandidates = Object.entries(roomData.callerCandidates)
      .filter(([, candidateData]) => candidateData && candidateData.sessionId && (!activeSessionId || candidateData.sessionId !== activeSessionId) && candidateData.updatedAt && now - candidateData.updatedAt > STALE_ROOM_TTL_MS)
      .map(([candidateId]) => ref(db, `rooms/${roomName}/callerCandidates/${candidateId}`));
    stalePaths.push(...staleCallerCandidates);
  }

  if (roomData.calleeCandidates && Object.keys(roomData.calleeCandidates).length > 0) {
    const staleCalleeCandidates = Object.entries(roomData.calleeCandidates)
      .filter(([, candidateData]) => candidateData && candidateData.sessionId && (!activeSessionId || candidateData.sessionId !== activeSessionId) && candidateData.updatedAt && now - candidateData.updatedAt > STALE_ROOM_TTL_MS)
      .map(([candidateId]) => ref(db, `rooms/${roomName}/calleeCandidates/${candidateId}`));
    stalePaths.push(...staleCalleeCandidates);
  }

  if (stalePaths.length === 0) return;

  await Promise.allSettled(stalePaths.map(pathRef => remove(pathRef)));
  statusText.innerText = 'Recovered stale room state.';
}

async function evaluateRoomAction(roomName) {
  await cleanupStaleRoomState(roomName);

  const roomSnapshot = await get(ref(db, `rooms/${roomName}`));
  if (!roomSnapshot.exists()) {
    return { mode: 'start' };
  }

  const roomData = roomSnapshot.val() || {};
  const offerData = roomData.offer || null;
  const participantsData = roomData.participants || {};
  const callerPresence = participantsData.caller || null;
  const calleePresence = participantsData.callee || null;

  const hasJoinableOffer = Boolean(
    offerData &&
    offerData.sdp &&
    offerData.sdp.type === 'offer' &&
    offerData.sessionId
  );

  if (hasJoinableOffer) {
    if (calleePresence && calleePresence.sessionId && calleePresence.sessionId === offerData.sessionId) {
      return {
        mode: 'full',
        message: 'Room is already occupied by two participants.'
      };
    }

    return {
      mode: 'join'
    };
  }

  if ((callerPresence && callerPresence.sessionId) || (calleePresence && calleePresence.sessionId)) {
    return {
      mode: 'busy',
      message: 'Room is in transition. Ask both peers to disconnect and retry.'
    };
  }

  return { mode: 'start' };
}

function clearJoinTimeout() {
  if (joinTimeoutId) {
    clearTimeout(joinTimeoutId);
    joinTimeoutId = null;
  }
}

function unsubscribeRoomListeners() {
  signalingUnsubscribers.forEach(unsubscribe => unsubscribe());
  signalingUnsubscribers = [];
}

function closePeerConnection() {
  if (!peerConnection) return;

  webRtcDebugger.stop();

  peerConnection.ontrack = null;
  peerConnection.onicecandidate = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.close();
  peerConnection = null;
  remoteStream = null;
  remoteIceQueue = [];
}

function getRoomCleanupRefs(roomName, role) {
  if (!roomName || !role) return [];

  const { offer, candidates, participant } = getRoomCleanupPaths(roomName, role);
  return [ref(db, offer), ref(db, candidates), ref(db, participant)];
}

async function cleanupRoomArtifacts() {
  if (!activeRoomName || !localParticipantRole) return;

  await Promise.allSettled(
    getRoomCleanupRefs(activeRoomName, localParticipantRole).map(pathRef => remove(pathRef))
  );
}

async function resetCallSession(statusMessage) {
  stopElapsedTimer({ reset: true });
  clearJoinTimeout();
  unsubscribeRoomListeners();
  closePeerConnection();
  remoteVideo.srcObject = null;
  await cleanupRoomArtifacts();
  activeRoomName = null;
  localParticipantRole = null;
  activeSessionId = null;
  remotePresenceSeen = false;
  setCallButtonsEnabled(Boolean(localStream));
  syncCallButtonMode();

  if (statusMessage) {
    statusText.innerText = statusMessage;
  }
}

async function addRemoteIceCandidate(candidateData) {
  if (!peerConnection) return;

  const iceCandidate = new RTCIceCandidate(candidateData);
  if (!peerConnection.remoteDescription) {
    remoteIceQueue.push(iceCandidate);
    return;
  }

  await peerConnection.addIceCandidate(iceCandidate);
}

async function flushRemoteIceQueue() {
  while (peerConnection && peerConnection.remoteDescription && remoteIceQueue.length > 0) {
    const candidate = remoteIceQueue.shift();

    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.warn('Queued ICE candidate skipped:', err);
    }
  }
}

function ensureLocalStreamReady() {
  if (localStream) return true;

  statusText.innerText = 'Camera and microphone access are required before starting a call.';
  return false;
}

setCallButtonsEnabled(false);
syncCallButtonMode();
setDeviceControlsEnabled(false);
setPipControlsEnabled(false);
setElapsedTimeMs(0);
restoreRoomKey();
restorePipLayout();
updateViewportLayoutMetrics();
applyPipLayoutState();
updateToggleButtonVisuals();
appVersionText.innerText = APP_VERSION;
window.addEventListener('keydown', handleKeyboardShortcuts);
window.addEventListener('resize', scheduleViewportLayoutMetricsUpdate);
window.addEventListener('orientationchange', scheduleViewportLayoutMetricsUpdate);

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleViewportLayoutMetricsUpdate);
  window.visualViewport.addEventListener('scroll', scheduleViewportLayoutMetricsUpdate);
}

async function discoverDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();

  audioSource.innerHTML = '';
  videoSource.innerHTML = '';

  devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceId;

    if (device.kind === 'audioinput') {
      option.text = device.label || `Microphone ${audioSource.length + 1}`;
      option.title = option.text;
      audioSource.appendChild(option);
    } else if (device.kind === 'videoinput') {
      option.text = device.label || `Camera ${videoSource.length + 1}`;
      option.title = option.text;
      videoSource.appendChild(option);
    }
  });

  setDeviceControlsEnabled(true);
  syncSelectedDeviceTitles();
}

async function init() {
  try {
    const constraints = {
      video: buildVideoConstraints(),
      audio: buildAudioConstraints()
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(),
        audio: buildAudioConstraints(null, true)
      });
    }

    localVideo.srcObject = localStream;

    await discoverDevices();
    setCallButtonsEnabled(true);
    syncCallButtonMode();
    setPipControlsEnabled(true);
    statusText.innerText = 'Camera active. Enter a key above to connect.';
  } catch (err) {
    statusText.innerText = 'Error: System camera/microphone access denied.';
    setCallButtonsEnabled(false);
    syncCallButtonMode();
    setDeviceControlsEnabled(false);
    setPipControlsEnabled(false);
    console.error(err);
  }
}

function createPeerConnection(roomName) {
  if (!localStream) {
    throw new Error('Local media stream is not ready.');
  }

  closePeerConnection();
  peerConnection = new RTCPeerConnection(rtcConfig);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  tryPlayRemoteVideo();
  remoteIceQueue = [];

  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  if (audioTrack) {
    const audioSender = peerConnection.addTrack(audioTrack, localStream);
    applyAudioSenderEncodingPreferences(audioSender);
  }

  if (videoTrack) {
    const videoSender = peerConnection.addTrack(videoTrack, localStream);
    const videoParameters = videoSender.getParameters();
    videoParameters.encodings = videoParameters.encodings && videoParameters.encodings.length > 0
      ? videoParameters.encodings.map(encoding => ({ ...encoding, priority: 'high', maxBitrate: getVideoBitrateBps() }))
      : [{ priority: 'high', maxBitrate: getVideoBitrateBps() }];
    videoParameters.degradationPreference = 'maintain-framerate';
    videoSender.setParameters(videoParameters).catch(err => console.error('Video sender parameter error:', err));
  }

  webRtcDebugger.start(peerConnection, localStream);

  peerConnection.ontrack = (event) => {
    if (!remoteStream) {
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
      tryPlayRemoteVideo();
    }

    const existingTrackIds = new Set(remoteStream.getTracks().map(track => track.id));
    if (!existingTrackIds.has(event.track.id)) {
      remoteStream.addTrack(event.track);
    }

    event.track.addEventListener('unmute', () => {
      tryPlayRemoteVideo();
    });

    statusText.innerText = 'Connected! Peer media stream verified.';
    tryPlayRemoteVideo();
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      const candidateId = `candidate_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const candidateGroup = localParticipantRole === 'caller' ? 'callerCandidates' : 'calleeCandidates';
      const candRef = ref(db, `rooms/${roomName}/${candidateGroup}/${candidateId}`);
      set(candRef, {
        sessionId: activeSessionId,
        updatedAt: Date.now(),
        candidate: event.candidate.toJSON()
      }).catch(err => {
        console.error('Failed to publish ICE candidate:', err);
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      clearJoinTimeout();
      statusText.innerText = 'Connected! Peer connection established.';
      return;
    }

    if (peerConnection.connectionState === 'failed') {
      resetCallSession('Connection failed. You can try the same room key again.');
    }
  };
}

function getValidatedKey() {
  const key = roomKeyInput.value.trim().replace(/[^a-zA-Z0-9-_]/g, '');
  if (!key) {
    alert('Please enter a valid alphanumeric key.');
    return null;
  }
  return key;
}

async function beginStartRoom(roomName) {
  if (!ensureLocalStreamReady()) return;

  activeRoomName = roomName;
  localParticipantRole = 'caller';
  activeSessionId = createSessionId();
  remotePresenceSeen = false;
  syncCallButtonMode();
  statusText.innerText = `Initializing room "${roomName}"...`;

  try {
    const callerSlotClaimed = await claimRoleSlot(roomName, 'caller', activeSessionId);
    if (!callerSlotClaimed) {
      await resetCallSession('Room is already occupied by another active caller.');
      return;
    }

    await Promise.allSettled([
      remove(ref(db, `rooms/${roomName}/offer`)),
      remove(ref(db, `rooms/${roomName}/answer`)),
      remove(ref(db, `rooms/${roomName}/callerCandidates`)),
      remove(ref(db, `rooms/${roomName}/calleeCandidates`))
    ]);

    createPeerConnection(roomName);
    listenToRoom(roomName);

    const offer = await peerConnection.createOffer();
    const localOfferDescription = await setLocalDescriptionSafely(peerConnection, offer);

    const offerRef = ref(db, `rooms/${roomName}/offer`);
    await set(offerRef, {
      sessionId: activeSessionId,
      updatedAt: Date.now(),
      sdp: { type: localOfferDescription.type, sdp: localOfferDescription.sdp }
    });

    await publishOwnPresence(roomName);

    statusText.innerText = `Room "${roomName}" created. Waiting for friend to join...`;
    startElapsedTimer({ reset: true });
  } catch (err) {
    console.error('Failed to start room:', err);
    await resetCallSession('Could not create the room. Check Firebase connectivity and try again.');
  }
}

async function beginJoinRoom(roomName, autoDetected = false) {
  if (!ensureLocalStreamReady()) return;

  startElapsedTimer({ reset: true });

  activeRoomName = roomName;
  localParticipantRole = 'callee';
  activeSessionId = null;
  remotePresenceSeen = false;
  syncCallButtonMode();
  statusText.innerText = `Connecting to room "${roomName}"...`;

  if (autoDetected) {
    statusText.innerText = `Room "${roomName}" already exists. Joining it...`;
  }

  try {
    createPeerConnection(roomName);
    listenToRoom(roomName);
    clearJoinTimeout();
    joinTimeoutId = setTimeout(() => {
      if (peerConnection && !peerConnection.remoteDescription) {
        resetCallSession(`No active call was found for room "${roomName}".`);
      }
    }, 15000);
  } catch (err) {
    console.error('Failed to join room:', err);
    await resetCallSession('Could not join the room. Check the shared key and try again.');
  }
}

callBtn.addEventListener('click', async () => {
  if (activeRoomName) {
    await resetCallSession('Disconnected. Enter a key above to call again.');
    return;
  }

  const roomName = getValidatedKey();
  if (!roomName) return;

  try {
    const decision = await evaluateRoomAction(roomName);

    if (decision.mode === 'full' || decision.mode === 'busy') {
      statusText.innerText = decision.message;
      return;
    }

    if (decision.mode === 'join') {
      await beginJoinRoom(roomName, true);
      return;
    }

    await beginStartRoom(roomName);
  } catch (err) {
    console.error('Room evaluation failed:', err);
    statusText.innerText = 'Could not evaluate room state. Try again.';
  }
});

function listenToRoom(roomName) {
  unsubscribeRoomListeners();

  const { remoteSdpPath, remoteCandidatesPath, remotePresencePath } = getRoomSignalPaths(roomName, localParticipantRole);

  const unsubscribeSdp = onValue(ref(db, remoteSdpPath), async (snapshot) => {
    const data = snapshot.val();
    if (!data || !peerConnection || !data.sdp) return;

    try {
      const packetSessionId = data.sessionId || null;

      if (localParticipantRole === 'caller') {
        if (!packetSessionId || packetSessionId !== activeSessionId) {
          return;
        }
      } else if (localParticipantRole === 'callee') {
        if (!packetSessionId) {
          return;
        }

        if (!activeSessionId) {
          activeSessionId = packetSessionId;
        } else if (packetSessionId !== activeSessionId) {
          if (data.sdp.type !== 'offer') {
            return;
          }

          statusText.innerText = 'Remote peer restarted. Re-establishing call...';
          createPeerConnection(roomName);
          activeSessionId = packetSessionId;
        }
      }

      if (peerConnection.remoteDescription && peerConnection.remoteDescription.sdp === data.sdp.sdp) {
        return;
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await flushRemoteIceQueue();

      if (data.sdp.type === 'offer' && localParticipantRole === 'callee' && !peerConnection.localDescription) {
        const calleeSlotClaimed = await claimRoleSlot(roomName, 'callee', activeSessionId);
        if (!calleeSlotClaimed) {
          await resetCallSession('Room is already occupied by two participants.');
          return;
        }

        clearJoinTimeout();
        statusText.innerText = 'Processing call invitation...';
        const answer = await peerConnection.createAnswer();
        const localAnswerDescription = await setLocalDescriptionSafely(peerConnection, answer);

        const answerRef = ref(db, `rooms/${roomName}/answer`);
        await set(answerRef, {
          sessionId: activeSessionId,
          updatedAt: Date.now(),
          sdp: { type: localAnswerDescription.type, sdp: localAnswerDescription.sdp }
        });
        statusText.innerText = 'Answer transmitted. Syncing streams...';
      }
    } catch (err) {
      console.error('Remote SDP handling failed:', err);
      await resetCallSession('Signaling failed while exchanging session data. Try again.');
    }
  });

  const unsubscribeCandidates = onChildAdded(ref(db, remoteCandidatesPath), async (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.candidate || !peerConnection) return;

    if (!data.sessionId || !activeSessionId || data.sessionId !== activeSessionId) return;

    try {
      await addRemoteIceCandidate(data.candidate);
    } catch (err) {
      console.warn('ICE candidate skipped:', err);
    }
  });

  const unsubscribeRemotePresence = onValue(ref(db, remotePresencePath), async (snapshot) => {
    const remotePresence = snapshot.val();
    if (remotePresence && remotePresence.sessionId === activeSessionId) {
      const peerJoinedForFirstTime = !remotePresenceSeen;
      remotePresenceSeen = true;

      if (peerJoinedForFirstTime && localParticipantRole === 'caller') {
        startElapsedTimer({ reset: true });
      }
      return;
    }

    if (remotePresenceSeen) {
      await resetCallSession('Remote peer disconnected. You can press Call again.');
    }
  });

  signalingUnsubscribers.push(unsubscribeSdp, unsubscribeCandidates, unsubscribeRemotePresence);
}

muteBtn.addEventListener('click', () => {
  if (!localStream) return;

  const audioTracks = localStream.getAudioTracks();
  if (audioTracks.length > 0) {
    const isMuted = muteBtn.getAttribute('data-muted') === 'true';
    audioTracks[0].enabled = isMuted;
    muteBtn.setAttribute('data-muted', !isMuted);
    updateToggleButtonVisuals();
  }
});

camBtn.addEventListener('click', () => {
  if (!localStream) return;

  const videoTracks = localStream.getVideoTracks();
  if (videoTracks.length > 0) {
    const isCamOff = camBtn.getAttribute('data-off') === 'true';
    videoTracks[0].enabled = isCamOff;
    camBtn.setAttribute('data-off', !isCamOff);
    updateToggleButtonVisuals();
  }
});

moveBtn.addEventListener('click', () => {
  pipViewState.positionIndex = (pipViewState.positionIndex + 1) % PIP_POSITIONS.length;
  applyPipPosition();
  persistPipLayout();
});

swapBtn.addEventListener('click', () => {
  pipViewState.mainView = pipViewState.mainView === 'remote' ? 'local' : 'remote';
  applyMainView();
});

sizeBtn.addEventListener('click', () => {
  pipViewState.sizeIndex = (pipViewState.sizeIndex + 1) % PIP_SIZES.length;
  applyPipSize();
  persistPipLayout();
});

const audioSettingsControls = [
  audioSampleRate,
  audioBitDepth,
  audioChannels,
  ...Array.from(document.querySelectorAll('#deviceSelector .device-section:first-of-type .device-toggle input')).slice(0, 3),
  audioBitrateCeiling
];

const videoSettingsControls = [
  videoResolution,
  videoFps,
  videoDegradation,
  videoBitrateCeiling
];

audioSettingsControls.filter(Boolean).forEach(control => {
  control.addEventListener('change', async () => {
    if (!localStream) return;

    if (control === audioBitrateCeiling) {
      await pushAudioEncodingParameters();
      return;
    }

    await executeAutomatedAudioSwap();
  });
});

videoSettingsControls.filter(Boolean).forEach(control => {
  control.addEventListener('change', async () => {
    if (!localStream) return;

    if (control === videoFps || control === videoBitrateCeiling || control === videoDegradation) {
      await pushNetworkEncodingParameters();
      return;
    }

    await executeAutomatedVideoScale();
  });
});

roomKeyInput.addEventListener('input', persistRoomKey);
roomKeyInput.addEventListener('change', persistRoomKey);

function bindDeviceSourceEvents(selectElement, { label, sourceApplier }) {
  if (!selectElement) return;

  selectElement.addEventListener('pointerdown', (event) => {
    markDeviceSelectorOpen(event.target);
  });

  selectElement.addEventListener('click', (event) => {
    handleDeviceSelectorClick(event.target);
  });

  selectElement.addEventListener('change', async (event) => {
    if (!localStream) return;

    syncSelectedDeviceTitles();
    collapseDeviceSelector(event.target);

    const deviceId = event.target.value;
    if (!deviceId) return;

    try {
      await sourceApplier(deviceId);
    } catch (err) {
      console.error(`Failed to switch ${label} source:`, err);
      alert(`Could not switch to the selected ${label} hardware.`);
    }
  });
}

bindDeviceSourceEvents(videoSource, {
  label: 'camera',
  sourceApplier: applyVideoSourceById
});

bindDeviceSourceEvents(audioSource, {
  label: 'microphone',
  sourceApplier: applyAudioSourceById
});

function cleanupRoomOnExit() {
  if (!activeRoomName || !localParticipantRole) return;

  getRoomCleanupRefs(activeRoomName, localParticipantRole).forEach(pathRef => remove(pathRef));
}

window.addEventListener('beforeunload', cleanupRoomOnExit);
registerPwaServiceWorker();
window.onload = init;
