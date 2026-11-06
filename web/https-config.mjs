import fs from 'node:fs';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
export function loadHTTPS(directory){
 const folder=path.join(directory,'https'),file=path.join(folder,'https.json');
 if(!fs.existsSync(file))return null;
 const meta=JSON.parse(fs.readFileSync(file,'utf8'));
 if(meta.version!==1||typeof meta.password!=='string'||!Array.isArray(meta.addresses)||Date.parse(meta.expires)<=Date.now())throw new Error('Local HTTPS certificates need renewal. Run Enable Secure Remote.cmd.');
 const ca=fs.readFileSync(path.join(folder,'root.cer')),certificate=new X509Certificate(ca);
 if(!certificate.ca)throw new Error('The local HTTPS root certificate is invalid.');
 return {port:48766,addresses:meta.addresses,expires:meta.expires,certificate:ca,fingerprint:certificate.fingerprint256,certificateName:certificate.subject.split('\n').find(line=>line.startsWith('CN='))?.slice(3)||'TV Remote Local CA',
   tlsOptions:{pfx:fs.readFileSync(path.join(folder,'server.pfx')),passphrase:meta.password,minVersion:'TLSv1.2'}};
}
export function appleCertificateProfile(config){
 const id=config.fingerprint.replaceAll(':','').slice(0,32);
 const uuid=id.slice(0,8)+'-'+id.slice(8,12)+'-'+id.slice(12,16)+'-'+id.slice(16,20)+'-'+id.slice(20);
 return '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>com.switkobo.remote.localca</string><key>PayloadUUID</key><string>'+uuid+'</string><key>PayloadDisplayName</key><string>TV Remote local certificate</string><key>PayloadDescription</key><string>Installs your PC’s local root certificate for TV Remote HTTPS. Enable SSL trust separately in Certificate Trust Settings.</string><key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.security.root</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>com.switkobo.remote.localca.certificate</string><key>PayloadUUID</key><string>'+uuid.slice(0,-1)+(uuid.endsWith('0')?'1':'0')+'</string><key>PayloadDisplayName</key><string>TV Remote local certificate</string><key>PayloadCertificateFileName</key><string>TV-Remote-CA.cer</string><key>PayloadContent</key><data>'+config.certificate.toString('base64')+'</data></dict></array></dict></plist>';
}
export {phoneSetupPage} from './phone-setup-page.mjs';
