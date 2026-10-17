# Custom Routing

> **Disclaimer:** All numbers and examples in this article describe abstract ideas. They are not exact facts about any real system.

A RTB system handles 10,000 active campaigns, is horizontally scalable, we can add more compute nodes to handle more load. But scaling campaign capacity revealed a real problem: the more we scaled, the worse our match rate got.

## The Problem: Campaigns Are Spread Thin

Matching a bid request to a campaign is CPU-heavy. For each incoming bid request, a node must check eligibility across every campaign: targeting rules, budget limits, frequency caps, and more. A single node cannot handle 10,000 campaigns at full traffic, so we distribute campaigns across nodes.

Each campaign is distributed across 3 of the 10 nodes (to increase visibility). That means each node holds about 3,000 campaigns:

```text
Total campaigns: 10,000
Nodes: 10
Replicas per campaign: 3
Campaigns per node: 10,000 × 3 / 10 = 3,000
```

Incoming bid requests are routed to one node. That node only "sees" its 3,000 campaigns. If the right campaign for this request lives on one of the other 7 nodes, we waste that request

As we added more nodes to scale capacity, campaigns were spread even thinner across them. The match rate got worse. This is a fundamental issue with round-robin routing. The load balancer distributes requests evenly across nodes with no awareness of which campaigns each node holds, so no node has visibility of all campaigns




Try the simulator below. It shows both routing styles and the health check flow:

- Switch between **Round-robin** and **Custom proxy** and watch the live match rate.
- Move the **Nodes** slider. With round-robin, the match rate drops as nodes grow (about 3 / nodes).
- Click **Crash a node**, then compare **Liveness only** and **Readiness**, with **Random** or **Least request** picking.

<iframe src="./custom-routing-sim.html" title="Custom routing simulator" style="width:100%;height:960px;border:1px solid #d8d8d8;border-radius:8px;" loading="lazy"></iframe>

[Open the simulator in full screen](./custom-routing-sim.html)

## The Solution: A Custom Reverse Proxy

We built a reverse proxy that sits in front of the compute nodes. Instead of round-robin routing, it routes each bid request to the node most likely to have a matching campaign. The proxy does not run the full filtering logic, that is too CPU-heavy. Instead, it applies a small number of fast, lightweight filter, the goal is to remove clearly wrong nodes and increase the probability that a bid request lands on a node with a matching campaign


We built this in Go using the standard `net/http/httputil.ReverseProxy` package with custom routing logic, pre-computed routing data is stored in Redis. We store this data in Redis instead of Go's memory, because keeping millions of entries in a `map[string]string` inside a Go process puts heavy pressure on the garbage collector. Go's GC must scan every pointer in the map on every cycle, which causes periodic CPU spikes. Moving the data to Redis removes it from Go's heap entirely. We covered this issue in detail in [Large Maps Are Bad for Go GC](./large-maps-are-bad-for-go-gc.md), which we discovered while building this proxy.

## How the Routing Works

When a bid request arrives at the proxy:

1. Read key attributes from the request (e.g. userID)
2. Look up those attributes in Redis to retrieve the pre-computed list of candidate nodes
3. Randomly pick one node from that list and forward the request

We only apply fast filter checks, the ones with high selectivity and low compute cost. The full filtering still happens on the compute node


## Upstream Health Checks

At first, we only checked whether upstream nodes were alive. If a node stopped responding to health checks, we removed it from the routing pool. Then we found that when a node crashes and restarts, it comes back online healthy but has no active campaigns yet because it has not finished loading its campaign data. This becomes a problem when the proxy uses least request routing. An empty node responds to requests very fast because it has nothing to check, so it always appears to have the fewest in-flight requests. The proxy keeps sending it more traffic, which all result in no bid

We then exposed an API endpoint that returns its current active campaign count, the proxy checks this count. If it is zero (or below a minimum threshold), the node is skipped from the routing pool until it is ready


## Results and Trade-offs

After deploying the custom routing proxy, our match rate increased by around **30%**. The trade-off is added latency. The proxy needs to query Redis and run routing logic before forwarding. This adds around **5ms** to each request, which is acceptable in our systems


## Key Takeaways

1. **Do lightweight filtering at the proxy layer.** Running full filtering at the proxy is too expensive. A few fast checks are enough to make better routing decisions
2. **Healthy does not mean ready.** A node that just restarted can appear healthy but have no data. Check application-level readiness, not just network-level liveness
