// Contacts window renderer

const api = window.eim;

// Window controls — same buttons exist in both login-brand and cl-head
document.querySelectorAll('.win-min').forEach(b => b.addEventListener('click', () => api.windowMinimize()));
document.querySelectorAll('.win-max').forEach(b => b.addEventListener('click', () => api.windowMaximize()));
document.querySelectorAll('.win-close').forEach(b => b.addEventListener('click', () => api.windowClose()));

// Named groups state
const groups     = new Map(); // groupId → { name, owner, members }
const grpUnread  = new Map(); // groupId → count

const DEFAULT_PIC = 'https://eldr.wtf/images/user_icons/guest.jpg';
const USER_PICS = [
  'airplane.jpg','astronaut.jpg','ball.jpg','beach.jpg','car.jpg',
  'cat.jpg','chess.jpg','dog.jpg','drip.JPG','duck.jpg',
  'fish.jpg','guest.jpg','guitar.jpg','kick.jpg','lift-off.jpg',
  'red flower.JPG','snowflake.jpg',
];

let myId  = null;
let myPic = DEFAULT_PIC;
const users  = new Map(); // id -> { displayName, picture, online }
const unread = new Map(); // partnerId -> count

// ── DOM refs ─────────────────────────────────────────────────────────────────

const screenLogin = document.getElementById('screen-login');
const screenCL    = document.getElementById('screen-cl');
const inpUser     = document.getElementById('inp-user');
const inpPass     = document.getElementById('inp-pass');
const btnSignin   = document.getElementById('btn-signin');
const btnRegister = document.getElementById('btn-register');
const errMsg      = document.getElementById('err-msg');
const myPicEl     = document.getElementById('my-pic');
const myNameEl    = document.getElementById('my-name');
const clStatus    = document.getElementById('cl-status');
const grpCount    = document.getElementById('grp-count');
const nOnline     = document.getElementById('n-online');
const nOffline    = document.getElementById('n-offline');
const listOnline  = document.getElementById('list-online');
const listOffline = document.getElementById('list-offline');
const listGroups  = document.getElementById('list-groups');
const picPicker   = document.getElementById('pic-picker');
const picGrid     = document.getElementById('pic-grid');
const picUpload   = document.getElementById('pic-upload-input');

// ── Login ─────────────────────────────────────────────────────────────────────

function setLoading(loading) {
  btnSignin.disabled   = loading;
  btnRegister.disabled = loading;
}

function showErr(text) {
  errMsg.textContent = text;
  setLoading(false);
}

function clearErr() { errMsg.textContent = ''; }

btnSignin.addEventListener('click', () => {
  const username = inpUser.value.trim();
  const password = inpPass.value;
  if (!username) { inpUser.focus(); return; }
  if (!password) { inpPass.focus(); return; }
  clearErr();
  setLoading(true);
  btnSignin.textContent = 'Signing in…';
  api.wsConnect({ username, password, action: 'login' });
});

btnRegister.addEventListener('click', () => {
  const username = inpUser.value.trim();
  const password = inpPass.value;
  if (!username) { inpUser.focus(); return; }
  if (!password) { inpPass.focus(); return; }
  clearErr();
  setLoading(true);
  btnRegister.textContent = 'Creating…';
  api.wsConnect({ username, password, action: 'register' });
});

inpUser.addEventListener('keydown', e => { if (e.key === 'Enter') inpPass.focus(); });
inpPass.addEventListener('keydown', e => { if (e.key === 'Enter') btnSignin.click(); });

// Restore saved username
const saved = localStorage.getItem('eim-username');
if (saved) inpUser.value = saved;

// ── Section toggles ───────────────────────────────────────────────────────────

