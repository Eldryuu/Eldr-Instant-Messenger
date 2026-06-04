// Chat window renderer — handles both group and private conversations

const api = window.eim;

// Window controls
document.getElementById('btn-win-min').addEventListener('click', () => api.windowMinimize());
document.getElementById('btn-win-max').addEventListener('click', () => api.windowMaximize());
document.getElementById('btn-win-close').addEventListener('click', () => api.windowClose());

const BASE_URL   = 'https://eldr.wtf';
const EMOTE_BASE = BASE_URL + '/images/emoticons/';

// ── Emoticon data (mirrors the web client) ───────────────────────────────────

const CLASSIC_EMOTES = [
  { code: ':)',   emoji: '🙂', title: 'Smile'       },
  { code: ':(',   emoji: '😢', title: 'Sad'         },
  { code: ':D',   emoji: '😄', title: 'Grin'        },
  { code: ':O',   emoji: '😮', title: 'Surprised'   },
  { code: ':P',   emoji: '😛', title: 'Tongue'      },
  { code: ';)',   emoji: '😉', title: 'Wink'        },
  { code: ':*',   emoji: '😘', title: 'Kiss'        },
  { code: ':S',   emoji: '😕', title: 'Confused'    },
  { code: ':|',   emoji: '😐', title: 'Neutral'     },
  { code: 'B)',   emoji: '😎', title: 'Cool'        },
  { code: ":'(",  emoji: '😭', title: 'Crying'      },
  { code: '>:)',  emoji: '😈', title: 'Evil'        },
  { code: '>:(',  emoji: '😠', title: 'Angry'       },
  { code: 'O:)',  emoji: '😇', title: 'Angel'       },
  { code: 'X)',   emoji: '🤣', title: 'LOL'         },
  { code: '<3',   emoji: '❤️', title: 'Heart'       },
  { code: ':/',   emoji: '😒', title: 'Hmm'         },
  { code: '^_^',  emoji: '😊', title: 'Happy'       },
  { code: '-_-',  emoji: '😑', title: 'Bored'       },
  { code: 'o.O',  emoji: '😳', title: 'Wtf'         },
  { code: '8-)',  emoji: '🤓', title: 'Nerd'        },
  { code: ':3',   emoji: '😺', title: 'Cat'         },
  { code: '\\o/', emoji: '🙌', title: 'Celebrate'   },
  { code: ':$',   emoji: '😳', title: 'Embarrassed' },
  // Long (dash) variants — renderer only
  { code: ':-)',  emoji: '🙂', pickerHide: true },
  { code: ':-(',  emoji: '😢', pickerHide: true },
  { code: ':-D',  emoji: '😄', pickerHide: true },
  { code: ':-O',  emoji: '😮', pickerHide: true },
  { code: ':-P',  emoji: '😛', pickerHide: true },
  { code: ';-)',  emoji: '😉', pickerHide: true },
  { code: ':-*',  emoji: '😘', pickerHide: true },
  { code: ':-|',  emoji: '😐', pickerHide: true },
  { code: 'X-D',  emoji: '🤣', pickerHide: true },
];

const CUSTOM_EMOTES = [
  { file: "Eldryuu's Hug emote YCH.png", title: 'Hug'           },
  { file: 'EldryuusJijiji.gif',           title: 'Jijiji'        },
  { file: 'EldryuusLewdemote-EDIT.gif',   title: 'Lewd'          },
  { file: 'Kukkaaforu.png',               title: 'For U'         },
  { file: 'Kukkaakiss1.png',              title: 'Kiss'          },
  { file: 'Kukkaaoooo.png',               title: 'Oooo'          },
  { file: 'Kukkaazoom.png',               title: 'Zoom'          },
  { file: 'Kukkakiss2.png',               title: 'Kiss 2'        },
  { file: 'notkukBeforeCoffee_new.png',   title: 'Before Coffee' },
];

// Build emote regex (longest codes first to avoid partial matches)
const EMOTE_RE = new RegExp(
  '(\\[emote:[^\\]]+\\]|' +
  CLASSIC_EMOTES
    .map(e => e.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|') +
  ')',
  'g'
);

// ── Text helpers ──────────────────────────────────────────────────────────────

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
}

