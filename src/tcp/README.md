### TCP framing

TCP: transmission control protocol
UDP: user datagram protocol

TCP is different from UDP, probably you've heard that TCP is reliable and UDP is not. But what more?

Another difference between TCP and UDP is TCP is stream-based, and UDP is datagram-based. What do those words mean?

When a UDP message is sent over a message, it must be sent in one single network packet, both the receiver expects to receive the whole UDP message in one single read system call, if it fails to do that, that message would be discarded. TCP is different, TCP messages are sent over TCP stream, there is not such barrier for a message, both sender and receiver must know and handle that. TCP receiver must be ready to handle not-complete message, each time the receiver calls read() to the os, it can receive any number of the response, it may not be complete, the receiver must hold that data in buffer, and wait for another read(s) to receive the remaining parts of the message. Only after it receives the whole message, it passes that message to upper level (maybe a parser) for further processing. This is called TCP framing for message framing

There are 2 clues in the TCP message for the receivers to handle framing
1. Delimiters: in HTTP, "\r\n" is used to seperate lines, "\r\n\r\n" is used to seperated header and body
2. Prefix-length: HTTP has an atrribute "Content-Length" indicates the length of the body (after delimiter "\r\n\r\n"). The TCP receiver uses this number to know how many more bytes it has to wait for a full message.

Thanks,  
2022/06/21

### TCP socket handover & thread pool

There are many ways for a server to handle TCP listening socket, one of them is to handle a established socket with a client to another thread. Today, we will talk about that.

You have a application that needs to listen on a specific port waiting for TCP connection. When a client connects to that socket (with a three-way handshark), when the establish progress is done, the server starts receiving requests and process them. Meanwhile, if another client tries to establish connection to that same server, that clients needs to wait until the server complete the requests from the previous client. This causes 2 big problems:
1. The client 2 has to wait, if it does not implement async network, it'll be blocked for quite a long time.
2. The second problem is that the server cannot utilize the power of multi-core CPU, because it has only one thread, and one thread can use only one CPU core (or CPU thread) at a same time

One solution for this, is to create a new thread for each connection, that would solve both problems, but it creates another problem that when there are a thousand connections, the server's resources would be overloaded

To fix that, the server should allow only a certain number of threads for all connections, for example 10 threads, this number should be tuned for your specific system, depends on number of CPU cores. New connections would be distributed among those threads, that would help to distribute the loads across CPU cores and save system's resouces

Thanks,  
2022/06/21