# Things I've done or used
2025-10-22, Ho Chi Minh city


#### 0a. Things I'm confident about
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

#### 1. Reverse proxy [work project]
Link: [Reverse proxy]({% link _posts/2025-03-21-large-map-is-bad-for-go-gc.md %})

#### 2. Weather targeting [work project]
Link: [Weather targeting]({% link _posts/2025-08-28-weather-augmentation.md %})

#### 3. Optimize C++ application performance
Identify and resolve bottleneck in C++ real-time engine, by moving expensive computations from single message passing thread to multiple worker threads.   
Result: reduce from 36-core to 16-core for 50 nodes (from 1800 cores to 800 cores)

TODO: will write more about this later

#### 4. Debug C++ segmentation fault coredump with GDB

#### 5. Profiling golang application:
https://go.dev/doc/diagnostics

#### 6. Continuous profiling golang application with pyroscope:
https://grafana.com/docs/pyroscope/latest/?pg=oss-pyroscope

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

#### 12. Use redis_exporter to monitor redis

#### 13. Use redis as caching layer for real-time system, apply hit-miss and batching update mechanism

#### 14. Implementing EDNS(RFC6891) support for C++ DNS client 
