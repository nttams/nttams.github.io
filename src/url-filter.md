# Scaling URL Blacklisting With Bloom Filter
2026-03-08

> **Disclaimer:** All numbers and examples in this article describe abstract ideas. They are not exact facts about any real system.

Modern web architecture and security layers often demand deep inspection of incoming traffic to prevent malicious behaviors, stop spam, and block known bad actors. At a glance, this seems like a standard task: an HTTP request comes in, you check the target URL or the origin IP against a database of known bad strings, and you block it if there is a match. However, when you operate at a massive scale, finding the right balance between memory usage, network capacity, and response latency is surprisingly hard.

In this post, I will share a real-world problem we faced. Our web gateway receives global traffic. For every single incoming request, we needed to verify if the URL being accessed was present in our global blacklist database.

The technical requirements were strict:
1. **Traffic Scale:** We handle a steady state of 50,000 queries per second (QPS).
2. **Latency Budget:** The blacklisting check must complete in under **100ms**, as it sits on the critical path of every request before any business logic can execute.
3. **Data Volume:** The blacklist is massive, containing roughly 10,000,000 (10 million) known malicious URLs.

This presents a distinct engineering challenge on the hot path: checking a massive dataset quickly without exhausting server memory or blowing up our latency budget with slow network calls.

Let's break down how our architecture evolved to solve this problem, from naive implementations to a final, highly optimized approach using probabilistic data structures.

---

## Understanding the Core Technology: The Bloom Filter

Before diving into the architecture evolution, it is important to understand the core technology that ultimately saved us: the Bloom Filter. 

A Bloom filter is a space-efficient probabilistic data structure. It was invented in 1970, and it is designed to do one thing very quickly and with very little memory: tell you if a specific element is a member of a given set.

Under the hood, a Bloom filter is simply a bit array (a long continuous array of 0s and 1s) and a set of multiple hash functions. It does not store the actual data (in our case, the URL strings) anywhere. 

When you insert an element into the filter, you hash the element multiple times using the different hash functions. Each hash function gives you an integer output, which corresponds to an array index. You then set the bit at those specific indices to `1`.

When you want to check if an element exists in the set, you hash the test element again with the exact same functions and check the corresponding bits in the array.
- **If any of the bits are `0`:** The element is **definitely not** in the set.
- **If all of the bits are `1`:** The element is **probably** in the set.

This probabilistic nature is the most important concept. A Bloom filter can give **false positives** (saying an item is in the set when it actually is not, due to hash collisions from other items). But it never gives **false negatives**. If the filter says an item is not there, it is 100% mathematically certain that it is not there.

```text
+------------------+
|   Query URL      |
+--------+---------+
         |
         v
+------------------+
| Hash Functions   |
+--------+---------+
         |
         v
+------------------+
| Bit Array (0/1)  |
+---+----------+---+
    |          |
Any bit is 0   All bits are 1
    |          |
    v          v
 Definitely   Probably 
 Not In Set   In Set
```

With this concept in mind, let's look at how our URL blacklisting system evolved.

---

## The Evolution of our URL Blacklisting

### Phase 1: The In-Memory Approach

At first, when data was small, the solution was extremely straightforward. We simply fetched the entire blacklist from our SQL database on startup and loaded it entirely into the RAM of our API servers. We stored it in a standard hash set (like a `map[string]struct{}` in Go).

```text
+-------------+
| HTTP Request|
+------+------+
       |
       v
+--------------+
| Check Memory |
| Hash Set     |
+------+-------+
       | O(1) Lookup
       v
+--------------+
| Pass / Block |
+--------------+
```

Here is a conceptual pseudocode of the Phase 1 hot path:

```go
// Loaded into memory at application startup
var localBlacklistMap map[string]struct{}

func HandleRequest(w http.ResponseWriter, r *http.Request) {
    url := extractURL(r)
    
    // Instant O(1) memory lookup
    if _, exists := localBlacklistMap[url]; exists {
        blockRequest(w)
        return
    }
    
    allowRequest(w, r)
}
```

**Why it worked:** Memory lookups are incredibly fast. We easily met the 100ms latency requirement, usually executing the check in mere nanoseconds.
**Why it failed:** As data grew, analysts kept adding URLs. The blacklist swelled to 10 million URLs. Storing 10 million distinct URLs in memory requires gigabytes of RAM per server instance just for the security middleware. Loading them all into memory became inefficient. Our application took much longer to start and our infra costs for high-memory servers increased.

