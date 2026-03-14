

/* ================================================================
   Myllo — fuck this
   ================================================================ */

/* ── State ── */
var COLS=8,ROWS=8,CELL=40;
var layers=[];
var activeLayer=0;
var _layerIdCounter=1;

function mkLayer(name){
  return{id:_layerIdCounter++,name:name||'Layer '+_layerIdCounter,
    pixels:new Array(COLS*ROWS).fill(null),opacity:1,visible:true};
}

Object.defineProperty(window,'pixels',{
  get:function(){return layers[activeLayer]?layers[activeLayer].pixels:[];},
  set:function(v){if(layers[activeLayer])layers[activeLayer].pixels=v;}
});

var undoStack=[];
var palette=['#111111','#ffffff','#ff6b35','#00d4ff','#ff3a5e','#a8e063','#ffd700','#8b5cf6','#f97316','#06b6d4'];
var library=[];
var currentColor=palette[0];
var currentTool='paint';
var vpScale=1,vpX=0,vpY=0;
var isDragPainting=false;
var selectRect=null,selectActive=false,selectMode='idle';
var selectDrawStart=null,selectHandleIdx=-1;
var selectDragAnchor=null,selectInitRect=null;
var selectMoveAnchor=null,selectMoveInitRect=null;
var clipboard=null;
var pasteRect=null,pasteDragAnchor=null,pasteMoveInitRect=null;
var moveActive=false,moveInitPixels=null,movePixelsBase=null;
var ghostData=null,viewMode=false;
var textFontSize=12,textColor='#ffffff',textPending=null;
var cursorCol=0,cursorRow=0,cursorVisible=false;
var exportScaleMode='auto';
var _pinchDist=0,_pinchActive=false;
var _lastPaintPos=null;
var _layerPanelVisibleBeforePopup=false;

/* ── DOM ── */
var canvas=document.getElementById('pixelCanvas');
var ctx=canvas.getContext('2d');
var canvasWrap=document.getElementById('canvasWrap');
var canvasArea=document.getElementById('canvasArea');
var coordsEl=document.getElementById('coords');
var colorSwatch=document.getElementById('colorSwatch');
var colorPicker=document.getElementById('colorPicker');
var colorHex=document.getElementById('colorHex');
var textInput=document.getElementById('textInput');
var pasteToolbar=document.getElementById('pasteToolbar');
var layerPanel=document.getElementById('layerPanel');
var exportMenu=document.getElementById('exportMenu');

/* ── Helpers ── */
function isMobile(){return window.innerWidth<=700;}
function idx(col,row){return row*COLS+col;}
function inBounds(col,row){return col>=0&&col<COLS&&row>=0&&row<ROWS;}

/* ═══════════════════════════════════
   SETUP MODAL
═══════════════════════════════════ */
(function(){
  var btns=document.querySelectorAll('.sg-btn');
  var pi=document.getElementById('previewInfo');
  function setPreview(w,h){
    COLS=w;ROWS=h;
    pi.textContent=w+' × '+h+' pixels — '+(w*h)+' cells';
    btns.forEach(function(b){b.classList.toggle('active',+b.dataset.val===w&&w===h);});
  }
  btns.forEach(function(b){b.addEventListener('click',function(){
    setPreview(+b.dataset.val,+b.dataset.val);
    document.getElementById('customW').value='';document.getElementById('customH').value='';
  });});
  document.getElementById('customApply').addEventListener('click',function(){
    var w=parseInt(document.getElementById('customW').value)||0;
    var h=parseInt(document.getElementById('customH').value)||0;
    if(w>=2&&h>=2&&w<=128&&h<=128)setPreview(w,h);
  });
  document.getElementById('startBtn').addEventListener('click',function(){
    document.getElementById('setupModal').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initCanvas(COLS,ROWS);
  });
})();

/* ═══════════════════════════════════
   INIT
═══════════════════════════════════ */
function initCanvas(cols,rows){
  COLS=cols;ROWS=rows;
  layers=[mkLayer('Layer 1')];
  activeLayer=0;undoStack=[];ghostData=null;
  selectRect=null;selectActive=false;selectMode='idle';
  pasteRect=null;clipboard=null;moveActive=false;
  cursorCol=0;cursorRow=0;cursorVisible=false;
  document.getElementById('selectToggleBtn').classList.remove('active');
  document.getElementById('moveToggleBtn').classList.remove('active');
  hidePasteToolbar();
  // Hide layer panel by default
  layerPanel.style.display='none';
  document.getElementById('layerPanelToggleBtn').classList.remove('active');
  autoFitZoom();renderAll();
  buildPaletteUI();
  setColor(palette[0]||'#111111');
  syncMobSelectBtns();
  updateExportPreview();
  buildLayerPanel();
}

function autoFitZoom(){
  var pad=60;
  var areaW=canvasArea.clientWidth-pad;
  var areaH=canvasArea.clientHeight-pad;
  vpScale=Math.max(0.25,Math.min(24,Math.min(areaW/(COLS*CELL),areaH/(ROWS*CELL))));
  centerCanvas();
}

function centerCanvas(){
  vpX=Math.round((canvasArea.clientWidth-COLS*CELL*vpScale)/2);
  vpY=Math.round((canvasArea.clientHeight-ROWS*CELL*vpScale)/2);
  applyTransform();
}

function applyTransform(){
  canvasWrap.style.transform='translate('+vpX+'px,'+vpY+'px) scale('+vpScale+')';
  canvasWrap.style.transformOrigin='0 0';
  document.getElementById('zoomLbl').textContent=Math.round(vpScale*100)+'%';
}

/* ═══════════════════════════════════
   RENDER
═══════════════════════════════════ */
function renderAll(){
  var dpr=window.devicePixelRatio||1;
  var logW=COLS*CELL,logH=ROWS*CELL;
  canvas.width=logW*dpr;canvas.height=logH*dpr;
  canvas.style.width=logW+'px';canvas.style.height=logH+'px';
  ctx.save();ctx.scale(dpr,dpr);

  // White base
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,logW,logH);

  // Layers bottom to top (index 0 = top visually, render reversed)
  for(var li=layers.length-1;li>=0;li--){
    var lay=layers[li];
    if(!lay.visible)continue;
    ctx.save();ctx.globalAlpha=lay.opacity;
    var px=lay.pixels;
    for(var i=0;i<px.length;i++){
      if(!px[i])continue;
      ctx.fillStyle=px[i];
      ctx.fillRect((i%COLS)*CELL,Math.floor(i/COLS)*CELL,CELL,CELL);
    }
    ctx.restore();
  }

  // Ghost overlay
  if(ghostData){
    ctx.save();ctx.globalAlpha=0.28;
    for(var gi=0;gi<ghostData.length;gi++){
      if(!ghostData[gi])continue;
      ctx.fillStyle=ghostData[gi];
      ctx.fillRect((gi%COLS)*CELL,Math.floor(gi/COLS)*CELL,CELL,CELL);
    }
    ctx.restore();
  }

  // Grid (edit mode only)
  if(!viewMode){
    ctx.strokeStyle='rgba(0,0,0,0.12)';ctx.lineWidth=0.5;
    for(var c=0;c<=COLS;c++){ctx.beginPath();ctx.moveTo(c*CELL,0);ctx.lineTo(c*CELL,logH);ctx.stroke();}
    for(var r=0;r<=ROWS;r++){ctx.beginPath();ctx.moveTo(0,r*CELL);ctx.lineTo(logW,r*CELL);ctx.stroke();}
  }

  if(selectActive&&selectRect)drawSelectOverlay();
  if(cursorVisible&&!viewMode)drawWASDCursor();
  ctx.restore();
}

