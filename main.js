const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let contactsWindow = null;
const chatWindows = new Map(); // 'group' | partnerId -> BrowserWindow

// Global WebSocket state (lives in main process)
const state = {
  ws:             null,
  myId:           null,
  myName:         null,
  myPic:          null,
  token:          null,
  users:          new Map(),   // id -> { displayName, picture, online }
  worldHistory:   [],          // worldwide chat history
  privateHistory: new Map(),   // partnerId -> [msg]
  groups:         new Map(),   // groupId -> { name, owner, members: Set, history: [] }
  voiceCalls:            new Map(),  // callId -> winKey
  _pendingVoiceCallWinKey: null,     // winKey of window that initiated an outgoing call
  pendingVoiceInvites:   new Map(),  // winKey -> msg (for windows not yet loaded)
  turnConfig:            null,       // TURN credentials from server welcome message
};

// ── Window factories ────────────────────────────────────────────────────────

function createContactsWindow() {
  contactsWindow = new BrowserWindow({
    width:     270,
    height:    520,
    minWidth:  230,
    minHeight: 380,
    title:     'EIM - Eldr Instant Messenger',
    frame:     false,
    icon:      path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  contactsWindow.setMenuBarVisibility(false);
  contactsWindow.loadFile(path.join(__dirname, 'src', 'contacts.html'));

  contactsWindow.on('closed', () => {
    contactsWindow = null;
    for (const win of chatWindows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    chatWindows.clear();
  });
}

// chatType: 'worldwide' | 'group' | undefined (private)
function createChatWindow(winKey, partnerName, partnerPic, chatType) {
  const existing = chatWindows.get(winKey);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }

  const titleName = chatType === 'worldwide' ? 'Worldwide Chat'
                  : chatType === 'group'     ? partnerName
                  : partnerName;
  const windowTitle = chatType ? titleName + ' — EIM' : 'EIM — ' + partnerName;

  const win = new BrowserWindow({
    width:     530,
    height:    430,
    minWidth:  380,
    minHeight: 300,
    title:     windowTitle,
    frame:     false,
    icon:      path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'src', 'chat.html'));
  chatWindows.set(winKey, win);


  win.on('closed', () => {
    chatWindows.delete(winKey);
    for (const [callId, callWinKey] of state.voiceCalls) {
      if (callWinKey === winKey) {
        wsSend({ type: 'voice_end', call_id: callId });
        state.voiceCalls.delete(callId);
        break;
      }
    }
  });
}

// ── WebSocket management ────────────────────────────────────────────────────

function connectWS(username, password, action) {
  if (state.ws) {
    state.ws.onopen = state.ws.onmessage = state.ws.onerror = state.ws.onclose = null;
    try { state.ws.close(); } catch {}
    state.ws = null;
  }

  // Node.js 22+ has globalThis.WebSocket
  const ws = new WebSocket('wss://eldr.wtf');
  state.ws = ws;

  ws.onopen  = () => ws.send(JSON.stringify({ type: action, username, password }));
  ws.onerror = () => sendToContacts('ws:error', { text: 'Could not connect to server.' });
  ws.onclose = () => {
    if (state.myId) {
      sendToContacts('ws:disconnected', {});
      broadcastToChats('chat:sys', { text: 'Disconnected from server.' });
    }
  };
  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleWSMessage(msg);
  };
}

function wsSend(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify(data));
}

