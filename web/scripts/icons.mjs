import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const names=['settings','bell','power','chevron-up','chevron-down','chevron-left','chevron-right','corner-up-left','house','panels-top-left','volume-x','plus','minus','play','pause','rewind','keyboard','grid-2x2','sliders-horizontal','joystick','tv','wifi','wifi-off','x','arrow-left','hand','check','external-link','scan-qr-code','camera','image','search','film','refresh-cw','rotate-ccw','rotate-cw','star'];
fs.mkdirSync(path.join(root,'public','icons'),{recursive:true});
for(const name of names) fs.copyFileSync(path.join(root,'node_modules','lucide-static','icons',name+'.svg'),path.join(root,'public','icons',name+'.svg'));
fs.copyFileSync(path.join(root,'node_modules','lucide-static','LICENSE'),path.join(root,'public','icons','LICENSE'));
