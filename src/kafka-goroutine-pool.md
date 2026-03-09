# Spinning up new goroutine to write a message to Kafka is a bad idea
2026-01-02

## 1. Problem
A high-throughput HTTP server receives requests and needs to publish an event to Kafka for each request asynchronously.
- The HTTP response must be fast and not blocked by the external Kafka network calls
- We want to write to Kafka asynchronously to keep latency low
- The system must handle sudden traffic spikes gracefully

### 1.1 Unbounded goroutine growth
Given an incoming HTTP request:
- A common anti-pattern is doing `go publishToKafka(msg)` to avoid blocking the HTTP handler
- If there is a massive spike in traffic, this creates an unbounded number of goroutines
- This leads to CPU scheduling overhead, garbage collection pressure, and potentially Out-Of-Memory (OOM) crashes

### 1.2 Lack of backpressure and overloaded clients
- Creating too many goroutines trying to write to the Kafka client concurrently can cause lock contention
- It bypasses efficient application-layer batching
- Once Kafka slows down, the goroutines start piling up instead of being rejected early

## 2. Solutions
### 2.1 Managing concurrency for Kafka writes
#### 2.1.1 Naive approach: go func()
Fire off a new goroutine for every request. This is simple but limits the scalability and safety of the application under load.

```
+-------------+
| HTTP Request|
+------+------+
       |
       v
+--------------+
| go func()    |
+------+-------+
       |
       v
+--------------+
| Kafka Client |
+------+-------+
       |
       v
+--------------+
| Kafka Broker |
+--------------+
```

#### 2.1.2 Optimized Approach: Goroutine Worker Pool

Pre-allocate a fixed number of worker goroutines (a pool) and use a buffered channel to decouple the HTTP handlers from the Kafka publishing logic. When the buffer is full, the HTTP handler can either block (applying backpressure) or drop the message / return an HTTP 503 instead of crashing the whole service.

Benefits:
- Predictable and safe resource consumption (goroutines are bounded)
- Native backpressure handling via buffered channels
- Reduces lock contention in the Kafka client

**HTTP Server Flow**

```
+-------------+      +-------------+      +-------------+
| HTTP Request| ---> | HTTP Request| ---> | HTTP Request|
+------+------+      +------+------+      +------+------+
       |                    |                    |
       v                    v                    v
+-------------------------------------------------------+
|                   Buffered Channel                    |
+--------------------------+----------------------------+
                           |
                           v
+-------------------------------------------------------+
|                   Worker Goroutines                   |
|  [Worker 1]    [Worker 2]    [Worker 3]   [Worker N]  |
+--------------------------+----------------------------+
                           |
                           v
+-------------------------------------------------------+
|                    Kafka Producer                     |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|                    Kafka Broker                       |
+-------------------------------------------------------+
```

## Summary
- Spawning unbounded goroutines (`go func()`) per request is dangerous and masks concurrency issues until the system crashes under load
- A bounded Goroutine Worker Pool ensures predictable memory and CPU utilization
- Using buffered channels introduces natural backpressure, protecting both your service and external dependencies

> AI was used to help refine and polish this article based on factual information