function bindToggle(headerId, bodyId, arrowId) {
  document.getElementById(headerId).addEventListener('click', () => {
    const body = document.getElementById(bodyId);
    const collapsed = body.classList.toggle('collapsed');
    document.getElementById(arrowId).textContent = collapsed ? '▸' : '▾';
  });
}
bindToggle('hdr-groups',  'list-groups',  'arr-groups');
bindToggle('hdr-online',  'list-online',  'arr-online');
bindToggle('hdr-offline', 'list-offline', 'arr-offline');

// ── Worldwide chat ────────────────────────────────────────────────────────────

document.getElementById('btn-worldwide-chat').addEventListener('click', () => {
  if (!myId) return;
  api.openChat({ winKey: 'worldwide', partnerName: 'Worldwide Chat', partnerPic: null, chatType: 'worldwide' });
});

// ── New group button ──────────────────────────────────────────────────────────

document.getElementById('btn-new-group').addEventListener('click', () => {
  if (!myId) return;
  const panel = document.getElementById('create-group-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    // Populate member checkboxes from current user list
    const membersEl = document.getElementById('cgp-members');
    membersEl.innerHTML = '';
    const allUsers = [...users.entries()].filter(([id]) => id !== myId);
    membersEl.innerHTML = '';
    if (allUsers.length === 0) {
      membersEl.innerHTML = '<div style="color:#999;font-size:11px;padding:2px 0">No other users</div>';
    } else {
      allUsers.forEach(([id, info]) => {
        const label = document.createElement('label');
        label.className = 'cgp-member';
        label.dataset.name = info.displayName.toLowerCase();
        label.innerHTML = `<input type="checkbox" value="${id}"><span>${info.displayName}</span>`;
        membersEl.appendChild(label);
      });
    }
    document.getElementById('cgp-name').value   = '';
    document.getElementById('cgp-search').value = '';
    document.getElementById('cgp-name').focus();
  }
});

document.getElementById('cgp-search').addEventListener('input', function () {
  const q = this.value.toLowerCase();
  document.querySelectorAll('#cgp-members .cgp-member').forEach(row => {
    row.style.display = row.dataset.name.includes(q) ? '' : 'none';
  });
});

document.getElementById('cgp-cancel').addEventListener('click', () => {
  document.getElementById('create-group-panel').classList.add('hidden');
});

document.getElementById('cgp-create').addEventListener('click', () => {
  const name = document.getElementById('cgp-name').value.trim();
  if (!name) { document.getElementById('cgp-name').focus(); return; }
  const members = [...document.querySelectorAll('#cgp-members input:checked')].map(cb => cb.value);
  api.createGroup({ name, members });
  document.getElementById('create-group-panel').classList.add('hidden');
});

document.getElementById('cgp-name').addEventListener('keydown', e => {
  if (e.key === 'Enter')  document.getElementById('cgp-create').click();
  if (e.key === 'Escape') document.getElementById('create-group-panel').classList.add('hidden');
});

// ── Contact list rendering ────────────────────────────────────────────────────

function buildContactRow(u) {
  const row = document.createElement('div');
  row.className = 'contact-row' + (u.online ? '' : ' offline');
  row.id = 'row-' + u.id;

  const dot = document.createElement('span');
  dot.className = 'dot ' + (u.online ? 'dot-online' : 'dot-offline');

  const name = document.createElement('span');
  name.className = 'contact-name';
  name.textContent = u.displayName;

  const badge = document.createElement('span');
  badge.className = 'unread-badge';
  badge.id = 'badge-' + u.id;
  const n = unread.get(u.id) || 0;
  if (n > 0) { badge.textContent = n; badge.style.display = 'inline-block'; }

  row.appendChild(dot);
  row.appendChild(name);
  row.appendChild(badge);

  row.addEventListener('click', () => {
    unread.delete(u.id);
    setBadge(u.id, 0);
    const info = users.get(u.id) || u;
    api.openChat({
      winKey:      u.id,
      partnerName: info.displayName,
      partnerPic:  info.picture || null,
    });
  });
  return row;
}

