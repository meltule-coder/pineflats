const { app, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const { Client } = require("ssh2");
const UD = path.join(process.env.APPDATA || "", "pineflats-vps-access");
try { app.setName("pineflats-vps-access"); app.setPath("userData", UD); } catch (e) {}
function dec(s){if(!s)return"";if(typeof s==="string")return s;try{if(s.encrypted&&safeStorage.isEncryptionAvailable())return safeStorage.decryptString(Buffer.from(s.value,"base64"));if(s.value)return Buffer.from(s.value,"base64").toString("utf8");}catch(e){return""}return""}
function conn(c,p){return new Promise((res,rej)=>{const cl=new Client();const pass=p||"";cl.on("ready",()=>res(cl)).on("keyboard-interactive",(a,b,c,pr,fin)=>fin(pr.map(()=>pass))).on("error",rej).connect({host:c.host,port:c.port||22,username:c.username,password:pass,tryKeyboard:true,readyTimeout:45000});});}
function ex(cl,cmd){return new Promise((res,rej)=>{cl.exec(cmd,(e,st)=>{if(e)return rej(e);let o="",r="";st.on("close",code=>res({code,o,r})).on("data",d=>o+=d);st.stderr.on("data",d=>r+=d);});});}
app.whenReady().then(async()=>{let cl;try{const list=JSON.parse(fs.readFileSync(path.join(UD,"ssh-connections.json"),"utf8"));const c=list[0];const p=dec(c.password);cl=await conn(c,p);const r=await ex(cl,`set +e
# disable broken nodesource deb822 source
if [ -f /etc/apt/sources.list.d/nodesource.sources ]; then mv /etc/apt/sources.list.d/nodesource.sources /etc/apt/sources.list.d/nodesource.sources.disabled; echo disabled_nodesource.sources; fi
ls /etc/apt/sources.list.d/
apt-get update -qq 2>&1 | tail -5
echo "--- upgradable ---"
apt list --upgradable 2>/dev/null
echo "--- unattended ---"
dpkg -l unattended-upgrades 2>/dev/null | grep ^ii
`);console.log(r.o);console.error(r.r);app.exit(0);}catch(e){console.error(e);app.exit(1);}finally{try{cl.end()}catch(e){}}});
app.on("window-all-closed",e=>e.preventDefault());
