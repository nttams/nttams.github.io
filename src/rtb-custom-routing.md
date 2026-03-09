# Custom Routing in a Distributed RTB
2026-03-09

> **Disclaimer:** All numbers and examples in this article describe abstract ideas. They are not exact facts about any real system.

A RTB system handles 10,000 active campaigns, is horizontally scalable — we can add more compute nodes to handle more load. But scaling campaign capacity revealed a real problem: the more we scaled, the worse our match rate got.


---

## The Problem: Campaigns Are Spread Thin

Matching a bid request to a campaign is CPU-heavy. For each incoming bid request, a node must check eligibility across every campaign: targeting rules, budget limits, frequency caps, and more. A single node cannot handle 10,000 campaigns at full traffic, so we distribute campaigns across nodes.

Each node only holds a subset of campaigns — around 1,000. That means at any moment:

```text
Total campaigns: 10,000
Nodes: 10
Campaigns per node: ~1,000
```

Incoming bid requests are routed to one node. That node only "sees" its 1,000 campaigns. If the right campaign for this request lives on a different node, we miss the match entirely.

As we added more nodes to scale capacity, campaigns were spread even thinner across them. The match rate did not improve — it got worse.

```text
   Bid Request
       |
       v
+------+------+
|    Node 1   |  <- sees only 1,000 of 10,000 campaigns
| 1,000 camps |
+-------------+
+-------------+
|    Node 2   |
| 1,000 camps |
+-------------+
   ... x10
```

This is a fundamental issue with random (round-robin) routing. Every node is equally likely to receive a bid request, but no node has visibility of all campaigns. Horizontal scaling adds capacity but hurts utilization.

---

## The Solution: A Custom Reverse Proxy

We built a reverse proxy that sits in front of the compute nodes. Instead of routing requests randomly, it routes each bid request to the node most likely to have a matching campaign.

The proxy does not run the full filtering logic — that is too CPU-heavy. Instead, it applies a small number of fast, lightweight filter checks. The goal is to eliminate clearly wrong nodes and increase the probability that a bid request lands on a node with a matching campaign.

```text
   Bid Request
       |
       v
+------------------+
|  Reverse Proxy   |  <- applies lightweight filter logic
|  (Go + Redis)    |
+--+---+---+---+---+
   |   |   |   |
   v       v
+-------+  +-------+
| Node1 |  | Node3 |  <- best candidates for this request
| 1,000 |  | 1,000 |
| camps |  | camps |
+-------+  +-------+
```

We built this in Go using the standard `net/http/httputil.ReverseProxy` package with custom routing logic. Redis stores per-node metadata — the campaigns each node holds and which targeting dimensions they cover.

---

## How the Routing Works

When a bid request arrives at the proxy:

1. Read key attributes from the request (e.g. country, device type, ad format).
2. For each compute node, check Redis to see if that node has any active campaigns that match those attributes.
3. Route the request to the node with the highest number of potential matches.

We only apply a few fast filter checks — the ones with high selectivity and low compute cost. The full filtering (budget checks, frequency caps, etc.) still happens on the compute node.

```text
Bid Request
    |
    v
+---------------------+
| Parse Request Attrs |  <- country, device, format, etc.
+----------+----------+
           |
           v
+---------------------+
| Query Redis:        |
| Which nodes have    |
| matching campaigns? |
+----------+----------+
           |
           v
+---------------------+
| Pick best node      |
| (highest match      |
|  potential)         |
+----------+----------+
           |
           v
+---------------------+
| Forward to Node     |
+---------------------+
```

Pseudocode for the routing decision:

```go
func pickBestNode(req BidRequest, nodes []Node) Node {
    bestNode := nodes[0]
    bestScore := 0

    for _, node := range nodes {
        // Lightweight Redis check: how many campaigns on this node
        // match the request's key attributes?
        score := redis.GetMatchScore(node.ID, req.Country, req.DeviceType, req.AdFormat)

        if score > bestScore {
            bestScore = score
            bestNode = node
        }
    }

    return bestNode
}
```

---

## Upstream Health Checks

A naive reverse proxy forwards traffic to any node that is alive. We need two additional checks.

### Check 1: Node is Up

This is standard. If a node does not respond to health checks, we stop sending requests to it. We poll each node's health endpoint and remove failed nodes from the routing pool.

### Check 2: Node Has Active Campaigns

This one is less obvious. When a node crashes and restarts, it comes back up healthy but empty — it has no active campaigns yet because it has not finished loading its campaign data from the data store.

This is a real problem. An empty node responds to requests very fast (it has no campaigns to check, so it does nothing). Without this check, the proxy would see a fast, healthy node and flood it with traffic. The node would respond quickly with zero bids, wasting every single request.

We require each compute node to expose an API endpoint that returns its current active campaign count:

```
GET /status
{
  "active_campaigns": 1024
}
```

The proxy checks this count. If it is zero (or below a minimum threshold), the node is skipped from the routing pool until it is ready.

```text
+------------------+
| Health Check     |
| per node         |
+------------------+
        |
        v
  Is node alive?
     /       \
   No         Yes
    |           |
  Remove      Does it have
  from pool   campaigns?
              /       \
            No         Yes
             |           |
           Skip        Include
           node        in pool
```

---

## Results and Trade-offs

After deploying the custom routing proxy, our match rate increased by around **30%**. This came entirely from routing bid requests to nodes that have relevant campaigns, instead of routing randomly.

The trade-off is added latency. The proxy needs to query Redis and run routing logic before forwarding. This adds around **5ms** to each request. For our system, that is acceptable — bid requests have a strict deadline (usually 100ms total), and 5ms leaves enough room for the compute node to do full filtering and ML scoring.

The proxy also adds one more component to the system. We run it with multiple instances behind a load balancer to avoid it becoming a single point of failure.

---

## Key Takeaways

1. **Random routing is not always right.** In systems where data is partitioned across nodes, routing requests randomly means lower utilization. custom routing improves match rate without adding hardware.
2. **Do lightweight filtering at the proxy layer.** Running full filtering at the proxy is too expensive. A few fast checks are enough to make better routing decisions.
3. **Healthy does not mean ready.** A node that just restarted can appear healthy but have no data. Check application-level readiness, not just network-level liveness.
4. **Fast nodes attract traffic.** An empty node responds fast. Without readiness checks, a proxy will send it all the traffic. Always check for readiness before routing.

> AI was used to help refine and polish this article based on factual information
