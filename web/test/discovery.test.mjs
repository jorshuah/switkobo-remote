import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {discoverTVs,parseTVInfo} from '../discovery.mjs';

test('discovery accepts Samsung TV metadata only and normalizes wake details',()=>{
  assert.equal(parseTVInfo({device:{manufacturer:'Other',type:'Samsung SmartTV'}},'192.168.0.20'),null);
  assert.throws(()=>parseTVInfo({},'127.0.0.1'));
  assert.equal(parseTVInfo({device:{type:'Samsung SmartTV',modelName:'QE65Q65BAUXXN'}},'192.168.0.20').model,'QE65Q65BAUXXN');
  assert.deepEqual(parseTVInfo({device:{manufacturer:'Samsung Electronics',type:'Samsung SmartTV',name:'Living room',modelName:'Q65B',wifiMac:'a0-b1-c2-d3-e4-f5'}},'192.168.0.20'),
    {name:'Living room',model:'Q65B',address:'192.168.0.20',mac:'A0:B1:C2:D3:E4:F5'});
});
test('discovery deduplicates private responders, ignores LOCATION URLs, closes sockets and caps work',async()=>{
  const probed=[],sockets=[];
  class Socket extends EventEmitter{
    bind(port,address,cb){queueMicrotask(cb);}
    setMulticastTTL(){}setMulticastInterface(){}
    send(){
      for(const address of ['192.168.0.20','192.168.0.20','8.8.8.8','127.0.0.1','192.168.0.21']){
        this.emit('message',Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: http://evil.example/private'),{address});
      }
    }
    close(){this.closed=true;}
  }
  const devices=await discoverTVs({addresses:['192.168.0.10'],savedAddress:'192.168.0.20',duration:15,
    socketFactory:()=>{const s=new Socket();sockets.push(s);return s;},
    probe:async address=>{probed.push(address);return address.endsWith('.20')?{name:'TV',address}:null;}});
  assert.deepEqual(probed,['192.168.0.20','192.168.0.21']);
  assert.equal(devices.length,1);assert.equal(sockets[0].closed,true);
});
