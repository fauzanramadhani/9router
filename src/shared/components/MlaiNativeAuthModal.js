"use client";
import { useEffect, useState, useRef } from 'react';
import { Modal, Button } from '@/shared/components';

export default function MlaiNativeAuthModal({isOpen,onClose,onSuccess}) {
 const [url,setUrl]=useState('');
 const [error,setError]=useState('');
 const callbacks=useRef({onClose,onSuccess});
 callbacks.current={onClose,onSuccess};
 useEffect(()=>{
  if(!isOpen)return;
  let stopped=false,session=null,timer=null;
  setUrl('');setError('');
  const call=async body=>{
   const response=await fetch('/api/oauth/mlai-code/native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Native login failed');
   return data;
  };
  const cancel=()=>{if(session)void call({action:'cancel',session}).catch(()=>{});};
  const poll=async()=>{
   try {
    const status=await call({action:'status',session});
    if(stopped)return;
    if(status.status==='done'){session=null;callbacks.current.onSuccess?.();callbacks.current.onClose?.();return;}
    if(status.status==='error')throw new Error(status.error);
    timer=setTimeout(poll,1000);
   }catch(e){if(!stopped)setError(e.message);}
  };
  call({action:'start'}).then(data=>{
   session=data.session;
   if(stopped){cancel();return;}
   setUrl(data.authorizeUrl);timer=setTimeout(poll,1000);
  }).catch(e=>{if(!stopped)setError(e.message);});
  return()=>{stopped=true;clearTimeout(timer);cancel();};
 },[isOpen]);
 return <Modal isOpen={isOpen} onClose={onClose} title="ML AI native device login">
  <div className="space-y-4">
   <p>Sign in using the official ML AI device PKCE flow. This stores a separate device credential for this connection; your CLI login is not read or changed.</p>
   <p className="text-sm text-text-muted">Open this on the same computer that runs 9router. The official callback uses a loopback port; remote dashboards require a secure local port tunnel. Expired or revoked device logins must be reconnected.</p>
   {error?<p role="alert" className="text-red-500">{error}</p>:url?<a className="text-primary underline" href={url} target="_blank" rel="noopener noreferrer">Open official ML AI sign-in</a>:<p>Preparing secure sign-in…</p>}
   <Button onClick={onClose}>Cancel</Button>
  </div>
 </Modal>;
}
