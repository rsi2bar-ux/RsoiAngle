import math

def sma(values, n):
    out=[]
    for i in range(len(values)):
        w=values[max(0,i-n+1):i+1]
        out.append(sum(w)/n if len(w)==n else None)
    return out

def rsi(values, n=14):
    out=[None]*len(values)
    if len(values)<=n: return out
    gains=[]; losses=[]
    for i in range(1,len(values)):
        d=values[i]-values[i-1]; gains.append(max(d,0)); losses.append(max(-d,0))
    ag=sum(gains[:n])/n; al=sum(losses[:n])/n
    def val(g,l): return 100.0 if l==0 and g>0 else (50.0 if l==0 and g==0 else 100-100/(1+g/l))
    out[n]=val(ag,al)
    for i in range(n+1,len(values)):
        ag=(ag*(n-1)+gains[i-1])/n; al=(al*(n-1)+losses[i-1])/n
        out[i]=val(ag,al)
    return out

def calculate(p):
    candles=p.get('candles',[]); oi=p.get('oi',[]); s=p.get('settings',{})
    n=int(s.get('rsi_length',14)); sn=int(s.get('rsi_sma_length',9)); lb=int(s.get('oi_lookback',3)); full=float(s.get('oi_full_pct',1)); threshold=float(s.get('threshold',70))
    if len(candles)<n+sn+2: raise ValueError('Insufficient candles for RSI and SMA calculation')
    closes=[float(c['close']) for c in candles]; rv=rsi(closes,n); rs=sma([x if x is not None else 0 for x in rv],sn)
    # OI input must be pre-aggregated time series: call_oi and put_oi values built from actual CE/PE option tokens.
    if len(oi)<=lb: return {'ready':False,'reason':'Insufficient real option OI history','rsi':rv[-1],'rsi_sma':rs[-1]}
    co=float(oi[-1]['call_oi']); po=float(oi[-1]['put_oi']); cb=float(oi[-1-lb]['call_oi']); pb=float(oi[-1-lb]['put_oi'])
    if cb==0 or pb==0: return {'ready':False,'reason':'Invalid OI baseline'}
    cpct=100*(co-cb)/abs(cb); ppct=100*(po-pb)/abs(pb)
    clamp=lambda x:max(0,min(100,x))
    put_build=clamp(50+50*ppct/full); call_build=clamp(50+50*cpct/full)
    call_unwind=clamp(50-50*cpct/full); put_unwind=clamp(50-50*ppct/full)
    r=rv[-1]; rsma=rs[-1]; rising=rv[-1]>rv[-2]; falling=rv[-1]<rv[-2]
    bull=clamp(r+(10 if r>rsma and rising else 0)); bear=clamp(100-r+(10 if r<rsma and falling else 0))
    call_score=.4*bull+.3*put_build+.3*call_unwind; put_score=.4*bear+.3*call_build+.3*put_unwind
    call=r>rsma and rising and ppct>0 and cpct<0 and call_score>=threshold
    put=r<rsma and falling and cpct>0 and ppct<0 and put_score>=threshold
    c=candles[-1]; prev=candles[-2]
    sweep= float(c['low'])<float(prev['low']) and float(c['high'])>float(prev['high']) and float(c['close'])>float(prev['high'])
    return {'ready':True,'rsi':round(r,2),'rsi_sma':round(rsma,2),'call_oi_change_pct':round(cpct,4),'put_oi_change_pct':round(ppct,4),'call_strength':round(call_score,2),'put_strength':round(put_score,2),'call_signal':bool(call),'put_signal':bool(put),'type4_bullish_sweep_breakout':bool(sweep),'signal':'CALL' if call else ('PUT' if put else 'WAIT'),'note':'OI scores require genuine option-contract OI, correctly classified by expiry, strike and CE/PE.'}
