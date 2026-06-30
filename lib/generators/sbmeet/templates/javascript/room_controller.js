// app/javascript/controllers/room_controller.js
import { Controller } from "@hotwired/stimulus"
import { createConsumer } from "@rails/actioncable"

const MEDIA_CONSTRAINTS = {
  video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 }, facingMode: "user" },
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
}

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
const MAX_BITRATE = 4000000

export default class extends Controller {
  static targets = ["localVideo", "remoteContainer"]
  static values = { id: Number, currentUserId: Number, currentUserName: String }

  connect() {
    this.peers = {}
    this.audioAnimationFrames = {} 
    this.audioContext = null
    this.consumer = createConsumer()
    this.startLocalStream()
  }

  disconnect() {
    if (this.signalingChannel) this.signalingChannel.unsubscribe()
    if (this.localStream) this.localStream.getTracks().forEach(t => t.stop())
    if (this.audioContext) this.audioContext.close()
    
    Object.values(this.audioAnimationFrames).forEach(cancelAnimationFrame)
    Object.values(this.peers).forEach(pc => clearInterval(pc.statsInterval))
  }

  // --- 1. MEDIA & SIGNALING INITIALIZATION ---

  async startLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
      this.localVideoTarget.srcObject = this.localStream
      this.trackAudioLevel(this.localStream, "local-audio-level")
      this.connectToSignaling()
    } catch (error) {
      console.error("Media permission rejected:", error)
      alert("Microphone and Camera access are required.")
    }
  }

  connectToSignaling() {
    const self = this
    this.signalingChannel = this.consumer.subscriptions.create(
      { channel: "SignalingChannel", room_id: this.idValue },
      {
        connected() { self.transmit("join") },
        received(data) { self.handleSignal(data) }
      }
    )
  }

  transmit(type, payload = {}) {
    this.signalingChannel.perform("receive", { room_id: this.idValue, type, ...payload })
  }

  // --- 2. SIGNALING ROUTER ---

  handleSignal(data) {
    if (data.user_id === this.currentUserIdValue) return

    if (data.type === "join") {
      const separateActivePeers = Object.keys(this.peers).filter(id => parseInt(id) !== data.user_id)
      if (separateActivePeers.length >= 1) {
        return this.transmit("room-full", { target_user_id: data.user_id })
      }
      if (this.peers[data.user_id]) this.removeParticipant(data.user_id) 
    }

    if (data.type === "room-full" && data.target_user_id === this.currentUserIdValue) {
      return this.handleRoomFullExclusion()
    }

    if (["offer", "answer", "ice-candidate"].includes(data.type) && data.target_user_id !== this.currentUserIdValue) return

    switch (data.type) {
      case "join":
        this.initPeer(data.user_id, data.user_name, true)
        this.transmit("discover", { target_peer_id: data.user_id })
        break
      case "discover":
        if (data.target_peer_id === this.currentUserIdValue) this.initPeer(data.user_id, data.user_name, false)
        break
      case "offer":
        this.handleOffer(data.user_id, data.user_name, data.offer)
        break
      case "answer":
        if (this.peers[data.user_id]) this.peers[data.user_id].setRemoteDescription(new RTCSessionDescription(data.answer))
        break
      case "ice-candidate":
        if (this.peers[data.user_id]) this.peers[data.user_id].addIceCandidate(new RTCIceCandidate(data.candidate))
        break
      case "leave":
        this.removeParticipant(data.user_id)
        break
    }
  }

  // --- 3. WEBRTC PIPELINE ---

  initPeer(userId, userName, isOfferor) {
    if (this.peers[userId]) return
    this.addParticipantToRoster(userId, userName)

    const pc = new RTCPeerConnection(RTC_CONFIG)
    pc.isOfferor = isOfferor
    this.peers[userId] = pc

    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream))

    pc.addEventListener("negotiationneeded", () => this.maximizeVideoBitrate(pc))
    
    pc.oniceconnectionstatechange = () => {
      if (["disconnected", "failed"].includes(pc.iceConnectionState)) {
        this.triggerIceRestart(userId)
      } else if (pc.iceConnectionState === "connected") {
        this.trackNetworkStats(pc, userId)
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) this.transmit("ice-candidate", { candidate: event.candidate, target_user_id: userId })
    }

    pc.ontrack = (event) => this.mountRemoteVideo(userId, userName, event.streams[0])

    if (isOfferor) this.createAndSendOffer(userId)
  }

  async maximizeVideoBitrate(pc) {
    try {
      const videoSender = pc.getSenders().find(s => s.track?.kind === "video")
      if (!videoSender?.getParameters) return
      
      const parameters = videoSender.getParameters()
      if (!parameters.encodings) parameters.encodings = [{}]
      parameters.encodings[0].maxBitrate = MAX_BITRATE
      parameters.degradationPreference = "maintain-resolution"
      
      await videoSender.setParameters(parameters)
    } catch (err) {
      console.warn("Bitrate override failed:", err)
    }
  }

  async createAndSendOffer(userId, iceRestart = false) {
    const pc = this.peers[userId]
    const offer = await pc.createOffer({ iceRestart })
    await pc.setLocalDescription(offer)
    this.transmit("offer", { offer: pc.localDescription, target_user_id: userId })
  }

  async handleOffer(userId, userName, offer) {
    this.initPeer(userId, userName, false)
    const pc = this.peers[userId]
    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.transmit("answer", { answer: pc.localDescription, target_user_id: userId })
  }

  async triggerIceRestart(userId) {
    if (this.peers[userId]?.isOfferor) {
      console.log("Network topology shift. Initiating ICE restart...")
      this.createAndSendOffer(userId, true)
    }
  }

  // --- 4. NETWORK DIAGNOSTICS POLLING ---

  trackNetworkStats(pc, userId) {
    let lastResult = null

    pc.statsInterval = setInterval(async () => {
      if (pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") return

      try {
        const stats = await pc.getStats()
        
        stats.forEach(report => {
          if (report.type === "outbound-rtp" && report.kind === "video") {
            const now = report.timestamp
            const bytes = report.bytesSent

            if (lastResult && lastResult.has(report.id)) {
              const lastReport = lastResult.get(report.id)
              const bitRate = (8 * (bytes - lastReport.bytesSent)) / (now - lastReport.timestamp)
              const mbps = (bitRate / 1000).toFixed(2) 
              
              const localEmitLabel = document.getElementById("local-emit-rate")
              if (localEmitLabel) localEmitLabel.innerText = mbps
            }
          }

          if (report.type === "inbound-rtp" && report.kind === "video") {
            const now = report.timestamp
            const bytes = report.bytesReceived
            const packetsLost = report.packetsLost

            if (lastResult && lastResult.has(report.id)) {
              const lastReport = lastResult.get(report.id)
              const bitRate = (8 * (bytes - lastReport.bytesReceived)) / (now - lastReport.timestamp)
              const mbps = (bitRate / 1000).toFixed(2)
              
              const remoteRecvLabel = document.getElementById(`remote-recv-rate-${userId}`)
              if (remoteRecvLabel) remoteRecvLabel.innerText = mbps

              const remoteLossLabel = document.getElementById(`remote-loss-${userId}`)
              if (remoteLossLabel) {
                remoteLossLabel.innerText = packetsLost
                const droppedRecently = packetsLost - lastReport.packetsLost
                remoteLossLabel.className = droppedRecently > 0 ? "text-danger fw-bold" : "text-success"
              }
            }
          }
        })
        
        lastResult = stats
      } catch (err) {
        console.warn("Could not retrieve WebRTC stats:", err)
      }
    }, 1000) 
  }

  // --- 5. DOM & UI MANAGEMENT ---

  mountRemoteVideo(userId, userName, stream) {
    if (document.getElementById(`video-${userId}`)) return

    const html = `
      <div class="col-12" id="container-${userId}">
        <div class="card bg-dark border-0 shadow overflow-hidden">
          <div class="position-relative d-flex flex-column bg-black">
            <div class="d-flex position-relative" id="wrapper-${userId}">
              <div class="ratio ratio-16x9 bg-black flex-grow-1">
                <video id="video-${userId}" autoplay playsinline class="w-100 h-100 object-fit-cover"></video>
              </div>
              <div class="bg-black border-start border-secondary p-1 d-flex align-items-end" style="width: 14px;">
                <div id="audio-level-${userId}" class="w-100 bg-success rounded-top" style="height: 0%; min-height: 2px; transition: height 0.05s ease;"></div>
              </div>
              <span class="position-absolute bottom-0 start-0 m-3 badge bg-secondary opacity-75 z-3">${userName}</span>
              <button id="fullscreen-${userId}" class="btn btn-sm btn-light position-absolute top-0 end-0 m-2 opacity-50 hover-opacity-100 z-3" title="Toggle Fullscreen">⛶</button>
            </div>
            
            <div class="bg-dark text-white p-2 small font-monospace d-flex justify-content-between border-top border-secondary" style="font-size: 0.75rem;">
              <div>📥 Receiving: <span id="remote-recv-rate-${userId}">0.00</span> Mbps</div>
              <div>📉 Loss: <span id="remote-loss-${userId}" class="text-success">0</span> pkts</div>
            </div>
          </div>
        </div>
      </div>
    `
    this.remoteContainerTarget.insertAdjacentHTML('beforeend', html)
    
    const videoEl = document.getElementById(`video-${userId}`)
    videoEl.srcObject = stream
    
    document.getElementById(`fullscreen-${userId}`).onclick = () => this.toggleFullscreen(document.getElementById(`wrapper-${userId}`), videoEl)
    
    this.trackAudioLevel(stream, `audio-level-${userId}`, userId)
  }

  toggleFullscreen(containerNode, videoNode) {
    if (typeof videoNode.webkitEnterFullscreen === 'function') {
      return videoNode.webkitEnterFullscreen() 
    }
    
    if (!document.fullscreenElement) {
      containerNode.requestFullscreen().catch(() => {
        if (videoNode.requestFullscreen) videoNode.requestFullscreen().catch(console.error)
      })
    } else {
      if (document.exitFullscreen) document.exitFullscreen()
    }
  }

  toggleLocalFullscreen() {
    this.toggleFullscreen(this.localVideoTarget.closest(".d-flex.position-relative"), this.localVideoTarget)
  }

  handleRoomFullExclusion() {
    alert("This room is full. Only 2 participants are allowed simultaneously.")
    this.disconnect()
    window.location.href = "/" 
  }

  // --- 6. AUDIO VISUALIZER ---

  trackAudioLevel(stream, elementId, userId = 'local') {
    if (stream.getAudioTracks().length === 0) return

    try {
      if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      
      const analyser = this.audioContext.createAnalyser()
      const source = this.audioContext.createMediaStreamSource(stream)
      
      analyser.fftSize = 256
      source.connect(analyser)
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLevel = () => {
        const progressBar = document.getElementById(elementId)
        if (!progressBar) return

        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((acc, val) => acc + val, 0) / analyser.frequencyBinCount
        const percentage = Math.min(Math.round((average / 120) * 100), 100)
        
        progressBar.style.height = `${percentage}%`
        progressBar.className = `w-100 rounded-top ${percentage > 80 ? 'bg-danger' : percentage > 45 ? 'bg-warning' : 'bg-success'}`

        this.audioAnimationFrames[userId] = requestAnimationFrame(updateLevel)
      }

      updateLevel()
    } catch (e) {
      console.error("Audio context initialization failure", e)
    }
  }

  // --- 7. ROSTER MANAGEMENT ---

  addParticipantToRoster(userId, userName) {
    if (document.getElementById(`roster-${userId}`)) return
    const listContainer = document.getElementById("participant-list")
    if (!listContainer) return

    listContainer.insertAdjacentHTML('beforeend', `
      <li id="roster-${userId}" class="list-group-item d-flex align-items-center text-muted">
        <span class="p-1 bg-secondary border border-light rounded-circle me-2"></span>${userName}
      </li>
    `)
    this.updateParticipantCount()
  }

  removeParticipant(userId) {
    if (this.peers[userId]) {
      clearInterval(this.peers[userId].statsInterval)
      this.peers[userId].close()
      delete this.peers[userId]
    }
    
    if (this.audioAnimationFrames[userId]) {
      cancelAnimationFrame(this.audioAnimationFrames[userId])
      delete this.audioAnimationFrames[userId]
    }

    document.getElementById(`container-${userId}`)?.remove()
    document.getElementById(`roster-${userId}`)?.remove()
    this.updateParticipantCount()
  }

  updateParticipantCount() {
    const counter = document.getElementById("participant-count")
    if (counter) counter.innerText = Object.keys(this.peers).length + 1
  }
}