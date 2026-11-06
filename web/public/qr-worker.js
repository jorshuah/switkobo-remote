importScripts('/vendor/jsQR.js');
self.onmessage=event=>{
  try{
    const {pixels,width,height}=event.data;
    const result=jsQR(pixels,width,height,{inversionAttempts:'attemptBoth'});
    self.postMessage({value:result?.data||null});
  }catch{self.postMessage({error:true});}
};
