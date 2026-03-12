# We must discard unread body in Golang

Out of the box, Go's `http.Client` is built for high performance. It uses a component called `http.Transport` to manage a pool of underlying TCP connections. 

When a service makes a request to an external API, the `Transport` checks the pool to see if there is an idle connection waiting to be reused. If there is, it sends the request over that existing connection. This is HTTP Keep-Alive in action. Reusing connections saves the heavy cost of DNS resolution, TCP handshakes, and TLS setup. 

When a service finishes reading a response and calls `resp.Body.Close()`, the `Transport` takes that connection and puts it back into the pool. 

But there is a catch. The connection can only be reused if the server has finished sending the response and the client has finished reading it. If there is leftover data on the wire, the connection is considered "dirty."

Sometimes, we only care about the HTTP status code. For example, maybe we are pinging a health check endpoint or sending a fire-and-forget webhook. We write something like this:

```go
resp, err := client.Post("https://api.example.com/webhook", "application/json", body)
if err != nil {
    return err
}
defer resp.Body.Close()

// The response body is not needed here; only success status matters.
if resp.StatusCode != http.StatusOK {
    return fmt.Errorf("unexpected status: %d", resp.StatusCode)
}

return nil
```

Because we did not read the response body to the end, the Go standard library does not know what is still sitting on the incoming network buffer. To prevent corrupted reads for the next request that might try to use this connection, the `http.Transport` permanently closes the underlying TCP connection and throws it away. As a result, the connection pool becomes useless. For every single request, it establishes a brand new connection. 

## Proving it with Benchmarks

This can be proven with a simple benchmark. A local HTTP server is set up to return a payload. Then, the `httptrace` package is used to hook into the `GotConn` lifecycle event. This tells exactly if a connection was freshly created or reused from the pool.

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

Result:

```text
BenchmarkHTTPDiscard
    main_test.go:72: Connections Created: 1, Connections Reused: 25208
BenchmarkHTTPDiscard-8             25209             46355 ns/op           38582 B/op         69 allocs/op
BenchmarkHTTPNoDiscard
    main_test.go:72: Connections Created: 11319, Connections Reused: 0
BenchmarkHTTPNoDiscard-8           11319            106628 ns/op           51070 B/op        131 allocs/op
```
## Summary

When working with `net/http` in Go, we should never assume `defer resp.Body.Close()` is a complete solution:
- We must read the body to EOF
- Use `io.Copy(io.Discard, resp.Body)` to safely flush unwanted bytes

> AI was used to help refine and polish this article based on factual information