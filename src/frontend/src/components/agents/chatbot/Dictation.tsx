import { useEffect, useRef, useState } from "react";

export function Dictation({ disabled, onText, onBusy }: {
  disabled: boolean; onText: (text: string) => void; onBusy: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [available] = useState(() => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  const resource = useRef<{ recorder?: MediaRecorder; stream?: MediaStream; chunks: Blob[];
    timer?: ReturnType<typeof setTimeout>; controller?: AbortController; cancelled: boolean; bytes: number }>({chunks:[],cancelled:false,bytes:0});
  const mounted = useRef(true);
  const cancel = () => {
    const current = resource.current; current.cancelled = true;
    clearTimeout(current.timer); current.controller?.abort();
    if (current.recorder?.state === "recording") current.recorder.stop();
    current.stream?.getTracks().forEach(track => track.stop()); current.chunks=[];
    if (mounted.current) { setPhase("idle"); onBusy(false); }
  };
  useEffect(() => {
    mounted.current=true;
    const hide=()=>{ if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange",hide); window.addEventListener("pagehide",cancel);
    return ()=>{ mounted.current=false; cancel(); document.removeEventListener("visibilitychange",hide); window.removeEventListener("pagehide",cancel); };
  }, []);
  const start = async () => {
    if (disabled || phase!=="idle") return;
    setError(""); setPhase("requesting"); onBusy(true);
    const current={chunks:[],cancelled:false,bytes:0} as typeof resource.current;
    resource.current=current;
    window.dispatchEvent(new Event("jmcgpt-stop-speech"));
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if (current.cancelled || !mounted.current) { stream.getTracks().forEach(track=>track.stop()); return; }
      current.stream=stream;
      const mimeType=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(type=>MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error();
      const recorder=new MediaRecorder(stream,{mimeType,audioBitsPerSecond:64000}); current.recorder=recorder;
      recorder.ondataavailable=event=>{
        if (current.cancelled) return;
        current.bytes+=event.data.size;
        if (current.bytes>8*1024*1024) { cancel(); setError("Recording is too large. Try a shorter message."); return; }
        if (event.data.size) current.chunks.push(event.data);
      };
      recorder.onerror=()=>{ cancel(); if (mounted.current) setError("Recording failed. Check your microphone and retry."); };
      recorder.onstop=()=>{
        clearTimeout(current.timer); stream.getTracks().forEach(track=>track.stop());
        if (!current.cancelled && mounted.current) setPhase("ready");
      };
      recorder.start(1000); setPhase("recording");
      current.timer=setTimeout(()=>{if(recorder.state==="recording") recorder.stop();},60000);
    } catch {
      if(current.cancelled || current!==resource.current)return;
      cancel(); if(mounted.current) setError("Microphone unavailable. Allow microphone access in your browser, or attach an audio file.");
    }
  };
  const transcribe = async () => {
    const current=resource.current;
    if(phase!=="ready" || !current.chunks.length) {cancel();return;}
    setPhase("transcribing"); current.controller=new AbortController();
    try {
      const type=current.recorder!.mimeType;
      const bytes=new Uint8Array(await new Blob(current.chunks,{type}).arrayBuffer());
      let binary="";for(let offset=0;offset<bytes.length;offset+=8192) binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
      if(current.cancelled)return;
      const suffix=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
      const response=await fetch("/api/dictation",{method:"POST",credentials:"include",cache:"no-store",signal:current.controller.signal,
        headers:{"Content-Type":"application/json","X-JMCGPT-Data-Classification":"non-sensitive"},body:JSON.stringify({name:`dictation.${suffix}`,data:btoa(binary)})});
      if(!response.ok)throw new Error();
      const result=await response.json();
      if(typeof result.text!=="string" || !result.text.trim() || result.text.length>300000)throw new Error();
      if(current.cancelled || current!==resource.current || !mounted.current)return;
      onText(result.text);
      cancel();
    } catch { if(!current.cancelled && mounted.current){cancel();setError("Transcription failed. Record again or attach an audio file.");} }
  };
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
    {phase==="idle" ? <button type="button" disabled={disabled||!available} aria-label="Dictate a message" title={available?"Record up to 60 seconds, then transcribe with Azure. Review the text before sending.":"Microphone recording is unavailable in this browser."} onClick={()=>void start()}>Mic</button>
      : <><span role="status">{phase==="recording"?"Recording · 60s max":phase==="ready"?"Recording ready":phase==="requesting"?"Waiting for microphone…":"Transcribing…"}</span>
        {phase==="recording" && <button type="button" onClick={()=>resource.current.recorder?.stop()}>Finish recording</button>}
        {phase==="ready" && <button type="button" onClick={()=>void transcribe()}>Transcribe</button>}
        <button type="button" onClick={cancel}>Discard</button></>}
    {error && <span role="alert">{error}</span>}
  </span>;
}