function drawSelectOverlay(){
  var s=selectRect;
  var x=s.col*CELL,y=s.row*CELL,w=s.cols*CELL,h=s.rows*CELL;
  var logW=COLS*CELL,logH=ROWS*CELL;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.35)';ctx.fillRect(0,0,logW,logH);
  ctx.fillStyle='#ffffff';ctx.fillRect(x,y,w,h);
  for(var i=0;i<pixels.length;i++){
    if(!pixels[i])continue;
    var pc=i%COLS,pr=Math.floor(i/COLS);
    if(pc<s.col||pc>=s.col+s.cols||pr<s.row||pr>=s.row+s.rows)continue;
    ctx.fillStyle=pixels[i];ctx.fillRect(pc*CELL,pr*CELL,CELL,CELL);
  }
  var t=(Date.now()/60)%20;
  ctx.strokeStyle='#00d4ff';ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.lineDashOffset=-t;
  ctx.strokeRect(x+1,y+1,w-2,h-2);ctx.setLineDash([]);ctx.lineDashOffset=0;

  var HR=isMobile()?CELL*0.75:CELL*0.55;
  [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].forEach(function(pt){
    ctx.beginPath();ctx.arc(pt[0],pt[1],HR,0,Math.PI*2);
    ctx.fillStyle='#fff';ctx.fill();
    ctx.strokeStyle='#00d4ff';ctx.lineWidth=2;ctx.stroke();
  });
  ctx.font='bold 10px "Space Mono",monospace';
  ctx.fillStyle='#00d4ff';ctx.textAlign='center';ctx.textBaseline='top';
  ctx.shadowColor='#000';ctx.shadowBlur=3;
  ctx.fillText(s.cols+'×'+s.rows,x+w/2,y+h+4);
  ctx.shadowBlur=0;ctx.restore();

  if(selectMode==='pasting'&&pasteRect&&clipboard)drawPasteGhost();
}

function drawPasteGhost(){
  var p=pasteRect;
  ctx.save();ctx.globalAlpha=0.75;
  for(var r=0;r<p.rows;r++)for(var c=0;c<p.cols;c++){
    var pi=r*clipboard.cols+c;
    if(!clipboard.pixels[pi])continue;
    ctx.fillStyle=clipboard.pixels[pi];
    ctx.fillRect((p.col+c)*CELL,(p.row+r)*CELL,CELL,CELL);
  }
  ctx.globalAlpha=1;
  ctx.strokeStyle='#ff6b35';ctx.lineWidth=2;ctx.setLineDash([4,3]);
  ctx.strokeRect(p.col*CELL+1,p.row*CELL+1,p.cols*CELL-2,p.rows*CELL-2);
  ctx.setLineDash([]);ctx.restore();
}

// Marching ants animation
var _antsLast=0;
(function march(ts){
  requestAnimationFrame(march);
  if((!selectActive||!selectRect)&&selectMode!=='pasting')return;
  if(ts-_antsLast<50)return;
  _antsLast=ts;renderAll();
})(0);

function drawWASDCursor(){
  var x=cursorCol*CELL,y=cursorRow*CELL;
  ctx.save();
  ctx.strokeStyle='#ff6b35';ctx.lineWidth=3;ctx.strokeRect(x+1.5,y+1.5,CELL-3,CELL-3);
  ctx.strokeStyle='rgba(255,255,255,0.85)';ctx.lineWidth=1.2;ctx.strokeRect(x+4,y+4,CELL-8,CELL-8);
  ctx.restore();
}

/* ═══════════════════════════════════
   PAINT TOOLS
═══════════════════════════════════ */
function paintAt(col,row){
  if(!inBounds(col,row))return;
  var i=idx(col,row);
  if(currentTool==='paint')pixels[i]=currentColor;
  else if(currentTool==='erase')pixels[i]=null;
  renderAll();schedSave();
}

function paintLine(c1,r1,c2,r2){
  var dx=Math.abs(c2-c1),dy=Math.abs(r2-r1);
  var sx=c1<c2?1:-1,sy=r1<r2?1:-1,err=dx-dy;
  while(true){
    paintAt(c1,r1);
    if(c1===c2&&r1===r2)break;
    var e2=2*err;
    if(e2>-dy){err-=dy;c1+=sx;}
    if(e2<dx){err+=dx;r1+=sy;}
  }
}

function floodFill(col,row){
  if(!inBounds(col,row))return;
  var target=pixels[idx(col,row)]||null;
  if(target===currentColor)return;
  saveHistory();
  var stack=[[col,row]],visited=new Uint8Array(COLS*ROWS);
  while(stack.length){
    var pt=stack.pop(),c=pt[0],r=pt[1];
    if(!inBounds(c,r))continue;
    var pi=idx(c,r);
    if(visited[pi])continue;visited[pi]=1;
    if((pixels[pi]||null)!==target)continue;
    pixels[pi]=currentColor;
    stack.push([c+1,r],[c-1,r],[c,r+1],[c,r-1]);
  }
  renderAll();schedSave();
}

function eyedropAt(col,row){
  if(!inBounds(col,row)||!pixels[idx(col,row)])return;
  setColor(pixels[idx(col,row)]);
}

