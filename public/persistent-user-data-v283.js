(function(){
'use strict';
if(window.__CouteauUserDataSafetyLoaded)return;window.__CouteauUserDataSafetyLoaded=true;

var DB='couteau_suisse_user_data_v1',STORE='snapshots',DOCSTORE='document_backups';
var ROW='persistent-user-data-v364';
var LEGACY_ROW='addresses-quotes-v1';
var DOC_DB='carplayDocuments',DOC_FILES='files';
var opening=null,saveTimer=0,docTimer=0;

var EXACT={
  'saved_market_addresses':1,'saved_market_addresses_be':1,
  'generic_client_documents':1,'professional_signature_v1':1,'generic_company_logo':1,
  'custom_quote_templates_v1':1,'custom_quote_company_v2':1,
  'monSiretEntreprise':1,'monLienAssuranceParapluie':1,
  'belgiumVat.lastDone':1,'belgiumVat.nextDue':1,
  'event_reg_address':1,'profession':1,'market_trade':1,'gps_pref':1,
  'return_address':1,'return_full_address':1,'return_lat':1,'return_lon':1,
  'return_nearby':1,'return_saved_at':1,'return_context_v231':1,'return_context_updated_at':1,
  'carplay_app_identity_v240':1,'carplay_recovery_email':1,'carplay_subscription_email':1,
  'carplay_shared_subscription':1,'carplay_device_id':1
};
var PREFIX=[
  'saved_','return_','address_','event_reg_','custom_quote_','generic_client_','generic_company_',
  'professional_','belgiumVat.','marketLocalLocationV1:','user_point_','saved_point_','coin_','mushroom_'
];
function keepKey(k){
  k=String(k||'');
  if(EXACT[k])return true;
  for(var i=0;i<PREFIX.length;i++)if(k.indexOf(PREFIX[i])===0)return true;
  return false;
}
function openDb(){
  if(opening)return opening;
  opening=new Promise(function(resolve,reject){
    try{
      var r=indexedDB.open(DB,2);
      r.onupgradeneeded=function(){
        var d=r.result;
        if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE);
        if(!d.objectStoreNames.contains(DOCSTORE))d.createObjectStore(DOCSTORE);
      };
      r.onsuccess=function(){resolve(r.result)};
      r.onerror=function(){reject(r.error)};
    }catch(e){reject(e)}
  });
  return opening;
}
function snapshot(){
  var out={savedAt:Date.now(),values:{}};
  try{
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(keepKey(k)){
        var v=localStorage.getItem(k);
        if(v!==null)out.values[k]=v;
      }
    }
  }catch(_){}
  return out;
}
async function saveNow(){
  try{
    var db=await openDb(),tx=db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(snapshot(),ROW);
  }catch(_){}
}
function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,180)}
async function getRow(db,key){
  return new Promise(function(resolve,reject){
    try{var r=db.transaction(STORE,'readonly').objectStore(STORE).get(key);r.onsuccess=function(){resolve(r.result||null)};r.onerror=function(){reject(r.error)}}catch(e){reject(e)}
  });
}
async function restoreMissing(){
  try{
    var db=await openDb(),row=await getRow(db,ROW);
    if(!row)row=await getRow(db,LEGACY_ROW);
    if(!row||!row.values)return;
    var restored=false;
    Object.keys(row.values).forEach(function(k){
      if(keepKey(k)&&localStorage.getItem(k)===null){
        localStorage.setItem(k,row.values[k]);restored=true;
      }
    });
    if(restored)window.dispatchEvent(new CustomEvent('couteau-user-data-restored'));
  }catch(_){}
}
function openDocumentsDb(){
  return new Promise(function(resolve,reject){
    try{
      var r=indexedDB.open(DOC_DB,1);
      r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains(DOC_FILES))r.result.createObjectStore(DOC_FILES)};
      r.onsuccess=function(){resolve(r.result)};
      r.onerror=function(){reject(r.error)};
    }catch(e){reject(e)}
  });
}
function readAllDocuments(db){
  return new Promise(function(resolve,reject){
    var rows=[];
    try{
      if(!db.objectStoreNames.contains(DOC_FILES)){resolve(rows);return}
      var tx=db.transaction(DOC_FILES,'readonly'),r=tx.objectStore(DOC_FILES).openCursor();
      r.onsuccess=function(){var c=r.result;if(!c){resolve(rows);return}rows.push({key:c.key,value:c.value});c.continue()};
      r.onerror=function(){reject(r.error)};
    }catch(e){reject(e)}
  });
}
function readAllBackupDocuments(db){
  return new Promise(function(resolve,reject){
    var rows=[];
    try{
      var tx=db.transaction(DOCSTORE,'readonly'),r=tx.objectStore(DOCSTORE).openCursor();
      r.onsuccess=function(){var c=r.result;if(!c){resolve(rows);return}rows.push({key:c.key,value:c.value});c.continue()};
      r.onerror=function(){reject(r.error)};
    }catch(e){reject(e)}
  });
}
async function backupDocuments(){
  try{
    var docs=await openDocumentsDb(),rows=await readAllDocuments(docs),safe=await openDb();
    await new Promise(function(resolve,reject){
      try{
        var tx=safe.transaction(DOCSTORE,'readwrite'),st=tx.objectStore(DOCSTORE);st.clear();
        rows.forEach(function(x){st.put(x.value,x.key)});
        tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)};
      }catch(e){reject(e)}
    });
  }catch(_){}
}
async function restoreDocuments(){
  try{
    var safe=await openDb(),backup=await readAllBackupDocuments(safe);if(!backup.length)return;
    var docs=await openDocumentsDb(),current=await readAllDocuments(docs),have={};
    current.forEach(function(x){have[String(x.key)]=1});
    var missing=backup.filter(function(x){return !have[String(x.key)]});if(!missing.length)return;
    await new Promise(function(resolve,reject){
      try{
        var tx=docs.transaction(DOC_FILES,'readwrite'),st=tx.objectStore(DOC_FILES);
        missing.forEach(function(x){st.put(x.value,x.key)});
        tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)};
      }catch(e){reject(e)}
    });
    window.dispatchEvent(new CustomEvent('couteau-user-documents-restored'));
  }catch(_){}
}
function scheduleDocuments(){clearTimeout(docTimer);docTimer=setTimeout(backupDocuments,350)}

var nativeSet=Storage.prototype.setItem,nativeRemove=Storage.prototype.removeItem;
Storage.prototype.setItem=function(k,v){nativeSet.call(this,k,v);if(this===localStorage&&keepKey(k))scheduleSave()};
Storage.prototype.removeItem=function(k){nativeRemove.call(this,k);if(this===localStorage&&keepKey(k))scheduleSave()};

Promise.resolve().then(restoreMissing).then(restoreDocuments).then(function(){return Promise.all([saveNow(),backupDocuments()])});
window.addEventListener('pagehide',function(){saveNow();backupDocuments()});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){saveNow();backupDocuments()}});
window.addEventListener('couteau-user-data-changed',function(){scheduleSave();scheduleDocuments()});
window.CouteauUserDataSafety={save:function(){return Promise.all([saveNow(),backupDocuments()])},restore:function(){return Promise.all([restoreMissing(),restoreDocuments()])},keys:Object.keys(EXACT),keeps:keepKey};
})();