function setGroupBadge(groupId, n) {
  const b = document.getElementById('grp-badge-' + groupId);
  if (!b) return;
  b.style.display = n > 0 ? 'inline-block' : 'none';
  b.textContent   = n;
}

function renderGroups() {
  listGroups.innerHTML = '';
  groups.forEach((grp, groupId) => {
    const row = document.createElement('div');
    row.className = 'contact-row';
    row.innerHTML = `<span style="font-size:13px">👥</span>
      <span class="contact-name">${grp.name}</span>
      <span class="unread-badge" id="grp-badge-${groupId}" style="display:none"></span>`;
    row.addEventListener('click', () => {
      grpUnread.delete(groupId);
      setGroupBadge(groupId, 0);
      api.openChat({ winKey: 'grp:' + groupId, partnerName: grp.name, partnerPic: null, chatType: 'group' });
    });
    listGroups.appendChild(row);
  });
  grpUnread.forEach((n, gid) => setGroupBadge(gid, n));
}

function renderSections() {
  const all     = [...users.entries()].map(([id, info]) => ({ id, ...info }));
  const online  = all.filter(u => u.online);
  const offline = all.filter(u => !u.online);

  grpCount.textContent  = (online.length + 1) + ' online';
  nOnline.textContent   = online.length;
  nOffline.textContent  = offline.length;

  listOnline.innerHTML  = '';
  listOffline.innerHTML = '';
  online.forEach(u  => listOnline.appendChild(buildContactRow(u)));
  offline.forEach(u => listOffline.appendChild(buildContactRow(u)));
}

function setBadge(uid, n) {
  const b = document.getElementById('badge-' + uid);
  if (!b) return;
  b.style.display = n > 0 ? 'inline-block' : 'none';
  b.textContent   = n;
}

// ── Display name editing ──────────────────────────────────────────────────────

const myNameEl2 = document.getElementById('my-name'); // alias for clarity

myNameEl2.title  = 'Double-click to change display name';
myNameEl2.style.cursor = 'pointer';

myNameEl2.addEventListener('dblclick', () => {
  if (!myId) return;
  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = myNameEl2.textContent;
  input.maxLength = 30;
  input.style.cssText = 'width:100%;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.5);border-radius:3px;color:#fff;font-weight:700;font-size:13px;padding:0 3px;outline:none;';
  myNameEl2.replaceWith(input);
  input.select();

  function commit() {
    const val = input.value.trim();
    input.replaceWith(myNameEl2);
    if (val && val !== myNameEl2.textContent) {
      api.wsSend({ type: 'set_displayname', displayname: val });
    }
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = myNameEl2.textContent; input.blur(); }
  });
});

api.onWsDisplaynameUpdated(({ displayname }) => {
  myNameEl2.textContent = displayname;
  clStatus.textContent  = 'Signed in as ' + displayname;
});

function showCL(data) {
  myId = data.id;
  myPic = data.picture || DEFAULT_PIC;
  localStorage.setItem('eim-username', data.displayName);

  myNameEl.textContent = data.displayName;
  myPicEl.src          = myPic;
  clStatus.textContent = 'Signed in as ' + data.displayName;

  // Populate users map
  users.clear();
  (data.users || []).forEach(u => {
    if (u.id !== myId)
      users.set(u.id, { displayName: u.displayName, picture: u.picture || null, online: !!u.online });
  });

  // Populate named groups
  groups.clear();
  (data.groups || []).forEach(g => {
    groups.set(g.id, { name: g.name, owner: g.owner, members: (g.members || []).map(m => m.id) });
  });

  renderSections();
  renderGroups();
  screenLogin.classList.add('hidden');
  screenCL.classList.remove('hidden');
}

// ── Profile picture picker ────────────────────────────────────────────────────

