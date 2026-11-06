import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionKey} from '../public/qr-reader.js';
test('connection QR accepts only a correctly shaped link to this helper',()=>{
 const origin='http://192.168.0.151:48765',key='a'.repeat(64);
 assert.equal(connectionKey(origin+'/#access='+key,origin),key);
 for(const value of ['hello',key,origin+'/#access=bad',origin+'/other#access='+key,origin+'/?redirect=evil#access='+key,origin+'/#access='+key+'&access='+key,origin+'/#access='+key+'&other=1','http://user@192.168.0.151:48765/#access='+key,'javascript:alert(1)','https://example.com/#access='+key]){
  assert.throws(()=>connectionKey(value,origin));
 }
});
