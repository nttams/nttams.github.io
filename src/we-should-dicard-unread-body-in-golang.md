# We must discard unread body in Golang: A dive into HTTP connection pooling
2025-12-27

\* *AI was used to help refine and polish this article based on factual information* \*

If you write Go microservices, you make HTTP calls. And if you make HTTP calls, you might be leaking performance without even knowing it. 

There is a classic gotcha in Go's `net/http` package. It is something that almost every Go engineer learns the hard way. It usually starts when you notice your service is firing up way too many TCP connections, or when your latency spikes under load. You double-check your code, and you see that you properly closed the HTTP response body. So what is going wrong?

In this post, we will explore why simply calling `resp.Body.Close()` is not always enough, and why you must explicitly discard the unread response body if you want your service to scale gracefully.

## The Connection Pooling Magic

Out of the box, Go's `http.Client` is built for high performance. It uses a component called `http.Transport` to manage a pool of underlying TCP connections. 

When your service makes a request to an external API, the `Transport` checks the pool to see if there is an idle connection waiting to be reused. If there is, it sends the request over that existing connection. This is HTTP Keep-Alive in action. Reusing connections saves the heavy cost of DNS resolution, TCP handshakes, and TLS setup. 

When you finish reading a response and call `resp.Body.Close()`, the `Transport` takes that connection and puts it back into the pool. 

But there is a catch. The connection can only be reused if the server has finished sending the response and the client has finished reading it. If there is leftover data on the wire, the connection is considered "dirty."

## The Trap: Ignoring the Body

Sometimes, you only care about the HTTP status code. For example, maybe you are pinging a health check endpoint or sending a fire-and-forget webhook. 

You write something like this:

```go
resp, err := client.Post("https://api.example.com/webhook", "application/json", body)
if err != nil {
    return err
}
defer resp.Body.Close()

// We only care if it was a success. We do not need to read the body.
if resp.StatusCode != http.StatusOK {
    return fmt.Errorf("unexpected status: %d", resp.StatusCode)
}

return nil
```

This code looks perfectly fine. You even remembered the `defer resp.Body.Close()`. But this is a severe performance trap.

Because you did not read the response body to the end, the Go standard library does not know what is still sitting on the incoming network buffer. To prevent corrupted reads for the next request that might try to use this connection, the `http.Transport` has no choice but to permanently close the underlying TCP connection and throw it away.

Your connection pool is effectively useless. For every single request, your service is establishing a brand new TCP (and maybe TLS) connection. 

## Proving it with Benchmarks

We do not have to guess. We can prove this behavior with a simple benchmark. 

We can set up a local HTTP server that returns a 32KB payload. Then, we use the `httptrace` package to hook into the `GotConn` lifecycle event. This tells us exactly if a connection was freshly created or reused from the pool.

*(Note: [Source code for this benchmark is available here](https://github.com/nttams/mono/blob/779007910894c05c4f1f2bd4ac987e31fd35c5f9/should_discard_response_body/main_test.go))*

```go
func doBench(b *testing.B, discard bool) {
	server := setupServer() // Returns an HTTP server sending 32KB of data
	defer server.Close()

	client := &http.Client{}
	var created, reused int

	for b.Loop() {
		trace := &httptrace.ClientTrace{
			GotConn: func(connInfo httptrace.GotConnInfo) {
				if connInfo.Reused {
					reused++
				} else {
					created++
				}
			},
		}

		req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
		req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

		resp, err := client.Do(req)
		if err != nil {
			b.Fatal(err)
		}

		// The critical difference
		if discard {
			io.Copy(io.Discard, resp.Body)
		}
		resp.Body.Close()
	}
	b.Logf("Connections Created: %d, Connections Reused: %d", created, reused)
}
```

When we run this benchmark on an under-load system (e.g., Apple M2), the results are devastatingly clear.

### Scenario A: Discarding the Body (The Fix)

```text
BenchmarkHTTPDiscard
    main_test.go:72: Connections Created: 1, Connections Reused: 25208
BenchmarkHTTPDiscard-8             25209             46355 ns/op           38582 B/op         69 allocs/op
```

Here, we used `io.Copy(io.Discard, resp.Body)` before closing it. Look at the numbers! Out of 25,209 iterations, we only created **1** connection. It was reused 25,208 times. The loop took ~46µs per operation.

### Scenario B: Not Discarding (The Mistake)

```text
BenchmarkHTTPNoDiscard
    main_test.go:72: Connections Created: 11319, Connections Reused: 0
BenchmarkHTTPNoDiscard-8           11319            106628 ns/op           51070 B/op        131 allocs/op
```

When we remove the `io.Copy` and just call `Close()`, things go terribly wrong. Zero connections were reused. The system had to create **11,319** brand new connections. 

The execution time jumped to ~106µs per operation—more than **double** the latency. Memory allocations (131 vs 69) and bytes consumed (51KB vs 38KB) spiked significantly because setting up TCP sockets involves allocating file descriptors, buffers, and state machine objects in the background.

## The Performance Tuning Insight

At small scales, a few milliseconds of TCP handshake overhead might not seem like a big deal. However, at the scale of infrastructure companies like Cloudflare or Uber, connection pooling is arguably one of the most important metrics to tune.

If your service processes 5,000 requests per second, and you are failing to reuse connections:
1. You are burning CPU cycles doing TCP and TLS handshakes 5,000 times a second.
2. You are allocating and garbage-collecting thousands of socket objects, driving up GC pauses.
3. You risk hitting ephemeral port exhaustion on your host machine, leading to `bind: address already in use` errors that drop traffic.
4. You are forcing the downstream server to also shoulder the burden of thousands of fresh handshakes, degrading its performance.

## The Correct Way to Handle Unread Bodies

To keep your connection pool healthy, you must make sure the response body is fully drained before closing it. 

Go gives us a very clean way to do this using `io.Copy` and `io.Discard` (which is a fast, memory-safe black hole).

```go
resp, err := client.Do(req)
if err != nil {
    return err
}

// Always ensure the body is drained before closing
defer func() {
    io.Copy(io.Discard, resp.Body)
    resp.Body.Close()
}()

if resp.StatusCode != http.StatusOK {
    return fmt.Errorf("bad status: %d", resp.StatusCode)
}

// We don't care about the body, we just return nil.
// The defer block will safely drain and close it!
return nil
```

Is there a downside to this? What if the response body is 10 gigabytes? 

If the server responds with a massive payload that you don't actually want, downloading all those gigabytes just to throw them into `io.Discard` is terrible for both your bandwidth and latency. In those extreme cases, you *should* just call `Close()` without draining, forcing Go to drop the underlying connection. 

But for standard REST APIs, webhooks, and microservice communications where payloads are small (typically a few kilobytes), draining the bytes into `io.Discard` is practically instantaneous, and the massive benefit of reusing the TCP connection far outweighs the tiny cost of draining the buffer.

## Summary

When working with `net/http` in Go, never assume `defer resp.Body.Close()` is a complete solution.

- **You must read the body to EOF.** If you don't, the HTTP client will aggressively tear down the underlying network connection to prevent protocol corruption.
- **Use `io.Copy(io.Discard, resp.Body)`.** This is the idiomatic way to safely flush unwanted bytes out of the pipeline.
- **Save CPU and Latency.** A healthy connection pool saves you from constant TCP/TLS handshakes, stabilizing both your application and your downward dependencies.

A few lines of code can literally save your infrastructure under load. Keep your pools warm and your bodies discarded!
