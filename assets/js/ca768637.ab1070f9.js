"use strict";(self.webpackChunkmy_website=self.webpackChunkmy_website||[]).push([[600],{2054:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>d,contentTitle:()=>i,default:()=>h,frontMatter:()=>r,metadata:()=>s,toc:()=>c});const s=JSON.parse('{"id":"dns-udp-tcp.md","title":"DNS: UDP vs TCP","description":"Normally, DNS message would be sent over UDP protocols, this is because UDP is much faster than TCP, and that\'s all DNS needs. DNS is not a so important information that should be transfered by TCP.","source":"@site/docs/dns-udp-tcp.md.md","sourceDirName":".","slug":"/dns-udp-tcp.md","permalink":"/docs/dns-udp-tcp.md","draft":false,"unlisted":false,"tags":[],"version":"current","lastUpdatedAt":1733044643000,"sidebarPosition":3,"frontMatter":{"sidebar_position":3},"sidebar":"tutorialSidebar","previous":{"title":"DNS - EDNS","permalink":"/docs/dns-edns"},"next":{"title":"Socket handover","permalink":"/docs/socket-handover"}}');var o=n(4848),a=n(8453);const r={sidebar_position:3},i="DNS: UDP vs TCP",d={},c=[];function l(e){const t={h1:"h1",header:"header",p:"p",...(0,a.R)(),...e.components};return(0,o.jsxs)(o.Fragment,{children:[(0,o.jsx)(t.header,{children:(0,o.jsx)(t.h1,{id:"dns-udp-vs-tcp",children:"DNS: UDP vs TCP"})}),"\n",(0,o.jsx)(t.p,{children:"Normally, DNS message would be sent over UDP protocols, this is because UDP is much faster than TCP, and that's all DNS needs. DNS is not a so important information that should be transfered by TCP."}),"\n",(0,o.jsx)(t.p,{children:"Using UDP instead of TCP makes implementation much simpler, DNS client does not need to maintain the connection, just send and wait for response (or expect a callback if you are using async network)"}),"\n",(0,o.jsx)(t.p,{children:"Another thing about using UDP and TCP is in message format. As you may know, using TCP means you need to prepare to handle fragmented message, you may have to deal with TCP framing, because TCP uses streams, not datagram as in UDP. This leads to the DNS message must be indicated how long it is, this is done by 2 octets form a 16-bit unsigned int to tells the receiver how many byte it need to way to receive more."}),"\n",(0,o.jsx)(t.p,{children:"Both encoder and parser needs to deal with difference in DNS format between UDP and TCP, encoder needs to add a 2 octets number to indicate the length of the message in case of TCP, and the receiver needs to read those 2 octets first to prepare to read the rest of the message."}),"\n",(0,o.jsx)(t.p,{children:"Let's take a look closer at the implementation, you can distinguish the difference in the encoder or parser logic, but if you do so, the interface to the constructor of message class or struct would be more complicated. Instead, you can move the logic that handles difference between message formats to right above the network level."})]})}function h(e={}){const{wrapper:t}={...(0,a.R)(),...e.components};return t?(0,o.jsx)(t,{...e,children:(0,o.jsx)(l,{...e})}):l(e)}},8453:(e,t,n)=>{n.d(t,{R:()=>r,x:()=>i});var s=n(6540);const o={},a=s.createContext(o);function r(e){const t=s.useContext(a);return s.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function i(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(o):e.components||o:r(e.components),s.createElement(a.Provider,{value:t},e.children)}}}]);