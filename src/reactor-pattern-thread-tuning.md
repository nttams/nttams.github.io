# Why More Threads Can Tank Your Performance: A Story About Reactor Pattern
2026-03-08

\* *AI was used to help refine and polish this article based on factual information* \*

## 1. Introduction
Building an ad-tech system is hard because you must reply very fast. In Real-Time Bidding (RTB), when a user opens an app or website, an ad exchange (like OpenX or Rubicon) sends a bid request to your system. You have a very short time, usually less than 100 milliseconds, to read the request, match it with active campaigns, decide to bid, and send it back.

If you take too long, the exchange drops your response. You lose the auction and the business loses money. Every millisecond matters.

I used to work on a system built with [RTBKit](https://github.com/rtbkit/rtbkit), a fast C++ bidding engine. RTBKit is very powerful, but it has some tricky parts. Once, to handle more traffic, I simply added more worker threads. I thought more threads would mean more speed. But the opposite happened: my system became much slower.

This post explains why spinning up too many threads in a Reactor-based system is bad, and how it can choke your main event loop.

## 2. RTBKit Architecture
RTBKit uses a mix of thread pools and an event loop to process requests. The Event Loop sits in the center and routes messages between the different parts.

Here is a simple view of the system:
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

1. **Exchange workers:** These threads receive the HTTP bid request, parse the JSON, and match the bid request against a large number of campaigns. This is very heavy CPU work.
2. **Event Loop:** The worker finishes and sends a message to a queue. The Event Loop picks it up and sends it to the Augmenter threads.
3. **Augmenters:** Add extra data to the request. After they finish, they send a message back to the Event Loop.
4. **Bidders:** The Event Loop routes the request to Bidder threads. They look at the matched campaigns and decide if they want to bid or not.
5. **Send Response:** The response routes back through the Event Loop to the Exchange worker threads, which send it back to the ad exchange.

## 3. The Reactor Pattern and the Event Loop
In this system, components don't call each other directly. They talk using queues. To tell another component that a message is ready, they use a single Event Loop.

This is the Reactor Pattern. When a worker pushes a message to the queue, it wakes up the single Event Loop thread. The Event Loop reads the message and routes it to the right place.

This is a good design, but there is one weak spot: **the single Event Loop thread**. All messages must go through this one thread.

## 4. The Problem: Adding Too Many Threads
Our traffic was growing. CPU usage was going up, and many bid requests started to timeout. 

My server had many CPU cores, so I thought: "I should add more exchange worker threads."

I increased my worker threads. I hoped the system would handle more requests. But performance dropped a lot:
- CPU usage got even higher.
- Auction latency increased.
- Bid timeouts increased.
- Overall throughput dropped.

How could adding more workers make the system slower?

## 5. Debugging the Issue
I checked the operating system and looked at what the CPU was doing.

The problem became clear: **the Event Loop thread was fully overloaded and stuck at maximum CPU.**

Because I added too many worker threads, they were all parsing requests, matching campaigns, and sending messages to the Event Loop at the same time. The single Event Loop could not read and route messages fast enough. It was overwhelmed, creating backpressure.

Also, having too many threads trying to wake up the Event Loop caused a lot of contention. The CPU spent more time managing threads instead of doing real work.

## 6. How I Fixed It

### Fix 1: Reduce the Worker Threads
First, I scaled down the thread pool based on available CPU cores. More threads are not always better. You must match the thread count to what your system can actually handle.

I tested multiple configurations with different numbers of workers. By reducing the number of exchange workers, the Event Loop had less pressure. I selected the configuration that gave the best throughput and latency. Contention disappeared, and the system became faster.

### Fix 2: Remove Work from the Event Loop
The Event Loop had less pressure, but it was still running hot. In a Reactor pattern, the Event Loop must only route events.

I read the code and found that there were "slightly slow" tasks, such as logging and data formatting, inside the Event Loop logic. 

```cpp
// BAD: Formatting strings inside the Event Loop
void EventLoop::dispatch(Message msg) {
    std::string logMsg = formatMetric(msg); 
    logger.log(logMsg);
    targetQueue.push(msg);
}
```

These things only take a little time. But if you do them many times a second in a single thread, the CPU gets overloaded.

I moved this non-critical work out of the Event Loop into the worker threads. After this change, the Event Loop was much faster. The system throughput improved a lot and the timeouts went away.

## 7. Key Lessons

1. **Thread tuning: More is not always better.** Adding more threads can overload the event loop. Always test and find the best number for your system.
2. **Event loop design: Keep it fast.** The Event Loop's only job is to route events. Never put slow code inside it.
3. **Avoid bottlenecks in hybrid models:** Systems with both heavy worker threads and a single event loop look good, but the event loop can easily become the bottleneck. Watch it closely.

For engineers building high-performance systems: always remember the bottleneck might not be the code doing the hard compute work, but the code organizing it. Scale carefully!
