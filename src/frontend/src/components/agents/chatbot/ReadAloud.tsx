import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";

export function speechText(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g," Code block omitted. ").replace(/!\[[^\]]*\]\([^)]*\)/g,"")
    .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/https?:\/\/\S+/g,"")
    .replace(/[#*_`>|]/g," ").replace(/\s+/g," ").trim().slice(0,12000);
}

export function ReadAloud({ text }: { text:string }) {
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [playing,setPlaying]=useState(false);
  const [error,setError]=useState("");
  const own=useRef(false);
  useEffect(()=>{
    if(!window.speechSynthesis)return;
    const synth=window.speechSynthesis;
    const update=()=>setVoices(synth.getVoices().filter(voice=>voice.localService));
    const stop=()=>{if(own.current){own.current=false;synth.cancel();setPlaying(false);}};
    const hide=()=>{if(document.hidden)stop();};
    update(); synth.addEventListener("voiceschanged",update);
    window.addEventListener("jmcgpt-stop-speech",stop);window.addEventListener("pagehide",stop);document.addEventListener("visibilitychange",hide);
    return ()=>{ if(own.current){own.current=false;synth.cancel();} synth.removeEventListener("voiceschanged",update);
      window.removeEventListener("jmcgpt-stop-speech",stop);window.removeEventListener("pagehide",stop);document.removeEventListener("visibilitychange",hide); };
  },[]);
  const play=()=>{
    const synth=window.speechSynthesis;
    if(playing){own.current=false;synth.cancel();setPlaying(false);return;}
    const voice=voices.find(value=>value.lang.startsWith("en"))??voices[0];
    if(!voice)return;
    window.dispatchEvent(new Event("jmcgpt-stop-speech"));
    const chunks=speechText(text).match(/.{1,200}(?:\s|$)|\S{1,200}/g)??[];
    own.current=true;setPlaying(true);setError("");
    chunks.forEach((chunk,index)=>{
      const utterance=new SpeechSynthesisUtterance(chunk);utterance.voice=voice;utterance.lang=voice.lang;
      utterance.onend=()=>{if(index===chunks.length-1&&own.current){own.current=false;setPlaying(false);}};
      utterance.onerror=()=>{if(own.current){own.current=false;synth.cancel();setPlaying(false);setError("Playback unavailable.");}};
      synth.speak(utterance);
    });
    if(!chunks.length){own.current=false;setPlaying(false);}
  };
  return <><Button appearance="subtle" disabled={!voices.length || !speechText(text)} onClick={play}
    title={!voices.length?"No installed speech voice is available in this browser.":"Uses an installed device voice. Reads up to 12,000 characters; code blocks and URLs are omitted."}>
    {playing?"Stop reading":"Read aloud"}</Button>{error&&<span role="status">{error}</span>}</>;
}
