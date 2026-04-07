import{h as z}from"../main.js";function M(t){const s=t instanceof Date?t:new Date,e=s.getFullYear(),a=s.getMonth(),i=s.getDate(),o=new Date(e,a,1).getDay(),d=new Date(e,a+1,0).getDate(),p=["日","一","二","三","四","五","六"],c=[];p.forEach(l=>{c.push(`<span class="desktop-widget-calendar-weekday">${l}</span>`)});for(let l=0;l<o;l+=1)c.push('<span class="desktop-widget-calendar-day is-empty"></span>');for(let l=1;l<=d;l+=1){const n=l===i?" is-today":"";c.push(`<span class="desktop-widget-calendar-day${n}">${l}</span>`)}return c.join("")}function P({now:t}){const s=t.getHours(),e=t.getMinutes(),a=t.getSeconds(),i=s%12*30+e*.5,o=e*6+a*.1,d=a*6,p=Array.from({length:12},(c,l)=>{const n=l+1,r=(n*30-90)*(Math.PI/180),g=40;return`<text x="${50+g*Math.cos(r)}" y="${50+g*Math.sin(r)}" text-anchor="middle" dominant-baseline="central" class="desktop-widget-clock-number">${n}</text>`}).join("");return`
    <div class="desktop-widget-clock">
      <svg viewBox="0 0 100 100" class="desktop-widget-clock-face">
        <circle cx="50" cy="50" r="49" class="desktop-widget-clock-dial"/>
        ${Array.from({length:60},(c,l)=>{const n=(l*6-90)*(Math.PI/180),r=l%5===0,g=r?44.5:46,w=48;return`<line x1="${50+g*Math.cos(n)}" y1="${50+g*Math.sin(n)}" x2="${50+w*Math.cos(n)}" y2="${50+w*Math.sin(n)}" class="desktop-widget-clock-tick${r?" is-hour":""}"/>`}).join("")}
        ${p}
        <line x1="50" y1="50" x2="50" y2="22" transform="rotate(${i} 50 50)" class="desktop-widget-clock-hand is-hour"/>
        <line x1="50" y1="50" x2="50" y2="14" transform="rotate(${o} 50 50)" class="desktop-widget-clock-hand is-minute"/>
        <line x1="50" y1="56" x2="50" y2="12" transform="rotate(${d} 50 50)" class="desktop-widget-clock-hand is-second"/>
        <circle cx="50" cy="50" r="2.2" class="desktop-widget-clock-center"/>
      </svg>
    </div>
  `}function T({now:t,escapeHtml:s},e,a={}){const i=e?.size==="small",o=e?.size==="medium",d=a.preview===!0?" is-preview":"",p=`${t.getMonth()+1}月`,c=`${t.getFullYear()}年`,l=t.toLocaleDateString("zh-CN",{weekday:"long"}),n=t.toLocaleDateString("zh-CN",{day:"numeric"}),r=String(n).replace(/[^\d]/g,"")||n;return i?`
      <div class="desktop-widget-calendar desktop-widget-calendar--mini${d}">
        <div class="desktop-widget-calendar-weekday-label">${s(l)}</div>
        <div class="desktop-widget-calendar-day-number">${s(r)}</div>
      </div>
    `:o?`
      <div class="desktop-widget-calendar desktop-widget-calendar--compact${d}">
        <div class="desktop-widget-calendar-left">
          <div class="desktop-widget-calendar-weekday-label">${s(l)}</div>
          <div class="desktop-widget-calendar-day-number">${s(r)}</div>
        </div>
        <div class="desktop-widget-calendar-right">
          <div class="desktop-widget-calendar-header">
            <span class="desktop-widget-calendar-header-month">${s(p)}</span>
            <span class="desktop-widget-calendar-header-year">${s(c)}</span>
          </div>
          <div class="desktop-widget-calendar-grid">${M(t)}</div>
        </div>
      </div>
    `:`
    <div class="desktop-widget-calendar desktop-widget-calendar--large${d}">
      <div class="desktop-widget-calendar-header">
        <span class="desktop-widget-calendar-header-month">${s(p)}</span>
        <span class="desktop-widget-calendar-header-year">${s(c)}</span>
      </div>
      <div class="desktop-widget-calendar-grid is-large">${M(t)}</div>
    </div>
  `}function u(t){const s=Number(t||0);if(!Number.isFinite(s)||s<0)return"0";if(s<1e3)return String(Math.round(s));if(s<1e6){const a=s/1e3;return a<10?`${Math.round(a*10)/10}k`:`${Math.round(a)}k`}const e=s/1e6;return e<10?`${Math.round(e*10)/10}m`:`${Math.round(e)}m`}function y(t){const s=t?new Date(t):null;return!s||Number.isNaN(s.getTime())?"":s.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}).replace("/",".")}function B(t){return Number(t?.postCount??t?.status?.postCount??t?.status?.visiblePostCount??0)||0}function N(t,s=0,e=[]){return Array.isArray(t)&&t.forEach(a=>{if(!a)return;const i=a?.metadata?.annotations||{};e.push({key:a?.metadata?.name||`category-${e.length+1}`,name:a?.spec?.displayName||a?.metadata?.name||"分类",permalink:a?.status?.permalink||"#",description:a?.spec?.description||"",cover:a?.spec?.cover||"",count:B(a),icon:i.icon||i["theme-sky-blog-3-category-setting/icon"]||"",color:i.color||i["theme-sky-blog-3-category-setting/color"]||"",depth:s}),Array.isArray(a.children)&&a.children.length&&N(a.children,s+1,e)}),e}function W(t,s){return N(t).filter(e=>e.permalink!=="#").sort((e,a)=>a.count-e.count||e.depth-a.depth||e.name.localeCompare(a.name,"zh-CN")).slice(0,Math.max(s||0,1))}function D(t,s={}){const e=t?.avatar||t?.spec?.avatar||s.logo||"";return{displayName:t?.displayName||t?.spec?.displayName||s.title||"站点作者",summary:t?.bio||t?.spec?.bio||s.subtitle||"持续发布博客内容",avatar:e,permalink:t?.permalink||s.url||"#"}}function S(t){const s=D([...Array.isArray(t?.latestPosts)?t.latestPosts:[],...Array.isArray(t?.popularPosts)?t.popularPosts:[]].map(a=>a?.owner).find(Boolean),t?.siteProfile||{}),e=t?.siteStats||{};return{...s,posts:Number(e?.post??(Array.isArray(t?.latestPosts)?t.latestPosts.length:0)??0)||0,comments:Number(e?.comment??0)||0,visits:Number(e?.visit??0)||0,moments:Array.isArray(t?.recentMoments)?t.recentMoments.length:0}}function L(t){return Number(t?.status?.visiblePostCount??t?.status?.postCount??t?.postCount??0)||0}function V(t){const s=L(t),e=t?.metadata?.annotations||{};return{name:t?.spec?.displayName||t?.metadata?.name||"标签",permalink:t?.status?.permalink||"#",count:s,icon:e["theme-sky-blog-3-tag-setting/icon"]||"",color:t?.spec?.color||""}}function _(t){let s=2166136261;const e=String(t||"");for(let a=0;a<e.length;a+=1)s^=e.charCodeAt(a),s=Math.imul(s,16777619);return s>>>0}function I(t){let s=t>>>0;return()=>(s=Math.imul(s,1664525)+1013904223>>>0,s/4294967296)}function C(t,s){const e=Array.isArray(t)?t.map(i=>V(i)).filter(i=>i.permalink!=="#"&&i.count>0):[];if(!e.length)return[];const a=I(_(`${new Date().toISOString().slice(0,10)}:${s}`));return e.map(i=>({tag:i,score:a()+Math.min(i.count,40)/100})).sort((i,o)=>o.score-i.score).slice(0,s).map(i=>i.tag).sort((i,o)=>o.count-i.count||i.name.localeCompare(o.name,"zh-CN"))}function h({href:t,app:s,className:e="",attrs:a="",innerHtml:i}){return!t||t==="#"?`<span class="${e||""}"${a?" "+a:""}>${i}</span>`:`<a class="${e?`${e} pjax-link`:"pjax-link"}" data-pjax-app="${s}" href="${t}"${a?" "+a:""}>${i}</a>`}function F({sources:t,escapeHtml:s},e,a={}){const i=e?.size||"medium";let o=3;i==="small"?o=1:i==="large"&&(o=4);const d=t.latestPosts.slice(0,o);if(!d.length)return'<div class="desktop-widget-empty">还没有可展示的文章。</div>';let p="";if(i==="small"){const c=d[0],l=s(c?.spec?.title||"未命名文章"),n=s(y(c?.spec?.publishTime)||""),r=c?.spec?.cover||t.fallbackCover||"",g=r?`<img class="wg-news-sm-img" src="${s(r)}" alt="">`:'<div class="wg-news-sm-img is-placeholder"></div>';p=h({href:s(c?.status?.permalink||"#"),app:"reader",className:"wg-news-sm",innerHtml:`
        ${g}
        <div class="wg-news-sm-scrim"></div>
        <div class="wg-news-sm-top">
          <span class="wg-news-sm-label">最新</span>
        </div>
        <div class="wg-news-sm-bottom">
          <strong>${l}</strong>
          <span>${n}</span>
        </div>
      `})}else if(i==="medium"){const c=d[0],l=s(c?.spec?.title||"未命名文章"),n=c?.spec?.cover||t.fallbackCover||"",r=n?`<img class="wg-news-md-img" src="${s(n)}" alt="" />`:'<div class="wg-news-md-img is-placeholder"></div>',g=d.slice(1).map(w=>{const m=s(w?.spec?.title||"未命名文章"),v=s(y(w?.spec?.publishTime)||"");return h({href:s(w?.status?.permalink||"#"),app:"reader",className:"wg-news-md-row",innerHtml:`
          <span class="wg-news-md-row-title">${m}</span>
          <span class="wg-news-md-row-date">${v}</span>
        `})}).join("");p=`
      ${h({href:s(c?.status?.permalink||"#"),app:"reader",className:"wg-news-md-cover",innerHtml:`
          ${r}
          <div class="wg-news-md-cover-scrim"></div>
        `})}
      <div class="wg-news-md-body">
        <div class="wg-news-md-meta">
          <span class="wg-news-md-category">最新发布</span>
          ${h({href:s(c?.status?.permalink||"#"),app:"reader",className:"wg-news-md-title",innerHtml:l})}
        </div>
        <div class="wg-news-md-list">${g}</div>
      </div>
    `}else{const c=d[0],l=s(c?.spec?.title||"未命名文章"),n=c?.spec?.cover||t.fallbackCover||"";p=`
      <div class="wg-news-lg-cover">
        ${n?`<img class="wg-news-lg-cover-img" src="${s(n)}" alt="">`:'<div class="wg-news-lg-cover-img is-placeholder"></div>'}
        <div class="wg-news-lg-cover-scrim"></div>
        <div class="wg-news-lg-cover-text">
          <span class="wg-news-lg-kicker">最新发布</span>
          <strong>${l}</strong>
        </div>
      </div>
      <div class="wg-news-lg-list">
        ${d.slice(1).map(r=>{const g=s(r?.spec?.title||"未命名文章"),w=s(y(r?.spec?.publishTime)||"");return h({href:s(r?.status?.permalink||"#"),app:"reader",className:"wg-news-lg-item",innerHtml:`
          <span class="wg-news-lg-indicator"></span>
          <span class="wg-news-lg-item-title">${g}</span>
          <span class="wg-news-lg-item-date">${w}</span>
        `})}).join("")}
        ${h({href:s(t.archivesUrl||"/archives"),app:"explorer",className:"wg-news-lg-viewall",innerHtml:"查看全部文章 →"})}
      </div>
    `}return`<div class="desktop-widget-news-layout is-${i}">${p}</div>`}function O({sources:t,escapeHtml:s},e,a={}){const i=a.compact===!0,o=e?.size||"medium";let d=3;o==="small"?d=1:o==="large"&&(d=i?4:5);const p=t.popularPosts.slice(0,d);if(!p.length)return'<div class="desktop-widget-empty">热门文章暂时为空。</div>';const c=Math.max(...p.map(n=>n?.stats?.visit??0),1);let l="";if(o==="small"){const n=p[0],r=s(n?.spec?.title||"未命名文章"),g=n?.stats?.visit??0,w=n?.spec?.cover||t.fallbackCover||"",m=w?`style="background-image:url('${s(w)}')"`:"",v=w?"":" is-no-cover";l=h({href:s(n?.status?.permalink||"#"),app:"reader",className:`wg-hot-sm${v}`,attrs:m,innerHtml:`
        <div class="wg-hot-sm-scrim"></div>
        <div class="wg-hot-sm-top">
          <span class="wg-hot-sm-badge">
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
          </span>
        </div>
        <div class="wg-hot-sm-bottom">
          <span class="wg-hot-sm-label">热门</span>
          <h3 class="wg-hot-sm-title">${r}</h3>
          <span class="wg-hot-sm-visits">${s(u(g))} 阅读</span>
        </div>
      `})}else if(o==="medium")l=`
      <div class="wg-hot-md-head">
        <svg class="wg-hot-md-icon" viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
        <span class="wg-hot-md-label">热门榜单</span>
      </div>
      <div class="wg-hot-md-list">${p.map((n,r)=>{const g=s(n?.spec?.title||"未命名文章"),w=n?.stats?.visit??0,m=Math.round(w/c*100);return h({href:s(n?.status?.permalink||"#"),app:"reader",className:"wg-hot-md-row",innerHtml:`
          <span class="wg-hot-md-rank${r<3?" is-top":""}">${String(r+1).padStart(2,"0")}</span>
          <div class="wg-hot-md-info">
            <span class="wg-hot-md-row-title">${g}</span>
            <div class="wg-hot-md-bar"><span style="width:${m}%"></span></div>
          </div>
          <span class="wg-hot-md-visits">${s(u(w))}</span>
        `})}).join("")}</div>
    `;else{const n=p[0],r=s(n?.spec?.title||"未命名文章"),g=n?.spec?.cover||t.fallbackCover||"",w=n?.stats?.visit??0,m=g?`<img class="wg-hot-lg-cover-img" src="${s(g)}" alt="" />`:'<div class="wg-hot-lg-cover-img is-placeholder"></div>',v=p.slice(1).map((k,f)=>{const $=s(k?.spec?.title||"未命名文章"),b=k?.stats?.visit??0,j=Math.round(b/c*100);return h({href:s(k?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-row",innerHtml:`
          <span class="wg-hot-lg-rank${f<2?" is-top":""}">${String(f+2).padStart(2,"0")}</span>
          <div class="wg-hot-lg-info">
            <span class="wg-hot-lg-row-title">${$}</span>
            <div class="wg-hot-lg-bar"><span style="width:${j}%"></span></div>
          </div>
          <span class="wg-hot-lg-visits">${s(u(b))}</span>
        `})}).join("");l=`
      <div class="wg-hot-lg-hero">
        ${h({href:s(n?.status?.permalink||"#"),app:"reader",className:"wg-hot-lg-cover",innerHtml:`
            ${m}
            <div class="wg-hot-lg-cover-scrim"></div>
            <div class="wg-hot-lg-cover-text">
              <span class="wg-hot-lg-badge">
                <svg viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"/></svg>
                TOP 1
              </span>
              <strong>${r}</strong>
              <span class="wg-hot-lg-hero-visits">${s(u(w))} 阅读</span>
            </div>
          `})}
      </div>
      <div class="wg-hot-lg-list">${v}</div>
    `}return`<div class="${`wg-hot-wrap wg-hot-wrap--${o}${i?" is-compact":""}`}">${l}</div>`}var Z='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Z"/></svg>';function E({sources:t,escapeHtml:s}){const e=W(t.categories,4);if(!e.length)return'<div class="desktop-widget-empty">当前没有可展示的分类。</div>';const a="/categories",i=e.map(o=>{const d=o.color||"currentColor",p=o.icon||Z,c=d!=="currentColor"?` style="color:${s(d)}"`:"";return h({href:s(o.permalink),app:"explorer",className:"wg-cat-item",innerHtml:`
        <span class="wg-cat-icon"${c}>${p}</span>
        <span class="wg-cat-label">${s(o.name)}</span>
      `})}).join("");return`
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M224,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h64a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z"/></svg>
          分类
        </span>
        ${h({href:s(a),app:"explorer",className:"wg-cat-more",innerHtml:`
            更多分类
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>
          `})}
      </div>
      <div class="wg-cat-grid">${i}</div>
    </div>`}function R({sources:t,escapeHtml:s},e){const a=S(t),i=s(a.permalink||"#"),o=a.avatar?`<img class="wg-author-avatar-img" src="${s(a.avatar)}" alt="${s(a.displayName)}">`:`<span class="wg-author-avatar-fallback">${s((a.displayName||"A").slice(0,1))}</span>`,d=i;return`
    <div class="wg-author-compact">
      ${h({href:i,app:"explorer",className:"wg-author-head",innerHtml:`
          <div class="wg-author-avatar">
            ${o}
            <div class="wg-author-status-dot"></div>
          </div>
          <div class="wg-author-info">
            <strong class="wg-author-name">${s(a.displayName)}</strong>
            <span class="wg-author-bio">${s(a.summary)}</span>
          </div>
        `})}
      <div class="wg-author-actions">
        ${h({href:d,app:"explorer",className:"wg-author-action-btn",attrs:'title="文章"',innerHtml:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>'})}
        ${h({href:"/moments",app:"moments-app",className:"wg-author-action-btn",attrs:'title="瞬间"',innerHtml:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'})}
      </div>
    </div>
  `}function U({modules:t,sources:s,escapeHtml:e},a){const i=s.siteStats;if(!i)return'<div class="desktop-widget-empty">站点统计当前不可用。</div>';const o='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',d='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',p='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',c='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',l='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>';if(a.size==="medium")return`
      <div class="wg-stat-micro">
        <div class="wg-stat-micro-label">
          <div class="wg-stat-pulse-dot"></div> 总访问量
        </div>
        <div class="wg-stat-micro-value glow-text-emerald">${e(u(i.visit??0))}</div>
      </div>
    `;if(a.size==="large"){const n=i.post??0,r=i.comment??0,g=n+r||1,w=n/g,m=r/g,v=251.3;return`
      <div class="wg-stat-ring">
        <div class="wg-stat-ring-title">内容分布</div>
        <div class="wg-stat-ring-chart-wrap">
          <svg viewBox="0 0 100 100" class="wg-stat-ring-svg">
            <circle cx="50" cy="50" r="40" fill="none" class="wg-stat-ring-bg-circle" stroke-width="14"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="14" stroke-dasharray="${v}" stroke-dashoffset="${v*(1-w)}" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="#f43f5e" stroke-width="14" stroke-dasharray="${v}" stroke-dashoffset="${v*(1-m)}" stroke-linecap="round" style="transform-origin: center; transform: rotate(${360*w}deg);"/>
          </svg>
          <div class="wg-stat-ring-center">
            <span class="wg-stat-ring-total">${e(u(g))}</span>
          </div>
        </div>
        <div class="wg-stat-ring-legend">
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-blue"></span><span>文章</span></div>
          <div class="wg-stat-legend-item"><span class="wg-stat-legend-dot bg-rose"></span><span>评论</span></div>
        </div>
      </div>
    `}return a.size==="extra-large"?`
      <div class="wg-stat-hero-solo">
        <div class="wg-stat-hero-solo-bg-icon">${l}</div>
        <div class="wg-stat-hero-solo-top">
          <div class="wg-stat-hero-solo-icon">${d}</div>
          <span class="wg-stat-hero-solo-badge">All Time</span>
        </div>
        <div class="wg-stat-hero-solo-bottom">
          <h3>总访问量</h3>
          <div class="wg-stat-hero-solo-value glow-text-emerald">${e(u(i.visit??0))}</div>
        </div>
      </div>
    `:`
    <div class="wg-stat-hero-list">
      <div class="wg-stat-hero">
        <div class="wg-stat-hero-bg-icon">${o}</div>
        <div class="wg-stat-hero-head">
          <div class="wg-stat-hero-icon">${d}</div>
          <span>总访问量</span>
        </div>
        <div class="wg-stat-hero-value glow-text-emerald">${e(u(i.visit??0))}</div>
      </div>
      <div class="wg-stat-list">
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-blue">${p}</span><span>文章总数</span></div>
          <span class="wg-stat-list-value">${e(u(i.post??0))}</span>
        </div>
        <div class="wg-stat-list-item">
          <div class="wg-stat-list-label"><span class="wg-stat-list-icon color-rose">${c}</span><span>评论互动</span></div>
          <span class="wg-stat-list-value">${e(u(i.comment??0))}</span>
        </div>
      </div>
    </div>
  `}function x(t,s=0){let e=s;for(let a=0;a<t.length;a++)e=(e<<5)-e+t.charCodeAt(a)|0;return(e&2147483647)%1e3/1e3}var A=[{top:"12%",left:"8%"},{top:"72%",left:"80%"},{top:"38%",left:"12%"},{top:"18%",left:"75%"},{top:"65%",left:"18%"},{top:"45%",left:"82%"},{top:"82%",left:"40%"}];function Y({sources:t,escapeHtml:s},e,a={}){const i=a.compact===!0,o=e?.size||"medium";if(o==="small"){const n=C(t.randomTags,8);return n.length?`<div class="wg-tag-focus-stage" data-tag-focus>${n.map((r,g)=>{const w=A[g%A.length],m=Object.entries(w).map(([f,$])=>`${f}:${$}`).join(";"),v=r.color||"#A1A1AA",k=g===0?"wg-tag-focus-item is-focus":"wg-tag-focus-item";return h({href:s(r.permalink),app:"explorer",className:k,attrs:`style="${m};--tag-color:${s(v)}"`,innerHtml:s(r.name)})}).join("")}</div>`:'<div class="desktop-widget-empty">无标签</div>'}const d=i?10:12,p=C(t.randomTags,d);if(!p.length)return'<div class="desktop-widget-empty">当前没有可展示的标签。</div>';const c=(n,r,g="")=>{const w=n.color||"#A1A1AA",m=((x(n.name,1)-.5)*5).toFixed(1),v=((x(n.name,2)-.5)*3.2).toFixed(1),k=((x(n.name,3)-.5)*3.2).toFixed(1),f=r%4;return h({href:s(n.permalink),app:"explorer",className:`wg-tag-chip ${g} tone-${f}`,attrs:`title="${s(n.name)}" style="--tag-color:${s(w)};--j-rot:${m}deg;--j-tx:${v}px;--j-ty:${k}px;"`,innerHtml:s(n.name)})};let l="";if(o==="large"){const n=p[0],r=p.slice(1),g=n?h({href:s(n.permalink),app:"explorer",className:"wg-tag-feature",attrs:`style="--tag-color:${s(n.color||"#A1A1AA")}"`,innerHtml:`
        <span class="wg-tag-feature-kicker">探索</span>
        <strong>${s(n.name)}</strong>
      `}):"",w=r.map((m,v)=>c(m,v)).join("");l=`
      <div class="wg-tag-wall-shell is-large${i?" is-compact":""}">
        ${g}
        <div class="wg-tag-wall is-large${i?" is-compact":""}">${w}</div>
      </div>
    `}else{const n=p.map((r,g)=>c(r,g)).join("");l=`<div class="wg-tag-wall is-medium${i?" is-compact":""}">${n}</div>`}return l}typeof document<"u"&&setInterval(()=>{document.querySelectorAll("[data-tag-focus]").forEach(t=>{const s=t.querySelectorAll(".wg-tag-focus-item");if(s.length<2)return;let e=-1;s.forEach((i,o)=>{i.classList.contains("is-focus")&&(e=o)});const a=(e+1)%s.length;s.forEach((i,o)=>{i.classList.toggle("is-focus",o===a)})})},4e3);function q({sources:t,escapeHtml:s,normalizeMomentRecord:e},a){if(!t.momentsAvailable)return'<div class="desktop-widget-empty">未安装 Moments 插件。</div>';const i=t.recentMoments.slice(0,1).map(n=>e(n));if(!i.length)return'<div class="desktop-widget-empty">还没有可展示的瞬间。</div>';const o=i[0],d=S(t),p=o.tags.length>0?o.tags[0]:"",c=t.recentMoments[0]?.stats?.upvote??0,l=t.recentMoments[0]?.stats?.totalComment??0;return h({href:s(o.permalink),app:"moments-app",className:"wg-moment-social",innerHtml:`
      <span class="wg-moment-social-header">
        <span class="wg-moment-social-avatar">
          <img src="${s(d.avatar||"/logo")}" alt="">
        </span>
        <span class="wg-moment-social-info">
          <span class="wg-moment-social-name">${s(d.displayName||"作者")}</span>
          <span class="wg-moment-social-time">${s(o.listTime)}</span>
        </span>
        ${p?`<span class="wg-moment-social-tag">#${s(p)}</span>`:""}
      </span>
      <span class="wg-moment-social-content">${s(o.summary)}</span>
      <span class="wg-moment-social-bar">
        <span class="wg-moment-social-stat is-heart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><b>${c}</b></span>
        <span class="wg-moment-social-stat is-chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><b>${l}</b></span>
      </span>
    `})}function G(t,s){return`
    <div class="desktop-widget-empty">
      <strong>${t(s.title)}</strong>
      <span>当前组件已注册，但前端渲染器还没有接入。</span>
    </div>
  `}function K(t,s){const e=s?.data;return e||{city:t.weather.cityName||"天气",temperature:"--",high:"--",low:"--",apparent:"--",humidity:"--",windSpeed:"--",condition:"等待数据",icon:"☁︎",tone:"cloudy",updatedAt:null}}function J(t,s){return`
    <div class="desktop-widget-weather desktop-widget-weather--small is-${s(t.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-top">
        <span class="desktop-widget-weather-city">${s(t.city)}</span>
        <span class="desktop-widget-weather-icon">${s(t.icon)}</span>
      </div>
      <div class="desktop-widget-weather-hero">
        <span class="desktop-widget-weather-temp">${s(`${t.temperature}°`)}</span>
      </div>
      <div class="desktop-widget-weather-foot">
        <span class="desktop-widget-weather-cond">${s(t.condition)}</span>
        <span class="desktop-widget-weather-hilo">H:${s(`${t.high}°`)} L:${s(`${t.low}°`)}</span>
      </div>
    </div>
  `}function Q(t,s){return`
    <div class="desktop-widget-weather desktop-widget-weather--medium is-${s(t.tone)}">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      
      <!-- 左侧：主信息 -->
      <div class="desktop-widget-weather-m-main">
        <div class="desktop-widget-weather-m-top">
          <h4 class="desktop-widget-weather-m-city">${s(t.city)}</h4>
          <span class="desktop-widget-weather-m-cond">${s(t.condition)}</span>
        </div>
        <div class="desktop-widget-weather-m-bottom">
          <span class="desktop-widget-weather-m-temp">${s(`${t.temperature}°`)}</span>
          <div class="desktop-widget-weather-m-icon is-float">${s(t.icon)}</div>
        </div>
      </div>
      
      <!-- 右侧：当前状况 stats -->
      <div class="desktop-widget-weather-m-details">
        <div class="desktop-widget-weather-m-details-title">
          <span>当前统计</span>
        </div>
        <div class="desktop-widget-weather-m-stats">
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">体感</span>
            <span class="desktop-widget-weather-m-stat-val">${s(`${t.apparent}°`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">湿度</span>
            <span class="desktop-widget-weather-m-stat-val">${s(`${t.humidity}%`)}</span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="desktop-widget-weather-m-stat-lbl">风速</span>
            <span class="desktop-widget-weather-m-stat-val">${s(`${t.windSpeed}`)} km/h</span>
          </div>
        </div>
        <div class="desktop-widget-weather-m-hilo">
          <div class="flex-between">
            <span>最高</span>
            <span>${s(`${t.high}°`)}</span>
          </div>
          <div class="flex-between">
            <span>最低</span>
            <span>${s(`${t.low}°`)}</span>
          </div>
        </div>
      </div>
    </div>
  `}function X({modules:t,weatherState:s,escapeHtml:e},a,i={}){const o=t.weather.cityName,d=a?.size==="small";if(!o)return'<div class="desktop-widget-empty">请先在后台设置天气组件城市。</div>';if(s.loading&&!s.data)return d?H():ss();const p=K(t,s);return d?J(p,e):Q(p,e)}function H(){return`
    <div class="desktop-widget-weather desktop-widget-weather--small wg-weather-skeleton">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-top">
        <span class="wg-skel-pill" style="width:42px;height:10px"></span>
        <span class="wg-skel-pill" style="width:18px;height:18px;border-radius:50%"></span>
      </div>
      <div class="desktop-widget-weather-hero">
        <span class="wg-skel-pill" style="width:56px;height:32px"></span>
      </div>
      <div class="desktop-widget-weather-foot">
        <span class="wg-skel-pill" style="width:36px;height:9px"></span>
        <span class="wg-skel-pill" style="width:60px;height:9px"></span>
      </div>
    </div>
  `}function ss(){return`
    <div class="desktop-widget-weather desktop-widget-weather--medium wg-weather-skeleton">
      <div class="desktop-widget-weather-atmo" aria-hidden="true"></div>
      <div class="desktop-widget-weather-m-main">
        <div class="desktop-widget-weather-m-top">
          <span class="wg-skel-pill" style="width:52px;height:12px"></span>
          <span class="wg-skel-pill" style="width:38px;height:9px;margin-top:4px"></span>
        </div>
        <div class="desktop-widget-weather-m-bottom">
          <span class="wg-skel-pill" style="width:68px;height:36px"></span>
          <span class="wg-skel-pill" style="width:32px;height:32px;border-radius:50%"></span>
        </div>
      </div>
      <div class="desktop-widget-weather-m-details">
        <div class="desktop-widget-weather-m-details-title">
          <span class="wg-skel-pill" style="width:50px;height:9px"></span>
        </div>
        <div class="desktop-widget-weather-m-stats">
          <div class="desktop-widget-weather-m-stat">
            <span class="wg-skel-pill" style="width:20px;height:8px"></span>
            <span class="wg-skel-pill" style="width:28px;height:10px;margin-top:3px"></span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="wg-skel-pill" style="width:20px;height:8px"></span>
            <span class="wg-skel-pill" style="width:28px;height:10px;margin-top:3px"></span>
          </div>
          <div class="desktop-widget-weather-m-stat">
            <span class="wg-skel-pill" style="width:20px;height:8px"></span>
            <span class="wg-skel-pill" style="width:28px;height:10px;margin-top:3px"></span>
          </div>
        </div>
        <div class="desktop-widget-weather-m-hilo">
          <div class="flex-between">
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
          </div>
          <div class="flex-between">
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
            <span class="wg-skel-pill" style="width:24px;height:9px"></span>
          </div>
        </div>
      </div>
    </div>
  `}var as=z({renderDesktopWidget:()=>ts});function ts(t,s,e={}){switch(s.widget){case"system.clock":return P(t,s,e);case"system.calendar":return T(t,s,e);case"system.weather":return X(t,s,e);case"halo.latest_posts":return F(t,s,e);case"halo.popular_posts":return O(t,s,e);case"halo.categories":return E(t,s,e);case"halo.author_card":return R(t,s,e);case"halo.site_stats":return U(t,s,e);case"halo.random_tags":return Y(t,s,e);case"plugin-moments.recent":return q(t,s,e);default:return G(t.escapeHtml,s)}}export{N as n,as as t};
