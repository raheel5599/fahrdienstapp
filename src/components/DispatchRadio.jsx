import React, {useEffect, useRef, useState} from 'react';
import {Mic, Radio, Volume2, VolumeX} from 'lucide-react';
import {supabase} from '../lib/supabase.js';

const SAMPLE_RATE = 12000;
const LIMIT_MS = 14500;

async function radioRpc(client, action, unit, args = {}) {
  const {data, error} = await client.rpc('radio_' + action, {p_unit:unit, ...args});
  if (error) throw Error(error.message);
  return data;
}

export default function DispatchRadio({user, client=supabase}) {
  const unit = user.businessUnitId;
  const rpc = (action,args) => radioRpc(client,action,unit,args);
  const driver = user.role === 'driver';
  const [contacts, setContacts] = useState([]);
  const [target, setTarget] = useState(driver ? 'office' : 'all');
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState('');
  const [incoming, setIncoming] = useState('');
  const [error, setError] = useState('');
  const audio = useRef(null);
  const playback = useRef({next:0});
  const transmission = useRef(null);
  const incomingTimer = useRef(null);
  const connectedRef = useRef(false);

  async function enableAudio() {
    if (!audio.current || audio.current.state === 'closed') {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('Dieser Browser unterstützt Funk-Audio nicht.');
      audio.current = new Audio();
    }
    await audio.current.resume();
    setListening(true);
    return audio.current;
  }

  function receive(payload) {
    const ctx = audio.current;
    if (!ctx || ctx.state !== 'running' || payload.sender === user.id) return;
    const bytes = Uint8Array.from(atob(payload.audio), char => char.charCodeAt(0));
    const input = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, input.length, SAMPLE_RATE);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) output[i] = input[i] / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const state = playback.current;
    const start = state.id === payload.transmission && state.next > ctx.currentTime && state.next < ctx.currentTime + 0.65
      ? state.next : ctx.currentTime + 0.14;
    source.start(start);
    playback.current = {id:payload.transmission, next:start + buffer.duration};
    setIncoming(payload.name || 'Funk');
    clearTimeout(incomingTimer.current);
    incomingTimer.current = setTimeout(() => setIncoming(''), 800);
  }

  useEffect(() => {
    if (!client || !unit) return;
    let active = true;
    const topic = 'radio:' + unit;
    const destinations = [topic + ':all', driver ? topic + ':driver:' + user.driverId : topic + ':office'];
    const ready = new Set();
    const subscriptions = destinations.map(destination => client.channel(destination, {config:{private:true}})
      .on('broadcast', {event:'audio'}, ({payload}) => {if (active && payload?.audio?.length === 8000) receive(payload);})
      .subscribe(status => {
        if (!active) return;
        if (status === 'SUBSCRIBED') ready.add(destination);
        else ready.delete(destination);
        connectedRef.current = ready.size === destinations.length;
        setConnected(connectedRef.current);
        if (!connectedRef.current) void stop();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setError('Funkverbindung unterbrochen.');
        if (connectedRef.current) setError('');
      }));
    rpc('contacts').then(rows => {if (active) setContacts(rows);})
      .catch(e => {if (active) setError(e.message);});
    function interrupt() {void stop();}
    function screenChanged() {if (document.hidden) interrupt();}
    window.addEventListener('blur', interrupt);
    window.addEventListener('offline', interrupt);
    document.addEventListener('visibilitychange', screenChanged);
    return () => {
      active = false;
      connectedRef.current = false;
      clearTimeout(incomingTimer.current);
      window.removeEventListener('blur', interrupt);
      window.removeEventListener('offline', interrupt);
      document.removeEventListener('visibilitychange', screenChanged);
      void stop();
      for (const channel of subscriptions) void client.removeChannel(channel);
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, [unit, user.id, user.driverId, driver, client]);

  const sendAudio = (id, buffer) => rpc('audio', {
    p_transmission:id, p_audio:btoa(String.fromCharCode(...new Uint8Array(buffer)))
  });

  async function stop(flush = false) {
    const tx = transmission.current;
    if (!tx) return;
    transmission.current = null;
    clearTimeout(tx.timer);
    tx.stream?.getTracks().forEach(track => track.stop());
    const tail = flush && tx.node ? new Promise(resolve => {
      const timeout = setTimeout(() => resolve(null), 180);
      tx.node.port.onmessage = ({data}) => {
        if (data.final) {clearTimeout(timeout);resolve(data.audio);}
      };
      tx.node.port.postMessage('flush');
    }) : null;
    tx.source?.disconnect();
    if (!tail) tx.node?.disconnect();
    setSending('');
    if (tx.claimed) {
      const lastAudio = await tail;
      tx.node?.disconnect();
      await tx.pending?.catch(() => {});
      if (lastAudio) {
        await new Promise(resolve => setTimeout(resolve, 125));
        await sendAudio(tx.id,lastAudio).catch(() => {});
      }
      await rpc('stop', {p_transmission:tx.id}).catch(() => {});
    }
  }

  async function start() {
    if (!connectedRef.current || transmission.current) return;
    const tx = {id:crypto.randomUUID(), waiting:false, claimed:false};
    transmission.current = tx;
    setSending('connecting');
    setError('');
    try {
      const ctx = await enableAudio();
      if (!navigator.mediaDevices?.getUserMedia || !ctx.audioWorklet) throw Error('Für Funk wird Mikrofonzugriff über HTTPS benötigt.');
      const stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true}});
      if (transmission.current !== tx) {stream.getTracks().forEach(track => track.stop()); return;}
      tx.stream = stream;
      await ctx.audioWorklet.addModule('/radio-capture.js');
      if (transmission.current !== tx) return;
      const audience = target.startsWith('driver:') ? 'driver' : target;
      tx.claimed = await rpc('start', {p_transmission:tx.id,p_audience:audience,p_driver:audience === 'driver' ? target.slice(7) : null});
      if (transmission.current !== tx) {
        if (tx.claimed) await rpc('stop', {p_transmission:tx.id});
        return;
      }
      if (!tx.claimed) throw Error('Der Funk ist besetzt. Warte kurz und versuche es erneut.');
      tx.source = ctx.createMediaStreamSource(stream);
      tx.node = new AudioWorkletNode(ctx, 'tariq-radio-capture', {numberOfOutputs:0});
      tx.node.port.onmessage = event => {
        if (transmission.current !== tx || tx.waiting) return;
        if (!event.data.audio) return;
        tx.waiting = true;
        tx.pending = sendAudio(tx.id,event.data.audio)
          .then(accepted => {if (!accepted) throw Error('Funkspruch beendet.');})
          .finally(() => {tx.waiting = false;});
        tx.pending.catch(e => {if (transmission.current === tx) {setError(e.message); void stop();}});
      };
      tx.source.connect(tx.node);
      setSending('live');
      tx.timer = setTimeout(() => {setError('15 Sekunden erreicht. Für einen weiteren Funkspruch erneut drücken.'); void stop();}, LIMIT_MS);
    } catch (e) {
      if (transmission.current !== tx) return;
      setError(e.name === 'NotAllowedError' ? 'Bitte Mikrofonzugriff erlauben.' : e.message);
      void stop();
    }
  }

  function toggleAudio() {
    if (listening) {
      void stop();
      void audio.current?.suspend().catch(() => {});
      setListening(false);
    } else {
      void enableAudio().catch(e => setError(e.message));
    }
  }

  if (!client || !unit) return null;
  return <section className="panel dispatch-radio" aria-label="Funk">
    <div className="panel-title"><div><Radio size={19}/><strong>Funk</strong></div>
      <button type="button" className="text-button" onClick={toggleAudio}>{listening?<VolumeX size={17}/>:<Volume2 size={17}/>} {listening?'Stumm':'Ton aktivieren'}</button>
    </div>
    <div className="dispatch-radio-body">
      <label><span>Empfänger</span><select value={target} onChange={e=>setTarget(e.target.value)} disabled={Boolean(sending)}>
        <option value="all">Alle</option>{driver&&<option value="office">Zentrale</option>}
        {contacts.map(contact=><option key={contact.id} value={'driver:'+contact.id}>{contact.name}</option>)}
      </select></label>
      <button type="button" className={sending==='live'?'primary-button dispatch-radio-live':'primary-button dispatch-radio-talk'}
        disabled={!connected} aria-pressed={Boolean(sending)}
        onContextMenu={event=>event.preventDefault()}
        onPointerDown={event=>{if(event.button===0){event.currentTarget.setPointerCapture(event.pointerId);void start();}}}
        onPointerUp={()=>void stop(true)} onPointerCancel={()=>void stop()} onLostPointerCapture={()=>void stop()}
        onKeyDown={event=>{if ([' ','Enter'].includes(event.key)){event.preventDefault();if (!event.repeat) void start();}}}
        onKeyUp={event=>{if ([' ','Enter'].includes(event.key)){event.preventDefault();void stop(true);}}}
        onClick={event=>{if(event.detail===0){if(transmission.current)void stop(true);else void start();};}}
      ><Mic size={19}/>{sending==='live'?'Sprechfunk aktiv':sending?'Verbindung wird aufgebaut …':'Zum Sprechen halten'}</button>
      <p role="status">{incoming?`${incoming} spricht`:connected?(listening?'Empfang aktiv':'Bereit · Ton aus'):'Funk wird verbunden …'}</p>
      {error&&<p className="users-error" role="alert">{error}</p>}
    </div>
  </section>;
}
