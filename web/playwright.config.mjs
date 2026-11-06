import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./test/ui',fullyParallel:false,workers:1,timeout:30000,
 use:{baseURL:'http://127.0.0.1:48866',trace:'retain-on-failure'},
 webServer:[
  {command:'node test/ui-server.mjs',url:'http://127.0.0.1:48866',reuseExistingServer:false},
  {command:'node test/setup-ui-server.mjs',url:'http://127.0.0.1:48869/connect/',reuseExistingServer:false},
 ],
 projects:[
  {name:'webkit-iphone',use:{...devices['iPhone 13'],defaultBrowserType:'webkit'}},
  {name:'chromium-android',testMatch:['**/stick.spec.mjs','**/volume-hold.spec.mjs','**/pwa.spec.mjs','**/updates.spec.mjs','**/notifications.spec.mjs','**/toasts.spec.mjs','**/cast.spec.mjs','**/subtitles.spec.mjs','**/cast-opening.spec.mjs','**/movies.spec.mjs','**/ratings.spec.mjs','**/sheet-touch.spec.mjs','**/series.spec.mjs','**/aether.spec.mjs','**/preview-loading.spec.mjs','**/library.spec.mjs','**/history-navigation.spec.mjs','**/pickers.spec.mjs','**/motion.spec.mjs','**/motion-interrupt.spec.mjs','**/motion-continuity.spec.mjs','**/setup-flow.spec.mjs'],use:{...devices['Pixel 7'],defaultBrowserType:'chromium'}},
  {name:'chromium-desktop',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:900}}},
 ],
});
