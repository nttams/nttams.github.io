# Portfolio

Hey!  
I'm Tam, an associate technical lead/senior software engineer with 5+ years of experience building low-latency, real-time systems in the AdTech industry

## Featured Work

Here are some of the challenges I'm proud to have solved:

- **[Optimize: from 1800 to 800 cores](./more-threads-can-harm-your-performance.md)**
- **[Real-time Weather Augmentation](./weather-augmentation.md)**
- **[Custom Routing for RTB](./custom-routing.md)**
- **[Memory Profiling: Large Maps are Bad for Go GC](./large-maps-are-bad-for-go-gc.md)**

## Tech Stack

- **Languages:**
    - **Golang:** Deep understanding of goroutines, channels, mutexes, and GC internals
        - Built services handling 40,000+ QPS, profiled and reduced GC pauses from large in-memory maps
        - [Large Maps are Bad for Go GC](./large-maps-are-bad-for-go-gc.md)
        - [Custom Routing for RTB](./custom-routing.md)
    - **C++:** Worked on RTBKit-based bidding engine, profiled Reactor event loops and tuned thread counts to match hardware config
        - [More Threads Can Harm Your Performance](./more-threads-can-harm-your-performance.md)
    - Python, Java
- **Databases & Messaging:**
    - **Redis:**
        - Hit/miss caching with sorted sets and pipelining to reduce roundtrips: [Real-time Weather Augmentation](./weather-augmentation.md)
        - Lua scripts for atomic updates
    - **MongoDB:**
        - Ad-hoc queries to debug and find patterns for millions of requests, thousands of campaigns configuration
        - Atomic task claiming for a distributed task queue: [A Simple Task Scheduling System](./a-simple-task-scheduling-system.md)
    - **Kafka:** Built producers in Golang with a goroutine pool, handled back pressure and errors
- **Cloud & Infra:**
    - AWS: S3, SQS, EKS
    - GCP: GCS, GKE
        - BigTable: for real-time (sub-30ms) queries from golang client
        - BigQuery: for ad-hoc analytics
    - Kubernetes: statefulsets, deployments, auto-scaling, rollout management (up to 100-pod clusters)
- **Observability & Networking:**
    - Grafana: built dashboards for debugging and monitoring production/qa/staging systems
    - Prometheus: used counters, gauges, histograms from Golang client to measure request/error count and latency
    - tcpdump: for low-level network debug
- **Domains:** Real-Time Bidding, Microservices, Geospatial (Uber H3, Google S2), Bitset-based filtering
    - [Matrix-Based Filtering](./matrix-based-filtering.md)

## Personal Projects

- **[Geoplot](https://github.com/nttams/geoplot):** A lightweight tool to visualize CSV files containing latitude and longitude data on a world map.
- **[Geodata](https://github.com/nttams/geodata):** A tool to generate Uber H3 cell IDs, latitudes, and longitudes for all countries.

## Contact

[GitHub](https://github.com/nttams) · [LinkedIn](https://www.linkedin.com/in/ngothtam/)
