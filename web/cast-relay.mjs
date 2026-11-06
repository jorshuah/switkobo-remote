import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import ffmpeg from 'ffmpeg-static';
import {RemoteError} from './protocol.mjs';

// Start the converter while the current TV stream is still healthy. Its paused
// stdout and OS pipes provide bounded backpressure until the TV requests it.
export function createMediaRelay({source,index,offset,subtitleDirectory,spawnProcess=spawn,timeout=20000,initialBurst=12,onDiagnostic=()=>{}}){
 // Allow the receiver to fill its startup buffer without waiting for the
 // real-time input clock. Backpressure still bounds memory while it connects.
 const inputOptions=playlist=>['-probesize','2000000','-analyzeduration','1000000','-re','-readrate_initial_burst',String(initialBurst),'-f',playlist.init?'mov':'mpegts'];
 const audio=source.audioPlaylist,audioIndex=audio?Math.max(0,audio.segments.findLastIndex(s=>s.start<=offset)):0;
 const encoding=subtitleDirectory?['-vf','subtitles=captions.srt','-c:v','libx264','-preset','veryfast','-crf','21','-c:a','copy']:['-c','copy'];
 const child=spawnProcess(ffmpeg,['-hide_banner','-loglevel','error','-protocol_whitelist','pipe',...inputOptions(source.playlist),'-i','pipe:0',...(audio?['-isync','0',...inputOptions(audio),'-i','pipe:3']:[]),'-map','0:v:0','-map',audio?'1:a:0':'0:a:0',...encoding,'-avoid_negative_ts','make_zero','-muxdelay','0','-flush_packets','1','-f','mpegts','pipe:1'],{windowsHide:true,cwd:subtitleDirectory||undefined,stdio:audio?['pipe','pipe','pipe','pipe']:['pipe','pipe','pipe']});
 const output=child.stdout,inputs=[];let closed=false,settled=false,resolveReady,rejectReady,reason='converter-failed',stderrTail='';
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const failure=()=>new RemoteError('The replacement video could not be prepared. Try again or choose a lower video quality.');
 const diagnostic=event=>{try{onDiagnostic(event);}catch{}};
 const timer=setTimeout(()=>{reason='converter-timeout';close(failure());},timeout);timer.unref?.();
 function settle(error){if(settled)return;settled=true;clearTimeout(timer);output.off('readable',available);output.off('end',ended);if(error)rejectReady(error);else resolveReady();}
 function available(){if(output.readableLength>0)settle();}
 function ended(){if(!settled)close(failure());}
 function close(error){if(closed)return;closed=true;if(error)diagnostic({event:reason});settle(error||failure());for(const stream of inputs)stream.destroy();child.kill();output.destroy();stderrTail='';}
 // Keep only a bounded, transient classifier input. Never expose raw stderr:
 // it can contain signed upstream URLs, paths and subtitle dialogue.
 child.stderr.on('data',bytes=>{stderrTail=(stderrTail+bytes.toString()).slice(-8192);if(/invalid data|corrupt|decode_slice|error while decoding/i.test(stderrTail))reason='invalid-media';else if(/subtitles|libass|filter.*failed/i.test(stderrTail))reason='subtitle-converter-failed';else if(/non.monoton|timestamp|dts.*out of order/i.test(stderrTail))reason='invalid-timestamps';else if(/out of memory|cannot allocate/i.test(stderrTail))reason='converter-memory';});
 child.on('error',()=>{reason='converter-unavailable';close(new RemoteError('The playback converter is unavailable. Run Setup Playback.cmd on your PC.'));});
 child.on('exit',code=>{if(!closed&&(code!==0||!settled)){diagnostic({event:'converter-exit',code:Number.isInteger(code)?code:null});close(failure());}});
 output.on('error',()=>close(failure()));output.on('readable',available);output.on('end',ended);
 const feed=(playlist,start,destination)=>{const stream=Readable.from(source.trackStream(playlist,start));inputs.push(stream);void pipeline(stream,destination).catch(error=>{if(!closed){reason=error.sourceStatus?'source-http-failed':'source-pipe-failed';diagnostic({event:reason,status:error.sourceStatus});close(failure());}});};
 feed(source.playlist,index,child.stdin);if(audio)feed(audio,audioIndex,child.stdio[3]);
 return {child,output,ready,close,get closed(){return closed;}};
}
