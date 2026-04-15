import{o as w}from"../../catalog.js";import{n as o}from"../author-card/render.js";var d='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72ZM40,56H92.69l16,16H40Z"/></svg>';function h({sources:i,escapeHtml:e,mode:s}){const t=w(i.categories,4);if(!t.length)return'<div class="desktop-widget-empty">当前没有可展示的分类。</div>';const l="/categories",n=t.map(r=>{const a=r.color||"currentColor",c=r.icon||d,g=a!=="currentColor"?` style="color:${e(a)}"`:"";return o({href:e(r.permalink),app:"explorer-categories",className:"wg-cat-item",disabled:s==="preview",innerHtml:`
        <span class="wg-cat-icon"${g}>${c}</span>
        <span class="wg-cat-label">${e(r.name)}</span>
      `})}).join("");return`
    <div class="wg-cat-obsidian">
      <div class="wg-cat-header">
        <span class="wg-cat-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M224,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h64a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z"/></svg>
          分类
        </span>
        ${o({href:e(l),app:"explorer-categories",className:"wg-cat-more",disabled:s==="preview",innerHtml:`
            更多分类
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>
          `})}
      </div>
      <div class="wg-cat-grid">${n}</div>
    </div>`}export{h as t};
