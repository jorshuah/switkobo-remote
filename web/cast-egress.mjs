import http from 'node:http';import net from 'node:net';import {lookup} from 'node:dns/promises';import {randomBytes,timingSafeEqual} from 'node:crypto';import {publicIP} from './cast-source.mjs';
export async function destination(authority,resolve=lookup){
 if(typeof authority!=='string'||!/^([a-zA-Z0-9.-]{1,253}):443$/.test(authority))throw Error('Destination rejected');
 const host=authority.slice(0,-4);if(!host.includes('.')||/\.(local|localhost|lan|internal)$/i.test(host))throw Error('Destination rejected');
 const records=net.isIP(host)?[{address:host}]:await resolve(host,{all:true});
 if(!records.length||!records.every(r=>publicIP(r.address)))throw Error('Destination rejected');
 const address=records.find(r=>net.isIP(r.address)===4)?.address;if(!address)throw Error('IPv4 source required');return {host,address};
}
// A tunnel, not a TLS-intercepting proxy. DNS is checked then pinned to the actual
// TCP connection, preventing rebinding between the browser's DNS and our check.
export async function browserEgress({resolve=lookup,connect=options=>net.connect(options)}={}){
 const username='remote',password=randomBytes(24).toString('hex'),authorization='Basic '+Buffer.from(username+':'+password).toString('base64');
 const sockets=new Set();let closed=false;
 const server=http.createServer((req,res)=>{res.writeHead(403).end();});server.maxConnections=64;
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});});
 server.on('connect',async(req,client,head)=>{
  const supplied=Buffer.from(req.headers['proxy-authorization']||''),expected=Buffer.from(authorization);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="TV Remote"\r\nContent-Length: 0\r\n\r\n');return;}
  try{
   const {address}=await destination(req.url,resolve);if(closed||client.destroyed){client.destroy();return;}
   const upstream=connect({host:address,port:443});sockets.add(upstream);upstream.setTimeout(45000,()=>upstream.destroy());
   upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());upstream.on('close',()=>{sockets.delete(upstream);client.destroy();});
   upstream.once('connect',()=>{if(closed||client.destroyed){upstream.destroy();return;}client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);});
  }catch{client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {proxy:{server:'http://127.0.0.1:'+server.address().port,username,password},close(){closed=true;for(const socket of sockets)socket.destroy();server.close();}};
}