/* ── Color ── */
function setColor(hex){
  currentColor=hex;
  colorSwatch.style.background=hex;
  colorPicker.value=hex;
  colorHex.value=hex;
  document.querySelectorAll('.pal-swatch').forEach(function(s){s.classList.toggle('active',s.dataset.color===hex);});
}
colorPicker.addEventListener('input',function(){setColor(this.value);});
colorHex.addEventListener('keydown',function(e){if(e.key==='Enter'){var v=this.value.trim();if(/^#[0-9a-fA-F]{6}$/.test(v))setColor(v);}});
colorHex.addEventListener('blur',function(){var v=this.value.trim();if(/^#[0-9a-fA-F]{6}$/.test(v))setColor(v);});

/* ── Palette ── */
function buildPaletteUI(){
  var pal=document.getElementById('palette');pal.innerHTML='';
  palette.forEach(function(c){
    var s=document.createElement('div');
    s.className='pal-swatch'+(c===currentColor?' active':'');
    s.style.background=c;s.dataset.color=c;s.title=c;
    s.addEventListener('click',function(){setColor(c);});
    s.addEventListener('contextmenu',function(e){
      e.preventDefault();
      palette=palette.filter(function(p){return p!==c;});
      if(currentColor===c&&palette.length>0)setColor(palette[0]);
      buildPaletteUI();
    });
    pal.appendChild(s);
  });
}
document.getElementById('addPaletteBtn').addEventListener('click',function(){
  if(palette.indexOf(currentColor)<0){palette.unshift(currentColor);buildPaletteUI();setColor(currentColor);}
});

// Paste this <script> block into your HTML near </body>
// It makes the color palette strip scroll horizontally with the mouse wheel

document.getElementById('paletteWrap')?.addEventListener('wheel', function(e) {
  if (e.deltaY !== 0) {
    e.preventDefault();
    this.scrollLeft += e.deltaY * 1.5;
  }
}, { passive: false });


/* ── Tool selection ── */
function setTool(name){
  currentTool=name;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(function(b){b.classList.toggle('active',b.dataset.tool===name);});
  document.querySelectorAll('.tp-btn[data-tool]').forEach(function(b){b.classList.toggle('active',b.dataset.tool===name);});
  if(name==='text')document.getElementById('textPop').classList.remove('hidden');
  else{document.getElementById('textPop').classList.add('hidden');textInput.classList.add('hidden');textPending=null;}
  updateCursor();
}
document.querySelectorAll('.tool-btn[data-tool]').forEach(function(btn){
  btn.addEventListener('click',function(){setTool(btn.dataset.tool);});
});
function updateCursor(){
  var map={paint:'crosshair',erase:'cell',fill:'copy',eyedrop:'zoom-in',text:'text'};
  canvas.style.cursor=viewMode?'default':(map[currentTool]||'crosshair');
}

/* ── Undo ── */
function saveHistory(){
  undoStack.push({li:activeLayer,px:layers[activeLayer].pixels.slice()});
  if(undoStack.length>80)undoStack.shift();
}
function undo(){
  if(!undoStack.length)return;
  var h=undoStack.pop();
  if(layers[h.li])layers[h.li].pixels=h.px;
  renderAll();
}

/* ═══════════════════════════════════
   SELECT / COPY / PASTE
═══════════════════════════════════ */
function hitTestSelect(px,py){
  if(!selectActive||!selectRect)return null;
  var s=selectRect;
  var x=s.col*CELL,y=s.row*CELL,w=s.cols*CELL,h=s.rows*CELL;
  var HIT=isMobile()?CELL*0.75:CELL*0.55;
  var corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  for(var i=0;i<4;i++)if(Math.abs(px-corners[i][0])<HIT&&Math.abs(py-corners[i][1])<HIT)return i;
  if(px>=x&&px<=x+w&&py>=y&&py<=y+h)return 'body';
  return null;
}
function hitTestPasteBody(px,py){
  if(!pasteRect)return false;
  var x=pasteRect.col*CELL,y=pasteRect.row*CELL,w=pasteRect.cols*CELL,h=pasteRect.rows*CELL;
  return px>=x&&px<=x+w&&py>=y&&py<=y+h;
}

function syncMobSelectBtns(){
  var hasSel=selectActive&&selectRect&&selectMode!=='pasting';
  var hasClip=!!clipboard;
  var cb=document.getElementById('copyBtn');if(cb)cb.style.opacity=hasSel?'1':'0.45';
  var pb=document.getElementById('pasteBtn');if(pb)pb.style.opacity=hasClip?'1':'0.45';
  document.getElementById('moveToggleBtn').classList.toggle('active',moveActive);
  document.getElementById('selectToggleBtn').classList.toggle('active',selectActive);
  var ts=document.getElementById('tp_selectBtn');if(ts)ts.classList.toggle('active',selectActive);
  var tm=document.getElementById('tp_moveBtn');if(tm)tm.classList.toggle('active',moveActive);
  var tc2=document.getElementById('tp_copyBtn');if(tc2)tc2.style.opacity=hasSel?'1':'0.45';
  var tp2=document.getElementById('tp_pasteBtn');if(tp2)tp2.style.opacity=hasClip?'1':'0.45';
}

function toggleSelect(){
  selectActive=!selectActive;
  if(!selectActive){selectRect=null;selectMode='idle';moveActive=false;hidePasteToolbar();}
  else coordsEl.textContent='Drag to select area';
  syncMobSelectBtns();renderAll();
}
document.getElementById('selectToggleBtn').addEventListener('click',toggleSelect);

function toggleMove(){
  if(!selectActive||!selectRect){showToast('Draw a selection first');return;}
  moveActive=!moveActive;syncMobSelectBtns();
  if(moveActive)showToast('Drag inside selection to move pixels');
}
document.getElementById('moveToggleBtn').addEventListener('click',toggleMove);

function doCopy(){
  if(!selectActive||!selectRect)return;
  var s=selectRect;
  var cp=[];
  for(var r=0;r<s.rows;r++)for(var c=0;c<s.cols;c++)cp.push(pixels[idx(s.col+c,s.row+r)]||null);
  clipboard={cols:s.cols,rows:s.rows,pixels:cp};
  syncMobSelectBtns();showToast('Copied '+s.cols+'×'+s.rows);
}
document.getElementById('copyBtn').addEventListener('click',doCopy);

function doPaste(){
  if(!clipboard)return;
  selectActive=true;
  selectRect={
    col:Math.max(0,Math.floor((COLS-clipboard.cols)/2)),
    row:Math.max(0,Math.floor((ROWS-clipboard.rows)/2)),
    cols:clipboard.cols,rows:clipboard.rows
  };
  pasteRect={col:selectRect.col,row:selectRect.row,cols:clipboard.cols,rows:clipboard.rows};
  selectMode='pasting';
  showPasteToolbar();renderAll();
  showToast('Drag ghost · tap PLACE or CANCEL');
}
document.getElementById('pasteBtn').addEventListener('click',doPaste);
document.getElementById('pasteConfirmBtn').addEventListener('click',commitPaste);
document.getElementById('pasteCancelBtn').addEventListener('click',cancelPaste);

function commitPaste(){
  if(!clipboard||!pasteRect)return;
  saveHistory();
  for(var r=0;r<clipboard.rows;r++)for(var c=0;c<clipboard.cols;c++){
    var tc=pasteRect.col+c,tr=pasteRect.row+r;
    if(!inBounds(tc,tr))continue;
    if(clipboard.pixels[r*clipboard.cols+c]!==null)pixels[idx(tc,tr)]=clipboard.pixels[r*clipboard.cols+c];
  }
  pasteRect=null;selectMode='idle';hidePasteToolbar();renderAll();schedSave();showToast('Pasted!');
}
function cancelPaste(){pasteRect=null;selectMode='idle';hidePasteToolbar();renderAll();showToast('Cancelled');}
function showPasteToolbar(){pasteToolbar.classList.add('visible');}
function hidePasteToolbar(){pasteToolbar.classList.remove('visible');}

/* ═══════════════════════════════════
   POINTER EVENTS
   Mouse movements also update WASD cursor
═══════════════════════════════════ */
function colRowFromEvent(e){
  var src=(e.changedTouches&&e.changedTouches.length)?e.changedTouches[0]:e;
  var rect=canvas.getBoundingClientRect();
  var col=Math.floor((src.clientX-rect.left)/rect.width*COLS);
  var row=Math.floor((src.clientY-rect.top)/rect.height*ROWS);
  var px=(src.clientX-rect.left)/rect.width*(COLS*CELL);
  var py=(src.clientY-rect.top)/rect.height*(ROWS*CELL);
  return{col:col,row:row,px:px,py:py};
}

function handleDown(e){
  if(viewMode)return;
  if(e.touches&&e.touches.length>=2){_pinchActive=true;_pinchDist=getPinchDist(e);return;}
  e.preventDefault();
  var cr=colRowFromEvent(e);

  // Update WASD cursor on mouse click (not touch)
  if(!e.touches&&inBounds(cr.col,cr.row)){
    cursorCol=cr.col;cursorRow=cr.row;cursorVisible=true;
  }

  if(selectMode==='pasting'){
    if(hitTestPasteBody(cr.px,cr.py)){
      selectMode='paste-drag';
      pasteDragAnchor={px:cr.px,py:cr.py};
      pasteMoveInitRect={col:pasteRect.col,row:pasteRect.row,cols:pasteRect.cols,rows:pasteRect.rows};
    }
    return;
  }

  if(selectActive){
    var hit=hitTestSelect(cr.px,cr.py);
    if(hit==='body'){
      if(moveActive){
        saveHistory();
        selectMode='pixel-move';
        selectMoveAnchor={px:cr.px,py:cr.py};
        selectMoveInitRect={col:selectRect.col,row:selectRect.row,cols:selectRect.cols,rows:selectRect.rows};
        moveInitPixels=[];
        for(var mr=0;mr<selectRect.rows;mr++)for(var mc=0;mc<selectRect.cols;mc++)
          moveInitPixels.push(pixels[idx(selectRect.col+mc,selectRect.row+mr)]||null);
        movePixelsBase=pixels.slice();
        for(var er=0;er<selectRect.rows;er++)for(var ec2=0;ec2<selectRect.cols;ec2++)
          movePixelsBase[idx(selectRect.col+ec2,selectRect.row+er)]=null;
      }else{
        selectMode='moving';
        selectMoveAnchor={px:cr.px,py:cr.py};
        selectMoveInitRect={col:selectRect.col,row:selectRect.row,cols:selectRect.cols,rows:selectRect.rows};
      }
      return;
    }
    if(hit!==null&&hit!=='body'){
      selectMode='handle';selectHandleIdx=hit;
      selectDragAnchor={px:cr.px,py:cr.py};
      selectInitRect={col:selectRect.col,row:selectRect.row,cols:selectRect.cols,rows:selectRect.rows};
      return;
    }
    selectMode='drawing';
    selectDrawStart={col:cr.col,row:cr.row};
    selectRect={col:cr.col,row:cr.row,cols:1,rows:1};
    renderAll();return;
  }

  if(currentTool==='fill'){floodFill(cr.col,cr.row);return;}
  if(currentTool==='eyedrop'){eyedropAt(cr.col,cr.row);return;}
  if(currentTool==='text'){placeTextTool(cr);return;}
  if(currentTool==='paint'||currentTool==='erase'){
    isDragPainting=true;
    _lastPaintPos={col:cr.col,row:cr.row};
    saveHistory();paintAt(cr.col,cr.row);
  }
}

function handleMove(e){
  if(viewMode)return;
  if(_pinchActive&&e.touches&&e.touches.length>=2){handlePinch(e);return;}
  if(e.cancelable)e.preventDefault();
  var cr=colRowFromEvent(e);
  if(inBounds(cr.col,cr.row)){
    coordsEl.textContent='X:'+cr.col+'  Y:'+cr.row;
    // WASD cursor does NOT follow mouse hover — only updates on click (handleDown)
  }

  if(selectMode==='paste-drag'&&pasteRect&&pasteDragAnchor){
    var dpc=Math.round((cr.px-pasteDragAnchor.px)/CELL);
    var dpr=Math.round((cr.py-pasteDragAnchor.py)/CELL);
    pasteRect.col=Math.max(0,Math.min(COLS-pasteMoveInitRect.cols,pasteMoveInitRect.col+dpc));
    pasteRect.row=Math.max(0,Math.min(ROWS-pasteMoveInitRect.rows,pasteMoveInitRect.row+dpr));
    selectRect.col=pasteRect.col;selectRect.row=pasteRect.row;
    renderAll();return;
  }

  if(selectMode==='pixel-move'&&moveInitPixels&&selectMoveInitRect){
    var pmdx=Math.round((cr.px-selectMoveAnchor.px)/CELL);
    var pmdy=Math.round((cr.py-selectMoveAnchor.py)/CELL);
    var ri=selectMoveInitRect;
    var newCol=Math.max(0,Math.min(COLS-ri.cols,ri.col+pmdx));
    var newRow=Math.max(0,Math.min(ROWS-ri.rows,ri.row+pmdy));
    var fresh=movePixelsBase.slice();
    for(var sr2=0;sr2<ri.rows;sr2++)for(var sc2=0;sc2<ri.cols;sc2++){
      var dc=newCol+sc2,dr=newRow+sr2;
      if(inBounds(dc,dr)&&moveInitPixels[sr2*ri.cols+sc2]!==null)
        fresh[idx(dc,dr)]=moveInitPixels[sr2*ri.cols+sc2];
    }
    pixels=fresh;
    selectRect.col=newCol;selectRect.row=newRow;
    renderAll();return;
  }

  if(selectMode==='drawing'&&selectDrawStart){
    var c1=selectDrawStart.col,r1=selectDrawStart.row;
    var c2=Math.max(0,Math.min(COLS-1,cr.col)),r2=Math.max(0,Math.min(ROWS-1,cr.row));
    selectRect={
      col:Math.min(c1,c2),row:Math.min(r1,r2),
      cols:Math.abs(c2-c1)+1,rows:Math.abs(r2-r1)+1
    };
    renderAll();return;
  }

  if(selectMode==='moving'&&selectMoveInitRect){
    var dmc=Math.round((cr.px-selectMoveAnchor.px)/CELL);
    var dmr=Math.round((cr.py-selectMoveAnchor.py)/CELL);
    selectRect.col=Math.max(0,Math.min(COLS-selectMoveInitRect.cols,selectMoveInitRect.col+dmc));
    selectRect.row=Math.max(0,Math.min(ROWS-selectMoveInitRect.rows,selectMoveInitRect.row+dmr));
    selectRect.cols=selectMoveInitRect.cols;selectRect.rows=selectMoveInitRect.rows;
    renderAll();return;
  }

  if(selectMode==='handle'&&selectInitRect){
    var ddx=cr.px-selectDragAnchor.px,ddy=cr.py-selectDragAnchor.py;
    var ddc=Math.round(ddx/CELL),ddr=Math.round(ddy/CELL);
    var ri2=selectInitRect;
    var nc=ri2.col,nr=ri2.row,nw=ri2.cols,nh=ri2.rows;
    var hi=selectHandleIdx;
    if(hi===0){nc=ri2.col+ddc;nr=ri2.row+ddr;nw=ri2.cols-ddc;nh=ri2.rows-ddr;}
    else if(hi===1){nr=ri2.row+ddr;nw=ri2.cols+ddc;nh=ri2.rows-ddr;}
    else if(hi===2){nw=ri2.cols+ddc;nh=ri2.rows+ddr;}
    else if(hi===3){nc=ri2.col+ddc;nw=ri2.cols-ddc;nh=ri2.rows+ddr;}
    nw=Math.max(1,nw);nh=Math.max(1,nh);
    nc=Math.max(0,Math.min(COLS-nw,nc));nr=Math.max(0,Math.min(ROWS-nh,nr));
    nw=Math.min(COLS-nc,nw);nh=Math.min(ROWS-nr,nh);
    selectRect={col:nc,row:nr,cols:nw,rows:nh};
    renderAll();return;
  }

  if(!isDragPainting)return;
  if((currentTool==='paint'||currentTool==='erase')&&_lastPaintPos){
    paintLine(_lastPaintPos.col,_lastPaintPos.row,cr.col,cr.row);
    _lastPaintPos={col:cr.col,row:cr.row};
  }
}

function handleUp(e){
  _pinchActive=false;isDragPainting=false;_lastPaintPos=null;
  if(selectMode==='pixel-move'){schedSave();selectMode='idle';moveInitPixels=null;movePixelsBase=null;syncMobSelectBtns();return;}
  if(selectMode==='paste-drag'){selectMode='pasting';return;}
  if(selectMode==='drawing'||selectMode==='handle'||selectMode==='moving'){selectMode='idle';syncMobSelectBtns();}
}

canvas.addEventListener('mousedown',handleDown);
canvas.addEventListener('mousemove',handleMove);
canvas.addEventListener('mouseup',handleUp);
canvas.addEventListener('mouseleave',function(){
  isDragPainting=false;_lastPaintPos=null;
  coordsEl.textContent='—';
  // Keep cursor visible but update display without position change
  renderAll();
});
canvas.addEventListener('touchstart',handleDown,{passive:false});
canvas.addEventListener('touchmove',handleMove,{passive:false});
canvas.addEventListener('touchend',handleUp,{passive:false});

/* ── Pinch zoom ── */
function getPinchDist(e){
  var dx=e.touches[0].clientX-e.touches[1].clientX;
  var dy=e.touches[0].clientY-e.touches[1].clientY;
  return Math.sqrt(dx*dx+dy*dy);
}
function handlePinch(e){
  e.preventDefault();
  var newDist=getPinchDist(e);
  if(_pinchDist>0){
    var ratio=newDist/_pinchDist;
    var rect=canvasArea.getBoundingClientRect();
    var mx=(e.touches[0].clientX+e.touches[1].clientX)/2-rect.left;
    var my=(e.touches[0].clientY+e.touches[1].clientY)/2-rect.top;
    setZoom(vpScale*ratio,mx,my);
  }
  _pinchDist=newDist;
}
canvasArea.addEventListener('touchstart',function(e){
  if(e.touches.length===2){_pinchActive=true;_pinchDist=getPinchDist(e);}
},{passive:true});

/* ── Wheel zoom (desktop only) ── */
canvasArea.addEventListener('wheel',function(e){
  e.preventDefault();
  var rect=canvasArea.getBoundingClientRect();
  setZoom(vpScale*(e.deltaY<0?1.18:1/1.18),e.clientX-rect.left,e.clientY-rect.top);
},{passive:false});

function setZoom(z,focalX,focalY){
  var newScale=Math.max(0.25,Math.min(40,z));
  if(focalX===undefined)focalX=canvasArea.clientWidth/2;
  if(focalY===undefined)focalY=canvasArea.clientHeight/2;
  var canvasPointX=(focalX-vpX)/vpScale;
  var canvasPointY=(focalY-vpY)/vpScale;
  vpScale=newScale;vpX=focalX-canvasPointX*vpScale;vpY=focalY-canvasPointY*vpScale;
  applyTransform();
}

/* ── Space+drag pan ── */
var panOn=false,panStart={x:0,y:0},panVp={x:0,y:0},spaceDown=false;
document.addEventListener('keydown',function(e){if(e.code==='Space'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){spaceDown=true;canvasArea.style.cursor='grab';e.preventDefault();}});
document.addEventListener('keyup',function(e){
  if(e.code==='Space'){spaceDown=false;canvasArea.style.cursor='';}
  // Stop Q hold undo on key release
  if(e.key==='q'||e.key==='Q')_stopQUndo();
});
canvasArea.addEventListener('mousedown',function(e){if(e.button===1||spaceDown){panOn=true;panStart={x:e.clientX,y:e.clientY};panVp={x:vpX,y:vpY};canvasArea.style.cursor='grabbing';e.preventDefault();}});
document.addEventListener('mousemove',function(e){if(!panOn)return;vpX=panVp.x+(e.clientX-panStart.x);vpY=panVp.y+(e.clientY-panStart.y);applyTransform();});
document.addEventListener('mouseup',function(){if(panOn){panOn=false;canvasArea.style.cursor='';}});

/* ── Keyboard ── */
var colorLocked=false;
// Q hold-to-undo: track whether Q is currently held, use interval for rapid undo
var _qHeld=false,_qInterval=null;
function _doUndo(){undo();schedSave();}
function _startQUndo(){
  if(_qHeld)return;
  _qHeld=true;
  _doUndo(); // immediate first undo
  _qInterval=setTimeout(function(){
    // After 400ms hold, start rapid fire
    _qInterval=setInterval(_doUndo,80);
  },400);
}
function _stopQUndo(){
  _qHeld=false;
  clearTimeout(_qInterval);clearInterval(_qInterval);_qInterval=null;
}

document.addEventListener('keydown',function(e){
  var tag=document.activeElement?document.activeElement.tagName:'';
  if(tag==='INPUT'||tag==='TEXTAREA'||(document.activeElement&&document.activeElement.contentEditable==='true'))return;

  if(e.getModifierState)colorLocked=e.getModifierState('CapsLock');
  document.getElementById('capsLockBadge').classList.toggle('on',colorLocked);

  if(selectMode==='pasting'){
    if(e.key==='Enter'){e.preventDefault();commitPaste();return;}
    if(e.key==='Escape'){e.preventDefault();cancelPaste();return;}
  }
  if(e.key==='Escape'&&selectActive){
    e.preventDefault();selectActive=false;selectRect=null;selectMode='idle';moveActive=false;hidePasteToolbar();
    syncMobSelectBtns();renderAll();return;
  }

  // Q or Ctrl+Z — one undo per keydown, hold for rapid
  if((e.key==='q'||e.key==='Q')&&!e.ctrlKey&&!e.metaKey){
    e.preventDefault();_startQUndo();return;
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){
    e.preventDefault();_doUndo();return;
  }

  if((e.ctrlKey||e.metaKey)&&e.key==='c'&&selectActive&&selectRect){e.preventDefault();doCopy();return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='v'&&clipboard){e.preventDefault();doPaste();return;}

  var key=e.key,moved=false;
  var prevCol=cursorCol,prevRow=cursorRow;
  if(key==='w'||key==='W'||key==='ArrowUp'){cursorRow=Math.max(0,cursorRow-1);moved=true;}
  if(key==='s'||key==='S'||key==='ArrowDown'){cursorRow=Math.min(ROWS-1,cursorRow+1);moved=true;}
  if(key==='a'||key==='A'||key==='ArrowLeft'){cursorCol=Math.max(0,cursorCol-1);moved=true;}
  if(key==='d'||key==='D'||key==='ArrowRight'){cursorCol=Math.min(COLS-1,cursorCol+1);moved=true;}
  if(moved){
    e.preventDefault();cursorVisible=true;
    coordsEl.textContent='X:'+cursorCol+'  Y:'+cursorRow;
    if(colorLocked&&(currentTool==='paint'||currentTool==='erase')){
      // Save one history entry per step so each cell can be undone individually
      saveHistory();
      paintAt(cursorCol,cursorRow);
    }else{renderAll();}
    return;
  }
  if(key==='e'||key==='E'){
    e.preventDefault();
    if(!cursorVisible){cursorVisible=true;renderAll();return;}
    if(currentTool==='paint'||currentTool==='erase'){saveHistory();paintAt(cursorCol,cursorRow);}
    else if(currentTool==='fill')floodFill(cursorCol,cursorRow);
    return;
  }
  var toolMap={p:'paint',r:'erase',f:'fill',k:'eyedrop',t:'text'};
  if(!e.ctrlKey&&!e.metaKey&&toolMap[key.toLowerCase()])setTool(toolMap[key.toLowerCase()]);
});

/* ── Text Tool ── */
document.getElementById('textFontSize').addEventListener('input',function(){
  textFontSize=+this.value;document.getElementById('textFontSizeVal').textContent=textFontSize;
});
document.getElementById('textColorPick').addEventListener('input',function(){textColor=this.value;});
document.getElementById('textPopClose').addEventListener('click',function(){document.getElementById('textPop').classList.add('hidden');});

function placeTextTool(cr){
  textPending=cr;
  var wrapRect=canvasWrap.getBoundingClientRect();
  var areaRect=canvasArea.getBoundingClientRect();
  var cellPx=CELL*vpScale;
  textInput.style.left=(wrapRect.left-areaRect.left+cr.col*cellPx)+'px';
  textInput.style.top=(wrapRect.top-areaRect.top+cr.row*cellPx)+'px';
  textInput.classList.remove('hidden');textInput.value='';textInput.focus();
}
function commitText(){
  if(textPending&&textInput.value.trim()){saveHistory();renderTextOnCanvas(textPending.col,textPending.row,textInput.value.trim());}
  textInput.classList.add('hidden');textInput.value='';textPending=null;
}
textInput.addEventListener('keydown',function(e){if(e.key==='Enter')commitText();if(e.key==='Escape'){textInput.classList.add('hidden');textInput.value='';textPending=null;}});
textInput.addEventListener('blur',commitText);

function renderTextOnCanvas(startCol,startRow,text){
  var offW=COLS*CELL,offH=ROWS*CELL;
  var off=document.createElement('canvas');off.width=offW;off.height=offH;
  var oc=off.getContext('2d');
  oc.font=textFontSize+'px "Silkscreen",monospace';oc.fillStyle=textColor;oc.textBaseline='top';
  oc.fillText(text,startCol*CELL,startRow*CELL);
  var d=oc.getImageData(0,0,offW,offH).data;
  for(var r=0;r<ROWS;r++)for(var c=0;c<COLS;c++){
    var sx=Math.round(c*CELL+CELL/2),sy=Math.round(r*CELL+CELL/2),pi2=(sy*offW+sx)*4;
    if(d[pi2+3]>60)pixels[idx(c,r)]='#'+('0'+d[pi2].toString(16)).slice(-2)+('0'+d[pi2+1].toString(16)).slice(-2)+('0'+d[pi2+2].toString(16)).slice(-2);
  }
  renderAll();
}

/* ── Undo / Clear ── */
document.getElementById('unpaintBtn').addEventListener('click',function(){undo();schedSave();});
function clearActiveLayer(){
  if(!confirm('Clear active layer?'))return;
  saveHistory();layers[activeLayer].pixels=new Array(COLS*ROWS).fill(null);
  selectRect=null;selectMode='idle';pasteRect=null;renderAll();schedSave();
}
document.getElementById('clearBtn').addEventListener('click',clearActiveLayer);
document.getElementById('mobClearBtn').addEventListener('click',clearActiveLayer);

/* ── Ghost ── */
document.getElementById('ghostBtn').addEventListener('click',function(){
  if(ghostData){ghostData=null;this.classList.remove('active');}
  else{ghostData=pixels.slice();this.classList.add('active');}
  renderAll();
});

/* ── Edit / View Mode ── */
function setEditMode(){
  viewMode=false;
  document.getElementById('editModeBtn').classList.add('active');
  document.getElementById('viewModeBtn').classList.remove('active');
  document.body.classList.remove('view-mode');renderAll();updateCursor();
}
function setViewMode(){
  viewMode=true;
  document.getElementById('viewModeBtn').classList.add('active');
  document.getElementById('editModeBtn').classList.remove('active');
  document.body.classList.add('view-mode');cursorVisible=false;renderAll();canvas.style.cursor='default';
}
document.getElementById('editModeBtn').addEventListener('click',setEditMode);
document.getElementById('viewModeBtn').addEventListener('click',setViewMode);

/* ── New canvas ── */
function doNew(){
  if(!confirm('Start a new canvas? Unsaved work will be lost.'))return;
  ghostData=null;document.getElementById('ghostBtn').classList.remove('active');
  document.getElementById('setupModal').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}
document.getElementById('newBtn').addEventListener('click',doNew);

/* ═══════════════════════════════════
   LAYER PANEL TOGGLE
═══════════════════════════════════ */
document.getElementById('layerPanelToggleBtn').addEventListener('click',function(){
  var hidden=layerPanel.style.display==='none';
  layerPanel.style.display=hidden?'flex':'none';
  document.body.classList.toggle('layer-open',hidden);
  this.classList.toggle('active',hidden);
});

/* ═══════════════════════════════════
   EXPORT
═══════════════════════════════════ */
function calcAutoScale(cols,rows){return Math.max(1,Math.min(64,Math.ceil(512/Math.max(cols,rows))));}
function getActiveExportScale(){
  var reg=getExportRegion();
  return exportScaleMode==='auto'?calcAutoScale(reg.cols,reg.rows):parseInt(exportScaleMode)||1;
}
function updateExportPreview(){
  var reg=getExportRegion(),scale=getActiveExportScale();
  var el=document.getElementById('exportSizePreview');
  if(el)el.textContent=(exportScaleMode==='auto'?scale+'× AUTO':scale+'×')+' → '+reg.cols*scale+' × '+reg.rows*scale+' px';
}
document.querySelectorAll('.scale-btn').forEach(function(btn){
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    exportScaleMode=btn.dataset.scale==='auto'?'auto':parseInt(btn.dataset.scale);
    document.querySelectorAll('.scale-btn').forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');updateExportPreview();
  });
});
document.getElementById('exportBtn').addEventListener('click',function(e){
  e.stopPropagation();
  var open=exportMenu.classList.toggle('open');
  if(open){
    updateExportPreview();
    var r=this.getBoundingClientRect();
    var menuW=Math.max(185,exportMenu.offsetWidth||185);
    var top=r.bottom+6;
    var left=r.right-menuW;
    if(left<8)left=8;
    if(left+menuW>window.innerWidth-8)left=window.innerWidth-menuW-8;
    exportMenu.style.top=top+'px';exportMenu.style.left=left+'px';
  }
});
document.addEventListener('click',function(){exportMenu.classList.remove('open');});

function getExportRegion(){
  if(selectActive&&selectRect&&selectMode!=='pasting')
    return{sc:selectRect.col,sr:selectRect.row,cols:selectRect.cols,rows:selectRect.rows};
  return{sc:0,sr:0,cols:COLS,rows:ROWS};
}

function buildExportCanvas(){
  var reg=getExportRegion(),scale=getActiveExportScale();
  var ec=document.createElement('canvas');ec.width=reg.cols*scale;ec.height=reg.rows*scale;
  var ex=ec.getContext('2d');ex.imageSmoothingEnabled=false;
  ex.fillStyle='#ffffff';ex.fillRect(0,0,ec.width,ec.height);
  for(var li=layers.length-1;li>=0;li--){
    var lay=layers[li];if(!lay.visible)continue;
    ex.save();ex.globalAlpha=lay.opacity;
    for(var r=0;r<reg.rows;r++)for(var c=0;c<reg.cols;c++){
      var pi=idx(reg.sc+c,reg.sr+r);if(!lay.pixels[pi])continue;
      ex.fillStyle=lay.pixels[pi];ex.fillRect(c*scale,r*scale,scale,scale);
    }
    ex.restore();
  }
  return ec;
}

function doExportPNG(){
  exportMenu.classList.remove('open');
  var scale=getActiveExportScale(),reg=getExportRegion();
  buildExportCanvas().toBlob(function(b){
    triggerDownload(URL.createObjectURL(b),'pixel-art-'+reg.cols*scale+'x'+reg.rows*scale+'.png');
    showToast('Exported '+reg.cols*scale+'×'+reg.rows*scale+'px');
  });
}
function doExportSVG(){
  exportMenu.classList.remove('open');
  var reg=getExportRegion();
  var parts=['<svg xmlns="http://www.w3.org/2000/svg" width="'+reg.cols+'" height="'+reg.rows+'" viewBox="0 0 '+reg.cols+' '+reg.rows+'"><rect width="'+reg.cols+'" height="'+reg.rows+'" fill="#fff"/>'];
  for(var r=0;r<reg.rows;r++)for(var c=0;c<reg.cols;c++){
    var pi2=idx(reg.sc+c,reg.sr+r);if(!pixels[pi2])continue;
    parts.push('<rect x="'+c+'" y="'+r+'" width="1" height="1" fill="'+pixels[pi2]+'"/>');
  }
  parts.push('</svg>');
  triggerDownload(URL.createObjectURL(new Blob([parts.join('\n')],{type:'image/svg+xml'})),'pixel-art.svg');
  showToast('SVG exported');
}
document.getElementById('exportPNG').addEventListener('click',doExportPNG);
document.getElementById('exportSVG').addEventListener('click',doExportSVG);
function triggerDownload(url,name){var a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);}

/* ═══════════════════════════════════
   LIBRARY
═══════════════════════════════════ */
function openLibrary(){buildLibraryUI();document.getElementById('libraryModal').classList.remove('hidden');}
document.getElementById('libraryBtn').addEventListener('click',openLibrary);
document.getElementById('libCloseBtn').addEventListener('click',function(){document.getElementById('libraryModal').classList.add('hidden');});
document.getElementById('libConfirmImport').addEventListener('click',function(){
  var raw=document.getElementById('libJsonArea').value.trim();if(!raw)return;
  if(/^https?:\/\//i.test(raw)){
    fetch(raw).then(function(res){if(!res.ok)throw new Error(res.status);return res.json();})
      .then(function(d){loadFromData(d);document.getElementById('libraryModal').classList.add('hidden');showToast('Loaded!');})
      .catch(function(er){alert('Failed: '+er.message);});
  }else{try{var d=JSON.parse(raw);loadFromData(d);document.getElementById('libraryModal').classList.add('hidden');}catch(ex){alert('Invalid JSON');}}
});

function buildLibraryUI(){
  var grid=document.getElementById('libGrid');grid.innerHTML='';
  if(!library.length){grid.innerHTML='<div style="color:var(--muted);font-size:11px;grid-column:1/-1;padding:16px;">No sprites yet.</div>';return;}
  library.forEach(function(item,i){
    var div=document.createElement('div');div.className='lib-item';
    var tc=document.createElement('canvas');
    tc.width=item.cols;tc.height=item.rows;
    tc.style.cssText='width:'+Math.min(80,item.cols*3)+'px;height:'+Math.min(80,item.rows*3)+'px;image-rendering:pixelated;display:block;margin:0 auto 6px;background:#fff;';
    var tx=tc.getContext('2d');
    for(var pi=0;pi<item.pixels.length;pi++){if(!item.pixels[pi])continue;tx.fillStyle=item.pixels[pi];tx.fillRect(pi%item.cols,Math.floor(pi/item.cols),1,1);}
    var nm=document.createElement('div');nm.className='lib-item-name';nm.textContent=item.name;
    var del=document.createElement('button');del.textContent='✕';del.style.cssText='position:absolute;top:4px;right:4px;background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;';
    div.appendChild(tc);div.appendChild(nm);div.appendChild(del);
    div.addEventListener('click',(function(d){return function(){loadFromData(d);document.getElementById('libraryModal').classList.add('hidden');};})(item));
    del.addEventListener('click',(function(ii){return function(e){e.stopPropagation();library.splice(ii,1);buildLibraryUI();saveLibraryDB();};})(i));
    grid.appendChild(div);
  });
}

function loadFromData(data){
  COLS=data.cols;ROWS=data.rows;
  layers=[mkLayer('Layer 1')];layers[0].pixels=data.pixels.slice();
  activeLayer=0;ghostData=null;selectRect=null;undoStack=[];
  autoFitZoom();renderAll();buildPaletteUI();buildLayerPanel();
}

/* ═══════════════════════════════════
   PUSH / SAVE
═══════════════════════════════════ */
function compressPixels(arr){
  var out=[],i=0;
  while(i<arr.length){
    if(arr[i]===null){var cnt=0;while(i<arr.length&&arr[i]===null){cnt++;i++;}out.push(cnt===1?null:[null,cnt]);}
    else{out.push(arr[i]);i++;}
  }
  return out;
}
function decompressPixels(arr,total){
  var out=[];
  for(var i=0;i<arr.length;i++){
    var v=arr[i];
    if(v===null){out.push(null);}
    else if(Array.isArray(v)&&v[0]===null){for(var j=0;j<v[1];j++)out.push(null);}
    else{out.push(v);}
  }
  while(out.length<total)out.push(null);
  return out.slice(0,total);
}

function openPush(){
  var reg=getExportRegion();
  var flat=new Array(reg.cols*reg.rows).fill(null);
  for(var li=layers.length-1;li>=0;li--){
    var lay=layers[li];if(!lay.visible)continue;
    for(var r=0;r<reg.rows;r++)for(var c=0;c<reg.cols;c++){
      var src=lay.pixels[idx(reg.sc+c,reg.sr+r)];
      if(src)flat[r*reg.cols+c]=src;
    }
  }
  var data={name:'sprite',cols:reg.cols,rows:reg.rows,pixels:compressPixels(flat)};
  document.getElementById('pushJson').value=JSON.stringify(data,null,2);
  document.getElementById('pushName').value='';
  document.getElementById('pushModal').classList.remove('hidden');
}
document.getElementById('pushBtn').addEventListener('click',openPush);
document.getElementById('pushCloseBtn').addEventListener('click',function(){document.getElementById('pushModal').classList.add('hidden');});
document.getElementById('pushCopyBtn').addEventListener('click',function(){
  var ta=document.getElementById('pushJson');
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(ta.value).then(function(){showToast('Copied!');});
  else{ta.select();document.execCommand('copy');showToast('Copied!');}
});
document.getElementById('pushSaveBtn').addEventListener('click',function(){
  var name=document.getElementById('pushName').value.trim()||'sprite';
  try{
    var data=JSON.parse(document.getElementById('pushJson').value);
    data.name=name;
    library.push({name:name,cols:data.cols,rows:data.rows,pixels:decompressPixels(data.pixels,data.cols*data.rows)});
    saveLibraryDB();document.getElementById('pushModal').classList.add('hidden');showToast('Saved!');
  }catch(ex){}
});

/* ═══════════════════════════════════
   IndexedDB persistence
═══════════════════════════════════ */
var _db=null;
(function(){
  var req=indexedDB.open('PixelForgeDB',6);
  req.onupgradeneeded=function(e){
    var db=e.target.result;
    if(!db.objectStoreNames.contains('state'))db.createObjectStore('state');
    if(!db.objectStoreNames.contains('library'))db.createObjectStore('library');
  };
  req.onsuccess=function(e){_db=e.target.result;loadStateDB();loadLibraryDB();};
})();

function saveStateDB(){
  if(!_db)return;
  var saveLayers=layers.map(function(l){return{id:l.id,name:l.name,pixels:l.pixels.slice(),opacity:l.opacity,visible:l.visible};});
  _db.transaction('state','readwrite').objectStore('state').put({cols:COLS,rows:ROWS,layers:saveLayers,activeLayer:activeLayer,palette:palette.slice()},'current');
}
function loadStateDB(){
  if(!_db)return;
  var req=_db.transaction('state','readonly').objectStore('state').get('current');
  req.onsuccess=function(e){
    var s=e.target.result;
    if(s){
      document.getElementById('setupModal').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      COLS=s.cols;ROWS=s.rows;
      if(s.layers&&s.layers.length){
        layers=s.layers;activeLayer=s.activeLayer||0;
        _layerIdCounter=Math.max.apply(null,layers.map(function(l){return l.id;}))+1;
      }else{
        layers=[mkLayer('Layer 1')];
        if(s.pixels)layers[0].pixels=s.pixels;
        activeLayer=0;
      }
      palette=s.palette||palette;
      autoFitZoom();renderAll();buildPaletteUI();buildLayerPanel();
      setColor(palette[0]||'#111111');
      syncMobSelectBtns();updateExportPreview();
    }
  };
}
function saveLibraryDB(){if(!_db)return;_db.transaction('library','readwrite').objectStore('library').put(library,'lib');}
function loadLibraryDB(){
  if(!_db)return;
  var req=_db.transaction('library','readonly').objectStore('library').get('lib');
  req.onsuccess=function(e){if(e.target.result)library=e.target.result;};
}
var saveTimer=null;
function schedSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveStateDB,800);}

/* ═══════════════════════════════════
   LAYER PANEL UI
═══════════════════════════════════ */
function setActiveLayer(i){activeLayer=i;renderAll();buildLayerPanel();}

function addLayer(){
  var newL=mkLayer('Layer '+(layers.length+1));
  layers.unshift(newL);activeLayer=0;
  renderAll();buildLayerPanel();schedSave();showToast('Layer added');
}

function duplicateLayer(i){
  var src=layers[i];
  var dup=mkLayer(src.name+' copy');
  dup.pixels=src.pixels.slice();dup.opacity=src.opacity;
  layers.splice(i,0,dup);activeLayer=i;
  renderAll();buildLayerPanel();schedSave();showToast('Layer duplicated');
}

function deleteLayer(i){
  layers.splice(i,1);
  if(layers.length===0)layers=[mkLayer('Layer 1')];
  activeLayer=Math.min(activeLayer,layers.length-1);
  undoStack=[];renderAll();buildLayerPanel();schedSave();
}

function moveLayer(from,to){
  if(to<0||to>=layers.length)return;
  var l=layers.splice(from,1)[0];
  layers.splice(to,0,l);activeLayer=to;
  renderAll();buildLayerPanel();schedSave();
}

function drawLayerThumb(layer,canvas){
  canvas.width=COLS;canvas.height=ROWS;
  var tc=canvas.getContext('2d');tc.clearRect(0,0,COLS,ROWS);
  for(var i=0;i<layer.pixels.length;i++){
    if(!layer.pixels[i])continue;
    tc.fillStyle=layer.pixels[i];tc.fillRect(i%COLS,Math.floor(i/COLS),1,1);
  }
}

function buildLayerPanel(){
  var list=document.getElementById('layerList');
  if(!list)return;
  list.innerHTML='';
  layers.forEach(function(layer,i){
    var item=document.createElement('div');
    item.className='layer-item'+(i===activeLayer?' active':'');
    item.draggable=true;item.dataset.idx=i;

    var thumb=document.createElement('canvas');
    thumb.className='layer-thumb';
    drawLayerThumb(layer,thumb);
    item.appendChild(thumb);

    var top=document.createElement('div');top.className='layer-item-top';

    var visBtn=document.createElement('button');visBtn.className='layer-vis';visBtn.title='Toggle visibility';
    visBtn.innerHTML=layer.visible?
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="21" y2="21"/><path d="M10.5 6.1A9 9 0 0123 12s-4 8-11 8a9 9 0 01-5-1.5"/><path d="M2 9.5A9 9 0 001 12s4 8 11 8"/></svg>';
    visBtn.addEventListener('click',function(e){
      e.stopPropagation();layer.visible=!layer.visible;
      visBtn.innerHTML=layer.visible?
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>':
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="21" y2="21"/><path d="M10.5 6.1A9 9 0 0123 12s-4 8-11 8a9 9 0 01-5-1.5"/><path d="M2 9.5A9 9 0 001 12s4 8 11 8"/></svg>';
      renderAll();schedSave();
    });

    var nameEl=document.createElement('span');nameEl.className='layer-name';nameEl.textContent=layer.name;
    nameEl.title='Double-click to rename';
    nameEl.addEventListener('dblclick',function(e){
      e.stopPropagation();nameEl.contentEditable='true';nameEl.classList.add('editing');nameEl.focus();
      var sel=window.getSelection();var range=document.createRange();range.selectNodeContents(nameEl);sel.removeAllRanges();sel.addRange(range);
    });
    nameEl.addEventListener('blur',function(){nameEl.contentEditable='false';nameEl.classList.remove('editing');layer.name=nameEl.textContent.trim()||layer.name;schedSave();});
    nameEl.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();nameEl.blur();}});

    var acts=document.createElement('div');acts.className='layer-actions';
    var dupBtn=document.createElement('button');dupBtn.className='layer-act-btn';dupBtn.title='Duplicate';
    dupBtn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    dupBtn.addEventListener('click',function(e){e.stopPropagation();duplicateLayer(i);});
    var delBtn=document.createElement('button');delBtn.className='layer-act-btn del';delBtn.title='Delete';
    delBtn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    delBtn.addEventListener('click',function(e){e.stopPropagation();deleteLayer(i);});
    acts.appendChild(dupBtn);acts.appendChild(delBtn);

    top.appendChild(visBtn);top.appendChild(nameEl);top.appendChild(acts);
    item.appendChild(top);

    // Opacity bar
    var opRow=document.createElement('div');opRow.className='layer-opacity-row';
    var opBar=document.createElement('div');opBar.className='layer-opacity-bar';
    var opFill=document.createElement('div');opFill.className='layer-opacity-fill';
    opFill.style.width=Math.round(layer.opacity*100)+'%';
    opBar.appendChild(opFill);
    var opVal=document.createElement('span');opVal.className='layer-opacity-val';
    opVal.textContent=Math.round(layer.opacity*100)+'%';
    opRow.appendChild(opBar);opRow.appendChild(opVal);
    item.appendChild(opRow);

    var _opDragging=false;
    function scrubOp(e){
      e.stopPropagation();
      var rect=opBar.getBoundingClientRect();
      var cx=e.touches?e.touches[0].clientX:e.clientX;
      var pct=Math.max(0,Math.min(1,(cx-rect.left)/rect.width));
      layer.opacity=pct;opFill.style.width=Math.round(pct*100)+'%';opVal.textContent=Math.round(pct*100)+'%';
      renderAll();schedSave();
    }
    opBar.addEventListener('mousedown',function(e){_opDragging=true;scrubOp(e);});
    opBar.addEventListener('touchstart',function(e){_opDragging=true;scrubOp(e);},{passive:true});
    document.addEventListener('mousemove',function(e){if(_opDragging)scrubOp(e);});
    document.addEventListener('mouseup',function(){_opDragging=false;});
    document.addEventListener('touchend',function(){_opDragging=false;});
    document.addEventListener('touchmove',function(e){if(_opDragging)scrubOp(e);},{passive:true});

    item.addEventListener('click',function(){setActiveLayer(i);});

    item.addEventListener('dragstart',function(e){e.dataTransfer.setData('text/plain',i);item.style.opacity='0.4';});
    item.addEventListener('dragend',function(){item.style.opacity='';list.querySelectorAll('.layer-item').forEach(function(el){el.classList.remove('drag-over');});});
    item.addEventListener('dragover',function(e){e.preventDefault();item.classList.add('drag-over');});
    item.addEventListener('dragleave',function(){item.classList.remove('drag-over');});
    item.addEventListener('drop',function(e){
      e.preventDefault();item.classList.remove('drag-over');
      var from=parseInt(e.dataTransfer.getData('text/plain'));
      var to=parseInt(item.dataset.idx);
      if(from!==to)moveLayer(from,to);
    });

    list.appendChild(item);
  });
}

