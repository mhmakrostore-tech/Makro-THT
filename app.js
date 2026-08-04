import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=5';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const $ = (id) => document.getElementById(id);
let user = null, entries = [], products = new Map(), photoData = '', scannerStream = null, scanning = false;

const refs = {
  loading:$('loading'), loginView:$('loginView'), appView:$('appView'), loginBtn:$('loginBtn'), logoutBtn:$('logoutBtn'),
  barcode:$('barcode'), productName:$('productName'), expiryDate:$('expiryDate'), quantity:$('quantity'), location:$('location'),
  photoInput:$('photoInput'), photoPreview:$('photoPreview'), notes:$('notes'), saveBtn:$('saveBtn'), formMessage:$('formMessage'),
  entriesList:$('entriesList'), productsList:$('productsList'), searchInput:$('searchInput'), statusFilter:$('statusFilter'),
  expiredCount:$('expiredCount'), soonCount:$('soonCount'), goodCount:$('goodCount'), totalCount:$('totalCount'),
  exportBtn:$('exportBtn'), scanBtn:$('scanBtn'), stopScanBtn:$('stopScanBtn'), scannerVideo:$('scannerVideo'), userEmail:$('userEmail')
};

function userPath(type){ return collection(db, 'users', user.uid, type); }
function daysLeft(dateStr){ const t=new Date();t.setHours(0,0,0,0); const d=new Date(dateStr+'T00:00:00'); return Math.ceil((d-t)/86400000); }
function statusOf(dateStr){ const d=daysLeft(dateStr); return d<0?'expired':d<=30?'soon':'good'; }
function statusText(s){ return s==='expired'?'Verlopen':s==='soon'?'Binnen 30 dagen':'Goed'; }
function esc(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function fmtDate(s){ if(!s)return ''; const [y,m,d]=s.split('-');return `${d}-${m}-${y}`; }

async function login(){
  try { await signInWithPopup(auth, provider); }
  catch(e){ if(/popup|operation-not-supported|web-storage/.test(e.code||'')) await signInWithRedirect(auth, provider); else alert('Inloggen mislukt: '+e.message); }
}
refs.loginBtn.onclick=login; refs.logoutBtn.onclick=()=>signOut(auth);
getRedirectResult(auth).catch(()=>{});

onAuthStateChanged(auth, u=>{
  refs.loading.classList.add('hidden'); user=u;
  if(!u){ refs.loginView.classList.remove('hidden'); refs.appView.classList.add('hidden'); return; }
  refs.loginView.classList.add('hidden'); refs.appView.classList.remove('hidden'); refs.userEmail.textContent=u.email||'';
  subscribeData();
});

function subscribeData(){
  onSnapshot(query(userPath('entries'), orderBy('createdAt','desc')), snap=>{ entries=snap.docs.map(d=>({id:d.id,...d.data()})); render(); });
  onSnapshot(userPath('products'), snap=>{ products=new Map(snap.docs.map(d=>[d.id,{id:d.id,...d.data()}])); renderProducts(); autoFillProduct(); });
}

document.querySelectorAll('.tabs button').forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active'); $(btn.dataset.tab).classList.add('active');
});

refs.barcode.addEventListener('input', autoFillProduct);
function autoFillProduct(){
  const p=products.get(refs.barcode.value.trim());
  if(!p)return;
  refs.productName.value=p.name||'';
  if(p.photo){ photoData=p.photo; refs.photoPreview.src=photoData; refs.photoPreview.classList.remove('hidden'); }
}

