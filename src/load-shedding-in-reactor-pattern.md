# How Load Shedding Works in Real-Time Systems with Reactor Pattern
2026-03-09

Real-time systems receive a huge amount of requests every second. Sometimes, sudden traffic spikes happen. If a system tries to process all incoming requests during a spike, the servers will overload. CPU usage hits 100%, and memory fills up. When this happens, the response time (latency) increases.  In high-throughput environments, latency is critical. There is usually a strict millisecond deadline to respond to a request. If the response is late, the client times out or drops the response. This means CPU, memory, and network resources were wasted for nothing. 

To survive high load and remain responsive, a protection mechanism called "load shedding" is used. This post explains how load shedding works in a real-time, high-throughput system.

---

## Challenge 1: Detecting System Load

Before load can be shed, it is necessary to know if the system is actually stressed. This is done using a component called the "Loop Monitor".

> **Note:** The approach described here works specifically for systems built on the **Reactor pattern**. Because the core engine is built on top of a event loop, we can measure load by looking at how busy the loop is.

The job of the Loop Monitor is to check the "duty cycles" of these event loops. 

A duty cycle is simply a utilization value between 0.0 and 1.0:
- **0.0** means the event loop is idle. It has no work to do.
- **1.0** means the event loop is at maximum capacity.

The Loop Monitor periodically samples this load value from each message loop inside the components. 

```text
+-------------------+      sampled      +----------------+
|    Event Loop     | ----------------> |  Loop Monitor  |
+-------------------+       load        +-------+--------+
```

---

## Challenge 2: Reducing the Stress

Once a heavy load is detected on an event loop, the system must react to reduce it. The engine is designed as a data pipeline, and the most efficient way to handle a high load scenario is to cut off messages at the very head of the pipeline. Dropping the request early saves CPU time for all the downstream components. 

The number of incoming requests is reduced using a simple probability, called `dropProbability`. If this value is 20%, the system randomly drops 20% of new requests immediately.

### The Load Stabilizer

How is the exact `dropProbability` determined? A "Load Stabilizer" logic is used. 

The stabilizer aims to maintain a system load of exactly 0.9 (90% capacity) at all times. 
- Why 0.9? This level allows full utilization of hardware capabilities. 
- At the same time, it leaves a 10% safety buffer to handle sudden micro-bursts of traffic.

To achieve this, the load is periodically checked from the Loop Monitor, and the `dropProbability` is adjusted according to these simple rules:

```go
// This check runs periodically (e.g. every 100ms)
if systemLoad == 1.0 {
    // Critical overload! Drop many more requests immediately.
    dropProbability += 0.10 
} else if systemLoad > 0.9 {
    // Slightly overloaded. Drop a little more.
    dropProbability += 0.05 
} else if systemLoad < 0.9 {
    // System is safe. Slowly accept more traffic.
    dropProbability -= 0.01 
}

// Keep dropProbability bounded between 0.0 and 1.0
```

Notice a very important detail here: the probability rises much faster than it falls. 
- It adds 10% or 5% when overloaded.
- It only subtracts 1% when safe.

Why is this designed this way? An overloaded system will start to fall behind very quickly. It snowballs out of control in milliseconds. Therefore, it is important to react and cut traffic very aggressively. Once the system starts to recover, it slowly eases back into a normal state. If it recovers too fast, it will likely trigger another overload spike.

\* *AI was used to help refine and polish this article based on factual information* \*
