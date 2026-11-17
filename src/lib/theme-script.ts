import { BRAND_STORAGE_KEY, LEGACY_TONE_KEYS, TONE_STORAGE_KEY } from "@/lib/brand";

/**
 * Runs before the page paints so a dark office never flashes white.
 * Sets data-brand and data-tone on <html>. My Theme also sets its four
 * colours (Dark is derived here when the office has not set one).
 * Kept free of imports at runtime: the string below is the whole program.
 */
export const THEME_SCRIPT = `(function(){
  var BRAND=${JSON.stringify(BRAND_STORAGE_KEY)};
  var TONE=${JSON.stringify(TONE_STORAGE_KEY)};
  var LEGACY=${JSON.stringify([...LEGACY_TONE_KEYS])};
  var IDS=["blue","sunset","harbor","grove","cedar","mine"];
  function hex(v){
    if(typeof v!=="string") return null;
    var m=/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim());
    if(!m) return null;
    var h=m[1].toLowerCase();
    if(h.length===3) h=h.split("").map(function(c){return c+c}).join("");
    return "#"+h;
  }
  function mix(a,b,amount){
    var x=parseInt(a.slice(1),16), y=parseInt(b.slice(1),16);
    var out=[16,8,0].map(function(shift){
      var av=(x>>shift)&255, bv=(y>>shift)&255;
      return Math.round(Math.max(0,Math.min(255,av+(bv-av)*amount)));
    });
    return "#"+out.map(function(v){return v.toString(16).padStart(2,"0")}).join("");
  }
  function lum(h){
    var n=parseInt(h.slice(1),16);
    var lin=[(n>>16)&255,(n>>8)&255,n&255].map(function(v){
      var c=v/255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);
    });
    return 0.2126*lin[0]+0.7152*lin[1]+0.0722*lin[2];
  }
  function contrast(a,b){
    var x=lum(a), y=lum(b), hi=Math.max(x,y), lo=Math.min(x,y);
    return (hi+0.05)/(lo+0.05);
  }
  function derive(light){
    return {
      background:mix(light.background,"#000000",0.92),
      surface:mix(light.background,"#000000",0.86),
      text:mix(light.surface,"#ffffff",0.1),
      accent:mix(light.accent,"#ffffff",0.3)
    };
  }
  function colors(raw){
    if(!raw) return null;
    var accent=hex(raw.accent), background=hex(raw.background), surface=hex(raw.surface), text=hex(raw.text);
    if(!(accent&&background&&surface&&text)) return null;
    var out={accent:accent,background:background,surface:surface,text:text};
    ["link","muted","heading","button","buttonText","line","badge","danger"].forEach(function(k){
      var h=hex(raw[k]); if(h) out[k]=h;
    });
    return out;
  }
  try {
    var root=document.documentElement;
    var q=new URLSearchParams(location.search);
    var locked=location.pathname==="/theme-lab";
    var raw=null;
    try { raw=JSON.parse(localStorage.getItem(BRAND)||"null"); } catch(e) { raw=null; }
    var id=raw&&typeof raw.theme==="string"?raw.theme:"blue";
    if(IDS.indexOf(id)<0) id="blue";
    var tone=localStorage.getItem(TONE);
    if(tone!=="light"&&tone!=="dark"){
      tone="light";
      for(var i=0;i<LEGACY.length;i++){ if(localStorage.getItem(LEGACY[i])==="dark") tone="dark"; }
    }
    if(locked){
      var forced=q.get("theme");
      var forcedTone=q.get("tone");
      if(forced&&IDS.indexOf(forced)>=0) id=forced;
      if(forcedTone==="light"||forcedTone==="dark") tone=forcedTone;
      root.setAttribute("data-theme-lock","1");
    }
    var mine=colors(raw&&raw.mine);
    var mineDark=colors(raw&&raw.mineDark);
    if(id==="mine"&&!mine&&!locked) id="blue";
    root.setAttribute("data-brand",id);
    root.setAttribute("data-tone",tone);
    ["--my-bg","--my-surface","--my-text","--my-accent","--my-accent-ink","--my-btn-ink","--my-link","--my-muted","--my-heading","--my-heading-ink","--my-button","--my-button-text","--my-line","--my-badge","--my-badge-ink","--my-danger"].forEach(function(name){
      root.style.removeProperty(name);
    });
    if(id==="mine"){
      var c=tone==="dark"?(mineDark||(mine?derive(mine):null)):(mine||{accent:"#0d79bf",background:"#eef6fb",surface:"#fdfefe",text:"#172a3a"});
      if(c){
        var ink=c.accent, guard=0;
        while(guard<24 && contrast(ink,c.surface)<4.5){ ink=mix(ink,c.text,0.12); guard++; }
        root.style.setProperty("--my-bg",c.background);
        root.style.setProperty("--my-surface",c.surface);
        root.style.setProperty("--my-text",c.text);
        root.style.setProperty("--my-accent",c.accent);
        root.style.setProperty("--my-accent-ink",ink);
        var button=c.button||c.accent;
        var buttonText=c.buttonText||(contrast(button,"#ffffff")>=contrast(button,"#000000")?"#ffffff":"#000000");
        var muted=c.muted||c.text, ms=0;
        if(!c.muted){ while(ms<16){ var nxt=mix(muted,c.surface,0.12); if(contrast(nxt,c.surface)<4.5) break; muted=nxt; ms++; } }
        var heading=c.heading||c.accent;
        var badge=c.badge||mix(c.accent,c.surface,0.84);
        var danger=c.danger||"#c9423a", dg=0;
        if(!c.danger){ while(dg<24 && contrast(danger,c.surface)<4.5){ danger=mix(danger,c.text,0.12); dg++; } }
        root.style.setProperty("--my-btn-ink",buttonText);
        root.style.setProperty("--my-link",c.link||ink);
        root.style.setProperty("--my-muted",muted);
        root.style.setProperty("--my-heading",heading);
        root.style.setProperty("--my-heading-ink",contrast(heading,"#ffffff")>=contrast(heading,"#000000")?"#ffffff":"#000000");
        root.style.setProperty("--my-button",button);
        root.style.setProperty("--my-button-text",buttonText);
        root.style.setProperty("--my-line",c.line||mix(c.text,c.surface,0.82));
        root.style.setProperty("--my-badge",badge);
        root.style.setProperty("--my-badge-ink",contrast(c.text,badge)>=4.5?c.text:(contrast(badge,"#ffffff")>=contrast(badge,"#000000")?"#ffffff":"#000000"));
        root.style.setProperty("--my-danger",danger);
      }
    }
  } catch(e) {
    document.documentElement.setAttribute("data-brand","blue");
    document.documentElement.setAttribute("data-tone","light");
  }
})();`;
