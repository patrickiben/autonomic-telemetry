/* Shared, DOM-only inspection view. It never changes inference or inputs. */
(function (root) {
  'use strict';
  const cache = new WeakMap();
  const finite = Number.isFinite;
  const names = {heart_rate_bpm:'HR',pulse_rmssd_ms:'Pulse RMSSD',resp_rate_brpm:'Breathing',eeg_beta_alpha:'EEG beta/alpha',pulse_sdnn_ms:'Pulse SDNN'};
  const el = (tag, text, cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; };
  const fmt = (x,d=2) => finite(x)?x.toFixed(d):'—';
  function line(values, label, color) {
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 300 72');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);
    const usable=values.filter(finite); if(usable.length<2)return svg;
    const lo=Math.min(...usable),hi=Math.max(...usable),span=Math.max(hi-lo,1e-6);
    const p=document.createElementNS(svg.namespaceURI,'path');let drawing=false;
    p.setAttribute('d',values.map((v,i)=>{if(!finite(v)){drawing=false;return '';}const s=(drawing?'L':'M')+(4+i*292/Math.max(1,values.length-1)).toFixed(2)+','+(66-(v-lo)*60/span).toFixed(2);drawing=true;return s;}).join(' '));
    p.setAttribute('fill','none');p.setAttribute('stroke',color);p.setAttribute('stroke-width','1.8');svg.append(p);return svg;
  }
  function render(container, s) {
    if(!container||!s)return;
    const r=s.research||{},signature=JSON.stringify([s.phase,s.value,r.received_at,s.reference?.progress,s.weights,s.events?.length,s.reference?.resetNeeded]);
    if(cache.get(container)===signature)return;cache.set(container,signature);
    const open=container.querySelector('details')?.open??false;
    container.replaceChildren();container.classList.add('math-view');
    container.append(el('h3',s.viewTitle||'Live mathematical state'));
    container.append(el('p',`${s.modelVersion||'Multivariate model'} · ${s.weights?.coveredNominal??0} of 100 original weight points supported by this fixed profile. Available terms are normalized once when the reference is formed.`,'math-note'));
    if(s.phase==='ready')container.append(el('p',`Current weighted sum ${fmt(s.baseScore,1)} × ${fmt(s.modifierMultiplier,3)} = ${fmt(s.rawScore,1)} after the 0–100 bound. Displayed index ${fmt(s.value,1)} uses the trailing five-second median.`,'math-equation'));
    if(s.reference?.resetNeeded?.length)container.append(el('p','New inputs are available: '+s.reference.resetNeeded.map(k=>names[k]||k).join(', ')+'. Build a new reference to include them.','math-notice'));
    const current=s.phase==='ready',grid=el('div',undefined,'math-grid');
    const cards=[
      ['Predictive surprise',r.surprise, r.surprise?.value,'Causal AR(1) forecast error; used by the onset detector.'],
      ['Multivariate distance',r.turbulence,r.turbulence?.distance,'Regularized Mahalanobis distance; contributes to the index.'],
      ['Shared-mode fraction',r.coupling,r.coupling?.absorptionRatio,'Leading eigenvalue share of the rolling correlation matrix.'],
      ['Sample entropy',r.entropy,r.entropy?.value,r.entropy?.key==='heart_rate_bpm'?'HR temporal pattern. Fragility modulation requires RMSSD.':'RMSSD temporal pattern; contributes through fragility.'],
      ['HR autocorrelation',r.autocorrelation,r.autocorrelation?.value,'Lag-one persistence; contributes through fragility.'],
      ['Pattern modifiers',null,current?100*((s.modifierMultiplier??r.modifierMultiplier??1)-1):null,'Bounded fragility and breath-leading-HR modulation.']
    ];
    for(const [label,metric,value,description] of cards){
      const card=el('div',undefined,'math-cell');card.append(el('span',label),el('strong',current&&(metric===null||metric?.available)?fmt(value)+(label==='Pattern modifiers'?'%':''):'—'));
      card.append(el('small',!current?'Current analysis is unavailable.':metric&& !metric.available?(metric.reason||'More eligible history or input required.'):description));grid.append(card);
    }
    container.append(grid);
    const details=el('details');details.open=open;details.append(el('summary','Prediction history, coupling, and state trajectory'));
    if(current&&r.surprise?.available){
      const values=(r.surprise.series||[]).slice(-120).map(x=>typeof x==='number'?x:x?.value??x?.halfSquaredError??null);
      details.append(line(values,'Causal prediction-error history','#efb0bc'));
    }
    const modifiers=el('div',undefined,'math-lags');
    for(const [key,label] of [['fragility','Autocorrelation/entropy modifier'],['lead','Breath-leading-HR modifier']]) {
      const m=r[key];modifiers.append(el('p',label+': '+(current&&m?.available?fmt(100*(m.multiplier-1))+'% added to the multiplier':m?.reason||'Unavailable')));
    }
    if(current&&r.surprise?.available)modifiers.append(el('p','Onset surprise threshold: '+fmt(r.surprise.threshold)+'. At least two directional step votes are also required.'));
    details.append(modifiers);
    const lags=el('div',undefined,'math-lags');
    for(const lag of r.crosslags||[]){
      lags.append(el('p',`${names[lag.from]||lag.from} / ${names[lag.to]||lag.to}: `+(current&&lag.available?`${fmt(lag.lagSeconds,1)} s · r ${fmt(lag.correlation)}`:(lag.reason||'Unavailable'))));
    }
    if(!lags.childElementCount)lags.append(el('p','Lead–lag analysis needs eligible history from multiple channels.'));
    details.append(lags,el('small','Positive lag: the first channel leads. Negative lag: the second channel leads. Association does not establish cause.','math-note'));
    const m=r.manifold;
    if(current&&m?.available&&m.coordinates?.length>1){
      const points=m.coordinates, xs=points.map(p=>p[0]),ys=points.map(p=>p[1]??0),xmin=Math.min(...xs),xspan=Math.max(1e-6,Math.max(...xs)-xmin),ymin=Math.min(...ys),yspan=Math.max(1e-6,Math.max(...ys)-ymin);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 300 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','Standardized PCA trajectory');
      const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',points.map((v,i)=>(i?'L':'M')+(8+(v[0]-xmin)*284/xspan).toFixed(1)+','+(142-((v[1]??0)-ymin)*134/yspan).toFixed(1)).join(' '));p.setAttribute('fill','none');p.setAttribute('stroke','#a9e4e8');p.setAttribute('stroke-width','1.7');svg.append(p);details.append(svg,el('small','Standardized PCA · rolling eligible observations','math-note'));
    }else details.append(el('p',m?.reason||'PCA needs a varying multichannel history.','math-note'));
    container.append(details);
    const events=el('div',undefined,'math-events');events.append(el('h4','Convergent onsets'));
    const recent=(s.events||[]).slice(-5).reverse();
    if(!recent.length)events.append(el('p','No qualifying onset in this session. Surprise must cross its reference threshold and at least two cardiac/respiratory channels must show a step change.','math-note'));
    for(const e of recent){const stamp=e.timestamp??e.time;events.append(el('p',(finite(stamp)?new Date(stamp).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}):'Onset')+' · '+(Array.isArray(e.drivers)?e.drivers.map(k=>names[k]||k).join(' + '):e.drivers||'Convergent change')+' · peak surprise '+fmt(e.peak)+(finite(e.recoveryMs)?' · onset subsided after '+Math.round(e.recoveryMs/1000)+' s':' · '+(e.endReason||'observed onset'))));}
    container.append(events);
  }
  root.TelemetryAnalysisView=Object.freeze({render});
})(globalThis);
