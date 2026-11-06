import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
fs.mkdirSync(path.join(root,'public','vendor'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules','jsqr','dist','jsQR.js'),path.join(root,'public','vendor','jsQR.js'));
fs.copyFileSync(path.join(root,'node_modules','jsqr','LICENSE'),path.join(root,'public','vendor','jsQR.LICENSE'));