function handleWSMessage(msg) {
  switch (msg.type) {

    case 'welcome': {
      state.myId          = msg.id;
      state.myName        = msg.displayName;
      state.myPic         = normalizePic(msg.picture);
      state.token         = msg.token     || null;
      state.worldHistory  = msg.history   || [];
      state.turnConfig    = msg.turn      || null;

      // Load private histories from welcome
      if (msg.private_histories) {
        Object.entries(msg.private_histories).forEach(([partnerId, msgs]) => {
          state.privateHistory.set(partnerId, msgs);
        });
      }

      // Load named groups
      state.groups.clear();
      (msg.groups || []).forEach(g => {
        state.groups.set(g.id, {
          name:    g.name,
          owner:   g.owner,
          members: new Set((g.members || []).map(m => m.id)),
          history: g.history || [],
        });
      });
      state.users.clear();
      (msg.users || []).forEach(u => {
        state.users.set(u.id, {
          displayName: u.displayName,
          picture:     normalizePic(u.picture),
          online:      !!u.online,
        });
      });
      sendToContacts('ws:welcome', {
        id:          msg.id,
        displayName: msg.displayName,
        picture:     state.myPic,
        users:       usersArray(),
        groups:      groupsArray(),
      });
      break;
    }

    case 'displayname_updated':
      state.myName = msg.displayname;
      sendToContacts('ws:displayname_updated', { displayname: msg.displayname });
      break;

    case 'error':
      sendToContacts('ws:error', { text: msg.text || 'An error occurred.' });
      break;

    case 'kicked':
      state.myId  = null;
      state.token = null;
      sendToContacts('ws:kicked', { text: msg.text || 'Signed in from another location.' });
      for (const win of chatWindows.values()) if (!win.isDestroyed()) win.close();
      chatWindows.clear();
      state.privateHistory.clear();
      state.groups.clear();
      state.worldHistory = [];
      state.voiceCalls.clear();
      break;

    case 'user_list':
      state.users.clear();
      (msg.users || []).forEach(u => {
        state.users.set(u.id, {
          displayName: u.displayName,
          picture:     normalizePic(u.picture),
          online:      !!u.online,
        });
      });
      sendToContacts('ws:user_list', { users: usersArray() });
      break;

    case 'user_joined': {
      const prev = state.users.get(msg.id) || {};
      state.users.set(msg.id, { displayName: msg.displayName, picture: prev.picture || null, online: true });
      // picture already normalized from a prior user_list/welcome; no re-normalize needed
      sendToContacts('ws:user_joined', { id: msg.id, displayName: msg.displayName });

      const pmWin = chatWindows.get(msg.id);
      if (pmWin && !pmWin.isDestroyed()) {
        pmWin.webContents.send('chat:partner-status', { online: true });
        pmWin.webContents.send('chat:sys', { text: msg.displayName + ' is now online.' });
      }
      broadcastToWorldwide('chat:sys', { text: msg.displayName + ' has come online.' });
      broadcastToWorldwide('chat:user-count', { count: onlineCount() });
      break;
    }

    case 'user_left': {
      const entry = state.users.get(msg.id);
      if (entry) entry.online = false;
      sendToContacts('ws:user_left', { id: msg.id, displayName: msg.displayName });

      const pmWin = chatWindows.get(msg.id);
      if (pmWin && !pmWin.isDestroyed()) {
        pmWin.webContents.send('chat:partner-status', { online: false });
        pmWin.webContents.send('chat:sys', { text: msg.displayName + ' has gone offline.' });
      }
      broadcastToWorldwide('chat:sys', { text: msg.displayName + ' has gone offline.' });
      broadcastToWorldwide('chat:user-count', { count: onlineCount() });
      break;
    }

    case 'worldwide_msg': {
      state.worldHistory.push(msg);
      const grpWin = chatWindows.get('worldwide');
      if (grpWin && !grpWin.isDestroyed()) {
        grpWin.webContents.send('chat:message', { msg });
      }
      if (msg.from.id !== state.myId) {
        const visible = grpWin && !grpWin.isDestroyed() && !grpWin.isMinimized();
        if (!visible) {
          notify(msg.from.displayName + ' (Worldwide)', msg.text, () => {
            if (!grpWin || grpWin.isDestroyed()) {
              createChatWindow('worldwide', 'Worldwide Chat', null, 'worldwide');
            } else {
              grpWin.show();
              grpWin.focus();
            }
          });
        }
      }
      break;
    }

    case 'group_created': {
      const g = msg.group;
      state.groups.set(g.id, {
        name:    g.name,
        owner:   g.owner,
        members: new Set((g.members || []).map(m => m.id)),
        history: [],
      });
      sendToContacts('ws:group_created', {
        group: { id: g.id, name: g.name, owner: g.owner, members: g.members, history: [] },
      });
      break;
    }

    case 'group_msg': {
      const grp = state.groups.get(msg.group_id);
      if (grp) {
        grp.history.push(msg);
        const win = chatWindows.get('grp:' + msg.group_id);
        if (win && !win.isDestroyed()) {
          win.webContents.send('chat:message', { msg });
        }
        if (msg.from.id !== state.myId) {
          sendToContacts('ws:group_msg', { msg });
          const visible = win && !win.isDestroyed() && !win.isMinimized();
          if (!visible) {
            notify(msg.from.displayName + ' (' + grp.name + ')', msg.text, () => {
              if (!win || win.isDestroyed()) {
                createChatWindow('grp:' + msg.group_id, grp.name, null, 'group');
              } else {
                win.show();
                win.focus();
              }
            });
          }
        }
      }
      break;
    }

    case 'private_msg': {
      const partnerId = msg.from.id === state.myId ? msg.to : msg.from.id;
      if (!state.privateHistory.has(partnerId)) state.privateHistory.set(partnerId, []);
      state.privateHistory.get(partnerId).push(msg);

      const pmWin = chatWindows.get(partnerId);
      if (pmWin && !pmWin.isDestroyed()) {
        pmWin.webContents.send('chat:message', { msg });
      }

      if (msg.from.id !== state.myId) {
        // Only mark unread if the chat window isn't open
        if (!pmWin || pmWin.isDestroyed()) {
          sendToContacts('ws:private_msg', { msg });
        }
        const visible = pmWin && !pmWin.isDestroyed() && !pmWin.isMinimized();
        if (!visible) {
          notify(msg.from.displayName, msg.text, () => {
            const info = state.users.get(msg.from.id);
            if (!pmWin || pmWin.isDestroyed()) {
              createChatWindow(msg.from.id, msg.from.displayName, info?.picture || null, undefined);
            } else {
              pmWin.show();
              pmWin.focus();
            }
          });
        }
      }
      break;
    }

    case 'voice_call_id': {
      const winKey = state._pendingVoiceCallWinKey;
      state._pendingVoiceCallWinKey = null;
      if (winKey) {
        state.voiceCalls.set(msg.call_id, winKey);
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('voice:call-id', { callId: msg.call_id });
      }
      break;
    }

    case 'voice_invite': {
      let winKey;
      if (msg.chat_type === 'group') {
        winKey = 'grp:' + msg.group_id;
      } else {
        winKey = msg.from.id;
      }
      state.voiceCalls.set(msg.call_id, winKey);

      const win = chatWindows.get(winKey);
      if (win && !win.isDestroyed()) {
        win.webContents.send('voice:invite', msg);
        win.show();
        win.focus();
      } else {
        state.pendingVoiceInvites.set(winKey, msg);
        if (msg.chat_type === 'group') {
          const grp = state.groups.get(msg.group_id);
          if (grp) createChatWindow(winKey, grp.name, null, 'group');
        } else {
          const info = state.users.get(msg.from.id);
          createChatWindow(winKey, msg.from.displayName, info?.picture || null, undefined);
        }
      }

      notify(msg.from.displayName + ' is calling…', '📞 Incoming voice call', () => {
        const w = chatWindows.get(winKey);
        if (w && !w.isDestroyed()) { w.show(); w.focus(); }
      });
      break;
    }

    case 'voice_accepted': {
      const winKey = state.voiceCalls.get(msg.call_id);
      if (winKey) {
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('voice:accepted', msg);
      }
      break;
    }

    case 'voice_declined': {
      const winKey = state.voiceCalls.get(msg.call_id);
      if (winKey) {
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('voice:declined', msg);
        if (msg.chat_type !== 'group') state.voiceCalls.delete(msg.call_id);
      }
      break;
    }

    case 'voice_ended': {
      const winKey = state.voiceCalls.get(msg.call_id);
      if (winKey) {
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('voice:ended', msg);
        // Group call entry only removed when all participants leave (tracked by group_call_ended)
        if (msg.chat_type !== 'group') state.voiceCalls.delete(msg.call_id);
      }
      break;
    }

    case 'group_call_active': {
      state.activeGroupCalls = state.activeGroupCalls || new Map();
      state.activeGroupCalls.set(msg.group_id, msg.call_id);
      const win = chatWindows.get('grp:' + msg.group_id);
      if (win && !win.isDestroyed()) win.webContents.send('voice:group-call-active', msg);
      break;
    }

    case 'group_call_ended': {
      if (state.activeGroupCalls) state.activeGroupCalls.delete(msg.group_id);
      const win = chatWindows.get('grp:' + msg.group_id);
      if (win && !win.isDestroyed()) win.webContents.send('voice:group-call-ended', msg);
      state.voiceCalls.delete(msg.call_id);
      break;
    }

    case 'voice_signal': {
      const winKey = state.voiceCalls.get(msg.call_id);
      if (winKey) {
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('voice:signal', msg);
      }
      break;
    }

    case 'wipe_request': {
      const winKey = chatIdToWinKey(msg.chat_id);
      if (winKey) {
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('chat:wipe_request', msg);
      }
      break;
    }

    case 'wipe_executed': {
      const winKey = chatIdToWinKey(msg.chat_id);
      // Clear in-memory history
      if (winKey) {
        if (msg.chat_id === 'worldwide') state.worldHistory = [];
        else if (msg.chat_id.startsWith('grp:')) {
          const grp = state.groups.get(msg.chat_id.slice(4));
          if (grp) grp.history = [];
        } else {
          state.privateHistory.delete(winKey);
        }
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('chat:wipe_executed', msg);
      }
      break;
    }

    case 'wipe_declined': {
      const winKey = chatIdToWinKey(msg.chat_id);
      if (winKey) {
        const win = chatWindows.get(winKey);
        if (win && !win.isDestroyed()) win.webContents.send('chat:wipe_declined', msg);
      }
      break;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Server sends relative paths like "images/user_icons/foo.jpg" — make them absolute.
function normalizePic(picture) {
  if (!picture) return null;
  if (picture.startsWith('data:') || picture.startsWith('http://') || picture.startsWith('https://'))
    return picture;
  return 'https://eldr.wtf/' + picture;
}

function usersArray() {
  return [...state.users.entries()].map(([id, info]) => ({ id, ...info }));
}

function groupsArray() {
  return [...state.groups.entries()].map(([id, g]) => ({
    id,
    name:    g.name,
    owner:   g.owner,
    members: [...g.members].map(u => ({
      id:          u,
      displayName: u,
      picture:     state.users.get(u)?.picture ?? null,
    })),
    history: g.history,
  }));
}

function onlineCount() {
  return [...state.users.values()].filter(u => u.online).length + 1;
}

function sendToContacts(channel, data) {
  if (contactsWindow && !contactsWindow.isDestroyed())
    contactsWindow.webContents.send(channel, data);
}

function broadcastToChats(channel, data) {
  for (const win of chatWindows.values())
    if (!win.isDestroyed()) win.webContents.send(channel, data);
}

function chatIdToWinKey(chatId) {
  if (chatId === 'worldwide') return 'worldwide';
  if (chatId.startsWith('pm:')) {
    const parts = chatId.slice(3).split(':');
    return parts.find(p => p !== state.myId) || parts[0];
  }
  if (chatId.startsWith('grp:')) return 'grp:' + chatId.slice(4);
  return null;
}

function broadcastToWorldwide(channel, data) {
  const win = chatWindows.get('worldwide');
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body: body.length > 120 ? body.slice(0, 117) + '…' : body,
    urgency: 'normal',
  });
  n.on('click', onClick);
  n.show();
}

// ── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.on('window:minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('window:maximize', e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window:close', e => BrowserWindow.fromWebContents(e.sender)?.close());

ipcMain.handle('ws:connect', (_, { username, password, action }) => {
  connectWS(username, password, action);
});

ipcMain.handle('ws:send', (_, data) => {
  wsSend(data);
});

ipcMain.handle('chat:open', (_, { winKey, partnerName, partnerPic, chatType }) => {
  createChatWindow(winKey, partnerName, partnerPic, chatType);
});

ipcMain.handle('chat:get-init', (e) => {
  const sender = require('electron').BrowserWindow.fromWebContents(e.sender);
  let winKey = null;
  for (const [k, w] of chatWindows) { if (w === sender) { winKey = k; break; } }
  if (!winKey) return null;

  let chatType, titleName, partnerPic, history;
  if (winKey === 'worldwide') {
    chatType   = 'worldwide';
    titleName  = 'Worldwide Chat';
    partnerPic = null;
    history    = state.worldHistory;
  } else if (winKey.startsWith('grp:')) {
    const grp  = state.groups.get(winKey.slice(4));
    chatType   = 'group';
    titleName  = grp?.name || 'Group';
    partnerPic = null;
    history    = grp?.history || [];
  } else {
    const user = state.users.get(winKey);
    chatType   = 'private';
    titleName  = user?.displayName || winKey;
    partnerPic = user?.picture     || null;
    history    = state.privateHistory.get(winKey) || [];
  }

  const onlineCount    = [...state.users.values()].filter(u => u.online).length + 1;
  const pendingInvite  = state.pendingVoiceInvites.get(winKey) || null;
  if (pendingInvite) state.pendingVoiceInvites.delete(winKey);

  let activeGroupCallId = null;
  if (chatType === 'group' && state.activeGroupCalls) {
    activeGroupCallId = state.activeGroupCalls.get(winKey.slice(4)) || null;
  }

  return {
    partnerId:          winKey,
    partnerName:        titleName,
    partnerPic,
    chatType,
    myId:               state.myId,
    myName:             state.myName,
    myPic:              state.myPic,
    history,
    userOnline:         chatType === 'private' ? (state.users.get(winKey)?.online ?? false) : true,
    onlineCount,
    turnConfig:         state.turnConfig,
    pendingVoiceInvite: pendingInvite,
    activeGroupCallId,
  };
});

ipcMain.handle('ws:create_group', (_, { name, members }) => {
  wsSend({ type: 'create_group', name, members });
});

ipcMain.handle('profile:save-picture', async (_, { picture }) => {
  if (!state.token) return false;
  try {
    const res = await fetch('https://eldr.wtf/profile/picture', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: state.token, picture }),
    });
    return res.ok;
  } catch { return false; }
});

