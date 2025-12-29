# Things I've done or used
2025-10-22, Ho Chi Minh city

**Things I'm confident in**  
- Techniques:
  - Microservices 
  - Real-time (<5ms) hit-miss caching and separate batch update
  - Decoupling: inject large amount of data from golang service to clickhouse with kafka as buffer
- Golang:
  - goroutine: when to spin up new goroutines, when to use goroutine pool
  - channel: when to use channel (buffer/without buffer), when to use mutex/atomic
  - mutex/atomic: when to use mutex, when to use atomic
  - profiling/continuous profiling: the sooner the better
  - libraries:
    - segmentio/encoding: very fast json encoder/decoder comparing to std encoding/json
    - segmentio/kafka-go: kafka client
    - httputilsnet/http/httputil/ReverseProxy
    - mongodb/mongo-go-driver
    - redis/go-redis
    - bits-and-blooms/bloom/v3: bloom filter, for super fast membership testing with false positive rate
    - uber/h3-go: for geospatial indexing, very cool

**Things I'm familiar with**  
- C++, Rust, Python, Java, Bash
- Redis, MongoDB, Kafka, Aerospike
- AWS S3/SQS
- GCP GCS/BigTable/BigQuery/GCS
- K8s, Docker, Nginx, Grafana, Prometheus
- HTTP, DNS protocols
- Protobuf, websocket

**Debug C++ segmentation fault coredump with GDB**  

**Profiling golang application**  
https://go.dev/doc/diagnostics

**Continuous profiling golang application with pyroscope**  
https://grafana.com/docs/pyroscope/latest

**Uber H3 and Google S2**  
Uber H3: https://h3geo.org/  
Google S2: http://s2geometry.io/

**Bloom filter**  
https://en.wikipedia.org/wiki/Bloom_filter  
https://github.com/bits-and-blooms/bloom

**Bitset-based filtering**  
To match request and with large number of campaigns in real-time  
https://github.com/rtbkit/rtbkit/wiki/Filter


**Geoplot tool [personal project]**  
A simple tool to visualize CSV files containing latitude and longitude data on a world map.  
Link: [https://github.com/nttams/geoplot](https://github.com/nttams/geoplot)

**Geodata [personal project]**  
A simple tool to generate UberH3 cellIDs, latitude, and longitude for all countries in the world.    
Link: [https://github.com/nttams/geodata](https://github.com/nttams/geodata)

**Use redis as caching layer for real-time system, apply hit-miss and batching update mechanism**  

**Implementing EDNS(RFC6891) support for C++ DNS client**  

**Switch from golang std encoding/json to segmentio/encoding/json**  
Interfaces are almost identical, performance is much better

**Continuous profiling rust application with pyroscope**  

**Use redis_exporter/redisinsight to monitor redis**  

**Tictactoe game in Haskell**  
Link: [Tictactoe game repo](https://github.com/nttams/tictactoe)  
Video: [Tictactoe game video - English](https://www.youtube.com/watch?v=ayEs9_NbKI8)  
Video: [Tictactoe game video - Vietnamese](https://www.youtube.com/watch?v=Lf5qoGfaMd0)  

**Distributed Midnight scavenger miner**  
TODO: will write more about this later