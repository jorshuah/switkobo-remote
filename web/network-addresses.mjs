import os from 'node:os';
export function networkAddresses(){
 return [...new Set(Object.values(os.networkInterfaces()).flat().filter(n=>n?.family==='IPv4'&&!n.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address)).map(n=>n.address))];
}