ipcMain.on('profile:update-pic', (_, { picture }) => {
  state.myPic = picture;
  // Notify any open chat windows so they can update their header pic
  broadcastToChats('chat:my-pic', { picture });
});

ipcMain.handle('voice:invite', (_, { winKey, to, groupId }) => {
  state._pendingVoiceCallWinKey = winKey;
  wsSend(groupId ? { type: 'voice_invite', group_id: groupId } : { type: 'voice_invite', to });
});

ipcMain.handle('voice:accept',  (_, { callId }) => wsSend({ type: 'voice_accept',  call_id: callId }));
ipcMain.handle('voice:decline', (_, { callId }) => wsSend({ type: 'voice_decline', call_id: callId }));
ipcMain.handle('voice:end',     (_, { callId }) => wsSend({ type: 'voice_end',     call_id: callId }));
ipcMain.handle('voice:signal',  (_, { callId, to, signal }) => wsSend({ type: 'voice_signal', call_id: callId, to, signal }));
ipcMain.handle('voice:join',    (_, { callId, winKey }) => {
  state.voiceCalls.set(callId, winKey);
  wsSend({ type: 'voice_join', call_id: callId });
});

// ── Auto-updater ──────────────────────────────────────────────────────────────

autoUpdater.autoDownload    = true;   // download silently in background
autoUpdater.autoInstallOnAppQuit = true; // install when user quits normally

autoUpdater.on('update-available', () => {
  sendToContacts('update:downloading', {});
});

autoUpdater.on('update-downloaded', () => {
  sendToContacts('update:ready', {});
});

autoUpdater.on('error', err => {
  // Non-fatal — app still works without the update
  console.error('Update error:', err.message);
});

ipcMain.on('update:install-now', () => {
  autoUpdater.quitAndInstall(true, true);
});

// ── App lifecycle ─────────────────────────────────────────────────────────────

// Chromium replaces real IPs with random mDNS hostnames in ICE candidates for
// privacy. Other peers can't resolve those hostnames across machines or networks,
// causing every WebRTC connection to fail. Force real IPs instead.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_and_private_interfaces');

app.whenReady().then(() => {
  createContactsWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createContactsWindow();
  });

  // Only check for updates in a packaged build, not during development
  if (app.isPackaged) {
    autoUpdater.checkForUpdates();
  }
});

app.on('window-all-closed', () => {
  if (state.ws) try { state.ws.close(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
