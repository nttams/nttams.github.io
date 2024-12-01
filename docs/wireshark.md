---
sidebar_position: 6
---

# Wireshark

Wireshark is a very strong tools for network analysis, let's talk about how to use it.

1. Filter: ip.addr, tcp/udp, tcp/udp.port, icmp, dns, frame contains, frame.time. Examples:
  * tcp && dns
  * frame contains "google.com"
  * frame.time > "Jan 1, 2022 00:00:00" && frame.time < "Jan 1, 2023 00:00:00"
  * tcp.stream eq 57
2. TCP stream follwing
3. Flow graph: Statistics --> Flow Graph (be careful with large file)

Some notes when working with network analysis
* TCP SYN is used for establishing TCP connection, if you see lots of it, maybe a node is trying to establish one to a remote host, and the remote host does not respond yet
* A DNS message is usually sent of UDP protocol, but if the server notices the response is too large for UDP (larger then 512 octest), it will send a response with bit TC=ON (truncated bit). The client can give up or fallback to TCP for larger message capacity
* Note to match IDs in request and response (if the protocol supports)
* TCP connection can be long-live or one-shot
* HTTP is usually sent over TCP, and it should be, but nothing stops us from sending it over other protocols
* SIP Option message is usually used for "poking" a remote note, to check if it is still alive or not. But it has more features than that, it can be used to discover remote node capabilities.

Additionally, wireshark can be used for remote packet capture as well, it means you can setup and remote host to forward live capturing packet to you local host, then wireshark will catch that and display locally. This is very helpful when managing a cluster with many nodes.