refs.photoInput.onchange=async()=>{
  const f=refs.photoInput.files?.[0]; if(!f)return;
  photoData=await compressImage(f,640,0.68);
  refs.photoPreview.src=photoData; refs.photoPreview.classList.remove('hidden');
};
function compressImage(file,max,quality){
  return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>{ let w=img.width,h=img.height; const scale=Math.min(1,max/Math.max(w,h)); w=Math.round(w*scale);h=Math.round(h*scale); const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',quality)); URL.revokeObjectURL(img.src);}; img.onerror=reject; img.src=URL.createObjectURL(file); });
}

refs.saveBtn.onclick=async()=>{
  refs.formMessage.textContent='';
  const barcode=refs.barcode.value.trim(), name=refs.productName.value.trim(), expiry=refs.expiryDate.value;
  if(!barcode||!name||!expiry){ showMsg('Vul barcode, productnaam en THT in.',false); return; }
  refs.saveBtn.disabled=true;
  try{
    const existing=products.get(barcode);
    const finalPhoto=photoData||existing?.photo||'';
    await setDoc(doc(db,'users',user.uid,'products',barcode),{barcode,name,photo:finalPhoto,updatedAt:serverTimestamp()},{merge:true});
    await addDoc(userPath('entries'),{barcode,name,photo:finalPhoto,expiryDate:expiry,quantity:Number(refs.quantity.value||0),location:refs.location.value,notes:refs.notes.value.trim(),createdAt:serverTimestamp()});
    showMsg('Product en THT opgeslagen.',true); clearForm();
  }catch(e){ showMsg('Opslaan mislukt: '+e.message,false); }
  refs.saveBtn.disabled=false;
};
function showMsg(t,ok){ refs.formMessage.textContent=t; refs.formMessage.className='message '+(ok?'ok':'error'); }
function clearForm(){ refs.barcode.value='';refs.productName.value='';refs.expiryDate.value='';refs.quantity.value='1';refs.notes.value='';refs.photoInput.value='';photoData='';refs.photoPreview.classList.add('hidden'); }

function render(){
  const q=refs.searchInput.value.trim().toLowerCase(), sf=refs.statusFilter.value;
  const filtered=entries.filter(e=>{ const s=statusOf(e.expiryDate); return (sf==='all'||sf===s)&&(!q||(e.name||'').toLowerCase().includes(q)||(e.barcode||'').includes(q)); });
  const counts={expired:0,soon:0,good:0}; entries.forEach(e=>counts[statusOf(e.expiryDate)]++);
  refs.expiredCount.textContent=counts.expired;refs.soonCount.textContent=counts.soon;refs.goodCount.textContent=counts.good;refs.totalCount.textContent=entries.length;
  refs.entriesList.innerHTML=filtered.length?filtered.map(entryHtml).join(''):'<div class="panel">Geen producten gevonden.</div>';
  refs.entriesList.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removeEntry(b.dataset.delete));
}
function entryHtml(e){ const s=statusOf(e.expiryDate), d=daysLeft(e.expiryDate); return `<article class="item"><img src="${e.photo||'icon.svg'}" alt=""><div><strong>${esc(e.name)}</strong><div class="meta">Barcode: ${esc(e.barcode)}<br>THT: ${fmtDate(e.expiryDate)} (${d<0?Math.abs(d)+' dagen verlopen':d+' dagen'})<br>Aantal: ${e.quantity??''} · ${esc(e.location||'')}</div><span class="badge ${s}">${statusText(s)}</span></div><div class="actions"><button class="delete" data-delete="${e.id}">Verwijder</button></div></article>`; }
async function removeEntry(id){ if(confirm('Deze THT-registratie verwijderen?')) await deleteDoc(doc(db,'users',user.uid,'entries',id)); }
refs.searchInput.oninput=render;refs.statusFilter.onchange=render;

function renderProducts(){ const arr=[...products.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'')); refs.productsList.innerHTML=arr.length?arr.map(p=>`<article class="item"><img src="${p.photo||'icon.svg'}"><div><strong>${esc(p.name)}</strong><div class="meta">${esc(p.barcode)}</div></div></article>`).join(''):'<p>Nog geen producten.</p>'; }

refs.exportBtn.onclick=()=>{
  const rows=[['Barcode','Productnaam','THT','Aantal','Locatie','Status','Opmerking']];
  entries.forEach(e=>rows.push([e.barcode,e.name,fmtDate(e.expiryDate),e.quantity,e.location,statusText(statusOf(e.expiryDate)),e.notes||'']));
  const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='Makro_THT_'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(a.href);
};

refs.scanBtn.onclick=startScanner; refs.stopScanBtn.onclick=stopScanner;
async function startScanner(){
  if(!('BarcodeDetector' in window)){ alert('Automatisch scannen wordt niet ondersteund op dit apparaat. Typ de barcode handmatig. Gebruik hiervoor je Samsung met Chrome.'); return; }
  try{
    scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}});
    refs.scannerVideo.srcObject=scannerStream;await refs.scannerVideo.play();refs.scannerVideo.classList.remove('hidden');refs.stopScanBtn.classList.remove('hidden');scanning=true;
    const detector=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});
    const loop=async()=>{ if(!scanning)return; try{ const codes=await detector.detect(refs.scannerVideo); if(codes[0]){ refs.barcode.value=codes[0].rawValue;autoFillProduct();stopScanner();return; } }catch{} requestAnimationFrame(loop); }; loop();
  }catch(e){ alert('Camera kan niet openen: '+e.message); }
}
function stopScanner(){ scanning=false;scannerStream?.getTracks().forEach(t=>t.stop());scannerStream=null;refs.scannerVideo.classList.add('hidden');refs.stopScanBtn.classList.add('hidden'); }

if('serviceWorker' in navigator && location.protocol==='https:') navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
