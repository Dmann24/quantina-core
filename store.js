export const users = new Map();
export const sockets = new Map();
export const messages = new Map();

export function ensureUser(userId, name = "Guest") {
  if (!users.has(userId)) {
    users.set(userId, { userId, name, contacts: new Set(), sockets: new Set() });
  }
  return users.get(userId);
}

export function listContacts(userId) {
  const u = users.get(userId);
  if (!u) return [];
  return [...u.contacts].map(cid => {
    const c = users.get(cid);
    const online = c ? c.sockets.size > 0 : false;
    return { userId: cid, name: c?.name || cid, online };
  });
}

export function saveMessage(msg) {
  const key = [msg.from, msg.to].sort().join(":");
  if (!messages.has(key)) messages.set(key, []);
  messages.get(key).push(msg);
}
