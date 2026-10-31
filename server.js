require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { AngelOne } = require("./angel");
const { evaluate } = require("./strategy");

const app=express();
const angel=new AngelOne();
app.use(express.json({limit:"1mb"}));
const allowed=(process.env.CORS_ORIGINS || "*").split(",").map(x=>x.trim()).filter(Boolean);
app.use(cors({origin:(origin,cb)=>{
  if (!origin || allowed.includes("*") || allowed.includes(origin)) return cb(null,true);
  return cb(new Error("Origin not allowed by CORS"));
}}));

const intervals={
  "1m":"ONE_MINUTE","3m":"THREE_MINUTE","5m":"FIVE_MINUTE","15m":"FIFTEEN_MINUTE",
  "30m":"THIRTY_MINUTE","1d":"ONE_DAY"
};
function dateIST(d) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
  return parts;
}
function smartDate(d) {
  const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(d);
  const o=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day} ${o.hour}:${o.minute}`;
}
app.get("/",(req,res)=>res.json({service:"Angel One RSI Sniper Node Backend",runtime:process.version,docs:"/api/health"}));
const healthHandler=(req,res)=>res.json({ok:true,runtime:"node",timestamp:new Date().toISOString(),marketData:"Angel One SmartAPI REST",streaming:"not_enabled",...angel.status()});
app.get("/api/health",healthHandler);
app.get("/api/status",healthHandler);

app.post("/api/auth/login",async(req,res)=>{
  try { res.json({ok:true,...await angel.login()}); }
  catch(e) { res.status(502).json({ok:false,error:e.message,...angel.status()}); }
});

app.post("/api/candles",async(req,res)=>{
  try {
    const {exchange="NSE",symboltoken,interval="1m",days=3,fromdate,todate}=req.body||{};
    if (!symboltoken) return res.status(400).json({error:"symboltoken is required"});
    if (!intervals[interval]) return res.status(400).json({error:`Unsupported interval: ${interval}`});
    const end=new Date(), start=new Date(end.getTime()-Math.max(1,Math.min(Number(days)||3,30))*86400000);
    const candles=await angel.candles({
      exchange,symboltoken,interval:intervals[interval],
      fromdate:fromdate||smartDate(start),todate:todate||smartDate(end)
    });
    res.json({ok:true,exchange,symboltoken:String(symboltoken),interval,candles});
  } catch(e) { res.status(502).json({ok:false,error:e.message}); }
});

app.post("/api/quote",async(req,res)=>{
  try {
    const {mode="FULL",exchangeTokens}=req.body||{};
    if (!exchangeTokens || typeof exchangeTokens!=="object") return res.status(400).json({error:"exchangeTokens object required"});
    res.json({ok:true,data:await angel.marketQuote(mode,exchangeTokens)});
  } catch(e) { res.status(502).json({ok:false,error:e.message}); }
});

app.post("/api/oi/history",async(req,res)=>{
  try {
    const {exchange="NFO",symboltoken,interval="1m",days=3}=req.body||{};
    if (!symboltoken) return res.status(400).json({error:"symboltoken is required"});
    if (!intervals[interval]) return res.status(400).json({error:"Unsupported interval"});
    const end=new Date(), start=new Date(end.getTime()-Math.max(1,Math.min(Number(days)||3,30))*86400000);
    const data=await angel.historicalOI({exchange,symboltoken,interval:intervals[interval],fromdate:smartDate(start),todate:smartDate(end)});
    res.json({ok:true,data});
  } catch(e) { res.status(502).json({ok:false,error:e.message}); }
});

app.post("/api/option-greeks",async(req,res)=>{
  try {
    const {name="NIFTY",expiry}=req.body||{};
    if (!expiry) return res.status(400).json({error:"expiry is required (DDMMMYYYY)"});
    res.json({ok:true,data:await angel.optionGreeks(name,expiry)});
  } catch(e) { res.status(502).json({ok:false,error:e.message}); }
});

app.post("/api/strategy/evaluate",(req,res)=>{
  try { res.json({ok:true,result:evaluate(req.body||{})}); }
  catch(e) { res.status(400).json({ok:false,error:e.message}); }
});

app.use((err,req,res,next)=>res.status(500).json({ok:false,error:err.message||"Internal server error"}));
const port=Number(process.env.PORT||10000);
app.listen(port,"0.0.0.0",()=>console.log(`Angel One RSI Sniper Node backend listening on ${port}`));
