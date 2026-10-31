function clamp(v, lo=0, hi=100) { return Math.max(lo, Math.min(hi, v)); }

function rsi(values, length=14) {
  const out = Array(values.length).fill(null);
  if (values.length <= length) return out;
  let gain=0, loss=0;
  for (let i=1; i<=length; i++) {
    const d=values[i]-values[i-1]; gain+=Math.max(d,0); loss+=Math.max(-d,0);
  }
  gain/=length; loss/=length;
  out[length] = loss === 0 ? 100 : 100 - 100/(1+gain/loss);
  for (let i=length+1; i<values.length; i++) {
    const d=values[i]-values[i-1];
    gain=(gain*(length-1)+Math.max(d,0))/length;
    loss=(loss*(length-1)+Math.max(-d,0))/length;
    out[i] = loss === 0 ? 100 : 100 - 100/(1+gain/loss);
  }
  return out;
}

function sma(values, length) {
  return values.map((_,i) => {
    if (i < length-1) return null;
    const slice=values.slice(i-length+1,i+1);
    if (slice.some(v => v == null || !Number.isFinite(v))) return null;
    return slice.reduce((a,b)=>a+b,0)/length;
  });
}

function evaluate({ candles=[], callOI=[], putOI=[], settings={} }) {
  const rsiLen=Number(settings.rsiLength || 14);
  const smaLen=Number(settings.smaLength || 9);
  const oiBars=Number(settings.oiBars || 3);
  const fullPct=Number(settings.oiFullPct || 1);
  const threshold=Number(settings.threshold || 70);
  const closes=candles.map(c=>Number(c.close));
  const rv=rsi(closes,rsiLen);
  const rs=sma(rv,smaLen);
  const i=candles.length-1;
  if (i < Math.max(rsiLen+smaLen, oiBars+1)) {
    return { ready:false, signal:"WAIT", reason:"Not enough candles/OI observations", rsi:rv[i] ?? null, rsiSma:rs[i] ?? null };
  }
  const r=rv[i], s=rs[i], delta=r-rv[i-1];
  const rsiUp=r>s && delta>0, rsiDown=r<s && delta<0;
  const cp=callOI.length>oiBars ? callOI.at(-1) : null;
  const pp=putOI.length>oiBars ? putOI.at(-1) : null;
  const cb=callOI.length>oiBars ? callOI.at(-1-oiBars) : null;
  const pb=putOI.length>oiBars ? putOI.at(-1-oiBars) : null;
  const callPct=cb ? 100*(cp-cb)/Math.abs(cb) : null;
  const putPct=pb ? 100*(pp-pb)/Math.abs(pb) : null;
  const oiReady=[callPct,putPct].every(Number.isFinite);
  const putBuild=oiReady?clamp(50+50*putPct/fullPct):null;
  const callBuild=oiReady?clamp(50+50*callPct/fullPct):null;
  const callUnwind=oiReady?clamp(50-50*callPct/fullPct):null;
  const putUnwind=oiReady?clamp(50-50*putPct/fullPct):null;
  const bullRsi=clamp(r+(rsiUp?10:0)), bearRsi=clamp(100-r+(rsiDown?10:0));
  const callScore=oiReady ? 0.4*bullRsi+0.3*putBuild+0.3*callUnwind : null;
  const putScore=oiReady ? 0.4*bearRsi+0.3*callBuild+0.3*putUnwind : null;
  const c=candles[i], p=candles[i-1];
  const bullishSweepBreakout=c.low<p.low && c.high>p.high && c.close>p.high;
  const bearishSweepBreakdown=c.high>p.high && c.low<p.low && c.close<p.low;
  const callSignal=oiReady && rsiUp && putPct>0 && callPct<0 && callScore>=threshold;
  const putSignal=oiReady && rsiDown && callPct>0 && putPct<0 && putScore>=threshold;
  return {
    ready:oiReady, signal:callSignal?"BUY CALL":putSignal?"BUY PUT":"WAIT",
    rsi:r, rsiSma:s, callPct, putPct, callScore, putScore,
    rsiUp, rsiDown, bullishSweepBreakout, bearishSweepBreakdown,
    reason:!oiReady?"OI history not ready":callSignal?"RSI bullish + Put OI build + Call OI unwind":putSignal?"RSI bearish + Call OI build + Put OI unwind":"Entry conditions not aligned"
  };
}

module.exports = { rsi, sma, evaluate };