function renderText(raw) {
  return raw.split(EMOTE_RE).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    if (part.startsWith('[emote:')) {
      const f = part.slice(7, -1);
      if (/^[^/\\<>:"?*\x00-\x1f]+\.(png|gif|jpg|jpeg)$/i.test(f)) {
        return `<img class="emote-img" src="${esc(EMOTE_BASE + encodeURIComponent(f))}" alt="${esc(f)}" title="${esc(f)}">`;
      }
      return esc(part);
    }
    const e = CLASSIC_EMOTES.find(c => c.code === part);
    return e ? `<span class="emote-cls" title="${esc(part)}">${e.emoji}</span>` : esc(part);
  }).join('');
}

function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const partnerPicEl  = document.getElementById('partner-pic');
const partnerNameEl = document.getElementById('partner-name');
const statusDotEl   = document.getElementById('status-dot');
const statusTextEl  = document.getElementById('status-text');
const msgsArea      = document.getElementById('msgs-area');
const composeInput  = document.getElementById('compose-input');
const btnSend       = document.getElementById('btn-send');
const emotePickerEl = document.getElementById('emote-picker');
const btnEmote      = document.getElementById('btn-emote');
const btnWipe       = document.getElementById('btn-wipe');

// ── Picture lightbox ──────────────────────────────────────────────────────────

partnerPicEl.addEventListener('click', () => {
  if (!partnerPicEl.src || chatType !== 'private') return;
  const overlay = document.createElement('div');
  overlay.className = 'pic-lightbox';
  const img = document.createElement('img');
  img.src = partnerPicEl.src;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
});

// ── State ─────────────────────────────────────────────────────────────────────

let myId              = null;
let partnerId         = null;
let chatType          = 'private'; // 'private' | 'worldwide' | 'group'
let pendingWipeId     = null;

// ── Message rendering ─────────────────────────────────────────────────────────

function appendMsg(msg) {
  const isMine = msg.from.id === myId;
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap ' + (isMine ? 'msg-mine' : 'msg-theirs');

  const who = document.createElement('div');
  who.className = 'msg-who';
  who.innerHTML = esc(msg.from.displayName) + `<span class="ts">(${fmtTime(msg.ts)})</span>`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = renderText(msg.text);

  wrap.appendChild(who);
  wrap.appendChild(bubble);
  msgsArea.appendChild(wrap);
  msgsArea.scrollTop = msgsArea.scrollHeight;
}

function appendSys(text) {
  const el = document.createElement('div');
  el.className = 'msg-sys';
  el.textContent = '— ' + text + ' —';
  msgsArea.appendChild(el);
  msgsArea.scrollTop = msgsArea.scrollHeight;
}

// ── Sending ───────────────────────────────────────────────────────────────────

function doSend() {
  const text = composeInput.value.trim();
  if (!text) return;
  if (chatType === 'worldwide') {
    api.wsSend({ type: 'worldwide_msg', text });
  } else if (chatType === 'group') {
    // partnerId is 'grp:GROUPID' — strip the prefix for the wire format
    api.wsSend({ type: 'group_msg', group_id: partnerId.replace(/^grp:/, ''), text });
  } else {
    api.wsSend({ type: 'private_msg', to: partnerId, text });
  }
  composeInput.value = '';
  composeInput.focus();
}

btnSend.addEventListener('click', doSend);
composeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
});

// ── Format buttons ────────────────────────────────────────────────────────────

document.querySelectorAll('.tb-fmt').forEach(btn => {
  btn.addEventListener('click', () => {
    const fmt = btn.dataset.fmt;
    const wrap = { bold: ['**', '**'], italic: ['_', '_'], underline: ['__', '__'] }[fmt];
    if (!wrap) return;
    const start = composeInput.selectionStart;
    const end   = composeInput.selectionEnd;
    const sel   = composeInput.value.slice(start, end) || fmt;
    composeInput.value =
      composeInput.value.slice(0, start) + wrap[0] + sel + wrap[1] + composeInput.value.slice(end);
    composeInput.selectionStart = start + wrap[0].length;
    composeInput.selectionEnd   = start + wrap[0].length + sel.length;
    composeInput.focus();
  });
});

