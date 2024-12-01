---
sidebar_position: 4
---

# TCP framing

TCP is different from UDP, probably you've heard that TCP is reliable and UDP is not. But what more?

Another difference between TCP and UDP is TCP is stream-based, and UDP is datagram-based. What do those words mean?

When a UDP message is sent over a message, it must be sent in one single network packet, both the receiver expects to receive the whole UDP message in one single read system call, if it fails to do that, that message would be discarded. TCP is different, TCP messages are sent over TCP stream, there is not such barrier for a message, both sender and receiver must know and handle that. TCP receiver must be ready to handle not-complete message, each time the receiver calls read() to the os, it can receive any number of the response, it may not be complete, the receiver must hold that data in buffer, and wait for another read(s) to receive the remaining parts of the message. Only after it receives the whole message, it passes that message to upper level (maybe a parser) for further processing. This is called TCP framing for message framing

There are 2 clues in the TCP message for the receivers to handle framing
1. Delimiters: in HTTP, "\r\n" is used to seperate lines, "\r\n\r\n" is used to seperated header and body
2. Prefix-length: HTTP has an atrribute "Content-Length" indicates the length of the body (after delimiter "\r\n\r\n"). The TCP receiver uses this number to know how many more bytes it has to wait for a full message.