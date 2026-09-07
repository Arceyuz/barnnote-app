function buildNote(){
  const raw = $('transcript').value.trim();
  state.transcript = raw;
  const text = normalize(raw);
  const x = extract(text);
  const feat = state.audioFeat || { pauseCount:0, quietRatio:0, emphasisWindows:[] };
  const horse = $('horse').value.trim();
  const flags = [];
  if (!raw || raw.length < 40) flags.push({k:'e', t:'Transcript is short. Confirm the recording captured the plan.'});
  if (!x.vitals.hr && !x.vitals.rr) flags.push({k:'w', t:'No HR/RR spoken. Vitals were not auto-invented.'});
  if (x.injection && !x.sedative) flags.push({k:'w', t:'Injection/block language without a named sedative. Confirm with provider.'});
  if (x.laterality.length > 1) flags.push({k:'w', t:'More than one limb mentioned ('+x.laterality.join(', ')+').'});
  if (feat.pauseCount >= 4) flags.push({k:'p', t:'Audio map: '+feat.pauseCount+' long pauses used to split exam vs plan.'});
  if (feat.quietRatio > 0.55) flags.push({k:'w', t:'Recording is mostly quiet. Mic may have been far from the speaker.'});
  const limb = x.laterality[0] || 'affected limb (not specified)';
  const date = new Date().toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
  const note = [
    'BARNNOTE DRAFT — not a signed medical record',
    'Date: '+date,
    'Patient: '+horse+'    Breed/Age: '+($('breed').value||'—')+'    Owner: '+($('owner').value||'—'),
    'Provider: '+$('provider').value+'    Location: '+$('location').value+'    Billing: '+$('level').value+'    Trip: '+state.barnTrip,
    'Visit: '+$('visitType').value,
    'Audio: '+fmt(state.duration||feat.durationMs||0)+' · pauses '+(feat.pauseCount||0)+' · dual-source',
    '','SUBJECTIVE / HISTORY',
    x.meds.length ? 'Therapies named: '+[...new Set(x.meds)].join(', ')+'.' : 'History taken from spoken exam.',
    '','OBJECTIVE / PE',
    x.grade ? ('Gait: '+x.grade+'/5 lameness localized in speech to '+limb+'.') : ('Gait / lameness: '+limb+' discussed; grade not clearly spoken.'),
    x.vitals.hr || x.vitals.rr ? ('Vitals as spoken: HR '+(x.vitals.hr||'—')+' · RR '+(x.vitals.rr||'—')+'.') : 'Vitals: not dictated.',
    '','ASSESSMENT',
    x.grade ? (x.grade+'/5 lameness, '+limb+'.') : ('Complaint involving '+limb+'; grade not locked.'),
    '','TREATMENT / DRUGS',
    x.injection ? 'Injection/block discussed — confirm site from transcript.' : 'No in-clinic drug clearly named.',
    x.meds.length ? ('Named: '+[...new Set(x.meds)].join(', ')+'.') : 'Take-home: only what was explicitly dispensed.',
    '','PLAN',
    x.days ? ('Spoken follow-up: '+x.days+' days.') : 'Recheck as discussed; owner to call if worse.',
    'This is an AI draft. Provider must edit and sign.',
    '','SPOKEN SOURCE (edited)', text
  ].join('\n');
  const ownerRecap = ['Hi — update on '+horse+'.', x.grade ? ('Today the exam described a '+x.grade+'/5 lameness on the '+limb+'.') : ('Today we examined '+horse+'.'), x.days ? ('Plan: recheck in about '+x.days+' days.') : 'We will recheck as discussed.', 'This recap is a draft until '+$('provider').value+' signs.'].join(' ');
  state.note = note; state.ownerRecap = ownerRecap; state.flags = flags;
  state.anchors = [{f:'Audio map', q:(feat.pauseCount||0)+' pauses, quiet '+((feat.quietRatio||0)*100|0)+'%'}];
  if (x.grade) state.anchors.unshift({f:'Grade', q:x.grade+'/5'});
  if (x.laterality[0]) state.anchors.unshift({f:'Laterality', q:limb});
  renderNote(); log('Note generated (local dual-source)');
}
function renderNote(){
  $('noteOut').textContent = state.note;
  $('ownerOut').textContent = state.ownerRecap;
  $('flags').innerHTML = state.flags.map(f => `<div class="flag ${f.k}">${f.t}</div>`).join('') || '<div class="ok">No blocking flags.</div>';
  $('anchors').innerHTML = state.anchors.map(a => `<div class="anchor"><b>${a.f}</b> — ${a.q}</div>`).join('');
}
async function maybeGemini(){
  const key = $('geminiKey').value.trim();
  if (!key || !state.blob) return false;
  $('gemStatus').textContent = 'Sending audio + transcript to Gemini…';
  try {
    const b64 = await blobToB64(state.blob);
    const mime = state.blob.type || 'audio/mp4';
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+encodeURIComponent(key), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contents: [{ parts: [
        { text: 'Equine veterinary scribe. Never invent vitals, drugs, laterality, or grades. Patient '+$('horse').value+', provider '+$('provider').value+'. Transcript:\n'+$('transcript').value },
        { inline_data: { mime_type: mime, data: b64 } }
      ]}]})
    });
    const j = await r.json();
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts ? j.candidates[0].content.parts.map(p=>p.text).join('\n') : '';
    if (!txt) throw new Error(JSON.stringify(j.error||j));
    state.note = 'BARNNOTE DRAFT — Gemini audio+text\n\n'+txt;
    state.flags.push({k:'p', t:'Cloud audio-in used. Still a draft until signed.'});
    renderNote(); $('gemStatus').textContent = 'Gemini draft received.'; return true;
  } catch (e) { $('gemStatus').textContent = 'Gemini failed — local note kept. '+e.message; return false; }
}
function blobToB64(blob){
  return new Promise((res,rej) => { const fr = new FileReader(); fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(',')+1)); }; fr.onerror = rej; fr.readAsDataURL(blob); });
}
$('btnGenerate').onclick = async () => {
  if (!$('transcript').value.trim() && !state.blob) { alert('Need a transcript or a recording.'); return; }
  if (!$('transcript').value.trim() && state.blob) $('transcript').value = '[No device caption. Type what you heard, or add a Gemini key to listen to the file.]';
  setStep('note'); buildNote(); await maybeGemini();
};
$('btnCopy').onclick = () => { navigator.clipboard.writeText($('noteOut').textContent); alert('Copied.'); };
$('btnCsv').onclick = () => {
  const cols = ['Date','Patient','Provider','Location','Billing','Trip','Visit'];
  const row = [new Date().toISOString().slice(0,10), $('horse').value, $('provider').value, $('location').value, $('level').value, state.barnTrip, $('visitType').value].map(c => '"'+String(c).replace(/"/g,'""')+'"');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([cols.join(',')+'\n'+row.join(',')],{type:'text/csv'})); a.download = ($('horse').value||'note')+'-billing.csv'; a.click();
};
$('btnSign').onclick = () => {
  if (!confirm('Lock this draft on this phone? It does not write to HVMS.')) return;
  const vault = JSON.parse(localStorage.getItem('barnnote.vault')||'[]');
  vault.unshift({horse:$('horse').value,provider:$('provider').value,loc:$('location').value,note:$('noteOut').textContent,signedAt:new Date().toISOString()});
  localStorage.setItem('barnnote.vault', JSON.stringify(vault.slice(0,80)));
  renderVault(); setStep('vault');
};
function renderVault(){
  const vault = JSON.parse(localStorage.getItem('barnnote.vault')||'[]');
  if (!vault.length) { $('vaultList').textContent = 'Empty'; return; }
  $('vaultList').innerHTML = vault.map(v => `<div class="list-item"><b>${v.horse}</b> · ${v.provider} · ${v.loc}<br/><span class="muted">${(v.signedAt||'').slice(0,16).replace('T',' ')}</span></div>`).join('');
}
function fresh(){
  state.blob = null; state.transcript=''; state.note=''; state.signed=false; state.chunks=[];
  $('transcript').value=''; $('noteOut').textContent=''; $('player').classList.add('hidden');
  $('btnToTranscript').disabled = true; $('timer').textContent='00:00'; $('consentBox').checked = false; setStep('consent');
}
$('btnNew').onclick = fresh; $('dockNew').onclick = fresh; $('dockVault').onclick = () => { renderVault(); setStep('vault'); };
$('geminiKey').onchange = () => { $('gemStatus').textContent = $('geminiKey').value.trim() ? 'Key stored in this browser only.' : 'No key — local engine.'; };
setStep('consent'); renderVault();