// ── Emoticon picker ───────────────────────────────────────────────────────────

(function buildPicker() {
  const classicPane = document.getElementById('ep-pane-classic');
  const customPane  = document.getElementById('ep-pane-custom');

  CLASSIC_EMOTES.filter(e => !e.pickerHide).forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'ep-btn';
    btn.title = e.code + ' — ' + e.title;
    btn.textContent = e.emoji;
    btn.dataset.insert = e.code;
    classicPane.appendChild(btn);
  });

  CUSTOM_EMOTES.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'ep-btn';
    btn.title = e.title;
    btn.dataset.insert = `[emote:${e.file}]`;
    const img = document.createElement('img');
    img.src = EMOTE_BASE + encodeURIComponent(e.file);
    img.alt = e.title;
    btn.appendChild(img);
    customPane.appendChild(btn);
  });

  // Tab switching
  document.querySelectorAll('.ep-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.ep-tab').forEach(t => t.classList.remove('ep-tab-active'));
      document.querySelectorAll('.ep-pane').forEach(p => p.classList.remove('ep-pane-active'));
      this.classList.add('ep-tab-active');
      document.getElementById('ep-pane-' + this.dataset.tab).classList.add('ep-pane-active');
    });
  });

  // Insert on click
  emotePickerEl.addEventListener('click', e => {
    const btn = e.target.closest('.ep-btn');
    if (!btn) return;
    e.stopPropagation();
    const code = btn.dataset.insert;
    const s    = composeInput.selectionStart;
    const end  = composeInput.selectionEnd;
    composeInput.value = composeInput.value.slice(0, s) + code + composeInput.value.slice(end);
    composeInput.selectionStart = composeInput.selectionEnd = s + code.length;
    composeInput.focus();
    emotePickerEl.classList.add('hidden');
  });
})();

btnEmote.addEventListener('click', e => {
  e.stopPropagation();
  emotePickerEl.classList.toggle('hidden');
});

document.addEventListener('mousedown', e => {
  if (!emotePickerEl.classList.contains('hidden') &&
      !emotePickerEl.contains(e.target) &&
      e.target !== btnEmote) {
    emotePickerEl.classList.add('hidden');
  }
});

// ── Online status helper ──────────────────────────────────────────────────────

function setStatus(online) {
  statusDotEl.className  = 'dot ' + (online ? 'dot-online' : 'dot-offline');
  statusTextEl.textContent = online ? 'Online — Private conversation' : 'Offline';
}

// ── IPC init ──────────────────────────────────────────────────────────────────

// ── Wipe ─────────────────────────────────────────────────────────────────────

function wipeChatId() {
  if (chatType === 'private') return 'pm:' + [myId, partnerId].sort().join(':');
  if (chatType === 'group')   return partnerId.startsWith('grp:') ? partnerId : 'grp:' + partnerId;
  return null;
}

function appendWipeMsg(msg, isMine) {
  const el = document.createElement('div');
  el.className         = 'wipe-req-msg';
  el.dataset.requestId = msg.request_id;

  if (isMine) {
    el.innerHTML = `🗑 <strong>You</strong> requested to wipe this conversation. Waiting for others to accept…`;
  } else {
    el.innerHTML = `🗑 <strong>${esc(msg.from.displayName)}</strong> wants to wipe this conversation.
      <span class="wipe-req-btns">
        <button class="btn btn-primary  wipe-req-accept">Accept</button>
        <button class="btn btn-secondary wipe-req-decline">Decline</button>
      </span>`;

    el.querySelector('.wipe-req-accept').addEventListener('click', () => {
      api.wsSend({ type: 'wipe_response', request_id: msg.request_id, accept: true });
      el.innerHTML = '🗑 <strong>You</strong> accepted the wipe request. Waiting for others…';
    });
    el.querySelector('.wipe-req-decline').addEventListener('click', () => {
      api.wsSend({ type: 'wipe_response', request_id: msg.request_id, accept: false });
      el.remove();
      pendingWipeId = null;
    });
  }

  msgsArea.appendChild(el);
  msgsArea.scrollTop = msgsArea.scrollHeight;
  return el;
}

