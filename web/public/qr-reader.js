// QR photos stay in the browser. Only the decoded access key uses the helper API.
export function connectionKey(value, origin) {
  let url;
  try { url = new URL(value); } catch { throw new Error('This is not a TV Remote connection QR. Use the QR from Start Remote on your PC.'); }
  const params = new URLSearchParams(url.hash.slice(1)), key = params.get('access');
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search ||
      !/^[a-f0-9]{64}$/.test(key || '') || [...params.keys()].some(name=>name!=='access') || params.getAll('access').length!==1) {
    throw new Error('This is not a TV Remote connection QR. Use the QR from Start Remote on your PC.');
  }
  if (url.origin !== origin) throw new Error('This QR uses a different helper address. Scan it with your iPhone Camera to open that private link, or use the matching QR on your PC.');
  return key;
}
function abortError(){return new DOMException('Scan cancelled.','AbortError');}
async function loadImage(file,signal){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader(),image=new Image();
    const clean=()=>{signal.removeEventListener('abort',abort);reader.onload=reader.onerror=null;image.onload=image.onerror=null;};
    const fail=error=>{clean();reject(error);};
    const abort=()=>{reader.abort();image.removeAttribute('src');fail(abortError());};
    signal.addEventListener('abort',abort,{once:true});
    reader.onerror=()=>fail(new Error('Could not read that photo. Choose another image.'));
    reader.onload=()=>{
      if(signal.aborted)return abort();
      image.onload=()=>{clean();resolve(image);};
      image.onerror=()=>fail(new Error('Could not open that image. Try a JPG or PNG photo of the QR.'));
      image.src=reader.result;
    };
    if(signal.aborted)return abort();
    reader.readAsDataURL(file);
  });
}
function decode(pixels,width,height,signal){
  return new Promise((resolve,reject)=>{
    const worker=new Worker('/qr-worker.js');
    let timer;
    const finish=(error,value)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(value);};
    const abort=()=>finish(abortError());
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>event.data.error?finish(new Error('Could not read that QR image. Try a clearer photo.')):finish(null,event.data.value);
    worker.onerror=()=>finish(new Error('Could not start the QR reader. Refresh the page and try again.'));
    timer=setTimeout(()=>finish(new Error('That photo took too long to scan. Take a closer photo of just the QR.')),12000);
    if(signal.aborted)return abort();
    worker.postMessage({pixels,width,height},[pixels.buffer]);
  });
}
export async function readConnectionPhoto(file,{signal,origin}){
  if(!file || !/^image\//.test(file.type) || file.type==='image/svg+xml')throw new Error('Choose a photo or screenshot of the connection QR.');
  if(file.size>20*1024*1024)throw new Error('That image is too large. Choose an image smaller than 20 MB.');
  if(signal.aborted)throw abortError();
  const image=await loadImage(file,signal);
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50000000)throw new Error('That image is too large to scan. Crop it to the QR code and try again.');
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  try{
    const w=image.naturalWidth,h=image.naturalHeight;
    const attempts=[
      {x:0,y:0,w,h,limit:1600},
      {x:0,y:0,w,h,limit:2400},
      ...[.7,.45].map(fraction=>({x:w*(1-fraction)/2,y:h*(1-fraction)/2,w:w*fraction,h:h*fraction,limit:2000}))
    ];
    const tried=new Set();
    for(const region of attempts){
      if(signal.aborted)throw abortError();
      const scale=Math.min(1,region.limit/Math.max(region.w,region.h));
      const width=Math.max(1,Math.round(region.w*scale)),height=Math.max(1,Math.round(region.h*scale));
      const signature=[region.x,region.y,region.w,region.h,width,height].join();
      if(tried.has(signature))continue;tried.add(signature);
      canvas.width=width;canvas.height=height;
      context.drawImage(image,region.x,region.y,region.w,region.h,0,0,width,height);
      const pixels=context.getImageData(0,0,width,height).data;
      const value=await decode(pixels,width,height,signal);
      if(value)return connectionKey(value,origin);
    }
    throw new Error('No QR code found. Crop the photo to just the QR, keep all four corners visible, and try again. Or use the iPhone Camera to scan the PC directly.');
  }finally{canvas.width=canvas.height=0;image.removeAttribute('src');}
}
