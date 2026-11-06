import {launchApp,appRequest} from './app-launch.mjs';
import https from 'node:https';
import tls from 'node:tls';
import { createHash } from 'node:crypto';
import {sendWake} from './wake.mjs';
import {readPowerState} from './power.mjs';
import WebSocket from 'ws';
import { RemoteError, localAddress, keyPayload, textPayloads, launchPayload, appsPayload, parseApps } from './protocol.mjs';

export function certificateHash(raw) { return createHash('sha256').update(raw).digest('hex'); }

// The TLS connection is handed to HTTP only after its leaf certificate is checked.
// TOFU is restricted to one private literal address; persist only after TV approval.
export function tvAgent(address, expected, observed, connectTLS = tls.connect) {
  localAddress(address);
  const agent = new https.Agent({keepAlive:false});
  agent.createConnection = (_options, callback) => {
    let finished = false;
    const socket = connectTLS({host:address, port:8002, rejectUnauthorized:false});
    const finish = (error) => {
      if (finished) return;
      finished = true; socket.setTimeout(0);
      if (error) { socket.destroy(); callback(error); }
      else callback(null, socket);
    };
    socket.setTimeout(8000, () => finish(new Error('TV TLS connection timed out.')));
    socket.once('error', finish);
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate().raw;
      if (!raw) return finish(new Error('The TV did not provide a certificate.'));
      const fingerprint = certificateHash(raw);
      if (expected && fingerprint !== expected) return finish(Object.assign(new Error('TV certificate changed. Check the TV address; forget pairing only after verifying the TV.'), {code:'CERT_CHANGED'}));
      observed(fingerprint); finish();
    });
    // Asynchronous Agent callback: no HTTP headers or token before validation.
    return undefined;
  };
  return agent;
}

