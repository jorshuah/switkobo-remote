import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),publicRoot=path.join(root,'public');
const assets=['/','/index.html','/style.css','/app.js','/pwa.js','/updates.js','/cast.js','/movies.js','/library.js','/pickers.js','/subtitles.js','/icon.svg','/manifest.webmanifest','/qr-reader.js','/qr-worker.js','/vendor/jsQR.js','/app-version.json'];
for(const folder of ['icons','brands','app-icons'])for(const name of(await fs.readdir(path.join(publicRoot,folder))).sort())if(name.endsWith('.svg')||name.endsWith('.png'))assets.push('/'+folder+'/'+name);
const indexFile=path.join(publicRoot,'index.html'),workerFile=path.join(publicRoot,'service-worker.js'),normalizeIndex=s=>s.replace(/(<meta name="app-build" content=")[^"]*(">)/,'$1__APP_BUILD__$2');
const index=normalizeIndex(await fs.readFile(indexFile,'utf8'));let worker=await fs.readFile(workerFile,'utf8');const hash=createHash('sha256');
assets.push('/stick.js','/stick-controller.js','/volume.js','/notifications.js');
for(const asset of assets){if(asset==='/app-version.json')continue;hash.update(asset==='/'||asset==='/index.html'?index:await fs.readFile(path.join(publicRoot,asset.slice(1))));}
hash.update(worker.replace(/^const CACHE=.*;$/m,'const CACHE="BUILD";').replace(/^const ASSETS=.*;$/m,'const ASSETS=[];'));
const version=hash.digest('hex').slice(0,12);
await fs.writeFile(indexFile,index.replace('__APP_BUILD__',version));await fs.writeFile(path.join(publicRoot,'app-version.json'),JSON.stringify({version})+'\n');
worker=worker.replace(/^const CACHE=.*;$/m,"const CACHE='switkobo-shell-"+version+"';").replace(/^const ASSETS=.*;$/m,'const ASSETS='+JSON.stringify(assets)+';');await fs.writeFile(workerFile,worker);
console.log('Built offline shell for '+assets.length+' public assets ('+version+').');