### Phase 2: The External Database Approach

Because the dataset was obviously too large for application application memory, the logical next step was moving the data out of the application and into an external database layer. We chose Redis because it is an in-memory datastore and extremely fast compared to a traditional relational database.

Instead of keeping the massive list in the application's RAM, the application makes a network call to Redis for every incoming request to check if the URL exists using the Redis `SISMEMBER` command.

```text
+-------------+
| HTTP Request|
+------+------+
       |
       v
+--------------+
| Call Redis   |
| over network |
+------+-------+
       |
       v
+--------------+
| Pass / Block |
+--------------+
```

Here is how the hot path changed:

```go
var redisClient *redis.Client

func HandleRequest(w http.ResponseWriter, r *http.Request) {
    url := extractURL(r)
    
    // Slow down: network call to external system
    isBlacklisted, err := redisClient.SIsMember(ctx, "blacklist_urls", url)
    if err != nil {
        handleError(w, err)
        return
    }
    
    if isBlacklisted {
        blockRequest(w)
        return
    }
    
    allowRequest(w, r)
}
```

**Why it worked:** We completely solved the application memory issue. The dataset size was no longer bounded by the RAM limits of our web servers. Redis can easily scale to handle hundreds of gigabytes of data.
**Why we moved on:** Redis can easily handle 50,000 QPS, and the external check only adds 1-3ms of network latency. This fits perfectly within our 100ms budget for now. However, we assume the data and traffic will continue to grow further, so we better prepare rather than waiting for future bottlenecks.

More importantly, we realized the distribution of the data provides a huge optimization opportunity. For 99.9% of normal traffic, the URL is *not* blacklisted. Making tens of thousands of network calls to Redis every second just to confirm "No, this is safe to process" felt inefficient when preparing for future scale.

### Phase 3: The Optimized Approach with Bloom Filters

We needed a way to drop the unnecessary network calls for the 99.9% of safe URLs while keeping application memory usage extremely low. We needed something that acts as a fast filter before the network layer. This is exactly where the Bloom filter excels.

We introduced a Bloom filter back into the application's local memory, placing it strictly in front of Redis. 

This Bloom filter acts as a fast, low-memory shield. We populate it with the 10 million blacklisted URLs. Because a Bloom filter only stores raw bits, not the actual long URL strings, the memory footprint is tiny. Instead of gigabytes of strings, the 10 million URLs can be represented in just a few megabytes of RAM.

#### The Hot Path Flow

When an HTTP request arrives, we first check the Bloom filter in the local server memory.

- **Definite Miss:** If the Bloom filter says the URL is not blacklisted, it is 100% true. We can safely allow the request immediately. We do not need to call Redis at all. This handles the vast majority of our traffic instantly with zero network overhead.
- **Probable Hit:** If the Bloom filter says the URL is blacklisted, it might be a false positive. Because we cannot block a user based on a false positive, we must make a network call to Redis to check the actual database and confirm if the URL is truly malicious.

```text
+-------------+
| HTTP Request|
|    (URL)    |
+------+------+
       |
       v
+--------------+
| Bloom Filter |
| In Memory    |
+---+------+---+
    |      |
 Miss      Probable Hit
 (Safe)    | (Could be false positive)
    |      v
    |  +------------+
    |  | Call Redis |
    |  | to confirm |
    |  +---+--------+
    |      |
    v      v
+--------------+
| Pass / Block |
+--------------+
```

Here is a pseudocode snippet showing how this optimal hot path is implemented:

```go
// Pre-loaded in local application memory
var urlBloomFilter *bloom.Filter
var redisClient *redis.Client

func CheckURLBlacklist(url string) bool {
    // 1. Fast path: Check Bloom Filter in memory (takes nanoseconds)
    if !urlBloomFilter.Test([]byte(url)) {
        // Definitely not blacklisted. 
        // We saved an expensive network call to Redis!
        return false 
    }
    
    // 2. Slow path: Bloom filter says it's blacklisted. 
    // We must verify with external DB to prevent false positives from blocking users.
    isBlacklisted, err := redisClient.SIsMember(ctx, "blacklist_urls", url)
    if err != nil {
        return false // fail open or closed depending on policy
    }
    
    return isBlacklisted
}
```

