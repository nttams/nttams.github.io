---
sidebar_position: 3
---

# DNS: UDP vs TCP

Normally, DNS message would be sent over UDP protocols, this is because UDP is much faster than TCP, and that's all DNS needs. DNS is not a so important information that should be transfered by TCP.

Using UDP instead of TCP makes implementation much simpler, DNS client does not need to maintain the connection, just send and wait for response (or expect a callback if you are using async network)

Another thing about using UDP and TCP is in message format. As you may know, using TCP means you need to prepare to handle fragmented message, you may have to deal with TCP framing, because TCP uses streams, not datagram as in UDP. This leads to the DNS message must be indicated how long it is, this is done by 2 octets form a 16-bit unsigned int to tells the receiver how many byte it need to way to receive more.

Both encoder and parser needs to deal with difference in DNS format between UDP and TCP, encoder needs to add a 2 octets number to indicate the length of the message in case of TCP, and the receiver needs to read those 2 octets first to prepare to read the rest of the message.

Let's take a look closer at the implementation, you can distinguish the difference in the encoder or parser logic, but if you do so, the interface to the constructor of message class or struct would be more complicated. Instead, you can move the logic that handles difference between message formats to right above the network level.