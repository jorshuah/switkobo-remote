(()=>{
 const button=document.querySelector('#install-app');if(!button)return;
 let promptEvent=null,workerError=false;
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const update=()=>{button.hidden=standalone();};
 update();matchMedia('(display-mode: standalone)').addEventListener('change',update);
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;});
 window.addEventListener('appinstalled',()=>{promptEvent=null;button.hidden=true;if(sheetKind==='install'&&sheet.open)sheet.close();});
 if(typeof navigator.serviceWorker?.register==='function'&&window.isSecureContext){
  window.remoteUpdateRegistration=navigator.serviceWorker.register('/service-worker.js',{scope:'/',updateViaCache:'none'}).catch(()=>{workerError=true;return null;});
 }
 button.onclick=()=>{
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(!window.isSecureContext){
   const port=snapshot?.installation?.httpsPort;
   openSheet('install','Install on your phone','<p class="sheet-intro">Use the secure connection to install TV Remote as an app.</p>'+
    (port?'<p>First, follow the one-time certificate setup from your PC’s connection page.</p><p><a class="install-link" href="/setup/">Phone certificate instructions</a></p><button id="open-secure-remote" class="primary wide">Open secure remote</button>':'<p>On your PC, double-click <strong>Enable Secure Remote.cmd</strong>, then follow its phone setup instructions.</p>')+
    '<p class="help">Your PC still needs to stay awake for TV control.</p>');
   const secureButton=document.querySelector('#open-secure-remote');
   if(secureButton)secureButton.onclick=()=>{
    const target=new URL(location.href);target.protocol='https:';target.port=String(port);target.pathname='/';target.search='';target.hash='access='+access;
    location.assign(target.href);
   };
   return;
  }
  openSheet('install','Install TV Remote',
   '<img class="install-app-mark" src="/app-icons/tv-remote-192.png" alt="">'+
   (promptEvent?'<p class="sheet-intro">Add the remote to your home screen and open it in its own app window.</p><button id="confirm-install" class="primary wide">Install app</button>':
     '<p class="sheet-intro">'+(ios?'In Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if it appears.':'In Chrome, open the browser menu and choose Install app or Add to Home screen. If installation is not offered, keep using the remote and check again.')+'</p>')+
   (workerError?'<p class="help">Offline app support could not start. Refresh the page before installing.</p>':'')+
   '<p class="help">Your PC still needs to stay awake for TV control.</p>');
  const confirm=document.querySelector('#confirm-install');
  if(confirm)confirm.onclick=async()=>{
   const install=promptEvent;promptEvent=null;confirm.disabled=true;
   try{await install.prompt();const choice=await install.userChoice;if(choice.outcome==='accepted'){sheet.close();notify('Installation requested.');}else{confirm.disabled=false;confirm.textContent='Install later';confirm.onclick=()=>sheet.close();}}catch{confirm.disabled=false;notify('Use your browser menu to install this app.');}
  };
 };
})();
