export class RemoteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function localAddress(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(text)) throw new RemoteError('Enter the TV’s local IPv4 address, such as 192.168.0.25.');
  const b = text.split('.').map(Number);
  if (b.some(n => n > 255) || b[3] === 0 || b[3] === 255 || !(b[0] === 10 || (b[0] === 172 && b[1] >= 16 && b[1] <= 31) || (b[0] === 192 && b[1] === 168))) throw new RemoteError('Use a private home-network IPv4 address.');
  return text;
}
export function macAddress(value = '') {
  const mac = String(value).trim().replaceAll('-', ':').toUpperCase();
  if (!mac) return '';
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) || parseInt(mac.slice(0, 2), 16) & 1 || mac === '00:00:00:00:00:00') throw new RemoteError('Enter a valid TV MAC address, with six pairs of letters and numbers.');
  return mac;
}
export function profile(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 60) throw new RemoteError('Give this TV a name of 1–60 characters.');
  return { name: input.name.trim(), address: localAddress(input.address), mac: macAddress(input.mac) };
}
export function shortcut(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || typeof input.appID !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(input.appID) || typeof input.deepLink !== 'boolean') throw new RemoteError('Enter an app name, a valid Samsung app ID, and a launch mode.');
  return { name: input.name.trim(), appID: input.appID, deepLink: input.deepLink };
}
export const KEYS = new Set(['UP','DOWN','LEFT','RIGHT','ENTER','HOME','RETURN','VOLUP','VOLDOWN','MUTE','POWEROFF','SOURCE','CHUP','CHDOWN','PLAY','PAUSE','STOP','REWIND','FF','GUIDE','INFO','MENU','EXIT','RED','GREEN','YELLOW','BLUE', ...Array.from({length:10}, (_,i) => String(i))].map(k => `KEY_${k}`));
export function keyPayload(key) {
  if (!KEYS.has(key)) throw new RemoteError('That remote button is not supported.');
  return { method:'ms.remote.control', params:{Cmd:'Click',DataOfCmd:key,Option:'false',TypeOfRemote:'SendRemoteKey'} };
}
export function textPayloads(text) {
  if (typeof text !== 'string' || !text.length || Array.from(text).length > 2000) throw new RemoteError('Enter between 1 and 2,000 characters.');
  return [{method:'ms.channel.emit',params:{event:'custom.remote.textReceived',to:'broadcast'}}, {method:'ms.remote.control',params:{Cmd:Buffer.from(text,'utf8').toString('base64'),DataOfCmd:'base64',TypeOfRemote:'SendInputString'}}];
}
export function launchPayload(input) {
  const app = shortcut(input);
  return {method:'ms.channel.emit',params:{event:'ed.apps.launch',to:'host',data:{appId:app.appID,action_type:app.deepLink?'DEEP_LINK':'NATIVE_LAUNCH',metaTag:''}}};
}
export const appsPayload = {method:'ms.channel.emit',params:{event:'ed.installedApp.get',to:'host'}};
export function parseApps(data) {
  const seen = new Set();
  return (Array.isArray(data?.data) ? data.data : []).slice(0,300).flatMap(row => {
    try {
      const app = shortcut({name:row.name,appID:row.appId,deepLink:Number(row.app_type) === 2});
      if (seen.has(app.appID)) return [];
      seen.add(app.appID); return [app];
    } catch { return []; }
  });
}
export function wakePacket(mac) {
  const normalized = macAddress(mac);
  if (!normalized) throw new RemoteError('Save the TV’s MAC address in Settings before sending a wake request.');
  const bytes = Buffer.from(normalized.replaceAll(':',''), 'hex');
  return Buffer.concat([Buffer.alloc(6,255), ...Array(16).fill(bytes)]);
}
