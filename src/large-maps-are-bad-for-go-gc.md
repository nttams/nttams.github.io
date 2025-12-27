# Large maps are bad for go GC
2025-03-21, Ho Chi Minh city

---
## Why Large Maps Hurt Go GC

Very large Go maps (`map[string]string` for example) that contain lots of pointers can cause significant overhead for Go's garbage collector (GC). Go uses mark-and-sweep garbage collector, during each GC cycle, it:
- Traverses all live objects
- Scans every single pointer
- Marks reachable memory

The cost of GC scales with the number of pointers, not total bytes. This is kinda a well-known issue with golang GC ([runtime: Large maps cause significant GC pauses](https://github.com/golang/go/issues/9477))

A `map[string]string` contains:

- A pointer to the internal hmap
- Pointers to bucket arrays
- For each entry:
  - A pointer to the key
  - A pointer to the value
When the map grows, it results in lots of pointers for the GC to scan every cycle
## My case
### Old system: large map in memory
I once built a HTTP reverse proxy service in golang, to apply some custom routing logics to route requests to the right upstream services:
- 10 4-core nodes
- 30_000 QPS, ~3KB per json request
- <100ms latency

It uses a large `map[string]string` to store parts of the routing rules. The CPU spikes periodically, but it happens too frequently and the prometheus chart gets flattened (with 5m interval), so I don't notice it. Only when I profiled the service and see GC-related works take a large part of CPU time :(

Workflow: `request -> go process -> lookup routing rule in map -> forward to upstream`

```go
package main

import (
	"fmt"
	"runtime"
	"time"
)

func run(n int) {
	routes := make(map[string]string, n)

	for i := range n {
		routes[fmt.Sprintf("key-%d", i)] = fmt.Sprintf("value-%d", i)
	}

	const runs = 10
	var totalPause time.Duration
	for range runs {
		start := time.Now()
		runtime.GC()
		pause := time.Since(start)
		totalPause += pause
	}

	avgMs := float64(totalPause.Milliseconds()) / float64(runs)
	fmt.Printf("n=%d | avg GC pause=%.3fms\n", n, avgMs)

	_ = routes["key-0"] // prevent the map from being garbage collected
}

func main() {
	run(1_000_000)
	run(10_000_000)
	run(20_000_000)
}

// Result
// % go run ./...
// n=1000000 | avg GC pause=10.200ms
// n=10000000 | avg GC pause=103.300ms
// n=20000000 | avg GC pause=342.600ms
```

![Alt text for the image](../go_gc_before.jpeg)

Observations:
- `runtime.gcDrainMarkWorker` and `runtime.gcDrainMarkWorkerIdle` dominates CPU usage
- GC pause time increases with map size


### New system: large map in Redis

Workflow: `request -> go process -> lookup routing rule in redis -> forward to upstream`
![Alt text for the image](../go_gc_after.jpeg)

Observations:
- GC pauses dropped significantly
- Overall RAM usage decreased (10 Go nodes vs 1 Redis node)
- Latency increased, but acceptable in the case

## Results and trade-offs

| Aspect             | Go Map | Redis  |
|--------------------|--------|--------|
| GC pressure        | High   | Low    |
| Lookup latency     | Fast   | 2–3 ms |
| Memory per node    | High   | Low    |
| Horizontal scaling | Low    | High   |

## Summary

- Profile your program, the sooner the better
- Avoid large map with pointers in memory
- Use external stores for large/static/shared datasets
