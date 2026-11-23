class RoomSignalDebugger {
  constructor() {
    this.hudElement = null;
    this.isVisible = false;
    this.globalKeyHandler = null;
    this.refreshTimer = null;
    this.roomName = null;
    this.rooms = [];
    this.selectedRoomName = null;
    this.snapshotProvider = null;
    this.roomsProvider = null;
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
      left: 15px;
      top: 15px;
      width: 280px;
      max-height: 82vh;
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

      <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;margin-bottom:8px;">
        <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">Room browser</div>
        <select id="room-debug-room-selector" style="width:100%;max-width:100%;pointer-events:auto;background:#101727;color:#eaf2ff;border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:5px 7px;font-size:11px;box-sizing:border-box;">
          <option value="">Loading rooms...</option>
        </select>
      </div>

      <div style="display:grid;gap:6px;">
        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="display:flex;justify-content:space-between;gap:8px;">
            <span style="color:#9ab7ff;">Room</span>
            <span id="room-debug-room-name" style="color:#fff;font-weight:700;">-</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px;">
            <span style="color:#9ab7ff;">Legacy data</span>
            <span id="room-debug-legacy">-</span>
          </div>
        </div>

        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">Members (peer id, joined)</div>
          <div id="room-debug-members">-</div>
        </div>

        <div style="padding:6px 8px;background:rgba(24,31,44,0.9);border:1px solid rgba(255,255,255,0.08);border-radius:6px;">
          <div style="font-weight:700;color:#8fd3ff;margin-bottom:4px;">Signals (from → to: descriptions / candidates)</div>
          <div id="room-debug-signals">-</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.hudElement);

    const selector = document.getElementById('room-debug-room-selector');
    if (selector) {
      selector.addEventListener('change', (event) => {
        const nextRoomName = event.target && event.target.value ? String(event.target.value) : null;
        this.selectRoom(nextRoomName);
      });
    }
  }

  setRoomName(roomName) {
    const nextRoomName = roomName || null;

    if (nextRoomName && this.selectedRoomName && this.selectedRoomName !== nextRoomName) {
      return;
    }

    this.roomName = nextRoomName;
    this.selectedRoomName = nextRoomName;

    if (!this.hudElement) return;

    const roomNameEl = document.getElementById('room-debug-room-name');
    if (roomNameEl) {
      roomNameEl.textContent = this.roomName || 'none';
    }

    const selector = document.getElementById('room-debug-room-selector');
    if (selector && this.roomName) {
      selector.value = this.roomName;
    }
  }

  setSnapshotProvider(provider) {
    this.snapshotProvider = provider;
  }

  setRoomsProvider(provider) {
    this.roomsProvider = provider;
  }

  async selectRoom(roomName) {
    const nextRoomName = roomName || null;
    this.selectedRoomName = nextRoomName;
    this.roomName = nextRoomName;

    if (this.hudElement) {
      const selector = document.getElementById('room-debug-room-selector');
      if (selector && nextRoomName) {
        selector.value = nextRoomName;
      }
      const roomNameEl = document.getElementById('room-debug-room-name');
      if (roomNameEl) {
        roomNameEl.textContent = nextRoomName || 'none';
      }
    }

    if (!nextRoomName || !this.snapshotProvider) {
      return;
    }

    try {
      const result = await this.snapshotProvider(nextRoomName);
      if (this.roomName !== nextRoomName) {
        return;
      }

      const roomData = result && result.data ? result.data : {};
      this.renderRoomSnapshot(roomData);
    } catch (err) {
      console.warn('Room signal HUD room selection refresh failed:', err);
    }
  }

  async refreshRoomList() {
    if (!this.isVisible || !this.roomsProvider) {
      return;
    }

    try {
      const roomMap = await this.roomsProvider();
      const roomNames = Object.keys(roomMap || {}).sort((left, right) => left.localeCompare(right));
      this.rooms = roomNames;

      const selector = document.getElementById('room-debug-room-selector');
      if (!selector) {
        return;
      }

      const previousSelection = this.selectedRoomName || this.roomName || '';
      selector.innerHTML = '';

      if (roomNames.length === 0) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'No rooms';
        selector.appendChild(emptyOption);
        this.selectRoom(null);
        return;
      }

      roomNames.forEach((roomName) => {
        const option = document.createElement('option');
        option.value = roomName;
        option.textContent = roomName;
        selector.appendChild(option);
      });

      const nextSelection = roomNames.includes(previousSelection) ? previousSelection : roomNames[0];
      this.selectRoom(nextSelection || null);
      selector.value = nextSelection || '';
    } catch (err) {
      console.warn('Room signal HUD room list refresh failed:', err);
      const selector = document.getElementById('room-debug-room-selector');
      if (selector) {
        selector.innerHTML = '<option value="">Firebase rule blocks /rooms read</option>';
        selector.title = 'Set rules so the parent rooms node is readable after auth: { "rooms": { ".read": "auth != null", ".write": "auth != null" } }';
      }
    }
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
      if (!this.isVisible) {
        return;
      }

      if (this.roomsProvider) {
        await this.refreshRoomList();
      }

      if (!this.roomName || !this.snapshotProvider) {
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

    ['room-debug-legacy', 'room-debug-members', 'room-debug-signals'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    });
  }

  // Room layout (see docs/signaling-design.md):
  //   members/{peerId} = { joinedAt }
  //   signals/{fromId}/{toId}/{pushId} = { description } | { candidate }
  renderRoomSnapshot(roomData) {
    if (!this.hudElement) return;

    const members = roomData.members || {};
    const signals = roomData.signals || {};
    const now = Date.now();
    const memberIds = Object.keys(members);
    const legacyKeys = ['offer', 'answer', 'participants', 'callerCandidates', 'calleeCandidates']
      .filter(key => roomData[key] !== undefined);

    const status = document.getElementById('room-debug-status');
    status.textContent = memberIds.length > 0 ? `LIVE (${memberIds.length})` : 'EMPTY';
    status.style.color = memberIds.length > 0 ? '#7ef29a' : '#ffce54';
    document.getElementById('room-debug-room-name').textContent = this.roomName || 'unknown';
    document.getElementById('room-debug-legacy').textContent = legacyKeys.length > 0 ? legacyKeys.join(', ') : 'none';

    const memberLines = memberIds.map((id) => {
      const joinedAt = Number(members[id] && members[id].joinedAt);
      const age = Number.isFinite(joinedAt) ? this.formatAge(now - joinedAt) : '-';
      return `${this.shortId(id)}  ${age}`;
    });
    this.renderLines('room-debug-members', memberLines);

    const signalLines = [];
    Object.entries(signals).forEach(([fromId, mailboxes]) => {
      Object.entries(mailboxes || {}).forEach(([toId, messages]) => {
        const list = Object.values(messages || {});
        const descriptions = list.filter(message => message && message.description).length;
        const candidates = list.filter(message => message && message.candidate).length;
        signalLines.push(`${this.shortId(fromId)} → ${this.shortId(toId)}: ${descriptions} / ${candidates}`);
      });
    });
    this.renderLines('room-debug-signals', signalLines);
  }

  renderLines(elementId, lines) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = '';
    if (lines.length === 0) {
      el.textContent = 'none';
      return;
    }

    lines.forEach((line) => {
      const row = document.createElement('div');
      row.textContent = line;
      el.appendChild(row);
    });
  }

  shortId(id) {
    const value = String(id || '');
    return value.length > 8 ? `…${value.slice(-6)}` : value;
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
