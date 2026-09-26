/** Dependency-free, optional browser widget. The trusted monitor produces the report. */
import { isPublicReport, summarizeDeployment } from './state.js';
import { normalizeLanguage, translate as t, translateMessage, translateCheck } from './i18n.js';

const STYLE = `
:host{all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483000;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:#e6edf3}
*{box-sizing:border-box}.pill,.panel{background:#0d1117;border:1px solid #30363d;box-shadow:0 6px 24px #0004}
button,input,select{font:inherit}.pill{display:flex;align-items:center;gap:9px;border-radius:8px;padding:9px 12px;color:inherit;cursor:pointer;min-height:36px}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #58a6ff;outline-offset:3px}
.dot{height:7px;width:7px;display:inline-block;border-radius:50%;background:#8b949e;flex-shrink:0}.dot.checking{background:#58a6ff;animation:pulse 1s infinite}.dot.pass{background:#3fb950}.dot.warn{background:#d29922}.dot.fail{background:#f85149}.dot.changed{animation:status-change .7s ease-out}
.panel{width:min(340px,calc(100vw - 36px));border-radius:10px;overflow:hidden;position:absolute;bottom:47px;right:0}.panel[hidden],.settings-pane[hidden],.body[hidden]{display:none}
.head{display:flex;align-items:center;justify-content:space-between;padding:13px;border-bottom:1px solid #30363d}.title{font-weight:700}.actions{display:flex;gap:12px}.close,.retry,.settings-button{border:0;background:transparent;color:#8b949e;cursor:pointer;padding:0}.close{font:20px/1 sans-serif}
.body,.settings-pane{padding:13px;display:grid;gap:10px}.row{display:flex;justify-content:space-between;gap:12px;align-items:center}.muted{color:#8b949e}.good{color:#3fb950}.warning{color:#d29922}.bad{color:#f85149}.item{word-break:break-word;text-align:right}.section{border-top:1px solid #30363d;padding-top:10px;display:grid;gap:7px}.footer{border-top:1px solid #30363d;padding:10px 13px;color:#8b949e}
.settings-pane label{display:grid;gap:5px;color:#8b949e}.settings-pane select,.settings-pane input{background:#161b22;border:1px solid #30363d;border-radius:5px;color:#e6edf3;padding:7px;width:100%}.settings-pane button{border:1px solid #30363d;border-radius:5px;background:#21262d;color:#e6edf3;padding:7px;cursor:pointer}.setting-actions{display:flex;gap:8px}.setting-actions button{flex:1}.settings-note{font-size:11px;line-height:1.5}.settings-pane input:disabled{opacity:.6}
@keyframes pulse{50%{opacity:.32}}@keyframes status-change{0%{transform:scale(1)}35%{transform:scale(1.65)}100%{transform:scale(1)}}@media(prefers-reduced-motion:reduce){.dot.checking,.dot.changed{animation:none}}`;
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const classFor = state => state === 'pass' ? 'good' : state === 'fail' ? 'bad' : 'warning';
const short = (value, size=12) => String(value ?? '').slice(0,size);
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem('freshdeploy.preferences') || '{}'); } catch { return {}; } };
const savePrefs = data => { try { localStorage.setItem('freshdeploy.preferences',JSON.stringify(data)); } catch {} };

