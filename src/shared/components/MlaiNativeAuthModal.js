"use client";
import { useEffect, useState, useRef } from 'react';
import { Modal, Button } from '@/shared/components';

export default function MlaiNativeAuthModal({isOpen,onClose,onSuccess}) {
 const [url,setUrl]=useState('');
 const [error,setError]=useState('');
 const [callbackUrl,setCallbackUrl]=useState('');
 const [submitting,setSubmitting]=useState(false);
 const submitRef=useRef(null);
 const callbacks=useRef({onClose,onSuccess});
 callbacks.current={onClose,onSuccess};
 useEffect(()=>{
  if(!isOpen)return;
  let stopped=false,session=null,timer=null,finished=false;
  setUrl('');setError('');setCallbackUrl('');setSubmitting(false);
  const call=async body=>{
   const response=await fetch('/api/oauth/mlai-code/native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Native login failed');
   return data;
  };
  const cancel=()=>{if(session)void call({action:'cancel',session}).catch(()=>{});};
  const accept=status=>{
   if(stopped||finished)return true;
   if(status.status==='done'){finished=true;session=null;setCallbackUrl('');callbacks.current.onSuccess?.();callbacks.current.onClose?.();return true;}
   if(status.status==='error'){finished=true;setCallbackUrl('');setError(status.error);return true;}
   return false;
  };
  let busy=false;
  submitRef.current=async callbackUrl=>{
   if(stopped||finished||busy||!session)return;
   busy=true;setSubmitting(true);setError('');
   try{const status=await call({action:'callback',session,callbackUrl});if(!accept(status))setCallbackUrl('');}
   catch{if(!stopped&&!finished)setError('Invalid or already used callback URL. Check the complete URL from this sign-in attempt.');}
   finally{busy=false;if(!stopped)setSubmitting(false);}
  };
  const poll=async()=>{
   try {
    const status=await call({action:'status',session});
    if(accept(status))return;
    timer=setTimeout(poll,1000);
   }catch(e){if(!stopped)setError(e.message);}
  };
  call({action:'start'}).then(data=>{
   session=data.session;
   if(stopped){cancel();return;}
   setUrl(data.authorizeUrl);timer=setTimeout(poll,1000);
  }).catch(e=>{if(!stopped)setError(e.message);});
  return()=>{stopped=true;submitRef.current=null;clearTimeout(timer);cancel();};
 },[isOpen]);
 return <Modal isOpen={isOpen} onClose={onClose} title="ML AI native device login">
  <div className="space-y-4">
   <p>Sign in using the official ML AI device PKCE flow. This stores a separate device credential for this connection; your CLI login is not read or changed.</p>
   <p className="text-sm text-text-muted">Local sign-in completes automatically. On a remote server, the browser may show ERR_CONNECTION_REFUSED at the loopback callback. Copy the complete URL from that tab’s address bar, return here, and paste it below. Do not share the callback URL. Expired or revoked device logins must be reconnected.</p>
   {error?<p role="alert" className="text-red-500">{error}</p>:url?<a className="text-primary underline" href={url} target="_blank" rel="noopener noreferrer">Open official ML AI sign-in</a>:<p>Preparing secure sign-in…</p>}
   {url&&<form onSubmit={event=>{event.preventDefault();void submitRef.current?.(callbackUrl.trim());}} className="space-y-2">
    <label htmlFor="mlai-native-callback" className="block text-sm">Paste callback URL</label>
    <input id="mlai-native-callback" type="text" value={callbackUrl} onChange={event=>setCallbackUrl(event.target.value)} autoComplete="off" spellCheck={false} maxLength={4096} placeholder="http://127.0.0.1:PORT/callback?state=…&code=…" className="w-full rounded border border-border bg-transparent p-2" disabled={submitting}/>
    <Button type="submit" disabled={submitting||!callbackUrl.trim()}>{submitting?'Completing sign-in…':'Complete sign-in'}</Button>
   </form>}
   <Button onClick={onClose}>Cancel</Button>
  </div>
 </Modal>;
}
