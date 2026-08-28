/**
 * WebRTCDebugger.js (v8)
 * Decoupled expert diagnostic tracking class.
 * Structured with strict Directional Transmit/Receive Separation Profiles.
 */
class WebRTCDebugger {
  constructor() {
    this.intervalToken = null;
    this.audioCtx = null;
    this.analyserNode = null;
    this.animationToken = null;
    this.hudElement = null;
    this.isMonitoring = false;

    this.isHudVisible = false; 
    this.globalKeyHandler = null;

    // Throughput Delta Memory Buffers
    this.txAudioBytes = 0; this.txVideoBytes = 0;
    this.rxAudioBytes = 0; this.rxVideoBytes = 0;
    this.txAudioTime = performance.now(); this.txVideoTime = performance.now();
    this.rxAudioTime = performance.now(); this.rxVideoTime = performance.now();
  }

  #createHUDMarkup() {
    if (document.getElementById('webrtc-expert-hud')) return;
    this.hudElement = document.createElement('div');
    this.hudElement.id = 'webrtc-expert-hud';
    this.hudElement.style.cssText = `
      position: fixed; top: 15px; right: 15px; width: 280px; max-height: 95vh; overflow-y: auto;
      background: rgba(20, 20, 20, 0.95); color: #00ff66;
      font-family: 'Courier New', monospace; font-size: 11px;
      line-height: 1.4; padding: 12px; border-radius: 6px;
      border: 1px solid #333; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
      z-index: 999999; pointer-events: none;
    `;
    this.hudElement.innerHTML = `
      <div style="font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 4px; margin-bottom: 6px; color: #fff; display: flex; justify-content: space-between;">
        <span>📊 WEBRTC SEPARATED HUD</span> <span id="hud-status" style="color: #ffcc00;">IDLE</span>
      </div>
      
      <div style="margin-bottom: 8px;">
        <strong style="color: #00e1ff;">[LOCAL AUDIO HARDWARE]</strong><br>
        <div style="display:flex; justify-content:space-between; margin:2px 0 2px 0;">
          <span>RMS Mic Input:</span> <span id="hud-audio-mic-num">0.0000</span>
        </div>
        <div style="background:#111; height:8px; border-radius:2px; border:1px solid #333; overflow:hidden; margin-bottom:4px;">
          <div id="hud-audio-vubar" style="width:0%; height:100%; background:linear-gradient(90deg, #00ff66 60%, #ffcc00 85%, #ff3333 100%); transition:width 0.04s ease-out;"></div>
        </div>
        Echo Cancel: <span id="hud-audio-aec">-</span><br>
        Echo Cancel Type: <span id="hud-audio-aec-type" style="color:#ff9900;">-</span><br>
        Noise Suppr: <span id="hud-audio-ns">-</span><br>
        Auto Gain  : <span id="hud-audio-agc">-</span><br>
        Sample Rate: <span id="hud-audio-rate">-</span><br>
        Sample Size: <span id="hud-audio-size">-</span><br>
        Channels   : <span id="hud-audio-channels">-</span>
      </div>

      <div style="margin-bottom: 8px;">
        <strong style="color: #00e1ff;">[LOCAL VIDEO HARDWARE]</strong><br>
        Capture Res: <span id="hud-video-cap-res">-</span><br>
        Capture FPS: <span id="hud-video-cap-fps">-</span><br>
        Aspect Ratio: <span id="hud-video-cap-aspect">-</span><br>
        Resize Mode: <span id="hud-video-cap-resize">-</span><br>
        Facing Mode: <span id="hud-video-cap-facing" style="color:#ffcc00;">-</span>
      </div>

      <div style="margin-bottom: 8px;">
        <strong style="color: #ff9900;">[AUDIO NETWORK TRANSMIT]</strong><br>
        Track Output: <span id="hud-tx-audio-enabled">-</span><br>
        Audio Lvl  : <span id="hud-tx-audio-lvl">-</span><br>
        Bytes Sent : <span id="hud-tx-audio-bytes">-</span><br>
        Bitrate    : <span id="hud-tx-audio-kbps" style="color:#00e1ff;">-</span> kbps
      </div>

      <div style="margin-bottom: 8px;">
        <strong style="color: #ff9900;">[VIDEO NETWORK TRANSMIT]</strong><br>
        Track Output: <span id="hud-tx-video-enabled">-</span><br>
        Wire Res   : <span id="hud-tx-video-res">-</span><br>
        Wire FPS   : <span id="hud-tx-video-fps">-</span><br>
        Bytes Sent : <span id="hud-tx-video-bytes">-</span><br>
        Bitrate    : <span id="hud-tx-video-kbps" style="color:#00e1ff;">-</span> kbps<br>
        Frames Sent: <span id="hud-tx-video-frames">-</span><br>
        Limitation : <span id="hud-tx-video-limit">-</span>
      </div>

      <div style="margin-bottom: 8px;">
        <strong style="color: #ff5500;">[AUDIO NETWORK RECEIVE]</strong><br>
        Track Input: <span id="hud-rx-audio-enabled">-</span><br>
        Audio Lvl  : <span id="hud-rx-audio-lvl">-</span><br>
        Bytes Received: <span id="hud-rx-audio-bytes">-</span><br>
        Bitrate    : <span id="hud-rx-audio-kbps" style="color:#00e1ff;">-</span> kbps<br>
        Packets Lost: <span id="hud-rx-audio-lost">-</span><br>
        Jitter     : <span id="hud-rx-audio-jitter">-</span>
      </div>

      <div>
        <strong style="color: #ff5500;">[VIDEO NETWORK RECEIVE]</strong><br>
        Track Input: <span id="hud-rx-video-enabled">-</span><br>
        Wire Res   : <span id="hud-rx-video-res">-</span><br>
        Wire FPS   : <span id="hud-rx-video-fps">-</span><br>
        Bytes Received: <span id="hud-rx-video-bytes">-</span><br>
        Bitrate    : <span id="hud-rx-video-kbps" style="color:#00e1ff;">-</span> kbps<br>
        Frames Received: <span id="hud-rx-video-frames">-</span><br>
        Frames Dropped: <span id="hud-rx-video-dropped" style="color:#ff3333;">-</span>
      </div>
    `;
    document.body.appendChild(this.hudElement);
  }

  bindToggleKey() {
    if (this.globalKeyHandler) return;

    this.globalKeyHandler = (event) => {
      if (!event || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const targetTag = event.target && event.target.tagName;
      if (targetTag === 'TEXTAREA' || targetTag === 'INPUT') {
        return;
      }

      if (event.key === 'd' || event.key === 'D') {
        this.isHudVisible = !this.isHudVisible;
        if (this.hudElement) {
          this.hudElement.style.display = this.isHudVisible ? 'block' : 'none';
          console.log(`📊 Diagnostic HUD Visibility Toggled: ${this.isHudVisible ? 'VISIBLE' : 'HIDDEN'}`);
        }
      }
    };

    window.addEventListener('keydown', this.globalKeyHandler);
  }

  start(peerConnection, localStream) {
    this.stop();
    this.#createHUDMarkup();
    this.hudElement.style.display = this.isHudVisible ? 'block' : 'none';
    document.getElementById('hud-status').innerText = "ACTIVE";
    document.getElementById('hud-status').style.color = "#00ff66";
    this.isMonitoring = true;
    this.bindToggleKey();
    this.setupAudioAnalyzer(localStream);

    this.intervalToken = setInterval(async () => {
      if (!this.isMonitoring || !localStream) return;
      if (typeof isMediaChanging !== 'undefined' && isMediaChanging) return;

      // 1. EVALUATE LOCAL AUDIO HARDWARE
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const t = audioTracks[0];
        const s = t.getSettings();
        this.updateDOMText('hud-tx-audio-enabled', t.enabled ? "TRANSMITTING" : "MUTED", t.enabled ? "#00ff66" : "#ff3333");
        this.updateDOMText('hud-audio-aec', s.echoCancellation !== undefined ? s.echoCancellation.toString() : 'false');
        this.updateDOMText('hud-audio-aec-type', s.echoCancellationType ? s.echoCancellationType.toString() : 'N/A');
        this.updateDOMText('hud-audio-ns', s.noiseSuppression !== undefined ? s.noiseSuppression.toString() : 'false');
        this.updateDOMText('hud-audio-agc', s.autoGainControl !== undefined ? s.autoGainControl.toString() : 'false');
        this.updateDOMText('hud-audio-rate', s.sampleRate ? `${s.sampleRate} Hz` : '-');
        this.updateDOMText('hud-audio-size', s.sampleSize ? `${s.sampleSize} bits` : '-');
        this.updateDOMText('hud-audio-channels', s.channelCount ? `${s.channelCount} Channel(s)` : '-');
      }

      // 2. EVALUATE LOCAL VIDEO HARDWARE
      const videoTracks = localStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const t = videoTracks[0];
        const s = t.getSettings();
        this.updateDOMText('hud-tx-video-enabled', t.enabled ? "TRANSMITTING" : "MUTED", t.enabled ? "#00ff66" : "#ff3333");
        this.updateDOMText('hud-video-cap-res', `${s.width ?? '-'}x${s.height ?? '-'}`);
        this.updateDOMText('hud-video-cap-fps', s.frameRate ? s.frameRate.toFixed(1) : '-');
        this.updateDOMText('hud-video-cap-aspect', s.aspectRatio ? s.aspectRatio.toFixed(3) : '-');
        this.updateDOMText('hud-video-cap-resize', s.resizeMode ?? 'none');
        this.updateDOMText('hud-video-cap-facing', s.facingMode ? s.facingMode.toUpperCase() : 'EXTERNAL/USB');
      }

      // 3. EVALUATE TRACK INPUT STATUS (RECEIVERS)
      if (peerConnection) {
        const receivers = peerConnection.getReceivers();
        const rAudio = receivers.find(r => r.track && r.track.kind === 'audio');
        const rVideo = receivers.find(r => r.track && r.track.kind === 'video');
        
        this.updateDOMText('hud-rx-audio-enabled', rAudio && rAudio.track ? (rAudio.track.enabled ? "RECEIVING" : "MUTED") : "DISCONNECTED", rAudio && rAudio.track?.enabled ? "#00ff66" : "#ff3333");
        this.updateDOMText('hud-rx-video-enabled', rVideo && rVideo.track ? (rVideo.track.enabled ? "RECEIVING" : "MUTED") : "DISCONNECTED", rVideo && rVideo.track?.enabled ? "#00ff66" : "#ff3333");

        try {
          const stats = await peerConnection.getStats();
          const now = performance.now();

          stats.forEach(report => {
            // --- TRANSMIT PROCESSING (OUTBOUND) ---
            if (report.type === 'outbound-rtp') {
              if (report.kind === 'audio') {
                this.updateDOMText('hud-tx-audio-bytes', report.bytesSent ? `${(report.bytesSent / 1024).toFixed(1)} KB` : '-');
                this.computeBitrate('hud-tx-audio-kbps', report.bytesSent, 'txAudioBytes', 'txAudioTime', now);
              } else if (report.kind === 'video') {
                this.updateDOMText('hud-tx-video-res', report.frameWidth ? `${report.frameWidth}x${report.frameHeight}` : '-');
                this.updateDOMText('hud-tx-video-fps', report.framesPerSecond ?? '-');
                this.updateDOMText('hud-tx-video-bytes', report.bytesSent ? `${(report.bytesSent / 1024 / 1024).toFixed(2)} MB` : '-');
                this.updateDOMText('hud-tx-video-frames', report.framesSent ?? '-');
                this.computeBitrate('hud-tx-video-kbps', report.bytesSent, 'txVideoBytes', 'txVideoTime', now);
                const reason = report.qualityLimitationReason?.toUpperCase() || 'NONE';
                this.updateDOMText('hud-tx-video-limit', reason, reason === 'NONE' ? '#00ff66' : '#ff3333');
              }
            }
            
            // --- RECEIVE PROCESSING (INBOUND) ---
            if (report.type === 'inbound-rtp') {
              if (report.kind === 'audio') {
                this.updateDOMText('hud-rx-audio-bytes', report.bytesReceived ? `${(report.bytesReceived / 1024).toFixed(1)} KB` : '-');
                this.updateDOMText('hud-rx-audio-lost', report.packetsLost !== undefined ? report.packetsLost.toString() : '-');
                this.updateDOMText('hud-rx-audio-jitter', report.jitter ? `${(report.jitter * 1000).toFixed(1)} ms` : '-');
                this.computeBitrate('hud-rx-audio-kbps', report.bytesReceived, 'rxAudioBytes', 'rxAudioTime', now);
                // Inbound track level parsing hook
                this.updateDOMText('hud-rx-audio-lvl', report.audioLevel !== undefined ? report.audioLevel.toFixed(4) : '0.0000');
              } else if (report.kind === 'video') {
                this.updateDOMText('hud-rx-video-res', report.frameWidth ? `${report.frameWidth}x${report.frameHeight}` : '-');
                this.updateDOMText('hud-rx-video-fps', report.framesPerSecond ?? '-');
                this.updateDOMText('hud-rx-video-bytes', report.bytesReceived ? `${(report.bytesReceived / 1024 / 1024).toFixed(2)} MB` : '-');
                this.updateDOMText('hud-rx-video-frames', report.framesReceived ?? '-');
                this.computeBitrate('hud-rx-video-kbps', report.bytesReceived, 'rxVideoBytes', 'rxVideoTime', now);
                this.updateDOMText('hud-rx-video-dropped', report.framesDropped !== undefined ? report.framesDropped.toString() : '0');
              }
            }
            
            // --- AUDIO CAPTURE SOURCE ENERGY ---
            if (report.type === 'media-source' && report.kind === 'audio') {
              this.updateDOMText('hud-tx-audio-lvl', report.audioLevel !== undefined ? report.audioLevel.toFixed(4) : '0.0000');
            }
          });
        } catch (err) { console.error("HUD processing error:", err); }
      }
    }, 1000); // Standardized to exactly 1 second for perfect bitrate measurements

  }

  /**
   * Generalized throughput delta engine helper for low class footprint overhead
   */
  computeBitrate(domId, currentBytes, byteStoreKey, timeStoreKey, now) {
    if (currentBytes && this[byteStoreKey] > 0) {
      const timeDeltaSec = (now - this[timeStoreKey]) / 1000;
      const byteDelta = currentBytes - this[byteStoreKey];
      if (timeDeltaSec > 0 && byteDelta >= 0) {
        const kbps = ((byteDelta * 8) / 1000) / timeDeltaSec;
        this.updateDOMText(domId, kbps.toFixed(1));
      }
    }
    this[timeStoreKey] = now;
    this[byteStoreKey] = currentBytes || 0;
  }

  setupAudioAnalyzer(stream) {
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      source.connect(this.analyserNode);

      const drawBar = () => {
        if (!this.isMonitoring || !this.analyserNode) return;
        const bufferLength = this.analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyserNode.getByteTimeDomainData(dataArray);

        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sumSquares += norm * norm;
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        const numEl = document.getElementById('hud-audio-mic-num');
        const fillEl = document.getElementById('hud-audio-vubar');
        if (numEl && fillEl) {
          numEl.innerText = rms.toFixed(4);
          fillEl.style.width = `${Math.min(100, Math.floor(rms * 160))}%`;
        }
        this.animationToken = requestAnimationFrame(drawBar);
      };
      this.animationToken = requestAnimationFrame(drawBar);
    } catch (e) { console.warn(e); }
  }

  updateDOMText(id, value, color = null) {
    const el = document.getElementById(id);
    if (el) { el.innerText = value; if (color) el.style.color = color; }
  }

  stop() {
    this.isMonitoring = false;
    if (this.intervalToken) clearInterval(this.intervalToken);
    if (this.animationToken) cancelAnimationFrame(this.animationToken);
    if (this.audioCtx) this.audioCtx.close().catch(() => {});

    if (this.globalKeyHandler) {
      window.removeEventListener('keydown', this.globalKeyHandler);
      this.globalKeyHandler = null;
    }

    const el = document.getElementById('webrtc-expert-hud');
    if (el) el.remove();
    this.intervalToken = null; this.audioCtx = null; this.analyserNode = null; this.hudElement = null;
  }
}