document.getElementById('addLayerBtn').addEventListener('click',addLayer);

/* ═══════════════════════════════════
   MOBILE TOOLS POPUP
   Hides layer panel while open
═══════════════════════════════════ */
(function(){
  var floater=document.getElementById('mobToolsFloater');
  var toolsPopup=document.getElementById('toolsPopup');
  if(!floater||!toolsPopup)return;

  function openPopup(){
    toolsPopup.classList.add('open');
    // Hide layer panel while popup is open
    _layerPanelVisibleBeforePopup=(layerPanel.style.display!=='none');
    if(isMobile())layerPanel.style.display='none';
    floater.style.transform='rotate(90deg)';
  }
  function closePopup(){
    toolsPopup.classList.remove('open');
    // Restore layer panel if it was visible before popup opened
    if(isMobile()&&_layerPanelVisibleBeforePopup){
      layerPanel.style.display='flex';
      document.body.classList.add('layer-open');
    }
    floater.style.transform='';
  }

  floater.addEventListener('click',function(e){
    e.stopPropagation();
    if(toolsPopup.classList.contains('open'))closePopup();
    else openPopup();
  });
  document.addEventListener('click',function(e){
    if(!toolsPopup.contains(e.target)&&e.target!==floater)closePopup();
  });

  // Tool buttons in popup
  document.querySelectorAll('#toolsPopup .tp-btn[data-tool]').forEach(function(btn){
    btn.addEventListener('click',function(){setTool(btn.dataset.tool);closePopup();});
  });

  document.getElementById('tp_selectBtn').addEventListener('click',function(){toggleSelect();closePopup();});
  document.getElementById('tp_moveBtn').addEventListener('click',function(){toggleMove();closePopup();});
  document.getElementById('tp_copyBtn').addEventListener('click',function(){doCopy();closePopup();});
  document.getElementById('tp_pasteBtn').addEventListener('click',function(){doPaste();closePopup();});
  document.getElementById('tp_ghostBtn').addEventListener('click',function(){document.getElementById('ghostBtn').click();closePopup();});
  document.getElementById('tp_addLayerBtn').addEventListener('click',function(){addLayer();closePopup();});
  document.getElementById('tp_layerVisBtn').addEventListener('click',function(){
    var lay=layers[activeLayer];if(!lay)return;
    lay.visible=!lay.visible;renderAll();buildLayerPanel();schedSave();
    showToast('Layer '+(lay.visible?'visible':'hidden'));
  });
  document.getElementById('tp_layerToggleBtn').addEventListener('click',function(){
    var isVisible=(layerPanel.style.display!=='none');
    layerPanel.style.display=isVisible?'none':'flex';
    document.body.classList.toggle('layer-open',!isVisible);
    document.getElementById('layerPanelToggleBtn').classList.toggle('active',!isVisible);
    _layerPanelVisibleBeforePopup=!isVisible;
    closePopup();
  });
  document.getElementById('tp_libraryBtn').addEventListener('click',function(){openLibrary();closePopup();});
  document.getElementById('tp_exportPNGBtn').addEventListener('click',function(){doExportPNG();closePopup();});
  document.getElementById('tp_exportSVGBtn').addEventListener('click',function(){doExportSVG();closePopup();});
  document.getElementById('tp_newBtn').addEventListener('click',function(){doNew();closePopup();});
})();

