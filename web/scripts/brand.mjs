import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mark="<g transform=\"rotate(-16 256 256)\"><rect x=\"180\" y=\"100\" width=\"152\" height=\"312\" rx=\"58\" fill=\"#f6f6f6\"/><path d=\"M256 135v19M242 145a20 20 0 1 0 28 0\" fill=\"none\" stroke=\"#202020\" stroke-width=\"9\" stroke-linecap=\"round\"/><circle cx=\"256\" cy=\"234\" r=\"40\" fill=\"#202020\"/><circle cx=\"256\" cy=\"234\" r=\"11\" fill=\"#f6f6f6\"/><path d=\"m250 208 6-6 6 6m-12 52 6 6 6-6m-32-32-6 6 6 6m52-12 6 6-6 6\" fill=\"none\" stroke=\"#f6f6f6\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"216\" y=\"304\" width=\"28\" height=\"57\" rx=\"14\" fill=\"#202020\"/><rect x=\"268\" y=\"304\" width=\"28\" height=\"57\" rx=\"14\" fill=\"#202020\"/></g>";
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="face" x2=".25" y2="1"><stop stop-color="#333333"/><stop offset="1" stop-color="#151515"/></linearGradient></defs><rect width="512" height="512" fill="url(#face)"/>'+mark+'</svg>';
await fs.mkdir(path.join(root,'public','app-icons'),{recursive:true});
await fs.writeFile(path.join(root,'public','icon.svg'),svg);
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({deviceScaleFactor:1});
 for(const [name,size] of [['tv-remote-192',192],['tv-remote-512',512],['tv-remote-maskable-192',192],['tv-remote-maskable-512',512],['tv-remote-apple-180',180],['tv-remote-favicon-32',32]]){
  await page.setViewportSize({width:size,height:size});
  await page.setContent('<html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>'+svg+'</html>');
  await page.screenshot({path:path.join(root,'public','app-icons',name+'.png')});
 }
}finally{await browser.close();}