btnWipe.addEventListener('click', () => {
  const chatId = wipeChatId();
  if (!chatId) return;
  api.wsSend({ type: 'wipe_request', chat_id: chatId });
});

api.onChatWipeRequest(msg => {
  pendingWipeId = msg.request_id;
  appendWipeMsg(msg, msg.from.id === myId);
});

api.onChatWipeExecuted(() => {
  msgsArea.innerHTML = '';
  pendingWipeId = null;
  appendSys('Chat history has been wiped.');
});

api.onChatWipeDeclined(msg => {
  const reqEl = msgsArea.querySelector(`.wipe-req-msg[data-request-id="${msg.request_id}"]`);
  if (reqEl) reqEl.remove();
  pendingWipeId = null;
  appendSys((msg.from?.displayName || 'Someone') + ' declined the wipe request.');
});

(async () => {
  const data = await api.getChatInit();
  if (!data) return;

  myId      = data.myId;
  partnerId = data.partnerId;
  chatType  = data.chatType || 'private';

  if (data.turnConfig) RTC_CONFIG.iceServers.push(data.turnConfig);

  document.title = chatType === 'private'
    ? 'EIM — ' + data.partnerName
    : data.partnerName + ' — EIM';

  partnerNameEl.textContent = data.partnerName;

  if (chatType === 'worldwide') {
    partnerPicEl.src = BASE_URL + '/images/eldr_instant_messenger.png';
    statusDotEl.className    = 'dot dot-online';
    statusTextEl.textContent = (data.onlineCount || 1) + ' people online';
    btnWipe.style.display = 'none';
    document.getElementById('btn-call').style.display   = 'none';
    document.getElementById('voice-sep').style.display  = 'none';
  } else if (chatType === 'group') {
    partnerPicEl.src = BASE_URL + '/images/eldr_instant_messenger.png';
    partnerPicEl.style.fontSize = '22px';
    statusDotEl.className    = 'dot dot-online';
    statusTextEl.textContent = 'Group conversation';
  } else {
    partnerPicEl.src = data.partnerPic || (BASE_URL + '/images/user_icons/guest.jpg');
    setStatus(data.userOnline);
  }

  (data.history || []).forEach(msg => appendMsg(msg));
  composeInput.focus();

  if (data.pendingVoiceInvite) {
    pendingIncomingCallId = data.pendingVoiceInvite.call_id;
    elCallerName.textContent = data.pendingVoiceInvite.from.displayName;
    elIncomingCall.classList.remove('hidden');
  }

  if (data.activeGroupCallId && chatType === 'group') {
    pendingGroupCallId = data.activeGroupCallId;
    elGroupCallLabel.textContent = 'A call is in progress';
    elGroupCallJoin.classList.remove('hidden');
  }
})();

api.onChatMessage(({ msg }) => appendMsg(msg));

api.onChatSys(({ text }) => appendSys(text));

api.onChatPartnerStatus(({ online }) => setStatus(online));

api.onChatUserCount(({ count }) => {
  if (chatType === 'worldwide') statusTextEl.textContent = count + ' people online';
});

api.onChatMyPic(({ picture }) => {
  // Nothing to update in chat window for our own pic, but could be used for future features
});

// ── Voice chat ────────────────────────────────────────────────────────────────

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};
// turnConfig is injected via chat:init when the server has TURN configured

let activeCallId         = null;
let localStream          = null;
let pendingIncomingCallId = null;
let isMuted              = false;
let callTimerInterval    = null;
let callStartTime        = null;

const peerConnections  = new Map(); // peerId -> RTCPeerConnection
const iceCandidateQueues = new Map(); // peerId -> [candidate, ...]

