---
sidebar_position: 4
---

# Socket handover


There are many ways for a server to handle TCP listening socket, one of them is to handle a established socket with a client to another thread. Today, we will talk about that.

You have a application that needs to listen on a specific port waiting for TCP connection. When a client connects to that socket (with a three-way handshark), when the establish progress is done, the server starts receiving requests and process them. Meanwhile, if another client tries to establish connection to that same server, that clients needs to wait until the server complete the requests from the previous client. This causes 2 big problems:
1. The client 2 has to wait, if it does not implement async network, it'll be blocked for quite a long time.
2. The second problem is that the server cannot utilize the power of multi-core CPU, because it has only one thread, and one thread can use only one CPU core (or CPU thread) at a same time

One solution for this, is to create a new thread for each connection, that would solve both problems, but it creates another problem that when there are a thousand connections, the server's resources would be overloaded

To fix that, the server should allow only a certain number of threads for all connections, for example 10 threads, this number should be tuned for your specific system, depends on number of CPU cores. New connections would be distributed among those threads, that would help to distribute the loads across CPU cores and save system's resouces