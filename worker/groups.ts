/**
 * Groups prototype (no accounts): a group is a short code; players pick a display name.
 * Behind GROUPS_ENABLED; storage is D1 (free tier). Writes are validated and capped.
 */
type Env = { DB?: D1Database; GROUPS_ENABLED?: string };
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function newCode() { const b = crypto.getRandomValues(new Uint8Array(6)); return [...b].map((x) => ALPHA[x % ALPHA.length]).join(""); }

export async function handleGroups(req: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith("/api/groups") && !p.startsWith("/g")) return null;
  if (env.GROUPS_ENABLED !== "1" || !env.DB) return new Response("Not found", { status: 404 });
  const db = env.DB;

  if (p === "/api/groups" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = clean(body.name, 40);
    if (!name) return json({ error: "Name required" }, 400);
    const code = newCode();
    await db.prepare("INSERT INTO groups (code, name, created_at) VALUES (?, ?, ?)").bind(code, name, new Date().toISOString()).run();
    return json({ code, name });
  }
  const m = p.match(/^\/api\/groups\/([A-Z0-9]{6})(\/scores)?$/);
  if (m) {
    const code = m[1];
    if (!CODE_RE.test(code)) return json({ error: "Bad code" }, 400);
    const g = await db.prepare("SELECT code, name FROM groups WHERE code = ?").bind(code).first<{ code: string; name: string }>();
    if (!g) return json({ error: "No such group" }, 404);
    if (m[2] && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { puzzle?: number; player?: string; total?: number };
      const player = clean(b.player, 24), puzzle = Math.trunc(Number(b.puzzle)), total = Math.trunc(Number(b.total));
      if (!player || !(puzzle > 0 && puzzle < 100000) || !(total >= 0 && total <= 9000)) return json({ error: "Invalid score" }, 400);
      // First score per player per daily wins (no overwrite — keeps it honest-ish without accounts).
      await db.prepare("INSERT OR IGNORE INTO scores (code, puzzle, player, total, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(code, puzzle, player, total, new Date().toISOString()).run();
      return json({ ok: true });
    }
    const n = Math.trunc(Number(url.searchParams.get("n")));
    const rows = await db.prepare("SELECT player, total FROM scores WHERE code = ? AND puzzle = ? ORDER BY total DESC LIMIT 50").bind(code, n).all();
    return json({ ...g, puzzle: n, board: rows.results });
  }
  if (p === "/g" || p === "/g/") return page("Start a Versemark group", NEW_BODY);
  const gm = p.match(/^\/g\/([A-Z0-9]{6})\/?$/);
  if (gm) {
    const g = await db.prepare("SELECT name FROM groups WHERE code = ?").bind(gm[1]).first<{ name: string }>();
    if (!g) return page("Group not found", `<h1>Group not found</h1><p><a href="/g">Start a group</a></p>`, 404);
    return page(`${g.name} · Versemark group`, BOARD_BODY(gm[1], g.name));
  }
  return null;
}

const CSS = `body{margin:0;background:#faf8f4;color:#1c1916;font:17px/1.45 Charter,Georgia,serif;padding:32px 22px;max-width:480px;margin:auto}
h1{font-size:30px;margin:0 0 6px}p.m{color:#7a7068;margin:0 0 22px}label{display:block;font-size:14px;color:#7a7068;margin:16px 0 6px}
input{width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #d9d2c7;background:#fff;border-radius:0}
button,.btn{display:block;width:100%;box-sizing:border-box;margin-top:18px;padding:14px;font:inherit;font-weight:700;background:#b74b21;color:#fff;border:0;text-align:center;text-decoration:none}
.btn2{background:transparent;color:#1c1916;border:1px solid #d9d2c7;font-weight:400}ol{padding:0;list-style:none;margin:18px 0}
li{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e3ddd3}li b{font-variant-numeric:tabular-nums}
.code{font:700 26px ui-monospace,monospace;letter-spacing:4px}.bar{display:flex;height:10px;margin:8px 0 26px}.bar i{display:block}`;
const BAR = `<div class="bar"><i style="flex:5852;background:#6ec272"></i><i style="flex:7018;background:#e1755a"></i><i style="flex:4785;background:#bc88f4"></i><i style="flex:5490;background:#e36558"></i><i style="flex:4786;background:#ee7d8d"></i><i style="flex:2767;background:#00beaf"></i><i style="flex:404;background:#e36558"></i></div>`;
const TODAY_JS = `function today(){var e=new Date(2026,7,1),d=new Date();d=new Date(d.getFullYear(),d.getMonth(),d.getDate());return Math.round((d-e)/864e5)+1}`;
function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:image" content="/api/og"><style>${CSS}</style></head><body>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
const NEW_BODY = `<h1>Start a group</h1><p class="m">Everyone plays the same daily. Your group sees one leaderboard. No accounts.</p>${BAR}
<form id="f"><label for="n">Group name</label><input id="n" maxlength="40" required placeholder="Tuesday small group">
<label for="p">Your name</label><input id="p" maxlength="24" required placeholder="Dylan"><button>Create group</button></form>
<script>document.getElementById("f").onsubmit=async function(e){e.preventDefault();var n=document.getElementById("n").value,p=document.getElementById("p").value;
var r=await fetch("/api/groups",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:n})});var g=await r.json();if(!g.code)return alert(g.error||"Error");
localStorage.setItem("versemark:group",JSON.stringify({code:g.code,name:g.name,player:p}));location.href="/g/"+g.code+"?new=1"}</script>`;
function BOARD_BODY(code: string, name: string) {
  return `<h1>${esc(name)}</h1><p class="m">Group code <span class="code">${code}</span></p>${BAR}
<div id="share"></div><h2 style="font-size:18px;margin:8px 0 0" id="t">Today</h2><ol id="b"><li><span>Loading…</span></li></ol>
<div id="join" hidden><label for="p">Your name</label><input id="p" maxlength="24" placeholder="Your name"><button id="j">Join and play today</button></div>
<a class="btn" id="play" href="/" hidden>Play today's daily</a>
<script>${TODAY_JS};var C=${JSON.stringify(code)},N=${JSON.stringify(name)},n=today(),me=null;try{me=JSON.parse(localStorage.getItem("versemark:group")||"null")}catch(e){}
document.getElementById("t").textContent="Daily #"+n;document.getElementById("play").href="/?daily="+n;
fetch("/api/groups/"+C+"?n="+n).then(r=>r.json()).then(g=>{var b=document.getElementById("b");b.innerHTML="";
if(!g.board||!g.board.length){b.innerHTML="<li><span>No scores yet today — be first.</span></li>"}
(g.board||[]).forEach(function(r,i){var li=document.createElement("li");var a=document.createElement("span");a.textContent=(i+1)+". "+r.player;var s=document.createElement("b");s.textContent=r.total+" pts";li.append(a,s);b.append(li)})});
if(me&&me.code===C){document.getElementById("play").hidden=false;var sh=document.createElement("a");sh.className="btn btn2";sh.textContent="Invite friends";sh.href="#";
sh.onclick=function(e){e.preventDefault();var u=location.origin+"/g/"+C,t="Join "+N+" on Versemark: "+u;navigator.share?navigator.share({text:t}).catch(function(){}):navigator.clipboard.writeText(t).then(function(){sh.textContent="Link copied"})};
document.getElementById("share").append(sh)}else{document.getElementById("join").hidden=false;
document.getElementById("j").onclick=function(){var p=document.getElementById("p").value.trim();if(!p)return;localStorage.setItem("versemark:group",JSON.stringify({code:C,name:N,player:p}));location.href="/?daily="+n}}</script>`;
}