// Build the grid once
USER_PICS.forEach(f => {
  const img = document.createElement('img');
  img.className = 'pic-pick-item';
  img.src = 'https://eldr.wtf/images/user_icons/' + encodeURIComponent(f);
  img.dataset.serverPath = 'images/user_icons/' + f; // relative path for server
  img.alt = f;
  img.addEventListener('click', async () => {
    picPicker.classList.add('hidden');
    myPic = img.src;
    myPicEl.src = myPic;
    api.updateMyPic(myPic);
    await api.savePicture(img.dataset.serverPath); // send relative path to server
  });
  picGrid.appendChild(img);
});

picUpload.addEventListener('change', function () {
  const file = this.files[0];
  if (!file) return;
  resizeImage(file, 128, 0.88, async dataUrl => {
    picPicker.classList.add('hidden');
    myPic = dataUrl;
    myPicEl.src = myPic;
    api.updateMyPic(myPic);
    await api.savePicture(myPic);
  });
});

function resizeImage(file, maxDim, quality, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

myPicEl.addEventListener('click', () => {
  picPicker.classList.toggle('hidden');
});

document.addEventListener('mousedown', e => {
  if (!picPicker.classList.contains('hidden') &&
      !picPicker.contains(e.target) &&
      e.target !== myPicEl) {
    picPicker.classList.add('hidden');
  }
});

// ── IPC event handlers ────────────────────────────────────────────────────────

api.onWsWelcome(data => {
  setLoading(false);
  btnSignin.textContent   = 'Sign In';
  btnRegister.textContent = 'Create Account';
  showCL(data);
});

api.onWsError(data => {
  setLoading(false);
  btnSignin.textContent   = 'Sign In';
  btnRegister.textContent = 'Create Account';
  showErr(data.text);
});

api.onWsKicked(data => {
  screenCL.classList.add('hidden');
  screenLogin.classList.remove('hidden');
  myId = null;
  users.clear();
  unread.clear();
  showErr(data.text);
});

api.onWsDisconnected(() => {
  clStatus.textContent = 'Disconnected — restart to reconnect';
});

api.onWsUserList(data => {
  users.clear();
  (data.users || []).forEach(u => {
    if (u.id !== myId)
      users.set(u.id, { displayName: u.displayName, picture: u.picture || null, online: !!u.online });
  });
  renderSections();
});

api.onWsUserJoined(data => {
  const prev = users.get(data.id) || {};
  users.set(data.id, { displayName: data.displayName, picture: prev.picture || null, online: true });
  renderSections();
});

api.onWsUserLeft(data => {
  const entry = users.get(data.id);
  if (entry) entry.online = false;
  renderSections();
});

// ── Auto-update UI ────────────────────────────────────────────────────────────

const updateBanner = document.getElementById('update-banner');
const updateMsg    = document.getElementById('update-msg');
const updateBtn    = document.getElementById('update-btn');

api.onUpdateDownloading(() => {
  updateMsg.textContent = 'Downloading update…';
  updateBanner.classList.remove('hidden');
});

api.onUpdateReady(() => {
  updateMsg.textContent = 'Update ready.';
  updateBtn.classList.remove('hidden');
  updateBanner.classList.remove('hidden');
});

updateBtn.addEventListener('click', () => api.installUpdate());

// ── WebSocket event handlers ───────────────────────────────────────────────────

api.onWsPrivateMsg(({ msg }) => {
  const partnerId = msg.from.id;
  if (partnerId === myId) return;
  const n = (unread.get(partnerId) || 0) + 1;
  unread.set(partnerId, n);
  setBadge(partnerId, n);
});

api.onWsGroupCreated(({ group }) => {
  groups.set(group.id, { name: group.name, owner: group.owner, members: (group.members || []).map(m => m.id) });
  renderGroups();
});

api.onWsGroupMsg(({ msg }) => {
  const n = (grpUnread.get(msg.group_id) || 0) + 1;
  grpUnread.set(msg.group_id, n);
  setGroupBadge(msg.group_id, n);
});
