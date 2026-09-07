const $ = (id) => document.getElementById(id);
const state = {step:'consent',consent:false,barnTrip:'BT',chunks:[],blob:null,url:null,rec:null,t0:0,timer:null,duration:0,audioFeat:null,transcript:'',note:'',ownerRecap:'',flags:[],anchors:[],signed:false,audit:[]};
const STEPS = ['consent','patient','record','transcript','note','vault'];
function setStep(s){
  state.step = s;
  ['consent','patient','record','transcript','note'].forEach(id => { const el = $('s-'+id); if (el) el.classList.toggle('hidden', s !== id); });
  $('s-vault').classList.toggle('hidden', s !== 'vault');
  $('steps').innerHTML = ['Consent','Patient','Record','Transcript','Note','Sign'].map((lab,i) => `<span class="${i<=STEPS.indexOf(s)?'on':''}">${lab}</span>`).join('');
  log('Opened step '+s);
}
function log(msg){
  state.audit.unshift({ t: new Date().toISOString(), msg });
  $('audit').innerHTML = state.audit.slice(0,12).map(a => `${a.t.slice(11,19)} · ${a.msg}`).join('<br/>');
}
$('btnConsent').onclick = () => {
  if (!$('consentBox').checked) { alert('Check consent before recording.'); return; }
  state.consent = true; log('Consent recorded'); setStep('patient');
};
document.querySelectorAll('#btSeg button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('#btSeg button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); state.barnTrip = b.dataset.v;
  };
});
$('btnToRecord').onclick = () => {
  if (!$('horse').value.trim()) { alert('Horse name is required.'); return; }
  log('Patient set: '+$('horse').value); setStep('record');
};
function fmt(ms){ const s = Math.floor(ms/1000); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); }
function pickMime(){
  const types = ['audio/mp4','audio/aac','audio/webm;codecs=opus','audio/webm','audio/mpeg'];
  if (!window.MediaRecorder) return '';
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return '';
}
async function startRec(){
  if (!state.consent) { setStep('consent'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Use Add voice file.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  state.chunks = [];
  const mime = pickMime();
  state.rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  state.rec.ondataavailable = e => { if (e.data.size) state.chunks.push(e.data); };
  state.rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    state.blob = new Blob(state.chunks, { type: state.rec.mimeType });
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(state.blob);
    const p = $('player'); p.src = state.url; p.classList.remove('hidden');
    $('btnToTranscript').disabled = false;
    state.audioFeat = await analyzeAudio(state.blob);
    $('audioMeta').textContent = `Duration ${fmt(state.duration)} · pauses ${state.audioFeat.pauseCount}`;
    log('Recording saved '+fmt(state.duration));
  };
  state.rec.start(250); state.t0 = Date.now();
  $('recState').innerHTML = '<span class="rec-dot"></span>Recording';
  $('btnRec').disabled = true; $('btnStop').disabled = false;
  state.timer = setInterval(() => { state.duration = Date.now()-state.t0; $('timer').textContent = fmt(state.duration); }, 200);
  tryLiveCaption(true);
}
$('btnRec').onclick = () => startRec().catch(e => { $('recState').textContent = 'Live mic unavailable'; $('recHint').textContent = e.message; alert(e.message); });
$('btnStop').onclick = () => {
  if (state.rec && state.rec.state !== 'inactive') state.rec.stop();
  clearInterval(state.timer); $('recState').textContent = 'Stopped';
  $('btnRec').disabled = false; $('btnStop').disabled = true; tryLiveCaption(false);
};
$('fileAudio').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  state.blob = f; if (state.url) URL.revokeObjectURL(state.url); state.url = URL.createObjectURL(f);
  const p = $('player'); p.src = state.url; p.classList.remove('hidden');
  $('btnToTranscript').disabled = false;
  state.audioFeat = await analyzeAudio(f);
  state.duration = (state.audioFeat.durationMs)||0;
  $('timer').textContent = fmt(state.duration);
  $('audioMeta').textContent = `Uploaded ${f.name} · pauses ${state.audioFeat.pauseCount}`;
};
$('btnToTranscript').onclick = () => setStep('transcript');
let recog = null;
function tryLiveCaption(on){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { if ($('sttNote')) $('sttNote').textContent = 'Safari live caption is limited. Type or paste the exam, or add a Gemini key to hear the file.'; return; }
  if (!on) { if (recog) try{recog.stop()}catch(_){;} return; }
  recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
  recog.onresult = (ev) => { let final = ''; for (let i=0;i<ev.results.length;i++) final += ev.results[i][0].transcript + ' '; $('transcript').value = final.trim(); };
  try { recog.start(); } catch(_){}
}
$('btnLive').onclick = () => tryLiveCaption(true);
async function analyzeAudio(blob){
  const feat = { pauseCount: 0, peak: 0, durationMs: 0, quietRatio: 0, emphasisWindows: [] };
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0); feat.durationMs = buf.duration * 1000;
    const hop = Math.floor(buf.sampleRate * 0.05); let silentRun = 0, quiet = 0, frames = 0;
    for (let i=0;i<ch.length;i+=hop){
      frames++; let rms = 0;
      for (let j=0;j<hop && i+j<ch.length;j++) rms += ch[i+j]*ch[i+j];
      rms = Math.sqrt(rms/hop); feat.peak = Math.max(feat.peak, rms);
      if (rms < 0.02) { quiet++; silentRun++; }
      else { if (silentRun > 8) feat.pauseCount++; if (rms > 0.12) feat.emphasisWindows.push(Math.round(i/buf.sampleRate)); silentRun = 0; }
    }
    feat.quietRatio = frames ? quiet/frames : 0; ctx.close();
  } catch (e) { feat.error = e.message; }
  return feat;
}
function normalize(text){
  let t = ' ' + text.replace(/\s+/g,' ').trim() + ' ';
  [['pentoxy','pentoxifylline'],['equioxx','Equioxx'],['banamine','Banamine'],['bute','phenylbutazone'],['adequan','Adequan'],['sedivet','Sedivet'],['dormosedan','Dormosedan'],['0.4 dt','0.4 DT']].forEach(([a,b]) => { t = t.replace(new RegExp(a,'ig'), b); });
  return t.replace(/\b([1-5])\s*(?:out of|\/)\s*5\b/g,'$1/5').trim();
}
function extract(text){
  const t = text.toLowerCase(); const laterality = [];
  [['right hind','RH'],['left hind','LH'],['right front','RF'],['left front','LF']].forEach(([k,v]) => { if (t.includes(k) && !laterality.includes(v)) laterality.push(v); });
  return {
    laterality,
    grade: (text.match(/([1-5])\s*\/\s*5/)||[])[1],
    days: (text.match(/(\d+)\s*-?\s*days?/)||[])[1],
    injection: /inject|block|intra-?articular|joint|mepivacaine|carbocaine|betamethasone/.test(t),
    sedative: /sedivet|detomidine|dormosedan|xylazine|butorphanol|0\.4\s*dt/.test(t),
    liver: /liver|hepatic/.test(t),
    meds: ['pentoxifylline','Equioxx','Banamine','Adequan','Sedivet','detomidine'].filter(m => t.includes(m.toLowerCase())),
    vitals: { hr: (text.match(/\bHR\s*[:=]?\s*(\d{2,3})/i)||[])[1], rr: (text.match(/\bRR\s*[:=]?\s*(\d{1,2})/i)||[])[1], temp: (text.match(/\b(?:T|temp)\s*[:=]?\s*(\d{2}(?:\.\d)?)/i)||[])[1] }
  };
}
