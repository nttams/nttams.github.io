# Things I've done or used
2025-10-22, Ho Chi Minh city

#### 0a. Things I'm confident in
- Golang (goroutine, channel, mutex, atomic, profiling, continuous profiling)
- C++  

#### 0b. Things I'm familiar with
- Rust, python, java, bash
- Redis, mongoDB, kafka, aerospike
- AWS S3/SQS,
- GCP GCS/BigTable/BigQuery/GCS
- K8s, docker, nginx, grafana, prometheus
- HTTP, DNS protocols
- Protobuf, websocket
#### 0c. Things I've tried but wouldn't say I'm familiar with
- Haskell
  - [Tictactoe game repo](https://github.com/nttams/tictactoe)
  - [Tictactoe game video - English](https://www.youtube.com/watch?v=ayEs9_NbKI8)
  - [Tictactoe game video - Vietnamese](https://www.youtube.com/watch?v=Lf5qoGfaMd0)

#### 1. Reverse proxy [work project]
Link: [Reverse proxy](https://nttams.github.io/large-map-is-bad-for-go-gc.html)

#### 2. Weather targeting [work project]
Link: [Weather targeting](https://nttams.github.io/weather-augmentation.html)

#### 3. Optimize C++ application performance
Identify and resolve bottleneck in C++ real-time engine, by moving expensive computations from single message passing thread to multiple worker threads.   
Result: reduce from 36-core to 16-core for 50 nodes (from 1800 cores to 800 cores)

TODO: will write more about this later

#### 4. Debug C++ segmentation fault coredump with GDB

#### 5. Profiling golang application:
https://go.dev/doc/diagnostics

#### 6. Continuous profiling golang application with pyroscope:
https://grafana.com/docs/pyroscope/latest

#### 7. Uber H3 and Google S2
Uber H3: https://h3geo.org/  
Google S2: http://s2geometry.io/

#### 8. Bloom filter
https://en.wikipedia.org/wiki/Bloom_filter  
https://github.com/bits-and-blooms/bloom

#### 9. Bitset-based filtering
To match request and with large number of campaigns in real-time  
https://github.com/rtbkit/rtbkit/wiki/Filter


#### 10. Geoplot tool [personal project]
A simple tool to visualize CSV files containing latitude and longitude data on a world map.  
Link: [https://github.com/nttams/geoplot](https://github.com/nttams/geoplot)

#### 11. Geodata [personal project]
A simple tool to generate UberH3 cellIDs, latitude, and longitude for all countries in the world.    
Link: [https://github.com/nttams/geodata](https://github.com/nttams/geodata)

#### 12. Use redis as caching layer for real-time system, apply hit-miss and batching update mechanism

#### 13. Implementing EDNS(RFC6891) support for C++ DNS client 

#### 14. Switch from golang std encoding/json to segmentio/encoding/json
Interfaces are almost identical, performance is much better

#### 15. Continuous profiling rust application with pyroscope

#### 16. Use redis_exporter/redisinsight to monitor redis
