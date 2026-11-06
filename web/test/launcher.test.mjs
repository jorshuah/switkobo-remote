import test from 'node:test';
import assert from 'node:assert/strict';
import {launcherPage} from '../launcher-page.mjs';
test('private launcher separates phone QR from local-only access and exposes a copy control',()=>{
 const url='http://192.168.0.151:48765/#access='+'a'.repeat(64);
 const html=launcherPage([{url,qr:'data:image/png;base64,test'}],'http://127.0.0.1:48765/#access='+'a'.repeat(64));
 assert.match(html,/Copy private link/);
 assert.match(html,/readonly value="http:\/\/192\.168\.0\.151/);
 assert.match(html,/127\.0\.0\.1:48765\/connect\//);
 assert.equal((html.match(/class="qr"/g)||[]).length,1);
 assert.match(html,/Open the remote on this PC/);
 assert.match(launcherPage([],'http://127.0.0.1:48765/'),/Waiting for Wi-Fi/);
});