/* ═══════════════════════════════════
   TOAST
═══════════════════════════════════ */
var toastEl=document.getElementById('toastEl');
var _toastTimer=null;
function showToast(msg){
  toastEl.textContent=msg;
  toastEl.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(function(){toastEl.classList.remove('visible');},2400);
}

window.addEventListener('resize',function(){
  if(!document.getElementById('app').classList.contains('hidden'))centerCanvas();
});

/* ═══════════════════════════════════
   TOOLS POPUP EXPLICIT CLOSE BUTTON
═══════════════════════════════════ */
document.getElementById('toolsPopupClose').addEventListener('click',function(e){
  e.stopPropagation();
  document.getElementById('toolsPopup').classList.remove('open');
  // Restore layer panel if it was open before popup
  if(isMobile()&&_layerPanelVisibleBeforePopup){
    layerPanel.style.display='flex';
    document.body.classList.add('layer-open');
  }
  document.getElementById('mobToolsFloater').style.transform='';
});

/* ═══════════════════════════════════
   LAYER PANEL CLOSE (mobile ✕ button)
═══════════════════════════════════ */
(function(){
  var btn=document.getElementById('layerPanelClose');
  if(!btn)return;
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    layerPanel.style.display='none';
    document.body.classList.remove('layer-open');
    document.getElementById('layerPanelToggleBtn').classList.remove('active');
    _layerPanelVisibleBeforePopup=false;
  });
})();

