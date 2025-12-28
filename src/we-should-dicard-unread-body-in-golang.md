# We should dicard unread body in golang
2025-12-27, Ho Chi Minh City

Why you should discard response body even if you don't need it?

[50 Shades of Go: Closing HTTP Response Body](https://golang50shades.com/index.html#close_http_resp_body)

[Source code](https://github.com/nttams/mono/blob/779007910894c05c4f1f2bd4ac987e31fd35c5f9/should_discard_response_body/main_test.go)

```go
package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"testing"
)

/*
go test -bench . -benchmem -v
goos: darwin
goarch: arm64
pkg: should_discard_response_body
cpu: Apple M2
BenchmarkHTTPDiscard
    main_test.go:72: Connections Created: 1, Connections Reused: 25208
BenchmarkHTTPDiscard-8             25209             46355 ns/op           38582 B/op         69 allocs/op
BenchmarkHTTPNoDiscard
    main_test.go:72: Connections Created: 11319, Connections Reused: 0
BenchmarkHTTPNoDiscard-8           11319            106628 ns/op           51070 B/op        131 allocs/op
PASS
ok      should_discard_response_body    2.683s
*/

func BenchmarkHTTPDiscard(b *testing.B) {
	doBench(b, true)
}

func BenchmarkHTTPNoDiscard(b *testing.B) {
	doBench(b, false)
}

func doBench(b *testing.B, discard bool) {
	server := setupServer()
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

		if discard {
			io.Copy(io.Discard, resp.Body)
		}
		resp.Body.Close()
	}
	b.Logf("Connections Created: %d, Connections Reused: %d", created, reused)
}

func setupServer() *httptest.Server {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(make([]byte, 32*1024))
	})
	return httptest.NewServer(handler)
}
```
