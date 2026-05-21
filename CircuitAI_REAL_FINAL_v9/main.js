const $ = (q, root=document) => root.querySelector(q);
const $$ = (q, root=document) => [...root.querySelectorAll(q)];
const ws = $('#circuit-workspace');
const world = $('#world');
const svg = $('#wire-svg');
let isWiring=false, startPin=null, currentLine=null, selectedComponent=null, selectedLine=null, currentConfigEl=null;
let nextComponentId=1, nextPinId=1, running=false, zoom=1, pan={x:0,y:0}, panDrag=null;
let codePinStates = {};

const defaults = { resistor:{ohms:220}, potentiometer:{ohms:10000}, battery:{voltage:9}, dc:{voltage:5}, switch:{closed:false}, multimeter:{mode:'V'}, motor:{rpm:120}, servo:{angle:90}, buzzer:{freq:440} };

document.addEventListener('DOMContentLoaded', () => {
  initToolbar(); initDragAndDrop(); initChatbot(); initInspector(); initPanZoom(); updateTransform();
  autoLoad();
});

function initToolbar(){
  $('#runBtn').onclick=()=>runSimulation(); $('#stopBtn').onclick=()=>stopSimulation();
  $('#saveBtn').onclick=()=>saveCircuit(); $('#loadBtn').onclick=()=>loadCircuit();
  $('#exportBtn').onclick=()=>exportCircuit(); $('#clearBtn').onclick=()=>{ if(confirm('전체 삭제할까요?')) clearCircuit(); };
  $('#importFile').onchange=e=>importCircuit(e.target.files[0]);
  $('#uploadCodeBtn').onclick=()=>{parseArduinoCode(); runSimulation();};
  $('#zoomIn').onclick=()=>{zoom=Math.min(2.5,zoom+.1);updateTransform();}; $('#zoomOut').onclick=()=>{zoom=Math.max(.35,zoom-.1);updateTransform();};
  $('#fitBtn').onclick=()=>{zoom=1;pan={x:0,y:0};updateTransform();};
  $('#componentSearch').addEventListener('input', e=>{const v=e.target.value.toLowerCase(); $$('.component-item').forEach(i=>i.style.display=i.textContent.toLowerCase().includes(v)||i.dataset.type.includes(v)?'flex':'none');});
  document.addEventListener('keydown', handleKeys);
}
function handleKeys(e){
  if(e.key==='Escape'){cancelWire(); $('#config-modal').style.display='none';}
  if((e.key==='Delete'||e.key==='Backspace') && selectedLine) deleteLine(selectedLine);
  else if((e.key==='Delete'||e.key==='Backspace') && selectedComponent) deleteComponent(selectedComponent);
  if(e.key.toLowerCase()==='r' && selectedComponent){ rotateComponent(selectedComponent); }
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='d' && selectedComponent){ e.preventDefault(); duplicateComponent(selectedComponent); }
}
function initPanZoom(){
  ws.addEventListener('wheel', e=>{e.preventDefault(); const old=zoom; zoom=Math.max(.35,Math.min(2.5,zoom-(e.deltaY>0?.08:-.08))); const rect=ws.getBoundingClientRect(); const mx=e.clientX-rect.left, my=e.clientY-rect.top; pan.x=mx-(mx-pan.x)*(zoom/old); pan.y=my-(my-pan.y)*(zoom/old); updateTransform();},{passive:false});
  ws.addEventListener('mousedown', e=>{ if(e.button===1 || e.altKey){panDrag={x:e.clientX-pan.x,y:e.clientY-pan.y}; e.preventDefault();}});
  document.addEventListener('mousemove', e=>{ if(panDrag){pan.x=e.clientX-panDrag.x;pan.y=e.clientY-panDrag.y;updateTransform();}});
  document.addEventListener('mouseup',()=>panDrag=null);
}
function updateTransform(){ world.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`; $('#zoomLabel').textContent=Math.round(zoom*100)+'%'; }
function screenToWorld(clientX,clientY){const r=ws.getBoundingClientRect(); return {x:(clientX-r.left-pan.x)/zoom, y:(clientY-r.top-pan.y)/zoom};}
function snap(v){return Math.round(v/15)*15;}

function initDragAndDrop(){
  $$('.component-item').forEach(item=>{item.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',item.dataset.type);});});
  ws.addEventListener('dragover',e=>e.preventDefault());
  ws.addEventListener('drop',e=>{e.preventDefault(); const type=e.dataTransfer.getData('text/plain'); if(type){const p=screenToWorld(e.clientX,e.clientY); addComponentToWorkspace(type,p.x,p.y);}});
  ws.addEventListener('mousemove', e=>{ if(!isWiring||!currentLine)return; const p=screenToWorld(e.clientX,e.clientY); currentLine.setAttribute('x2',p.x); currentLine.setAttribute('y2',p.y);});
  ws.addEventListener('mouseup', e=>{
    if(!isWiring) return;
    if(e.target.classList.contains('pin')) return;

    // 마우스를 핀 근처에만 놓아도 자동으로 가장 가까운 구멍에 꽂히게 처리
    const p = screenToWorld(e.clientX,e.clientY);
    let best = null, bestDist = 75;
    $$('.pin', world).forEach(pin=>{
      if(pin === startPin) return;
      const pp = pinPos(pin);
      const d = Math.hypot(pp.x-p.x, pp.y-p.y);
      const isBread = componentOfPin(pin)?.dataset.baseType === 'breadboard';
      const limit = isBread ? 75 : 46;
      if(d < bestDist && d <= limit){ bestDist = d; best = pin; }
    });

    if(best) finishWire(best);
    else cancelWire();
  });
  svg.addEventListener('click',e=>{ if(e.target.tagName.toLowerCase()==='line') selectLine(e.target); else clearSelection(); });
}
window.addComponentToWorkspace=addComponentToWorkspace;
function addComponentToWorkspace(type,x,y){
  const el=createVisualComponent(type); el.style.left=snap(x)+'px'; el.style.top=snap(y)+'px'; world.appendChild(el); $('.workspace-hint')?.remove();
  el.addEventListener('dblclick',()=>openConfigModal(el));
  el.addEventListener('click',e=>{ if(!e.target.classList.contains('pin')) selectComponent(el); });
  let drag=null; el.addEventListener('mousedown',e=>{ if(e.target.classList.contains('pin'))return; selectComponent(el); const p=screenToWorld(e.clientX,e.clientY); drag={x:p.x-parseFloat(el.style.left), y:p.y-parseFloat(el.style.top)}; el.style.zIndex=100; e.stopPropagation();});
  document.addEventListener('mousemove',e=>{ if(!drag)return; const p=screenToWorld(e.clientX,e.clientY); el.style.left=snap(p.x-drag.x)+'px'; el.style.top=snap(p.y-drag.y)+'px'; updateWires(el); });
  document.addEventListener('mouseup',()=>{ if(drag){drag=null; el.style.zIndex=10; snapComponentToBreadboard(el); updateWires(el); updateBreadboardContactVisuals(); saveAuto(); }});
  updateVisuals(el); updateBreadboardContactVisuals(); renderInspector(); return el;
}
function baseTypeOf(type){ if(type.startsWith('battery'))return 'battery'; if(type.startsWith('led'))return 'led'; if(type.startsWith('switch'))return 'switch'; if(type.startsWith('motor'))return 'motor'; if(type.startsWith('dc'))return 'dc'; if(type.startsWith('breadboard'))return 'breadboard'; return type.split('-')[0]; }
function createVisualComponent(type){
  const el=document.createElement('div'); const base=baseTypeOf(type); el.className=`workspace-component comp-${base}`; el.dataset.compId=nextComponentId++; el.dataset.type=type; el.dataset.baseType=base; el.dataset.rotation='0';
  if(base==='resistor')el.dataset.ohms=defaults.resistor.ohms; if(base==='potentiometer')el.dataset.ohms=defaults.potentiometer.ohms; if(base==='battery')el.dataset.voltage=type.includes('3v')?'3':type.includes('1.5v')?'1.5':'9'; if(base==='dc')el.dataset.voltage='5'; if(base==='switch')el.dataset.closed='false'; if(base==='multimeter')el.dataset.mode='V'; if(base==='motor')el.dataset.rpm='120';
  let w=60,h=40;
  if(base==='breadboard'){
    // Clean symmetric breadboard: 30 columns, A-J rows, clear power rails.
    w=720; h=440;
    el.style.width=w+'px'; el.style.height=h+'px';
    el.innerHTML=`
      <div class="bb-body">
        <div class="bb-rail rail-top-plus"><span class="bb-sign left">+</span><span class="bb-sign right">+</span></div>
        <div class="bb-rail rail-top-minus"><span class="bb-sign left">−</span><span class="bb-sign right">−</span></div>
        <div class="bb-rail rail-bottom-plus"><span class="bb-sign left">+</span><span class="bb-sign right">+</span></div>
        <div class="bb-rail rail-bottom-minus"><span class="bb-sign left">−</span><span class="bb-sign right">−</span></div>
        <div class="bb-groove"></div>
      </div>`;
    const body=$('.bb-body',el);
    const startX=96, stepX=18, cols=30;
    const topRows=[142,162,182,202,222];
    const bottomRows=[282,302,322,342,362];

    for(let c=0;c<cols;c++){
      const x=startX+c*stepX;
      addPin(body,`railTopPlus-${c}`,x,54,'+');
      addPin(body,`railTopMinus-${c}`,x,84,'-');
      addPin(body,`railBotPlus-${c}`,x,388,'+');
      addPin(body,`railBotMinus-${c}`,x,418,'-');
      for(let r=0;r<5;r++){
        addPin(body,`a${r}-${c}`,x,topRows[r],String.fromCharCode(65+r));
        addPin(body,`f${r}-${c}`,x,bottomRows[r],String.fromCharCode(70+r));
      }
    }

    [1,5,10,15,20,25,30].forEach(n=>{
      const t=document.createElement('span');
      t.className='bb-num';
      t.textContent=String(n);
      t.style.left=(startX+(n-1)*stepX-5)+'px';
      t.style.top='112px';
      body.appendChild(t);
    });
    ['A','B','C','D','E'].forEach((label,i)=>{
      const t=document.createElement('span');
      t.className='bb-row-label';
      t.textContent=label;
      t.style.left='48px';
      t.style.top=(topRows[i]-8)+'px';
      body.appendChild(t);
    });
    ['F','G','H','I','J'].forEach((label,i)=>{
      const t=document.createElement('span');
      t.className='bb-row-label';
      t.textContent=label;
      t.style.left='48px';
      t.style.top=(bottomRows[i]-8)+'px';
      body.appendChild(t);
    });
  } else if(base==='battery'||base==='dc'){w=110;h=72; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic ${base==='battery'?'battery-graphic':'inst-source-graphic'}"><b class="batt-val"></b></div>`; addPin(el,'vcc',18,0,'+'); addPin(el,'gnd',88,0,'-');}
  else if(base==='led'){w=42;h=72; const color=type.split('-')[1]||'red'; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic led-graphic" data-color="${color}"><span class="led-leg leg-a"></span><span class="led-leg leg-k"></span></div>`; addPin(el,'a',12,68,'A'); addPin(el,'k',30,68,'K');}
  else if(base==='resistor'||base==='potentiometer'){w=70;h=24; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic resistor-graphic"></div>`; addPin(el,'p1',-6,12,'1'); addPin(el,'p2',76,12,'2');}
  else if(base==='switch'){w=55;h=42; const sub=type.split('-')[1]||'push'; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic switch-${sub}-graphic"></div>`; addPin(el,'p1',-6,21,'1'); addPin(el,'p2',61,21,'2'); el.addEventListener('dblclick',()=>{el.dataset.closed=el.dataset.closed==='true'?'false':'true'; updateVisuals(el); if(running)runSimulation();});}
  else if(base==='arduino'){w=230;h=162; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic arduino-graphic"></div>`; for(let i=0;i<=13;i++)addPin(el,`D${i}`,16+i*15,12,`D${i}`); ['A0','A1','A2','A3','A4','A5'].forEach((p,i)=>addPin(el,p,30+i*22,150,p)); addPin(el,'5V',184,150,'5V'); addPin(el,'GND',210,150,'GND');}
  else if(base==='motor'){const sub=type.split('-')[1]||'dc'; if(sub==='servo'){w=92;h=64; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic motor-servo-graphic"><div class="servo-horn"></div><span>SG90</span></div>`; addPin(el,'p1',-5,18,'+'); addPin(el,'p2',-5,34,'-'); addPin(el,'sig',-5,50,'S');} else {w=92;h=62; el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic motor-dc-graphic"><div class="motor-shaft"></div><div class="motor-can"><span>DC</span></div></div>`; addPin(el,'p1',-5,22,'+'); addPin(el,'p2',-5,43,'-');}}
  else if(base==='buzzer'){w=55;h=55; el.style.width=w+'px';el.style.height=h+'px';el.innerHTML='<div class="graphic buzzer-graphic">BZ</div>'; addPin(el,'p1',-5,18,'+');addPin(el,'p2',-5,38,'-');}
  else if(base==='multimeter'){w=70;h=95; el.style.width=w+'px';el.style.height=h+'px';el.innerHTML='<div class="graphic multimeter-graphic"><div class="screen">0.00 V</div></div>'; addPin(el,'p1',20,100,'+');addPin(el,'p2',50,100,'-');}
  else if(base==='oscilloscope'){w=100;h=80;el.style.width=w+'px';el.style.height=h+'px';el.innerHTML='<div class="graphic oscilloscope-graphic"></div>';addPin(el,'p1',-5,35,'CH1');addPin(el,'p2',-5,60,'GND');}
  else {el.style.width=w+'px';el.style.height=h+'px'; el.innerHTML=`<div class="graphic">${type}</div>`;addPin(el,'p1',-5,20,'1');addPin(el,'p2',65,20,'2');}
  return el;
}
function addPin(parent,id,x,y,label){const pin=document.createElement('div');pin.className='pin';pin.dataset.pinId=nextPinId++;pin.dataset.name=id;pin.dataset.label=label||id;pin.style.left=x+'px';pin.style.top=y+'px';pin.lines=[];pin.addEventListener('mousedown',e=>{e.stopPropagation();startWire(pin);});pin.addEventListener('mouseup',e=>{e.stopPropagation();finishWire(pin);});parent.appendChild(pin);}
function pinPos(pin){const wr=world.getBoundingClientRect();const pr=pin.getBoundingClientRect();return {x:(pr.left-wr.left)/zoom+pr.width/(2*zoom), y:(pr.top-wr.top)/zoom+pr.height/(2*zoom)};}
function wireColorForPin(pin){const name=(pinName(pin)||'').toLowerCase();const label=(pin.dataset.label||'').toLowerCase();if(name.includes('vcc')||name.includes('plus')||label==='+')return '#e11d23';if(name.includes('gnd')||name.includes('minus')||label==='-')return '#111827';return '#111827';}
function startWire(pin){if(currentLine) cancelWire(); isWiring=true;startPin=pin;const p=pinPos(pin);currentLine=document.createElementNS('http://www.w3.org/2000/svg','line');currentLine.setAttribute('x1',p.x);currentLine.setAttribute('y1',p.y);currentLine.setAttribute('x2',p.x);currentLine.setAttribute('y2',p.y);currentLine.setAttribute('stroke',wireColorForPin(pin));currentLine.setAttribute('stroke-width','5');currentLine.setAttribute('stroke-linecap','round');currentLine.startPin=pin;currentLine.isConnected=false;currentLine.style.pointerEvents='none';pin.lines.push(currentLine);svg.appendChild(currentLine);}
function finishWire(pin){
  if(!isWiring || !currentLine) return;

  if(startPin === pin){
    cancelWire();
    return;
  }

  const p = pinPos(pin);
  currentLine.setAttribute('x2', p.x);
  currentLine.setAttribute('y2', p.y);
  currentLine.endPin = pin;
  currentLine.isConnected = true;
  currentLine.style.pointerEvents = 'stroke';
  pin.lines.push(currentLine);

  isWiring = false;
  startPin = null;
  currentLine = null;

  updateBreadboardContactVisuals();
  saveAuto();
  if(running) runSimulation();
}
function addRoutePoint(e){if(!currentLine)return; const p=screenToWorld(e.clientX,e.clientY); const rp=document.createElement('div');rp.className='workspace-component comp-route';rp.dataset.compId=nextComponentId++;rp.dataset.baseType='route';rp.dataset.type='route';rp.style.left=snap(p.x-5)+'px';rp.style.top=snap(p.y-5)+'px';rp.style.width='10px';rp.style.height='10px';world.appendChild(rp);addPin(rp,'route',5,5,'');const pin=$('.pin',rp);const pp=pinPos(pin);currentLine.setAttribute('x2',pp.x);currentLine.setAttribute('y2',pp.y);currentLine.endPin=pin;currentLine.isConnected=true;currentLine.style.pointerEvents='stroke';pin.lines.push(currentLine);startPin=pin;currentLine=null;startWire(pin);}
function cancelWire(){if(currentLine){deleteLine(currentLine,false);}isWiring=false;startPin=null;currentLine=null;cleanupRoutePoints();}
function updateWires(component){$$('.pin',component).forEach(pin=>{const p=pinPos(pin);(pin.lines||[]).forEach(line=>{if(!line.startPin||!line.endPin)return; if(line.startPin===pin){line.setAttribute('x1',p.x);line.setAttribute('y1',p.y);}if(line.endPin===pin){line.setAttribute('x2',p.x);line.setAttribute('y2',p.y);}});});}
function deleteLine(line,save=true){if(!line)return; if(line.startPin)line.startPin.lines=(line.startPin.lines||[]).filter(l=>l!==line); if(line.endPin)line.endPin.lines=(line.endPin.lines||[]).filter(l=>l!==line); line.remove(); if(selectedLine===line)selectedLine=null; cleanupRoutePoints(); if(save)saveAuto();}
function cleanupRoutePoints(){ $$('.comp-route',world).forEach(r=>{const p=$('.pin',r); if(!p){r.remove();return;} p.lines=(p.lines||[]).filter(l=>l.parentNode&&l.startPin&&l.endPin); if(p.lines.length===0) r.remove();}); }
function nearestBreadboardHole(pin,maxDist=14){const pp=pinPos(pin);let best=null,bd=maxDist; $$('.comp-breadboard .pin',world).forEach(h=>{const hp=pinPos(h);const d=Math.hypot(pp.x-hp.x,pp.y-hp.y); if(d<bd){bd=d;best=h;}});return best;}
function snapComponentToBreadboard(el){
  if(
    el.dataset.baseType==='breadboard' ||
    el.dataset.baseType==='route' ||
    ['battery','dc','arduino'].includes(el.dataset.baseType)
  ) return;

  const pins = $$('.pin', el);
  if(!pins.length) return;

  let best = null;
  pins.forEach(partPin=>{
    const hole = nearestBreadboardHole(partPin, 30);
    if(!hole) return;
    const a = pinPos(partPin), b = pinPos(hole);
    const d = Math.hypot(a.x-b.x, a.y-b.y);
    if(!best || d < best.d) best = {partPin, hole, d};
  });
  if(!best) return;

  const a = pinPos(best.partPin);
  const b = pinPos(best.hole);

  // Breadboard holes do not follow the workspace 15px grid, so do not snap here.
  el.style.left = (parseFloat(el.style.left) + (b.x-a.x)) + 'px';
  el.style.top  = (parseFloat(el.style.top)  + (b.y-a.y)) + 'px';

  updateWires(el);
  updateBreadboardContactVisuals();
}
function deleteComponent(el){$$('.pin',el).forEach(p=>(p.lines||[]).slice().forEach(deleteLine)); el.remove(); selectedComponent=null; renderInspector(); saveAuto();}
function selectComponent(el){clearSelection(); selectedComponent=el; el.classList.add('comp-selected'); renderInspector();}
function selectLine(line){clearSelection();selectedLine=line;line.classList.add('wire-selected');}
function clearSelection(){if(selectedComponent)selectedComponent.classList.remove('comp-selected');if(selectedLine)selectedLine.classList.remove('wire-selected');selectedComponent=null;selectedLine=null;renderInspector();}
function rotateComponent(el){const r=((+el.dataset.rotation||0)+90)%360; el.dataset.rotation=r; el.style.rotate=r+'deg'; updateWires(el); saveAuto();}
function duplicateComponent(el){const x=parseFloat(el.style.left)+30,y=parseFloat(el.style.top)+30; const copy=addComponentToWorkspace(el.dataset.type,x,y); Object.keys(el.dataset).forEach(k=>{if(!['compId'].includes(k))copy.dataset[k]=el.dataset[k];}); updateVisuals(copy);}

function getResistorBands(ohms){let n=Math.max(1,parseInt(ohms)||220).toString(); if(n.length<2)n+='0'; const colors=['black','saddlebrown','red','orange','yellow','green','blue','purple','gray','white']; return [colors[+n[0]],colors[+n[1]],colors[Math.max(0,n.length-2)]||'black','gold'];}
function updateVisuals(el){const base=el.dataset.baseType; if(base==='resistor'||base==='potentiometer'){const b=getResistorBands(el.dataset.ohms); $('.graphic',el).style.backgroundImage=`linear-gradient(90deg,#d4a373 12%,${b[0]} 12% 22%,#d4a373 22% 38%,${b[1]} 38% 48%,#d4a373 48% 64%,${b[2]} 64% 74%,#d4a373 74% 88%,${b[3]} 88%)`;}
 if(base==='battery'||base==='dc')$('.batt-val',el).textContent=(el.dataset.voltage||'5')+'V'; if(base==='switch')el.classList.toggle('switch-on',el.dataset.closed==='true');
 if(base==='led'){const g=$('.led-graphic',el), c=g.dataset.color; const map={red:'#ef4444',green:'#22c55e',blue:'#3b82f6',rgb:'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)'}; g.style.background=map[c]||map.red; g.style.color=c==='green'?'#22c55e':c==='blue'?'#3b82f6':'#ef4444';}
}
function initInspector(){document.addEventListener('click',e=>{if(e.target===ws)clearSelection();});$('#modal-cancel').onclick=()=>$('#config-modal').style.display='none';$('#modal-save').onclick=saveModalConfig;}
function renderInspector(){const box=$('#inspectorBody'); if(!selectedComponent){box.innerHTML='부품을 선택하면 속성이 표시됩니다.<br><br>단축키: Delete 삭제, R 회전, Ctrl+D 복제, Esc 배선 취소';return;} const el=selectedComponent, base=el.dataset.baseType; let html=`<b>${el.dataset.type}</b><div class="prop-row"><span>ID</span><b>${el.dataset.compId}</b></div><div class="prop-row"><button class="tool-btn" onclick="rotateComponent(selectedComponent)">회전</button><button class="tool-btn danger" onclick="deleteComponent(selectedComponent)">삭제</button></div>`;
 if(base==='resistor'||base==='potentiometer')html+=prop('저항 Ω','ohms',el.dataset.ohms||220,'number'); if(base==='battery'||base==='dc')html+=prop('전압 V','voltage',el.dataset.voltage||5,'number'); if(base==='switch')html+=`<div class="prop-row"><span>스위치</span><select data-prop="closed"><option value="true" ${el.dataset.closed==='true'?'selected':''}>ON</option><option value="false" ${el.dataset.closed!=='true'?'selected':''}>OFF</option></select></div>`; if(base==='motor')html+=prop('RPM','rpm',el.dataset.rpm||120,'number');
 box.innerHTML=html; $$('[data-prop]',box).forEach(inp=>inp.onchange=()=>{selectedComponent.dataset[inp.dataset.prop]=inp.value;updateVisuals(selectedComponent);saveAuto();if(running)runSimulation();});}
function prop(label,key,val,type){return `<div class="prop-row"><span>${label}</span><input data-prop="${key}" type="${type}" value="${val}"></div>`;}
function openConfigModal(el){currentConfigEl=el; selectComponent(el); const b=el.dataset.baseType, body=$('#modal-body'), title=$('#modal-title'); title.textContent='부품 설정'; let html=''; if(b==='resistor'||b==='potentiometer')html=`<label>저항값 Ω</label><input id="cfgVal" type="number" value="${el.dataset.ohms||220}">`; else if(b==='battery'||b==='dc')html=`<label>전압 V</label><input id="cfgVal" type="number" step="0.1" value="${el.dataset.voltage||5}">`; else if(b==='switch')html=`<label>스위치</label><select id="cfgVal"><option value="true">ON</option><option value="false">OFF</option></select>`; else return; body.innerHTML=html; $('#config-modal').style.display='flex';}
function saveModalConfig(){if(!currentConfigEl)return; const v=$('#cfgVal').value, b=currentConfigEl.dataset.baseType; if(b==='resistor'||b==='potentiometer')currentConfigEl.dataset.ohms=v; if(b==='battery'||b==='dc')currentConfigEl.dataset.voltage=v; if(b==='switch')currentConfigEl.dataset.closed=v; updateVisuals(currentConfigEl); $('#config-modal').style.display='none'; renderInspector(); saveAuto(); if(running)runSimulation();}

function parseArduinoCode(){codePinStates={}; const code=$('#codeEditor').value; const re=/digitalWrite\s*\(\s*(\d+)\s*,\s*(HIGH|LOW)\s*\)/gi; let m; while((m=re.exec(code))) codePinStates['D'+m[1]]=m[2].toUpperCase()==='HIGH'; alert('코드 반영 완료: '+Object.entries(codePinStates).map(([k,v])=>`${k}=${v?'HIGH':'LOW'}`).join(', '));}
function componentOfPin(pin){return pin.closest('.workspace-component');}
function pinName(pin){return pin.dataset.name;}

function nearestBreadboardHoleToPoint(x,y,maxDist=13){
  let best=null, bd=maxDist;
  $$('.comp-breadboard .pin',world).forEach(h=>{
    const hp=pinPos(h);
    const d=Math.hypot(x-hp.x,y-hp.y);
    if(d<bd){bd=d;best=h;}
  });
  return best;
}
function updateBreadboardContactVisuals(){
  $$('.pin.contact-pin',world).forEach(p=>p.classList.remove('contact-pin'));
  $$('.workspace-component',world).forEach(comp=>{
    if(['breadboard','route'].includes(comp.dataset.baseType)) return;
    $$('.pin',comp).forEach(cp=>{
      const near=nearestBreadboardHole(cp,28);
      if(near){ cp.classList.add('contact-pin'); near.classList.add('contact-pin'); }
    });
  });
}

function buildGraph(){
  const nodes=new Map();
  const add=(a,b)=>{if(!nodes.has(a))nodes.set(a,new Set());nodes.get(a).add(b);};

  // User-drawn wires
  $$('line',svg).forEach(l=>{
    if(l.startPin&&l.endPin){ add(l.startPin,l.endPin); add(l.endPin,l.startPin); }
  });


  // Component internal conductivity.
  // Resistors and potentiometers conduct between their two legs, so a normal
  // battery -> resistor -> LED -> ground loop can be detected. Closed switches
  // also conduct; open switches intentionally do not.
  $$('.workspace-component', world).forEach(comp=>{
    const base = comp.dataset.baseType;
    const pins = $$('.pin', comp);
    if((base === 'resistor' || base === 'potentiometer') && pins.length >= 2){
      add(pins[0], pins[1]);
      add(pins[1], pins[0]);
    }
    if(base === 'switch' && comp.dataset.closed === 'true' && pins.length >= 2){
      add(pins[0], pins[1]);
      add(pins[1], pins[0]);
    }
  });

  // Breadboard internal metal strips.
  // a-e are connected vertically by each column, f-j are connected vertically by each column.
  // Power rails are connected horizontally and split left/right like a real breadboard.
  $$('.comp-breadboard',world).forEach(bb=>{
    const groups={};
    $$('.pin',bb).forEach(p=>{
      const name=p.dataset.name||'';
      let key=null;
      if(/^a[0-4]-/.test(name)) key='top-'+name.split('-')[1];
      if(/^f[0-4]-/.test(name)) key='bottom-'+name.split('-')[1];
      const m=name.match(/^(railTopPlus|railTopMinus|railBotPlus|railBotMinus)-(\d+)$/);
      if(m){ key=m[1]; }
      if(key){ (groups[key] ||= []).push(p); }
    });
    Object.values(groups).forEach(group=>{
      for(let i=0;i<group.length;i++){
        for(let j=i+1;j<group.length;j++){ add(group[i],group[j]); add(group[j],group[i]); }
      }
    });
  });

  // Components physically plugged into breadboard holes.
  // If a component pin is sitting on top of a breadboard hole, treat it as connected
  // even without drawing a separate wire. This makes resistors/LEDs behave like
  // real breadboard parts when they are dropped onto the board.
  const breadPins = $$('.comp-breadboard .pin', world);
  $$('.workspace-component', world).forEach(comp=>{
    if(['breadboard','route'].includes(comp.dataset.baseType)) return;
    $$('.pin', comp).forEach(cp=>{
      const near = nearestBreadboardHole(cp, 28);
      if(near){
        add(cp, near);
        add(near, cp);
      }
    });
  });

  return nodes;
}
function reachable(graph,start,target,blocked=new Set()){const q=[start],seen=new Set([start]); while(q.length){const p=q.shift(); if(p===target)return true; for(const n of graph.get(p)||[]) if(!seen.has(n)&&!blocked.has(n)){seen.add(n);q.push(n);} } return false;}
function runSimulation(){
  running=true;
  $('#simStatus').textContent='실행중';
  $('#simStatus').className='status running';
  $$('#wire-svg line').forEach(l=>l.classList.remove('powered-wire'));
  $$('.led-graphic').forEach(g=>g.classList.remove('led-on','led-burn'));
  $$('.motor-dc-graphic,.motor-servo-graphic').forEach(g=>g.classList.remove('motor-on'));
  $$('.buzzer-graphic').forEach(g=>g.classList.remove('buzz-on'));

  updateBreadboardContactVisuals();
  const graph=buildGraph();
  let messages=[];
  let batteries=$$('.workspace-component').filter(c=>['battery','dc'].includes(c.dataset.baseType));

  batteries.forEach(b=>{
    const bp=$$('.pin',b);
    const vcc=bp.find(p=>pinName(p)==='vcc');
    const gnd=bp.find(p=>pinName(p)==='gnd');
    const V=parseFloat(b.dataset.voltage)||5;
    if(!vcc||!gnd)return;

    $$('.workspace-component').forEach(comp=>{
      const base=comp.dataset.baseType;

      if(base==='led'){
        const pins=$$('.pin',comp);
        const a=pins.find(p=>pinName(p)==='a');
        const k=pins.find(p=>pinName(p)==='k');
        if(!a||!k)return;

        // Accept both LED directions visually, but show a warning if reversed.
        const normal = reachable(graph,vcc,a) && reachable(graph,k,gnd);
        const reversed = reachable(graph,vcc,k) && reachable(graph,a,gnd);
        if(normal || reversed){
          let r = findSeriesResistance(graph, normal ? a : k, vcc) + findSeriesResistance(graph, normal ? k : a, gnd);
          let current = r>0 ? Math.max(0,(V-2)/r) : 0.02; // no resistor still lights for beginner use
          const led=$('.led-graphic',comp);
          if(r===0 && V>5){
            led.classList.add('led-burn');
            messages.push('LED 과전류 위험: 저항을 추가하세요');
          }else{
            led.classList.add('led-on');
            markPath(graph,vcc,normal?a:k);
            markPath(graph,normal?k:a,gnd);
            messages.push(`${reversed?'LED 방향 반대지만 ':''}LED ON / 약 ${(current*1000).toFixed(1)}mA`);
          }
        }
      }

      if(base==='motor'||base==='buzzer'){
        const p=$$('.pin',comp), p1=p.find(x=>pinName(x)==='p1'), p2=p.find(x=>pinName(x)==='p2');
        if(p1&&p2&&((reachable(graph,vcc,p1)&&reachable(graph,p2,gnd))||(reachable(graph,vcc,p2)&&reachable(graph,p1,gnd)))){
          markPath(graph,vcc,p1); markPath(graph,p2,gnd);
          const g=$('.graphic',comp);
          if(base==='motor')g.classList.add('motor-on');
          if(base==='buzzer')g.classList.add('buzz-on');
          messages.push(`${comp.dataset.type} 동작`);
        }
      }
    });
  });

  applyArduinoOutputs(graph,messages);
  $('#electricInfo').textContent=messages.length?messages.slice(0,3).join(' · '):'닫힌 회로를 찾지 못했습니다';
  saveAuto();
}
function stopSimulation(){running=false; $('#simStatus').textContent='정지됨'; $('#simStatus').className='status idle'; $('#electricInfo').textContent='전압/전류 계산 대기중'; $$('#wire-svg line').forEach(l=>l.classList.remove('powered-wire')); $$('.led-graphic').forEach(g=>g.classList.remove('led-on','led-burn')); $$('.graphic').forEach(g=>g.classList.remove('motor-on','buzz-on'));}
function findSeriesResistance(graph,start,end){let sum=0; $$('.workspace-component').forEach(c=>{if(['resistor','potentiometer'].includes(c.dataset.baseType)){const [p1,p2]=$$('.pin',c); if((reachable(graph,start,p1,new Set([p2]))&&reachable(graph,p2,end,new Set([p1])))||(reachable(graph,start,p2,new Set([p1]))&&reachable(graph,p1,end,new Set([p2])))) sum+=parseFloat(c.dataset.ohms)||0;}}); return sum;}
function markPath(graph,start,end){for(const l of $$('line',svg)){ if(!l.startPin||!l.endPin)continue; if(reachable(graph,start,l.startPin)&&reachable(graph,l.endPin,end) || reachable(graph,start,l.endPin)&&reachable(graph,l.startPin,end)) l.classList.add('powered-wire'); }}
function applyArduinoOutputs(graph,messages){const arduinos=$$('.workspace-component').filter(c=>c.dataset.baseType==='arduino'); arduinos.forEach(a=>{Object.entries(codePinStates).forEach(([pin,state])=>{if(!state)return; const out=$$('.pin',a).find(p=>pinName(p)===pin), gnd=$$('.pin',a).find(p=>pinName(p)==='GND'); if(!out||!gnd)return; $$('.workspace-component').filter(c=>c.dataset.baseType==='led').forEach(ledc=>{const an=$$('.pin',ledc).find(p=>pinName(p)==='a'), ca=$$('.pin',ledc).find(p=>pinName(p)==='k'); if(reachable(graph,out,an)&&reachable(graph,ca,gnd)){ $('.led-graphic',ledc).classList.add('led-on'); markPath(graph,out,an); markPath(graph,ca,gnd); messages.push(`Arduino ${pin} LED ON`); }});});});}

function serialize(){return {components:$$('.workspace-component',world).map(c=>({type:c.dataset.type,base:c.dataset.baseType,id:c.dataset.compId,x:parseFloat(c.style.left),y:parseFloat(c.style.top),rot:c.dataset.rotation||0,data:{...c.dataset}})), wires:$$('line',svg).filter(l=>l.startPin&&l.endPin).map(l=>({a:l.startPin.dataset.pinId,b:l.endPin.dataset.pinId,color:l.getAttribute('stroke')})), code:$('#codeEditor').value};}
function clearCircuit(){ $$('.workspace-component',world).forEach(c=>c.remove()); svg.innerHTML=''; selectedComponent=null; selectedLine=null; renderInspector(); stopSimulation(); saveAuto();}
function deserialize(data){clearCircuit(); const pinMap={}; data.components?.forEach(o=>{const c=addComponentToWorkspace(o.type,o.x,o.y); Object.assign(c.dataset,o.data||{}); c.dataset.compId=o.id||c.dataset.compId; c.dataset.rotation=o.rot||0; c.style.rotate=(o.rot||0)+'deg'; updateVisuals(c); $$('.pin',c).forEach((p,i)=>{const old=data.components.find(x=>x.id==c.dataset.compId); pinMap[p.dataset.pinId]=p;});});
 // better map by order after recreating
 const allPins=$$('.pin',world); let i=0; data.components?.forEach(o=>{const comp=$$('.workspace-component',world).find(c=>c.dataset.compId==o.id); $$('.pin',comp).forEach(p=>{ if(o.pinIds&&o.pinIds[i]) pinMap[o.pinIds[i]]=p; });});
 // fallback: original export below includes pin names compound
 const pinByKey={}; $$('.workspace-component',world).forEach(c=>$$('.pin',c).forEach(p=>pinByKey[c.dataset.compId+':'+p.dataset.name]=p)); (data.wires||[]).forEach(w=>{let a=pinByKey[w.ak]||allPins[w.ai], b=pinByKey[w.bk]||allPins[w.bi]; if(a&&b)connectPins(a,b,w.color);}); $('#codeEditor').value=data.code||$('#codeEditor').value; saveAuto();}
function serializeV2(){return {components:$$('.workspace-component',world).map(c=>({type:c.dataset.type,id:c.dataset.compId,x:parseFloat(c.style.left),y:parseFloat(c.style.top),rot:c.dataset.rotation||0,data:{...c.dataset}})), wires:$$('line',svg).filter(l=>l.startPin&&l.endPin).map(l=>({ak:componentOfPin(l.startPin).dataset.compId+':'+l.startPin.dataset.name,bk:componentOfPin(l.endPin).dataset.compId+':'+l.endPin.dataset.name,color:l.getAttribute('stroke')})), code:$('#codeEditor').value};}
function saveCircuit(){localStorage.setItem('circuitAIProjectV9',JSON.stringify(serializeV2())); alert('저장 완료');}
function saveAuto(){localStorage.setItem('circuitAIProjectAutoV9',JSON.stringify(serializeV2()));}
function autoLoad(){const d=localStorage.getItem('circuitAIProjectAutoV9'); if(d)try{deserialize(JSON.parse(d));}catch(e){}}
function loadCircuit(){const d=localStorage.getItem('circuitAIProjectV9')||localStorage.getItem('circuitAIProjectAutoV9'); if(!d)return alert('저장된 회로가 없습니다.'); deserialize(JSON.parse(d));}
function exportCircuit(){const blob=new Blob([JSON.stringify(serializeV2(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='circuitai-project-v9.json'; a.click(); URL.revokeObjectURL(a.href);}
function importCircuit(file){if(!file)return; const r=new FileReader(); r.onload=()=>deserialize(JSON.parse(r.result)); r.readAsText(file);}
function connectPins(a,b,color='#334155'){const p1=pinPos(a),p2=pinPos(b); const line=document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1',p1.x);line.setAttribute('y1',p1.y);line.setAttribute('x2',p2.x);line.setAttribute('y2',p2.y);line.setAttribute('stroke',color);line.setAttribute('stroke-width','5');line.setAttribute('stroke-linecap','round'); line.startPin=a; line.endPin=b; line.isConnected=true; line.style.pointerEvents='stroke'; a.lines.push(line); b.lines.push(line); svg.appendChild(line);}

function initChatbot(){const fab=$('#chatbot-fab'), nav=$('#nav-ai-chat'), win=$('#chatbot-window'), close=$('#close-chat'), input=$('#chat-input'), send=$('#chat-send'), msgs=$('#chat-messages'); const toggle=()=>{win.style.display=win.style.display==='flex'?'none':'flex'; if(msgs.children.length===0)msg('안녕하세요! “LED 회로”, “아두이노 13번 LED”, “버튼 LED”, “모터 회로”라고 입력해보세요.','ai');}; fab.onclick=toggle; nav.onclick=toggle; close.onclick=()=>win.style.display='none'; send.onclick=go; input.onkeydown=e=>{if(e.key==='Enter')go();}; function go(){const v=input.value.trim(); if(!v)return; msg(v,'user'); input.value=''; setTimeout(()=>{const reply=processAICircuit(v); msg(reply||'요청한 회로를 자동 배치했습니다. 시뮬레이션 시작 버튼을 눌러 확인하세요.','ai');},300);} function msg(t,type){const d=document.createElement('div');d.className=`chat-bubble chat-${type}`;d.textContent=t;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;}}
window.processAICircuit=function(q){const cx=360, cy=230; q=q.toLowerCase(); if(q.includes('아두이노')||q.includes('arduino')){clearCircuit(); const ar=addComponentToWorkspace('arduino',cx-260,cy-80), r=addComponentToWorkspace('resistor',cx+40,cy-20), led=addComponentToWorkspace('led-red',cx+190,cy-25); setTimeout(()=>{connectPins($$('.pin',ar).find(p=>pinName(p)==='D13'),$$('.pin',r)[0]);connectPins($$('.pin',r)[1],$$('.pin',led).find(p=>pinName(p)==='a'));connectPins($$('.pin',led).find(p=>pinName(p)==='k'),$$('.pin',ar).find(p=>pinName(p)==='GND'));$('#codeEditor').value='void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n}';parseArduinoCode();},50);}
 else if(q.includes('button')||q.includes('버튼')){clearCircuit(); const b=addComponentToWorkspace('battery-9v',cx-230,cy), sw=addComponentToWorkspace('switch-push',cx-60,cy+10), r=addComponentToWorkspace('resistor',cx+80,cy+20), led=addComponentToWorkspace('led-green',cx+230,cy); sw.dataset.closed='true'; updateVisuals(sw); setTimeout(()=>{connectPins($$('.pin',b).find(p=>pinName(p)==='vcc'),$$('.pin',sw)[0]);connectPins($$('.pin',sw)[1],$$('.pin',r)[0]);connectPins($$('.pin',r)[1],$$('.pin',led).find(p=>pinName(p)==='a'));connectPins($$('.pin',led).find(p=>pinName(p)==='k'),$$('.pin',b).find(p=>pinName(p)==='gnd'));},50);}
 else if(q.includes('motor')||q.includes('모터')){clearCircuit(); const b=addComponentToWorkspace('battery-9v',cx-150,cy), m=addComponentToWorkspace('motor-dc',cx+80,cy); setTimeout(()=>{connectPins($$('.pin',b).find(p=>pinName(p)==='vcc'),$$('.pin',m).find(p=>pinName(p)==='p1'));connectPins($$('.pin',m).find(p=>pinName(p)==='p2'),$$('.pin',b).find(p=>pinName(p)==='gnd'));},50);}
 else {clearCircuit(); const b=addComponentToWorkspace('battery-9v',cx-200,cy), r=addComponentToWorkspace('resistor',cx,cy+15), led=addComponentToWorkspace('led-red',cx+170,cy); setTimeout(()=>{connectPins($$('.pin',b).find(p=>pinName(p)==='vcc'),$$('.pin',r)[0]);connectPins($$('.pin',r)[1],$$('.pin',led).find(p=>pinName(p)==='a'));connectPins($$('.pin',led).find(p=>pinName(p)==='k'),$$('.pin',b).find(p=>pinName(p)==='gnd'));},50);} };


// ---------- v3 안정화 패치: AI 회로 자동생성 다양화 + 배선 버그 보정 ----------
function pinByName(comp, name){ return $$('.pin',comp).find(p=>pinName(p)===name); }
function pinsOf(comp){ return $$('.pin',comp); }
function wire(a,b){ if(a&&b) connectPins(a,b); }
function setClosed(sw, val=true){ if(sw){sw.dataset.closed=String(val); updateVisuals(sw);} }
function setRes(r, ohm){ if(r){r.dataset.ohms=String(ohm); updateVisuals(r);} }
function placeBreadboardCircuit(kind){
  clearCircuit();
  const bb=addComponentToWorkspace('breadboard-small',310,245);
  const bat=addComponentToWorkspace('battery-9v',80,130);
  const led=addComponentToWorkspace(kind==='and'?'led-green':'led-red',520,190);
  const r=addComponentToWorkspace('resistor',405,185); setRes(r,220);
  if(kind==='and'){
    const sw1=addComponentToWorkspace('switch-push',210,160), sw2=addComponentToWorkspace('switch-push',305,160); setClosed(sw1,true); setClosed(sw2,true);
    setTimeout(()=>{ wire(pinByName(bat,'vcc'), pinsOf(sw1)[0]); wire(pinsOf(sw1)[1], pinsOf(sw2)[0]); wire(pinsOf(sw2)[1], pinsOf(r)[0]); wire(pinsOf(r)[1], pinByName(led,'a')); wire(pinByName(led,'k'), pinByName(bat,'gnd')); },30);
    return '브레드보드 AND 회로로 배치했습니다. 두 버튼이 모두 닫혀야 LED가 켜지는 직렬 회로입니다.';
  }
  if(kind==='or'){
    const sw1=addComponentToWorkspace('switch-push',230,145), sw2=addComponentToWorkspace('switch-push',230,225); setClosed(sw1,true); setClosed(sw2,false);
    setTimeout(()=>{ wire(pinByName(bat,'vcc'), pinsOf(sw1)[0]); wire(pinByName(bat,'vcc'), pinsOf(sw2)[0]); wire(pinsOf(sw1)[1], pinsOf(r)[0]); wire(pinsOf(sw2)[1], pinsOf(r)[0]); wire(pinsOf(r)[1], pinByName(led,'a')); wire(pinByName(led,'k'), pinByName(bat,'gnd')); },30);
    return '브레드보드 OR 회로로 배치했습니다. 두 버튼 중 하나만 닫혀도 LED가 켜지는 병렬 스위치 회로입니다.';
  }
  setTimeout(()=>{ wire(pinByName(bat,'vcc'), pinsOf(r)[0]); wire(pinsOf(r)[1], pinByName(led,'a')); wire(pinByName(led,'k'), pinByName(bat,'gnd')); },30);
  return '브레드보드 위에 기본 LED 회로를 배치했습니다. 9V → 저항 → LED → GND 순서입니다.';
}

window.processAICircuit=function(q){
  const raw=q; q=(q||'').toLowerCase();
  const wantsBread=q.includes('브레드')||q.includes('bread');
  if(q.includes('and')||q.includes('그리고')) return placeBreadboardCircuit('and');
  if(q.includes('or')||q.includes('또는')) return placeBreadboardCircuit('or');
  if(q.includes('not')||q.includes('반전')||q.includes('인버터')){
    clearCircuit();
    const bat=addComponentToWorkspace('battery-9v',80,180), sw=addComponentToWorkspace('switch-slide',245,190), r=addComponentToWorkspace('resistor',380,200), led=addComponentToWorkspace('led-blue',520,180); setRes(r,330); setClosed(sw,false);
    setTimeout(()=>{wire(pinByName(bat,'vcc'),pinsOf(r)[0]);wire(pinsOf(r)[1],pinByName(led,'a'));wire(pinByName(led,'k'),pinsOf(sw)[0]);wire(pinsOf(sw)[1],pinByName(bat,'gnd'));},30);
    return 'NOT 느낌의 반전 예제 회로를 배치했습니다. 스위치를 더블클릭해서 열림/닫힘을 바꿔 확인하세요.';
  }
  if(q.includes('아두이노')||q.includes('arduino')||q.includes('13번')){
    clearCircuit();
    const ar=addComponentToWorkspace('arduino',100,110), r=addComponentToWorkspace('resistor',390,170), led=addComponentToWorkspace('led-red',530,150); setRes(r,220);
    setTimeout(()=>{wire(pinByName(ar,'D13'),pinsOf(r)[0]);wire(pinsOf(r)[1],pinByName(led,'a'));wire(pinByName(led,'k'),pinByName(ar,'GND'));$('#codeEditor').value='void setup() {\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, HIGH);\n}';parseArduinoCode();},30);
    return '아두이노 13번 핀 LED 회로를 배치했습니다. 코드 업로드 또는 시뮬레이션 시작을 누르면 LED가 켜집니다.';
  }
  if(q.includes('서보')){
    clearCircuit(); const ar=addComponentToWorkspace('arduino',90,120), sv=addComponentToWorkspace('motor-servo',410,160);
    setTimeout(()=>{wire(pinByName(ar,'5V'),pinByName(sv,'p1'));wire(pinByName(ar,'GND'),pinByName(sv,'p2'));wire(pinByName(ar,'D9'),pinByName(sv,'sig'));},30);
    return '서보 모터 회로를 배치했습니다. 5V, GND, 신호선 D9 구조입니다.';
  }
  if(q.includes('모터')||q.includes('dc motor')||q.includes('motor')){
    clearCircuit(); const bat=addComponentToWorkspace('battery-9v',90,170), sw=addComponentToWorkspace('switch-slide',270,190), m=addComponentToWorkspace('motor-dc',470,165); setClosed(sw,true);
    setTimeout(()=>{wire(pinByName(bat,'vcc'),pinsOf(sw)[0]);wire(pinsOf(sw)[1],pinByName(m,'p1'));wire(pinByName(m,'p2'),pinByName(bat,'gnd'));},30);
    return 'DC 모터 회로를 배치했습니다. 스위치를 더블클릭하면 ON/OFF가 바뀝니다.';
  }
  if(q.includes('버튼')||q.includes('button')||q.includes('스위치')){
    clearCircuit(); const bat=addComponentToWorkspace('battery-9v',80,170), sw=addComponentToWorkspace('switch-push',250,190), r=addComponentToWorkspace('resistor',390,200), led=addComponentToWorkspace('led-green',540,180); setClosed(sw,true); setRes(r,220);
    setTimeout(()=>{wire(pinByName(bat,'vcc'),pinsOf(sw)[0]);wire(pinsOf(sw)[1],pinsOf(r)[0]);wire(pinsOf(r)[1],pinByName(led,'a'));wire(pinByName(led,'k'),pinByName(bat,'gnd'));},30);
    return '버튼 LED 회로를 배치했습니다. 버튼을 더블클릭하면 열림/닫힘 상태가 바뀝니다.';
  }
  if(q.includes('rgb')){
    clearCircuit(); const bat=addComponentToWorkspace('battery-3v',90,180), r=addComponentToWorkspace('resistor',290,195), led=addComponentToWorkspace('led-rgb',460,175); setRes(r,150);
    setTimeout(()=>{wire(pinByName(bat,'vcc'),pinsOf(r)[0]);wire(pinsOf(r)[1],pinByName(led,'a'));wire(pinByName(led,'k'),pinByName(bat,'gnd'));},30);
    return 'RGB LED 기본 회로를 배치했습니다. 현재는 단일 LED처럼 켜짐 효과가 적용됩니다.';
  }
  return placeBreadboardCircuit(wantsBread?'basic':'basic');
};

// v9 REAL FINAL: original simulator logic kept, UI/board/wire/simulation patched.
