// Versioned encryption preserves existing subscription hashes and legacy recovery boxes.
const enc=new TextEncoder();
async function key(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode('carplay-subscription-recovery:'+secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function bytes(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
export async function sealV2(code,env){if(!env.PAYMENT_RECOVERY_SECRET)throw Error('RECOVERY_SECRET_REQUIRED');const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env.PAYMENT_RECOVERY_SECRET),enc.encode(code));return 'v2.'+b64(iv)+'.'+b64(new Uint8Array(encrypted));}
export async function openV2(box,env){const p=box.split('.');if(p.length!==3||p[0]!=='v2'||!env.PAYMENT_RECOVERY_SECRET)throw Error('RECOVERY_INVALID');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(p[1])},await key(env.PAYMENT_RECOVERY_SECRET),bytes(p[2])));}