const elIncomingCall   = document.getElementById('incoming-call');
const elActiveCall     = document.getElementById('active-call');
const elGroupCallJoin  = document.getElementById('group-call-join');
const elGroupCallLabel = document.getElementById('group-call-label');
const elCallerName     = document.getElementById('voice-caller-name');
const elCallInfo       = document.getElementById('voice-call-info');
const elCallTimer      = document.getElementById('voice-call-timer');
const btnCall          = document.getElementById('btn-call');
const btnVoiceAccept   = document.getElementById('btn-voice-accept');
const btnVoiceDecline  = document.getElementById('btn-voice-decline');
const btnVoiceMute     = document.getElementById('btn-voice-mute');
const btnVoiceHangup   = document.getElementById('btn-voice-hangup');
const btnGroupJoin     = document.getElementById('btn-group-join');

let pendingGroupCallId = null; // call_id for an active group call we can join

function startCallTimer() {
  callStartTime = Date.now();
  callTimerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    elCallTimer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}

function cleanupCall() {
  for (const [peerId, pc] of peerConnections) {
    pc.close();
    document.querySelector(`audio[data-peer-id="${peerId}"]`)?.remove();
  }
  peerConnections.clear();
  iceCandidateQueues.clear();

  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; callStartTime = null; }

  activeCallId          = null;
  pendingIncomingCallId = null;
  isMuted               = false;
  btnVoiceMute.textContent = '🎤';
  btnVoiceMute.title       = 'Mute';

  elActiveCall.classList.add('hidden');
  elIncomingCall.classList.add('hidden');
  btnCall.disabled = false;
}

function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId);

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections.set(peerId, pc);

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = ({ streams }) => {
    const audio = new Audio();
    audio.srcObject = streams[0];
    audio.dataset.peerId = peerId;
    audio.autoplay = true;
    document.body.appendChild(audio);
    audio.play().catch(() => {});
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      if (activeCallId) {
        api.voiceSignal({ callId: activeCallId, to: peerId, signal: { kind: 'ice', candidate: candidate.toJSON() } });
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[voice] ICE state →', pc.iceConnectionState, '(peer:', peerId, ')');
  };

  pc.onconnectionstatechange = () => {
    console.log('[voice] connection state →', pc.connectionState, '(peer:', peerId, ')');
    if (pc.connectionState === 'connected') {
      elCallInfo.textContent = 'In call';
      if (callStartTime === null) startCallTimer();
    }
    if (pc.connectionState === 'failed') {
      appendSys(`Voice connection failed (ICE: ${pc.iceConnectionState}).`);
      cleanupCall();
    }
  };

  return pc;
}

async function makeOffer(peerId) {
  const pc    = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  api.voiceSignal({ callId: activeCallId, to: peerId, signal: { kind: 'offer', type: offer.type, sdp: offer.sdp } });
}

async function handleSignal(fromId, signal) {
  if (signal.kind === 'offer') {
    const pc = createPeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
    const queued = iceCandidateQueues.get(fromId) || [];
    iceCandidateQueues.delete(fromId);
    for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    api.voiceSignal({ callId: activeCallId, to: fromId, signal: { kind: 'answer', type: answer.type, sdp: answer.sdp } });
  } else if (signal.kind === 'answer') {
    const pc = peerConnections.get(fromId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: signal.type, sdp: signal.sdp }));
      const queued = iceCandidateQueues.get(fromId) || [];
      iceCandidateQueues.delete(fromId);
      for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  } else if (signal.kind === 'ice') {
    const pc = peerConnections.get(fromId);
    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
    } else {
      if (!iceCandidateQueues.has(fromId)) iceCandidateQueues.set(fromId, []);
      iceCandidateQueues.get(fromId).push(signal.candidate);
    }
  }
}

// Call button — initiate outgoing call
btnCall.addEventListener('click', async () => {
  if (activeCallId || chatType === 'worldwide') return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    appendSys('Microphone access denied. Cannot start call.');
    return;
  }
  btnCall.disabled = true;
  elCallInfo.textContent  = 'Calling…';
  elCallTimer.textContent = '';
  elActiveCall.classList.remove('hidden');

  const isGroup = chatType === 'group';
  api.voiceInvite({
    winKey:  partnerId,
    to:      isGroup ? undefined : partnerId,
    groupId: isGroup ? partnerId.replace(/^grp:/, '') : undefined,
  });
});