/* ═══════════════════════════════════
   MOBILE NAV ROW — pan + zoom
═══════════════════════════════════ */
(function(){
  var PAN_STEP=0.25;
  var _held=null,_holdInterval=null;

  function doAction(id){
    var w=COLS*CELL*vpScale,h=ROWS*CELL*vpScale;
    if(id==='jUp')   {vpY+=h*PAN_STEP;applyTransform();}
    else if(id==='jDown') {vpY-=h*PAN_STEP;applyTransform();}
    else if(id==='jLeft') {vpX+=w*PAN_STEP;applyTransform();}
    else if(id==='jRight'){vpX-=w*PAN_STEP;applyTransform();}
    else if(id==='jZoomIn') setZoom(vpScale*1.3);
    else if(id==='jZoomOut')setZoom(vpScale/1.3);
    else if(id==='jFit')   autoFitZoom();
    // keep mobile zoom label in sync
    var mob=document.getElementById('zoomLblMob');
    if(mob)mob.textContent=Math.round(vpScale*100)+'%';
  }

  function startHold(btn){
    if(_held)stopHold();
    _held=btn;btn.classList.add('held');
    doAction(btn.id);
    _holdInterval=setInterval(function(){doAction(btn.id);},110);
  }
  function stopHold(){
    if(_held){_held.classList.remove('held');_held=null;}
    clearInterval(_holdInterval);_holdInterval=null;
  }

  ['jUp','jDown','jLeft','jRight','jZoomIn','jZoomOut','jFit'].forEach(function(id){
    var btn=document.getElementById(id);
    if(!btn)return;
    btn.addEventListener('touchstart',function(e){e.preventDefault();startHold(btn);},{passive:false});
    btn.addEventListener('mousedown',function(e){e.preventDefault();startHold(btn);});
    btn.addEventListener('touchend',function(){stopHold();},{passive:true});
    btn.addEventListener('mouseup',stopHold);
    btn.addEventListener('mouseleave',stopHold);
  });

  // Keep mobile zoom label in sync with desktop applyTransform
  var _origApply=applyTransform;
  applyTransform=function(){
    _origApply();
    var mob=document.getElementById('zoomLblMob');
    if(mob)mob.textContent=Math.round(vpScale*100)+'%';
  };
})();
/* ── DESKTOP WELCOME POPUP CLOSE ── */
(function(){
  var popup=document.getElementById('desktop-popup');
  var btn=document.getElementById('close-popup');
  if(!popup)return;
  function closeIt(){popup.style.display='none';}
  if(btn)btn.addEventListener('click',function(e){e.stopPropagation();closeIt();});
  // Also close by clicking the dark backdrop
  popup.addEventListener('click',function(e){if(e.target===popup)closeIt();});
})();
