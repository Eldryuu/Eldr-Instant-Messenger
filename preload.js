const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eim', {
  // ── Window controls ────────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose:    () => ipcRenderer.send('window:close'),

  // ── Outgoing (renderer → main) ─────────────────────────────────────────
  wsConnect:       (params)  => ipcRenderer.invoke('ws:connect', params),
  wsSend:          (data)    => ipcRenderer.invoke('ws:send', data),
  openChat:        (params)  => ipcRenderer.invoke('chat:open', params),
  getChatInit:     ()        => ipcRenderer.invoke('chat:get-init'),
  createGroup:     (params)  => ipcRenderer.invoke('ws:create_group', params),
  savePicture:     (picture) => ipcRenderer.invoke('profile:save-picture', { picture }),
  updateMyPic:     (picture) => ipcRenderer.send('profile:update-pic', { picture }),

  // ── Incoming: contacts window ──────────────────────────────────────────
  onWsWelcome:     (cb) => ipcRenderer.on('ws:welcome',      (_, d) => cb(d)),
  onWsError:       (cb) => ipcRenderer.on('ws:error',        (_, d) => cb(d)),
  onWsKicked:      (cb) => ipcRenderer.on('ws:kicked',       (_, d) => cb(d)),
  onWsDisconnected:(cb) => ipcRenderer.on('ws:disconnected', (_, d) => cb(d)),
  onWsUserList:    (cb) => ipcRenderer.on('ws:user_list',    (_, d) => cb(d)),
  onWsUserJoined:  (cb) => ipcRenderer.on('ws:user_joined',  (_, d) => cb(d)),
  onWsUserLeft:    (cb) => ipcRenderer.on('ws:user_left',    (_, d) => cb(d)),
  onWsPrivateMsg:  (cb) => ipcRenderer.on('ws:private_msg',  (_, d) => cb(d)),
  onWsDisplaynameUpdated: (cb) => ipcRenderer.on('ws:displayname_updated', (_, d) => cb(d)),
  onWsGroupCreated:(cb) => ipcRenderer.on('ws:group_created',(_, d) => cb(d)),
  onWsGroupMsg:    (cb) => ipcRenderer.on('ws:group_msg',    (_, d) => cb(d)),

  // ── Auto-updater ───────────────────────────────────────────────────────
  onUpdateDownloading: (cb) => ipcRenderer.on('update:downloading', (_, d) => cb(d)),
  onUpdateReady:       (cb) => ipcRenderer.on('update:ready',       (_, d) => cb(d)),
  installUpdate:       ()   => ipcRenderer.send('update:install-now'),

  // ── Incoming: chat windows ─────────────────────────────────────────────
  onChatInit:          (cb) => ipcRenderer.on('chat:init',           (_, d) => cb(d)),
  onChatMessage:       (cb) => ipcRenderer.on('chat:message',        (_, d) => cb(d)),
  onChatSys:           (cb) => ipcRenderer.on('chat:sys',            (_, d) => cb(d)),
  onChatPartnerStatus: (cb) => ipcRenderer.on('chat:partner-status', (_, d) => cb(d)),
  onChatUserCount:     (cb) => ipcRenderer.on('chat:user-count',     (_, d) => cb(d)),
  onChatMyPic:         (cb) => ipcRenderer.on('chat:my-pic',         (_, d) => cb(d)),
  onChatWipeRequest:   (cb) => ipcRenderer.on('chat:wipe_request',   (_, d) => cb(d)),
  onChatWipeExecuted:  (cb) => ipcRenderer.on('chat:wipe_executed',  (_, d) => cb(d)),
  onChatWipeDeclined:  (cb) => ipcRenderer.on('chat:wipe_declined',  (_, d) => cb(d)),

  // ── Voice ──────────────────────────────────────────────────────────────────
  voiceInvite:  (params) => ipcRenderer.invoke('voice:invite',  params),
  voiceAccept:  (params) => ipcRenderer.invoke('voice:accept',  params),
  voiceDecline: (params) => ipcRenderer.invoke('voice:decline', params),
  voiceEnd:     (params) => ipcRenderer.invoke('voice:end',     params),
  voiceSignal:  (params) => ipcRenderer.invoke('voice:signal',  params),
  voiceJoin:    (params) => ipcRenderer.invoke('voice:join',    params),

  onVoiceCallId:        (cb) => ipcRenderer.on('voice:call-id',          (_, d) => cb(d)),
  onVoiceInvite:        (cb) => ipcRenderer.on('voice:invite',            (_, d) => cb(d)),
  onVoiceAccepted:      (cb) => ipcRenderer.on('voice:accepted',          (_, d) => cb(d)),
  onVoiceDeclined:      (cb) => ipcRenderer.on('voice:declined',          (_, d) => cb(d)),
  onVoiceEnded:         (cb) => ipcRenderer.on('voice:ended',             (_, d) => cb(d)),
  onVoiceSignal:        (cb) => ipcRenderer.on('voice:signal',            (_, d) => cb(d)),
  onVoiceGroupCallActive: (cb) => ipcRenderer.on('voice:group-call-active', (_, d) => cb(d)),
  onVoiceGroupCallEnded:  (cb) => ipcRenderer.on('voice:group-call-ended',  (_, d) => cb(d)),
});
