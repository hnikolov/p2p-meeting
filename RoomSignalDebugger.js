class RoomSignalDebugger {
  constructor() {
    this.hudElement = null;
    this.isVisible = false;
    this.globalKeyHandler = null;
    this.refreshTimer = null;
    this.roomName = null;
    this.snapshotProvider = null;
  }

  #createHUDMarkup() {
    if (document.getElementById('room-signal-hud')) {
      this.hudElement = document.getElementById('room-signal-hud');
      return;
    }

    this.hudElement = document.createElement('div');
    this.hudElement.id = 'room-signal-hud';
    this.hudElement.style.cssText = `
      position: fixed;
      left: 16px;
      top: 16px;
      width: 300px;
      max-height: 92vh;
      overflow-y: auto;
      background: rgba(10, 16, 24, 0.97);
      color: #eaf2ff;
      font-family: "Segoe UI", Tahoma, sans-serif;
      font-size: 11px;
      line-height: 1.45;
      padding: 10px 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(118, 146, 206, 0.55);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
      z-index: 999998;
      pointer-events: none;
      display: none;
      box-sizing: border-box;
    `;

    this.hudElement.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.12);color:#fff;">
        <strong style="letter-spacing:0.08em;font-size:11px;">ROOM SIGNAL HUD</strong>
        <span id="room-debug-status" style="color:#ffce54;font-weight:700;">IDLE</span>
      </div>

      <div style="display:grid;gap:6px;">
        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="display:flex;justify-content:space-between;gap:8px;">
            <span style="color:#9ab7ff;">Room</span>
            <span id="room-debug-room-name" style="color:#fff;font-weight:700;">-</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px;">
            <span style="color:#9ab7ff;">Role</span>
            <span id="room-debug-local-role">-</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px;">
            <span style="color:#9ab7ff;">Session</span>
            <span id="room-debug-session">-</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px;">
            <span style="color:#9ab7ff;">Conn</span>
            <span id="room-debug-connection-state">-</span>
          </div>
        </div>

        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">Participants</div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Caller</span><span id="room-debug-caller-state">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Callee</span><span id="room-debug-callee-state">-</span></div>
        </div>

        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">Offer / Answer</div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Offer</span><span id="room-debug-offer-state">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Offer age</span><span id="room-debug-offer-age">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Answer</span><span id="room-debug-answer-state">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Answer age</span><span id="room-debug-answer-age">-</span></div>
        </div>

        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">ICE candidates</div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Caller</span><span id="room-debug-caller-candidates">0</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Callee</span><span id="room-debug-callee-candidates">0</span></div>
        </div>

        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">Cleanup decision</div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Stale</span><span id="room-debug-stale-state">-</span></div>
          <div style="display:flex;justify-content:space-between;gap:8px;"><span>Last action</span><span id="room-debug-last-action">idle</span></div>
        </div>
      </div>
    `;

    document.body.appendChild(this.hudElement);
  }

  setRoomName(roomName) {
    this.roomName = roomName || null;
    if (!this.hudElement) return;

    const roomNameEl = document.getElementById('room-debug-room-name');
    if (roomNameEl) {
      roomNameEl.textContent = this.roomName || 'none';
    }
  }

  setSnapshotProvider(provider) {
    this.snapshotProvider = provider;
  }

  bindToggleKey() {
    if (this.globalKeyHandler) return;

    this.globalKeyHandler = (event) => {
      if (!event || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const targetTag = event.target && event.target.tagName;
      if (targetTag === 'TEXTAREA' || targetTag === 'INPUT' || targetTag === 'SELECT') {
        return;
      }

      if (event.key === 'f' || event.key === 'F') {
        this.isVisible = !this.isVisible;
        this.#createHUDMarkup();
        if (this.hudElement) {
          this.hudElement.style.display = this.isVisible ? 'block' : 'none';
          console.log(`🧭 Room signal HUD visibility toggled: ${this.isVisible ? 'VISIBLE' : 'HIDDEN'}`);
        }
      }
    };

    window.addEventListener('keydown', this.globalKeyHandler);
  }

  start() {
    this.#createHUDMarkup();
    this.hudElement.style.display = this.isVisible ? 'block' : 'none';

    if (this.refreshTimer) {
      return;
    }

    this.refreshTimer = setInterval(async () => {
      if (!this.snapshotProvider) {
        this.renderIdleState();
        return;
      }

      if (!this.roomName) {
        this.renderIdleState();
        return;
      }

      try {
        const result = await this.snapshotProvider(this.roomName);
        const roomData = result && result.data ? result.data : {};
        this.renderRoomSnapshot(roomData);
      } catch (err) {
        console.warn('Room signal HUD refresh failed:', err);
        this.renderIdleState('refresh error');
      }
    }, 1000);
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  renderIdleState(reason = 'idle') {
    if (!this.hudElement) return;

    const status = document.getElementById('room-debug-status');
    const roomName = document.getElementById('room-debug-room-name');
    if (status) status.textContent = reason === 'refresh error' ? 'ERROR' : 'IDLE';
    if (status) status.style.color = reason === 'refresh error' ? '#ff6b6b' : '#ffce54';
    if (roomName) roomName.textContent = this.roomName || 'none';

    const ids = [
      'room-debug-local-role',
      'room-debug-session',
      'room-debug-connection-state',
      'room-debug-caller-state',
      'room-debug-callee-state',
      'room-debug-offer-state',
      'room-debug-offer-age',
      'room-debug-answer-state',
      'room-debug-answer-age',
      'room-debug-caller-candidates',
      'room-debug-callee-candidates',
      'room-debug-stale-state',
      'room-debug-last-action'
    ];

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = id === 'room-debug-last-action' ? 'idle' : '-';
      }
    });
  }

  renderRoomSnapshot(roomData) {
    if (!this.hudElement) return;

    const participants = roomData.participants || {};
    const caller = participants.caller || {};
    const callee = participants.callee || {};
    const offer = roomData.offer || {};
    const answer = roomData.answer || {};
    const callerCandidates = roomData.callerCandidates || {};
    const calleeCandidates = roomData.calleeCandidates || {};
    const now = Date.now();
    const roomName = this.roomName || 'unknown';

    const callerState = caller.sessionId ? `${caller.sessionId.slice(0, 8)}… ${this.formatAge(now - (caller.updatedAt || now))}` : 'empty';
    const calleeState = callee.sessionId ? `${callee.sessionId.slice(0, 8)}… ${this.formatAge(now - (callee.updatedAt || now))}` : 'empty';
    const offerIsPresent = Boolean(offer && offer.sdp && offer.sessionId);
    const answerIsPresent = Boolean(answer && answer.sdp && answer.sessionId);
    const stale = this.isStale(caller, now) || this.isStale(callee, now) || this.isStale(offer, now) || this.isStale(answer, now);

    document.getElementById('room-debug-status').textContent = stale ? 'STALE' : 'LIVE';
    document.getElementById('room-debug-status').style.color = stale ? '#ff7f50' : '#7ef29a';
    document.getElementById('room-debug-room-name').textContent = roomName;
    document.getElementById('room-debug-local-role').textContent = 'watcher';
    document.getElementById('room-debug-session').textContent = 'n/a';
    document.getElementById('room-debug-connection-state').textContent = roomData.offer || roomData.answer ? 'signaling' : 'idle';
    document.getElementById('room-debug-caller-state').textContent = callerState;
    document.getElementById('room-debug-callee-state').textContent = calleeState;
    document.getElementById('room-debug-offer-state').textContent = offerIsPresent ? 'present' : 'empty';
    document.getElementById('room-debug-offer-age').textContent = offerIsPresent ? this.formatAge(now - (offer.updatedAt || now)) : '-';
    document.getElementById('room-debug-answer-state').textContent = answerIsPresent ? 'present' : 'empty';
    document.getElementById('room-debug-answer-age').textContent = answerIsPresent ? this.formatAge(now - (answer.updatedAt || now)) : '-';
    document.getElementById('room-debug-caller-candidates').textContent = String(Object.keys(callerCandidates).length || 0);
    document.getElementById('room-debug-callee-candidates').textContent = String(Object.keys(calleeCandidates).length || 0);
    document.getElementById('room-debug-stale-state').textContent = stale ? 'yes' : 'no';
    document.getElementById('room-debug-last-action').textContent = offerIsPresent || answerIsPresent ? 'snapshot' : 'idle';
  }

  isStale(entry, now) {
    if (!entry || !entry.updatedAt || !Number.isFinite(Number(entry.updatedAt))) {
      return false;
    }

    const age = now - Number(entry.updatedAt);
    return age > 45000;
  }

  formatAge(ageMs) {
    const age = Number(ageMs);
    if (!Number.isFinite(age)) {
      return '-';
    }

    if (age < 1000) {
      return `${Math.max(0, Math.round(age))}ms`;
    }

    if (age < 60000) {
      return `${(age / 1000).toFixed(1)}s`;
    }

    return `${(age / 60000).toFixed(1)}m`;
  }
}

window.RoomSignalDebugger = RoomSignalDebugger;