export class SamsungTV {
  constructor(store, { appTransport = appRequest, wakeTransport = sendWake, powerStatus = readPowerState, wakeConnectTimeout = 3500, socketFactory, pairingTimeout = 30000, heartbeatMs = 12000, reconnectDelays = [1500,3000,5000,10000,20000,30000], appTimeout = 8000 } = {}) {
    this.store = store; this.powerStatus = powerStatus; this.poweringOff = false; this.waking = false; this.wakeConnectTimeout = wakeConnectTimeout; this.wakeTransport = wakeTransport; this.appTransport = appTransport; this.launchingApp = false;
    this.socketFactory = socketFactory ?? ((url, options) => new WebSocket(url, options));
    this.pairingTimeout = pairingTimeout; this.heartbeatMs = heartbeatMs;
    this.reconnectDelays = reconnectDelays; this.appTimeout = appTimeout; this.retryCount = 0; this.connectionWanted = false; this.reconnectAt = null; this.appStatus = 'unknown';
    this.generation = 0; this.tail = Promise.resolve(); this.pending = 0;
    this.state = 'disconnected'; this.message = ''; this.apps = []; this.loadingApps = false; this.keyboardActive = false;
  }
  snapshot() { return {state:this.state,message:this.message,apps:this.apps,loadingApps:this.loadingApps,keyboardActive:this.keyboardActive,reconnectAt:this.reconnectAt,appStatus:this.appStatus}; }
  closeTransport(message = '') {
    this.generation++; clearTimeout(this.deadline); clearInterval(this.heartbeat); clearTimeout(this.appDeadline); clearTimeout(this.pongDeadline); this.pongDeadline = null;
    const socket = this.socket; this.socket = null;
    if (socket) socket.terminate();
    this.agent?.destroy(); this.agent = null;
    this.state = 'disconnected'; this.message = message; this.loadingApps = false; this.keyboardActive = false;
    this.pending = 0; this.tail = Promise.resolve();
  }
  hasSavedPairing() {
    const pairing = this.store.data.pairing;
    return Boolean(pairing?.token && pairing.certificate && pairing.address === this.store.data.profile?.address);
  }
  cancelRetry() { clearTimeout(this.retryTimer); this.retryTimer = null; this.reconnectAt = null; }
  disconnect(message = '') {
    this.connectionWanted = false; this.cancelRetry(); this.retryCount = 0;
    this.closeTransport(message);
  }
  resume() {
    if (this.store.data.autoReconnect !== false && this.hasSavedPairing()) this.connect({automatic:true});
  }
  configureReconnect(enabled) {
    if (!enabled) {
      this.cancelRetry();
      if (this.state === 'reconnecting' || (this.state === 'connecting' && this.automaticAttempt)) this.disconnect('Automatic reconnection is off. Connect when the TV is ready.');
    } else if (!['connected','connecting'].includes(this.state)) this.resume();
  }
  fail(message, retry = false) {
    this.cancelRetry(); this.closeTransport(message); this.state = 'failed';
    if (!retry || !this.connectionWanted || this.store.data.autoReconnect === false || !this.hasSavedPairing()) {
      this.connectionWanted = false; return;
    }
    const delay = this.reconnectDelays[Math.min(this.retryCount++,this.reconnectDelays.length - 1)];
    this.state = 'reconnecting'; this.message = 'Waiting for your TV. The remote will reconnect when it is reachable.';
    this.reconnectAt = Date.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null; this.reconnectAt = null;
      if (this.connectionWanted && this.store.data.autoReconnect !== false && this.hasSavedPairing()) this.connect({automatic:true});
    },delay);
    this.retryTimer.unref?.();
  }
  connect({automatic = false} = {}) {
    const profile = this.store.data.profile;
    if (!profile) throw new RemoteError('Save your TV’s address first.');
    localAddress(profile.address);
    this.cancelRetry(); this.closeTransport(); this.connectionWanted = true; this.automaticAttempt = automatic;
    if (!automatic) this.retryCount = 0;
    this.apps = []; this.appStatus = 'unknown'; this.state = 'connecting';
    this.message = this.hasSavedPairing() ? 'Connecting to your saved TV…' : 'Select Allow on your TV if a permission prompt appears.';
    const generation = this.generation;
    const saved = this.store.data.pairing?.address === profile.address ? this.store.data.pairing : null;
    let fingerprint;
    this.agent = tvAgent(profile.address, saved?.certificate, value => { fingerprint = value; });
    const url = new URL(`wss://${profile.address}:8002/api/v2/channels/samsung.remote.control`);
    // Keep existing TV pairing identity; new pairings use the app’s public name.
    const clientName=saved?.token?(saved.clientName==='TV Remote'?'TV Remote':'Switkobo Remote'):'TV Remote';
    url.searchParams.set('name', Buffer.from(clientName).toString('base64'));
    if (saved?.token) url.searchParams.set('token', saved.token);
    const socket = this.socketFactory(url, {agent:this.agent,followRedirects:false,maxPayload:1048576,handshakeTimeout:10000});
    this.socket = socket;
    let transportOpen = false;
    socket.once('open', () => { transportOpen = true; });
    this.deadline = setTimeout(() => {
      if (generation === this.generation) this.fail(saved?.token && !transportOpen ? 'The TV is not ready yet.' : 'Pairing timed out. Turn on the TV and select Allow. If no prompt appears, check its Device Connection Manager.',Boolean(saved?.token) && !transportOpen);
    }, this.pairingTimeout);
    socket.on('message', raw => {
      if (generation !== this.generation) return;
      let event; try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.event === 'ms.channel.connect' && this.state === 'connecting') {
        // Tests inject a transport with an explicitly supplied mock certificate.
        const certificate = fingerprint ?? socket.testCertificate;
        if (!certificate) return this.fail('The TV certificate could not be checked. Reconnect to try again.');
        const token = event.data?.token;
        try {
          this.store.update({pairing:{address:profile.address,certificate,clientName,token:typeof token === 'string' || typeof token === 'number' ? String(token).slice(0,4096) : saved?.token}});
        } catch { return this.fail('The TV approved this remote, but pairing could not be saved on the PC. Check the helper’s data folder.'); }
        clearTimeout(this.deadline); this.retryCount = 0; this.state = 'connected'; this.message = '';
        this.heartbeat = setInterval(() => {
          if (this.pongDeadline || generation !== this.generation) return;
          this.pongDeadline = setTimeout(() => {
            if (generation === this.generation) this.fail('The TV stopped responding.',true);
          },5000);
          try { socket.ping(); } catch { this.fail('The TV connection was lost.',true); }
        },this.heartbeatMs);
      } else if (event.event === 'ms.channel.unauthorized') {
        this.fail('The TV declined this remote. Remove its blocked entry in Device Connection Manager, reconnect, and select Allow.');
      } else if (event.event === 'ms.remote.imeStart') this.keyboardActive = true;
      else if (event.event === 'ms.remote.imeEnd') this.keyboardActive = false;
      else if (event.event === 'ed.installedApp.get' && this.state === 'connected') {
        this.apps = parseApps(event.data); this.loadingApps = false; clearTimeout(this.appDeadline);
        this.appStatus = this.apps.length ? 'available' : 'unavailable';
      } else if (event.event === 'ms.error') this.message = 'The TV rejected a request. This feature may not work on the current TV screen.';
    });
    socket.on('pong', () => { if (generation === this.generation) { clearTimeout(this.pongDeadline); this.pongDeadline = null; } });
    socket.on('error', error => {
      if (generation !== this.generation) return;
      this.fail(error.code === 'CERT_CHANGED' ? error.message : 'Could not reach the TV. Check its address and power, and keep the PC and TV on the same home network. A VPN or guest network may block local connections.',error.code !== 'CERT_CHANGED');
    });
    socket.on('close', () => {
      if (generation === this.generation) this.fail('The TV connection closed.',true);
    });
  }
  async send(payloads) {
    if (this.state !== 'connected' || !this.socket) throw new RemoteError('Connect to the TV before using its controls.',409);
    if (this.pending >= 12) throw new RemoteError('The TV is busy. Wait a moment and try again.',429);
    const generation = this.generation, socket = this.socket;
    this.pending++;
    const task = this.tail.catch(() => {}).then(async () => {
      for (const payload of payloads) {
        if (generation !== this.generation || this.state !== 'connected') throw new RemoteError('The connection changed. Try the action again after reconnecting.',409);
        await new Promise((resolve,reject) => {
          const deadline = setTimeout(() => reject(new RemoteError('The command timed out. Reconnect before trying again.',504)),3000);
          socket.send(JSON.stringify(payload), error => { clearTimeout(deadline); error ? reject(new RemoteError('The command could not be sent. Reconnect and try again.',502)) : resolve(); });
        });
        await new Promise(resolve => setTimeout(resolve,80));
      }
    }).catch(error => {
      if (generation === this.generation && [502,504].includes(error.status)) this.fail(error.message,true);
      throw error;
    }).finally(() => { if (generation === this.generation) this.pending--; });
    this.tail = task;
    return task;
  }
  async key(key) {
    if(key!=='KEY_POWEROFF'){await this.send([keyPayload(key)]);return;}
    if(this.poweringOff||this.waking)throw new RemoteError('A power request is already in progress.',409);
    if(this.state!=='connected')throw new RemoteError('Connect to the TV before turning it off.',409);
    const generation=this.generation;
    this.poweringOff=true;
    try{
      const state=await this.powerStatus(this.store.data.profile.address);
      if(generation!==this.generation)throw new RemoteError('The connection changed. Try again.',409);
      if(state==='off'||state==='standby'){
        this.disconnect('The TV reports standby. Use Wake TV to turn it on.');
        throw new RemoteError('The TV is already in standby. Use Wake TV to turn it on.',409);
      }
      if(state!=='on')throw new RemoteError('Could not verify the TV’s power state. Try again once the TV is reachable.',502);
      const payload=keyPayload('KEY_POWEROFF');
      // Modern Samsung WebSocket TVs use KEY_POWER. Never replay this toggle.
      payload.params.DataOfCmd='KEY_POWER';
      await this.send([payload]);
      if(generation===this.generation)this.fail('Power-off request sent. Waiting for the TV.',true);
    }finally{this.poweringOff=false;}
  }
  async text(text) { await this.send(textPayloads(text)); }
  async launch(app) {
    if(this.launchingApp)throw new RemoteError('An app is already opening. Wait a moment.',429);
    const generation=this.generation;
    const ensureCurrent=()=>{if(generation!==this.generation||this.state!=='connected')throw new RemoteError('Connect to the TV before opening apps.',409);};
    ensureCurrent();this.launchingApp=true;
    try{return await launchApp(app,{address:this.store.data.profile.address,request:this.appTransport,ensureCurrent,
      fallback:async resolved=>{ensureCurrent();await this.send([launchPayload(resolved)]);return {appID:resolved.appID,verified:false,message:'Launch request sent. This TV did not confirm whether the app opened.'};}});
    }finally{this.launchingApp=false;}
  }
  async fetchApps() {
    if (this.loadingApps) return;
    this.apps = []; this.loadingApps = true; this.appStatus = 'loading';
    const generation = this.generation;
    try {
      await this.send([appsPayload]);
      if (generation !== this.generation || !this.loadingApps) return;
      this.appDeadline = setTimeout(() => { if (generation !== this.generation) return; this.loadingApps = false; this.appStatus = 'unavailable'; },this.appTimeout);
    } catch (error) { if (generation === this.generation) { this.loadingApps = false; this.appStatus = 'unavailable'; } throw error; }
  }
  async wake() {
    const profile = this.store.data.profile;
    if (!profile) throw new RemoteError('Save a TV first.');
    if(this.waking||this.poweringOff)throw new RemoteError('A power request is already in progress.',409);
    this.waking=true;
    try{
      const initialGeneration=this.generation;
      await this.wakeTransport(profile);
      if(initialGeneration!==this.generation)return;
      if(this.hasSavedPairing()&&this.state!=='connected')this.connect();
      const generation=this.generation,end=Date.now()+this.wakeConnectTimeout;
      while(this.state==='connecting'&&Date.now()<end&&generation===this.generation){
        await new Promise(resolve=>setTimeout(resolve,80));
      }
      if(generation!==this.generation||this.state!=='connected')return;
      const power=await this.powerStatus(profile.address);
      if(generation!==this.generation||this.state!=='connected')return;
      if(power==='off'||power==='standby'){
        const payload=keyPayload('KEY_POWEROFF');
        payload.params.DataOfCmd='KEY_POWER';
        await this.send([payload]);
      }
    }finally{this.waking=false;}
  }
}
