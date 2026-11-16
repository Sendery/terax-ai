# Standalone browser check: Python 3, Node 24, and an existing CHROME_BIN.

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import json,subprocess,threading,tempfile,os
ROOT=Path(__file__).resolve().parent.parent
ARTIFACTS=ROOT/".terax/pi-development/graphx-frame-smoke"
ARTIFACTS.mkdir(parents=True,exist_ok=True)
spec={"title":"Real GraphX test","lang":"en","nodes":[{"id":"group","label":"System"},{"id":"a","label":"Browser","parent":"group","shape":"decision"},{"id":"b","label":"Store","shape":"datastore"}],"edges":[{"id":"edge","from":"a","to":"b","label":"Save"}],"flows":[{"id":"flow","title":"Request","participants":["a","b"],"messages":[{"id":"message","from":"a","to":"b","label":"Write","kind":"sync"}]}]}
html="""<!doctype html><html><body><pre id="results">WAITING</pre><iframe id="f" sandbox="allow-scripts" style="width:800px;height:600px" src="/graphx/index.html#fixture"></iframe><script>
const f=document.getElementById("f");const results=[];let sent=false;let revision=1;
function send(revision){f.contentWindow.postMessage({type:"terax:graphx:render",token:"fixture",documentId:"http-document",revision,theme:"light",spec:SPEC},"*");}
addEventListener("message",e=>{
 if(e.source!==f.contentWindow||e.data.token!=="fixture")return;
 results.push(e.data);
 document.getElementById("results").textContent=JSON.stringify(results);
 if(e.data.type==="terax:graphx:ready"&&!sent){sent=true;send(revision);}
 if(e.data.type==="terax:graphx:rendered") f.contentWindow.postMessage({type:"test:inspect",token:"fixture",revision:e.data.revision},"*");
 if(e.data.type==="test:inspect"&&e.data.revision===1){f.style.width="500px";f.style.height="350px";revision=2;sent=false;f.src="/graphx/index.html?revision=2#fixture";}
 if(e.data.type==="test:inspect"&&e.data.revision===2) {f.remove();document.getElementById("results").textContent=JSON.stringify({done:true,results});}
});
</script></body></html>""".replace("SPEC",json.dumps(spec))
extra=r"""
addEventListener("message",event=>{
 if(event.data.type!=="test:inspect")return;
 const revision=event.data.revision;
 setTimeout(async()=>{
  let parentBlocked=false,networkBlocked=false;
  try{parent.document.body.innerHTML; }catch{parentBlocked=true;}
  try{await fetch("https://example.com/graphx-probe");}catch{networkBlocked=true;}
  document.querySelector('[data-view="flow:flow"]')?.click();
  parent.postMessage({type:"test:inspect",token:"fixture",revision,parentBlocked,networkBlocked,sequence:!!document.querySelector('[data-view="flow:flow"].on'),nodes:document.querySelectorAll(".gx-node").length,paths:document.querySelectorAll("svg path").length,shapes:document.querySelectorAll(".gx-shape").length,width:innerWidth,height:innerHeight,inlineExecuted:!!window.BAD,tauri:typeof window.__TAURI_INTERNALS__},"*");
 },400);
 const script=document.createElement("script");script.textContent="window.BAD=true";document.head.appendChild(script);
});
"""
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path=='/':data=html.encode();mime='text/html'
  else:
   path=ROOT/'public'/self.path.lstrip('/').split('#')[0].split('?')[0]
   if not path.is_file():self.send_error(404);return
   data=path.read_bytes();mime='text/javascript' if path.suffix=='.js' else 'text/html'
   if path.name=='frame.js':data+=extra.encode()
  self.send_response(200);self.send_header('Content-Type',mime);self.end_headers();self.wfile.write(data)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
chrome=os.environ.get('CHROME_BIN')
if not chrome: raise SystemExit('Set CHROME_BIN to an existing headless Chromium executable. No browser is downloaded.')
try:
 with tempfile.TemporaryDirectory(prefix='terax-graphx-headless-') as profile:
  import time,os
  log=(ARTIFACTS/'frame-stderr.log').open('w')
  process=subprocess.Popen([chrome,'--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],stdout=log,stderr=log)
  try:
   portfile=Path(profile)/'DevToolsActivePort'
   for _ in range(100):
    if portfile.exists():break
    time.sleep(.1)
   port=portfile.read_text().splitlines()[0]
   js=r"""
const target=await (await fetch('http://127.0.0.1:'+process.env.CDP+'/json/new?'+encodeURIComponent(process.env.PAGE),{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>socket.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();
socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
function call(method,params={}){return new Promise(resolve=>{const id=++seq;pending.set(id,resolve);socket.send(JSON.stringify({id,method,params}));});}
let html='';
for(let i=0;i<80;i++){
 const response=await call('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
 html=response.result?.result?.value||'';
 if(html.includes('&quot;done&quot;:true')||html.includes('"done":true'))break;
 await new Promise(r=>setTimeout(r,100));
}
console.log(html);
socket.close();
"""
   result=subprocess.run(['node','--input-type=module','-e',js],capture_output=True,text=True,timeout=15,env={**os.environ,'CDP':port,'PAGE':'http://127.0.0.1:'+str(server.server_port)+'/'})
   (ARTIFACTS/'frame-dom.html').write_text(result.stdout)
  finally:
   process.terminate()
   try: process.wait(timeout=5)
   except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
   log.close()
  import re,html as htmlmodule
  match=re.search(r'<pre id="results">(.*?)</pre>',result.stdout,re.S)
  if not match: print(result.stdout[:500],result.stderr[-1000:]);raise SystemExit(1)
  data=json.loads(htmlmodule.unescape(match[1]));print(json.dumps(data,indent=2))
  assert isinstance(data,dict) and data.get('done')
  assert [x['revision'] for x in data['results'] if x['type']=='terax:graphx:rendered']==[1,2]
  inspections=[x for x in data['results'] if x['type']=='test:inspect']
  assert len(inspections)==2
  for x in inspections:
   assert x['parentBlocked'] and x['networkBlocked'] and not x['inlineExecuted'] and x['tauri']=='undefined'
   assert x['nodes']>=2 and x['paths']>5 and x['shapes']>0 and x['sequence']
  assert inspections[1]['width']==500 and inspections[1]['height']==350
finally:server.shutdown();server.server_close()
