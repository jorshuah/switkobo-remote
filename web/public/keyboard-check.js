'use strict';
// Intentionally independent of app.js, dialogs, gesture listeners and storage.
// DOM focus does not prove that the OS software keyboard appeared.
const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
document.querySelector('#keyboard-context').textContent=standalone?'Running inside the Home Screen app':'Running in the browser';
const keyboardStatus=document.querySelector('#keyboard-check-status');
for(const field of document.querySelectorAll('input,textarea')){
 field.addEventListener('focus',()=>{keyboardStatus.textContent='Field received focus. Check whether the keyboard is visible.';});
 field.addEventListener('input',event=>{keyboardStatus.textContent=event.inputType==='insertFromPaste'?'Paste received. This does not confirm the keyboard opened.':'Text edit received. Check whether the keyboard is visible.';});
}
