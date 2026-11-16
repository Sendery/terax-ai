// macOS-only functional check. Run from the repository root with an existing Swift SDK.
// Own nonpersistent WKWebView, prohibited activation, unshown offscreen window.
// --baseline removes only the two exact asset CSP sources to reproduce the old failure.

import Cocoa
import WebKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("public/graphx")
let token = UUID().uuidString
let nextToken = UUID().uuidString
let baseline = CommandLine.arguments.contains("--baseline")
let allowedScripts = "tauri://localhost/graphx/engine.js tauri://localhost/graphx/frame.js"
let rawConfig = try! Data(contentsOf:root.appendingPathComponent("src-tauri/tauri.conf.json"))
let settings = try! JSONSerialization.jsonObject(with:rawConfig) as! [String:Any]
let appSettings = settings["app"] as! [String:Any]
let securitySettings = appSettings["security"] as! [String:Any]
let originalCSP = securitySettings["csp"] as! String
let responseCSP = baseline ? originalCSP.replacingOccurrences(of:" " + allowedScripts,with:"") : originalCSP
let fixture = """
<!doctype html><html><head><meta charset="utf-8"></head><body><div id="results"></div>
<iframe id="frame" sandbox="allow-scripts" style="width:800px;height:600px" src="tauri://localhost/graphx/index.html#\(token)"></iframe>
<script src="tauri://localhost/fixture.js"></script></body></html>
"""
let fixtureJS = """
let frame=document.getElementById('frame');
let token='\(token)',revision=1,retired=null;
const nextToken='\(nextToken)',received=new Set(),checks=[];
let sourceRefusals=0,tokenRefusals=0,wrongRevision=false,finished=false;
const spec={title:'WK GraphX',lang:'en',nodes:[{id:'a',label:'Interface',shape:'decision'},{id:'b',label:'Store',shape:'datastore'}],edges:[{id:'e',from:'a',to:'b',label:'Write'}]};
function result(passed,reason){if(finished)return;finished=true;window.webkit.messageHandlers.diagnostic.postMessage({kind:'result',passed,reason,checks,sourceRefusals,tokenRefusals,wrongRevision});}
window.addEventListener('message',e=>{
 if(e.source!==frame.contentWindow){sourceRefusals++;return;}
 if(e.data?.token!==token){tokenRefusals++;return;}
 if(e.data.type==='terax:graphx:ready'&&!received.has(revision)){
  received.add(revision);
  frame.contentWindow.postMessage({type:'terax:graphx:render',token:'retired-'+token,revision:999,theme:'light',spec:{...spec,title:'STALE'}},'*');
  frame.contentWindow.postMessage({type:'terax:graphx:render',token,revision,theme:'light',spec},'*');
 }
 if(e.data.type==='terax:graphx:rendered'){
  if(e.data.revision!==revision){wrongRevision=true;result(false,'wrong revision acknowledged');return;}
  frame.contentWindow.postMessage({type:'test:inspect',token,revision},'*');
 }
 if(e.data.type==='test:checked'){
  checks.push(e.data);
  if(revision===1){
   retired=frame;
   frame=document.createElement('iframe');
   frame.sandbox='allow-scripts';frame.style='width:500px;height:350px';
   token=nextToken;revision=2;
   frame.src='tauri://localhost/graphx/index.html#'+token;
   document.body.appendChild(frame);
   retired.contentWindow.postMessage({type:'test:late',token},'*');
  }else{
   setTimeout(()=>{
    const valid=checks.length===2&&checks.every(c=>c.parentBlocked&&c.networkBlocked&&!c.inlineExecuted&&!c.unlistedExecuted&&c.tauri==='undefined'&&c.nodeCount===2&&c.pathCount>5&&c.title==='WK GraphX');
    const resized=checks[0]?.width===800&&checks[0]?.height===600&&checks[1]?.width===500&&checks[1]?.height===350;
    result(valid&&resized&&sourceRefusals>0&&tokenRefusals>0&&!wrongRevision,'opaque WK custom-scheme renderer, CSP and stale messages');
    retired?.remove();frame.remove();
   },150);
  }
 }
});
frame.addEventListener('load',()=>frame.contentWindow.postMessage({type:'terax:graphx:hello',token},'*'));
"""
let diagnostics = """
(() => {
 const send=(kind,data)=>{try{window.webkit.messageHandlers.diagnostic.postMessage({kind,data,url:location.href,main:window===top});}catch{}};
 window.addEventListener('error',e=>send('error',{message:e.message,filename:e.filename,line:e.lineno}));
 window.addEventListener('unhandledrejection',e=>send('rejection',String(e.reason)));
 window.addEventListener('securitypolicyviolation',e=>send('csp',{directive:e.violatedDirective,blocked:e.blockedURI,policy:e.originalPolicy}));
 // An unshown WK view does not service animation frames. Exercise the engine's
 // supported reduced-motion branch without changing its source or security.
 const originalMatchMedia=window.matchMedia.bind(window);
 window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)' ? {matches:true,media:query,addListener(){},removeListener(){}} : originalMatchMedia(query);
 if(window===top)return;
 window.addEventListener('message',async e=>{
  if(e.source!==parent)return;
  if(e.data?.type==='test:late'){parent.postMessage({type:'terax:graphx:rendered',token:e.data.token,revision:2},'*');return;}
  if(e.data?.type!=='test:inspect'||e.data.token!==location.hash.slice(1))return;
  let parentBlocked=false,networkBlocked=false;
  try{parent.document.body.innerHTML;}catch{parentBlocked=true;}
  try{await fetch('https://example.com/graphx-boundary');}catch{networkBlocked=true;}
  const inline=document.createElement('script');inline.textContent='window.BAD_INLINE=true';document.head.appendChild(inline);
  const other=document.createElement('script');other.src='tauri://localhost/graphx/not-allowed.js';document.head.appendChild(other);
  parent.postMessage({type:'terax:graphx:rendered',token:'retired-token',revision:e.data.revision},'*');
  setTimeout(()=>parent.postMessage({
   type:'test:checked',token:e.data.token,revision:e.data.revision,parentBlocked,networkBlocked,
   inlineExecuted:!!window.BAD_INLINE,unlistedExecuted:!!window.BAD_UNLISTED,tauri:typeof window.__TAURI_INTERNALS__,
   nodeCount:document.querySelectorAll('.gx-node').length,pathCount:document.querySelectorAll('svg path').length,
   title:document.querySelector('.gx-svg')?.getAttribute('aria-label'),width:innerWidth,height:innerHeight
  },'*'),100);
 });
})();
"""
func report(_ value: Any) {
 if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let text = String(data:data,encoding:.utf8) { print(text); fflush(stdout) }
}
final class Handler: NSObject, WKURLSchemeHandler, WKScriptMessageHandler, WKNavigationDelegate {
 func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
  guard let url=urlSchemeTask.request.url else {return}
  report(["request":url.absoluteString])
  var data: Data
  let mime: String
  do {
   if url.path=="/" {data=fixture.data(using:.utf8)!;mime="text/html"}
   else if url.path=="/fixture.js" {data=fixtureJS.data(using:.utf8)!;mime="text/javascript"}
   else if url.path.hasPrefix("/graphx/") {
    let name=String(url.path.dropFirst("/graphx/".count))
    guard ["index.html","engine.js","frame.js","not-allowed.js"].contains(name) else {throw NSError(domain:"fixture",code:404)}
    data = name=="not-allowed.js" ? "window.BAD_UNLISTED=true".data(using:.utf8)! : try Data(contentsOf:assets.appendingPathComponent(name));mime=name.hasSuffix(".js") ? "text/javascript":"text/html"
   } else {throw NSError(domain:"fixture",code:404)}
   if baseline && url.path=="/graphx/index.html" {
    let html=String(data:data,encoding:.utf8)!
    data=html.replacingOccurrences(of:" " + allowedScripts,with:"").data(using:.utf8)!
   }
   var headers=["Content-Type":mime]
   if mime=="text/html" {headers["Content-Security-Policy"]=responseCSP}
   let response=HTTPURLResponse(url:url,statusCode:200,httpVersion:"HTTP/1.1",headerFields:headers)!
   urlSchemeTask.didReceive(response);urlSchemeTask.didReceive(data);urlSchemeTask.didFinish()
  } catch {urlSchemeTask.didFailWithError(error)}
 }
 func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
 func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
  report(message.body)
  guard message.frameInfo.isMainFrame, let body=message.body as? [String:Any], body["kind"] as? String=="result" else {return}
  let passed=body["passed"] as? Bool==true
  DispatchQueue.main.async { exit(passed ? 0 : 1) }
 }
 func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(["navigationError":String(describing:error)])}
 func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(["provisionalError":String(describing:error)])}
}
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
let handler=Handler()
let config=WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.setURLSchemeHandler(handler,forURLScheme:"tauri")
config.userContentController.add(handler,name:"diagnostic")
config.userContentController.addUserScript(WKUserScript(source:diagnostics,injectionTime:.atDocumentStart,forMainFrameOnly:false))
let view=WKWebView(frame:NSRect(x:0,y:0,width:1000,height:800),configuration:config)
view.navigationDelegate=handler
let window=NSWindow(contentRect:NSRect(x:-20000,y:-20000,width:1000,height:800),styleMask:[.borderless],backing:.buffered,defer:false)
window.contentView=view
view.load(URLRequest(url:URL(string:"tauri://localhost/")!))
DispatchQueue.main.asyncAfter(deadline:.now()+12) {
 report(["deadline":true,"passed":false,"baseline":baseline])
 exit(1)
}
app.run()