By adding this probabilistic layer, we achieved the best of both worlds. We kept memory usage low enough to fit on standard application servers, we skipped the Redis network call for 99.9% of our traffic, and we easily stayed well under our 100ms latency budget even during extreme traffic spikes.

---

## Performance Tuning Insights and Trade-offs

Using a Bloom filter is not a silver bullet. It introduces several trade-offs and tuning parameters that you must carefully manage in a production environment.

### 1. Memory vs. False Positive Rate

The size of the bit array and the number of hash functions directly control the false positive rate. 
- A larger bit array reduces hash collisions, significantly lowering the false positive rate, but consumes more application memory.
- A smaller bit array saves RAM but increases collisions. More collisions mean more false positives. 

If your false positive rate gets too high, the Bloom filter becomes useless because you will constantly fall back to hitting Redis anyway, completely defeating the purpose of the shield. 

For our scale of 10 million URLs, there is a mathematical formula to decide the optimal size. To achieve a 1% false positive rate (meaning 1 in 100 requests will incorrectly trigger a network call to Redis), we needed exactly 7 hash functions and a bit array of roughly 11.4 megabytes. Dedicating ~12MB of RAM per server instance to prevent thousands of network requests per second was an incredibly profitable trade-off.

### 2. The Deletion Problem

A standard Bloom filter generally does not support deletions. You can only set bits to 1, you cannot set them back to 0. If you try to remove an item by flipping its specific bits to 0, you might accidentally corrupt other items that share those same bits due to hash collisions.

In a URL blacklisting system, you sometimes need to remove URLs from the blacklist if they were added by mistake (false positives reported by users). 

To solve this, we rebuild the Bloom filter periodically rather than trying to delete items in-place. We have a background chron job that pulls the latest source-of-truth blacklist from the main SQL database, constructs a completely new Bloom filter from scratch in isolated memory, and atomically swaps the pointer. 

```go
func backgroundBloomFilterRefresher() {
    for {
        // Build an entirely new filter
        newFilter := bloom.NewWithEstimates(10000000, 0.01)
        
        // Load all current data
        urls := database.GetAllBlacklistedURLs()
        for _, u := range urls {
            newFilter.Add([]byte(u))
        }
        
        // Atomically replace the old filter
        atomic.StorePointer(&urlBloomFilter, unsafe.Pointer(newFilter))
        
        // Wait before refreshing again
        time.Sleep(10 * time.Minute)
    }
}
```

Since building the filter only takes a short amount of time, rotating it every 10 minutes ensures our cache stays relatively fresh and stale deletions are purged quickly without blocking the hot path.

### 3. Fast Hashing Speed

Because the Bloom filter sits firmly on the hot path for every single incoming request, the hash functions must be extremely fast. Cryptographic hashes like SHA-256 or MD5 are very secure but entirely too slow and CPU-intensive for this use case. Instead, you should rely on fast, non-cryptographic hash functions like `MurmurHash3` or `xxHash`. They provide excellent even distribution across the bit array and execute in mere nanoseconds.

---

## Conclusion

Scaling high-throughput systems often requires stepping away from perfect, absolute representations of data in the hot path and embracing probabilistic algorithms. 

To summarize the key engineering takeaways from our journey:
1. **Application memory is precious, but network layers are slow.** An external database gracefully solves the data size limitations but immediately introduces network and connection bottlenecks.
2. **Use probabilistic shields aggressively.** A Bloom filter acts as an incredibly efficient shield placed in front of an external database. By eliminating unnecessary work early in the pipeline, you save massive amounts of network I/O.
3. **Understand the trade-offs intimately.** Probabilistic structures like Bloom filters bring unique challenges, notably false positives and the inability to delete records easily. Always tune your mathematical parameters (like integer array size and the count of hash functions) based on your real-world traffic patterns and memory limits.

By blending the incredible memory efficiency of a Bloom filter with the exactness of Redis for verification, we built a hybrid checking system that effortlessly handles 50,000 requests per second while reliably making security decisions in milliseconds.

> AI was used to help refine and polish this article based on factual information  