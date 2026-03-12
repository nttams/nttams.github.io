# More Threads Can Harm Your Performance

**TL;DR:** By reducing the number of worker threads and unblocking our main event loop in a C++ Reactor-pattern system, we improved overall performance and downgraded our compute node from 36 cores to 16 cores. Across a deployment of 50 instances, this reduced our cluster from 1800 cores down to just 800 cores.

## Introduction
In RTB (real time bidding) DSP (demand side platform) system, things move fast, usually the server must respond in 100ms. If it takes too long, it loses the auction.

I used to work on a RTB DSP system built with [RTBKit](https://github.com/rtbkit/rtbkit), a fast C++ bidding engine. RTBKit is very powerful, but it has some tricky parts. Once, to handle more traffic, I simply added more worker threads. I thought using more CPU cores would mean more speed. But the opposite happened: our system became much slower.

This post explains why spinning up too many threads in a Reactor-pattern system can be bad, and how fixing it allowed us to improve performance significantly.

## RTBKit Architecture
RTBKit uses a mix of thread pools and an event loop to process requests. The Event Loop sits in the center and routes messages between the different components. Here is a simple view of the system:
```text
                          +------------------+
                          |                  |
   +----------------+     |  Augmenter       |     +----------------+
   |                |     |  Threads         |     |                |
   | Exchange       |     |                  |     | Bidder         |
   | Worker Threads |     +------------------+     | Threads        |
   |                |          ^        |          |                |
   +----------------+          |        |          +----------------+
      ^        |               |        v               ^        |
      |        |          +------------------+          |        |
      |        +--------> |                  | <--------+        |
      |                   |    EVENT LOOP    |                   |
      +------------------ |    (Reactor)     | ------------------+
                          |                  |
                          +------------------+
```

- **Exchange workers:** These are the main workers, they receive the HTTP bid request, parse the JSON, and match the bid request against a large number of campaigns. This is very CPU-intensive work.
- **Event Loop:** The exchange worker thread finishes and sends a message to a queue. The event loop picks it up and routes it to the augmenter threads.
- **Augmenters:** Add extra data to the request. IO-bound work.
- **Bidders:** Decide if they want to bid or not. IO-bound work.
- **Send Response:** The response routes back through the event loop to the exchange worker threads, which send it back to the ad exchange.

## The Reactor Pattern and the Event Loop
In this system, components don't call each other directly. They talk using queues. To tell another component that a message is ready, they use a single event loop. This is the Reactor Pattern. When a worker pushes a message to the queue, it wakes up the single event loop thread. The event loop reads the message and routes it to the right place.

This is a good design, but there is one weak spot: **the single event loop thread**. All messages must go through this one thread.

## The Problem: adding too many threads
Our traffic was growing and requests started to timeout. Our server had 36 CPU cores per instance, so we thought: "We should add more exchange worker threads to utilize all these cores." We increased our worker threads to match the available cores. We hoped the system would handle more requests.

**Results**: CPU usage got higher (which was expected, more cores joined the party), but request timeouts increased.

How could adding more workers make the system slower?

## Debugging the Issue
We checked what the CPU was doing (with htop). Because you can set names for threads, we could see that the event loop thread was overloaded at maximum CPU. We added too many worker threads, so they were all parsing requests, matching campaigns, and sending messages to the event loop at the same time. The single event loop could not read and route messages fast enough

## How We Fixed It

### Fix 1: Remove work from the event loop

The Event Loop was running hot. In a Reactor pattern, we know the event loop should only route events, not actually do any work. So we hunted for any work inside the event loop. And we found that there were some "slightly slow" tasks, such as logging and data formatting, like this:

```cpp
void EventLoop::dispatch(Message msg) {
    std::string logMsg = formatMetric(msg); 
    logger.log(logMsg);
    targetQueue.push(msg);
}
```

These things only take a little time, but workers thread are pushing the event loop hard, so it adds up. We moved these non-critical work out of the event loop into the worker threads. After this change, performance slightly improved, which proved our point and built confidence a bit.

### Fix 2: Reduce the worker threads
Then we scaled down the thread pool based on what the event loop could handle, more threads are not always better. We must match the thread count to our system's architectural bottlenecks. We tested multiple configurations. By reducing the number of workers, the event loop had less pressure, and the system became noticeably faster. We discovered the sweet spot was using only **16 cores instead of 36 cores** per instance. Across our deployment of 50 instances, this reduced our total footprint from **1800 cores back down to 800 cores**, while maintaining better latency and higher throughput

## Takeaways

- **Thread tuning: More is not always better**. Always test and find the best configuration for your system.
- **Event loop design: Keep it fast**. The event loop is only to route events. Never put even slightly slow code inside it.

> AI was used to help refine and polish this article based on factual information