/** SSE is optional. A disconnected EventSource automatically falls back to polling. */
export function mountFreshDeploy({expectedVersion,expectedCommit,manifestUrl='/.freshdeploy.json',reportUrl,
    pollIntervalMs=10_000,maxReportAgeMs=0,sseUrl=null,mode='auto',language='en',serverIntervalSeconds=null,target=document.body}={}) {
  if (!target || typeof document==='undefined') throw new Error('A browser document is required.');
  const prefs=loadPrefs();
  let lang=normalizeLanguage(prefs.language || language);
  let interval=Number.isInteger(prefs.pollIntervalMs) && prefs.pollIntervalMs>=1000 && prefs.pollIntervalMs<=3600000 ? prefs.pollIntervalMs : pollIntervalMs;
  const host=document.createElement('div'); host.setAttribute('data-freshdeploy','');
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>${STYLE}</style>
    <button class="pill" type="button" aria-expanded="false" aria-label="FreshDeploy status details"><span class="dot checking"></span><span class="text" aria-live="polite">checking deployment...</span><span aria-hidden="true">⌄</span></button>
    <section class="panel" hidden><div class="head"><span class="title"></span><div class="actions"><button class="settings-button" type="button" title="Settings" aria-label="Settings">⚙</button><button class="retry" type="button" aria-label="Check now" title="Check now">↻</button><button class="close" type="button" aria-label="Close report">×</button></div></div>
    <div class="body"><div class="muted">Waiting for deployment report...</div></div>
    <div class="settings-pane" hidden><label><span class="language-label">Language</span><select class="lang-select"><option value="en">English</option><option value="es">Español</option></select></label><label><span class="profile-label">Monitoring profile</span><select class="profile-select"><option value="local">Local · 1s</option><option value="production">Production · 10s</option><option value="custom">Custom</option></select></label><label><span class="interval-label">Widget refresh (seconds)</span><input class="interval-input" type="number" min="1" max="3600" step="1"></label><div class="muted settings-note profile-note">Browser-only preference. The server interval is set in the project.</div><div class="muted server-label">Server checks: configured via CLI</div><div class="setting-actions"><button class="apply" type="button">Apply</button><button class="back" type="button">Back to report</button></div></div>
    <div class="footer"></div></section>`;
  target.append(host);
  const get=selector=>shadow.querySelector(selector);
  const pill=get('.pill'),panel=get('.panel'),dot=get('.dot'),label=get('.text'),body=get('.body'),settingsPane=get('.settings-pane');
  const toggle=open=>{panel.hidden=!open;pill.setAttribute('aria-expanded',String(open));};
  pill.addEventListener('click',()=>toggle(panel.hidden));
  get('.close').addEventListener('click',()=>toggle(false));
  let timer,stopped=false,running=false,lastSignature='',lastState='',currentResult=null,currentManifest=null,currentReport=null,currentExpected='';
  let stream=null,streamConnected=false;
  function updateLabels() {
    const set=(selector,value,attribute=null)=>{ const node=get(selector); if(node){if(attribute)node.setAttribute(attribute,value);else node.textContent=value;} };
    set('.title',t('title',lang));set('.footer',`${t('footer',lang)} · ${streamConnected?'SSE':'Polling'}`);set('.language-label',t('language',lang));
    set('.interval-label',`${t('update',lang)} (${t('seconds',lang)})`);
    set('.apply',t('apply',lang));set('.back',t('back',lang));set('.profile-label',t('profile',lang));set('.profile-note',t('profileHint',lang));
    set('.server-label',Number.isInteger(serverIntervalSeconds)&&serverIntervalSeconds>=1?`${t('serverAt',lang)}: ${serverIntervalSeconds} ${t('seconds',lang)} · ${t('server',lang)}`:t('server',lang));
    for(const key of ['local','production','custom'])set(`.profile-select option[value=\"${key}\"]`,t(key,lang));
    for (const [selector,key] of [['.pill','details'],['.close','close'],['.retry','retry'],['.settings-button','settings']]) {
      set(selector,t(key,lang),'aria-label');
    }
  }
  const schedule=()=>{clearTimeout(timer); if(!stopped && interval>0) timer=setTimeout(()=>void verify(), Math.max(1000,streamConnected?Math.max(60_000,interval):interval)*(document.hidden?3:1));};
  function render(result,manifest,report,expected) {
    const changed=lastState!=='' && lastState!==result.state;
    dot.className=`dot ${result.state}${changed?' changed':''}`;lastState=result.state;
    label.textContent=t(result.label,lang);
    const row=(key,value)=>`<div class="row"><span class="muted">${htmlEscape(t(key,lang))}</span><span class="item">${htmlEscape(value)}</span></div>`;
    const info=manifest?[row('published',manifest.version),row('commit',short(manifest.commit)),row('build',short(expected || '—'))].join(''):'';
    const checks=report && isPublicReport(report) && report.version?.version===manifest?.version && report.version?.commit===manifest?.commit
      ? `<div class="section"><strong>${htmlEscape(t('checks',lang))}</strong>${report.checks.map(x=>`<div class="row"><span class="item">${htmlEscape(translateCheck(x,lang))}</span><span class="${classFor(x.state)}">${htmlEscape(t(x.state,lang))}</span></div>`).join('')}${row('assets',`${report.assets.passed}/${report.assets.total}`)}${report.comparison?row('diff',`+${report.comparison.added} ~${report.comparison.changed} -${report.comparison.removed}`):''}</div>`:'';
    body.innerHTML=`${info}<div class="${classFor(result.state)}">${htmlEscape(translateMessage(result.message,lang))}</div>${checks}`;
    updateLabels();
  }
  const repaint=()=>{lastSignature='';if(currentResult)render(currentResult,currentManifest,currentReport,currentExpected);else updateLabels();};
  function showSettings(show) {
    if(settingsPane) settingsPane.hidden=!show;
    body.hidden=show;
    if(show) {const ls=get('.lang-select'),inp=get('.interval-input'),profile=get('.profile-select');if(ls)ls.value=lang;if(inp)inp.value=String(Math.round(interval/1000));if(profile)profile.value=interval===1000?'local':interval===10000?'production':'custom';}
  }
  get('.settings-button')?.addEventListener('click',()=>showSettings(settingsPane.hidden));
  get('.back')?.addEventListener('click',()=>showSettings(false));
  get('.profile-select')?.addEventListener('change',()=>{const selected=get('.profile-select')?.value;if(selected==='local')get('.interval-input').value='1';if(selected==='production')get('.interval-input').value='10';});
  get('.interval-input')?.addEventListener('input',()=>{const profile=get('.profile-select');if(profile)profile.value='custom';});
  get('.apply')?.addEventListener('click',()=>{
    const next=Number(get('.interval-input')?.value);
    if(!Number.isInteger(next)||next<1||next>3600) {get('.interval-input')?.setCustomValidity?.(lang==='es'?'Elige entre 1 y 3600 segundos.':'Choose 1–3600 seconds.');get('.interval-input')?.reportValidity?.();return;}
    lang=normalizeLanguage(get('.lang-select')?.value);interval=next*1000;
    savePrefs({language:lang,pollIntervalMs:interval});showSettings(false);repaint();schedule();
  });
  async function verify(pushedReport=undefined) {
    if(stopped || running)return;
    running=true;clearTimeout(timer);
    if(!lastSignature){dot.className='dot checking';label.textContent=t('checking',lang);}
    try {
      const manifestTarget=new URL(manifestUrl,location.href);
      const reportTarget=new URL(reportUrl || '.freshdeploy-report.json',manifestTarget);
      if(manifestTarget.origin!==location.origin || reportTarget.origin!==location.origin)throw new Error('Manifest and report must be same-origin.');
      const nonce=String(Date.now());manifestTarget.searchParams.set('_fd',nonce);reportTarget.searchParams.set('_fd',nonce);
      const response=await fetch(manifestTarget,{cache:'no-store'});
      if(!response.ok)throw new Error(`Manifest returned HTTP ${response.status}`);
      const manifest=await response.json();
      if(manifest.schemaVersion!==1||typeof manifest.version!=='string'||typeof manifest.commit!=='string')throw new Error('Invalid manifest');
      let report=pushedReport===undefined?null:pushedReport,reportProblem='';
      if(pushedReport===undefined)try{const res=await fetch(reportTarget,{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);report=await res.json();}catch(error){reportProblem=error.message;}
      if(stopped)return;
      const metaCommit=document.querySelector('meta[name="freshdeploy-commit"]')?.content;
      const metaVersion=document.querySelector('meta[name="freshdeploy-version"]')?.content;
      const commit=expectedCommit || (!expectedVersion && metaCommit) || '';
      const version=expectedVersion || (!commit && metaVersion) || '';
      const result=summarizeDeployment({manifest,report,expectedCommit:commit,expectedVersion:version,maxReportAgeMs});
      if(reportProblem && result.label==='report unavailable')result.message+=` (${reportProblem})`;
      currentResult=result;currentManifest=manifest;currentReport=report;currentExpected=commit || version;
      // Timestamp changes alone must not disturb an open panel or its scroll position.
      const visible=report?{...report,generatedAt:undefined}:null;
      const signature=JSON.stringify([manifest,visible,commit,version,reportProblem,result.state,result.label,lang]);
      if(signature!==lastSignature){lastSignature=signature;render(result,manifest,report,currentExpected);}
    }catch(error){
      if(stopped)return;
      const signature=`unavailable:${error.message}:${lang}`;
      if(signature!==lastSignature){lastSignature=signature;currentResult={state:'warn',label:'check unavailable',message:`Could not verify the published manifest: ${error.message}`};currentManifest=null;currentReport=null;render(currentResult,null,null,null);}
    }finally{running=false;schedule();}
  }
  const onVisibility=()=>{if(!document.hidden)void verify();};
  const onFocus=()=>void verify();const onOnline=()=>void verify();
  get('.retry').addEventListener('click',()=>void verify());
  document.addEventListener?.('visibilitychange',onVisibility);
  if(typeof window!=='undefined'){window.addEventListener('focus',onFocus);window.addEventListener('online',onOnline);}
  if(mode!=='polling' && sseUrl && typeof EventSource!=='undefined'){
    const endpoint=new URL(sseUrl,location.href);
    const secure=location.protocol!=='https:' || endpoint.protocol==='https:';
    if(secure && ['http:','https:'].includes(endpoint.protocol)) {
      stream=new EventSource(endpoint.href);
      stream.addEventListener('open',()=>{streamConnected=true;updateLabels();schedule();});
      stream.addEventListener('report',event=>{
        try{const data=JSON.parse(event.data);if(isPublicReport(data))void verify(data);else void verify();}
        catch{void verify();}
      });
      stream.addEventListener('error',()=>{streamConnected=false;updateLabels();schedule();});
    }
  }
  void verify();
  return {verify,destroy(){stopped=true;clearTimeout(timer);stream?.close();document.removeEventListener?.('visibilitychange',onVisibility);
    if(typeof window!=='undefined'){window.removeEventListener('focus',onFocus);window.removeEventListener('online',onOnline);}host.remove();}};
}