// Accept / decline incoming call
btnVoiceAccept.addEventListener('click', async () => {
  if (!pendingIncomingCallId) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    appendSys('Microphone access denied. Cannot accept call.');
    api.voiceDecline({ callId: pendingIncomingCallId });
    pendingIncomingCallId = null;
    elIncomingCall.classList.add('hidden');
    return;
  }
  activeCallId          = pendingIncomingCallId;
  pendingIncomingCallId = null;
  elIncomingCall.classList.add('hidden');
  elCallInfo.textContent  = 'Connecting…';
  elCallTimer.textContent = '';
  elActiveCall.classList.remove('hidden');
  btnCall.disabled = true;
  api.voiceAccept({ callId: activeCallId });
});

btnVoiceDecline.addEventListener('click', () => {
  if (!pendingIncomingCallId) return;
  api.voiceDecline({ callId: pendingIncomingCallId });
  pendingIncomingCallId = null;
  elIncomingCall.classList.add('hidden');
});

btnVoiceHangup.addEventListener('click', () => {
  if (!activeCallId) return;
  api.voiceEnd({ callId: activeCallId });
  cleanupCall();
});

btnVoiceMute.addEventListener('click', () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
  btnVoiceMute.textContent = isMuted ? '🔇' : '🎤';
  btnVoiceMute.title       = isMuted ? 'Unmute' : 'Mute';
});

// IPC voice events
api.onVoiceCallId(({ callId }) => {
  activeCallId           = callId;
  elCallInfo.textContent = 'Calling…';
});

api.onVoiceInvite(msg => {
  pendingIncomingCallId = msg.call_id;
  elCallerName.textContent = msg.from.displayName;
  elIncomingCall.classList.remove('hidden');
});

api.onVoiceAccepted(async msg => {
  if (!activeCallId || msg.call_id !== activeCallId) return;
  elCallInfo.textContent = 'Connecting…';

  if (msg.from.id === myId) {
    // I just accepted — existing participants will send me offers; nothing to do proactively
  } else {
    // Someone else accepted (or joined group) — I make them an offer
    await makeOffer(msg.from.id);
  }
});

api.onVoiceDeclined(msg => {
  if (!activeCallId || msg.call_id !== activeCallId) return;
  if (msg.chat_type === 'group') {
    appendSys(msg.from.displayName + ' declined to join the call.');
    // Group call continues — don't cleanup
  } else {
    appendSys(msg.from.displayName + ' declined the call.');
    cleanupCall();
  }
});

api.onVoiceEnded(msg => {
  if (!msg.call_id || msg.call_id !== activeCallId) return;
  if (msg.chat_type === 'group' && msg.from.id !== myId) {
    appendSys(msg.from.displayName + ' left the call.');
    // Group call continues — don't cleanup
  } else {
    appendSys(msg.from.displayName + ' ended the call.');
    cleanupCall();
  }
});

// Group call join bar
btnGroupJoin.addEventListener('click', async () => {
  if (!pendingGroupCallId || activeCallId) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    appendSys('Microphone access denied. Cannot join call.');
    return;
  }
  activeCallId = pendingGroupCallId;
  pendingGroupCallId = null;
  elGroupCallJoin.classList.add('hidden');
  elCallInfo.textContent  = 'Connecting…';
  elCallTimer.textContent = '';
  elActiveCall.classList.remove('hidden');
  btnCall.disabled = true;
  api.voiceJoin({ callId: activeCallId, winKey: partnerId });
});

api.onVoiceGroupCallActive(msg => {
  if (chatType !== 'group') return;
  pendingGroupCallId = msg.call_id;
  elGroupCallLabel.textContent = msg.from.displayName + ' started a call';
  elGroupCallJoin.classList.remove('hidden');
});

api.onVoiceGroupCallEnded(() => {
  pendingGroupCallId = null;
  elGroupCallJoin.classList.add('hidden');
});

api.onVoiceSignal(async msg => {
  if (!activeCallId || msg.call_id !== activeCallId) return;
  await handleSignal(msg.from.id, msg.signal).catch(err => console.error('voice signal error:', err));
});
