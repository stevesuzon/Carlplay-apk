(function(){
'use strict';
if(window.__CouteauUserDataSafetyLoaded)return;window.__CouteauUserDataSafetyLoaded=true;
var DB='couteau_suisse_user_data_v1',STORE='snapshots',ROW='addresses-quotes-v1';
var KEYS=['saved_market_addresses','saved_market_addresses_be','generic_client_documents','professional_signature_v1','generic_company_logo','custom_quote_templates_v1','custom_quote_company_v2'];
var opening=null,saveTimer=0;
function openDb(){if(opening)return opening;opening=new Promise(function(resolve,reject){try{var r=indexedDB.open(DB,1);r.onupgradeneeded=function(){var d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE)};r.onsuccess=function(){resolve(r.result)};r.onerror=function(){reject(r.error)}}catch(e){reject(e)}});return opening}
function snapshot(){var out={savedAt:Date.now(),values:{}};KEYS.forEach(function(k){var v=localStorage.getItem(k);if(v!==null)out.values[k]=v});return out}
async function saveNow(){try{var db=await openDb(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(snapshot(),ROW)}catch(_){}}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,250)}
async function restoreMissing(){try{var db=await openDb(),row=await new Promise(function(resolve,reject){var tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(ROW);r.onsuccess=function(){resolve(r.result||null)};r.onerror=function(){reject(r.error)}});if(!row||!row.values)return;var restored=false;KEYS.forEach(function(k){if(localStorage.getItem(k)===null&&Object.prototype.hasOwnProperty.call(row.values,k)){localStorage.setItem(k,row.values[k]);restored=true}});if(restored)window.dispatchEvent(new CustomEvent('couteau-user-data-restored'))}catch(_){}}
var nativeSet=Storage.prototype.setItem,nativeRemove=Storage.prototype.removeItem;
Storage.prototype.setItem=function(k,v){nativeSet.call(this,k,v);if(this===localStorage&&KEYS.indexOf(String(k))>=0)scheduleSave()};
Storage.prototype.removeItem=function(k){nativeRemove.call(this,k);if(this===localStorage&&KEYS.indexOf(String(k))>=0)scheduleSave()};
restoreMissing().then(saveNow);window.addEventListener('pagehide',saveNow);document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')saveNow()});
window.CouteauUserDataSafety={save:saveNow,restore:restoreMissing,keys:KEYS.slice()};
})();